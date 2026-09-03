/**
 * Central Cube tuning. All gameplay magic numbers live here (see GAME_DESIGN.md).
 * Values are arcade feel-first; tune by playing, not by theory.
 */
export interface CubeTuning {
  /** Permanent forward speed in units/s along forwardAxis. */
  baseForwardSpeed: number;

  /** Gravity acceleration in units/s^2 toward gravityVector. */
  gravityAcceleration: number;
  /** Extra acceleration while fast-fall is held airborne. */
  fastFallAcceleration: number;
  /** Terminal downward speed (predictable collision windows). */
  maxFallSpeed: number;
  /** Deterministic jump impulse away from the gravity surface. */
  jumpImpulse: number;

  /** World-space distance between adjacent lane centers. */
  laneSpacing: number;

  /** Lateral acceleration toward the target lane (units/s^2). */
  laneAccel: number;
  /** Max lateral speed (units/s). */
  laneMaxSpeed: number;
  /** Deceleration used when approaching the target lane center (units/s^2). */
  laneBrakeDecel: number;
  /** Minimum approach speed near the target so arrival never asymptotically creeps. */
  laneMinApproachSpeed: number;
  /** Distance under which the lane is considered reached (stabilization snap zone). */
  laneTargetEpsilon: number;
  /** Lateral speed under which the stabilization snap may zero velocity. */
  laneSnapSpeedEpsilon: number;

  /** Full edge length of the gameplay hitbox cube. */
  colliderSize: number;
}

export const CUBE_TUNING: CubeTuning = {
  baseForwardSpeed: 14,

  gravityAcceleration: 42,
  fastFallAcceleration: 55,
  maxFallSpeed: 40,
  jumpImpulse: 13.2,

  laneSpacing: 2.6,

  laneAccel: 110,
  laneMaxSpeed: 16,
  laneBrakeDecel: 135,
  laneMinApproachSpeed: 1.4,
  laneTargetEpsilon: 0.03,
  laneSnapSpeedEpsilon: 0.6,

  colliderSize: 1.1,
};

/** Derived reference numbers (documented, not used directly by the sim): */
/** Jump apex height = jumpImpulse^2 / (2 * gravityAcceleration) ≈ 2.07 units. */
/** Full-jump airtime = 2 * jumpImpulse / gravityAcceleration ≈ 0.63 s (~8.8 units forward). */
