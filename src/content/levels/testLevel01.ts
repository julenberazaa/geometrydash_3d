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
 *   z 159..176  final runway of the original M1/M2 track
 *
 * M3 gravity section (appended; original content untouched):
 *   z 176..246  continuous floor runway
 *   z 182       gravity portal UP  -> ceiling (flip, rise ~4.9 u, grounds ~z 189)
 *   z 186..232  ceiling slab A (underside y=6) — ceiling run
 *   z 232..238  ceiling GAP (6 u — ceiling-jumpable; missed = upper void)
 *   z 238..254  ceiling slab B (underside y=6)
 *   z 248       gravity portal DOWN -> floor (fall ~4.9 u, lands ~z 256)
 *   z 246..278  final runway of the M3 section
 * Upper void bound y=12 terminates upward falls (ceiling side exit).
 *
 * M4 interaction section (appended; data-driven demo content, NOT the final
 * production level — deliberately generous margins):
 *   z 278..306  runway E (top y=0)
 *   z 305       JUMP PAD (floor, impulse 22 -> airtime ~1.05 s ~ 14.7 u at 1x)
 *   z 306..316  GAP (10 u — crossed by the pad launch; a plain jump cannot)
 *   z 316..332  runway F (top y=0)
 *   z 332..342  GAP (10 u — plain jump 8.8 u CANNOT cross)
 *   z 337       JUMP ORB (window y 1.3..3.1; press mid-air -> second impulse)
 *   z 342..358  runway G (top y=0)
 *   z 352       GRAVITY ORB (window y 1.5..3.3 — deliberately above the
 *               grounded envelope, so a press while grounded running cannot
 *               accidentally flip; requires a jump then a press)
 *   z 350..368  ceiling slab C (underside y=6) — gravity-orb landing
 *   z 364       gravity portal DOWN -> floor (fall, lands ~z 371)
 *   z 366..386  runway H (top y=0)
 *   z 372       SPEED PORTAL 2x (deterministic crossing demo)
 *   z 380       finish
 */
export const TEST_LEVEL: LevelDefinition = {
  id: 'controller-test-01',
  displayName: 'CONTROLLER TEST 01',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6], // index 0 = screen-left, 1 = center, 2 = screen-right
  baseForwardSpeed: 14,
  finishZ: 380,
  deathY: -14,
  deathYMax: 12,
  startGravityMode: 'floor',
  gravityPortals: [
    { id: 'portal-up-1', z: 182, target: 'ceiling' },
    { id: 'portal-down-1', z: 248, target: 'floor' },
    { id: 'portal-down-2', z: 364, target: 'floor' },
  ],
  speedPortals: [{ id: 'speed-2x-1', z: 372, multiplier: 2 }],
  jumpPads: [
    {
      id: 'pad-floor-1',
      center: { x: 0, y: 0.15, z: 305 },
      halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
      surface: 'floor',
      impulse: 22,
    },
  ],
  jumpOrbs: [
    {
      id: 'orb-jump-1',
      center: { x: 0, y: 2.2, z: 337 },
      halfExtents: { x: 0.9, y: 0.9, z: 0.9 },
      impulse: 13.2,
    },
  ],
  gravityOrbs: [
    {
      id: 'orb-gravity-1',
      center: { x: 0, y: 2.4, z: 352 },
      halfExtents: { x: 0.9, y: 0.9, z: 0.8 },
    },
  ],

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

    // --- Final runway of the original track: top y=0, z 157..176 ---

    { center: { x: 0, y: -0.5, z: 166.5 }, halfExtents: { x: 5.4, y: 0.5, z: 9.5 } },

    // --- M3 gravity section ---
    // Floor runway C: top y=0, z 176..246 (continuous under the ceiling run)
    { center: { x: 0, y: -0.5, z: 211 }, halfExtents: { x: 5.4, y: 0.5, z: 35 } },
    // Ceiling slab A: underside y=6, z 186..232 (ceiling run + rise landing)
    { center: { x: 0, y: 7, z: 209 }, halfExtents: { x: 5.4, y: 1, z: 23 } },
    // Ceiling GAP z 232..238 (6 u — ceiling jump; miss = upper void death)
    // Ceiling slab B: underside y=6, z 238..254
    { center: { x: 0, y: 7, z: 246 }, halfExtents: { x: 5.4, y: 1, z: 8 } },
    // Floor runway D: top y=0, z 246..278 (landing after portal-down)
    { center: { x: 0, y: -0.5, z: 262 }, halfExtents: { x: 5.4, y: 0.5, z: 16 } },

    // --- M4 interaction section ---
    // Runway E: top y=0, z 278..306 (jump pad sits at its far edge)
    { center: { x: 0, y: -0.5, z: 292 }, halfExtents: { x: 5.4, y: 0.5, z: 14 } },
    // GAP z 306..316 (10 u — crossed by the z=305 pad launch)
    // Runway F: top y=0, z 316..332
    { center: { x: 0, y: -0.5, z: 324 }, halfExtents: { x: 5.4, y: 0.5, z: 8 } },
    // GAP z 332..342 (10 u — plain jump cannot cross; jump orb at z 337)
    // Runway G: top y=0, z 342..358
    { center: { x: 0, y: -0.5, z: 350 }, halfExtents: { x: 5.4, y: 0.5, z: 8 } },
    // Ceiling slab C: underside y=6, z 350..368 (gravity-orb landing surface)
    { center: { x: 0, y: 7, z: 359 }, halfExtents: { x: 5.4, y: 1, z: 9 } },
    // Runway H: top y=0, z 366..386 (portal-down landing + 2x sprint + finish)
    { center: { x: 0, y: -0.5, z: 376 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
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
