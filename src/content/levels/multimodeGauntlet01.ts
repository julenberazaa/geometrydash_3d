import type { LevelDefinition } from '../../level/levelDefinition';
import { TEST_LEVEL } from './testLevel01';

/**
 * MULTIMODE GAUNTLET 01 (M8E) — the M8 integration/production level.
 *
 * Authored arc (base speed 14 u/s, finish z=1200 ≈ 86 s, medium-hard → hard):
 *   S1  z   0..150  Cube lava intro: two contained-basin gap jumps + a
 *                     sourced side composition (vent + fall + pool)
 *   S2  z 150..300  Maze run: three tall killFront walls with alternating
 *                     single-lane doors (readable, 30 u+ approaches)
 *   S3  z 300..540  Four-way gravity: floor → leftWall → ceiling →
 *                     rightWall → floor on continuous runways
 *   S4  z 540..710  Chomper lava biome: two timed lunges + side pools
 *   S5  z 710..860  Ship corridor: hold-to-rise, release-to-dive
 *   S6  z 860..990  Spider: snap up over a floor wall, snap back down
 *   S7  z 990..1130 Trap islands: center hops past spike-covered decoys
 *   S8  z1130..1200 Release runway → finish gate
 *
 * Conventions: runway tops at y=0 (center −0.5/half 0.5); lanes
 * [2.6, 0, −2.6]; jump envelope 8.8 u (gaps ≤ 6 u); maze doors 2.6 u wide
 * centered on a lane; Chomper triggers ≈10 u before the lunge line;
 * lava follows the sourced/contained contract (see `lavaAuthoring.ts`).
 */
