import type { InputSnapshot } from '../input/InputSystem';
import { makeIdleSnapshot } from '../input/InputSystem';
import type { Vec3 } from '../core/math';
import { vec3, copyVec3 } from '../core/math';
import { SIMULATION_DT } from '../core/constants';
import { CUBE_TUNING } from '../player/cubeTuning';
import { CubeController, type CubeControllerStepContext } from '../player/CubeController';
import {
  createPlayerState,
  resetPlayerState,
  type PlayerState,
} from '../player/playerState';
import { moveAabbThroughWorld, createMoveResult, probeGroundSupport } from '../collision/moveAabb';
import { aabbOverlap, colliderToAabb, type Collider } from '../collision/collider';
import { loadLevel, computeProgress } from '../level/levelRuntime';
import type { LoadedLevel } from '../level/levelRuntime';
import type { LevelDefinition } from '../level/levelDefinition';

/**
 * Headless gameplay orchestration: the ENTIRE game simulates here.
 * No THREE, no DOM, no renderer. The rendering layer reads this state and
 * interpolates visual transforms between previous and current positions.
 *
 * Per fixed step:
 *   1. controller step (intent -> velocities)
 *   2. integrate + collide via axis-separated swept movement
 *   3. grounding resolution (support probe + velocity cleanup)
 *   4. death checks (frontal wall / hazards / void) & finish detection
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

/** How long (sim seconds) the dead status holds before auto-respawn eligibility.
 *  M2: 0.30 s (36 ticks) — readable burst, sub-500 ms retry feel. */
export const DEATH_HOLD_SECONDS = 0.3;
/** Exact hold duration in fixed simulation ticks (unit-test authority). */
export const DEATH_HOLD_TICKS = 36;
/** Vertical probe distance for the grounded support check (contact-tight). */
const SUPPORT_PROBE_DISTANCE = 0.03;
/** Max speed along gravity (toward surface) that still counts as "resting". */
const REST_SPEED_EPSILON = 0.05;

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

  constructor(levelDef: LevelDefinition, events: SimulationEvents = {}) {
    this.def = levelDef;
    this.level = loadLevel(levelDef);
    this.player = createPlayerState({
      position: levelDef.start,
      laneIndex: levelDef.startLaneIndex,
      laneCount: levelDef.laneCenters.length,
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

  /** Progress [0..1] from real forward distance. */
  public get progress(): number {
    return computeProgress(this.player.position.z, this.def.start.z, this.def.finishZ);
  }

  /**
   * Advance exactly one fixed simulation step.
   * `input` may be an idle snapshot (pause). Deterministic: same inputs ->
   * same state trajectory regardless of caller cadence.
   */
  public update(input: Readonly<InputSnapshot> = makeIdleSnapshot()): void {
    if (this.status === 'dead') {
      // Dead: gameplay input ignored, transform + sim time frozen; tick the hold.
      if (this.deathHoldTicksLeft > 0) {
        this.deathHoldTicksLeft -= 1;
        if (this.deathHoldTicksLeft === 0) this.respawn();
      }
      return;
    }
    if (this.status !== 'running') return;

    // Remember pre-step transform for render interpolation.
    copyVec3(this.prevPosition, this.player.position);

    // 1. Controller: intent + kinematics.
    const ctx = this.stepContext;
    ctx.laneCenters = this.laneCenters;
    ctx.dt = SIMULATION_DT;
    this.controller.step(this.player, input, ctx);
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

    // Frontal kill rule (M2 explicit): a wall contact whose normal opposes the
    // forward axis (+Z) while the player approaches along forward kills — for
    // BOTH blocking kinds (solid, killFront). Derived from contact geometry +
    // motion, never from kind alone. ±X side scrapes block without killing;
    // top landings are safe via Y resolution / the support probe below.
    for (const contact of this.moveResult.wallContacts) {
      if (contact.normal.z < -0.5 && this.preMoveVelocity.z > 0) {
        this.die('frontImpact', contact.collider.id, contact.normal);
        return;
      }
    }

    // 3. Grounding: support probe + vertical velocity cleanup.
    const g = this.controller.gameplayFrame.gravityVector;
    const velAlongG =
      this.player.velocity.x * g.x + this.player.velocity.y * g.y + this.player.velocity.z * g.z;

    if (this.moveResult.hitCeiling && velAlongG < 0) {
      // Cancel velocity INTO the ceiling.
      this.cancelVelocityAlongG();
    }

    const support = probeGroundSupport(
      this.level.world,
      this.player.position,
      this.halfExtentsVec,
      SUPPORT_PROBE_DISTANCE,
    );
    if (support !== null && velAlongG >= -REST_SPEED_EPSILON) {
      this.player.grounded = true;
      this.player.supportColliderId = support.collider.id;
      if (velAlongG > 0) this.cancelVelocityAlongG(); // land: absorb into surface
    } else {
      this.player.grounded = false;
      this.player.supportColliderId = null;
    }

    // 4. Death checks.
    if (this.player.position.y < this.def.deathY) {
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
    });
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

  private cancelVelocityAlongG(): void {
    const g = this.controller.gameplayFrame.gravityVector;
    const velAlongG =
      this.player.velocity.x * g.x +
      this.player.velocity.y * g.y +
      this.player.velocity.z * g.z;
    this.player.velocity.x -= g.x * velAlongG;
    this.player.velocity.y -= g.y * velAlongG;
    this.player.velocity.z -= g.z * velAlongG;
  }

  /** The overlapping hazard collider, if any. killFront is NOT an overlap kill:
   *  it blocks like solid and kills only via the frontal contact rule above.
   *  The query box is the union of the pre-step and post-step player boxes so
   *  fast motion can never skip over a thin hazard within one step (the
   *  axis-separated path always stays inside this union). */
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
    for (const c of candidates) {
      if (c.kind === 'hazard' && aabbOverlap(box, colliderToAabb(c))) {
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
