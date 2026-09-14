import type { PhysicalInputSnapshot } from '../input/InputSystem';
import { interpretPhysicalInput, makeIdlePhysicalSnapshot } from '../input/InputSystem';
import type { Vec3 } from '../core/math';
import { vec3, copyVec3 } from '../core/math';
import { SIMULATION_DT } from '../core/constants';
import { CUBE_TUNING } from '../player/cubeTuning';
import { laneCenterForIndex } from '../player/laneKinematics';
import { CubeController, type CubeControllerStepContext } from '../player/CubeController';
import { ShipController, type ShipControllerStepContext } from '../player/ShipController';
import { SpiderController, type SpiderControllerStepContext } from '../player/SpiderController';
import { SHIP_TUNING } from '../player/shipTuning';
import { GameplayFrame } from '../player/gameplayFrame';
import type { GravityMode, PlayerMode } from '../player/playerState';
import {
  createPlayerState,
  resetPlayerState,
  type PlayerState,
} from '../player/playerState';
import { moveAabbThroughWorld, createMoveResult, probeGroundSupport } from '../collision/moveAabb';
import {
  aabbOverlap,
  colliderToAabb,
  createSweptPathScratch,
  sweptPathOverlaps,
  sweptSegmentAabb,
  type Aabb,
  type Collider,
} from '../collision/collider';
import { loadLevel, computeProgress } from '../level/levelRuntime';
import type { LoadedLevel } from '../level/levelRuntime';
import type { LevelDefinition, TeleportPortalDef } from '../level/levelDefinition';
import {
  createChomperState,
  resetChomperState,
  stepChomper,
  type ChomperState,
} from './chomperSystem';

/**
 * Headless gameplay orchestration: the ENTIRE game simulates here.
 * No THREE, no DOM, no renderer. The rendering layer reads this state and
 * interpolates visual transforms between previous and current positions.
 *
 * Per fixed step (authoritative M4 order):
 *   1. controller step (gravity-relative input interpretation -> velocities;
 *      forward speed = level base × authoritative speed multiplier)
 *   2. integrate + collide via axis-separated swept movement (Y -> Z -> X)
 *   3. frontal-kill check (death returns immediately)
 *   4. grounding resolution (support probe along gravity + velocity cleanup)
 *   5. lethal checks: void bounds then exact swept-path hazard CCD
 *      (death returns immediately — LETHAL CHECKS PRECEDE ALL PORTAL AND
 *      INTERACTION MUTATIONS: nothing later in the step can rescue or
 *      mutate a dead step; a killing step can never also mutate
 *      gravityMode / portalTransitionCount / lastPortalId — they stay
 *      pre-step, per the M3.3 closeout contract)
 *   6. teleport portals (M7.2, entry-plane crossing, one-shot per attempt):
 *      a spatial discontinuity — the skipped interval is never traversed,
 *      so no interval portal fires; prevPosition is re-anchored at the
 *      exit so the remaining steps below only see destination overlap.
 *   7. passive interactions: jump pads (swept contact, one-shot per attempt)
 *   8. active interactions: jump orbs then gravity orbs (press edge inside
 *      the swept activation window, one-shot per attempt)
 *   9. speed portal crossings (ascending Z) -> speed multiplier mutation
 *  10. gravity portal crossings (ascending Z) -> gravity transition
 *  11. finish detection
 * Death at any earlier point wins the step.
 */
export type SimulationStatus = 'running' | 'dead' | 'finished';

/** Why the current (or most recent) death happened. Manual restart is NOT death. */
export type DeathCause = 'hazard' | 'frontImpact' | 'void' | 'lava';

/** Kind of the most recent interaction activation (debug/QA/VFX routing). */
export type InteractionKind = 'pad' | 'jumpOrb' | 'gravityOrb' | 'speedPortal';

/** Stable record of the most recent interaction activation (VFX anchor). */
export interface InteractionEvent {
  kind: InteractionKind;
  id: string;
  /** World-space position of the interaction (its definition center). */
  x: number;
  y: number;
  z: number;
}

export interface SimulationEvents {
  onDeath?: () => void;
  onFinish?: () => void;
  /** Fired whenever a new jump is initiated (hook for future VFX/audio). */
  onJump?: () => void;
}

/**
 * Exact hold duration in fixed simulation ticks (single timing authority).
 * M8A: 78 ticks = 0.65 s — the M2 0.30 s hold respawned before the burst
 * was readable. The longer linger keeps the arcade-fast restart feel while
 * the stronger explosion (see DeathBurstView) stays on screen.
 */
export const DEATH_HOLD_TICKS = 78;
/** How long (sim seconds) the dead status holds before auto-respawn eligibility.
 *  Derived from the tick authority (78/120 = 0.65 s) so the two can never drift. */
export const DEATH_HOLD_SECONDS = DEATH_HOLD_TICKS * SIMULATION_DT;
/** Vertical probe distance for the grounded support check (contact-tight). */
const SUPPORT_PROBE_DISTANCE = 0.03;
/** Max speed along gravity (toward surface) that still counts as "resting". */
const REST_SPEED_EPSILON = 0.05;
/** Max spider opposite-surface snap distance (world units, along gravity). */
const SPIDER_SNAP_MAX_DISTANCE = 14;

/** Prebuilt frames per gravity mode — never allocated per step. */
const FRAME_FLOOR = GameplayFrame.floor();
const FRAME_CEILING = GameplayFrame.ceiling();
const FRAME_LEFT_WALL = GameplayFrame.leftWall();
const FRAME_RIGHT_WALL = GameplayFrame.rightWall();

/** Surface normal for a mounted pad (impulse direction, away from support). */
const MOUNT_NORMALS = {
  floor: { x: 0, y: 1, z: 0 },
  ceiling: { x: 0, y: -1, z: 0 },
  leftWall: { x: -1, y: 0, z: 0 },
  rightWall: { x: 1, y: 0, z: 0 },
} as const;

/** Opposite support surface (gravity-orb flip contract, M8B). */
const oppositeGravityMode = (mode: GravityMode): GravityMode => {
  switch (mode) {
    case 'floor':
      return 'ceiling';
    case 'ceiling':
      return 'floor';
    case 'leftWall':
      return 'rightWall';
    case 'rightWall':
      return 'leftWall';
  }
};

export class GameSimulation {
  public readonly level: LoadedLevel;
  private readonly def: LevelDefinition;
  public readonly player: PlayerState;
  private readonly controller: CubeController;
  private readonly shipController: ShipController;
  private readonly spiderController: SpiderController;
  private readonly moveResult = createMoveResult();
  private readonly events: SimulationEvents;

  /** Previous-step position for render interpolation. */
  public readonly prevPosition: Vec3;

