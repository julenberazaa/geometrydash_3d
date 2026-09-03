import type { LevelDefinition } from '../../level/levelDefinition';

/**
 * Controller test track (M1). Designed to EXPOSE controller defects, not to be
 * a showcase (spec §22). All geometry verified against controller limits:
 *
 *   max jump height ≈ 2.07 units  |  full-jump distance ≈ 8.8 units at speed 14
 *   => every gap is <= 6.5 units; every climbable step is <= 1.7 units.
 *
 *   z  -4..46   generous flat runway (3 lane markers between lanes)
 *   z  48..58   low platform hop (top y=0.8)
 *   z  62..76   elevated platform (top y=1.6), hold-jump chain practice
 *   z  78..84.5 GAP (void death if missed) -> landing pad to z=96
 *   z  92.5     wall blocking RIGHT lane -> forced left lane change
 *   z 106..122  spike weave: safe lane alternates center / right
 *
 * Screen-side convention (M1.1): the +Z chase camera shows world −X on
 * screen-right, so laneCenters are ordered index -> screen-left/center/right
 * ([+2.6, 0, -2.6]) and every asymmetric feature is mirrored accordingly:
 * "right" in the comments below always means screen-right (world −X).
 *   z 124..131  GAP -> elevated island (top y=1.2) z 133..141
 *   z 143..149  GAP -> center island (narrow) z 151..157
 *   z 159..176  final straight runway to finish gate
 */
export const TEST_LEVEL: LevelDefinition = {
  id: 'controller-test-01',
  displayName: 'CONTROLLER TEST 01',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6], // index 0 = screen-left, 1 = center, 2 = screen-right
  baseForwardSpeed: 14,
  finishZ: 170,
  deathY: -14,

  solids: [
    // --- Main runway A: x -5.4..5.4, top y=0, z -10..30 ---
    { center: { x: 0, y: -0.5, z: 10 }, halfExtents: { x: 5.4, y: 0.5, z: 20 } },
    // --- Runway B: z 30..47 ---
    { center: { x: 0, y: -0.5, z: 38.5 }, halfExtents: { x: 5.4, y: 0.5, z: 8.5 } },
    // Lane marker blocks BETWEEN lanes (small, cosmetic rhythm obstacles)
    { center: { x: -1.3, y: -0.15, z: 34 }, halfExtents: { x: 0.35, y: 0.35, z: 0.35 } },
    { center: { x: 1.3, y: -0.15, z: 37 }, halfExtents: { x: 0.35, y: 0.35, z: 0.35 } },
    { center: { x: -1.3, y: -0.15, z: 40 }, halfExtents: { x: 0.35, y: 0.35, z: 0.35 } },

    // --- Low platform hop: top y=0.8, z 48..58 ---
    { center: { x: 0, y: 0.4, z: 53 }, halfExtents: { x: 5.4, y: 0.4, z: 5 } },

    // --- Elevated platform: top y=1.6, z 62..76 ---
    { center: { x: 0, y: 0.8, z: 69 }, halfExtents: { x: 5.4, y: 0.8, z: 7 } },

    // --- GAP z 76..84.5 (8.5 units — jumpable) ---

    // --- Landing pad: top y=0, z 84.5..96 ---
    { center: { x: 0, y: -0.5, z: 90.25 }, halfExtents: { x: 5.4, y: 0.5, z: 5.75 } },
    // Wall blocking RIGHT lane only (screen-right = world −X): x −3.9..−1.95, z 92..93, tall enough that jumping over is not intended
    { center: { x: -2.925, y: 2.0, z: 92.5 }, halfExtents: { x: 0.975, y: 2.0, z: 0.5 } },

    // --- Weave runway: top y=0, z 96..122 ---
    { center: { x: 0, y: -0.5, z: 109 }, halfExtents: { x: 5.4, y: 0.5, z: 13 } },

    // --- GAP z 122..129.5 -> elevated island: top y=1.2, z 129.5..141 ---
    { center: { x: 0, y: 0.6, z: 135.25 }, halfExtents: { x: 5.4, y: 0.6, z: 5.75 } },

    // --- GAP z 141..148.5 -> center island (narrow): top y=0, z 148.5..154.5 ---
    { center: { x: 0, y: -0.5, z: 151.5 }, halfExtents: { x: 2.6, y: 0.5, z: 3 } },

    // --- Final runway: top y=0, z 157..176 ---
    { center: { x: 0, y: -0.5, z: 166.5 }, halfExtents: { x: 5.4, y: 0.5, z: 9.5 } },
  ],

  hazards: [
    // Spike row z=108: LEFT+RIGHT dangerous -> center lane safe
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 108 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 108 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Spike row z=116: CENTER+LEFT dangerous -> right lane safe
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 116 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 116 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
  ],

  theme: {
    background: 0x07040f,
    fogColor: 0x140b26,
    fogNear: 30,
    fogFar: 130,
    platform: 0x17122a,
    platformTop: 0x241b42,
    edge: 0xb44dff,
    hazard: 0xff9d00,
  },
};
