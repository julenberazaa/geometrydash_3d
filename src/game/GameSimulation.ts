import type { PhysicalInputSnapshot } from '../input/InputSystem';
import { interpretPhysicalInput, makeIdlePhysicalSnapshot } from '../input/InputSystem';
import type { Vec3 } from '../core/math';
import { vec3, copyVec3 } from '../core/math';
import { SIMULATION_DT } from '../core/constants';
import { CUBE_TUNING } from '../player/cubeTuning';
import { CubeController, type CubeControllerStepContext } from '../player/CubeController';
import { GameplayFrame } from '../player/gameplayFrame';
import type { GravityMode } from '../player/playerState';
import {
  createPlayerState,
  resetPlayerState,
  type PlayerState,
} from '../player/playerState';
import { moveAabbThroughWorld, createMoveResult, probeGroundSupport } from '../collision/moveAabb';
import {
  colliderToAabb,
  createSweptPathScratch,
  sweptPathOverlaps,
  type Collider,
} from '../collision/collider';
import { loadLevel, computeProgress } from '../level/levelRuntime';
import type { LoadedLevel } from '../level/levelRuntime';
import type { LevelDefinition } from '../level/levelDefinition';

/**
 * Headless gameplay orchestration: the ENTIRE game simulates here.
 * No THREE, no DOM, no renderer. The rendering layer reads this state and
 * interpolates visual transforms between previous and current positions.
 *
 * Per fixed step:
 *   1. controller step (gravity-relative input interpretation -> velocities)
 *   2. integrate + collide via axis-separated swept movement (Y -> Z -> X)
 *   3. frontal-kill check (death returns immediately)
 *   4. grounding resolution (support probe along gravity + velocity cleanup)
 *   5. gravity portal crossings -> gravity transition (clears grounded/support)
 *   6. death checks (void bounds / hazards) & finish detection
 * Death at any earlier point wins the step: lethal contact is never undone by
 * a gravity portal.
 */
export type SimulationStatus = 'running' | 'dead' | 'finished';

/** Why the current (or most recent) death happened. Manual restart is NOT death. */
export type DeathCause = 'hazard' | 'frontImpact' | 'void';

export interface SimulationEvents {
  onDeath?: () => void;
  onFinish?: () => void;
  /** Fired whenever a new jump is initiated (hook for future VFX/audio). */
  onJump?: () => void;
}

/** Exact hold duration in fixed simulation ticks (single timing authority). */
export const DEATH_HOLD_TICKS = 36;
/** How long (sim seconds) the dead status holds before auto-respawn eligibility.
 *  Derived from the tick authority (36/120 = 0.30 s) so the two can never drift. */
export const DEATH_HOLD_SECONDS = DEATH_HOLD_TICKS * SIMULATION_DT;
/** Vertical probe distance for the grounded support check (contact-tight). */
const SUPPORT_PROBE_DISTANCE = 0.03;
/** Max speed along gravity (toward surface) that still counts as "resting". */
const REST_SPEED_EPSILON = 0.05;

/** Prebuilt frames per gravity mode — never allocated per step. */
const FRAME_FLOOR = GameplayFrame.floor();
const FRAME_CEILING = GameplayFrame.ceiling();

export class GameSimulation {
  public readonly level: LoadedLevel;
  private readonly def: LevelDefinition;
  public readonly player: PlayerState;
  private readonly controller: CubeController;
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
  /** Id of the most recent gravity portal crossed THIS attempt (debug/QA). */
  public lastPortalId: string | null = null;
  /** Monotonic count of actual gravity transitions (debug/QA leak/toggle guard). */
  public portalTransitionCount = 0;
  /** Simulated seconds since the current run started. */
  public elapsedSimTime = 0;
  /** Fixed-step ticks left while dead; respawn allowed when it hits 0 (or on key press).
   *  Integer authority for restart timing (float seconds would drift over 36 ticks). */
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