  public status: SimulationStatus = 'running';
  public attempts = 1;
  /**
   * AUTHORITATIVE current gravity mode (M3). The controller frame, support
   * probing, void bounds and input interpretation all derive from this.
   * `player.gravityMode` mirrors it for observers; never write there directly.
   */
  private gravityModeValue: GravityMode;
  /**
   * AUTHORITATIVE current player mode (M8C). Rendering observes;
   * `player.playerMode` mirrors it. Attempts always start in `cube`.
   */
  private modeValue: PlayerMode = 'cube';
  /** True while Ship thrust is applied this step (renderer flame edge). */
  public shipThrusting = false;
  /** Id of the most recent gravity portal crossed THIS attempt (debug/QA). */
  public lastPortalId: string | null = null;
  /** Monotonic count of actual gravity transitions (debug/QA leak/toggle guard). */
  public portalTransitionCount = 0;
  /**
   * AUTHORITATIVE current speed multiplier (M4). The per-step forward speed
   * is `def.baseForwardSpeed * speedMultiplier`; the controller consumes it
   * via the step context and never owns speed policy. Reset to the level's
   * `startSpeedMultiplier` by respawn().
   */
  private speedMultiplierValue: number;
  /** Id of the most recent speed portal crossed THIS attempt (debug/QA). */
  public lastSpeedPortalId: string | null = null;
  /**
   * One-shot lifecycle state: interaction ids already activated this attempt.
   * Pre-allocated once; cleared (never reallocated) by respawn().
   */
  private readonly usedInteractions = new Set<string>();
  /** Monotonic count of interaction activations this session (VFX edge). */
  public interactionEventCount = 0;
  /** Per-kind activation counters (session-monotonic, debug/QA). */
  public padActivationCount = 0;
  public orbActivationCount = 0;
  public speedPortalCount = 0;
  /** Id of the most recent interaction activation THIS attempt (debug/QA). */
  public lastInteractionId: string | null = null;
  /**
   * One-shot teleport lifecycle state (M7.2): portal ids already consumed
   * this attempt. Pre-allocated once; cleared (never reallocated) by
   * respawn().
   */
  private readonly usedTeleports = new Set<string>();
  /**
   * One-shot mode-portal lifecycle state (M8C): portal ids already
   * consumed this attempt. Pre-allocated once; cleared by respawn().
   */
  private readonly usedModePortals = new Set<string>();
  /** Monotonic count of mode transitions this session (VFX edge). */
  public modeTransitionCount = 0;
  /** Id of the most recent mode portal crossed THIS attempt (debug/QA). */
  public lastModePortalId: string | null = null;
  /**
   * Deterministic dynamic-chomper states (M8D), parallel to
   * `level.chompers` (sorted by triggerZ). Preallocated at construction;
   * `respawn()` resets every entry to dormant. Empty for levels without
   * chompers (zero behavior change, zero fingerprint bytes).
   */
  public readonly chomperStates: ChomperState[] = [];
  /** Previous-step chomper centers (swept lethal test scratch). */
  private readonly chomperPrev: { x: number; y: number; z: number }[] = [];
  /** Monotonic count of teleport activations this session (VFX/punch edge). */
  public teleportEventCount = 0;
  /** Id of the most recent teleport activation THIS attempt (debug/QA). */
  public lastTeleportId: string | null = null;
  /** Exit anchor of the most recent teleport (VFX anchor, world space). */
  public readonly lastTeleport: Vec3 = vec3();
  /** True once a teleport has fired at least once this session. */
  public hasTeleportEvent = false;
  /** Stable record of the most recent interaction activation (VFX anchor). */
  public readonly lastInteraction: InteractionEvent = { kind: 'pad', id: '', x: 0, y: 0, z: 0 };
  /** True once the most recent interaction record has been written at least once. */
  public hasInteractionEvent = false;
  /** Simulated seconds since the current run started. */
  public elapsedSimTime = 0;
  /** Fixed-step ticks left while dead; respawn allowed when it hits 0 (or on key press).
   *  Integer authority for restart timing (float seconds would drift over 78 ticks). */
  public deathHoldTicksLeft = 0;
  /** Cause of the current death; null while running (manual restart is NOT death). */
  public deathCause: DeathCause | null = null;
  /** Stable record of the most recent death (never cleared by respawn):
   *  powers the timing-proof F1 last-death readout and future analytics. */
  public lastDeathCause: DeathCause | null = null;
  /** Lethal collider of the most recent death (stable record, see above). */
  public lastDeathLethalId: string | null = null;
  /** Monotonic death counter; rendering observes changes to trigger one-shot VFX. */
  public deathId = 0;
  /** Lethal collider id for the current death (debug/QA). */
  public lastLethalColliderId: string | null = null;
  /** World-space center where the most recent death occurred (debug/QA/VFX
   *  anchor; set on every death, kept as a stable record — not cleared by
   *  respawn so render-side one-shot effects can anchor to it). */
  public readonly deathPosition: Vec3 = vec3();
  /** Contact normal of the lethal impact, pointing away from the surface (debug/QA). */
  public readonly lastContactNormal: Vec3 = vec3();
  /** Pre-impact player velocity at the lethal step (debug/QA). */
  public readonly lastPreImpactVelocity: Vec3 = vec3();

  private readonly laneCenters: readonly number[];
  private readonly stepContext: CubeControllerStepContext = {
    laneCenters: [],
    dt: SIMULATION_DT,
    jumpedThisStep: false,
    forwardSpeed: 0,
  };
  private readonly shipStepContext: ShipControllerStepContext = {
    laneCenters: [],
    dt: SIMULATION_DT,
    forwardSpeed: 0,
    thrustingThisStep: false,
  };
  private readonly spiderStepContext: SpiderControllerStepContext = {
    laneCenters: [],
    dt: SIMULATION_DT,
    forwardSpeed: 0,
  };
  /** Scratch: full-step displacement passed to collision. Reused, never realloc'd. */
  private readonly stepDelta: Vec3 = vec3();
  /** Scratch: cached half extents. */
  private readonly halfExtentsVec: Vec3 = vec3();
  /** Scratch: pre-move velocity snapshot for the frontal-approach + debug record. */
  private readonly preMoveVelocity: Vec3 = vec3();

  private hazardScratch: Collider[] = [];
  /** Scratch swept-segment boxes for the exact hazard path test. Reused. */
  private readonly sweptPathScratch = createSweptPathScratch();
  /** Scratch AABB for M4 interaction window tests. Reused (hot loop). */
  private readonly interactionBoxScratch = {
    minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0,
  };
  /** Scratch destination + swept box for spider snaps (press-edge only). */
  private readonly snapDest: Vec3 = vec3();
  private readonly snapSwept: Aabb = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  private readonly snapTransit: Collider[] = [];

  constructor(levelDef: LevelDefinition, events: SimulationEvents = {}) {
    this.def = levelDef;
    this.level = loadLevel(levelDef);
    this.gravityModeValue = this.level.startGravityMode;
    this.speedMultiplierValue = this.level.startSpeedMultiplier;
    this.player = createPlayerState({
      position: levelDef.start,
      laneIndex: levelDef.startLaneIndex,
      laneCount: levelDef.laneCenters.length,
      gravityMode: this.level.startGravityMode,
    });
    this.controller = new CubeController(CUBE_TUNING);
    this.shipController = new ShipController(SHIP_TUNING);
    this.spiderController = new SpiderController();
    for (const c of this.level.chompers) {
      this.chomperStates.push(createChomperState(c));
      this.chomperPrev.push({ x: c.dormant.x, y: c.dormant.y, z: c.dormant.z });
    }
    this.prevPosition = vec3(levelDef.start.x, levelDef.start.y, levelDef.start.z);
    this.events = events;
    this.laneCenters = levelDef.laneCenters;
    const s = CUBE_TUNING.colliderSize / 2;
    this.halfExtentsVec.x = s;
    this.halfExtentsVec.y = s;
    this.halfExtentsVec.z = s;
  }

