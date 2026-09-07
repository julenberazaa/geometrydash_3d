import * as THREE from 'three';
import type { GameSimulation } from '../game/GameSimulation';
import { ChaseCamera, CAMERA_TUNING } from '../camera/ChaseCamera';
import type { CameraFocusSide } from '../camera/ChaseCamera';
import { LevelView } from './LevelView';
import { PlayerView } from './PlayerView';
import { DeathBurstView } from './DeathBurstView';
import { InteractionView } from './InteractionView';
import { EnvironmentView } from './EnvironmentView';
import { MaterialLibrary } from './MaterialLibrary';
import { PostPipeline } from './PostPipeline';
import { DebugView } from '../debug/DebugView';
import { lerp } from '../core/math';
import {
  RENDERER_CONFIG,
  resolveProductionTheme,
  type ProductionTheme,
} from '../visuals/productionTheme';

/**
 * RendererHost — THE ONLY module allowed to own WebGLRenderer and apply
 * simulation state to Three.js objects.
 *
 * Responsibilities:
 * - resolve the production visual theme (renderer-owned; level overlay only),
 * - own the shared MaterialLibrary (sole material/geometry owner),
 * - own the PostPipeline (controlled bloom + OutputPass; direct-render
 *   fallback when disabled),
 * - configure the renderer once (tone mapping, exposure, color space, DPR),
 * - per rendered frame: interpolate visual transforms between simulation's
 *   previous and current state (gameplay itself never interpolates),
 * - advance the pure-math ChaseCamera with render dt,
 * - expose renderer.info for QA/performance observation.
 */
export interface RendererStatsSnapshot {
  calls: number;
  triangles: number;
}

export interface RendererOptions {
  /** Post pipeline on/off (default per RENDERER_CONFIG; `?post=off` forces off). */
  postEnabled?: boolean;
}

export class RendererHost {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly scene: THREE.Scene;
  public readonly chaseCamera: ChaseCamera;
  /** Effective production theme (level overlay applied; gameplay-agnostic). */
  public readonly theme: ProductionTheme;

  private readonly library: MaterialLibrary;
  private readonly post: PostPipeline;
  private readonly levelView: LevelView;
  /** M4 interaction visuals + activation VFX (presentation only). */
  private readonly interactionView: InteractionView;
  public get playerView(): Readonly<PlayerView> {
    return this.playerViewInternal;
  }

  public setPlayerVisible(visible: boolean): void {
    this.playerViewInternal.setVisible(visible);
  }

  private readonly playerViewInternal: PlayerView;
  private readonly deathBurst: DeathBurstView;
  private readonly debugView: DebugView;
  private readonly lights: THREE.Group = new THREE.Group();

  /** Last observed death counter (burst trigger edge). */
  private lastSeenDeathId = 0;
  /** Previous sim status (respawn-transition edge). */
  private prevStatus = 'running';
  /** Last player position applied (teleport detection for R-while-running). */
  private readonly lastAppliedPos = { x: 0, y: 0, z: 0 };
  /** Restrained death kick: FOV points + vertical units, both fast-decaying. */
  private fovKick = 0;
  private heightKick = 0;

  /** Scratch interpolated position (avoid per-frame allocations). */
  private readonly interpPos = { x: 0, y: 0, z: 0 };

  constructor(
    container: HTMLElement,
    private readonly simulation: GameSimulation,
    options: RendererOptions = {},
  ) {
    // Theme first: every visual decision below derives from it.
    this.theme = resolveProductionTheme(simulation.level.def);
    this.library = new MaterialLibrary(this.theme);

    // Centralized renderer configuration (single owner — see
    // RENDERER_CONFIG / ProductionTheme). ACES tone mapping is honored both
    // by the composer OutputPass and by the direct-render fallback path.
    this.renderer = new THREE.WebGLRenderer({
      antialias: RENDERER_CONFIG.antialias,
      powerPreference: RENDERER_CONFIG.powerPreference,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.theme.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Manual info accounting: under the composer path `renderer.info` would
    // otherwise only reflect the final quad pass. Reset per presented frame
    // so `stats` honestly reports scene + post cost (QA comparability).
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.theme.dprCap));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_TUNING.fov,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      400,
    );

    const env = new EnvironmentView(simulation.level.def.finishZ + 20, this.theme);
    this.scene = env.scene;

    this.levelView = new LevelView(simulation.level, this.library);
    this.scene.add(this.levelView.group);

    this.interactionView = new InteractionView(simulation.level, simulation, this.library, this.theme);
    this.scene.add(this.interactionView.group);

    this.playerViewInternal = new PlayerView(this.library);
    this.scene.add(this.playerViewInternal.group);

