import type { MovingPlatformDef } from '../level/levelDefinition';

/**
 * Deterministic moving-platform kinematics (M8.6) — the ONE owner of
 * platform pose math. Pure fixed-tick functions (no THREE, no DOM, no
 * world queries): `GameSimulation` owns the tick counter, the state array,
 * carriage, collision integration and reset; this module owns the
 * trajectory so tests and the sim share one implementation.
 *
 * Trajectory (pingpong triangular wave, tick-derived — no runtime state
 * beyond the sim's integer tick):
 *   phase = ((tick + phaseTicks) mod periodTicks) / periodTicks ∈ [0,1)
 *   tri = phase < 0.5 ? 2*phase : 2-2*phase   (0 → 1 → 0, continuous)
 *   offset = (2*tri − 1) * amplitude          (−amp → +amp → −amp)
 * At tick 0 the platform rests at one travel end (offset −amplitude), so
 * authored `base` is the MID-travel center. Turnarounds are velocity
 * reversals with continuous position — carriage (exact displacement)
 * keeps riders glued through them with no launch velocity.
 */
export interface MovingPlatformState {
  /** Current hitbox center (world). */
  x: number;
  y: number;
  z: number;
  /** Previous-step center (carriage displacement + renderer interpolation). */
  px: number;
  py: number;
  pz: number;
}

export const createMovingPlatformState = (def: MovingPlatformDef): MovingPlatformState => {
  const pose = { x: def.base.x, y: def.base.y, z: def.base.z };
  platformPose(def, 0, pose);
  return { x: pose.x, y: pose.y, z: pose.z, px: pose.x, py: pose.y, pz: pose.z };
};

export const resetMovingPlatformState = (
  state: MovingPlatformState,
  def: MovingPlatformDef,
): void => {
  const pose = { x: def.base.x, y: def.base.y, z: def.base.z };
  platformPose(def, 0, pose);
  state.x = pose.x;
  state.y = pose.y;
  state.z = pose.z;
  state.px = pose.x;
  state.py = pose.y;
  state.pz = pose.z;
};

/** Pose center at integer `tick` into `out` (caller-owned, hot loop). */
export const platformPose = (
  def: MovingPlatformDef,
  tick: number,
  out: { x: number; y: number; z: number },
): void => {
  const period = Math.max(1, Math.floor(def.periodTicks));
  const raw = (tick + Math.floor(def.phaseTicks)) % period;
  const wrapped = raw < 0 ? raw + period : raw;
  const phase = wrapped / period;
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const offset = (tri * 2 - 1) * def.amplitude;
  out.x = def.base.x + (def.axis === 'x' ? offset : 0);
  out.y = def.base.y + (def.axis === 'y' ? offset : 0);
  out.z = def.base.z;
};

/**
 * Advance one fixed step: snapshot prev, write the tick pose. The caller
 * owns the tick counter (reset on respawn, +1 per running step —
 * deterministic given the input tape, same argument as Chomper
 * `ticksInPhase`).
 */
export const stepMovingPlatform = (
  state: MovingPlatformState,
  def: MovingPlatformDef,
  tick: number,
): void => {
  state.px = state.x;
  state.py = state.y;
  state.pz = state.z;
  const pose = { x: state.x, y: state.y, z: state.z };
  platformPose(def, tick, pose);
  state.x = pose.x;
  state.y = pose.y;
  state.z = pose.z;
};

/** Peak travel speed in world units per tick (authoring guard input). */
export const platformPeakSpeed = (def: MovingPlatformDef): number =>
  (4 * Math.abs(def.amplitude)) / Math.max(1, def.periodTicks);