  public get halfExtents(): Readonly<Vec3> {
    return this.halfExtentsVec;
  }

  /** Current authoritative gravity mode. */
  public get gravityMode(): GravityMode {
    return this.gravityModeValue;
  }

  /** Current authoritative player mode (M8C). */
  public get playerMode(): PlayerMode {
    return this.modeValue;
  }

  /** Whether a mode portal id has already fired this attempt. */
  public isModePortalUsed(id: string): boolean {
    return this.usedModePortals.has(id);
  }

  /** Gameplay frame for the current gravity mode (prebuilt, read-only). */
  public get gameplayFrame(): Readonly<GameplayFrame> {
    switch (this.gravityModeValue) {
      case 'ceiling':
        return FRAME_CEILING;
      case 'leftWall':
        return FRAME_LEFT_WALL;
      case 'rightWall':
        return FRAME_RIGHT_WALL;
      default:
        return FRAME_FLOOR;
    }
  }

  /**
   * Lane centers for the CURRENT gravity mode (M8B): Floor/Ceiling run
   * the level's X lane layout; walls run the Y wall-lane layout (explicit
   * `wallLaneCenters`, else the corridor-mid mirror resolved at load).
   */
  public get activeLaneCenters(): readonly number[] {
    const mode = this.gravityModeValue;
    return mode === 'leftWall' || mode === 'rightWall'
      ? this.level.wallLaneCenters
      : this.laneCenters;
  }

  /** AUTHORITATIVE current speed multiplier (debug/QA/HUD observability). */
  public get speedMultiplier(): number {
    return this.speedMultiplierValue;
  }

  /** Per-step forward speed: level base × current multiplier (units/s). */
  public get currentForwardSpeed(): number {
    return this.def.baseForwardSpeed * this.speedMultiplierValue;
  }

  /** Whether an interaction id has already activated this attempt. */
  public isInteractionUsed(id: string): boolean {
    return this.usedInteractions.has(id);
  }

  /** Whether a teleport portal id has already fired this attempt. */
  public isTeleportUsed(id: string): boolean {
    return this.usedTeleports.has(id);
  }

  /** Progress [0..1] from real forward distance. */
  public get progress(): number {
    return computeProgress(this.player.position.z, this.def.start.z, this.def.finishZ);
  }

