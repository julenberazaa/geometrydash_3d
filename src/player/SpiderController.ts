import type { InputSnapshot } from '../input/InputSystem';
import { GameplayFrame } from './gameplayFrame';
import { stepLaneKinematics } from './laneKinematics';
import type { PlayerState } from './playerState';
import type { CubeTuning } from './cubeTuning';

/**
 * Deterministic Spider controller (M8C): runs like a Cube (same frozen
 * kinematic numbers — same world gravity, same lanes, same fast-fall) but
 * NEVER jumps. The primary PRESS is consumed by the SIMULATION as an
 * instant opposite-surface snap (`GameSimulation.trySpiderSnap`, which owns
 * the CollisionWorld query + hazard-path check the controller must never
 * touch). This controller only applies lane + gravity + forward per step.
 *
 * Sharing `CubeTuning` is deliberate: the Spider differs from the Cube by
 * snap-vs-jump, never by fall speed — one world, one gravity feel.
 */
export interface SpiderControllerStepContext {
  laneCenters: readonly number[];
  dt: number;
  forwardSpeed: number;
  frame?: Readonly<GameplayFrame>;
}

export class SpiderController {
  private frame: GameplayFrame;

  constructor() {
    this.frame = GameplayFrame.floor();
  }

  public setFrame(frame: GameplayFrame): void {
    this.frame = frame;
  }

  public step(
    state: PlayerState,
    input: Readonly<InputSnapshot>,
    context: SpiderControllerStepContext,
    tuning: CubeTuning,
  ): void {
    const frame = context.frame ?? this.frame;

    // 1. Lane intent — identical edge semantics to the Cube.
    if (input.laneLeft.pressedThisStep) state.targetLaneIndex -= 1;
    if (input.laneRight.pressedThisStep) state.targetLaneIndex += 1;
    stepLaneKinematics(state, frame, context.laneCenters, tuning, context.dt);

    // 2. Vertical kinematics along gravityVector (gravity + fast-fall +
    //    terminal speed — same frozen numbers as the Cube).
    const g = frame.gravityVector;
    const fastFallActive = !state.grounded && input.fastFall.held;
    const verticalAccel = tuning.gravityAcceleration + (fastFallActive ? tuning.fastFallAcceleration : 0);
    const v = state.velocity;
    const velAlongG = v.x * g.x + v.y * g.y + v.z * g.z;
    let newVelAlongG = velAlongG + verticalAccel * context.dt;
    if (newVelAlongG > tuning.maxFallSpeed) newVelAlongG = tuning.maxFallSpeed;
    const gDelta = newVelAlongG - velAlongG;
    v.x += g.x * gDelta;
    v.y += g.y * gDelta;
    v.z += g.z * gDelta;

    // 3. NO jump: the primary press snaps surfaces (simulation-owned).
    // 4. Forward speed: enforced constant along forwardAxis.
    const f = frame.forwardAxis;
    state.velocity.z = context.forwardSpeed * f.z;
  }
}