    this.deathBurst = new DeathBurstView();
    this.scene.add(this.deathBurst.group);

    this.debugView = new DebugView();
    this.debugView.buildColliders(simulation.level.world);
    this.scene.add(this.debugView.group);

    // Minimum viable lighting (theme-owned values): hemisphere + one
    // directional. No point lights — emissive/material design carries the
    // neon response (M6A lighting audit decision).
    const hemi = new THREE.HemisphereLight(
      this.theme.hemiSky,
      this.theme.hemiGround,
      this.theme.hemiIntensity,
    );
    const dir = new THREE.DirectionalLight(this.theme.dirColor, this.theme.dirIntensity);
    dir.position.set(-14, 26, -10);
    this.lights.add(hemi, dir);
    this.scene.add(this.lights);

    // Finish gate marker at finishZ.
    const gate = new THREE.Mesh(this.library.unitBox, this.library.finishGate);
    gate.scale.set(16, 9, 0.35);
    gate.position.set(0, 4.5, simulation.level.def.finishZ);
    this.scene.add(gate);

    // Controlled bloom foundation (theme-parameterized; direct-render
    // fallback when disabled — game stays fully playable either way).
    const postEnabled = options.postEnabled ?? RENDERER_CONFIG.enabledByDefault;
    this.post = new PostPipeline(this.renderer, this.scene, this.camera, this.theme, postEnabled);