  /**
   * Advance exactly one fixed simulation step.
   * `input` is the PHYSICAL (gravity-agnostic) input snapshot; it is
   * interpreted against the authoritative gravity mode of this step.
   * Deterministic: same inputs -> same state trajectory regardless of caller
   * cadence.
   */
  public update(input: Readonly<PhysicalInputSnapshot> = makeIdlePhysicalSnapshot()): void {
    if (this.status === 'dead') {
      // Dead: gameplay input ignored, transform + sim time frozen; tick the hold.
      if (this.deathHoldTicksLeft > 0) {
        this.deathHoldTicksLeft -= 1;
        if (this.deathHoldTicksLeft === 0) this.respawn();
      }
      return;
    }
    if (this.status !== 'running') return;

    // Remember pre-step transform for render interpolation (and portal
    // forward-crossing detection).
    copyVec3(this.prevPosition, this.player.position);

    // 1. Mode controllers: physical input interpreted through the CURRENT
    //    gravity mode (pre-mutation), then intent + kinematics. The
    //    per-step forward speed comes from the authoritative level speed ×
    //    speed multiplier. Spider snap (opposite-surface teleport) resolves
    //    BEFORE the controller so the step integrates from the destination.
    const logicalInput = interpretPhysicalInput(input, this.gravityModeValue);
    const jumpPressed = logicalInput.jump.pressedThisStep;
    if (this.modeValue === 'spider' && jumpPressed) {
      // Hazard in the snap path kills (death wins the step).
      if (this.trySpiderSnap()) return;
    }
    this.shipThrusting = false;
    if (this.modeValue === 'ship') {
      const ctx = this.shipStepContext;
      ctx.laneCenters = this.activeLaneCenters;
      ctx.dt = SIMULATION_DT;
      ctx.frame = this.gameplayFrame;
      ctx.forwardSpeed = this.currentForwardSpeed;
      this.shipController.step(this.player, logicalInput, ctx);
      this.shipThrusting = ctx.thrustingThisStep;
    } else if (this.modeValue === 'spider') {
      const ctx = this.spiderStepContext;
      ctx.laneCenters = this.activeLaneCenters;
      ctx.dt = SIMULATION_DT;
      ctx.frame = this.gameplayFrame;
      ctx.forwardSpeed = this.currentForwardSpeed;
      this.spiderController.step(this.player, logicalInput, ctx, CUBE_TUNING);
    } else {
      const ctx = this.stepContext;
      ctx.laneCenters = this.activeLaneCenters;
      ctx.dt = SIMULATION_DT;
      ctx.frame = this.gameplayFrame;
      ctx.forwardSpeed = this.currentForwardSpeed;
      this.controller.step(this.player, logicalInput, ctx);
      if (ctx.jumpedThisStep) this.events.onJump?.();
    }
    // The orb press edge is the same logical jump action the ground jump uses.

    // 2. Integrate + collide. Delta is velocity * dt (full-step displacement).
    // Snapshot pre-move velocity: the frontal-kill decision needs the approach
    // motion, and QA needs the pre-impact record.
    const v = this.player.velocity;
    copyVec3(this.preMoveVelocity, v);
    this.stepDelta.x = v.x * SIMULATION_DT;
    this.stepDelta.y = v.y * SIMULATION_DT;
    this.stepDelta.z = v.z * SIMULATION_DT;
    moveAabbThroughWorld(
      this.level.world,
      this.player.position,
      this.halfExtentsVec,
      this.stepDelta,
      this.moveResult,
    );

    // Frontal kill rule (M2, generalized to the frame in M3): a wall contact
    // whose normal opposes the forward axis while the player approaches along
    // forward kills — for BOTH blocking kinds (solid, killFront). Derived from
    // contact geometry + motion, never from kind alone. With forward +Z this
    // reduces exactly to the M2 Floor comparisons. ±X side scrapes block
    // without killing; top/underside landings are safe via Y resolution / the
    // support probe below.
    const f = this.gameplayFrame.forwardAxis;
    for (const contact of this.moveResult.wallContacts) {
      const normalAlongF =
        contact.normal.x * f.x + contact.normal.y * f.y + contact.normal.z * f.z;
      const approachAlongF =
        this.preMoveVelocity.x * f.x +
        this.preMoveVelocity.y * f.y +
        this.preMoveVelocity.z * f.z;
      if (normalAlongF < -0.5 && approachAlongF > 0) {
        this.die('frontImpact', contact.collider.id, contact.normal);
        return;
      }
    }

    // M8.1 lane-debt resync (wall-lane input bug fix): lateral intent must
    // never accumulate hidden debt against an immovable wall. When a
    // blocking contact opposed lane-axis motion this step while the target
    // lane lies further in the blocked direction, the target is unreachable
    // — resync it to the nearest REAL lane. Support-based side exits (the
    // M1.2 fall-off) produce no contact, so teetering on virtual lanes is
    // untouched; only true geometric blockage resyncs. General across all
    // modes (Cube/Ship/Spider share intent) and all four gravity surfaces.
    this.resyncLaneTargetOnLateralBlock();

    // 3. Grounding: support probe along the gravity direction + velocity
    //    cleanup. Support = blocking surface OPPOSING gravity (below the
    //    Cube on Floor, above it on Ceiling, sideways on walls).
    const g = this.gameplayFrame.gravityVector;
    const velAlongG =
      this.player.velocity.x * g.x + this.player.velocity.y * g.y + this.player.velocity.z * g.z;

    // Head-bump: blocked while moving ANTI-gravity (into the surface
    // gravity pulls away from) -> cancel the into-surface velocity
    // component. On ±Y gravity the move result carries dedicated flags;
    // on walls the X-clip wall contacts carry the same information.
    let blockedAntiGravity: boolean;
    if (g.x !== 0) {
      blockedAntiGravity = false;
      for (const contact of this.moveResult.wallContacts) {
        const n = contact.normal;
        if (n.x * -g.x + n.y * -g.y + n.z * -g.z > 0.5) {
          blockedAntiGravity = true;
          break;
        }
      }
    } else {
      blockedAntiGravity = g.y > 0 ? this.moveResult.hitFloor : this.moveResult.hitCeiling;
    }
    if (blockedAntiGravity && velAlongG < 0) {
      this.cancelVelocityAlongG();
    }

    const support = probeGroundSupport(
      this.level.world,
      this.player.position,
      this.halfExtentsVec,
      SUPPORT_PROBE_DISTANCE,
      g,
    );
    if (support !== null && velAlongG >= -REST_SPEED_EPSILON) {
      this.player.grounded = true;
      this.player.supportColliderId = support.collider.id;
      if (velAlongG > 0) this.cancelVelocityAlongG(); // land: absorb into surface
    } else {
      this.player.grounded = false;
      this.player.supportColliderId = null;
    }

    // 4. LETHAL CHECKS (before all portal/interaction mutations — the M3.3
    //    closeout invariant, extended to every M4 interaction): void bounds
    //    (lower always; upper when defined) then exact swept-path hazard
    //    overlap. A death here terminates the step; no pad, orb, or portal
    //    below can rescue or mutate a dead step — die() returns before the
    //    interaction/portal steps, leaving gravityMode,
    //    portalTransitionCount and lastPortalId at their pre-step values.
    if (this.player.position.y < this.def.deathY) {
      this.die('void', null, null);
      return;
    }
    if (this.def.deathYMax !== undefined && this.player.position.y > this.def.deathYMax) {
      this.die('void', null, null);
      return;
    }
    // M8B side void bounds (level-owned, optional): outward falls along X
    // in wall-gravity content terminate fairly instead of drifting forever.
    if (this.def.deathXMin !== undefined && this.player.position.x < this.def.deathXMin) {
      this.die('void', null, null);
      return;
    }
    if (this.def.deathXMax !== undefined && this.player.position.x > this.def.deathXMax) {
      this.die('void', null, null);
      return;
    }
    const lethalHazard = this.findOverlappingHazard();
    if (lethalHazard !== null) {
      // M8A: lava volumes (collider id `lava-<id>`) kill through the same
      // swept-path CCD but tag their own cause for readability/analytics.
      const cause: DeathCause = lethalHazard.id.startsWith('lava-') ? 'lava' : 'hazard';
      this.die(cause, lethalHazard.id, null);
      return;
    }
    // 5a. Dynamic chompers (M8D): advance the deterministic phase machine
    //    from the post-collision player position, then test the swept
    //    chomper-vs-player overlap. Lethal in EVERY phase (even dormant —
    //    touching the waiting creature kills). Death wins the step like
    //    every other lethal check: no portal/interaction below can rescue.
    this.stepChompers();
    const lethalChomperId = this.findLethalChomper();
    if (lethalChomperId !== null) {
      this.die('hazard', lethalChomperId, null);
      return;
    }

    // 5b. Teleport portals (M7.2): entry crossing AFTER the lethal checks
    //    (death wins the step) and BEFORE pads/orbs/portals, so the
    //    destination overlap is what the remaining steps evaluate.
    this.processTeleportPortals();
    // 5c. Player-mode portals (M8C): forward-crossing planes AFTER the
    //    lethal checks (death wins) and BEFORE pads/orbs, so the new mode's
    //    controller owns the very next step with clean transient state.
    this.processModePortals();
    // 6. Passive interactions: jump pads (swept contact, one-shot/attempt).
    this.processJumpPads();
    // 6. Active interactions: jump orbs then gravity orbs (press edge inside
    //    the swept activation window, one-shot/attempt).
    this.processOrbs(jumpPressed);
    // 7. Speed portal crossings (ascending Z): speed multiplier mutation.
    this.processSpeedPortals();
    // 8. Gravity portal crossings (AFTER the lethal checks — death wins the
    //    step). Forward-crossing edge on the swept step path:
    //    prevZ < portal.z <= currentZ. Deterministic at any per-step
    //    displacement; one-shot per attempt by construction. Crossing
    //    detection is order-independent (it reads prevPosition/position
    //    only), so the post-lethal placement changes nothing for non-lethal
    //    steps and structurally guarantees the precedence contract above.
    this.processGravityPortals();

    this.elapsedSimTime += SIMULATION_DT;
    if (this.player.position.z >= this.def.finishZ) {
      this.status = 'finished';
      this.events.onFinish?.();
    }
  }

  /** Deterministic reset to start; increments attempts exactly once. */
  public respawn(): void {
    resetPlayerState(this.player, {
      position: this.def.start,
      laneIndex: this.def.startLaneIndex,
      laneCount: this.def.laneCenters.length,
      gravityMode: this.level.startGravityMode,
      playerMode: 'cube',
    });
    this.gravityModeValue = this.level.startGravityMode;
    this.modeValue = 'cube';
    this.shipThrusting = false;
    this.speedMultiplierValue = this.level.startSpeedMultiplier;
    this.usedInteractions.clear();
    this.usedTeleports.clear();
    this.usedModePortals.clear();
    for (let i = 0; i < this.chomperStates.length; i++) {
      const def = this.level.chompers[i];
      const st = this.chomperStates[i];
      if (def !== undefined && st !== undefined) {
        resetChomperState(st, def);
        const prev = this.chomperPrev[i];
        if (prev !== undefined) {
          prev.x = def.dormant.x;
          prev.y = def.dormant.y;
          prev.z = def.dormant.z;
        }
      }
    }
    this.lastPortalId = null;
    this.lastModePortalId = null;
    this.lastSpeedPortalId = null;
    this.lastInteractionId = null;
    this.lastTeleportId = null;
    copyVec3(this.prevPosition, this.player.position);
    this.deathHoldTicksLeft = 0;
    this.deathCause = null;
    this.lastLethalColliderId = null;
    this.elapsedSimTime = 0;
    this.status = 'running';
    this.attempts += 1;
  }

  /** Immediate manual restart (R key / UI) from any status. NOT death:
   *  no death cause, no onDeath — exactly one attempt via respawn(). */
  public restart(): void {
    this.respawn();
  }