  constructor(levelDef: LevelDefinition, events: SimulationEvents = {}) {
    this.def = levelDef;
    this.level = loadLevel(levelDef);
    this.gravityModeValue = this.level.startGravityMode;
    this.player = createPlayerState({
      position: levelDef.start,
      laneIndex: levelDef.startLaneIndex,
      laneCount: levelDef.laneCenters.length,
      gravityMode: this.level.startGravityMode,
    });
    this.controller = new CubeController(CUBE_TUNING);
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

  /** Gameplay frame for the current gravity mode (prebuilt, read-only). */
  public get gameplayFrame(): Readonly<GameplayFrame> {
    return this.gravityModeValue === 'ceiling' ? FRAME_CEILING : FRAME_FLOOR;
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

    // 1. Controller: physical input interpreted through the CURRENT gravity
    //    mode (pre-portal), then intent + kinematics.
    const ctx = this.stepContext;
    ctx.laneCenters = this.laneCenters;
    ctx.dt = SIMULATION_DT;
    ctx.frame = this.gameplayFrame;
    const logicalInput = interpretPhysicalInput(input, this.gravityModeValue);
    this.controller.step(this.player, logicalInput, ctx);
    if (ctx.jumpedThisStep) this.events.onJump?.();

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

    // 3. Grounding: support probe along the gravity direction + velocity
    //    cleanup. Support = blocking surface OPPOSING gravity (below the Cube
    //    on Floor, above it on Ceiling).
    const g = this.gameplayFrame.gravityVector;
    const velAlongG =
      this.player.velocity.x * g.x + this.player.velocity.y * g.y + this.player.velocity.z * g.z;

    // Head-bump: blocked while moving ANTI-gravity (into the surface gravity
    // pulls away from) -> cancel the into-surface velocity component.
    const blockedAntiGravity = g.y > 0 ? this.moveResult.hitFloor : this.moveResult.hitCeiling;
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

    // 4. Gravity portal crossings (after grounding, before death checks so a
    //    lethal contact in this step always wins). Forward-crossing edge on
    //    the swept step path: prevZ < portal.z <= currentZ. Deterministic at
    //    any per-step displacement; one-shot per attempt by construction.
    this.processGravityPortals();

    // 5. Death checks: void bounds (lower always; upper when defined) then
    //    exact swept-path hazard overlap.
    if (this.player.position.y < this.def.deathY) {
      this.die('void', null, null);
      return;
    }
    if (this.def.deathYMax !== undefined && this.player.position.y > this.def.deathYMax) {
      this.die('void', null, null);
      return;
    }
    const lethalHazard = this.findOverlappingHazard();
    if (lethalHazard !== null) {
      this.die('hazard', lethalHazard.id, null);
      return;
    }

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
    });
    this.gravityModeValue = this.level.startGravityMode;
    this.lastPortalId = null;
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
   * wins (last applied). A transition PRESERVES world position and all
   * velocity components (no teleport, no impulse, no snap); it flips the
   * authoritative gravity mode and immediately invalidates grounded/support
   * so the next steps accelerate toward the new gravity direction.
   * Crossing a portal whose target is already the current mode updates the
   * debug id but does not count as a transition.
   */
  private processGravityPortals(): void {
    if (this.level.gravityPortals.length === 0) return;
    const prevZ = this.prevPosition.z;
    const currentZ = this.player.position.z;
    for (const portal of this.level.gravityPortals) {
      if (prevZ < portal.z && currentZ >= portal.z) {
        this.lastPortalId = portal.id;
        if (this.gravityModeValue !== portal.target) {
          this.gravityModeValue = portal.target;
          this.player.gravityMode = portal.target;
          // Invalidate support immediately: the Cube is airborne relative to
          // the new gravity orientation from this step onward.
          this.player.grounded = false;
          this.player.supportColliderId = null;
          this.portalTransitionCount += 1;
        }
      }
    }
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
