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
 *   6. passive interactions: jump pads (swept contact, one-shot per attempt)
 *   7. active interactions: jump orbs then gravity orbs (press edge inside
 *      the swept activation window, one-shot per attempt)
 *   8. speed portal crossings (ascending Z) -> speed multiplier mutation
 *   9. gravity portal crossings (ascending Z) -> gravity transition
 *  10. finish detection
 * Death at any earlier point wins the step.
 */
export type SimulationStatus = 'running' | 'dead' | 'finished';

/** Why the current (or most recent) death happened. Manual restart is NOT death. */
export type DeathCause = 'hazard' | 'frontImpact' | 'void';

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
  /** Stable record of the most recent interaction activation (VFX anchor). */
  public readonly lastInteraction: InteractionEvent = { kind: 'pad', id: '', x: 0, y: 0, z: 0 };
  /** True once the most recent interaction record has been written at least once. */
  public hasInteractionEvent = false;
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
    //    mode (pre-mutation), then intent + kinematics. The per-step forward
    //    speed comes from the authoritative level speed × speed multiplier.
    const ctx = this.stepContext;
    ctx.laneCenters = this.laneCenters;
    ctx.dt = SIMULATION_DT;
    ctx.frame = this.gameplayFrame;
    ctx.forwardSpeed = this.currentForwardSpeed;
    const logicalInput = interpretPhysicalInput(input, this.gravityModeValue);
    this.controller.step(this.player, logicalInput, ctx);
    if (ctx.jumpedThisStep) this.events.onJump?.();
    // The orb press edge is the same logical jump action the ground jump uses.
    const jumpPressed = logicalInput.jump.pressedThisStep;

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
    const lethalHazard = this.findOverlappingHazard();
    if (lethalHazard !== null) {
      this.die('hazard', lethalHazard.id, null);
      return;
    }

    // 5. Passive interactions: jump pads (swept contact, one-shot/attempt).
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
    });
    this.gravityModeValue = this.level.startGravityMode;
    this.speedMultiplierValue = this.level.startSpeedMultiplier;
    this.usedInteractions.clear();
    this.lastPortalId = null;
    this.lastSpeedPortalId = null;
    this.lastInteractionId = null;
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
      if (prevZ < portal.z && currentZ >= portal.z) {
        this.lastPortalId = portal.id;
        this.applyGravityTransition(portal.target);
      }
    }
  }

  /**
   * THE single Floor ↔ Ceiling transition path — shared by M3 gravity portals
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
      if (prevZ < portal.z && currentZ >= portal.z) {
        this.lastSpeedPortalId = portal.id;
        this.speedMultiplierValue = portal.multiplier;
        this.registerInteraction('speedPortal', portal.id, 0, 0, portal.z);
      }
    }
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
      // (+Y floor / −Y ceiling) with the pad impulse; lateral/forward
      // preserved. Deterministic identical launch.
      this.player.velocity.y = (pad.surface === 'ceiling' ? -1 : 1) * pad.impulse;
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
      const target: GravityMode = this.gravityModeValue === 'ceiling' ? 'floor' : 'ceiling';
      this.applyGravityTransition(target);
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
