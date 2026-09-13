import { clamp } from '../core/math';
import type { GameplayFrame } from './gameplayFrame';
import type { PlayerState } from './playerState';

/**
 * Shared lane kinematics (M8C): the accelerate → cruise → analytic-brake →
 * settle/snap policy in LANE-AXIS space, owned here and used by every
 * player-mode controller (Cube, Ship, Spider). One concept, one owner.
 *
 * Lane coordinate s = position · laneAxis; lane velocity vs = velocity ·
 * laneAxis. `laneCenters` arrive in world units along the lane axis'
 * dominant direction (X for Floor/Ceiling with laneAxis −X, Y for walls
 * with laneAxis +Y — see GameSimulation.activeLaneCenters); the laneSign
 * fold keeps the Floor convention (increasing index toward screen-right)
 * behaviorally identical. Computes velocities only — integration belongs
 * to the simulation. `dt` is always SIMULATION_DT in production.
 */
export function laneCenterForIndex(centers: readonly number[], index: number): number {
  const n = centers.length;
  if (n === 0) return 0;
  const first = centers[0] ?? 0;
  if (n === 1) return first;
  const last = centers[n - 1] ?? first;
  if (index < 0) {
    const second = centers[1] ?? first;
    return first + (first - second) * -index;
  }
  if (index > n - 1) {
    const secondLast = centers[n - 2] ?? last;
    return last + (last - secondLast) * (index - (n - 1));
  }
  return centers[index] ?? first;
}

export interface LaneTuning {
  laneAccel: number;
  laneMaxSpeed: number;
  laneBrakeDecel: number;
  laneMinApproachSpeed: number;
  laneTargetEpsilon: number;
  laneSnapSpeedEpsilon: number;
}

export function stepLaneKinematics(
  state: PlayerState,
  frame: Readonly<GameplayFrame>,
  laneCenters: readonly number[],
  tuning: LaneTuning,
  dt: number,
): void {
  const la = frame.laneAxis;
  const targetCenter = laneCenterForIndex(laneCenters, state.targetLaneIndex);
  const laneSign = la.x !== 0 ? Math.sign(la.x) : Math.sign(la.y);
  const sTarget = targetCenter * laneSign;
  const sPos = state.position.x * la.x + state.position.y * la.y + state.position.z * la.z;
  const sVel = state.velocity.x * la.x + state.velocity.y * la.y + state.velocity.z * la.z;
  const dx = sTarget - sPos;
  const absDx = Math.abs(dx);
  const absV = Math.abs(sVel);

  let desiredV: number;
  if (absDx <= tuning.laneTargetEpsilon) {
    if (absV <= tuning.laneSnapSpeedEpsilon) {
      const snap = sTarget - sPos;
      state.position.x += la.x * snap;
      state.position.y += la.y * snap;
      state.position.z += la.z * snap;
      state.velocity.x -= la.x * sVel;
      state.velocity.y -= la.y * sVel;
      state.velocity.z -= la.z * sVel;
      desiredV = 0;
    } else {
      desiredV = 0;
    }
  } else {
    const dir = Math.sign(dx);
    const stoppingSpeed = Math.sqrt(2 * tuning.laneBrakeDecel * absDx);
    const cappedSpeed = clamp(stoppingSpeed, tuning.laneMinApproachSpeed, tuning.laneMaxSpeed);
    desiredV = dir * cappedSpeed;
  }

  const sVelNow =
    state.velocity.x * la.x + state.velocity.y * la.y + state.velocity.z * la.z;
  const rate =
    Math.sign(sVelNow) === Math.sign(desiredV) && Math.abs(sVelNow) > Math.abs(desiredV)
      ? tuning.laneBrakeDecel
      : tuning.laneAccel;
  const dv = desiredV - sVelNow;
  const appliedDv = clamp(dv, -rate * dt, rate * dt);
  state.velocity.x += la.x * appliedDv;
  state.velocity.y += la.y * appliedDv;
  state.velocity.z += la.z * appliedDv;

  const speedCap = absDx / dt;
  const sVelFinal =
    state.velocity.x * la.x + state.velocity.y * la.y + state.velocity.z * la.z;
  if (Math.abs(sVelFinal) > speedCap) {
    const correction = Math.sign(sVelFinal) * speedCap - sVelFinal;
    state.velocity.x += la.x * correction;
    state.velocity.y += la.y * correction;
    state.velocity.z += la.z * correction;
  }
}
