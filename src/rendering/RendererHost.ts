import * as THREE from 'three';
import type { GameSimulation } from '../game/GameSimulation';
import { ChaseCamera, CAMERA_TUNING } from '../camera/ChaseCamera';
import type { CameraFocusSide } from '../camera/ChaseCamera';
import { CameraOcclusionResolver, type CameraBlocker } from '../camera/CameraOcclusionResolver';
import { CameraOccluderFade } from './CameraOccluderFade';
import { ContactPulse } from './ContactPulse';
import type { GravityMode } from '../player/playerState';
import { LevelView } from './LevelView';
import { PlayerView } from './PlayerView';
import { DeathBurstView } from './DeathBurstView';
import { InteractionView } from './InteractionView';
import { CheckpointView } from './CheckpointView';
import { ChomperView } from './ChomperView';
import { MovingPlatformView } from './MovingPlatformView';
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
import {
  clearRhythmImpact,
  evaluateRhythmPulse,
  makeRhythmImpactState,
  makeRhythmPulse,
  updateRhythmImpact,
  type RhythmImpactState,
  type RhythmPulse,
} from '../visuals/rhythmPulse';
import { targetMusicTime } from '../audio/musicTrack';

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
  /**
   * M9 rhythm pulse: deterministic beat-grid envelopes from sim-time music
   * time (no audio reads). Composed into the timeline base look by
   * applyVisualState (below the event-punch overlay). Active only on
   * music levels with triggers on; levels without a track keep legacy
   * behavior bit-identically.
   */
  private readonly rhythmPulse: RhythmPulse = makeRhythmPulse();
  private readonly rhythmImpact: RhythmImpactState = makeRhythmImpactState();
  private readonly rhythmActive: boolean;
  private readonly rhythmTrackOffset: number;
  /** Previous Chomper phases for the lunge→impact punch edge (fixed, ≤8). */
  private readonly lastChomperPhases: string[];
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
  /** M9.2 checkpoint crystals (absent group when the level has none). */
  private readonly checkpointView: CheckpointView;
  /** M8D Chomper presentation (observes sim Chomper states). */
  private readonly chomperView: ChomperView;
  /** M8.6 moving-platform presentation (observes sim platform states). */
  private readonly platformView: MovingPlatformView;
  /**
   * M8.6 camera visibility (Bug B): the ChaseCamera's ideal pose resolved
   * against blocking geometry (pull-in, no orbiting). Presentation-only —
   * the resolver never touches simulation state.
   */
  private readonly occlusion: CameraOcclusionResolver;
  /**
   * Static camera blockers adapted once per level from solid colliders
   * (cold path; hazards/lava/kill volumes never block the camera). Moving
   * platforms ride fixed scratch entries updated in place per frame (their
   * authoritative poses are observed, never written).
   */
  private readonly staticBlockers: CameraBlocker[];
  private readonly platformBlockers: CameraBlocker[];
  /** Combined blocker set (static + platform scratch), built once per level. */
  private readonly allBlockers: CameraBlocker[];
  /**
   * M8.6 occluder fade (§14, last resort): fades the single reported
   * blocking mesh when pull-in cannot recover sight. Renderer-only.
   */
  private readonly occluderFade: CameraOccluderFade;
  /**
   * M9.3 island contact response: the touched support body mesh briefly
   * surges on landing (local pulse, pooled clones, no leaks). Renderer-only.
   * Field-initialized (used by the fx flag early in the constructor).
   */
  private readonly contactPulse: ContactPulse = new ContactPulse();
  /** Previous-frame grounded state (landing-edge detection for pulses). */
  private prevGrounded = false;
  /** Resolver `platform-<id>` → MovingPlatformView definition index. */
  private readonly platformFadeIndex = new Map<string, number>();
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
  /** True when this frame cut the camera (teleport/respawn): the visibility
   *  resolver applies pull-in immediately so the new pose is safe at once. */
  private cameraSnappedThisFrame = false;
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

    // M9.1: the environment reads level data at build ONLY (focal gate
    // positions + section accents for the architecture layer) — the same
    // precedent as LevelView/rhythmCues; never gameplay, never per-frame.
    this.environmentView = new EnvironmentView(
      simulation.level.def.finishZ + 20,
      this.theme,
      simulation.level.def,
    );
    this.scene = this.environmentView.scene;
    // M6C1 timeline: prepared once per level (cold path); the state
    // scratch starts at the exact base so probes read baseline pre-frame.
    this.timelineSections = prepareVisualSequence(simulation.level.def.visualSequence);
    // M7.1 rhythm cues ride with the level file (same precedent as the
    // visual sequence): prepared once, resolved per frame from z, never
    // stored, never fed to the sim.
    this.rhythmCues = prepareRhythmCues(simulation.level.def);
    // M9 rhythm pulse: active only on music levels (the beat grid follows
    // the declared track); other levels never evaluate it.
    const track = simulation.level.def.musicTrack ?? null;
    this.rhythmActive = track !== null;
    this.rhythmTrackOffset = track?.trackOffset ?? 0;
    this.lastChomperPhases = simulation.chomperStates.map((s) => s.phase);
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

    // M9.2 checkpoint crystals: built from level data (same precedent as
    // the interaction view); burst rings inherit the live section accent
    // at the checkpoint z (biome identity without per-crystal materials).
    const accentScratch = makeVisualState();
    this.checkpointView = new CheckpointView(
      simulation.level,
      simulation,
      this.library,
      (z: number): number => {
        evaluateVisualSequence(this.theme, this.timelineSections, z, accentScratch);
        return accentScratch.routeAccent;
      },
    );
    // Same empty-group rule as Chompers/platforms: checkpoint-less levels
    // add zero children (resource pins stay level-comparable).
    if (simulation.level.checkpoints.length > 0) this.scene.add(this.checkpointView.group);

    this.chomperView = new ChomperView(simulation.level.chompers, this.library);
    // No empty groups in the scene: levels without Chompers add zero
    // children (resource pins stay level-comparable).
    if (simulation.level.chompers.length > 0) this.scene.add(this.chomperView.group);
    this.platformView = new MovingPlatformView(simulation.level.movingPlatforms, this.library);
    // Same empty-group rule: levels without platforms add zero children.
    if (simulation.level.movingPlatforms.length > 0) this.scene.add(this.platformView.group);

    this.playerViewInternal = new PlayerView(this.library);
    this.scene.add(this.playerViewInternal.group);

    this.deathBurst = new DeathBurstView();
    this.scene.add(this.deathBurst.group);

    // M6B motion language + gameplay juice (trail, bursts, streaks).
    // Independent toggle: `?fx=off` hides it with zero gameplay effect.
    this.vfx = new VfxSystem(this.theme);
    this.scene.add(this.vfx.group);
    if (options.fxEnabled === false) this.vfx.setEnabled(false);
    if (options.fxEnabled === false) this.contactPulse.setEnabled(false);

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
    this.occlusion = new CameraOcclusionResolver();
    this.staticBlockers = [];
    for (const c of simulation.level.world.colliders()) {
      if (c.kind !== 'solid') continue;
      this.staticBlockers.push({
        id: c.id,
        minX: c.center.x - c.halfExtents.x,
        minY: c.center.y - c.halfExtents.y,
        minZ: c.center.z - c.halfExtents.z,
        maxX: c.center.x + c.halfExtents.x,
        maxY: c.center.y + c.halfExtents.y,
        maxZ: c.center.z + c.halfExtents.z,
      });
    }
    // Fixed platform scratch (bounded by the authoring cap): centers are
    // rewritten every frame from the authoritative sim poses; half extents
    // are level-constant. Unused entries sit at a far-away point no camera
    // segment can ever reach (never allocate, never intersect).
    this.platformBlockers = [];
    const platformDefs = simulation.level.movingPlatforms;
    for (let i = 0; i < 8; i++) {
      const def = platformDefs[i];
      if (def === undefined) {
        this.platformBlockers.push({
          id: `platform-unused-${String(i)}`,
          minX: 1e9, minY: 1e9, minZ: 1e9,
          maxX: 1e9, maxY: 1e9, maxZ: 1e9,
        });
        continue;
      }
      const hx = def.halfExtents.x;
      const hy = def.halfExtents.y;
      const hz = def.halfExtents.z;
      this.platformBlockers.push({
        id: `platform-${def.id}`,
        minX: -hx, minY: -hy, minZ: -hz,
        maxX: hx, maxY: hy, maxZ: hz,
      });
    }
    this.allBlockers = [...this.staticBlockers, ...this.platformBlockers];
    this.occluderFade = new CameraOccluderFade();
    simulation.level.movingPlatforms.forEach((def, index) => {
      this.platformFadeIndex.set(`platform-${def.id}`, index);
    });
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
    // M8.3: a Spider-context gravity swap ALSO displaces the player >5 u
    // in one tick, but that is a sanctioned transition, NOT a teleport —
    // snapping here was the reload-like cut (the M8.2 glide armed after
    // the cut and could only ease residual error). The gravity edge is
    // resolved BEFORE this check so swaps glide instead of cutting;
    // teleport portals (no gravity flip) still snap.
    const grav = sim.gravityMode;
    let spiderSwap = false;
    if (this.lastCamGravity === null) {
      this.lastCamGravity = grav;
    } else if (grav !== this.lastCamGravity) {
      if (sim.playerMode === 'spider') {
        spiderSwap = true;
        this.chaseCamera.noteSpiderSwap();
        this.swapGlideCount += 1;
      }
      this.lastCamGravity = grav;
    }
    const teleported =
      Math.abs(p.x - this.lastAppliedPos.x) +
        Math.abs(p.y - this.lastAppliedPos.y) +
        Math.abs(p.z - this.lastAppliedPos.z) >
      5;
    // M8.6 visibility: a teleport that kills on arrival (debug placement
    // into a wall, or a portal exit inside a hazard) must still snap — the
    // status gate used to strand the ideal pose hundreds of units behind,
    // and the resolver then pulled along a stale sightline. Snapping onto
    // a death pose is harmless: the respawn edge re-snaps on revive, and
    // `teleported` clears after one frame (lastAppliedPos follows).
    if ((this.prevStatus === 'dead' && sim.status === 'running') || (teleported && !spiderSwap)) {
      this.chaseCamera.snapTo(p, 0, this.focusSide());
      this.fovKick = 0;
      this.heightKick = 0;
      this.deathBurst.clear();
      this.cameraSnappedThisFrame = true;
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
    // M9 rhythm pulse: deterministic sim-time beat envelopes feeding the
    // timeline base look below (pause-safe: frozen sim time re-resolves
    // the identical pulse — pure function, no accumulation).
    this.updateRhythmPulse(renderDtSeconds);
    // M6C2 event punch: sim edges feed the envelope, the overlay maps it
    // onto bloom/exposure/environment above the timeline base look.
    this.updateEventPunch(renderDtSeconds);
    this.applyEventPunch();
    this.debugView.updatePlayerBox(p, sim.halfExtents);
    this.deathBurst.update(renderDtSeconds);
    this.interactionView.update(renderDtSeconds);
    this.checkpointView.update(renderDtSeconds);
    // M9.2 biome-mote drift (render-dt, in place; pause freezes via dt 0).
    this.environmentView.updateMotes(renderDtSeconds);
    this.chomperView.update(sim.chomperStates, renderDtSeconds);
    this.platformView.update(sim.platformStates, alpha);
    // M8.3 lava motion: convect crust + descend falls (render-dt driven;
    // pause freezes the flow like every other presentation clock).
    this.levelView.updateLava(renderDtSeconds);
    // M9.2 portal energy breathing (same render-dt contract).
    this.levelView.updatePortals(renderDtSeconds);
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
    this.chaseCamera.update(p, 0, renderDtSeconds, this.focusSide(), sim.player.grounded);
    // M8.6 visibility (§9): resolve the ideal pose against blocking
    // geometry AFTER all desired-pose sources (damping, Spider glide,
    // snaps) have run — the resolver never reinterprets a glide as a cut.
    // Platform scratch follows the authoritative sim poses (observed only).
    const states = sim.platformStates;
    const defs = sim.level.movingPlatforms;
    const n = Math.min(states.length, defs.length, this.platformBlockers.length);
    for (let i = 0; i < n; i++) {
      const st = states[i];
      const def = defs[i];
      const b = this.platformBlockers[i];
      if (st === undefined || def === undefined || b === undefined) continue;
      const hx = def.halfExtents.x;
      const hy = def.halfExtents.y;
      const hz = def.halfExtents.z;
      b.minX = st.x - hx; b.maxX = st.x + hx;
      b.minY = st.y - hy; b.maxY = st.y + hy;
      b.minZ = st.z - hz; b.maxZ = st.z + hz;
    }
    this.occlusion.resolve(
      p,
      this.chaseCamera.currentPosition,
      this.chaseCamera.currentLookTarget,
      this.allBlockers,
      renderDtSeconds,
      this.cameraSnappedThisFrame,
    );
    this.cameraSnappedThisFrame = false;
    // M8.6 occluder fade (§14): ONLY when pull-in reports no usable pose,
    // and ONLY the reported solid/platform body mesh. Everything else
    // (hazards, lava, portals, trims, environment) can never be registered.
    let fadeMesh: THREE.Mesh | null = null;
    if (this.occlusion.needsOccluderFade) {
      const occluderId = this.occlusion.occluderId;
      if (occluderId !== null) {
        if (occluderId.startsWith('platform-')) {
          const index = this.platformFadeIndex.get(occluderId);
          fadeMesh = index !== undefined ? this.platformView.occluderMesh(index) : null;
        } else {
          fadeMesh = this.levelView.occluderMeshes.get(occluderId) ?? null;
        }
      }
    }
    this.occluderFade.update(fadeMesh, renderDtSeconds);
    // M9.3 island contact response (§21-24): the grounded edge pulses the
    // TOUCHED support body mesh only (static via the solid map, moving via
    // the platform view — the clone rides the mesh so ferry pulses follow
    // the pose). Runs while the attempt is live; pause freezes via dt 0;
    // `?fx=off` silences new pulses like all other contact language.
    const groundedNow = sim.status === 'running' && sim.player.grounded;
    if (groundedNow && !this.prevGrounded) {
      const supportId = sim.player.supportColliderId;
      if (supportId !== null) {
        let pulseMesh: THREE.Mesh | null = null;
        if (supportId.startsWith('platform-')) {
          const index = this.platformFadeIndex.get(supportId);
          pulseMesh = index !== undefined ? this.platformView.occluderMesh(index) : null;
        } else {
          pulseMesh = this.levelView.occluderMeshes.get(supportId) ?? null;
        }
        if (pulseMesh !== null) {
          this.contactPulse.noteLanding(pulseMesh, supportId, this.visualState.routeAccent);
        }
      }
    }
    this.prevGrounded = groundedNow;
    this.contactPulse.update(renderDtSeconds);
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
    // M8.6 visibility: the PRESENTED pose is the occlusion-resolved one —
    // the ideal ChaseCamera pose only survives when the sight line is clear.
    this.camera.fov = CAMERA_TUNING.fov + this.fovKick;
    this.camera.updateProjectionMatrix();
    const camPos = this.occlusion.currentResolvedEye;
    const look = this.occlusion.currentResolvedLook;
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
   * M8.3 QA observability: lava-motion checksum (presentation only).
   */
  public get lavaMotionSample(): string {
    return this.levelView.sampleLavaMotion();
  }

  /**
   * M8.2: last gravity mode observed by the camera wiring (Spider-swap
   * edge detection; null before the first presented frame).
   */
  private lastCamGravity: GravityMode | null = null;
  /**
   * M8.2 QA observability: Spider-swap glide envelopes armed this
   * session (presentation only — proves the smoothing path engaged).
   */
  public swapGlideCount = 0;

  /**
   * M8.6 camera-visibility observability (presentation/debug only — the
   * visibility QA contract: eye non-penetration + sight-line visibility).
   */
  public get cameraOccluded(): boolean {
    return this.occlusion.isOccluded;
  }

  public get cameraOccluderCount(): number {
    return this.occlusion.blockerCount;
  }

  public get cameraIdealEye(): Readonly<{ x: number; y: number; z: number }> {
    return this.occlusion.currentIdealEye;
  }

  public get cameraResolvedEye(): Readonly<{ x: number; y: number; z: number }> {
    return this.occlusion.currentResolvedEye;
  }

  public get cameraResolvedLook(): Readonly<{ x: number; y: number; z: number }> {
    return this.occlusion.currentResolvedLook;
  }

  public get cameraPullInDistance(): number {
    return this.occlusion.pullInDistance;
  }

  /** Meshes currently held faded by the last-resort fallback (bound). */
  public get fadedOccluderCount(): number {
    return this.occluderFade.fadedCount;
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
    this.contactPulse.setEnabled(enabled);
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

  /** Cumulative island landing pulses (QA observability). */
  public get contactPulseCount(): number {
    return this.contactPulse.pulseCount;
  }

  /** Support id of the most recent landing pulse (QA observability). */
  public get lastContactPulseId(): string | null {
    return this.contactPulse.lastPulseId;
  }

  /** Strongest live pulse envelope 0..1, 0 at rest (QA observability). */
  public get contactPulseIntensity(): number {
    return this.contactPulse.pulseIntensity;
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
      this.levelView.setEdgeAccent(this.theme.routeEdge);
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
   * M9 rhythm pulse evaluation (presentation only): beat-grid envelopes
   * from deterministic sim-time music time. Trigger-owned (with triggers
   * off the scratch holds rest); music-level-gated (other levels never
   * evaluate — legacy behavior preserved). Render-dt drives ONLY the
   * section-entry impact decay (dt 0 while paused freezes it).
   */
  private updateRhythmPulse(renderDtSeconds: number): void {
    if (!this.triggersEnabled || !this.rhythmActive) {
      this.rhythmPulse.eighth = 0;
      this.rhythmPulse.beat = 0;
      this.rhythmPulse.downbeat = 0;
      this.rhythmPulse.drop = 0;
      if (this.rhythmImpact.energy > 0) clearRhythmImpact(this.rhythmImpact);
      return;
    }
    const musicTime = targetMusicTime(this.simulation.elapsedSimTime, this.rhythmTrackOffset);
    evaluateRhythmPulse(musicTime, this.rhythmPulse);
    updateRhythmImpact(this.rhythmImpact, musicTime, renderDtSeconds);
  }

  /**
   * M6C2 event punch: observe the same pre-existing sim edges the VFX
   * reads (portal/speed/interaction counters + Chomper phases — no sim
   * change) and feed the punch envelope. Same-frame dedup mirrors the
   * VFX rules (a gravity-orb flip or speed crossing already has its
   * dedicated pulse). Trigger-owned: with triggers disabled the envelope
   * stays at rest so `?triggers=off` remains the exact baseline.
   * Render-dt evolution only (dt 0 while paused freezes the envelope
   * with presentation pause).
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
      // M9 Chomper-lunge impacts: telegraph→lunging edges punch warm red
      // (lunges land on musical accents — see the alignment contract).
      const states = sim.chomperStates;
      for (let i = 0; i < states.length && i < this.lastChomperPhases.length; i++) {
        const phase = states[i]?.phase ?? 'dormant';
        if (phase === 'lunging' && this.lastChomperPhases[i] !== 'lunging') {
          triggerPunch(this.punch, 'impact');
        }
        this.lastChomperPhases[i] = phase;
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
    this.levelView.setEdgeAccent(s.routeAccent);
    // M9 rhythm pulse legs (below the event-punch overlay): beat-grid
    // envelopes pump the SAME in-place hooks the timeline owns — bloom
    // (re-clamped in-contract), exposure (0.5..2), environment (0..2),
    // beams (section accent = automatic biome response: forge amber,
    // islands teal, maze violet, cathedral blue, foundry red, reactor
    // green, temple gold, void indigo, core magenta), VFX multipliers
    // (≤2). At rest (pulse 0) every leg resolves the exact section look.
    const pulse = this.rhythmPulse;
    const impact = this.rhythmImpact.energy;
    // M9.1 overdrive: hotter pulse legs (still re-clamped in-contract;
    // smooth decays preserved, no strobe — see rhythmPulse.ts).
    const pulseBloom = pulse.beat * 0.09 + pulse.downbeat * 0.15 + impact * 0.18;
    const pulseExposure = pulse.beat * 0.045 + pulse.downbeat * 0.075 + impact * 0.09;
    const pulseEnv = pulse.beat * 0.22 + pulse.drop * 0.38 + impact * 0.45;
    this.environmentView.applyVisualState(
      s.background,
      s.fogColor,
      s.fogNear,
      s.fogFar,
      Math.min(2, Math.max(0, s.environmentIntensity + pulseEnv)),
    );
    // Section ray bed + beat/downbeat/impact ray bursts in the section
    // accent (clamped — beams stay subordinate by construction).
    const bed = Math.min(0.55, Math.max(0, (s.environmentIntensity - 1) * 0.8));
    this.environmentView.setEnergyRays(
      Math.min(1, bed + pulse.beat * 0.35 + pulse.downbeat * 0.5 + impact * 0.7),
      s.routeAccent,
    );
    this.post.setBloomParams(s.bloomStrength + pulseBloom, s.bloomRadius, s.bloomThreshold);
    this.renderer.toneMappingExposure = Math.min(2, Math.max(0.5, s.exposure + pulseExposure));
    this.vfx.setIntensity(
      Math.min(2, s.vfxIntensity * (1 + pulse.beat * 0.3 + pulse.drop * 0.45)),
      Math.min(2, s.streakIntensity * (1 + pulse.downbeat * 0.3 + impact * 0.3)),
    );
  }

  /** Live M6C2 punch envelope 0..1 (QA observability; 0 at rest/off). */
  public get eventPunchEnergy(): number {
    return combinedPunchEnergy(this.punch);
  }

  /** M9 live rhythm-beat envelope 0..1 (QA; deterministic sim-time pulse). */
  public get rhythmBeat(): number {
    return this.rhythmPulse.beat;
  }

  /** M9 live rhythm-downbeat envelope 0..1 (QA). */
  public get rhythmDownbeat(): number {
    return this.rhythmPulse.downbeat;
  }

  /** M9 live section-energy pump 0..1 (QA). */
  public get rhythmDrop(): number {
    return this.rhythmPulse.drop;
  }

  /** M9 section id resolved from deterministic music time (QA). */
  public get rhythmSection(): string {
    return this.rhythmPulse.sectionId;
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

  /** Active M9.2 checkpoint burst rings (QA leak-guard observability). */
  public get checkpointBurstsActive(): number {
    return this.checkpointView.activeBurstCount;
  }

  /**
   * M9.2 checkpoint-crystal visibility (run-mode presentation): classic
   * runs hide the gates entirely (clean classic look, zero confusion);
   * checkpoint runs show them. The simulation gate is independent —
   * this is presentation only.
   */
  public setCheckpointsVisible(visible: boolean): void {
    this.checkpointView.group.visible = visible;
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
    this.checkpointView.dispose();
    this.chomperView.dispose();
    this.platformView.dispose();
    this.playerViewInternal.dispose();
    this.deathBurst.dispose();
    this.vfx.dispose();
    this.contactPulse.releaseAll();
    this.debugView.dispose();
    this.environmentView.dispose();
    this.library.dispose();
    this.renderer.domElement.remove();
  }
}
