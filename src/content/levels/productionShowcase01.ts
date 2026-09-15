import type { LevelDefinition } from '../../level/levelDefinition';
import { TEST_LEVEL } from './testLevel01';

/**
 * PRODUCTION SHOWCASE 01 — "THE DESCENT" (M8.5).
 *
 * The first superproduction level: ~2 minutes (finish z=1750, ≈122 s on the
 * reference route), HARD/EXPERT, multi-route, all three player modes, all
 * four gravity surfaces, inverted Ship, wall Spider, 4 Chompers, directed
 * lava rivers/falls/pools, a two-door labyrinth, a teleport network with a
 * route choice, speed escalation and a final gauntlet.
 *
 * Authored arc (base speed 14 u/s):
 *   ACT 1  z    0..210  THE FORGE — lava intro, gap basins, directed river,
 *                           lane-split block, telegraphed spikes
 *   ACT 2  z  210..380  FRACTURED ISLANDS — BRANCH 1 (short): precision
 *                           center chain (route A) vs side chain (route B),
 *                           decoy spike islands, pad gap, orb gap
 *   ACT 3  z  380..540  THE LABYRINTH — BRANCH 2 (long, ~8 s): four tall
 *                           walls, each with TWO viable doors; routes
 *                           reconverge at the single center door
 *   ACT 4  z  540..770  GRAVITY CATHEDRAL — floor → leftWall → ceiling →
 *                           rightWall → floor with routing gaps + a ceiling
 *                           spike garden
 *   ACT 5  z  770..930  CHOMPER CANYON — three staged lunges, side lava
 *                           pools, anchor pillars, arches, spike timing
 *   ACT 6  z  930..1160 SHIP REACTOR — walled tunnel, rise/dive, gravity
 *                           flip into a sustained INVERTED Ship segment,
 *                           recovery chamber
 *   ACT 7  z 1160..1330 SPIDER TEMPLE — floor ↔ ceiling snaps over dodge
 *                           walls, ceiling spike, wall-gravity segment with
 *                           leftWall ↔ rightWall spider snaps
 *   ACT 8  z 1330..1480 THE VOID — BRANCH 3: twin teleport entries (orb
 *                           line vs pad line), reconnect, maw hop over void
 *   ACT 9  z 1480..1750 FINAL GAUNTLET — 2× spike weave, wall burst, fourth
 *                           Chomper, homage river, finish gate
 *
 * Conventions: runway tops at y=0 (center −0.5/half 0.5); lanes
 * [2.6, 0, −2.6]; Cube jump envelope 8.8 u (plain gaps ≤ 6 u; longer gaps
 * carry required pads/orbs); maze doors 2.6 u wide centered on lanes;
 * Chomper triggers ≈10 u before the lunge line; every gravity/speed/mode
 * portal and every teleport entry carries a bounded trigger volume sized
 * to its visible ring (see `portalAuthoring.ts`); every lava composition
 * obeys the sourced/contained contract (see `lavaAuthoring.ts`).
 */
