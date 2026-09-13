import type { InputSnapshot } from '../input/InputSystem';
import { GameplayFrame } from './gameplayFrame';
import { stepLaneKinematics } from './laneKinematics';
import type { PlayerState } from './playerState';
import type { ShipTuning } from './shipTuning';

/**
 * Deterministic Ship controller (M8C): continuous flight, not jumping.
 *
 * Per step (fixed-tick, no physics engine):
 *   1. lane intent (same edge-triggered policy + shared lane kinematics —
 *      ships steer laterally where the architecture supports it)
 *   2. vertical control along the gameplay frame: gravity ALWAYS pulls
 *      toward the support; holding the PRIMARY action (Space / the logical
 *      jump action) thrusts AWAY from the support. Release = fall back.
 *      Both directions clamp at mode-owned terminal speeds.
 *   3. constant forward speed along forwardAxis (authoritative per-step
 *      value from the simulation — the controller never owns speed).
 *
 * Frame-generic by construction: every acceleration is expressed through
 * `gravityVector`/`surfaceNormal`, so all four gravity orientations work
 * with zero mode-specific branches. Computes velocities only.
 */
export interface ShipControllerStepContext {
  laneCenters: readonly number[];
  dt: number;
  forwardSpeed: number;
  /** Output: true while thrust is applied this step (renderer flame edge). */
  thrustingThisStep: boolean;
  frame?: Readonly<GameplayFrame>;
}

export class ShipController {
  private readonly tuning: ShipTuning;
  private frame: GameplayFrame;

  constructor(tuning: ShipTuning) {
    this.tuning = tuning;
    this.frame = GameplayFrame.floor();
  }

  public setFrame(frame: GameplayFrame): void {
    this.frame = frame;
  }

  public step(
    state: PlayerState,
    input: Readonly<InputSnapshot>,
    context: ShipControllerStepContext,
  ): void {
    const t = this.tuning;
    const frame = context.frame ?? this.frame;

    // 1. Lane intent — identical edge semantics to the Cube.
    if (input.laneLeft.pressedThisStep) state.targetLaneIndex -= 1;
    if (input.laneRight.pressedThisStep) state.targetLaneIndex += 1;
    stepLaneKinematics(state, frame, context.laneCenters, t, context.dt);

    // 2. Vertical flight: gravity toward the support every step; thrust
    //    away from it while the primary action is held. Signed speed s is
    //    measured along +gravity ("down" positive): gravity raises s,
    //    thrust lowers it; each side clamps at its terminal speed.
    const g = frame.gravityVector;
    const v = state.velocity;
    const thrusting = input.jump.held;
    const accel = thrusting
      ? t.gravityAcceleration - t.thrustAcceleration
      : t.gravityAcceleration;
    const alongG = v.x * g.x + v.y * g.y + v.z * g.z;
    let next = alongG + accel * context.dt;
    if (next > t.maxFallSpeed) next = t.maxFallSpeed;
    if (next < -t.maxRiseSpeed) next = -t.maxRiseSpeed;
    const delta = next - alongG;
    v.x += g.x * delta;
    v.y += g.y * delta;
    v.z += g.z * delta;
    context.thrustingThisStep = thrusting;

    // 3. Forward speed: enforced constant along forwardAxis.
    const f = frame.forwardAxis;
    state.velocity.z = context.forwardSpeed * f.z;
  }
}
