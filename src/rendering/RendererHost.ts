import * as THREE from 'three';
import type { GameSimulation } from '../game/GameSimulation';
import { ChaseCamera, CAMERA_TUNING } from '../camera/ChaseCamera';
import { LevelView } from './LevelView';
import { PlayerView } from './PlayerView';
import { DeathBurstView } from './DeathBurstView';
import { EnvironmentView } from './EnvironmentView';
import { DebugView } from '../debug/DebugView';
import { lerp } from '../core/math';
import { PALETTE } from '../visuals/palette';

/**
 * RendererHost — THE ONLY module allowed to own WebGLRenderer and apply
 * simulation state to Three.js objects.
 *
 * Responsibilities:
 * - create renderer/camera/lights/scene content,
 * - per rendered frame: interpolate visual transforms between simulation's
 *   previous and current state (gameplay itself never interpolates),
 * - advance the pure-math ChaseCamera with render dt,
 * - expose renderer.info for QA/performance observation.
 */
export interface RendererStatsSnapshot {
  calls: number;
  triangles: number;
}

export class RendererHost {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly scene: THREE.Scene;
  public readonly chaseCamera: ChaseCamera;

  private readonly levelView: LevelView;
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
  ) {
    // Cap DPR at 1.5 for perf headroom (spec §28); still crisp on HiDPI laptops.
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_TUNING.fov,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      400,
    );

    const env = new EnvironmentView(simulation.level.def.finishZ + 20);
    this.scene = env.scene;

    this.levelView = new LevelView(simulation.level);
    this.scene.add(this.levelView.group);

    this.playerViewInternal = new PlayerView();
    this.scene.add(this.playerViewInternal.group);

    this.deathBurst = new DeathBurstView();
    this.scene.add(this.deathBurst.group);

    this.debugView = new DebugView();
    this.debugView.buildColliders(simulation.level.world);
    this.scene.add(this.debugView.group);

    // Lights: hemisphere + one directional; cheap.
    const hemi = new THREE.HemisphereLight(0x9d7bff, 0x140a24, 0.9);
    const dir = new THREE.DirectionalLight(0xb9a5ff, 1.15);
    dir.position.set(-14, 26, -10);
    this.lights.add(hemi, dir);
    this.scene.add(this.lights);

    // Finish gate marker at finishZ.
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(16, 9, 0.35),
      new THREE.MeshBasicMaterial({
        color: PALETTE.finishGate,
        transparent: true,
        opacity: 0.32,
      }),
    );
    gate.position.set(0, 4.5, simulation.level.def.finishZ);
    this.scene.add(gate);

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
      this.chaseCamera.snapTo(p, 0);
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

    this.playerView.updateFromSimulation(ip, sim.player.grounded, renderDtSeconds);
    this.debugView.updatePlayerBox(p, sim.halfExtents);
    this.deathBurst.update(renderDtSeconds);

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

    this.chaseCamera.update(p, 0, renderDtSeconds);
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
    this.renderer.render(this.scene, this.camera);
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

  public resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose(): void {
    this.renderer.dispose();
    this.levelView.dispose();
    this.playerViewInternal.dispose();
    this.deathBurst.dispose();
    this.debugView.dispose();
    this.renderer.domElement.remove();
  }
}
