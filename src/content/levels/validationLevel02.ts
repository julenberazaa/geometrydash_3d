import type { LevelDefinition } from '../../level/levelDefinition';

/**
 * Validation Level 02 (M5) — the SECOND LEVEL ARCHITECTURE PROOF.
 *
 * A genuinely separate, deliberately compact (~20 s) data-driven level that
 * exercises a different cross-section of the shipped mechanics than
 * Test Level 01, with ZERO engine changes:
 *
 *   - different start lane (index 0 = screen-left) and a slower base speed
 *     (11 u/s vs 14);
 *   - spike weave with all three lanes used as the safe lane;
 *   - a plain gap jump;
 *   - gravity portal UP -> ceiling run;
 *   - CEILING jump pad over a 7.5 u ceiling gap (a plain ceiling jump is
 *     6.9 u — the pad is required; Test Level 01 only has a floor pad);
 *   - a ceiling gap jump;
 *   - gravity orb back down to the floor (press edge inside the window);
 *   - speed portal 2x -> a 11 u gap only crossable at 2x (a 1x jump is 6.9 u);
 *   - final spike weave + real finish gate.
 *
 * Deliberately NOT a copy/paste of Test Level 01 with new Z values, and NOT
 * the final production level: this is the portability/verification proof
 * (replays, fingerprints, registry selection, scripted playthrough).
 *
 * Geometry margins (jump impulse 13.2, gravity 42 => airtime 0.629 s,
 * apex 2.07 u; forward distance 6.9 u at 1x, 13.8 u at 2x; pad impulse 20 =>
 * airtime 0.952 s, 10.5 u forward):
 *   every gap here is <= 7.5 u (1x jump 6.9 u) except the two pad/2x-proofs.
 */
export const VALIDATION_LEVEL_02: LevelDefinition = {
  id: 'validation-02',
  displayName: 'VALIDATION LEVEL 02',
  start: { x: 2.6, y: 1.5, z: -4 },
  startLaneIndex: 0,
  laneCenters: [2.6, 0, -2.6], // index 0 = screen-left (same M1.1 convention)
  baseForwardSpeed: 11,
  finishZ: 258,
  deathY: -14,
  deathYMax: 12,
  startGravityMode: 'floor',
  gravityPortals: [{ id: 'v2-portal-up', z: 82, target: 'ceiling' }],
  speedPortals: [{ id: 'v2-speed-2x', z: 164, multiplier: 2 }],
  jumpPads: [
    {
      id: 'v2-pad-ceiling',
      center: { x: 0, y: 5.85, z: 108 },
      halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
      surface: 'ceiling',
      impulse: 20,
    },
  ],
  jumpOrbs: [],
  gravityOrbs: [
    {
      id: 'v2-orb-gravity',
      center: { x: 0, y: 3.4, z: 149 },
      halfExtents: { x: 0.9, y: 0.9, z: 0.8 },
    },
  ],

  solids: [
    // --- Runway A: top y=0, z -10..56 (spike weave: safe L -> C -> R) ---
    { center: { x: 0, y: -0.5, z: 23 }, halfExtents: { x: 5.4, y: 0.5, z: 33 } },
    // GAP z 56..61.5 (5.5 u — plain jump)
    // --- Runway B: top y=0, z 61.5..88 (portal up at z 82; rise lands ~z 87.3) ---
    { center: { x: 0, y: -0.5, z: 74.75 }, halfExtents: { x: 5.4, y: 0.5, z: 13.25 } },
    // --- Ceiling slab A: underside y=6, z 84..110 (ceiling pad at z 108) ---
    { center: { x: 0, y: 7, z: 97 }, halfExtents: { x: 5.4, y: 1, z: 13 } },
    // CEILING GAP z 110..117.5 (7.5 u — pad required: plain ceiling jump 6.9 u)
    // --- Ceiling slab B: underside y=6, z 117.5..135 (pad lands ~z 118.5) ---
    { center: { x: 0, y: 7, z: 126.25 }, halfExtents: { x: 5.4, y: 1, z: 8.75 } },
    // CEILING GAP z 135..140 (5 u — plain ceiling jump)
    // --- Ceiling slab C: underside y=6, z 140..156 (gravity orb at z 149) ---
    { center: { x: 0, y: 7, z: 148 }, halfExtents: { x: 5.4, y: 1, z: 8 } },
    // --- Floor runway D: top y=0, z 116..176 (orb flip lands ~z 153; 2x at 164) ---
    { center: { x: 0, y: -0.5, z: 146 }, halfExtents: { x: 5.4, y: 0.5, z: 30 } },
    // --- Runway E: top y=0, z 176..193 (2x gap takeoff) ---
    { center: { x: 0, y: -0.5, z: 184.5 }, halfExtents: { x: 5.4, y: 0.5, z: 8.5 } },
    // GAP z 193..204 (11 u — 2x jump 13.8 u; 1x jump 6.9 u CANNOT cross)
    // --- Runway F: top y=0, z 204..226 (spike row z 212: safe right) ---
    { center: { x: 0, y: -0.5, z: 215 }, halfExtents: { x: 5.4, y: 0.5, z: 11 } },
    // --- Runway G: top y=0, z 226..262 (finish at 258) ---
    { center: { x: 0, y: -0.5, z: 244 }, halfExtents: { x: 5.4, y: 0.5, z: 18 } },
  ],

  hazards: [
    // Spike row z=18: RIGHT+CENTER dangerous -> LEFT (start lane) safe
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 18 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 18 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Spike row z=30: LEFT+RIGHT dangerous -> CENTER safe
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 30 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 30 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Spike row z=44: CENTER+LEFT dangerous -> RIGHT safe
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 44 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 44 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Spike row z=212 (at 2x): CENTER+LEFT dangerous -> RIGHT safe
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 212 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 212 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
  ],

  theme: {
    background: 0x040a12,
    fogColor: 0x0a1a22,
    fogNear: 30,
    fogFar: 130,
    platform: 0x0f2027,
    platformTop: 0x16323a,
    edge: 0x18e0a0,
    hazard: 0xffb300,
  },
};
