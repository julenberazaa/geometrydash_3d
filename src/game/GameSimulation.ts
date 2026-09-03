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

export interface SimulationEvents {
  onDeath?: () => void;
  onFinish?: () => void;
  /** Fired whenever a new jump is initiated (hook for future VFX/audio). */
  onJump?: () => void;
}

/** How long (sim seconds) the dead status holds before auto-respawn eligibility. */
export const DEATH_HOLD_SECONDS = 0.45;
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
  /** Counts down while dead; respawn allowed when it hits 0 (or on key press). */
  public deathHoldTimer = 0;

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
      if (this.deathHoldTimer > 0) {
        this.deathHoldTimer = Math.max(0, this.deathHoldTimer - SIMULATION_DT);
        if (this.deathHoldTimer === 0) this.respawn();
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
    const v = this.player.velocity;
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

    // Frontal wall contact = kill-front semantics for M1 (arcade standard).
    for (const contact of this.moveResult.wallContacts) {
      if (contact.normal.z < -0.5) {
        this.die();
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
      this.die();
      return;
    }
    if (this.checkHazardOverlap()) {
      this.die();
      return;
    }

    this.elapsedSimTime += SIMULATION_DT;
    if (this.player.position.z >= this.def.finishZ) {
      this.status = 'finished';
      this.events.onFinish?.();
    }
  }

  /** Deterministic reset to start; increments attempts. */
  public respawn(): void {
    resetPlayerState(this.player, {
      position: this.def.start,
      laneIndex: this.def.startLaneIndex,
      laneCount: this.def.laneCenters.length,
    });
    copyVec3(this.prevPosition, this.player.position);
    this.deathHoldTimer = 0;
    this.elapsedSimTime = 0;
    this.status = 'running';
    this.attempts += 1;
  }

  /** Immediate manual restart (R key / UI). Does NOT require death hold to elapse. */
  public restart(): void {
    if (this.status === 'dead') {
      this.respawn();
      return;
    }
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

  /** True if a hazard overlaps the player box. */
  private checkHazardOverlap(): boolean {
    const half = this.halfExtentsVec;
    const p = this.player.position;
    const box = {
      minX: p.x - half.x,
      maxX: p.x + half.x,
      minY: p.y - half.y,
      maxY: p.y + half.y,
      minZ: p.z - half.z,
      maxZ: p.z + half.z,
    };
    const candidates = this.hazardScratch;
    this.level.world.queryBox(box, candidates);
    for (const c of candidates) {
      if (c.kind !== 'solid' && aabbOverlap(box, colliderToAabb(c))) {
        return true;
      }
    }
    return false;
  }

  private die(): void {
    this.status = 'dead';
    this.deathHoldTimer = DEATH_HOLD_SECONDS;
    this.events.onDeath?.();
  }
}