    this.chaseCamera = new ChaseCamera();
    this.applyFrame(0, 0);
  }

  /** Per rendered frame: interpolate visuals only. */
  public applyFrame(alpha: number, renderDtSeconds: number): void {
    if (this.debugFreezeFrame) return;
    const sim = this.simulation;
    // Player visibility is presentation of sim status; applied here (not in
    // Game) so debug frame-freezes capture the true death-moment frame.
    this.playerViewInternal.setVisible(sim.status !== 'dead');
    const p = sim.player.position;
    const prev = sim.prevPosition;

    // Death edge: one-shot burst + small kick at the frozen death position.
    if (sim.deathId !== this.lastSeenDeathId) {
      this.lastSeenDeathId = sim.deathId;
      this.deathBurst.play(p);
      this.fovKick = 3.5;
      this.heightKick = 0.25;
    }
    // Respawn edge (dead -> running) or manual-teleport (R while running):
    // snap the camera to the start frame — no backward swoosh, no stale kick.
    const teleported =
      Math.abs(p.x - this.lastAppliedPos.x) +
        Math.abs(p.y - this.lastAppliedPos.y) +
        Math.abs(p.z - this.lastAppliedPos.z) >
      5;
    if ((this.prevStatus === 'dead' && sim.status === 'running') || (sim.status === 'running' && teleported)) {
      this.chaseCamera.snapTo(p, 0, this.focusSide());
      this.fovKick = 0;
      this.heightKick = 0;
      this.deathBurst.clear();
    }
    this.prevStatus = sim.status;
    this.lastAppliedPos.x = p.x;
    this.lastAppliedPos.y = p.y;
    this.lastAppliedPos.z = p.z;
    const ip = this.interpPos;
    ip.x = lerp(prev.x, p.x, alpha);
    ip.y = lerp(prev.y, p.y, alpha);
    ip.z = lerp(prev.z, p.z, alpha);

    this.playerView.updateFromSimulation(
      ip,
      sim.player.grounded,
      renderDtSeconds,
      sim.player.gravityMode === 'ceiling',
    );
    this.debugView.updatePlayerBox(p, sim.halfExtents);
    this.deathBurst.update(renderDtSeconds);
    this.interactionView.update(renderDtSeconds);

    // Decay the death kick (~0.12 s time constant) and apply it as pure
    // presentation: FOV bump + tiny vertical lift. Never rolls, never shakes.
    if (this.fovKick !== 0 || this.heightKick !== 0) {
      const decay = Math.exp(-renderDtSeconds * 8);
      this.fovKick *= decay;
      this.heightKick *= decay;
      if (Math.abs(this.fovKick) < 0.05) this.fovKick = 0;
      if (Math.abs(this.heightKick) < 0.005) this.heightKick = 0;
    }
    this.camera.fov = CAMERA_TUNING.fov + this.fovKick;
    this.camera.updateProjectionMatrix();

    this.chaseCamera.update(p, 0, renderDtSeconds, this.focusSide());
  }

  /**
   * Camera framing follows the simulation's authoritative gravity mode
   * (presentation-only read): on the ceiling the pure-math camera frames the
   * focus from below so the eye stays in the open corridor instead of being
   * pulled up into the ceiling slab (M3.1 fix; see ChaseCamera).
   */
  private focusSide(): CameraFocusSide {
    return this.simulation.gravityMode === 'ceiling' ? 'belowFocus' : 'aboveFocus';
  }

  public render(): void {
    // THREE camera pose is applied here (not in applyFrame) so debug tools
    // that reposition the pure-math camera (debugSnapCameraToDeath) take
    // effect even while simulation-to-view updates are frozen for photos.
    this.camera.fov = CAMERA_TUNING.fov + this.fovKick;
    this.camera.updateProjectionMatrix();
    const camPos = this.chaseCamera.currentPosition;
    const look = this.chaseCamera.currentLookTarget;
    this.camera.position.set(camPos.x, camPos.y + this.heightKick, camPos.z);
    this.camera.up.set(0, 1, 0); // never rolls
    this.camera.lookAt(look.x, look.y, look.z);
    // Composer path when enabled (controlled bloom), direct render fallback
    // otherwise — identical scene, no gameplay dependency either way.
    this.renderer.info.reset();
    this.post.render();
  }

  public setDebugCollidersVisible(visible: boolean): void {
    this.debugView.setCollidersVisible(visible);
  }

  public setDebugPlayerBoxVisible(visible: boolean): void {
    this.debugView.setPlayerBoxVisible(visible);
  }

  public get stats(): RendererStatsSnapshot {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  /** Live scene child count (leak guard for repeated death/respawn QA). */
  public get sceneChildren(): number {
    return this.scene.children.length;
  }

  /** Shared material count (resource-guard observability). */
  public get materialCount(): number {
    return this.library.materialCount;
  }

  /** Shared geometry count (resource-guard observability). */
  public get geometryCount(): number {
    return this.library.geometryCount;
  }

  /** Post pipeline state (QA observability). */
  public get postEnabled(): boolean {
    return this.post.isEnabled;
  }

  public get postPassCount(): number {
    return this.post.passCount;
  }

  public get bloomParams(): { strength: number; radius: number; threshold: number } | null {
    return this.post.liveBloomParams;
  }

  /** Runtime post toggle (debug/QA; presentation only). */
  public setPostEnabled(enabled: boolean): void {
    this.post.setEnabled(enabled);
  }

  /**
   * Debug-only frame freeze (QA photography aid, same category as F1/F2/F3).
   * When true, applyFrame skips every visual update while render() keeps
   * presenting the frozen frame — a 0.35 s death burst can then be captured
   * mid-flight despite multi-second headless screenshot latency. Simulation
   * is untouched and resumes cleanly on unfreeze. Default off; zero product
   * impact (one branch per frame).
   */
  public debugFreezeFrame = false;

  /** Whether the death burst is currently visible (QA observability). */
  public get deathBurstActive(): boolean {
    return this.deathBurst.isActive;
  }

  /** Active M4 activation rings (QA leak-guard observability). */
  public get interactionRingsActive(): number {
    return this.interactionView.activeRingCount;
  }

  /**
   * Debug-only burst replay (QA photography aid). Re-fires the REAL pooled
   * burst at the recorded death position without touching simulation state.
   * Used with debugFreezeFrame: freeze, replay, run ~150 ms live, refreeze —
   * the frozen mid-flight frame can then be captured despite multi-second
   * headless screenshot latency. The replayed effect is pixel-identical to
   * the natural one (same pool, same origin, same motion model).
   */
  public debugReplayBurst(): void {
    this.deathBurst.play(this.simulation.deathPosition);
  }

  /**
   * QA observability: project a world point through the LIVE camera to NDC
   * [-1,1]² and pixel coordinates (y down). Presentation-only read (same
   * category as cameraEye/cameraLook probes) — framing/readability QA measures
   * screen-space placement, apparent size, and surface visibility with it.
   * Cold path; never called per frame by gameplay.
   */
  public projectToScreen(x: number, y: number, z: number): {
    ndcX: number; ndcY: number; px: number; py: number; behind: boolean;
  } {
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const behind = v.z > 1 || v.z < -1;
    return {
      ndcX: v.x,
      ndcY: v.y,
      px: (v.x * 0.5 + 0.5) * this.renderer.domElement.clientWidth,
      py: (0.5 - v.y * 0.5) * this.renderer.domElement.clientHeight,
      behind,
    };
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.post.resize(width, height);
  }

  public dispose(): void {
    this.post.dispose();
    this.renderer.dispose();
    this.levelView.dispose();
    this.interactionView.dispose();
    this.playerViewInternal.dispose();
    this.deathBurst.dispose();
    this.debugView.dispose();
    this.library.dispose();
    this.renderer.domElement.remove();
  }
}
