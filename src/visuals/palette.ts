/**
 * Shared visual palette (original; inspired only by reference MOOD, not assets).
 */
export const PALETTE = {
  background: 0x07040f,
  fog: 0x140b26,
  platformBody: 0x17122a,
  platformTop: 0x241b42,
  // M3.1: unlit underside inset (ceiling run surface). Down-facing Lambert
  // surfaces receive only the near-black hemisphere ground light, so a lit
  // material can never read there; this dim unlit tone makes the ceiling
  // surface — and the Cube's contact with it — visible from the corridor
  // without glowing like an edge trim.
  platformUnder: 0x322858,
  platformEdge: 0xb44dff,
  hazardBody: 0x3a1500,
  hazardGlow: 0xff9d00,
  finishGate: 0xff4dd2,
  playerBody: 0x0a2b33,
  playerEdge: 0x19e6ff,
  playerFace: 0x7ff7ff,
  starField: 0x8f7bd8,
  // M3 gravity portals: cyan frame = flip UP to ceiling, warm frame = flip
  // DOWN to floor. Original colors; no reference assets involved.
  portalUp: 0x19e6ff,
  portalDown: 0xffb347,
  // M4 interactions. Color language: YELLOW family = jump impulse (pads and
  // jump orbs), BLUE family = gravity (gravity orb joins the portal cyan/blue
  // family), speed tiers get one color each plus chevron count = tier.
  padJump: 0xffc93a,
  orbJump: 0xffe14a,
  orbGravity: 0x4d7bff,
  interactionDim: 0x2a2a3a,
} as const;

/** Speed portal tier colors (M4): tier readable by color + chevron count. */
export const SPEED_TIER_COLORS: Readonly<Record<string, number>> = {
  '0.5': 0xff9d4a,
  '1': 0x4dc4ff,
  '2': 0x66ff8a,
  '3': 0xff4dd2,
  '4': 0xff4040,
};

/** Color for a speed multiplier tier (falls back to white for exotic tiers). */
export const speedTierColor = (multiplier: number): number =>
  SPEED_TIER_COLORS[String(multiplier)] ?? 0xffffff;
