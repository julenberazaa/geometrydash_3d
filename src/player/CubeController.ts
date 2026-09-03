import type { InputSnapshot } from '../input/InputSystem';
import { clamp } from '../core/math';
import { GameplayFrame } from './gameplayFrame';
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
 *   5. forward speed enforced constant along forwardAxis (future speed portals
 *      scale this value; no other integration changes)
 */
export interface CubeControllerStepContext {
  /** World-space lane centers along the lane axis, indexed by lane index. */
  laneCenters: readonly number[];
  /** Fixed delta seconds (always SIMULATION_DT in production). */
  dt: number;
  /** Output: true when a jump was initiated this step. */
  jumpedThisStep: boolean;
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
    const frame = this.frame;

    // ------------------------------------------------------------------
    // 1. Lane intent — EDGE-TRIGGERED ONLY.
    //    A physical tap must produce exactly ONE lane change even when the
    //    key event spans multiple simulation steps; holding a lane key does
    //    NOT slide across lanes (precision arcade semantics).
    // ------------------------------------------------------------------
    if (input.laneLeft.pressedThisStep) {
      state.targetLaneIndex = clamp(state.targetLaneIndex - 1, 0, state.laneCount - 1);
    }
    if (input.laneRight.pressedThisStep) {
      state.targetLaneIndex = clamp(state.targetLaneIndex + 1, 0, state.laneCount - 1);
    }

    // ------------------------------------------------------------------
    // 2. Lateral kinematics (along laneAxis; M1: world X).
    // ------------------------------------------------------------------
    const laneCount = context.laneCenters.length;
    const safeIndex = clamp(state.targetLaneIndex, 0, laneCount - 1);
    const targetCenter = context.laneCenters[safeIndex] ?? 0;
    const dx = targetCenter - state.position.x;
    const absDx = Math.abs(dx);
    const v = state.velocity.x;
    const absV = Math.abs(v);

    let desiredV: number;
    if (absDx <= t.laneTargetEpsilon) {
      if (absV <= t.laneSnapSpeedEpsilon) {
        // Stabilization: physically arrived; tiny final snap onto exact center.
        state.position.x = targetCenter;
        state.velocity.x = 0;
        desiredV = 0;
      } else {
        desiredV = 0; // still fast inside epsilon -> brake this step
      }
    } else {
      const dir = Math.sign(dx);
      // Speed that exactly stops at the target under laneBrakeDecel...
      const stoppingSpeed = Math.sqrt(2 * t.laneBrakeDecel * absDx);
      // ...but never below the minimum approach speed (no asymptotic creep).
      const cappedSpeed = clamp(stoppingSpeed, t.laneMinApproachSpeed, t.laneMaxSpeed);
      desiredV = dir * cappedSpeed;
    }

    // Rate-limited approach to desiredV, then HARD geometric caps:
    // the velocity may never exceed absDx/dt toward the target, so the
    // integration step (done by the simulation through the collision world)
    // can never cross the lane center. No position mutation here — the
    // controller computes velocities only; GameSimulation integrates.
    const rate =
      Math.sign(state.velocity.x) === Math.sign(desiredV) &&
      Math.abs(state.velocity.x) > Math.abs(desiredV)
        ? t.laneBrakeDecel
        : t.laneAccel;
    const dv = desiredV - state.velocity.x;
    const maxDv = rate * context.dt;
    state.velocity.x += clamp(dv, -maxDv, maxDv);

    const speedCap = absDx / context.dt;
    if (Math.abs(state.velocity.x) > speedCap) {
      state.velocity.x = Math.sign(state.velocity.x) * speedCap;
    }

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
    // 5. Forward speed: enforced constant along forwardAxis.
    // ------------------------------------------------------------------
    const f = frame.forwardAxis;
    state.velocity.z = t.baseForwardSpeed * f.z;
  }
}
