import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import type { GameSimulation, InteractionKind, SimulationStatus } from '../game/GameSimulation';
import type { ProductionTheme } from '../visuals/productionTheme';

/**
 * VfxSystem (M6B) — the ONE presentation-side owner for motion language and
 * gameplay juice: Cube trail, jump/landing bursts, gravity-transition
 * pulses, speed streaks + transition pulses, pad/orb activation bursts.
 *
 * Presentation ONLY: it observes simulation state/counters and render time.
 * It never writes gameplay state, never touches the 120 Hz simulation, owns
 * no replay data (replays recreate effects naturally from replayed sim
 * events), and allocates nothing per frame or per event:
 * - trail: fixed-capacity THREE.Points ring buffer,
 * - bursts: fixed-capacity THREE.Points pool (positions/velocities/colors
 *   in preallocated Float32Arrays, dead slots fade to additive-black),
 * - speed streaks: ONE InstancedMesh with a fixed instance count.
 * Exactly 3 draw calls when active, 0 when `?fx=off` (group hidden).
 *
 * Event observation (all pre-existing sim seams — no sim change):
 * - ground jumps: `notifyJump()` bridged from the existing `onJump` sim
 *   event by the Game composition root,
 * - landing: renderer-side grounded false→true edge + pre-landing velocity,
 * - gravity flips: `portalTransitionCount` edge (portals AND gravity orbs
 *   share the one transition path; a same-frame gravity-orb interaction
 *   event is deduplicated, not double-emitted),
 * - speed portals: `speedPortalCount` edge (the same-frame
 *   `speedPortal` interaction event is deduplicated),
 * - pads/orbs: `interactionEventCount` edge + `lastInteraction` anchor.
 *
 * Reset lifecycle: any attempt-identity change (`attempts` edge — covers
 * death-respawn, manual R, AND replay start since `startReplay()` respawns),
 * any status discontinuity, and any position teleport (> 5 u, same
 * threshold as the RendererHost camera snap) clears transient state so no
 * trail connects a death position to a spawn and no stale particles or
 * streak energy survive. Cumulative QA counters are NOT reset (evidence).
 *
 * Effect hierarchy (M6A contract preserved): all colors stay below the
 * bloom threshold's crisp core and all bursts are short-lived and compact —
 * particles never out-read hazards or the player.
 */

/** Minimal structural sim surface the VFX reads (GameSimulation satisfies). */
export interface VfxSimView {
  readonly status: SimulationStatus;
  readonly attempts: number;
  readonly deathId: number;
  readonly player: {
    readonly position: Readonly<{ x: number; y: number; z: number }>;
    readonly velocity: Readonly<{ x: number; y: number; z: number }>;
    readonly grounded: boolean;
  };
  readonly gameplayFrame: {
    readonly surfaceNormal: Readonly<{ x: number; y: number; z: number }>;
    readonly gravityVector: Readonly<{ x: number; y: number; z: number }>;
  };
  readonly speedMultiplier: number;
  readonly portalTransitionCount: number;
  readonly speedPortalCount: number;
  readonly interactionEventCount: number;
  readonly lastInteraction: {
    readonly kind: InteractionKind;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  /** M7.2 teleport edge + exit anchor (exit-expansion burst). */
  readonly teleportEventCount: number;
  readonly lastTeleport: Readonly<{ x: number; y: number; z: number }>;
  /** M8C mode-transition edge + current mode (semantic burst color). */
  readonly modeTransitionCount: number;
  readonly playerMode: string;
}

/** Compile-time proof that the real sim satisfies the view (no drift). */
type _SimSatisfiesView = GameSimulation extends VfxSimView ? true : false;
const _simViewCheck: _SimSatisfiesView = true;
void _simViewCheck;

/** Cumulative per-kind emission counters (QA observability; never reset). */
export interface FxCounters {
  jump: number;
  landing: number;
  gravity: number;
  speed: number;
  pad: number;
  jumpOrb: number;
  gravityOrb: number;
  teleport: number;
  /** M8C mode-transition pulses. */
  mode: number;
}

/** Teleport/clear distance — mirrors the RendererHost camera-snap edge. */
const TELEPORT_CLEAR_DISTANCE = 5;

export class VfxSystem {
  public readonly group: THREE.Group = new THREE.Group();

  private readonly theme: ProductionTheme;
  private enabled = true;
  private disposed = false;