  /**
   * DEBUG/QA ONLY (same category as the renderer's debugFreezeFrame):
   * place the player at a world position while running. Zeroes velocity and
   * support like a respawn, keeps the current gravity mode and attempt count,
   * and is never called by gameplay. Exists so browser QA can reach distant
   * level sections without replaying the full human-precision track.
   */
  public debugPlaceAt(x: number, y: number, z: number): void {
    if (this.status !== 'running') return;
    this.player.position.x = x;
    this.player.position.y = y;
    this.player.position.z = z;
    this.player.velocity.x = 0;
    this.player.velocity.y = 0;
    this.player.velocity.z = 0;
    this.player.grounded = false;
    this.player.supportColliderId = null;
    copyVec3(this.prevPosition, this.player.position);
  }

  private cancelVelocityAlongG(): void {
    const g = this.gameplayFrame.gravityVector;
    const velAlongG =
      this.player.velocity.x * g.x +
      this.player.velocity.y * g.y +
      this.player.velocity.z * g.z;
    this.player.velocity.x -= g.x * velAlongG;
    this.player.velocity.y -= g.y * velAlongG;
    this.player.velocity.z -= g.z * velAlongG;
  }

  /**
   * Gravity portal processing: check forward crossings on this step's swept
   * path and apply transitions. Portals are sorted ascending by Z at load;
   * if several are crossed in one extreme-displacement step, the furthest one
   * wins (last applied). Transition semantics live on the ONE shared
   * `applyGravityTransition` path (also used by M4 gravity orbs): preserve
   * world position and all velocity components (no teleport, no impulse, no
   * snap), flip the authoritative mode, invalidate grounded/support.
   * Crossing a portal whose target is already the current mode updates the
   * debug id but does not count as a transition. Runs AFTER the lethal
   * checks (M3.3): if this step killed the player, update() already
   * returned and no portal state is mutated.
   */
  private processGravityPortals(): void {
    if (this.level.gravityPortals.length === 0) return;
    const prevZ = this.prevPosition.z;
    const currentZ = this.player.position.z;
    for (const portal of this.level.gravityPortals) {
      // M8.1 bounded trigger volumes: the swept path must overlap the gate
      // volume — crossing the Z plane outside the visible opening does NOT
      // trigger. Legacy volume-less portals keep the plane crossing.
      const tc = portal.triggerCenter;
      const th = portal.triggerHalfExtents;
      const crossed =
        tc !== undefined && th !== undefined
          ? this.sweptWindowOverlap(tc, th)
          : prevZ < portal.z && currentZ >= portal.z;
      if (crossed) {
        this.lastPortalId = portal.id;
        this.applyGravityTransition(portal.target);
      }
    }
  }

  /**
   * Player-mode portal processing (M8C): deterministic forward crossings
   * on the swept step path, ascending Z (furthest crossed wins). Pure mode
   * mutation through the ONE shared `applyModeTransition` path — no
   * position jump, no impulse. One-shot per attempt (respawn re-arms).
   * Runs AFTER the lethal checks (death wins the step).
   */
  private processModePortals(): void {
    if (this.level.modePortals.length === 0) return;
    const prevZ = this.prevPosition.z;
    const currentZ = this.player.position.z;
    for (const portal of this.level.modePortals) {
      if (this.usedModePortals.has(portal.id)) continue;
      // M8.1 bounded trigger volumes (same contract as gravity portals).
      const tc = portal.triggerCenter;
      const th = portal.triggerHalfExtents;
      const crossed =
        tc !== undefined && th !== undefined
          ? this.sweptWindowOverlap(tc, th)
          : prevZ < portal.z && currentZ >= portal.z;
      if (crossed) {
        this.usedModePortals.add(portal.id);
        this.lastModePortalId = portal.id;
        this.applyModeTransition(portal.target);
      }
    }
  }

  /**
   * THE single player-mode transition path (M8C — no duplicate mode
   * state). Preserves world position and forward/lateral flow, zeroes the
   * velocity component along the current gravity axis (clean handoff — no
   * inherited fall speed into the new mode), and immediately invalidates
   * grounded/support so the new controller starts from a clean transient
   * state. Crossing a plane whose target is already the current mode
   * updates the debug id but does not count as a transition.
   */
  private applyModeTransition(target: PlayerMode): void {
    if (this.modeValue === target) return;
    this.modeValue = target;
    this.player.playerMode = target;
    const g = this.gameplayFrame.gravityVector;
    const v = this.player.velocity;
    const alongG = v.x * g.x + v.y * g.y + v.z * g.z;
    v.x -= g.x * alongG;
    v.y -= g.y * alongG;
    v.z -= g.z * alongG;
    this.player.grounded = false;
    this.player.supportColliderId = null;
    this.shipThrusting = false;
    this.modeTransitionCount += 1;
  }

