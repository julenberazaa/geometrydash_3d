/**
 * Ship tuning (M8C): ALL Ship gameplay numbers live here — never in the
 * Cube tuning (Cube feel is frozen). Values target smooth continuous
 * vertical control: gravity pulls toward the support, thrust pushes away,
 * terminal speeds keep corridors fair at every speed tier.
 */
export interface ShipTuning {
  /** Gravity acceleration toward the support (units/s^2 along gravityVector). */
  gravityAcceleration: number;
  /** Thrust acceleration away from the support while primary is held. */
  thrustAcceleration: number;
  /** Terminal fall speed along gravity (units/s). */
  maxFallSpeed: number;
  /** Terminal rise speed against gravity (units/s). */
  maxRiseSpeed: number;
  /** Lateral lane response (shared lane-policy inputs — see laneKinematics). */
  laneAccel: number;
  laneMaxSpeed: number;
  laneBrakeDecel: number;
  laneMinApproachSpeed: number;
  laneTargetEpsilon: number;
  laneSnapSpeedEpsilon: number;
}

export const SHIP_TUNING: ShipTuning = {
  gravityAcceleration: 30,
  thrustAcceleration: 62,
  maxFallSpeed: 14,
  maxRiseSpeed: 12,
  laneAccel: 130,
  laneMaxSpeed: 17,
  laneBrakeDecel: 150,
  laneMinApproachSpeed: 1.4,
  laneTargetEpsilon: 0.03,
  laneSnapSpeedEpsilon: 0.6,
};