export const PRODUCTION_SHOWCASE_01: LevelDefinition = {
  id: 'production-showcase-01',
  displayName: 'THE DESCENT',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 14,
  finishZ: 1750,
  deathY: -14,
  deathYMax: 14,
  // Runaway catcher (M8.2 precedent): with opening-sized gates a missed
  // wall gate can leave the rider drifting sideways off the corridor.
  // Legit play never exceeds |x| 8; ±11 ends a lost run by routing.
  deathXMin: -11,
  deathXMax: 11,
  startGravityMode: 'floor',

  gravityPortals: [
    // ACT 4 cathedral.
    {
      id: 'ps-wall-left', z: 540, target: 'leftWall',
      triggerCenter: { x: 0, y: 1.5, z: 540 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // Left-wall rider line ≈ (4.85, 1.1): wall-mounted gate.
      id: 'ps-ceiling', z: 615, target: 'ceiling',
      triggerCenter: { x: 3.9, y: 2, z: 615 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // Ceiling rider line ≈ (0, 5.45): gate hangs under the slab.
      id: 'ps-wall-right', z: 685, target: 'rightWall',
      triggerCenter: { x: 0, y: 4.4, z: 685 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // Right-wall rider line ≈ (−4.85, 2.6): mirrored wall gate.
      id: 'ps-floor-again', z: 755, target: 'floor',
      triggerCenter: { x: -3.9, y: 3, z: 755 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // ACT 6 reactor: flip the Ship onto the ceiling (inverted flight).
    {
      id: 'ps-ship-invert', z: 1030, target: 'ceiling',
      triggerCenter: { x: 0, y: 3, z: 1030 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-ship-revert', z: 1090, target: 'floor',
      triggerCenter: { x: 0, y: 3, z: 1090 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // ACT 7 temple: drop the Spider onto the left wall.
    {
      id: 'ps-temple-wall', z: 1260, target: 'leftWall',
      triggerCenter: { x: 0, y: 1.5, z: 1260 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // Wall rider line ≈ (4.85, 0.4): gate hugs the wall face.
      id: 'ps-temple-floor', z: 1310, target: 'floor',
      triggerCenter: { x: 3.9, y: 1.5, z: 1310 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // ACT 9 finale wall burst.
    {
      id: 'ps-final-wall', z: 1620, target: 'leftWall',
      triggerCenter: { x: 0, y: 1.5, z: 1620 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-final-floor', z: 1660, target: 'floor',
      triggerCenter: { x: 3.9, y: 1.5, z: 1660 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
  ],
  speedPortals: [
    {
      id: 'ps-speed-2x', z: 1510, multiplier: 2,
      triggerCenter: { x: 0, y: 1.5, z: 1510 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-speed-1x', z: 1600, multiplier: 1,
      triggerCenter: { x: 0, y: 1.5, z: 1600 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
  ],
  modePortals: [
    {
      id: 'ps-ship-on', z: 935, target: 'ship',
      triggerCenter: { x: 0, y: 1.5, z: 935 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
    {
      id: 'ps-ship-off', z: 1120, target: 'cube',
      triggerCenter: { x: 0, y: 2.6, z: 1120 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
    {
      id: 'ps-spider-on', z: 1165, target: 'spider',
      triggerCenter: { x: 0, y: 1.5, z: 1165 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
    {
      id: 'ps-spider-off', z: 1320, target: 'cube',
      triggerCenter: { x: 0, y: 1.5, z: 1320 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
  ],
  jumpPads: [
    // ACT 2: required launch over the 10 u gap (passive, obvious).
    {
      id: 'ps-pad-gap',
      center: { x: 0, y: 0.3, z: 327.5 },
      halfExtents: { x: 1.2, y: 0.3, z: 1 },
      surface: 'floor',
      impulse: 22,
    },
    // ACT 8 route B: required launch over the 10 u low gap.
    {
      id: 'ps-pad-low',
      center: { x: -2.6, y: 0.3, z: 1417.5 },
      halfExtents: { x: 1.2, y: 0.3, z: 1 },
      surface: 'floor',
      impulse: 22,
    },
  ],
  jumpOrbs: [
    // ACT 2: required orb over the 9 u gap (a plain jump lands short).
    {
      id: 'ps-orb-gap',
      center: { x: 0, y: 1.6, z: 352.5 },
      halfExtents: { x: 0.9, y: 0.9, z: 0.9 },
      impulse: 20,
    },
    // ACT 8 route A: required orb over the 10 u high gap.
    {
      id: 'ps-orb-high',
      center: { x: 2.6, y: 1.6, z: 1418.5 },
      halfExtents: { x: 0.9, y: 0.9, z: 0.9 },
      impulse: 19,
    },
  ],
  teleportPortals: [
    // ACT 8 choice gantry: two bounded entries at one Z. Missing both
    // meets the divider wall (frontImpact) — never an arbitrary kill.
    {
      id: 'ps-teleport-high',
      entryZ: 1360,
      entryCenter: { x: 2.6, y: 1.5, z: 1360 },
      entryHalfExtents: { x: 1.7, y: 1.7, z: 1 },
      exit: { x: 2.6, y: 1.75, z: 1410 },
      exitLaneIndex: 0,
      style: 'gate',
    },
    {
      id: 'ps-teleport-low',
      entryZ: 1360,
      entryCenter: { x: -2.6, y: 1.5, z: 1360 },
      entryHalfExtents: { x: 1.7, y: 1.7, z: 1 },
      exit: { x: -2.6, y: 1.75, z: 1410 },
      exitLaneIndex: 2,
      style: 'gate',
    },
    // ACT 8 maw hop over the 20 u void (missing the ring = the void).
    {
      id: 'ps-teleport-maw',
      entryZ: 1472,
      entryCenter: { x: 0, y: 1.5, z: 1472 },
      entryHalfExtents: { x: 1.8, y: 1.8, z: 1 },
      exit: { x: 0, y: 1.75, z: 1500 },
      exitLaneIndex: 1,
      style: 'maw',
    },
  ],
  chompers: [
    {
      id: 'ps-chomp-1',
      dormant: { x: 8, y: 0.75, z: 820 },
      triggerZ: 810,
      lungeDirection: -1,
      lungeDistance: 16,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: 10, y: 2.5, z: 820 },
    },
    {
      id: 'ps-chomp-2',
      dormant: { x: -8, y: 0.75, z: 860 },
      triggerZ: 850,
      lungeDirection: 1,
      lungeDistance: 16,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: -10, y: 2.5, z: 860 },
    },
    {
      id: 'ps-chomp-3',
      dormant: { x: 8, y: 0.75, z: 895 },
      triggerZ: 885,
      lungeDirection: -1,
      lungeDistance: 16,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: 10, y: 2.5, z: 895 },
    },
    {
      id: 'ps-chomp-4',
      dormant: { x: 8, y: 0.75, z: 1690 },
      triggerZ: 1680,
      lungeDirection: -1,
      lungeDistance: 16,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: 10, y: 2.5, z: 1690 },
    },
  ],
  lava: [
    // ACT 1 gap basin 1 (pool top −2.4, z 40..46).
    { id: 'ps-gap1', center: { x: 0, y: -3.2, z: 43 }, halfExtents: { x: 4, y: 0.8, z: 3 }, role: 'pool' },
    { id: 'ps-gap1-src-l', center: { x: -4.2, y: 0.5, z: 43 }, halfExtents: { x: 1.3, y: 0.6, z: 1 }, role: 'source' },
    { id: 'ps-gap1-fall-l', center: { x: -4, y: -1.2, z: 43 }, halfExtents: { x: 0.7, y: 1.4, z: 0.9 }, role: 'fall' },
    { id: 'ps-gap1-src-r', center: { x: 4.2, y: 0.5, z: 43 }, halfExtents: { x: 1.3, y: 0.6, z: 1 }, role: 'source' },
    { id: 'ps-gap1-fall-r', center: { x: 4, y: -1.2, z: 43 }, halfExtents: { x: 0.7, y: 1.4, z: 0.9 }, role: 'fall' },
    // ACT 1 gap basin 2 (pool top −2.4, z 96..102).
    { id: 'ps-gap2', center: { x: 0, y: -3.2, z: 99 }, halfExtents: { x: 4, y: 0.8, z: 3 }, role: 'pool' },
    { id: 'ps-gap2-src-l', center: { x: -4.2, y: 0.5, z: 99 }, halfExtents: { x: 1.3, y: 0.6, z: 1 }, role: 'source' },
    { id: 'ps-gap2-fall-l', center: { x: -4, y: -1.2, z: 99 }, halfExtents: { x: 0.7, y: 1.4, z: 0.9 }, role: 'fall' },
    { id: 'ps-gap2-src-r', center: { x: 4.2, y: 0.5, z: 99 }, halfExtents: { x: 1.3, y: 0.6, z: 1 }, role: 'source' },
    { id: 'ps-gap2-fall-r', center: { x: 4, y: -1.2, z: 99 }, halfExtents: { x: 0.7, y: 1.4, z: 0.9 }, role: 'fall' },
    // ACT 1 directed river (at-grade 3 u hop, z 194.5..197.5): east vent
    // pours in, the strip flows west across the lanes, spills into the
    // rock-shelf channel and falls off the cliff past deathY.
    { id: 'ps-river', center: { x: 0, y: 0.1, z: 196 }, halfExtents: { x: 4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
    { id: 'ps-river-src', center: { x: 4.2, y: 2.9, z: 196 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
    { id: 'ps-river-fall', center: { x: 4.2, y: 1.5, z: 196 }, halfExtents: { x: 0.6, y: 1, z: 0.8 }, role: 'fall' },
    { id: 'ps-river-out', center: { x: -6.4, y: -0.05, z: 196 }, halfExtents: { x: 2.4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
    { id: 'ps-river-drop', center: { x: -8.6, y: -7.25, z: 196 }, halfExtents: { x: 0.6, y: 7.75, z: 0.9 }, role: 'fall' },
    // ACT 1 side composition (vent on rock pillar + fall into a side pool).
    { id: 'ps-side-source', center: { x: 10.2, y: 2.6, z: 120 }, halfExtents: { x: 0.6, y: 0.6, z: 1.2 }, role: 'source' },
    { id: 'ps-side-fall', center: { x: 9.4, y: -0.3, z: 120 }, halfExtents: { x: 0.9, y: 2.5, z: 1.0 }, role: 'fall' },
    { id: 'ps-side-pool', center: { x: 8, y: -3.2, z: 120 }, halfExtents: { x: 3, y: 0.8, z: 6 }, role: 'pool' },
    // ACT 5 canyon side pools (contained, off-route menace).
    { id: 'ps-biome-west', center: { x: -8.5, y: -3.2, z: 845 }, halfExtents: { x: 3, y: 0.8, z: 40 }, role: 'pool' },
    { id: 'ps-biome-east', center: { x: 8.5, y: -3.2, z: 845 }, halfExtents: { x: 3, y: 0.8, z: 40 }, role: 'pool' },
    // ACT 9 homage river (same directed pattern, z 1714.5..1717.5).
    { id: 'ps-final-river', center: { x: 0, y: 0.1, z: 1716 }, halfExtents: { x: 4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
    { id: 'ps-final-river-src', center: { x: 4.2, y: 2.9, z: 1716 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
    { id: 'ps-final-river-fall', center: { x: 4.2, y: 1.5, z: 1716 }, halfExtents: { x: 0.6, y: 1, z: 0.8 }, role: 'fall' },
    { id: 'ps-final-river-out', center: { x: -6.4, y: -0.05, z: 1716 }, halfExtents: { x: 2.4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
    { id: 'ps-final-river-drop', center: { x: -8.6, y: -7.25, z: 1716 }, halfExtents: { x: 0.6, y: 7.75, z: 0.9 }, role: 'fall' },
  ],

  solids: [
    // --- ACT 1 runways + gap-basin containment ---
    { center: { x: 0, y: -0.5, z: 15 }, halfExtents: { x: 5.4, y: 0.5, z: 25 } },
    { center: { x: 0, y: -0.5, z: 71 }, halfExtents: { x: 5.4, y: 0.5, z: 25 } },
    { center: { x: 0, y: -0.5, z: 126 }, halfExtents: { x: 5.4, y: 0.5, z: 24 } },
    { center: { x: 0, y: -0.5, z: 180 }, halfExtents: { x: 5.4, y: 0.5, z: 30 } },
    // Gap basin 1 containment (z 40..46).
    { center: { x: 0, y: -4.5, z: 43 }, halfExtents: { x: 4.5, y: 0.5, z: 3.5 } },
    { center: { x: -4.375, y: -2.25, z: 43 }, halfExtents: { x: 0.375, y: 0.75, z: 3.5 } },
    { center: { x: 4.375, y: -2.25, z: 43 }, halfExtents: { x: 0.375, y: 0.75, z: 3.5 } },
    { center: { x: 0, y: -2.25, z: 39.625 }, halfExtents: { x: 4.5, y: 0.75, z: 0.375 } },
    { center: { x: 0, y: -2.25, z: 46.375 }, halfExtents: { x: 4.5, y: 0.75, z: 0.375 } },
    // Gap basin 2 containment (z 96..102).
    { center: { x: 0, y: -4.5, z: 99 }, halfExtents: { x: 4.5, y: 0.5, z: 3.5 } },
    { center: { x: -4.375, y: -2.25, z: 99 }, halfExtents: { x: 0.375, y: 0.75, z: 3.5 } },
    { center: { x: 4.375, y: -2.25, z: 99 }, halfExtents: { x: 0.375, y: 0.75, z: 3.5 } },
    { center: { x: 0, y: -2.25, z: 95.625 }, halfExtents: { x: 4.5, y: 0.75, z: 0.375 } },
    { center: { x: 0, y: -2.25, z: 102.375 }, halfExtents: { x: 4.5, y: 0.75, z: 0.375 } },
    // Gap-river rock pillars (vent sources attach to their inner faces).
    { center: { x: -6.5, y: -1, z: 43 }, halfExtents: { x: 1, y: 3, z: 1.5 } },
    { center: { x: 6.5, y: -1, z: 43 }, halfExtents: { x: 1, y: 3, z: 1.5 } },
    { center: { x: -6.5, y: -1, z: 99 }, halfExtents: { x: 1, y: 3, z: 1.5 } },
    { center: { x: 6.5, y: -1, z: 99 }, halfExtents: { x: 1, y: 3, z: 1.5 } },
    // River east pillar + curb + shelf channel + rims (z 196).
    { center: { x: 4.9, y: 1.75, z: 196 }, halfExtents: { x: 0.5, y: 1.75, z: 1 } },
    { center: { x: 4.375, y: -0.1, z: 196 }, halfExtents: { x: 0.375, y: 0.75, z: 1.75 } },
    { center: { x: -7.4, y: -1.15, z: 196 }, halfExtents: { x: 2, y: 0.5, z: 1.75 } },
    { center: { x: -6.4, y: -0.1, z: 194.3 }, halfExtents: { x: 2.4, y: 0.85, z: 0.3 } },
    { center: { x: -6.4, y: -0.1, z: 197.7 }, halfExtents: { x: 2.4, y: 0.85, z: 0.3 } },
    // Side-composition rock pillar + pool containment (z 120).
    { center: { x: 12, y: 0, z: 120 }, halfExtents: { x: 1.5, y: 5, z: 2.5 } },
    { center: { x: 8, y: -4.5, z: 120 }, halfExtents: { x: 3.5, y: 0.5, z: 6.5 } },
    { center: { x: 4.625, y: -2.25, z: 120 }, halfExtents: { x: 0.375, y: 0.75, z: 6.5 } },
    { center: { x: 8, y: -2.25, z: 113.625 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },
    { center: { x: 8, y: -2.25, z: 126.375 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },

    // --- ACT 2 islands + reconnect runways ---
    { center: { x: 0, y: -0.5, z: 219 }, halfExtents: { x: 5.4, y: 0.5, z: 9 } },
    // Route A (precision center chain).
    { center: { x: 0, y: -0.5, z: 233 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: 0, y: -0.5, z: 249 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: 0, y: -0.5, z: 265 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: 0, y: -0.5, z: 285 }, halfExtents: { x: 1.3, y: 0.5, z: 9 } },
    // Route B (side chain, lane 2).
    { center: { x: -2.6, y: -0.5, z: 233 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: -2.6, y: -0.5, z: 249 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: -2.6, y: -0.5, z: 267 }, halfExtents: { x: 1.3, y: 0.5, z: 7 } },
    { center: { x: -2.6, y: -0.5, z: 288 }, halfExtents: { x: 1.3, y: 0.5, z: 8 } },
    // Decoy islands (visibly spiked, never the route).
    { center: { x: 2.6, y: -0.5, z: 249 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: 2.6, y: -0.5, z: 285 }, halfExtents: { x: 1.3, y: 0.5, z: 9 } },
    // Reconnect runways (pad gap 330..340, orb gap 355..364).
    { center: { x: 0, y: -0.5, z: 315 }, halfExtents: { x: 5.4, y: 0.5, z: 15 } },
    { center: { x: 0, y: -0.5, z: 347.5 }, halfExtents: { x: 5.4, y: 0.5, z: 7.5 } },
    { center: { x: 0, y: -0.5, z: 372 }, halfExtents: { x: 5.4, y: 0.5, z: 8 } },

    // --- ACT 3 labyrinth runway (decision walls live in `hazards`) ---
    { center: { x: 0, y: -0.5, z: 460 }, halfExtents: { x: 5.4, y: 0.5, z: 80 } },

    // --- ACT 4 cathedral: floor with routing gaps + wall/ceiling slabs ---
    { center: { x: 0, y: -0.5, z: 540 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
    { center: { x: 0, y: -0.5, z: 592.5 }, halfExtents: { x: 5.4, y: 0.5, z: 32.5 } },
    { center: { x: 0, y: -0.5, z: 665 }, halfExtents: { x: 5.4, y: 0.5, z: 30 } },
    { center: { x: 0, y: -0.5, z: 737.5 }, halfExtents: { x: 5.4, y: 0.5, z: 32.5 } },
    // Left-wall run surface (face x=5.4, z 540..615).
    { center: { x: 5.9, y: 3, z: 577.5 }, halfExtents: { x: 0.5, y: 4, z: 37.5 } },
    // Ceiling run surface (face y=6, z 610..690).
    { center: { x: 0, y: 6.5, z: 650 }, halfExtents: { x: 5.4, y: 0.5, z: 40 } },
    // Right-wall run surface (face x=−5.4, z 680..760).
    { center: { x: -5.9, y: 3, z: 720 }, halfExtents: { x: 0.5, y: 4, z: 40 } },

    // --- ACT 5 canyon runway + side-pool containment + anchors + arches ---
    { center: { x: 0, y: -0.5, z: 850 }, halfExtents: { x: 5.4, y: 0.5, z: 80 } },
    { center: { x: -8.5, y: -4.5, z: 845 }, halfExtents: { x: 3.5, y: 0.5, z: 40.5 } },
    { center: { x: -11.625, y: -2.25, z: 845 }, halfExtents: { x: 0.375, y: 0.75, z: 40.5 } },
    { center: { x: -8.5, y: -2.25, z: 804.625 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },
    { center: { x: -8.5, y: -2.25, z: 885.375 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },
    { center: { x: 8.5, y: -4.5, z: 845 }, halfExtents: { x: 3.5, y: 0.5, z: 40.5 } },
    { center: { x: 11.625, y: -2.25, z: 845 }, halfExtents: { x: 0.375, y: 0.75, z: 40.5 } },
    { center: { x: 8.5, y: -2.25, z: 804.625 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },
    { center: { x: 8.5, y: -2.25, z: 885.375 }, halfExtents: { x: 3.5, y: 0.75, z: 0.375 } },
    // Chain-anchor pillars (the Chomper chains read as tethered here).
    { center: { x: 10, y: 0, z: 820 }, halfExtents: { x: 1, y: 5, z: 1.5 } },
    { center: { x: -10, y: 0, z: 860 }, halfExtents: { x: 1, y: 5, z: 1.5 } },
    { center: { x: 10, y: 0, z: 895 }, halfExtents: { x: 1, y: 5, z: 1.5 } },
    // Broken arches over the route (clearance: bottom y=4.2).
    { center: { x: 0, y: 5, z: 835 }, halfExtents: { x: 6, y: 0.8, z: 1 } },
    { center: { x: 0, y: 5, z: 875 }, halfExtents: { x: 6, y: 0.8, z: 1 } },

    // --- ACT 6 reactor tunnel (floor top −3, ceiling bottom 9) ---
    { center: { x: 0, y: -3.5, z: 1045 }, halfExtents: { x: 6, y: 0.5, z: 115 } },
    { center: { x: 0, y: 9.5, z: 1045 }, halfExtents: { x: 6, y: 0.5, z: 115 } },
    { center: { x: -6.5, y: 3, z: 1045 }, halfExtents: { x: 0.5, y: 6, z: 115 } },
    { center: { x: 6.5, y: 3, z: 1045 }, halfExtents: { x: 0.5, y: 6, z: 115 } },
    // Tunnel narrowing insets (visual width change, z 1000..1090).
    { center: { x: -6, y: 3, z: 1045 }, halfExtents: { x: 0.5, y: 6, z: 45 } },
    { center: { x: 6, y: 3, z: 1045 }, halfExtents: { x: 0.5, y: 6, z: 45 } },
    // Rise-over wall (top y=0, z 964..968).
    { center: { x: 0, y: -1.5, z: 966 }, halfExtents: { x: 5.4, y: 1.5, z: 2 } },
    // Dive-under block (bottom y=7, z 1010..1016).
    { center: { x: 0, y: 8, z: 1013 }, halfExtents: { x: 5.4, y: 1, z: 3 } },
    // Inverted-segment obstacles: ceiling-hung block + floor ribs.
    { center: { x: 0, y: 8, z: 1048 }, halfExtents: { x: 5.4, y: 1, z: 3 } },
    { center: { x: 0, y: -1.5, z: 1067 }, halfExtents: { x: 5.4, y: 1.5, z: 2 } },
    { center: { x: 0, y: 0, z: 1079 }, halfExtents: { x: 5.4, y: 1, z: 1 } },
    // Ship-exit landing runway (top y=0, z 1120..1160).
    { center: { x: 0, y: -0.5, z: 1140 }, halfExtents: { x: 5.4, y: 0.5, z: 20 } },

    // --- ACT 7 temple: floor runway + ceiling slab + wall slabs ---
    { center: { x: 0, y: -0.5, z: 1245 }, halfExtents: { x: 5.4, y: 0.5, z: 85 } },
    // Ceiling snap surface (face y=6, z 1165..1250).
    { center: { x: 0, y: 6.5, z: 1207.5 }, halfExtents: { x: 5.4, y: 0.5, z: 42.5 } },
    // Spider dodge walls (y 0..3): ceiling riders pass over.
    { center: { x: 0, y: 1.5, z: 1196.5 }, halfExtents: { x: 5.4, y: 1.5, z: 1.5 } },
    { center: { x: 0, y: 1.5, z: 1231.5 }, halfExtents: { x: 5.4, y: 1.5, z: 1.5 } },
    // Wall-gravity slabs (faces x=±5.4, z 1260..1310).
    { center: { x: 5.9, y: 3, z: 1285 }, halfExtents: { x: 0.5, y: 4, z: 25 } },
    { center: { x: -5.9, y: 3, z: 1285 }, halfExtents: { x: 0.5, y: 4, z: 25 } },
    // Temple pillars (off-route dressing).
    { center: { x: 8, y: 3, z: 1200 }, halfExtents: { x: 1, y: 7, z: 2 } },
    { center: { x: -8, y: 3, z: 1235 }, halfExtents: { x: 1, y: 7, z: 2 } },

    // --- ACT 8 void: approach + choice gantry + branch routes + reconnect ---
    { center: { x: 0, y: -0.5, z: 1345 }, halfExtents: { x: 5.4, y: 0.5, z: 15 } },
    // Route A (high orb line, x 1.3..3.9).
    { center: { x: 2.6, y: -0.5, z: 1415 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: 2.6, y: -0.5, z: 1447 }, halfExtents: { x: 1.3, y: 0.5, z: 18 } },
    // Route B (low pad line, x −3.9..−1.3).
    { center: { x: -2.6, y: -0.5, z: 1415 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    { center: { x: -2.6, y: -0.5, z: 1447.5 }, halfExtents: { x: 1.3, y: 0.5, z: 17.5 } },
    // Reconnect runway (z 1465..1480).
    { center: { x: 0, y: -0.5, z: 1472.5 }, halfExtents: { x: 5.4, y: 0.5, z: 7.5 } },

    // --- ACT 9 finale runways (routing gap 1630..1640, void 1480..1500) ---
    { center: { x: 0, y: -0.5, z: 1550 }, halfExtents: { x: 5.4, y: 0.5, z: 50 } },
    { center: { x: 0, y: -0.5, z: 1615 }, halfExtents: { x: 5.4, y: 0.5, z: 15 } },
    { center: { x: 0, y: -0.5, z: 1700 }, halfExtents: { x: 5.4, y: 0.5, z: 60 } },
    // Finale wall-burst slab (face x=5.4, z 1620..1660).
    { center: { x: 5.9, y: 3, z: 1640 }, halfExtents: { x: 0.5, y: 4, z: 20 } },
    // Final river east pillar + curb + shelf channel + rims (z 1716).
    { center: { x: 4.9, y: 1.75, z: 1716 }, halfExtents: { x: 0.5, y: 1.75, z: 1 } },
    { center: { x: 4.375, y: -0.1, z: 1716 }, halfExtents: { x: 0.375, y: 0.75, z: 1.75 } },
    { center: { x: -7.4, y: -1.15, z: 1716 }, halfExtents: { x: 2, y: 0.5, z: 1.75 } },
    { center: { x: -6.4, y: -0.1, z: 1714.3 }, halfExtents: { x: 2.4, y: 0.85, z: 0.3 } },
    { center: { x: -6.4, y: -0.1, z: 1717.7 }, halfExtents: { x: 2.4, y: 0.85, z: 0.3 } },
    // Finale Chomper anchor pillar.
    { center: { x: 10, y: 0, z: 1690 }, halfExtents: { x: 1, y: 5, z: 1.5 } },
  ],

  hazards: [
    // ACT 1 lane-split block (killFront: frontal kills, side scrape blocks).
    { kind: 'killFront', visual: 'block', center: { x: 0, y: 1.5, z: 160 }, halfExtents: { x: 1.3, y: 1.5, z: 1 } },
    // ACT 1 telegraphed floor spike.
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 175 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // ACT 1 post-river deco spikes (off the center route).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 205 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 205 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // ACT 1 gate pylons flanking the cathedral entry portal.
    { kind: 'killFront', visual: 'block', center: { x: -4.9, y: 1.25, z: 540 }, halfExtents: { x: 0.4, y: 1.25, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 4.9, y: 1.25, z: 540 }, halfExtents: { x: 0.4, y: 1.25, z: 0.5 } },

    // ACT 2 decoy spikes (dense, visibly dangerous, never on a route).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 247 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 251 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 283 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 287 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },

    // ACT 3 labyrinth decision walls (killFront, tops y=7, doors on lanes).
    // Wall 1 (z 405): doors lane 0 + lane 2.
    { kind: 'killFront', visual: 'block', center: { x: 4.65, y: 3.5, z: 405 }, halfExtents: { x: 0.75, y: 3.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 0, y: 3.5, z: 405 }, halfExtents: { x: 1.3, y: 3.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -4.65, y: 3.5, z: 405 }, halfExtents: { x: 0.75, y: 3.5, z: 0.5 } },
    // Wall 2 (z 445): doors lane 1 + lane 2.
    { kind: 'killFront', visual: 'block', center: { x: 3.35, y: 3.5, z: 445 }, halfExtents: { x: 2.05, y: 3.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -4.65, y: 3.5, z: 445 }, halfExtents: { x: 0.75, y: 3.5, z: 0.5 } },
    // Wall 3 (z 480): doors lane 0 + lane 1.
    { kind: 'killFront', visual: 'block', center: { x: 4.65, y: 3.5, z: 480 }, halfExtents: { x: 0.75, y: 3.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -3.35, y: 3.5, z: 480 }, halfExtents: { x: 2.05, y: 3.5, z: 0.5 } },
    // Wall 4 (z 520): single center door (routes reconverge).
    { kind: 'killFront', visual: 'block', center: { x: 3.35, y: 3.5, z: 520 }, halfExtents: { x: 2.05, y: 3.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -3.35, y: 3.5, z: 520 }, halfExtents: { x: 2.05, y: 3.5, z: 0.5 } },

    // ACT 4 ceiling spike garden (mounted on the ceiling run surface).
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 5.75, z: 640 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 2.6, y: 5.75, z: 655 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: -2.6, y: 5.75, z: 655 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },

    // ACT 5 canyon spike timing.
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 912 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },

    // ACT 7 temple ceiling spike (forces a lane move on the ceiling run).
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 5.75, z: 1210 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // ACT 7 wall spikes (force the wall ↔ wall spider snaps).
    { kind: 'hazard', visual: 'spike', mount: 'leftWall', center: { x: 5.15, y: 0.4, z: 1277 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },
    { kind: 'hazard', visual: 'spike', mount: 'leftWall', center: { x: 5.15, y: 0.4, z: 1279.5 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },
    { kind: 'hazard', visual: 'spike', mount: 'rightWall', center: { x: -5.15, y: 0.4, z: 1295 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },
    { kind: 'hazard', visual: 'spike', mount: 'rightWall', center: { x: -5.15, y: 0.4, z: 1297.5 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },

    // ACT 8 choice divider (missing both teleport rings meets the wall).
    { kind: 'killFront', visual: 'block', center: { x: 0, y: 2, z: 1360 }, halfExtents: { x: 0.9, y: 3, z: 1 } },

    // ACT 9 2× spike weave.
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 1540 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1570 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1570 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
  ],
  visualSetpieces: [
    // Labyrinth route markers (off-corridor guardians watching the doors).
    { id: 'ps-mark-maze-1', kind: 'guardian', center: { x: 8, y: 3, z: 405 }, halfExtents: { x: 2, y: 3, z: 1.5 } },
    { id: 'ps-mark-maze-2', kind: 'guardian', center: { x: -8, y: 3, z: 480 }, halfExtents: { x: 2, y: 3, z: 1.5 } },
    // Island menace below the route (presentation-only, never landable).
    { id: 'ps-menace-islands', kind: 'lava', center: { x: 0, y: -6, z: 262 }, halfExtents: { x: 5, y: 1, z: 30 } },
    // Reactor exterior glow (outside the tunnel walls).
    { id: 'ps-reactor-glow', kind: 'lava', center: { x: 11, y: 3, z: 1045 }, halfExtents: { x: 2, y: 4, z: 40 } },
    // Temple watcher + void lake + final core arch.
    { id: 'ps-temple-watcher', kind: 'guardian', center: { x: -10, y: 4, z: 1215 }, halfExtents: { x: 3, y: 4, z: 1.5 } },
    { id: 'ps-void-lake', kind: 'lava', center: { x: 0, y: -8, z: 1420 }, halfExtents: { x: 8, y: 1, z: 30 } },
    { id: 'ps-core-arch', kind: 'guardian', center: { x: 0, y: 7, z: 1752 }, halfExtents: { x: 7, y: 4, z: 1.5 } },
  ],
  /**
   * Nine-scene visual arc — one identity per act (fingerprint-excluded).
   * Player cyan anchor and hazard warm identity never change (structural).
   */
  visualSequence: {
    sections: [
      // Forge: molten-gold edge identity (dark faces + gold outlines +
      // white-hot lava) against the cyan player — hazards stay
      // hazard-orange pyramids, never lines, so the hierarchy holds.
      {
        id: 'ps-forge',
        startZ: -10,
        endZ: 210,
        blendIn: 1,
        overrides: {
          background: 0x120702,
          fogColor: 0x351104,
          routeAccent: 0xffc233,
          environmentIntensity: 1.3,
          vfxIntensity: 1.1,
        },
      },
      {
        id: 'ps-islands',
        startZ: 210,
        endZ: 380,
        blendIn: 20,
        overrides: {
          background: 0x06231c,
          fogColor: 0x0d4a3a,
          routeAccent: 0x2dffc4,
          environmentIntensity: 1.2,
          vfxIntensity: 1.1,
        },
      },
      {
        id: 'ps-labyrinth',
        startZ: 380,
        endZ: 540,
        blendIn: 20,
        overrides: {
          background: 0x170b2e,
          fogColor: 0x3a1560,
          routeAccent: 0xb44dff,
          environmentIntensity: 1.25,
          vfxIntensity: 1.15,
        },
      },
      {
        id: 'ps-cathedral',
        startZ: 540,
        endZ: 770,
        blendIn: 20,
        overrides: {
          background: 0x04121f,
          fogColor: 0x0b3a5c,
          routeAccent: 0x35c8ff,
          environmentIntensity: 1.35,
          vfxIntensity: 1.2,
          streakIntensity: 1.2,
        },
      },
      {
        id: 'ps-canyon',
        startZ: 770,
        endZ: 930,
        blendIn: 20,
        overrides: {
          background: 0x1f0404,
          fogColor: 0x5c0b0b,
          routeAccent: 0xff3b1f,
          environmentIntensity: 1.4,
          vfxIntensity: 1.2,
        },
      },
      {
        id: 'ps-reactor',
        startZ: 930,
        endZ: 1160,
        blendIn: 20,
        overrides: {
          background: 0x03170c,
          fogColor: 0x0b4a24,
          routeAccent: 0x3dff7a,
          environmentIntensity: 1.35,
          vfxIntensity: 1.2,
          streakIntensity: 1.25,
        },
      },
      {
        id: 'ps-temple',
        startZ: 1160,
        endZ: 1330,
        blendIn: 20,
        overrides: {
          background: 0x1c1504,
          fogColor: 0x5c4a0b,
          routeAccent: 0xffd23d,
          environmentIntensity: 1.3,
          vfxIntensity: 1.15,
        },
      },
      {
        id: 'ps-void',
        startZ: 1330,
        endZ: 1480,
        blendIn: 20,
        overrides: {
          background: 0x02020c,
          fogColor: 0x10103a,
          fogNear: 26,
          fogFar: 130,
          routeAccent: 0x6a5cff,
          environmentIntensity: 1.2,
          vfxIntensity: 1.1,
        },
      },
      {
        id: 'ps-core',
        startZ: 1480,
        endZ: 1760,
        blendIn: 20,
        overrides: {
          background: 0x1c0312,
          fogColor: 0x5c0b3a,
          routeAccent: 0xff4dd2,
          environmentIntensity: 1.5,
          exposure: 1.15,
          vfxIntensity: 1.25,
          streakIntensity: 1.3,
        },
      },
    ],
  },
  rhythmCues: [
    { id: 'ps-cue-intro', z: 0, role: 'intro' },
    { id: 'ps-cue-river', z: 190, role: 'accent' },
    { id: 'ps-cue-islands', z: 228, role: 'sectionChange' },
    { id: 'ps-cue-pad', z: 326, role: 'padHit' },
    { id: 'ps-cue-orb', z: 352, role: 'orbHit' },
    { id: 'ps-cue-maze', z: 380, role: 'sectionChange' },
    { id: 'ps-cue-build', z: 480, role: 'build' },
    { id: 'ps-cue-cathedral', z: 540, role: 'gravityHit' },
    { id: 'ps-cue-ceiling', z: 615, role: 'gravityHit' },
    { id: 'ps-cue-wall-right', z: 685, role: 'gravityHit' },
    { id: 'ps-cue-floor', z: 755, role: 'gravityHit' },
    { id: 'ps-cue-canyon', z: 770, role: 'sectionChange' },
    { id: 'ps-cue-chomp-1', z: 810, role: 'accent' },
    { id: 'ps-cue-chomp-2', z: 850, role: 'accent' },
    { id: 'ps-cue-reactor', z: 930, role: 'sectionChange' },
    { id: 'ps-cue-invert', z: 1030, role: 'drop' },
    { id: 'ps-cue-revert', z: 1090, role: 'sectionChange' },
    { id: 'ps-cue-temple', z: 1160, role: 'sectionChange' },
    { id: 'ps-cue-wall-snap', z: 1260, role: 'gravityHit' },
    { id: 'ps-cue-void', z: 1330, role: 'sectionChange' },
    { id: 'ps-cue-teleport', z: 1360, role: 'accent' },
    { id: 'ps-cue-maw', z: 1472, role: 'accent' },
    { id: 'ps-cue-core', z: 1480, role: 'climax' },
    { id: 'ps-cue-speed', z: 1510, role: 'speedHit' },
    { id: 'ps-cue-release-speed', z: 1600, role: 'sectionChange' },
    { id: 'ps-cue-chomp-4', z: 1680, role: 'accent' },
    { id: 'ps-cue-release', z: 1720, role: 'release' },
    { id: 'ps-cue-finish', z: 1750, role: 'finish' },
  ],
  theme: TEST_LEVEL.theme,
};
