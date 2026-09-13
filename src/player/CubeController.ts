import type { InputSnapshot } from '../input/InputSystem';
import { GameplayFrame } from './gameplayFrame';
import { stepLaneKinematics } from './laneKinematics';
import type { PlayerState } from './playerState';
import type { CubeTuning } from './cubeTuning';

/**
 * Deterministic Cube controller.
 *
 * Consumes an immutable InputSnapshot and a PlayerState; mutates only the
 * PlayerState. Knows nothing about levels (lane centers arrive per step via
 * context), rendering, or gravity modes beyond what the frame exposes.
 *
 * Step order per fixed step:
 *   1. lane intent (discrete target index changes, edge or held)
 *   2. lateral kinematics toward the target lane center
 *      (accelerate -> cruise -> analytic braking curve -> settle/snap)
 *   3. jump intent (grounded AND held => deterministic impulse off surface;
 *      holding produces automatic re-jump after every valid landing,
 *      never a mid-air extra jump)
 *   4. vertical kinematics (gravity / fast-fall / terminal speed)
 *   5. forward speed enforced constant along forwardAxis (the per-step value
 *      arrives via context.forwardSpeed — the level's base speed times the
 *      simulation's authoritative speed multiplier; the controller never
 *      owns or derives speed policy)
 */
export interface CubeControllerStepContext {
  /** World-space lane centers along the lane axis, indexed by lane index. */
  laneCenters: readonly number[];
  /** Fixed delta seconds (always SIMULATION_DT in production). */
  dt: number;
  /** Output: true when a jump was initiated this step. */
  jumpedThisStep: boolean;
  /**
   * Authoritative forward speed for THIS step (units/s along forwardAxis):
   * level base speed × the simulation's current speed multiplier (M4).
   */
  forwardSpeed: number;
  /**
   * Gameplay frame for THIS step, supplied by the simulation from its
   * authoritative gravity mode (M3). Optional only so direct controller
   * constructions (tests) can fall back to the controller's own frame.
   */
  frame?: Readonly<GameplayFrame>;
}

export class CubeController {
  private readonly tuning: CubeTuning;
  /** Frame is replaceable data for future gravity modes; M1 always Floor. */
  private frame: GameplayFrame;

  constructor(tuning: CubeTuning) {
    this.tuning = tuning;
    this.frame = GameplayFrame.floor();
  }

  public get gameplayFrame(): Readonly<GameplayFrame> {
    return this.frame;
  }

  public setFrame(frame: GameplayFrame): void {
    this.frame = frame;
  }

  public step(
    state: PlayerState,
    input: Readonly<InputSnapshot>,
    context: CubeControllerStepContext,
  ): void {
    const t = this.tuning;
    context.jumpedThisStep = false;
    // Authoritative frame comes from the simulation each step (gravity mode
    // owner); this.frame is only the fallback for direct construction.
    const frame = context.frame ?? this.frame;

    // ------------------------------------------------------------------
    // 1. Lane intent — EDGE-TRIGGERED ONLY, UNCLAMPED (M1.2).
    //    A physical tap must produce exactly ONE lane change even when the
    //    key event spans multiple simulation steps; holding a lane key does
    //    NOT slide across lanes (precision arcade semantics).
    //    A tap past the outer lane steps onto a VIRTUAL lane (extrapolated
    //    center — see laneKinematics). Support governs the outcome: the
    //    Cube brakes there if supported, steers back with an inward tap, or
    //    runs out of support and falls. No fake side walls, ever.
    // ------------------------------------------------------------------
    if (input.laneLeft.pressedThisStep) state.targetLaneIndex -= 1;
    if (input.laneRight.pressedThisStep) state.targetLaneIndex += 1;

    // ------------------------------------------------------------------
    // 2. Lateral kinematics — the shared lane policy (M8C: owned by
    //    laneKinematics.ts, used by every mode controller).
    // ------------------------------------------------------------------
    stepLaneKinematics(state, frame, context.laneCenters, t, context.dt);

    // ------------------------------------------------------------------
    // 3. Vertical kinematics along gravityVector (BEFORE jump so the
    //    impulse at step end is pristine and exactly reproducible).
    // ------------------------------------------------------------------
    const g = frame.gravityVector;
    const fastFallActive = !state.grounded && input.fastFall.held;
    const verticalAccel = t.gravityAcceleration + (fastFallActive ? t.fastFallAcceleration : 0);

    // Signed speed along gravity ("down" is positive).
    const velAlongG =
      state.velocity.x * g.x + state.velocity.y * g.y + state.velocity.z * g.z;
    let newVelAlongG = velAlongG + verticalAccel * context.dt;
    if (newVelAlongG > t.maxFallSpeed) newVelAlongG = t.maxFallSpeed;
    const gDelta = newVelAlongG - velAlongG;
    state.velocity.x += g.x * gDelta;
    state.velocity.y += g.y * gDelta;
    state.velocity.z += g.z * gDelta;

    // ------------------------------------------------------------------
    // 4. Jump (deterministic, hold-to-repeat after landing).
    //    Impulse ALONG +surfaceNormal, replacing the along-gravity component
    //    entirely: identical launch velocity every single time.
    // ------------------------------------------------------------------
    if (state.grounded && input.jump.held) {
      const n = frame.surfaceNormal;
      const alongG =
        state.velocity.x * g.x + state.velocity.y * g.y + state.velocity.z * g.z;
      const correction = -t.jumpImpulse - alongG;
      state.velocity.x += g.x * correction;
      state.velocity.y += g.y * correction;
      state.velocity.z += g.z * correction;
      void n;
      state.grounded = false;
      state.supportColliderId = null;
      context.jumpedThisStep = true;
    }

    // ------------------------------------------------------------------
    // 5. Forward speed: enforced constant along forwardAxis. The value is
    //    authoritative per-step data from the simulation (level base ×
    //    current speed multiplier); the controller applies, never decides.
    // ------------------------------------------------------------------
    const f = frame.forwardAxis;
    state.velocity.z = context.forwardSpeed * f.z;
  }
}