export const MULTIMODE_GAUNTLET_01: LevelDefinition = {
  id: 'multimode-gauntlet-01',
  displayName: 'MULTIMODE GAUNTLET 01',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 14,
  finishZ: 1200,
  deathY: -14,
  deathYMax: 14,
  startGravityMode: 'floor',

  gravityPortals: [
    { id: 'mg-wall-left', z: 310, target: 'leftWall' },
    { id: 'mg-ceiling', z: 385, target: 'ceiling' },
    { id: 'mg-wall-right', z: 455, target: 'rightWall' },
    { id: 'mg-floor-again', z: 525, target: 'floor' },
  ],
  modePortals: [
    { id: 'mg-ship-on', z: 715, target: 'ship' },
    { id: 'mg-ship-off', z: 845, target: 'cube' },
    { id: 'mg-spider-on', z: 865, target: 'spider' },
    { id: 'mg-spider-off', z: 975, target: 'cube' },
  ],
  chompers: [
    {
      id: 'mg-chomp-1',
      dormant: { x: 8, y: 0.75, z: 610 },
      triggerZ: 600,
      lungeDirection: -1,
      lungeDistance: 16,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: 10, y: 2.5, z: 610 },
    },
    {
      id: 'mg-chomp-2',
      dormant: { x: -8, y: 0.75, z: 660 },
      triggerZ: 650,
      lungeDirection: 1,
      lungeDistance: 16,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: -10, y: 2.5, z: 660 },
    },
  ],
  lava: [
    // S1 gap basin 1 (pool top −2.4, z 40..46).
    { id: 'mg-gap1', center: { x: 0, y: -3.2, z: 43 }, halfExtents: { x: 4, y: 0.8, z: 3 }, role: 'pool' },
    // S1 gap basin 2 (pool top −2.4, z 90..96).
    { id: 'mg-gap2', center: { x: 0, y: -3.2, z: 93 }, halfExtents: { x: 4, y: 0.8, z: 3 }, role: 'pool' },
    // S1 side composition: vent on a rock pillar + dense fall into a
    // contained side pool (beside runway B, never on the route).
    { id: 'mg-side-source', center: { x: 10.6, y: 2.6, z: 68 }, halfExtents: { x: 0.6, y: 0.6, z: 1.2 }, role: 'source' },
    { id: 'mg-side-fall', center: { x: 9.4, y: -0.3, z: 68 }, halfExtents: { x: 0.9, y: 2.5, z: 1.0 }, role: 'fall' },
    { id: 'mg-side-pool', center: { x: 8, y: -3.2, z: 68 }, halfExtents: { x: 3, y: 0.8, z: 6 }, role: 'pool' },
    // S4 biome side pools (menace dressing, contained, off-route).
    { id: 'mg-biome-west', center: { x: -8.5, y: -3.2, z: 600 }, halfExtents: { x: 3, y: 0.8, z: 40 }, role: 'pool' },
    { id: 'mg-biome-east', center: { x: 8.5, y: -3.2, z: 600 }, halfExtents: { x: 3, y: 0.8, z: 40 }, role: 'pool' },
  ],

  solids: [
    // --- S1 runways (top y=0) + gap-basin containment (pool top −2) ---
    { center: { x: 0, y: -0.5, z: 15 }, halfExtents: { x: 5.4, y: 0.5, z: 25 } },
    { center: { x: 0, y: -0.5, z: 68 }, halfExtents: { x: 5.4, y: 0.5, z: 22 } },
    { center: { x: 0, y: -0.5, z: 123 }, halfExtents: { x: 5.4, y: 0.5, z: 27 } },
    // Gap basin 1 containment: floor (top −4) + x rims + z rims (tops −1.5).
    { center: { x: 0, y: -4.5, z: 43 }, halfExtents: { x: 4.5, y: 0.5, z: 3.5 } },
    { center: { x: -4.375, y: -2.25, z: 43 }, halfExtents: { x: 0.375, y: 0.75, z: 3.5 } },
    { center: { x: 4.375, y: -2.25, z: 43 }, halfExtents: { x: 0.375, y: 0.75, z: 3.5 } },
    { center: { x: 0, y: -2.25, z: 39.625 }, halfExtents: { x: 4.5, y: 0.75, z: 0.375 } },
    { center: { x: 0, y: -2.25, z: 46.375 }, halfExtents: { x: 4.5, y: 0.75, z: 0.375 } },
    // Gap basin 2 containment (same pattern at z 90..96).
    { center: { x: 0, y: -4.5, z: 93 }, halfExtents: { x: 4.5, y: 0.5, z: 3.5 } },
    { center: { x: -4.375, y: -2.25, z: 93 }, halfExtents: { x: 0.375, y: 0.75, z: 3.5 } },
    { center: { x: 4.375, y: -2.25, z: 93 }, halfExtents: { x: 0.375, y: 0.75, z: 3.5 } },
    { center: { x: 0, y: -2.25, z: 89.625 }, halfExtents: { x: 4.5, y: 0.75, z: 0.375 } },
    { center: { x: 0, y: -2.25, z: 96.375 }, halfExtents: { x: 4.5, y: 0.75, z: 0.375 } },
    // Side-composition rock pillar (the vent attaches to its route-facing side).
    { center: { x: 12, y: 0, z: 68 }, halfExtents: { x: 1.5, y: 5, z: 2.5 } },
    // Side-pool containment: floor (top −4) + rims (tops −1.5).
    { center: { x: 8, y: -4.5, z: 68 }, halfExtents: { x: 3.5, y: 0.5, z: 6.5 } },
    { center: { x: 4.625, y: -2.25, z: 68 }, halfExtents: { x: 0.375, y: 0.75, z: 6.5 } },
    { center: { x: 8, y: -2.25, z: 61.625 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },
    { center: { x: 8, y: -2.25, z: 74.375 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },

    // --- S2 maze runway (decision walls live in `hazards` as killFront) ---
    { center: { x: 0, y: -0.5, z: 225 }, halfExtents: { x: 5.4, y: 0.5, z: 75 } },

    // --- S3 four-way gravity: continuous floor + wall/ceiling slabs ---
    { center: { x: 0, y: -0.5, z: 420 }, halfExtents: { x: 5.4, y: 0.5, z: 120 } },
    // Left-wall run surface (face x=5.4, z 310..385).
    { center: { x: 5.9, y: 3, z: 347.5 }, halfExtents: { x: 0.5, y: 4, z: 37.5 } },
    // Ceiling run surface (face y=6, z 380..460).
    { center: { x: 0, y: 6.5, z: 420 }, halfExtents: { x: 5.4, y: 0.5, z: 40 } },
    // Right-wall run surface (face x=−5.4, z 450..530).
    { center: { x: -5.9, y: 3, z: 490 }, halfExtents: { x: 0.5, y: 4, z: 40 } },

    // --- S4 Chomper biome runway (to z=716: the ship portal handoff) ---
    { center: { x: 0, y: -0.5, z: 628 }, halfExtents: { x: 5.4, y: 0.5, z: 88 } },
    { center: { x: -8.5, y: -4.5, z: 600 }, halfExtents: { x: 3.5, y: 0.5, z: 40.5 } },
    { center: { x: -11.625, y: -2.25, z: 600 }, halfExtents: { x: 0.375, y: 0.75, z: 40.5 } },
    { center: { x: -8.5, y: -2.25, z: 559.625 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },
    { center: { x: -8.5, y: -2.25, z: 640.375 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },
    { center: { x: 8.5, y: -4.5, z: 600 }, halfExtents: { x: 3.5, y: 0.5, z: 40.5 } },
    { center: { x: 11.625, y: -2.25, z: 600 }, halfExtents: { x: 0.375, y: 0.75, z: 40.5 } },
    { center: { x: 8.5, y: -2.25, z: 559.625 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },
    { center: { x: 8.5, y: -2.25, z: 640.375 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },

    // --- S5 ship corridor (floor top −3, ceiling bottom 9) + obstacles ---
    { center: { x: 0, y: -3.5, z: 785 }, halfExtents: { x: 6, y: 0.5, z: 75 } },
    { center: { x: 0, y: 9.5, z: 785 }, halfExtents: { x: 6, y: 0.5, z: 75 } },
    // Rise-over wall (top y=0, z 744..748).
    { center: { x: 0, y: -1.5, z: 746 }, halfExtents: { x: 5.4, y: 1.5, z: 2 } },
    // Dive-under block (bottom y=7, z 790..796).
    { center: { x: 0, y: 8, z: 793 }, halfExtents: { x: 5.4, y: 1, z: 3 } },
    // Ship-exit landing runway (top y=0, z 845..875).
    { center: { x: 0, y: -0.5, z: 860 }, halfExtents: { x: 5.4, y: 0.5, z: 15 } },

    // --- S6 spider: floor runway + ceiling slab (the dodge wall below is
    // a killFront hazard: staying low kills frontally, snapping up survives)
    { center: { x: 0, y: -0.5, z: 932.5 }, halfExtents: { x: 5.4, y: 0.5, z: 57.5 } },
    // Ceiling snap surface (face y=6, z 875..960).
    { center: { x: 0, y: 6.5, z: 917.5 }, halfExtents: { x: 5.4, y: 0.5, z: 42.5 } },

    // --- S7 trap islands (center hops + spike-covered decoys) ---
    { center: { x: 0, y: -0.5, z: 995 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: 0, y: -0.5, z: 1010 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: 3.9, y: -0.5, z: 1010 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: -3.9, y: -0.5, z: 1010 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: 0, y: -0.5, z: 1025 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: 3.9, y: -0.5, z: 1025 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: -3.9, y: -0.5, z: 1025 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    // --- S8 release runway ---
    { center: { x: 0, y: -0.5, z: 1120 }, halfExtents: { x: 5.4, y: 0.5, z: 90 } },
  ],

  hazards: [
    // S2 maze decision walls (killFront: frontal contact kills, side scrape
    // blocks; tops y=7 unjumpable; doors 2.6 u on a lane center).
    // Wall 1 (z 180): door on lane 0 (x 1.3..3.9).
    { kind: 'killFront', visual: 'block', center: { x: 5.95, y: 3.5, z: 180 }, halfExtents: { x: 2.05, y: 3.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -3.35, y: 3.5, z: 180 }, halfExtents: { x: 4.65, y: 3.5, z: 0.5 } },
    // Wall 2 (z 215): door on lane 2 (x −3.9..−1.3).
    { kind: 'killFront', visual: 'block', center: { x: 3.35, y: 3.5, z: 215 }, halfExtents: { x: 4.65, y: 3.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -5.95, y: 3.5, z: 215 }, halfExtents: { x: 2.05, y: 3.5, z: 0.5 } },
    // Wall 3 (z 250): door on lane 1 (x −1.3..1.3).
    { kind: 'killFront', visual: 'block', center: { x: 4.65, y: 3.5, z: 250 }, halfExtents: { x: 3.35, y: 3.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -4.65, y: 3.5, z: 250 }, halfExtents: { x: 3.35, y: 3.5, z: 0.5 } },
    // S6 spider dodge wall (y 0..3, z 905..908): ceiling riders pass over.
    { kind: 'killFront', visual: 'block', center: { x: 0, y: 1.5, z: 906.5 }, halfExtents: { x: 5.4, y: 1.5, z: 1.5 } },
    // S7 decoy spikes: dense, visibly dangerous, never on the center route.
    { kind: 'hazard', visual: 'spike', center: { x: 3.9, y: 0.25, z: 1008 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 3.9, y: 0.25, z: 1012 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -3.9, y: 0.25, z: 1008 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -3.9, y: 0.25, z: 1012 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 3.9, y: 0.25, z: 1023 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 3.9, y: 0.25, z: 1027 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -3.9, y: 0.25, z: 1023 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -3.9, y: 0.25, z: 1027 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
  ],
  theme: TEST_LEVEL.theme,
};