  /**
   * Spider opposite-surface snap (M8C): on the primary press edge, the
   * Spider teleports along −gravity (away from the current support) onto
   * the nearest valid opposite support and flips to that gravity mode
   * through the shared transition path.
   *
   * Contract (pinned):
   * - destination = nearest blocking face ahead along −gravity within
   *   SPIDER_SNAP_MAX_DISTANCE whose footprint overlaps the player box
   *   (ties → first in world query order — deterministic per level);
   * - the swept transit box is tested: any HAZARD overlap kills
   *   (`hazard` — death wins, no magic pass-through); any OTHER solid
   *   overlap aborts the snap (press ignored — never clip into rock);
   * - no valid support in range → press ignored (never a void launch);
   * - on success: position rests against the face, along-gravity velocity
   *   is zeroed (lane/forward flow preserved), support clears, gravity
   *   flips to the opposite surface (floor ↔ ceiling, wall ↔ wall).
   *
   * Returns true when the snap path crossed a hazard (the caller must end
   * the step — death wins).
   */
  private trySpiderSnap(): boolean {
    const frame = this.gameplayFrame;
    const g = frame.gravityVector;
    // Search direction: away from the current support (opposite surface).
    // Gravity is always world-axis aligned, so exactly one of dx/dy is set.
    const dx = -g.x;
    const dy = -g.y;
    const p = this.player.position;
    const half = this.halfExtentsVec;
    const alongX = dx !== 0;
    // Leading-face coordinate along the search axis.
    const face = alongX ? p.x + dx * half.x : p.y + dy * half.y;

    // Broad query: player footprint extruded along the search axis by max.
    const query: Aabb = alongX
      ? {
          minX: dx > 0 ? face : face - SPIDER_SNAP_MAX_DISTANCE,
          maxX: dx > 0 ? face + SPIDER_SNAP_MAX_DISTANCE : face,
          minY: p.y - half.y,
          maxY: p.y + half.y,
          minZ: p.z - half.z,
          maxZ: p.z + half.z,
        }
      : {
          minX: p.x - half.x,
          maxX: p.x + half.x,
          minY: dy > 0 ? face : face - SPIDER_SNAP_MAX_DISTANCE,
          maxY: dy > 0 ? face + SPIDER_SNAP_MAX_DISTANCE : face,
          minZ: p.z - half.z,
          maxZ: p.z + half.z,
        };
    const candidates = this.hazardScratch;
    this.level.world.queryBox(query, candidates);

    let support: Collider | null = null;
    let bestDistance = SPIDER_SNAP_MAX_DISTANCE;
    for (const c of candidates) {
      if (c.kind !== 'solid' && c.kind !== 'killFront') continue;
      const b = colliderToAabb(c);
      // Footprint overlap on the two axes perpendicular to the search.
      const footprint = alongX
        ? query.minY < b.maxY && query.maxY > b.minY && query.minZ < b.maxZ && query.maxZ > b.minZ
        : query.minX < b.maxX && query.maxX > b.minX && query.minZ < b.maxZ && query.maxZ > b.minZ;
      if (!footprint) continue;
      // Opposing face: the face toward the player along the search axis.
      const plane = alongX ? (dx > 0 ? b.minX : b.maxX) : dy > 0 ? b.minY : b.maxY;
      const distance = (plane - face) * (alongX ? dx : dy);
      if (distance < -0.001) continue; // behind the leading face
      if (distance < bestDistance) {
        bestDistance = distance;
        support = c;
      }
    }
    if (support === null) return false; // no valid opposite support: ignore

    // Destination: resting against the support face.
    const dest = this.snapDest;
    dest.x = p.x;
    dest.y = p.y;
    dest.z = p.z;
    if (alongX) dest.x = face + dx * bestDistance - dx * half.x;
    else dest.y = face + dy * bestDistance - dy * half.y;

    // Swept transit box (single-axis → exact): hazards kill; a solid
    // strictly INSIDE the transit aborts the snap (never clip into rock).
    // Coplanar straddles (a neighboring slab sharing the support plane,
    // e.g. segmented ceilings) are harmless and ignored — the probe below
    // resolves multi-slab support with the usual teeter semantics.
    const swept = this.snapSwept;
    sweptSegmentAabb(swept, p, dest, half);
    const transit = this.snapTransit;
    this.level.world.queryBox(swept, transit);
    for (const c of transit) {
      if (c.id === support.id) continue;
      const box = colliderToAabb(c);
      if (!aabbOverlap(swept, box)) continue;
      if (c.kind === 'hazard') {
        this.die('hazard', c.id, null);
        return true;
      }
      // Nearest face of the blocker along the search axis: strictly
      // inside the transit (short of the support plane) = real blockage.
      const nearFace = alongX ? (dx > 0 ? box.minX : box.maxX) : dy > 0 ? box.minY : box.maxY;
      const nearDistance = (nearFace - face) * (alongX ? dx : dy);
      if (nearDistance < bestDistance - 0.01) return false; // ignore press
    }

    // Commit: rest against the face, zero along-gravity velocity.
    copyVec3(this.prevPosition, dest);
    copyVec3(this.player.position, dest);
    const v = this.player.velocity;
    const alongG = v.x * g.x + v.y * g.y + v.z * g.z;
    v.x -= g.x * alongG;
    v.y -= g.y * alongG;
    v.z -= g.z * alongG;
    this.player.grounded = false;
    this.player.supportColliderId = null;
    this.applyGravityTransition(oppositeGravityMode(this.gravityModeValue));
    return false;
  }

  /**
   * M8.1 lane-debt resync: cap unreachable lane intent after lateral
   * blockage. Reads the authoritative post-collision contacts (deterministic
   * move-result order) and the current lateral position; mutates ONLY
   * `targetLaneIndex`, never position or velocity — so replays stay
   * input-driven and trajectories without lateral contacts are bit-identical.
   *
   * Rule: while a wall blocks lane motion in direction d and the target lies
   * further in direction d, the target is clamped to at most ONE lane-step
   * beyond the deepest reachable real lane. One step is the physically
   * meaningful lean/teeter allowance (M1.2 — the pinned side-blocked settle
   * holds the Cube against the wall instead of dragging it back); anything
   * deeper is unreachable hidden debt, so repeated impossible presses can
   * never accumulate — a single press back always recovers. Support-based
   * side exits produce no contact, so open-edge virtual lanes are untouched.
   */
  private resyncLaneTargetOnLateralBlock(): void {
    const contacts = this.moveResult.wallContacts;
    if (contacts.length === 0) return;
    const frame = this.gameplayFrame;
    const la = frame.laneAxis;
    // First lateral contact in deterministic move-result order wins.
    let blockedDir = 0;
    for (const contact of contacts) {
      const n = contact.normal;
      const lateral = n.x * la.x + n.y * la.y + n.z * la.z;
      if (Math.abs(lateral) > 0.5) {
        // The normal points away from the blocking surface: motion toward
        // −normal was stopped, i.e. lane-space direction −sign(lateral).
        blockedDir = lateral > 0 ? -1 : 1;
        break;
      }
    }
    // Y-axis clips never enter wallContacts — they set hitFloor/hitCeiling.
    // Those are landings on Floor/Ceiling (lane axis horizontal — never
    // lateral), but on WALL gravity (lane axis vertical) they ARE the
    // lane-direction blockage (floor below / ceiling above the wall run).
    if (blockedDir === 0 && la.y !== 0) {
      const ySign = Math.sign(la.y);
      if (this.moveResult.hitFloor) blockedDir = -ySign;
      else if (this.moveResult.hitCeiling) blockedDir = ySign;
    }
    if (blockedDir === 0) return;
    const centers = this.activeLaneCenters;
    if (centers.length === 0) return;
    const laneSign = la.x !== 0 ? Math.sign(la.x) : Math.sign(la.y);
    const p = this.player.position;
    const sPos = p.x * la.x + p.y * la.y + p.z * la.z;
    const sTarget = laneCenterForIndex(centers, this.player.targetLaneIndex) * laneSign;
    const gap = sTarget - sPos;
    // Only clamp when the target lies in the blocked direction (pressing
    // back the other way already works — it must never be disturbed).
    if (gap === 0 || Math.sign(gap) !== blockedDir) return;
    const eps = 0.01;
    if (blockedDir < 0) {
      // Deepest reachable real lane, minus the one meaningful lean step.
      let deepest = -1;
      for (let i = 0; i < centers.length; i++) {
        if ((centers[i] ?? 0) * laneSign >= sPos - eps) {
          deepest = i;
          break;
        }
      }
      // Degenerate (position past every lane on the free side): fall back
      // to the extreme real lane in the blocked direction — still bounded,
      // still one press back to recovery.
      const cap = deepest === -1 ? 0 : deepest - 1;
      if (this.player.targetLaneIndex < cap) this.player.targetLaneIndex = cap;
    } else {
      let shallowest = -1;
      for (let i = centers.length - 1; i >= 0; i--) {
        if ((centers[i] ?? 0) * laneSign <= sPos + eps) {
          shallowest = i;
          break;
        }
      }
      const cap = shallowest === -1 ? -1 : shallowest + 1;
      if (this.player.targetLaneIndex > cap) this.player.targetLaneIndex = cap;
    }
  }

  /**
   * THE single gravity transition path — shared by M3 gravity portals
   * and M4 gravity orbs (no duplicate gravity state). Preserves world position
   * and ALL velocity components (no teleport, no impulse, no snap); flips the
   * authoritative gravity mode and immediately invalidates grounded/support so
   * the next steps accelerate toward the new gravity direction.
   */
  private applyGravityTransition(target: GravityMode): void {
    if (this.gravityModeValue === target) return;
    this.gravityModeValue = target;
    this.player.gravityMode = target;
    this.player.grounded = false;
    this.player.supportColliderId = null;
    this.portalTransitionCount += 1;
  }