  // --- Trail ring buffer (THREE.Points, fixed capacity) ---
  private readonly trailMax: number;
  private readonly trailPos: Float32Array;
  private readonly trailCol: Float32Array;
  private readonly trailAge: Float32Array;
  private readonly trailLife: Float32Array;
  private readonly trailBase: Float32Array; // base brightness per sample
  /** M6C2 contact flag per trail sample (1 = support-plane skid, 0 = rear ribbon). */
  private readonly trailContact: Uint8Array;
  /** M6C2 contact emission accumulator (rate-limited, speed-scaled). */
  private contactAcc = 0;
  private readonly trailGeo: THREE.BufferGeometry;
  private readonly trailMat: THREE.PointsMaterial;
  private trailCursor = 0;
  private trailEmitAcc = 0;

  // --- Burst pool (THREE.Points, fixed capacity) ---
  private readonly burstMax: number;
  private readonly burstPos: Float32Array;
  private readonly burstVel: Float32Array;
  private readonly burstCol: Float32Array;
  private readonly burstBase: Float32Array; // base color per particle
  private readonly burstAge: Float32Array;
  private readonly burstLife: Float32Array;
  private readonly burstGeo: THREE.BufferGeometry;
  private readonly burstMat: THREE.PointsMaterial;
  private burstCursor = 0;

  // --- Speed streaks (ONE InstancedMesh, fixed instances) ---
  private readonly streakMax: number;
  private readonly streaks: THREE.InstancedMesh;
  private readonly streakMat: THREE.MeshBasicMaterial;
  private readonly streakX: Float32Array;
  private readonly streakYOff: Float32Array;
  private readonly streakZ: Float32Array;
  private streakSpike = 0; // one-shot transition energy, decays fast

  // --- Deterministic-looking presentation PRNG (render-time only) ---
  private readonly rand = mulberry32(0x6b3d);

  /** M6C1 presentation multipliers (timeline-driven; pool sizes fixed). */
  private vfxLevel = 1;
  private streakLevel = 1;

  // --- Last-seen sim edges ---
  private lastAttempts = -1;
  private lastDeathId = 0;
  private lastStatus: SimulationStatus = 'running';
  private lastGrounded = true;
  private lastPortalCount = 0;
  private lastSpeedCount = 0;
  private lastEventCount = 0;
  private lastTeleportCount = 0;
  private lastModeCount = 0;
  private readonly lastRenderPos = { x: 0, y: 0, z: 0 };
  private hasRenderPos = false;
  private readonly lastAirVel = { x: 0, y: 0, z: 0 };
  private pendingJump = false;

  // --- QA observability ---
  private readonly counters: FxCounters = {
    jump: 0, landing: 0, gravity: 0, speed: 0, pad: 0, jumpOrb: 0, gravityOrb: 0, teleport: 0, mode: 0,
  };
  /** Monotonic clear counter: +1 per clearAll (attempt/death/teleport/fx-off
   *  reset). Browser QA pairs it with the attempts edge to prove the live
   *  reset path ran; buffer wipe itself is pinned headlessly (no fps). */
  private resetCount = 0;
  private lastLandingIntensity = 0;

  // --- Scratch (zero per-frame allocation) ---
  private readonly scratchColor = new THREE.Color();
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3(1, 1, 1);

