import * as THREE from 'three';
import type { GameSimulation } from '../game/GameSimulation';
import { ChaseCamera, CAMERA_TUNING } from '../camera/ChaseCamera';
import type { CameraFocusSide } from '../camera/ChaseCamera';
import type { GravityMode } from '../player/playerState';
import { LevelView } from './LevelView';
import { PlayerView } from './PlayerView';
import { DeathBurstView } from './DeathBurstView';
import { InteractionView } from './InteractionView';
import { ChomperView } from './ChomperView';
import { EnvironmentView } from './EnvironmentView';
import { MaterialLibrary } from './MaterialLibrary';
import { PostPipeline } from './PostPipeline';
import { VfxSystem } from './VfxSystem';
import { DebugView } from '../debug/DebugView';
import { lerp } from '../core/math';
import {
  RENDERER_CONFIG,
  resolveProductionTheme,
  type ProductionTheme,
} from '../visuals/productionTheme';
import {
  evaluateVisualSequence,
  lerpHex,
  makeVisualState,
  prepareVisualSequence,
  resetVisualState,
  type PreparedVisualSequence,
  type VisualState,
} from '../visuals/visualTimeline';
import {
  clearPunch,
  combinedPunchEnergy,
  dominantPunchColor,
  makeEventPunchState,
  triggerPunch,
  updatePunch,
  type EventPunchState,
} from '../visuals/eventPunch';
import {
  cueIdAtZ,
  prepareRhythmCues,
  type PreparedRhythmCues,
} from '../visuals/rhythmCues';

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
  /** M6B motion-juice on/off (default on; `?fx=off` forces off). */
  fxEnabled?: boolean;
  /** M6C1 visual triggers on/off (default on; `?triggers=off` forces off). */
  triggersEnabled?: boolean;
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
  /** M6B motion-juice VFX (presentation only; observes, never writes). */
  private readonly vfx: VfxSystem;
  /** M6C1 visual timeline: prepared position-driven sequence (possibly empty). */
  private readonly timelineSections: PreparedVisualSequence;
  /** M7.1 beat-ready cues: prepared position-driven markers (possibly empty). */
  private readonly rhythmCues: PreparedRhythmCues;
  /** Current resolved visual state (caller-owned scratch, reused per frame). */
  private readonly visualState: VisualState;
  private triggersEnabled: boolean;
  /** Whether a timeline state is currently applied (off-restore edge). */
  private timelineApplied = false;
  /** M6C2 event-reactive punch: short envelope per event family, applied
   *  on top of the timeline base look (bloom in-contract, exposure nudge,
   *  environment flash). Trigger-owned: `?triggers=off` keeps it at rest. */
  private readonly punch: EventPunchState = makeEventPunchState();
  private lastPunchPortal = 0;
  private lastPunchSpeed = 0;
  private lastPunchEvents = 0;
  private lastPunchTeleport = 0;
  /** Whether a punch overlay is currently applied (rest-restore edge). */
  private punchApplied = false;
  private readonly levelView: LevelView;
  /** M6C1 environment presentation (timeline-modulated, pre-existing objects). */
  private readonly environmentView: EnvironmentView;
  /** M4 interaction visuals + activation VFX (presentation only). */
  private readonly interactionView: InteractionView;
  /** M8D Chomper presentation (observes sim Chomper states). */
  private readonly chomperView: ChomperView;
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

    this.environmentView = new EnvironmentView(simulation.level.def.finishZ + 20, this.theme);
    this.scene = this.environmentView.scene;
    // M6C1 timeline: prepared once per level (cold path); the state
    // scratch starts at the exact base so probes read baseline pre-frame.
    this.timelineSections = prepareVisualSequence(simulation.level.def.visualSequence);
    // M7.1 rhythm cues ride with the level file (same precedent as the
    // visual sequence): prepared once, resolved per frame from z, never
    // stored, never fed to the sim.
    this.rhythmCues = prepareRhythmCues(simulation.level.def);
    this.visualState = makeVisualState();
    resetVisualState(this.theme, this.visualState);
    this.triggersEnabled = options.triggersEnabled ?? true;
    // M6C2 punch edges start synced (no false fire on the first frame).
    this.lastPunchPortal = simulation.portalTransitionCount;
    this.lastPunchSpeed = simulation.speedPortalCount;
    this.lastPunchEvents = simulation.interactionEventCount;
    this.lastPunchTeleport = simulation.teleportEventCount;

    this.levelView = new LevelView(simulation.level, this.library);
    this.scene.add(this.levelView.group);

    this.interactionView = new InteractionView(simulation.level, simulation, this.library, this.theme);
    this.scene.add(this.interactionView.group);

    this.chomperView = new ChomperView(simulation.level.chompers, this.library);
    // No empty groups in the scene: levels without Chompers add zero
    // children (resource pins stay level-comparable).
    if (simulation.level.chompers.length > 0) this.scene.add(this.chomperView.group);

    this.playerViewInternal = new PlayerView(this.library);
    this.scene.add(this.playerViewInternal.group);

    this.deathBurst = new DeathBurstView();
    this.scene.add(this.deathBurst.group);

    // M6B motion language + gameplay juice (trail, bursts, streaks).
    // Independent toggle: `?fx=off` hides it with zero gameplay effect.
    this.vfx = new VfxSystem(this.theme);
    this.scene.add(this.vfx.group);
    if (options.fxEnabled === false) this.vfx.setEnabled(false);

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

    // Death edge: one-shot burst + punchier kick at the frozen death
    // position (M8A: FOV +5, lift +0.4 — the stronger burst needs a
    // matching punch; still no roll, no shake).
    if (sim.deathId !== this.lastSeenDeathId) {
      this.lastSeenDeathId = sim.deathId;
      this.deathBurst.play(p, sim.playerMode);
      this.fovKick = 5;
      this.heightKick = 0.4;
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
      sim.player.gravityMode,
      sim.playerMode,
      sim.shipThrusting,
    );
    // Motion juice follows the SAME interpolated cube position (trail
    // integrity) with the same render dt (pause-freeze parity).
    this.vfx.update(renderDtSeconds, sim, ip);
    // M6C1 timeline: position-driven presentation from the same
    // interpolated Z (pause-safe: same z re-resolves the same state).
    this.updateVisualTimeline(ip.z);
    // M6C2 event punch: sim edges feed the envelope, the overlay maps it
    // onto bloom/exposure/environment above the timeline base look.
    this.updateEventPunch(renderDtSeconds);
    this.applyEventPunch();
    this.debugView.updatePlayerBox(p, sim.halfExtents);
    this.deathBurst.update(renderDtSeconds);
    this.interactionView.update(renderDtSeconds);
    this.chomperView.update(sim.chomperStates, renderDtSeconds);
    // M8A lava shimmer: slow dense pulse on the shared lava materials
    // (sim-time driven so pause freezes it; zero geometry per frame).
    this.library.setLavaPulse((sim.elapsedSimTime * 0.5) % 1);

    // Decay the death kick (~0.12 s time constant) and apply it as pure
    // presentation: FOV bump + tiny vertical lift. Never rolls, never shakes.
    if (this.fovKick !== 0 || this.heightKick !== 0) {
      const decay = Math.exp(-renderDtSeconds * 8);
      this.fovKick *= decay;
      this.heightKick *= decay;
      if (Math.abs(this.fovKick) < 0.05) this.fovKick = 0;
      if (Math.abs(this.heightKick) < 0.005) this.heightKick = 0;
    }
    // M6D: no updateProjectionMatrix here — render() applies the fov kick
    // and updates the projection once per presented frame (this method ran
    // it redundantly every frame, doubling a matrix recompute).
    // M8.2 Spider-swap glide: arm the camera envelope when gravity flips
    // inside Spider mode. Gravity-portal flips never arm it (approved
    // feel untouched); respawn/teleport snaps cut it (see snapTo).
    const grav = sim.gravityMode;
    if (this.lastCamGravity === null) {
      this.lastCamGravity = grav;
    } else if (grav !== this.lastCamGravity) {
      if (sim.playerMode === 'spider') this.chaseCamera.noteSpiderSwap();
      this.lastCamGravity = grav;
    }
    this.chaseCamera.update(p, 0, renderDtSeconds, this.focusSide());
  }

  /**
   * Camera framing follows the simulation's authoritative gravity mode
   * (presentation-only read): on the ceiling the pure-math camera frames the
   * focus from below so the eye stays in the open corridor instead of being
   * pulled up into the ceiling slab (M3.1 fix; see ChaseCamera).
   */
  private focusSide(): CameraFocusSide {
    // M8B: wall gravity frames from the free-face side (eye toward −X on
    // leftWall support, +X on rightWall) while staying elevated — the
    // camera never rolls on any surface.
    switch (this.simulation.gravityMode) {
      case 'ceiling':
        return 'belowFocus';
      case 'leftWall':
        return 'freeMinusFocus';
      case 'rightWall':
        return 'freePlusFocus';
      default:
        return 'aboveFocus';
    }
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

  /**
   * M8.2: last gravity mode observed by the camera wiring (Spider-swap
   * edge detection; null before the first presented frame).
   */
  private lastCamGravity: GravityMode | null = null;

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
   * Ground-jump signal from the REAL `onJump` sim event (bridged by Game).
   * One signal = one visual burst; never synthesized from polling.
   */
  public notifyJump(): void {
    this.vfx.notifyJump();
  }

  /** M6B effects state (QA observability). */
  public get fxEnabled(): boolean {
    return this.vfx.isEnabled;
  }

  /** Runtime FX toggle (debug/QA; presentation only). */
  public setFxEnabled(enabled: boolean): void {
    this.vfx.setEnabled(enabled);
  }

  /** Live M6B burst particles (QA boundedness observability). */
  public get activeParticles(): number {
    return this.vfx.activeParticles;
  }

  /** Live trail samples (QA boundedness observability). */
  public get trailSamples(): number {
    return this.vfx.trailSamples;
  }

  /** Visible speed-streak instances (QA observability). */
  public get activeStreaks(): number {
    return this.vfx.activeStreaks;
  }

  /** Cumulative M6B emission counters (QA observability). */
  public get fxCounters(): { jump: number; landing: number; gravity: number; speed: number; pad: number; jumpOrb: number; gravityOrb: number; teleport: number } {
    return this.vfx.countersSnapshot;
  }

  /** Last landing intensity 0..1 (impact-scaling observability). */
  public get lastLandingIntensity(): number {
    return this.vfx.lastLandingIntensityValue;
  }

  /** Monotonic VFX transient-reset count (QA observability). */
  public get fxResets(): number {
    return this.vfx.resetCountValue;
  }

  // --- M6C1 visual triggers (position-driven presentation) ---

  private updateVisualTimeline(z: number): void {
    if (this.triggersEnabled && this.timelineSections.length > 0) {
      evaluateVisualSequence(this.theme, this.timelineSections, z, this.visualState);
      this.applyVisualState();
      this.timelineApplied = true;
    } else if (this.timelineApplied) {
      // Triggers-off edge: restore the EXACT M6A+M6B baseline — never an
      // approximation, no stale section state may remain.
      resetVisualState(this.theme, this.visualState);
      this.library.resetRouteToTheme();
      this.environmentView.resetToTheme();
      this.post.resetBloomToTheme();
      this.renderer.toneMappingExposure = this.theme.exposure;
      this.vfx.setIntensity(1, 1);
      clearPunch(this.punch);
      this.punchApplied = false;
      this.timelineApplied = false;
    }
  }

  /**
   * M6C2 event punch: observe the same pre-existing sim edges the VFX
   * reads (portal/speed/interaction counters — no sim change) and feed
   * the punch envelope. Same-frame dedup mirrors the VFX rules (a
   * gravity-orb flip or speed crossing already has its dedicated pulse).
   * Trigger-owned: with triggers disabled the envelope stays at rest so
   * `?triggers=off` remains the exact baseline. Render-dt evolution only
   * (dt 0 while paused freezes the envelope with presentation pause).
   */
  private updateEventPunch(renderDtSeconds: number): void {
    const sim = this.simulation;
    if (!this.triggersEnabled) {
      if (combinedPunchEnergy(this.punch) > 0) clearPunch(this.punch);
    } else {
      const gravityFired = sim.portalTransitionCount !== this.lastPunchPortal;
      if (gravityFired) triggerPunch(this.punch, 'gravity');
      if (sim.speedPortalCount !== this.lastPunchSpeed) {
        const tierColor = this.theme.speedTierColors[String(sim.speedMultiplier)] ?? 0xffffff;
        triggerPunch(this.punch, 'speed', tierColor);
      }
      if (sim.teleportEventCount !== this.lastPunchTeleport) {
        triggerPunch(this.punch, 'teleport');
      }
      const events = sim.interactionEventCount - this.lastPunchEvents;
      if (events > 0) {
        const kind = sim.lastInteraction.kind;
        if (kind === 'pad') triggerPunch(this.punch, 'pad');
        else if (kind === 'jumpOrb') triggerPunch(this.punch, 'jumpOrb');
        else if (kind === 'gravityOrb' && !gravityFired) triggerPunch(this.punch, 'gravity');
        // kind 'speedPortal': covered by the speed edge above — skip.
      }
    }
    this.lastPunchPortal = sim.portalTransitionCount;
    this.lastPunchSpeed = sim.speedPortalCount;
    this.lastPunchEvents = sim.interactionEventCount;
    this.lastPunchTeleport = sim.teleportEventCount;
    updatePunch(this.punch, renderDtSeconds);
  }

  /**
   * Map the punch envelope onto the existing in-place hooks ABOVE the
   * timeline base look: bloom strength lift (re-clamped to BLOOM_CONTRACT
   * inside setBloomParams — a sprint-section punch can never exceed 0.7),
   * a small exposure nudge (clamped 0.5..2), and an environment flash
   * toward the dominant family color (bg/fog lerp + intensity lift,
   * clamped 0..2). Absolute writes every frame from the timeline-resolved
   * base — no accumulation, no drift; at rest the exact section look is
   * restored through the same applyVisualState path. Player / hazard /
   * route materials are never touched (identities stable by structure).
   */
  private applyEventPunch(): void {
    const energy = combinedPunchEnergy(this.punch);
    if (energy < 0.003) {
      if (this.punchApplied) {
        this.applyVisualState();
        this.punchApplied = false;
      }
      return;
    }
    const s = this.visualState;
    const tint = dominantPunchColor(this.punch);
    this.post.setBloomParams(s.bloomStrength + energy * 0.15, s.bloomRadius, s.bloomThreshold);
    this.renderer.toneMappingExposure = Math.min(2, Math.max(0.5, s.exposure + energy * 0.1));
    this.environmentView.applyVisualState(
      lerpHex(s.background, tint, energy * 0.22),
      lerpHex(s.fogColor, tint, energy * 0.18),
      s.fogNear,
      s.fogFar,
      Math.min(2, Math.max(0, s.environmentIntensity + energy * 0.6)),
    );
    // Ray burst: important gravity/pad/speed moments visibly energize the
    // background beams in the event family tint, decaying with the punch.
    const bed = Math.min(0.45, Math.max(0, (s.environmentIntensity - 1) * 0.7));
    this.environmentView.setEnergyRays(Math.min(1, bed + energy * 0.6), tint);
    this.punchApplied = true;
  }

  private applyVisualState(): void {
    const s = this.visualState;
    this.library.applyRouteState(s.routeBody, s.routeSurface, s.routeAccent);
    this.environmentView.applyVisualState(
      s.background,
      s.fogColor,
      s.fogNear,
      s.fogFar,
      s.environmentIntensity,
    );
    // Section ray bed: livelier sections carry visible beams in their own
    // accent color; calm sections fade them out (clamped — never dominant).
    const bed = Math.min(0.45, Math.max(0, (s.environmentIntensity - 1) * 0.7));
    this.environmentView.setEnergyRays(bed, s.routeAccent);
    this.post.setBloomParams(s.bloomStrength, s.bloomRadius, s.bloomThreshold);
    this.renderer.toneMappingExposure = s.exposure;
    this.vfx.setIntensity(s.vfxIntensity, s.streakIntensity);
  }

  /** Live M6C2 punch envelope 0..1 (QA observability; 0 at rest/off). */
  public get eventPunchEnergy(): number {
    return combinedPunchEnergy(this.punch);
  }

  /** Dominant M6C2 punch tint (QA observability; environment flash color). */
  public get eventPunchColor(): number {
    return dominantPunchColor(this.punch);
  }

  /** Live contact-skid samples (subset of trailSamples, QA observability). */
  public get contactSamples(): number {
    return this.vfx.contactSamples;
  }

  /** Live energy-ray opacity 0..0.28 (QA observability; 0 at rest/off). */
  public get energyRayOpacity(): number {
    return this.environmentView.liveRayOpacity();
  }

  /** Live applied background (timeline base + M6C2 punch flash, QA). */
  public get visualLiveBackground(): number {
    return this.environmentView.liveBackgroundHex();
  }

  /** Live applied fog color (timeline base + M6C2 punch flash, QA). */
  public get visualLiveFog(): number {
    return this.environmentView.liveFogHex();
  }

  /** Active timeline section id (`base` with triggers off / no sequence). */
  public get visualSectionId(): string {
    return this.visualState.sectionId;
  }

  /**
   * Active beat-ready cue id at the current interpolated forward position
   * (`null` before the first cue). Presentation observability only: the id
   * derives from z through the prepared level data — no clocks, no sim
   * state, nothing stored in replays.
   */
  public get rhythmCueId(): string | null {
    return cueIdAtZ(this.rhythmCues, this.interpPos.z);
  }

  /** 0..1 progress within the active section (QA interpolation bounds). */
  public get visualSectionProgress(): number {
    return this.visualState.sectionT;
  }

  public get visualTriggersEnabled(): boolean {
    return this.triggersEnabled;
  }

  /** Runtime trigger toggle (debug/QA; presentation only, immediate). */
  public setVisualTriggersEnabled(enabled: boolean): void {
    if (enabled === this.triggersEnabled) return;
    this.triggersEnabled = enabled;
    this.updateVisualTimeline(this.interpPos.z);
  }

  /** Live tone-mapping exposure (timeline-modulated, QA observability). */
  public get visualExposure(): number {
    return this.renderer.toneMappingExposure;
  }

  /** Live timeline VFX multiplier (QA observability). */
  public get visualVfxIntensity(): number {
    return this.visualState.vfxIntensity;
  }

  /** Live timeline background (QA observability). */
  public get visualBackground(): number {
    return this.visualState.background;
  }

  /** Live timeline fog color (QA observability). */
  public get visualFogColor(): number {
    return this.visualState.fogColor;
  }

  /** Live timeline route accent (QA geometry-change-free proof). */
  public get visualRouteAccent(): number {
    return this.visualState.routeAccent;
  }

  /** Player body color — timeline MUST never move it (identity proof). */
  public get visualPlayerColor(): number {
    return this.library.playerBody.color.getHex();
  }

  /** Hazard color — timeline MUST never move it (identity proof). */
  public get visualHazardColor(): number {
    return this.library.hazard.color.getHex();
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
    this.deathBurst.play(this.simulation.deathPosition, this.simulation.playerMode);
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

  /**
   * M6D real-GPU identity probe (cold QA path only): actual WebGL renderer
   * via WEBGL_debug_renderer_info. The perf verdict MUST identify this —
   * SwiftShader/llvmpipe/Basic Render Driver verdicts are software, never
   * a REAL-GPU PASS.
   */
  public gpuIdentity(): {
    version: string;
    vendor: string;
    renderer: string;
    devicePixelRatio: number;
    renderPixelRatio: number;
  } {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const unmasked = (p: number): string => {
      try {
        if (ext) return String(gl.getParameter(p));
      } catch { /* masked contexts stay labeled */ }
      return 'masked';
    };
    return {
      version: this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
      vendor: ext ? unmasked(ext.UNMASKED_VENDOR_WEBGL) : String(gl.getParameter(gl.VENDOR)),
      renderer: ext ? unmasked(ext.UNMASKED_RENDERER_WEBGL) : String(gl.getParameter(gl.RENDERER)),
      devicePixelRatio: window.devicePixelRatio,
      renderPixelRatio: this.renderer.getPixelRatio(),
    };
  }

  public dispose(): void {
    this.post.dispose();
    this.renderer.dispose();
    this.levelView.dispose();
    this.interactionView.dispose();
    this.chomperView.dispose();
    this.playerViewInternal.dispose();
    this.deathBurst.dispose();
    this.vfx.dispose();
    this.debugView.dispose();
    this.environmentView.dispose();
    this.library.dispose();
    this.renderer.domElement.remove();
  }
}