  /**
   * Speed portal processing (M4): deterministic forward crossings on the
   * swept step path, ascending Z (furthest crossed wins). Pure multiplier
   * mutation — no position jump, no impulse. One-shot per attempt by
   * construction (forward motion never revisits a plane).
   */
  private processSpeedPortals(): void {
    if (this.level.speedPortals.length === 0) return;
    const prevZ = this.prevPosition.z;
    const currentZ = this.player.position.z;
    for (const portal of this.level.speedPortals) {
      // M8.1 bounded trigger volumes (same contract as gravity portals).
      const tc = portal.triggerCenter;
      const th = portal.triggerHalfExtents;
      const crossed =
        tc !== undefined && th !== undefined
          ? this.sweptWindowOverlap(tc, th)
          : prevZ < portal.z && currentZ >= portal.z;
      if (crossed) {
        this.lastSpeedPortalId = portal.id;
        this.speedMultiplierValue = portal.multiplier;
        this.registerInteraction('speedPortal', portal.id, 0, 0, portal.z);
      }
    }
  }

  /**
   * Teleport portal processing (M7.2): deterministic forward entry-crossing
   * on the swept step path (`prevZ < entryZ <= currentZ`), furthest crossed
   * unused entry wins. ONE-SHOT per attempt (respawn re-arms); a lethal step
   * never reaches this (update already returned). Semantics (pinned):
   * - DISCONTINUITY: world position jumps to the authored exit; the skipped
   *   interval is never interpreted as traversed — no gravity/speed portal
   *   inside it fires (only portals crossed by real motion fire).
   * - `prevPosition` is re-anchored at the exit, so the pad/orb/portal
   *   steps below evaluate a zero-length destination path: only volumes
   *   overlapping the exit itself can fire the same step.
   * - Gravity mode and speed multiplier are UNCHANGED; lateral/forward
   *   velocity is preserved (flow), velocity along the CURRENT gravity
   *   axis is zeroed (clean re-entry — identical to the old vertical
   *   zeroing on Floor/Ceiling, correct on walls), lane intent is set to
   *   the authored `exitLaneIndex`, and grounded/support is cleared (the
   *   next probe resolves it).
   * - Crossing an already-used entry is a no-op (forward motion never
   *   revisits a plane within an attempt anyway).
   */
  private processTeleportPortals(): void {
    if (this.level.teleportPortals.length === 0) return;
    const prevZ = this.prevPosition.z;
    const currentZ = this.player.position.z;
    let fired: TeleportPortalDef | null = null;
    for (const portal of this.level.teleportPortals) {
      if (this.usedTeleports.has(portal.id)) continue;
      // M8A bounded entry volumes: the swept path must overlap the entry
      // box (flying past a small ring cannot trigger it). Legacy portals
      // without a volume keep the forward entry-plane crossing.
      if (portal.entryCenter !== undefined && portal.entryHalfExtents !== undefined) {
        if (this.sweptWindowOverlap(portal.entryCenter, portal.entryHalfExtents)) fired = portal;
      } else if (prevZ < portal.entryZ && currentZ >= portal.entryZ) {
        fired = portal;
      }
    }
    if (fired === null) return;
    this.usedTeleports.add(fired.id);
    this.player.position.x = fired.exit.x;
    this.player.position.y = fired.exit.y;
    this.player.position.z = fired.exit.z;
    copyVec3(this.prevPosition, this.player.position);
    // Zero the along-gravity component (M8C generalization of the M7.2
    // vertical zeroing — behaviorally identical on Floor/Ceiling).
    const g = this.gameplayFrame.gravityVector;
    const v = this.player.velocity;
    const alongG = v.x * g.x + v.y * g.y + v.z * g.z;
    v.x -= g.x * alongG;
    v.y -= g.y * alongG;
    v.z -= g.z * alongG;
    this.player.targetLaneIndex = fired.exitLaneIndex;
    this.player.grounded = false;
    this.player.supportColliderId = null;
    this.lastTeleportId = fired.id;
    this.lastTeleport.x = fired.exit.x;
    this.lastTeleport.y = fired.exit.y;
    this.lastTeleport.z = fired.exit.z;
    this.hasTeleportEvent = true;
    this.teleportEventCount += 1;
  }

  /**
   * Passive pad interactions (M4): a pad fires when the player's swept step
   * path contacts/crosses its trigger volume — no input involved. One-shot
   * per attempt (a resting/overlapping player cannot multi-fire).
   */
  private processJumpPads(): void {
    for (const pad of this.level.jumpPads) {
      if (this.usedInteractions.has(pad.id)) continue;
      if (!this.sweptWindowOverlap(pad.center, pad.halfExtents)) continue;
      this.usedInteractions.add(pad.id);
      // Replace the velocity component along the pad's surface normal
      // (away from the mount surface on all four supports) with the pad
      // impulse; lateral/forward preserved. Deterministic identical launch.
      const n = MOUNT_NORMALS[pad.surface];
      const v = this.player.velocity;
      const alongN = v.x * n.x + v.y * n.y + v.z * n.z;
      const correction = pad.impulse - alongN;
      v.x += n.x * correction;
      v.y += n.y * correction;
      v.z += n.z * correction;
      this.player.grounded = false;
      this.player.supportColliderId = null;
      this.registerInteraction(
        'pad',
        pad.id,
        pad.center.x,
        pad.center.y,
        pad.center.z,
      );
    }
  }

  /**
   * Active orb interactions (M4): activation requires BOTH a press edge of
   * the logical jump action this step AND the swept step path overlapping the
   * orb window (inside/entering/exiting). No input buffer: a press the step
   * before entering expires unused. Jump orbs first, then gravity orbs, both
   * in level definition order — deterministic. One-shot per attempt.
   */
  private processOrbs(jumpPressed: boolean): void {
    if (!jumpPressed) return;
    for (const orb of this.level.jumpOrbs) {
      if (this.usedInteractions.has(orb.id)) continue;
      if (!this.sweptWindowOverlap(orb.center, orb.halfExtents)) continue;
      this.usedInteractions.add(orb.id);
      this.applyOrbImpulse(orb.impulse);
      this.registerInteraction('jumpOrb', orb.id, orb.center.x, orb.center.y, orb.center.z);
    }
    for (const orb of this.level.gravityOrbs) {
      if (this.usedInteractions.has(orb.id)) continue;
      if (!this.sweptWindowOverlap(orb.center, orb.halfExtents)) continue;
      this.usedInteractions.add(orb.id);
      // M8B: gravity orbs flip to the OPPOSITE surface (floor ↔ ceiling,
      // leftWall ↔ rightWall) — never an arbitrary 4-state cycle.
      this.applyGravityTransition(oppositeGravityMode(this.gravityModeValue));
      this.registerInteraction('gravityOrb', orb.id, orb.center.x, orb.center.y, orb.center.z);
    }
  }

  /**
   * Orb impulse: replace the velocity component along the CURRENT gravity
   * surface normal (gameplay-frame relative — away from the current support
   * surface) with `impulse`; lateral/forward preserved; grounded/support
   * cleared. Works airborne (the orb's purpose) and supersedes a same-step
   * ground jump deterministically (later mutation wins the step).
   */
  private applyOrbImpulse(impulse: number): void {
    const n = this.gameplayFrame.surfaceNormal;
    const v = this.player.velocity;
    const alongN = v.x * n.x + v.y * n.y + v.z * n.z;
    const correction = impulse - alongN;
    v.x += n.x * correction;
    v.y += n.y * correction;
    v.z += n.z * correction;
    this.player.grounded = false;
    this.player.supportColliderId = null;
  }