  constructor(theme: ProductionTheme) {
    this.theme = theme;
    const fx = theme.fx;

    // Trail points: additive cyan samples fading to black (invisible).
    this.trailMax = Math.max(16, Math.floor(fx.trailMax));
    this.trailPos = new Float32Array(this.trailMax * 3);
    this.trailCol = new Float32Array(this.trailMax * 3);
    this.trailAge = new Float32Array(this.trailMax).fill(1);
    this.trailLife = new Float32Array(this.trailMax).fill(1);
    this.trailBase = new Float32Array(this.trailMax * 3);
    this.trailContact = new Uint8Array(this.trailMax);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailMat = new THREE.PointsMaterial({
      size: fx.trailSize,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      sizeAttenuation: true,
    });
    const trail = new THREE.Points(this.trailGeo, this.trailMat);
    trail.frustumCulled = false;
    this.group.add(trail);

    // Burst pool: additive sparks, one system for every burst kind.
    this.burstMax = Math.max(64, Math.floor(fx.burstMax));
    this.burstPos = new Float32Array(this.burstMax * 3);
    this.burstVel = new Float32Array(this.burstMax * 3);
    this.burstCol = new Float32Array(this.burstMax * 3);
    this.burstBase = new Float32Array(this.burstMax * 3);
    this.burstAge = new Float32Array(this.burstMax).fill(1);
    this.burstLife = new Float32Array(this.burstMax).fill(1);
    this.burstGeo = new THREE.BufferGeometry();
    this.burstGeo.setAttribute('position', new THREE.BufferAttribute(this.burstPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.burstGeo.setAttribute('color', new THREE.BufferAttribute(this.burstCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.burstMat = new THREE.PointsMaterial({
      size: fx.burstSize,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      sizeAttenuation: true,
    });
    const bursts = new THREE.Points(this.burstGeo, this.burstMat);
    bursts.frustumCulled = false;
    this.group.add(bursts);

    // Speed streaks: thin slivers aligned with forward motion, recycled in
    // a corridor volume around the player. ONE draw call, fixed instances.
    this.streakMax = Math.max(0, Math.floor(fx.streakMax));
    const streakGeo = new THREE.BoxGeometry(0.035, 0.035, fx.streakLength);
    this.streakMat = new THREE.MeshBasicMaterial({
      color: fx.streakColor,
      transparent: true,
      opacity: 0,
    });
    this.streaks = new THREE.InstancedMesh(streakGeo, this.streakMat, Math.max(1, this.streakMax));
    this.streaks.frustumCulled = false;
    this.streaks.count = 0;
    this.streakX = new Float32Array(Math.max(1, this.streakMax));
    this.streakYOff = new Float32Array(Math.max(1, this.streakMax));
    this.streakZ = new Float32Array(Math.max(1, this.streakMax));
    for (let i = 0; i < this.streakMax; i++) {
      this.streakX[i] = (this.rand() - 0.5) * 30;
      this.streakYOff[i] = this.rand() * 11 - 3;
      this.streakZ[i] = this.rand() * 60;
    }
    this.group.add(this.streaks);
  }

  /** Independent M6B toggle (`?fx=off`); gameplay runs identically either way. */
  public setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.clearAll();
      this.group.visible = false;
    } else {
      this.group.visible = true;
    }
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * M6C1 timeline hook: scale EXISTING presentation output only (burst
   * counts, trail density/brightness, streak count/opacity). Pool
   * capacities, lifetimes, and gameplay events are untouched; no
   * reallocation, no new draws. Clamped 0..2 (0 = calm). `?fx=off`
   * still wins (update returns early while disabled).
   */
  public setIntensity(vfx: number, streak: number): void {
    this.vfxLevel = Math.min(2, Math.max(0, vfx));
    this.streakLevel = Math.min(2, Math.max(0, streak));
  }

  /**
   * Ground-jump signal, bridged from the REAL `onJump` sim event by the
   * Game composition root. Consumed exactly once by the next update (one
   * signal = one burst; stale signals while not running are dropped).
   */
  public notifyJump(): void {
    this.pendingJump = true;
  }

  /**
   * Per rendered frame: observe sim edges, emit, integrate. `renderPos` is
   * the same interpolated cube position the PlayerView uses, so the trail
   * follows the REAL rendered cube (tumble included — points are soft).
   * Zero allocation; render-dt evolution only (freezes with presentation
   * pause because Game passes dt=0 while paused).
   */
  public update(
    renderDtSeconds: number,
    sim: VfxSimView,
    renderPos: Readonly<{ x: number; y: number; z: number }>,
  ): void {
    if (!this.enabled) {
      this.syncEdges(sim, renderPos);
      return;
    }
    const dt = Math.max(0, renderDtSeconds);

    // --- Reset lifecycle: new attempt, death, or teleport clears transients.
    const newAttempt = sim.attempts !== this.lastAttempts;
    const died = sim.deathId !== this.lastDeathId ||
      (sim.status === 'dead' && this.lastStatus !== 'dead');
    const teleported =
      this.hasRenderPos &&
      Math.abs(renderPos.x - this.lastRenderPos.x) +
        Math.abs(renderPos.y - this.lastRenderPos.y) +
        Math.abs(renderPos.z - this.lastRenderPos.z) >
        TELEPORT_CLEAR_DISTANCE;
    // M7.2 teleport exit-expansion: the discontinuity clear above would
    // otherwise consume the teleport edge before it can emit. Fire the exit
    // burst AFTER the wipe (no trail line across the gap) at the sim's
    // destination anchor.
    const teleportFired = sim.teleportEventCount !== this.lastTeleportCount;
    if (newAttempt || died || teleported) {
      this.clearAll();
      this.syncEdges(sim, renderPos);
      // (fx-off returns through the early sync branch above, so reaching
      // here implies enabled — no redundant flag check.)
      if (teleportFired && sim.status === 'running') {
        this.fireTeleportBurst(sim);
      }
      this.lastGrounded = sim.player.grounded;
      // Death still integrates one frame so in-flight sparks finish instead
      // of popping — but the trail is already gone (cleared above) and
      // streaks drop to zero (updateStreaks targets 0 unless running).
      this.updateStreaks(sim, renderPos, dt);
      this.integrateTrail(dt);
      this.integrateBursts(dt);
      this.writeBuffers();
      return;
    }

    if (sim.status === 'running') {
      this.processEdges(sim, renderPos, dt);
      this.emitTrail(sim, renderPos, dt);
      this.emitContact(sim, renderPos, dt);
    } else {
      // Dead/finished: no emission; let in-flight particles fade.
      this.pendingJump = false;
    }
    this.updateStreaks(sim, renderPos, dt);
    this.integrateTrail(dt);
    this.integrateBursts(dt);
    this.writeBuffers();
    this.syncEdges(sim, renderPos);
  }

  /** Attempt-boundary reset (R / respawn / replay start wiring converges
   *  here conceptually — all flow through the attempts edge in update). */
  public resetAttempt(): void {
    this.clearAll();
  }

  /** Kill every transient (trail, bursts, streak energy, pending jump). */
  private clearAll(): void {
    this.resetCount += 1;
    this.trailAge.fill(1);
    this.trailCol.fill(0);
    this.trailBase.fill(0);
    this.trailContact.fill(0);
    this.contactAcc = 0;
    this.trailEmitAcc = 0;
    this.burstAge.fill(1);
    this.burstCol.fill(0);
    this.burstBase.fill(0);
    this.streakSpike = 0;
    this.pendingJump = false;
  }

  /** M7.2 exit-expansion burst at the destination anchor (violet energy). */
  private fireTeleportBurst(sim: VfxSimView): void {
    const fx = this.theme.fx;
    const anchor = { x: sim.lastTeleport.x, y: sim.lastTeleport.y, z: sim.lastTeleport.z };
    this.spawnBurst(anchor, fx.teleportCount, fx.teleportColor, 7, fx.teleportLife, 0, 0, 1, 1.6, 0.6);
    this.streakSpike = Math.max(this.streakSpike, 0.5);
    this.counters.teleport += 1;
  }

  private syncEdges(sim: VfxSimView, renderPos: Readonly<{ x: number; y: number; z: number }>): void {
    this.lastAttempts = sim.attempts;
    this.lastDeathId = sim.deathId;
    this.lastStatus = sim.status;
    this.lastPortalCount = sim.portalTransitionCount;
    this.lastSpeedCount = sim.speedPortalCount;
    this.lastEventCount = sim.interactionEventCount;
    this.lastTeleportCount = sim.teleportEventCount;
    this.lastModeCount = sim.modeTransitionCount;
    this.lastRenderPos.x = renderPos.x;
    this.lastRenderPos.y = renderPos.y;
    this.lastRenderPos.z = renderPos.z;
    this.hasRenderPos = true;
  }

  private processEdges(
    sim: VfxSimView,
    renderPos: Readonly<{ x: number; y: number; z: number }>,
    dt: number,
  ): void {
    const fx = this.theme.fx;
    const n = sim.gameplayFrame.surfaceNormal;
    void dt;

    // Ground jump: exactly one burst per real onJump signal.
    if (this.pendingJump) {
      this.pendingJump = false;
      this.spawnBurst(
        renderPos, fx.jumpCount, fx.jumpColor, fx.jumpSpeed, fx.jumpLife,
        n.x, n.y, n.z, 1.6, 0.45,
      );
      this.counters.jump += 1;
    }

    // Landing: grounded false→true edge, intensity from pre-landing
    // along-gravity speed (capped — no terminal-speed explosion).
    if (!sim.player.grounded) {
      this.lastAirVel.x = sim.player.velocity.x;
      this.lastAirVel.y = sim.player.velocity.y;
      this.lastAirVel.z = sim.player.velocity.z;
    } else if (!this.lastGrounded) {
      const g = sim.gameplayFrame.gravityVector;
      const impact =
        this.lastAirVel.x * g.x + this.lastAirVel.y * g.y + this.lastAirVel.z * g.z;
      const intensity = Math.min(1, Math.max(0.25, impact / 22));
      this.lastLandingIntensity = intensity;
      const count = Math.round(fx.landingBase + (fx.landingMax - fx.landingBase) * intensity);
      this.spawnLandingDisk(renderPos, n, count, fx.landingColor, fx.landingLife, intensity);
      this.counters.landing += 1;
    }
    this.lastGrounded = sim.player.grounded;

    // Gravity flip: one spatial pulse along the NEW surface normal
    // (mirrors naturally via frame data — no ceiling magic constant).
    const gravityFired = sim.portalTransitionCount !== this.lastPortalCount;
    if (gravityFired) {
      this.spawnBurst(
        renderPos, fx.gravityCount, fx.gravityColor, fx.gravitySpeed, fx.gravityLife,
        n.x, n.y, n.z, 0.9, 0.7,
      );
      // M6C2: flips also kick environment streak energy (no new system).
      this.streakSpike = Math.max(this.streakSpike, 0.7);
      this.counters.gravity += 1;
    }

    // Speed portal: tier-colored pulse + streak energy spike.
    if (sim.speedPortalCount !== this.lastSpeedCount) {
      const tierColor = this.theme.speedTierColors[String(sim.speedMultiplier)] ?? 0xffffff;
      this.spawnBurst(
        renderPos, fx.speedCount, tierColor, 6, fx.speedLife,
        0, 0, 1, 1.4, 0.6,
      );
      this.streakSpike = 1;
      this.counters.speed += 1;
    }

    // Teleport exit-expansion for short hops that never trip the
    // discontinuity clear above (long jumps are handled at the clear edge
    // so the burst fires after the wipe, never before it).
    if (sim.teleportEventCount !== this.lastTeleportCount) {
      this.fireTeleportBurst(sim);
    }

    // M8C mode transition: one semantic-color pulse at the player (ship
    // sky-cyan, spider mint-green, cube white) + a streak kick.
    if (sim.modeTransitionCount !== this.lastModeCount) {
      const modeColor =
        sim.playerMode === 'ship' ? 0x4fd8ff : sim.playerMode === 'spider' ? 0x5dff9d : 0xffffff;
      this.spawnBurst(
        renderPos, fx.gravityCount, modeColor, fx.gravitySpeed, fx.gravityLife,
        n.x, n.y, n.z, 0.9, 0.7,
      );
      this.streakSpike = Math.max(this.streakSpike, 0.7);
      this.counters.mode += 1;
    }

    // Pad/orb activations from the sim's interaction edge. Same-frame
    // speedPortal/gravityOrb-flip events are deduplicated (their dedicated
    // pulses above already fired) — never two bursts for one activation.
    const events = sim.interactionEventCount - this.lastEventCount;
    if (events > 0) {
      const kind: InteractionKind = sim.lastInteraction.kind;
      const anchor = { x: sim.lastInteraction.x, y: sim.lastInteraction.y, z: sim.lastInteraction.z };
      const shots = Math.min(events, 4);
      for (let i = 0; i < shots; i++) {
        if (kind === 'pad') {
          this.spawnBurst(anchor, fx.padCount, fx.padColor, 6.5, fx.padLife, n.x, n.y, n.z, 1.8, 0.5);
          // M6C2: pad launches kick a small streak surge (launch energy).
          this.streakSpike = Math.max(this.streakSpike, 0.35);
          this.counters.pad += 1;
        } else if (kind === 'jumpOrb') {
          this.spawnBurst(anchor, fx.orbCount, fx.orbColor, 5, fx.orbLife, n.x, n.y, n.z, 0.6, 0.75);
          this.counters.jumpOrb += 1;
        } else if (kind === 'gravityOrb') {
          if (!gravityFired) {
            this.spawnBurst(anchor, fx.orbCount, fx.gravityColor, 5.5, fx.orbLife, n.x, n.y, n.z, 0.9, 0.7);
            this.counters.gravityOrb += 1;
          }
        }
        // kind 'speedPortal': covered by the speed edge above — skip.
      }
    }
  }

  /**
   * Cube trail: speed-scaled lifetime + emission density, cyan family.
   * Samples spawn at the cube's REAR face (0.7 behind center — just outside
   * the 1.24 visual cube), never at the exact center: center-spawned points
   * sit inside the opaque mesh and die to the depth test. Forward is +Z on
   * every gravity surface, so this is surface-agnostic (no ceiling hack).
   */
  private emitTrail(
    sim: VfxSimView,
    renderPos: Readonly<{ x: number; y: number; z: number }>,
    dt: number,
  ): void {
    const fx = this.theme.fx;
    if (this.vfxLevel <= 0.01) return; // timeline calm: no emission
    const speed = sim.speedMultiplier;
    const lifeScale = Math.min(1.7, Math.max(0.7, 0.75 + 0.3 * speed));
    const density = Math.max(0.3, this.vfxLevel);
    const interval = (fx.trailEmitInterval * Math.min(1.3, Math.max(0.7, 1.4 - 0.15 * speed))) / density;
    this.trailEmitAcc += dt;
    let guard = 8; // at most a few samples per frame, never a flood
    while (this.trailEmitAcc >= interval && guard > 0) {
      this.trailEmitAcc -= interval;
      guard -= 1;
      const i = this.trailCursor;
      this.trailCursor = (this.trailCursor + 1) % this.trailMax;
      this.trailContact[i] = 0; // rear-ribbon sample (not contact skid)
      this.trailPos[i * 3] = renderPos.x;
      this.trailPos[i * 3 + 1] = renderPos.y;
      this.trailPos[i * 3 + 2] = renderPos.z - 0.7; // rear-face spawn
      this.trailAge[i] = 0;
      this.trailLife[i] = fx.trailLifetime1x * lifeScale;
      const brightness = Math.min(1.3, 1 + 0.1 * speed) * Math.min(1.2, this.vfxLevel);
      this.scratchColor.setHex(fx.trailColor).multiplyScalar(brightness);
      this.trailBase[i * 3] = this.scratchColor.r;
      this.trailBase[i * 3 + 1] = this.scratchColor.g;
      this.trailBase[i * 3 + 2] = this.scratchColor.b;
    }
    if (this.trailEmitAcc > interval * 8) this.trailEmitAcc = 0; // stall guard
  }

  /**
   * M6C2 surface-contact FX: while grounded and running, the cube drags a
   * faint skid/splash along the CURRENT support plane — the "contact
   * language" the rear trail alone never provided. Samples spawn on the
   * contact side (surface-normal-relative, so Floor and Ceiling mirror
   * naturally), jittered in-plane, static in world space so the cube
   * visibly carves past them. Pale ice family (landing-dust relative),
   * dimmer and shorter-lived than the trail ribbon — subordinate by design.
   *
   * Shares the trail point buffer (one draw call, zero new resources):
   * contact samples are flagged in `trailContact` for QA. Rate-scaled by
   * speed tier, calmed by the timeline `vfxLevel`, silent while airborne,
   * dead, finished, or `?fx=off`. Attempt/death/teleport clears ride the
   * existing clearAll path (no stale skid lines across respawns).
   */
  private emitContact(
    sim: VfxSimView,
    renderPos: Readonly<{ x: number; y: number; z: number }>,
    dt: number,
  ): void {
    const fx = this.theme.fx;
    if (this.vfxLevel <= 0.01 || !sim.player.grounded) {
      this.contactAcc = 0;
      return;
    }
    const speed = sim.speedMultiplier;
    const rate = Math.min(1.5, Math.max(0.6, 0.7 + 0.2 * speed)) * Math.max(0.3, this.vfxLevel);
    const interval = 0.06 / rate;
    this.contactAcc += dt;
    let guard = 4; // never a flood: at most a few skid samples per frame
    const n = sim.gameplayFrame.surfaceNormal;
    while (this.contactAcc >= interval && guard > 0) {
      this.contactAcc -= interval;
      guard -= 1;
      const i = this.trailCursor;
      this.trailCursor = (this.trailCursor + 1) % this.trailMax;
      this.trailContact[i] = 1;
      // Contact-side spawn (just outside the visual cube on the support
      // side) with in-plane jitter; slight normal lift so samples sit in
      // the surface light instead of inside the slab.
      this.trailPos[i * 3] = renderPos.x - n.x * 0.62 + (this.rand() - 0.5) * 0.9;
      this.trailPos[i * 3 + 1] = renderPos.y - n.y * 0.62 + (this.rand() - 0.5) * 0.2;
      this.trailPos[i * 3 + 2] = renderPos.z - n.z * 0.62 - 0.2 + (this.rand() - 0.5) * 1.2;
      this.trailAge[i] = 0;
      this.trailLife[i] = fx.trailLifetime1x * 0.8;
      this.scratchColor.setHex(fx.landingColor).multiplyScalar(0.65 * Math.min(1.2, this.vfxLevel));
      this.trailBase[i * 3] = this.scratchColor.r;
      this.trailBase[i * 3 + 1] = this.scratchColor.g;
      this.trailBase[i * 3 + 2] = this.scratchColor.b;
    }
    if (this.contactAcc > interval * 4) this.contactAcc = 0; // stall guard
  }

  private integrateTrail(dt: number): void {
    for (let i = 0; i < this.trailMax; i++) {
      const life = this.trailLife[i] ?? 1;
      const prevAge = this.trailAge[i] ?? life;
      if (prevAge >= life) continue;
      const age = prevAge + dt;
      this.trailAge[i] = age;
      const t = Math.min(1, age / life);
      const fade = 1 - t;
      this.trailCol[i * 3] = (this.trailBase[i * 3] ?? 0) * fade;
      this.trailCol[i * 3 + 1] = (this.trailBase[i * 3 + 1] ?? 0) * fade;
      this.trailCol[i * 3 + 2] = (this.trailBase[i * 3 + 2] ?? 0) * fade;
    }
  }

  /**
   * Generic directional burst: random sphere + bias vector (surface-relative
   * callers pass the frame normal, so Floor/Ceiling mirror naturally).
   * Particles spawn on a 0.7 shell around the origin (just outside the
   * visual cube) so the first frames are never depth-culled inside the mesh.
   */
  private spawnBurst(
    origin: Readonly<{ x: number; y: number; z: number }>,
    count: number,
    colorHex: number,
    speed: number,
    life: number,
    biasX: number,
    biasY: number,
    biasZ: number,
    biasStrength: number,
    spread: number,
  ): void {
    // M6C1: timeline scales output volume (event counters still fire —
    // the gameplay event happened; only its visual answer is calmed).
    const scaled = Math.round(count * this.vfxLevel);
    if (scaled <= 0) return;
    count = scaled;
    this.scratchColor.setHex(colorHex);
    for (let k = 0; k < count; k++) {
      const i = this.burstCursor;
      this.burstCursor = (this.burstCursor + 1) % this.burstMax;
      // Random unit direction (presentation PRNG — visual only).
      const theta = this.rand() * Math.PI * 2;
      const z = this.rand() * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      let dx = r * Math.cos(theta) * spread + biasX * biasStrength;
      let dy = r * Math.sin(theta) * spread + biasY * biasStrength;
      let dz = z * spread + biasZ * biasStrength;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      // Shell spawn: outside the mesh from birth (depth-test visible).
      this.burstPos[i * 3] = origin.x + (dx / len) * 0.7;
      this.burstPos[i * 3 + 1] = origin.y + (dy / len) * 0.7;
      this.burstPos[i * 3 + 2] = origin.z + (dz / len) * 0.7;
      const s = (speed * (0.6 + this.rand() * 0.8)) / len;
      dx *= s;
      dy *= s;
      dz *= s;
      this.burstVel[i * 3] = dx;
      this.burstVel[i * 3 + 1] = dy;
      this.burstVel[i * 3 + 2] = dz;
      this.burstAge[i] = 0;
      this.burstLife[i] = life * (0.8 + this.rand() * 0.4);
      const shade = 0.85 + this.rand() * 0.25;
      this.burstBase[i * 3] = this.scratchColor.r * shade;
      this.burstBase[i * 3 + 1] = this.scratchColor.g * shade;
      this.burstBase[i * 3 + 2] = this.scratchColor.b * shade;
    }
  }

  /** Landing disk: radial spray inside the support plane + slight lift. */
  private spawnLandingDisk(
    origin: Readonly<{ x: number; y: number; z: number }>,
    normal: Readonly<{ x: number; y: number; z: number }>,
    count: number,
    colorHex: number,
    life: number,
    intensity: number,
  ): void {
    const scaled = Math.round(count * this.vfxLevel);
    if (scaled <= 0) return;
    count = scaled;
    this.scratchColor.setHex(colorHex);
    const speed = 3 + 4 * intensity;
    for (let k = 0; k < count; k++) {
      const i = this.burstCursor;
      this.burstCursor = (this.burstCursor + 1) % this.burstMax;
      const theta = this.rand() * Math.PI * 2;
      let dx = Math.cos(theta);
      let dy = (this.rand() - 0.5) * 0.6;
      let dz = Math.sin(theta);
      // Project out the surface-normal component: spray stays in-plane.
      const dot = dx * normal.x + dy * normal.y + dz * normal.z;
      dx -= normal.x * dot;
      dy -= normal.y * dot;
      dz -= normal.z * dot;
      let len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 0.001) {
        dx = 1;
        dy = 0;
        dz = 0;
        len = 1;
      }
      const s = (speed * (0.7 + this.rand() * 0.6)) / len;
      // Shell spawn (see spawnBurst): visible from the first frame.
      this.burstPos[i * 3] = origin.x + (dx / len) * 0.7;
      this.burstPos[i * 3 + 1] = origin.y + (dy / len) * 0.7;
      this.burstPos[i * 3 + 2] = origin.z + (dz / len) * 0.7;
      this.burstVel[i * 3] = dx * s + normal.x * 1.2;
      this.burstVel[i * 3 + 1] = dy * s + normal.y * 1.2;
      this.burstVel[i * 3 + 2] = dz * s + normal.z * 1.2;
      this.burstAge[i] = 0;
      this.burstLife[i] = life * (0.8 + this.rand() * 0.4);
      const shade = 0.8 + this.rand() * 0.3;
      this.burstBase[i * 3] = this.scratchColor.r * shade;
      this.burstBase[i * 3 + 1] = this.scratchColor.g * shade;
      this.burstBase[i * 3 + 2] = this.scratchColor.b * shade;
    }
  }

  private integrateBursts(dt: number): void {
    const drag = Math.max(0, 1 - 2 * dt);
    for (let i = 0; i < this.burstMax; i++) {
      const life = this.burstLife[i] ?? 1;
      const prevAge = this.burstAge[i] ?? life;
      if (prevAge >= life) continue;
      const age = prevAge + dt;
      this.burstAge[i] = age;
      const t = Math.min(1, age / life);
      const fade = 1 - t;
      const vx = (this.burstVel[i * 3] ?? 0) * drag;
      const vy = (this.burstVel[i * 3 + 1] ?? 0) * drag;
      const vz = (this.burstVel[i * 3 + 2] ?? 0) * drag;
      this.burstVel[i * 3] = vx;
      this.burstVel[i * 3 + 1] = vy;
      this.burstVel[i * 3 + 2] = vz;
      this.burstPos[i * 3] = (this.burstPos[i * 3] ?? 0) + vx * dt;
      this.burstPos[i * 3 + 1] = (this.burstPos[i * 3 + 1] ?? 0) + vy * dt;
      this.burstPos[i * 3 + 2] = (this.burstPos[i * 3 + 2] ?? 0) + vz * dt;
      this.burstCol[i * 3] = (this.burstBase[i * 3] ?? 0) * fade;
      this.burstCol[i * 3 + 1] = (this.burstBase[i * 3 + 1] ?? 0) * fade;
      this.burstCol[i * 3 + 2] = (this.burstBase[i * 3 + 2] ?? 0) * fade;
    }
  }

  /** Speed streaks: instance count + opacity follow the speed tier; the
   *  transition spike adds a brief surge. Nearly absent at 1x by design. */
  private updateStreaks(
    sim: VfxSimView,
    renderPos: Readonly<{ x: number; y: number; z: number }>,
    dt: number,
  ): void {
    if (this.streakMax === 0) return;
    this.streakSpike *= Math.exp(-dt * 4);
    if (this.streakSpike < 0.01) this.streakSpike = 0;
    const speed = sim.speedMultiplier;
    const baseActive = sim.status === 'running'
      ? Math.min(this.streakMax, Math.max(0, Math.round((this.streakMax * (speed - 1)) / 3)))
      : 0;
    // M6C1: timeline scales streak presence (pool size fixed).
    const active = Math.round(baseActive * this.streakLevel);
    for (let i = 0; i < this.streakMax; i++) {
      let sz = this.streakZ[i] ?? renderPos.z;
      if (sz < renderPos.z - 8) {
        sz = renderPos.z + 25 + this.rand() * 45;
        this.streakZ[i] = sz;
        this.streakX[i] = (this.rand() - 0.5) * 30;
        this.streakYOff[i] = this.rand() * 11 - 3;
      }
      this.scratchPos.set(
        renderPos.x + (this.streakX[i] ?? 0),
        renderPos.y + (this.streakYOff[i] ?? 0),
        sz,
      );
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      this.streaks.setMatrixAt(i, this.scratchMatrix);
    }
    this.streaks.instanceMatrix.needsUpdate = true;
    this.streaks.count = active;
    const tierGlow = Math.min(1, Math.max(0, speed - 1)) / 3;
    this.streakMat.opacity =
      Math.min(0.85, tierGlow * 0.5 + this.streakSpike * 0.4) * Math.min(1.2, this.streakLevel);
  }

  private writeBuffers(): void {
    (this.trailGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.trailGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.burstGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.burstGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Live burst particles (QA boundedness observability). */
  public get activeParticles(): number {
    let n = 0;
    for (let i = 0; i < this.burstMax; i++) {
      if ((this.burstAge[i] ?? 1) < (this.burstLife[i] ?? 1)) n += 1;
    }
    return n;
  }

  /** Live contact-skid samples (subset of trailSamples, QA observability). */
  public get contactSamples(): number {
    let n = 0;
    for (let i = 0; i < this.trailMax; i++) {
      if (this.trailContact[i] === 1 && (this.trailAge[i] ?? 1) < (this.trailLife[i] ?? 1)) n += 1;
    }
    return n;
  }

  /** Live trail samples (QA boundedness observability). */
  public get trailSamples(): number {
    let n = 0;
    for (let i = 0; i < this.trailMax; i++) {
      if ((this.trailAge[i] ?? 1) < (this.trailLife[i] ?? 1)) n += 1;
    }
    return n;
  }

  /** Visible streak instances (QA observability). */
  public get activeStreaks(): number {
    return this.streaks.count;
  }

  /** Cumulative emission counters (fresh object; cold QA path only). */
  public get countersSnapshot(): FxCounters {
    return { ...this.counters };
  }

  /** Monotonic transient-reset count (QA observability). */
  public get resetCountValue(): number {
    return this.resetCount;
  }

  /** Last landing intensity 0..1 (impact scaling observability). */
  public get lastLandingIntensityValue(): number {
    return this.lastLandingIntensity;
  }

  public get burstCapacity(): number {
    return this.burstMax;
  }

  public get trailCapacity(): number {
    return this.trailMax;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.trailGeo.dispose();
    this.trailMat.dispose();
    this.burstGeo.dispose();
    this.burstMat.dispose();
    this.streaks.geometry.dispose();
    this.streakMat.dispose();
    this.group.clear();
  }
}
