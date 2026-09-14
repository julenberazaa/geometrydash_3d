import type { LevelDefinition } from '../../level/levelDefinition';
import { TEST_LEVEL } from './testLevel01';

/**
 * MULTIMODE GAUNTLET 01 (M8E) — the M8 integration/production level.
 *
 * Authored arc (base speed 14 u/s, finish z=1200 ≈ 86 s, medium-hard → hard):
 *   S1  z   0..150  Cube lava intro: two SOURCED gap-river jumps (twin
 *                     vent pillars + falls pouring into the basins) + an
 *                     at-grade lava river curb crossing the route at
 *                     z 128..131 (3 u hop) + a sourced side composition
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
  // M8.2 runaway catcher: with opening-sized gates a missed S3 wall gate
  // can leave the rider drifting sideways off the corridor (wall gravity
  // pulls along ±X with no surface ahead). Legit play never exceeds |x| 8
  // (maze/chomper/tunnel play stays inside ±6); ±11 ends a lost run by
  // routing failure instead of drifting forever.
  deathXMin: -11,
  deathXMax: 11,
  startGravityMode: 'floor',

  // M8.2 TRUE bounded gates: every trigger volume matches its visible
  // ring opening (ring radius + 0.15 — enforced by validatePortalBounds),
  // centered on the PROBED rider line at the gate (M8.1 corridor-sized
  // boxes fired from units beside the visible ring — the reported bug).
  // Missing a gravity gate leaves the player on the wrong surface, where
  // the S3 floor routing gaps or the side runaway bounds (deathX ±11)
  // end the run by geometry; missing a mode gate meets the corridor's own
  // walls (ship) or the dodge wall (spider) — never an arbitrary kill.
  gravityPortals: [
    {
      id: 'mg-wall-left', z: 310, target: 'leftWall',
      triggerCenter: { x: 0, y: 1.5, z: 310 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // Left-wall rider line ≈ (4.85, 1.1): gate hugs the wall face
      // (ring clears the rock by 0.05 — a gate mounted on the wall).
      id: 'mg-ceiling', z: 385, target: 'ceiling',
      triggerCenter: { x: 3.9, y: 2, z: 385 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // Ceiling rider line ≈ (0, 5.45): gate hangs under the slab
      // (ring top 0.15 below the rock — a gate in the ceiling run).
      id: 'mg-wall-right', z: 455, target: 'rightWall',
      triggerCenter: { x: 0, y: 4.4, z: 455 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // Right-wall rider line ≈ (−4.85, 2.6): mirrored wall gate.
      id: 'mg-floor-again', z: 525, target: 'floor',
      triggerCenter: { x: -3.9, y: 3, z: 525 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
  ],
  modePortals: [
    {
      id: 'mg-ship-on', z: 715, target: 'ship',
      triggerCenter: { x: 0, y: 1.5, z: 715 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
    {
      // Ship flight line crosses z 845 at y ≈ 4.4 (descending from the
      // dive-under block toward the runway — probed, deterministic).
      id: 'mg-ship-off', z: 845, target: 'cube',
      triggerCenter: { x: 0, y: 4.4, z: 845 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
    {
      id: 'mg-spider-on', z: 865, target: 'spider',
      triggerCenter: { x: 0, y: 1.5, z: 865 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
    {
      id: 'mg-spider-off', z: 975, target: 'cube',
      triggerCenter: { x: 0, y: 1.5, z: 975 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
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
    // S1 gap basin 1 (pool top −2.4, z 40..46) — M8.1 sourced river: rock
    // pillars flank the gap, vent mouths feed blocky falls that pour over
    // the basin rims into the pool (jump line center stays clear).
    { id: 'mg-gap1', center: { x: 0, y: -3.2, z: 43 }, halfExtents: { x: 4, y: 0.8, z: 3 }, role: 'pool' },
    { id: 'mg-gap1-src-l', center: { x: -4.2, y: 0.5, z: 43 }, halfExtents: { x: 1.3, y: 0.6, z: 1 }, role: 'source' },
    { id: 'mg-gap1-fall-l', center: { x: -4, y: -1.2, z: 43 }, halfExtents: { x: 0.7, y: 1.4, z: 0.9 }, role: 'fall' },
    { id: 'mg-gap1-src-r', center: { x: 4.2, y: 0.5, z: 43 }, halfExtents: { x: 1.3, y: 0.6, z: 1 }, role: 'source' },
    { id: 'mg-gap1-fall-r', center: { x: 4, y: -1.2, z: 43 }, halfExtents: { x: 0.7, y: 1.4, z: 0.9 }, role: 'fall' },
    // S1 gap basin 2 (pool top −2.4, z 90..96) — same sourced treatment.
    { id: 'mg-gap2', center: { x: 0, y: -3.2, z: 93 }, halfExtents: { x: 4, y: 0.8, z: 3 }, role: 'pool' },
    { id: 'mg-gap2-src-l', center: { x: -4.2, y: 0.5, z: 93 }, halfExtents: { x: 1.3, y: 0.6, z: 1 }, role: 'source' },
    { id: 'mg-gap2-fall-l', center: { x: -4, y: -1.2, z: 93 }, halfExtents: { x: 0.7, y: 1.4, z: 0.9 }, role: 'fall' },
    { id: 'mg-gap2-src-r', center: { x: 4.2, y: 0.5, z: 93 }, halfExtents: { x: 1.3, y: 0.6, z: 1 }, role: 'source' },
    { id: 'mg-gap2-fall-r', center: { x: 4, y: -1.2, z: 93 }, halfExtents: { x: 0.7, y: 1.4, z: 0.9 }, role: 'fall' },
    // S1 lava river crossing (M8.1): an at-grade lava curb (pool top 0.7,
    // z 128..131) flows across the route and MUST be jumped (3 u hop).
    // Twin rock pillars on the route edges carry vent mouths; blocky falls
    // pour from the vents into the strip ends. Center jump line is clear.
    { id: 'mg-river', center: { x: 0, y: 0.1, z: 129.5 }, halfExtents: { x: 4, y: 0.6, z: 1.5 }, role: 'pool' },
    { id: 'mg-river-src-l', center: { x: -4.2, y: 2.9, z: 129.5 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
    { id: 'mg-river-fall-l', center: { x: -4.2, y: 1.5, z: 129.5 }, halfExtents: { x: 0.6, y: 1, z: 0.8 }, role: 'fall' },
    { id: 'mg-river-src-r', center: { x: 4.2, y: 2.9, z: 129.5 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
    { id: 'mg-river-fall-r', center: { x: 4.2, y: 1.5, z: 129.5 }, halfExtents: { x: 0.6, y: 1, z: 0.8 }, role: 'fall' },
    // S1 side composition: vent on a rock pillar + dense fall into a
    // contained side pool (beside runway B, never on the route).
    { id: 'mg-side-source', center: { x: 10.2, y: 2.6, z: 68 }, halfExtents: { x: 0.6, y: 0.6, z: 1.2 }, role: 'source' },
    { id: 'mg-side-fall', center: { x: 9.4, y: -0.3, z: 68 }, halfExtents: { x: 0.9, y: 2.5, z: 1.0 }, role: 'fall' },
    { id: 'mg-side-pool', center: { x: 8, y: -3.2, z: 68 }, halfExtents: { x: 3, y: 0.8, z: 6 }, role: 'pool' },
    // S4 biome side pools (menace dressing, contained, off-route).
    { id: 'mg-biome-west', center: { x: -8.5, y: -3.2, z: 600 }, halfExtents: { x: 3, y: 0.8, z: 40 }, role: 'pool' },
    { id: 'mg-biome-east', center: { x: 8.5, y: -3.2, z: 600 }, halfExtents: { x: 3, y: 0.8, z: 40 }, role: 'pool' },
  ],

  solids: [
    // --- S1 runways (top y=0) + gap-basin containment (pool top −2) ---
    { center: { x: 0, y: -0.5, z: 15 }, halfExtents: { x: 5.4, y: 0.5, z: 25 } },
    // NOTE (M8.1): the z 96..150 runway now carries the at-grade lava river
    // at z 128..131 — same slab, no Z shift for downstream sections.
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

    // S1 gap-river rock pillars (vent sources attach to their inner faces;
    // clear of the center jump line, standing on the basin floors).
    { center: { x: -6.5, y: -1, z: 43 }, halfExtents: { x: 1, y: 3, z: 1.5 } },
    { center: { x: 6.5, y: -1, z: 43 }, halfExtents: { x: 1, y: 3, z: 1.5 } },
    { center: { x: -6.5, y: -1, z: 93 }, halfExtents: { x: 1, y: 3, z: 1.5 } },
    { center: { x: 6.5, y: -1, z: 93 }, halfExtents: { x: 1, y: 3, z: 1.5 } },
    // S1 river-crossing pillars + strip curbs (at-grade lava gate, z 128..131).
    { center: { x: -4.9, y: 1.75, z: 129.5 }, halfExtents: { x: 0.5, y: 1.75, z: 1 } },
    { center: { x: 4.9, y: 1.75, z: 129.5 }, halfExtents: { x: 0.5, y: 1.75, z: 1 } },
    { center: { x: -4.375, y: -0.1, z: 129.5 }, halfExtents: { x: 0.375, y: 0.75, z: 1.75 } },
    { center: { x: 4.375, y: -0.1, z: 129.5 }, halfExtents: { x: 0.375, y: 0.75, z: 1.75 } },

    // --- S2 maze runway (decision walls live in `hazards` as killFront) ---
    { center: { x: 0, y: -0.5, z: 225 }, halfExtents: { x: 5.4, y: 0.5, z: 75 } },

    // --- S3 four-way gravity: wall/ceiling slabs + a floor with routing gaps.
    // M8.1 mandatory-routing consequence: the floor is cut at z 320..330 /
    // 395..405 / 465..475 (10 u — unjumpable). Wall/ceiling riders cross
    // above on their own surfaces; anyone who missed a gravity gate and is
    // still on the floor falls to the void BY GEOMETRY (never an
    // arbitrary kill). Transition landings (310->317, 385->390, 455->462,
    // 525->532) all sit on solid segments.
    { center: { x: 0, y: -0.5, z: 310 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
    { center: { x: 0, y: -0.5, z: 362.5 }, halfExtents: { x: 5.4, y: 0.5, z: 32.5 } },
    { center: { x: 0, y: -0.5, z: 435 }, halfExtents: { x: 5.4, y: 0.5, z: 30 } },
    { center: { x: 0, y: -0.5, z: 507.5 }, halfExtents: { x: 5.4, y: 0.5, z: 32.5 } },
    // M8.1 ship tunnel walls (D): the corridor reads as a guided flight
    // space — floor, ceiling AND visible side walls (z 710..860). The ship
    // keeps full control authority inside; the tunnel bounds the route.
    { center: { x: -6.5, y: 3, z: 785 }, halfExtents: { x: 0.5, y: 6, z: 75 } },
    { center: { x: 6.5, y: 3, z: 785 }, halfExtents: { x: 0.5, y: 6, z: 75 } },
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
    // M8.1 gate pylons: low killFront posts flanking the floor-approach
    // portals (visible doorways; frontal contact kills, side scrape blocks).
    // Ship/spider gates get tighter pairs; the ship-tunnel walls above are
    // the corridor's own outer bound (posts sit inside, clear of lane 1).
    { kind: 'killFront', visual: 'block', center: { x: -4.9, y: 1.25, z: 310 }, halfExtents: { x: 0.4, y: 1.25, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 4.9, y: 1.25, z: 310 }, halfExtents: { x: 0.4, y: 1.25, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -3.4, y: 1.25, z: 715 }, halfExtents: { x: 0.4, y: 1.25, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 3.4, y: 1.25, z: 715 }, halfExtents: { x: 0.4, y: 1.25, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -3.4, y: 1.25, z: 865 }, halfExtents: { x: 0.4, y: 1.25, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 3.4, y: 1.25, z: 865 }, halfExtents: { x: 0.4, y: 1.25, z: 0.5 } },
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