  /**
   * Exact swept-window test for M4 interaction volumes: the interaction AABB
   * must overlap one of the three single-axis swept segment volumes of this
   * step's authoritative Y → Z → X path (same primitive as hazard CCD), so
   * high-speed motion can never skip a thin pad/orb window and windows the
   * path never entered can never falsely trigger.
   */
  private sweptWindowOverlap(
    center: Readonly<{ x: number; y: number; z: number }>,
    halfExtents: Readonly<{ x: number; y: number; z: number }>,
  ): boolean {
    const box = this.interactionBoxScratch;
    box.minX = center.x - halfExtents.x;
    box.maxX = center.x + halfExtents.x;
    box.minY = center.y - halfExtents.y;
    box.maxY = center.y + halfExtents.y;
    box.minZ = center.z - halfExtents.z;
    box.maxZ = center.z + halfExtents.z;
    return sweptPathOverlaps(
      this.sweptPathScratch,
      this.prevPosition,
      this.moveResult.positionAfterY,
      this.moveResult.positionAfterZ,
      this.player.position,
      this.halfExtentsVec,
      box,
    );
  }

  /** Record one interaction activation (counters + stable VFX/debug record). */
  private registerInteraction(
    kind: InteractionKind,
    id: string,
    x: number,
    y: number,
    z: number,
  ): void {
    this.interactionEventCount += 1;
    if (kind === 'pad') this.padActivationCount += 1;
    if (kind === 'jumpOrb' || kind === 'gravityOrb') this.orbActivationCount += 1;
    if (kind === 'speedPortal') this.speedPortalCount += 1;
    this.lastInteractionId = id;
    const record = this.lastInteraction;
    record.kind = kind;
    record.id = id;
    record.x = x;
    record.y = y;
    record.z = z;
    this.hasInteractionEvent = true;
  }

  /** The overlapping hazard collider, if any. killFront is NOT an overlap kill:
   *  it blocks like solid and kills only via the frontal contact rule above.
   *  Broadphase: the loose pre/post-step union box (a superset of the true
   *  swept path — clipping only ever places intermediates between the
   *  endpoints). Narrowphase is EXACT: the hazard must overlap one of the
   *  three single-axis swept segment volumes of the authoritative
   *  Y → Z → X path, so fast motion can never skip a thin hazard and corner
   *  regions the path never enters can never falsely kill. */
  private findOverlappingHazard(): Collider | null {
    const half = this.halfExtentsVec;
    const p = this.player.position;
    const q = this.prevPosition;
    const box = {
      minX: Math.min(p.x, q.x) - half.x,
      maxX: Math.max(p.x, q.x) + half.x,
      minY: Math.min(p.y, q.y) - half.y,
      maxY: Math.max(p.y, q.y) + half.y,
      minZ: Math.min(p.z, q.z) - half.z,
      maxZ: Math.max(p.z, q.z) + half.z,
    };
    const candidates = this.hazardScratch;
    this.level.world.queryBox(box, candidates);
    if (candidates.length === 0) return null;
    const afterY = this.moveResult.positionAfterY;
    const afterZ = this.moveResult.positionAfterZ;
    for (const c of candidates) {
      if (
        c.kind === 'hazard' &&
        sweptPathOverlaps(this.sweptPathScratch, q, afterY, afterZ, p, half, colliderToAabb(c))
      ) {
        return c;
      }
    }
    return null;
  }

  /**
   * Advance every Chomper phase machine one fixed step from the
   * post-collision player position (M8D). Previous centers are snapshotted
   * first so `findLethalChomper` tests the exact swept segment.
   */
  private stepChompers(): void {
    const defs = this.level.chompers;
    for (let i = 0; i < this.chomperStates.length; i++) {
      const st = this.chomperStates[i];
      const def = defs[i];
      if (st === undefined || def === undefined) continue;
      const prev = this.chomperPrev[i];
      if (prev !== undefined) {
        prev.x = st.x;
        prev.y = st.y;
        prev.z = st.z;
      }
      stepChomper(st, def, this.player.position.z, this.player.position.x);
    }
  }

  /**
   * Swept Chomper-vs-player overlap (M8D): the union of the Chomper's
   * swept segment box (prev -> current center ± half extents) and the
   * player's swept segment box (prevPosition -> position ± half) must
   * overlap. Both sides sweep, so neither fast lunges nor 3x player
   * speeds tunnel. Returns the lethal `chomper-<id>` or null.
   */
  private findLethalChomper(): string | null {
    const defs = this.level.chompers;
    if (this.chomperStates.length === 0) return null;
    const half = this.halfExtentsVec;
    const p = this.player.position;
    const q = this.prevPosition;
    for (let i = 0; i < this.chomperStates.length; i++) {
      const st = this.chomperStates[i];
      const def = defs[i];
      const prev = this.chomperPrev[i];
      if (st === undefined || def === undefined || prev === undefined) continue;
      const h = def.halfExtents;
      const cMinX = Math.min(prev.x, st.x) - h.x;
      const cMaxX = Math.max(prev.x, st.x) + h.x;
      const cMinY = Math.min(prev.y, st.y) - h.y;
      const cMaxY = Math.max(prev.y, st.y) + h.y;
      const cMinZ = Math.min(prev.z, st.z) - h.z;
      const cMaxZ = Math.max(prev.z, st.z) + h.z;
      const pMinX = Math.min(p.x, q.x) - half.x;
      const pMaxX = Math.max(p.x, q.x) + half.x;
      const pMinY = Math.min(p.y, q.y) - half.y;
      const pMaxY = Math.max(p.y, q.y) + half.y;
      const pMinZ = Math.min(p.z, q.z) - half.z;
      const pMaxZ = Math.max(p.z, q.z) + half.z;
      if (
        cMinX < pMaxX && cMaxX > pMinX &&
        cMinY < pMaxY && cMaxY > pMinY &&
        cMinZ < pMaxZ && cMaxZ > pMinZ
      ) {
        return `chomper-${def.id}`;
      }
    }
    return null;
  }

  /** Instantaneous lethal transition. Idempotent: repeat calls while dead are
   *  ignored so overlapping contacts can never double-fire the event. */
  private die(
    cause: DeathCause,
    lethalColliderId: string | null,
    contactNormal: Readonly<Vec3> | null,
  ): void {
    if (this.status === 'dead') return;
    this.status = 'dead';
    this.deathCause = cause;
    this.lastDeathCause = cause;
    this.lastDeathLethalId = lethalColliderId;
    this.deathId += 1;
    copyVec3(this.deathPosition, this.player.position);
    this.lastLethalColliderId = lethalColliderId;
    if (contactNormal !== null) copyVec3(this.lastContactNormal, contactNormal);
    else this.lastContactNormal.x = this.lastContactNormal.y = this.lastContactNormal.z = 0;
    copyVec3(this.lastPreImpactVelocity, this.preMoveVelocity);
    this.deathHoldTicksLeft = DEATH_HOLD_TICKS;
    this.events.onDeath?.();
  }
}
