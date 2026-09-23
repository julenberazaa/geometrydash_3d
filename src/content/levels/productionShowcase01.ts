import type { LevelDefinition } from '../../level/levelDefinition';
import { TEST_LEVEL } from './testLevel01';

/**
 * PRODUCTION SHOWCASE 01 — "THE DESCENT" (M8.6 overhaul).
 *
 * Same id, same 9-act arc, same scenes, same visual production as M8.5 —
 * completely re-authored gameplay: VERY HARD / EXPERT density inside the
 * same ~2-minute duration (finish z=1790, ≈122 s on the reference route).
 *
 * Authored arc (base speed 14 u/s, 2× bursts in maze exit + finale):
 *   ACT 1  z    0..170  FORGE ASCENT — stairs, drop chamber, river, weaves
 *   ACT 2  z  170..430  SKYBRIDGE ISLANDS — multi-deck chains, elevator,
 *                           HIGH/LOW branch, lateral ferry over the void
 *   ACT 3  z  430..720  MAZE RUNNER — two-deck door maze, drop holes,
 *                           opposite-phase ferry pair, 2× exit burst
 *   ACT 4  z  720..920  GRAVITY SPIRE — rapid 4-surface combos, fall shaft,
 *                           gravity-orb ceiling traverse over lava
 *   ACT 5  z  920..1110 CHOMPER FOUNDRY — 4 lunges × (ferry / weave /
 *                           ceiling swap / lava + low-ceiling lane dodge)
 *   ACT 6  z 1110..1330 SHIP ABYSS — teeth, pillars, S-weave, sustained
 *                           inverted flight, inverted burst
 *   ACT 7  z 1330..1510 SPIDER SPIRE — rapid swaps, snap-climb shaft,
 *                           wall↔wall snaps past wall spikes
 *   ACT 8  z 1510..1620 VOID TERMINAL — 3-deck teleport choice (HIGH orb
 *                           chain / MID weave / LOW drops), reconnect
 *   ACT 9  z 1620..1790 CORE REMIX — 2× island chain, spike-floor gap,
 *                           weave, ceiling hop, wall burst, spider pair,
 *                           5th Chomper, homage river, finish
 *
 * Conventions: LOW deck top y=0, MID top y=4.5, HIGH top y=8; lanes
 * [2.6, 0, −2.6]; Cube jump envelope 8.8 u (plain gaps ≤ 6 u, 2× gaps
 * ≤ 10 u); stair risers 1.5; every gravity/speed/mode portal and every
 * teleport entry carries a bounded trigger volume sized to its visible
 * ring (see `portalAuthoring.ts`); every lava composition obeys the
 * sourced/contained contract (see `lavaAuthoring.ts`); moving platforms
 * obey `movingPlatformAuthoring.ts` (≤ 8, axis x|y, peak ≤ 0.12 u/tick).
 */
export const PRODUCTION_SHOWCASE_01: LevelDefinition = {
  id: 'production-showcase-01',
  displayName: 'THE DESCENT',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 14,
  // M9: the finish sits on the beat-230 final impact (115.06 s) — tuned
  // in 1 u steps against the reference driver (1 u ≈ 71 ms at 1×).
  finishZ: 1790,
  deathY: -14,
  deathYMax: 14,
  // Runaway catcher (M8.2 precedent): legit play never exceeds |x| 8;
  // ±11 ends a lost run by routing.
  deathXMin: -11,
  deathXMax: 11,
  startGravityMode: 'floor',
  // M9 music binding (presentation-only, never gameplay/fingerprinted):
  // THE DESCENT was built for Gravity Lessons — the attempt starts at the
  // first track sample (offset 0) through the press-to-start gate, and the
  // authored finish lands on the beat-230 final impact (≈ 115.06 s).
  // M9.1: root-absolute public URL (port-proof under any Vite dev port).
  musicTrack: { audioPath: '/audio/Gravity_Lessons.mp3', trackOffset: 0 },

  gravityPortals: [
    // ACT 4 spire: rapid 4-surface tour. M9: the ceiling flip lands on
    // beat 104 (52.06 s) — the rise still lands mid-slab.
    {
      id: 'ps-spire-up', z: 742.5, target: 'ceiling',
      triggerCenter: { x: 0, y: 1.5, z: 742.5 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // M9: the wall flip lands on beat 112 (56.06 s — the breakdown
    // downbeat). Ceiling rider line ≈ (0, 9.45): gate hangs under the slab.
    {
      id: 'ps-spire-wall', z: 798.4, target: 'leftWall',
      triggerCenter: { x: 0, y: 8.4, z: 798.4 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // Left-wall rider line ≈ (4.85, 3): wall-mounted gate. M9: beat 117.
      id: 'ps-spire-right', z: 833.5, target: 'rightWall',
      triggerCenter: { x: 3.9, y: 3, z: 833.5 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // Right-wall rider line ≈ (−4.85, 0.4): mirrored wall gate.
      // M9: beat 121 (60.56 s).
      id: 'ps-spire-down', z: 861.4, target: 'floor',
      triggerCenter: { x: -3.9, y: 1.5, z: 861.4 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // ACT 5 foundry: ceiling Chomper swap. M9: beat 141 (70.56 s).
    {
      id: 'ps-foundry-up', z: 1001.3, target: 'ceiling',
      triggerCenter: { x: 0, y: 1.5, z: 1001.3 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-foundry-down', z: 1030, target: 'floor',
      triggerCenter: { x: 0, y: 8.4, z: 1030 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // ACT 6 abyss: sustained invert + burst. M9: the revert ring rides
    // HIGH (y 5.5 — the authored ship line crests y≈6.3 there; a low ring
    // is skippable by altitude, which strands the revert/invert2 accents).
    // The flips land on beats 171 (85.56 s) + 176 (88.06 s).
    {
      id: 'ps-abyss-invert', z: 1200, target: 'ceiling',
      triggerCenter: { x: 0, y: 3, z: 1200 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-abyss-revert', z: 1250, target: 'floor',
      triggerCenter: { x: 0, y: 5.5, z: 1250 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-abyss-invert2', z: 1286, target: 'ceiling',
      triggerCenter: { x: 0, y: 3, z: 1286 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-abyss-revert2', z: 1305, target: 'floor',
      triggerCenter: { x: 0, y: 3, z: 1305 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // ACT 7 spire: drop onto the left wall. M9: beat 191 (95.56 s) —
    // lip-catch (the HIGH runway still grounds the flip).
    {
      id: 'ps-climb-wall', z: 1460, target: 'leftWall',
      triggerCenter: { x: 0, y: 8.5, z: 1460 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // Left-wall rider line ≈ (4.85, 3): wall-mounted gate.
      id: 'ps-climb-floor', z: 1490, target: 'floor',
      triggerCenter: { x: 3.9, y: 3, z: 1490 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // ACT 9 remix: ceiling hop + wall burst. M9: the burst pair lands on
    // beats 221/223 (110.56/111.56 s) — rigid shift, choreography kept.
    {
      id: 'ps-remix-up', z: 1696, target: 'ceiling',
      triggerCenter: { x: 0, y: 1.5, z: 1696 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-remix-down', z: 1708, target: 'floor',
      triggerCenter: { x: 0, y: 8.4, z: 1708 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-remix-wall', z: 1718, target: 'leftWall',
      triggerCenter: { x: 0, y: 1.5, z: 1718 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // High gate (rider holds lane 2 up the wall burst).
      id: 'ps-remix-floor', z: 1732, target: 'floor',
      triggerCenter: { x: 3.9, y: 5.6, z: 1732 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
  ],
  speedPortals: [
    // M9: the maze-exit burst lands on beat 99 (49.56 s) — 3 u upstream
    // (the weave choreography is untouched; only the 1×→2× handoff moves).
    {
      id: 'ps-speed-maze', z: 692, multiplier: 2,
      triggerCenter: { x: 0, y: 1.5, z: 692 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // M9: spire-entry restore on beat 101 (50.56 s).
    {
      id: 'ps-speed-spire', z: 723, multiplier: 1,
      triggerCenter: { x: 0, y: 1.5, z: 723 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // The 2× lip boosts the void-gap jump mid-flight (take off 1×).
    {
      id: 'ps-speed-remix', z: 1662, multiplier: 2,
      triggerCenter: { x: 0, y: 1.5, z: 1662 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-speed-calm', z: 1694, multiplier: 1,
      triggerCenter: { x: 0, y: 1.5, z: 1694 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-speed-remix2', z: 1754, multiplier: 2,
      triggerCenter: { x: 0, y: 1.5, z: 1754 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // M9 musical arrangement: Drop-B energy carries a 2× foundry slalom
    // (single-door weave walls at 2× lane-change spacing) from the lava
    // jump through the ship approach — then 1× restores for the Ship gate.
    {
      id: 'ps-speed-foundry', z: 1036.5, multiplier: 2,
      triggerCenter: { x: 0, y: 1.5, z: 1036.5 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      // M9.1: the trigger rides ON the authored ship line (y 3.0 — the
      // tunnel mouth climbs over the top-2 rise wall there; a low ring is
      // flown over and the ship strands at 2×, arriving ~250 ms early).
      id: 'ps-speed-approach', z: 1119, multiplier: 1,
      triggerCenter: { x: 0, y: 3, z: 1119 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // M9 musical arrangement: the climax (beats 184–224) runs the Spider
    // spire at 2× (fast snap chains on beat subdivisions) — the snaps are
    // instant surface switches, so doubling forward speed doubles musical
    // density without changing the authored press positions. M9: 2× from
    // the runway start (beat-181 arrival) for maximum climax energy.
    {
      id: 'ps-speed-spider', z: 1315, multiplier: 2,
      triggerCenter: { x: 0, y: 1.5, z: 1315 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-speed-void', z: 1510, multiplier: 1,
      triggerCenter: { x: 0, y: 1.5, z: 1510 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    // M9: the wall-entry fall takes the same TIME at any speed but covers
    // 2× the distance at 2× — the authored wall choreography (landing +
    // UP-tap + snap before the 1480 spike) only fits at 1×. Precision
    // window through the wall slabs, back to 2× for the floor return.
    // M9: the window opens on beat 190 (95.06 s).
    {
      id: 'ps-speed-wall-calm', z: 1453.5, multiplier: 1,
      triggerCenter: { x: 0, y: 8.5, z: 1453.5 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-speed-wall-burst', z: 1489, multiplier: 2,
      triggerCenter: { x: 0, y: 1.5, z: 1489 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
    {
      id: 'ps-speed-calm2', z: 1778, multiplier: 1,
      triggerCenter: { x: 0, y: 1.5, z: 1778 },
      triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    },
  ],
  modePortals: [
    // M9: ship-on lands on beat 151 (75.56 s) — gate at the tunnel mouth.
    {
      id: 'ps-ship-on', z: 1107, target: 'ship',
      triggerCenter: { x: 0, y: 1.5, z: 1107 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
    {
      id: 'ps-ship-off', z: 1313, target: 'cube',
      triggerCenter: { x: 0, y: 2.6, z: 1313 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
    {
      id: 'ps-spider-on', z: 1343, target: 'spider',
      triggerCenter: { x: 0, y: 1.5, z: 1343 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
    {
      id: 'ps-spider-off', z: 1501, target: 'cube',
      triggerCenter: { x: 0, y: 1.5, z: 1501 },
      triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
    },
    {
      id: 'ps-remix-spider-on', z: 1745, target: 'spider',
      triggerCenter: { x: 0, y: 1.5, z: 1745 },
      triggerHalfExtents: { x: 1.7, y: 1.5, z: 1.5 },
    },
    {
      id: 'ps-remix-spider-off', z: 1752, target: 'cube',
      triggerCenter: { x: 0, y: 1.5, z: 1752 },
      triggerHalfExtents: { x: 1.7, y: 1.5, z: 1.5 },
    },
  ],
  jumpPads: [
    // ACT 2: center-lane launch onto the MID deck (top 4.5); lanes 0/2
    // bypass on the LOW weave (branch split). M9: +0.8 u so the launch
    // lands on beat 39 (19.56 s).
    {
      id: 'ps-pad-sky',
      center: { x: 0, y: 0.3, z: 271.3 },
      halfExtents: { x: 1.2, y: 0.3, z: 1 },
      surface: 'floor',
      impulse: 22,
    },
    // ACT 2: ridge launch from the MID deck onto the HIGH island. M9:
    // +1.3 u for beat 44 (22.06 s).
    {
      id: 'ps-pad-ridge',
      center: { x: 0, y: 4.8, z: 306.3 },
      halfExtents: { x: 1.2, y: 0.3, z: 1 },
      surface: 'floor',
      impulse: 19,
    },
    // ACT 3: required launch onto the upper maze deck (top 4.5).
    {
      id: 'ps-pad-maze',
      center: { x: 0, y: 0.3, z: 530.5 },
      halfExtents: { x: 1.2, y: 0.3, z: 1 },
      surface: 'floor',
      impulse: 22,
    },
    // ACT 8: center-lane launch through the HIGH teleport ring. M9: the
    // whole gantry (pad + dividers + both rings) rides +2.2 u so the
    // launch lands on beat 198 (99.06 s) with the ring threading intact.
    {
      id: 'ps-pad-high',
      center: { x: 0, y: 0.3, z: 1514.7 },
      halfExtents: { x: 1.2, y: 0.3, z: 1 },
      surface: 'floor',
      impulse: 26,
    },
    // ACT 4: passive recovery out of the fall shaft (top −6 → 0) —
    // catches the fall mid-drop (the swept path crosses it before landing).
    // M9: position REVERTED — the catch geometry only overlaps the fall
    // path at this exact z (a recovery, not a beat anchor).
    {
      id: 'ps-pad-shaft',
      center: { x: 0, y: -5.7, z: 895.5 },
      halfExtents: { x: 1.2, y: 1.5, z: 2.5 },
      surface: 'floor',
      impulse: 21,
    },
  ],
  jumpOrbs: [
    // Required orbs: z-half 1.5 (3 u flight-direction windows) — required
    // mid-flight presses must stay reliably hittable (never frame-perfect)
    // while x/y stay precise; unit press edges sit mid-window.
    // ACT 1 funnel: required mid-flight orb reshaping the hop arc onto
    // tread 1 (impulse 12; missing it lands short at the riser face).
    {
      id: 'ps-orb-forge',
      center: { x: 0, y: 1.5, z: 50 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 12,
    },
    // ACT 3 door orbs (impulse 8): (a) lane-2 hop-assist through door 2
    // (pressed grounded), (b) lane-1 grounded launch through door 4,
    // (c) lane-1 mid-flight reshaper on the hop-3 arc.
    {
      id: 'ps-orb-maze-a',
      center: { x: -2.6, y: 1.5, z: 468 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 8,
    },
    {
      id: 'ps-orb-maze-b',
      center: { x: 0, y: 1.5, z: 499 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 8,
    },
    {
      id: 'ps-orb-maze-c',
      center: { x: 0, y: 2.35, z: 491 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 8,
    },
    // ACT 2 LOW-ground orbs (lane 0): (a) mid-flight reshaper before door
    // 324, (b) mid-flight reshaper before the 338.5 rhythm hop.
    {
      id: 'ps-orb-low-a',
      center: { x: 2.6, y: 2.0, z: 317 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 8,
    },
    {
      id: 'ps-orb-low-b',
      center: { x: 2.6, y: 2.6, z: 329 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 6,
    },
    // ACT 9 island orbs (center): (a) mid-flight reshaper onto island 1,
    // (b) mid-transit reshaper onto island 3 (pressed while steering).
    {
      id: 'ps-orb-maw-exit',
      center: { x: 0, y: 2.0, z: 1625 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 6,
    },
    {
      id: 'ps-orb-island-c',
      center: { x: 0, y: 2.62, z: 1647 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 6,
    },
    // ACT 3 pad-flight orb (center — mid-flight reshaper onto the upper
    // deck; the pad-maze launch alone leaves a 19 u desert).
    {
      id: 'ps-orb-pad-maze',
      center: { x: 0, y: 6.19, z: 539 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 10,
    },
    // ACT 2 upper: required orb over the 8 u HIGH gap.
    {
      id: 'ps-orb-sky',
      center: { x: 0, y: 9.6, z: 333.5 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 11,
    },
    // ACT 2 ferry-exit orb (center — mid-flight reshaper into hop 2).
    {
      id: 'ps-orb-ferry-exit',
      center: { x: 0, y: 2.59, z: 417 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 6,
    },
    // ACT 3 approach orb (center — mid-flight reshaper onto the runway).
    {
      id: 'ps-orb-approach',
      center: { x: 0, y: 2.51, z: 430.5 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 6,
    },
    // ACT 8 HIGH deck: required orbs over the two 8 u gaps (impulse 13
    // keeps the combined arcs well under deathYMax). M9: orb-b rides
    // −2 u (beat-204 window) with the driver press tracking mid-window.
    {
      id: 'ps-orb-terminal-a',
      center: { x: 0, y: 9.6, z: 1546.5 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 13,
    },
    {
      id: 'ps-orb-terminal-b',
      center: { x: 0, y: 9.6, z: 1560.5 },
      halfExtents: { x: 0.9, y: 0.9, z: 1.5 },
      impulse: 13,
    },
  ],
  gravityOrbs: [
    // ACT 4: ceiling traverse over the lava strip and back. M9: beats 127
    // (63.56 s) + 129 (64.56 s) — driver presses track the windows.
    { id: 'ps-gorb-spire', center: { x: 0, y: 1.6, z: 902.2 }, halfExtents: { x: 0.9, y: 0.9, z: 1.5 } },
    { id: 'ps-gorb-spire-back', center: { x: 0, y: 8.9, z: 915.2 }, halfExtents: { x: 0.9, y: 0.9, z: 1.5 } },
  ],
  teleportPortals: [
    // ACT 8 gantry: two bounded entries (HIGH via pad / LOW via lane 2).
    // Lane 0 meets no deck (death by routing); missing the rings meets a
    // divider wall (frontImpact). M9: +2.2 u with the pad (beat-198/199).
    {
      id: 'ps-teleport-high',
      entryZ: 1522.2,
      entryCenter: { x: 0, y: 9, z: 1522.2 },
      entryHalfExtents: { x: 0.9, y: 1.7, z: 1 },
      exit: { x: 0, y: 8.55, z: 1532.2 },
      exitLaneIndex: 1,
      style: 'gate',
    },
    {
      id: 'ps-teleport-low',
      entryZ: 1522.2,
      entryCenter: { x: -2.6, y: 1.5, z: 1522.2 },
      entryHalfExtents: { x: 0.9, y: 1.7, z: 1 },
      exit: { x: -2.6, y: 1.05, z: 1532.2 },
      exitLaneIndex: 2,
      style: 'gate',
    },
    // ACT 9 maw hop over the void before the finale content. M9: entry
    // on beat 209 (104.56 s); the exit anchor is unchanged.
    {
      id: 'ps-teleport-maw',
      entryZ: 1597,
      entryCenter: { x: 0, y: 1.5, z: 1597 },
      entryHalfExtents: { x: 1.8, y: 1.8, z: 1 },
      exit: { x: 0, y: 1.75, z: 1614 },
      exitLaneIndex: 1,
      style: 'maw',
    },
  ],
  chompers: [
    // ACT 5 #1: lunge across the ferry deck (jump FROM the ferry).
    // M9: lunge starts on beat 133 (66.56 s — telegraph anticipates it).
    {
      id: 'ps-chomp-ferry',
      dormant: { x: 8, y: 0.75, z: 952 },
      triggerZ: 937.8,
      lungeDirection: -1,
      lungeDistance: 16,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: 10, y: 2.5, z: 952 },
    },
    // ACT 5 #2: lunge out of the lane weave. M9: beat 140 (70.06 s).
    {
      id: 'ps-chomp-weave',
      dormant: { x: -8, y: 0.75, z: 995 },
      triggerZ: 986.5,
      lungeDirection: 1,
      lungeDistance: 16,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: -10, y: 2.5, z: 995 },
    },
    // ACT 5 #3: ceiling lunge (dodge by ceiling jump). M9: beat 143.
    {
      id: 'ps-chomp-ceil',
      dormant: { x: 8, y: 9.3, z: 1015 },
      triggerZ: 1007.5,
      lungeDirection: -1,
      lungeDistance: 16,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: 10, y: 11, z: 1015 },
    },
    // ACT 5 #4: low-ceiling lane dodge (short lunge 8 → 0 — the side
    // lane is statically safe, no jump under the head-bump ceiling).
    // M9: trigger 6 u upstream — at 2× the fixed-tick telegraph+lunge
    // covers ~14 u of player travel, so the lunge lands on the same
    // choreography (dodge at 1048, return after 1061).
    {
      id: 'ps-chomp-low',
      dormant: { x: 8, y: 0.75, z: 1052 },
      triggerZ: 1036,
      lungeDirection: -1,
      lungeDistance: 8,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: 10, y: 2.5, z: 1052 },
    },
    // ACT 9 #5: finale lunge out of the spider exit (short lunge
    // −8 → 0 — lane 0 is statically safe, dodged by lane, never jumped
    // at 2× where the flight would overshoot into the river). M9: the
    // lunge lands on beat 227 (113.56 s).
    {
      id: 'ps-chomp-final',
      dormant: { x: -8, y: 0.75, z: 1758 },
      triggerZ: 1751,
      lungeDirection: 1,
      lungeDistance: 8,
      telegraphTicks: 48,
      lungeTicks: 60,
      halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
      chainAnchor: { x: -10, y: 2.5, z: 1758 },
    },
  ],
  movingPlatforms: [
    // ACT 8: drop-onto elevator under the HIGH deck hole (phase-free
    // boarding — the shaft cross-section always catches the fall).
    {
      id: 'ps-lift-void',
      base: { x: 0, y: 2, z: 1575 },
      halfExtents: { x: 1.5, y: 0.5, z: 5 },
      axis: 'y',
      amplitude: 2,
      periodTicks: 360,
      phaseTicks: 0,
    },
    // ACT 2: lateral ferry over the 30 u void (counter-steer ride).
    {
      id: 'ps-ferry-void',
      base: { x: 0, y: -0.5, z: 393 },
      halfExtents: { x: 3, y: 0.5, z: 10 },
      axis: 'x',
      amplitude: 4,
      periodTicks: 360,
      phaseTicks: 0,
    },
    // ACT 3: opposite-phase ferry pair over the 28 u void (wide decks +
    // arrival-phased so the first deck is boardable on arrival; phases
    // retuned empirically against the driver clock — see driver notes).
    {
      id: 'ps-ferry-maze-a',
      base: { x: -2.6, y: -0.5, z: 668 },
      halfExtents: { x: 2.5, y: 0.5, z: 3 },
      axis: 'x',
      amplitude: 2,
      periodTicks: 300,
      phaseTicks: 74,
    },
    {
      id: 'ps-ferry-maze-b',
      base: { x: 2.6, y: -0.5, z: 680 },
      halfExtents: { x: 2.5, y: 0.5, z: 3 },
      axis: 'x',
      amplitude: 2,
      periodTicks: 300,
      phaseTicks: 224,
    },
    // ACT 5: ferry deck under the first Chomper lunge (phased for a
    // centered arrival boarding; the rider counter-steers mid-crossing).
    {
      id: 'ps-ferry-chomp',
      base: { x: 0, y: -0.5, z: 950 },
      halfExtents: { x: 3, y: 0.5, z: 10 },
      axis: 'x',
      amplitude: 3,
      periodTicks: 360,
      phaseTicks: 339,
    },
  ],
  // M9.2 practice checkpoints (CHECKPOINT RUNS only — classic ignores
  // them): one per major segment / biome transition, all sampled from the
  // reference driver (BOTH primary + alternate variants pass through every
  // volume; see scripts/tmp-sample-checkpoints.ts evidence). Every center
  // is a grounded stable state on the intended route (cube, floor) —
  // never mid-air over void, never inside a hazard, never one frame
  // before a mandatory precision input:
  //   FORGE 168 — post-ascent runway (solid-20), pre-islands.
  //   SKYBRIDGE 395 — riding the void ferry (platform-ps-ferry-void),
  //     both variants converged on the same deck.
  //   LABYRINTH 705 — maze-exit 2× runway (solid-68), pre-spire.
  //   CATHEDRAL 920 — post-spire floor runway (solid-82), pre-foundry.
  //   FOUNDRY 1100 — pre-ship 2× runway (solid-101), cube, pre-ship-on.
  //   REACTOR 1325 — post-ship runway (solid-139), cube, pre-spider-on.
  //   TEMPLE 1500 — post-spider runway (solid-156), cube, pre-teleports.
  //   CORE 1620 — post-teleport runway (solid-171), pre-finale.
  checkpoints: [
    { id: 'cp-forge', displayName: 'FORGE', center: { x: 0, y: 0.55, z: 170 }, halfExtents: { x: 2, y: 1.2, z: 2.5 } },
    { id: 'cp-skybridge', displayName: 'SKYBRIDGE', center: { x: 3.7, y: 0.55, z: 395 }, halfExtents: { x: 1.6, y: 1.2, z: 3 } },
    { id: 'cp-labyrinth', displayName: 'LABYRINTH', center: { x: 1.3, y: 0.55, z: 705 }, halfExtents: { x: 2.2, y: 1.2, z: 3 } },
    { id: 'cp-cathedral', displayName: 'CATHEDRAL', center: { x: 0, y: 0.55, z: 921.5 }, halfExtents: { x: 2, y: 1.2, z: 1.5 } },
    { id: 'cp-foundry', displayName: 'FOUNDRY', center: { x: 0, y: 0.55, z: 1100 }, halfExtents: { x: 2, y: 1.2, z: 3 } },
    { id: 'cp-reactor', displayName: 'REACTOR', center: { x: 0, y: 0.55, z: 1325 }, halfExtents: { x: 2, y: 1.2, z: 3 } },
    { id: 'cp-temple', displayName: 'TEMPLE', center: { x: 0, y: 0.55, z: 1502 }, halfExtents: { x: 2, y: 1.2, z: 2 } },
    { id: 'cp-core', displayName: 'CORE', center: { x: 0, y: 0.55, z: 1620 }, halfExtents: { x: 2, y: 1.2, z: 3 } },
  ],
  lava: [
    // ACT 1 directed river (at-grade 3 u hop, z 140.5..143.5).
    { id: 'ps-river', center: { x: 0, y: 0.1, z: 142 }, halfExtents: { x: 4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
    { id: 'ps-river-src', center: { x: 4.2, y: 2.9, z: 142 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
    { id: 'ps-river-fall', center: { x: 4.2, y: 1.5, z: 142 }, halfExtents: { x: 0.6, y: 1, z: 0.8 }, role: 'fall' },
    { id: 'ps-river-out', center: { x: -6.4, y: -0.05, z: 142 }, halfExtents: { x: 2.4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
    { id: 'ps-river-drop', center: { x: -8.6, y: -7.25, z: 142 }, halfExtents: { x: 0.6, y: 7.75, z: 0.9 }, role: 'fall' },
    // ACT 2 lava pools under the island chains (menace below the route).
    { id: 'ps-sky-west', center: { x: -8.5, y: -3.2, z: 240 }, halfExtents: { x: 3, y: 0.8, z: 45 }, role: 'pool' },
    { id: 'ps-sky-east', center: { x: 8.5, y: -3.2, z: 240 }, halfExtents: { x: 3, y: 0.8, z: 45 }, role: 'pool' },
    // ACT 3 maze lava chamber (contained, off-route).
    { id: 'ps-maze-pool', center: { x: 9, y: -3.2, z: 485 }, halfExtents: { x: 3, y: 0.8, z: 40 }, role: 'pool' },
    { id: 'ps-maze-src', center: { x: 9, y: 2.5, z: 470 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
    { id: 'ps-maze-fall', center: { x: 9, y: -0.3, z: 470 }, halfExtents: { x: 0.7, y: 2.5, z: 0.9 }, role: 'fall' },
    // ACT 4 spire lava strip (jumped on the gravity-orb ceiling traverse).
    { id: 'ps-spire-strip', center: { x: 0, y: 0.1, z: 911.5 }, halfExtents: { x: 4, y: 0.6, z: 3.5 }, role: 'pool' },
    { id: 'ps-spire-strip-src', center: { x: 4.2, y: 2.9, z: 911.5 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
    // ACT 5 foundry side pools + river between decks.
    { id: 'ps-foundry-west', center: { x: -8.5, y: -3.2, z: 1000 }, halfExtents: { x: 3, y: 0.8, z: 50 }, role: 'pool' },
    { id: 'ps-foundry-east', center: { x: 8.5, y: -3.2, z: 1000 }, halfExtents: { x: 3, y: 0.8, z: 50 }, role: 'pool' },
    { id: 'ps-foundry-lava-gap', center: { x: 0, y: 0.1, z: 1046.5 }, halfExtents: { x: 4, y: 0.6, z: 1.5 }, role: 'pool' },
    // ACT 6 abyss exterior glow (outside the tunnel walls).
    { id: 'ps-abyss-glow', center: { x: 9, y: 0, z: 1220 }, halfExtents: { x: 2, y: 4, z: 60 }, role: 'pool' },
    // ACT 9 homage river (same directed pattern, z 1770.5..1773.5).
    { id: 'ps-final-river', center: { x: 0, y: 0.1, z: 1772 }, halfExtents: { x: 4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
    { id: 'ps-final-river-src', center: { x: 4.2, y: 2.9, z: 1772 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
    { id: 'ps-final-river-fall', center: { x: 4.2, y: 1.5, z: 1772 }, halfExtents: { x: 0.6, y: 1, z: 0.8 }, role: 'fall' },
    { id: 'ps-final-river-out', center: { x: -6.4, y: -0.05, z: 1772 }, halfExtents: { x: 2.4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
    { id: 'ps-final-river-drop', center: { x: -8.6, y: -7.25, z: 1772 }, halfExtents: { x: 0.6, y: 7.75, z: 0.9 }, role: 'fall' },
  ],

  solids: [
    // ================= ACT 1 FORGE ASCENT (0..176) =================
    // M9.1 REBUILD: the old entry slab + wide MID deck + single catcher
    // are gone. The forge now opens with a staggered island chain (first
    // input at z~2.5), offset broken stairs, a 1-lane sky pier with hop
    // rhythm, a staggered double-catcher drop shaft, a narrow slalom road
    // and a fast-fall exit drop. Every support is 1–2 lanes wide (the
    // audit's one-band lever); wide slabs survive only as the entry slab
    // and the act handover.
    // Entry slab (top 0, z -10..4).
    { center: { x: 0, y: -0.5, z: -3 }, halfExtents: { x: 5.4, y: 0.5, z: 7 } },
    // Staggered island chain (5 u gaps = the 8.8 u jump rhythm, alternating
    // lateral offsets — jump + steer from the first seconds).
    { center: { x: 0, y: -0.5, z: 12 }, halfExtents: { x: 1.6, y: 0.5, z: 3 } },
    { center: { x: -2.6, y: -0.5, z: 23 }, halfExtents: { x: 1.6, y: 0.5, z: 3 } },
    { center: { x: 2.6, y: -0.5, z: 33 }, halfExtents: { x: 2.6, y: 0.5, z: 3 } },
    // Landing funnel (wide catch, z 41..45 — the offset transfer lands
    // here mid-transit), hop gap (45..48),
    // riser (z 48..54) with a REQUIRED mid-flight orb: hop from the funnel,
    // press the orb airborne, ride the reshaped arc onto tread 1 (missing
    // the orb lands short at the riser face — fair, telegraphed).
    { center: { x: 0, y: -0.5, z: 43 }, halfExtents: { x: 5.4, y: 0.5, z: 2 } },
    { center: { x: 0, y: -0.5, z: 50.5 }, halfExtents: { x: 1.6, y: 0.5, z: 3.5 } },
    // Broken offset stairs (risers 1.5; tread 1 meets the funnel so the
    // apex-on-face takeoff comes 5 u after the funnel landing).
    { center: { x: 1.3, y: 0.75, z: 59 }, halfExtents: { x: 1.3, y: 0.75, z: 5 } },
    { center: { x: -1.3, y: 1.5, z: 73 }, halfExtents: { x: 1.3, y: 1.5, z: 4 } },
    // Sky pier (top 4.5, z 82..102): 1-lane entry with a hop spike, then a
    // 2-lane span with a center tooth forcing the drop-side lane.
    { center: { x: 0, y: 2, z: 87 }, halfExtents: { x: 1.3, y: 2.5, z: 5 } },
    { center: { x: 0, y: 2, z: 97 }, halfExtents: { x: 2, y: 2.5, z: 5 } },
    // Drop shaft: staggered catchers (A lane 2, B lane 0) force drop +
    // steer + immediate double transfer.
    { center: { x: -2.6, y: -0.5, z: 107.5 }, halfExtents: { x: 2, y: 0.5, z: 2.5 } },
    { center: { x: 2.6, y: -0.5, z: 115.5 }, halfExtents: { x: 2, y: 0.5, z: 3.5 } },
    // Narrow jog road (top 0, z 120..136): center span then a left-offset
    // span (same height — steer through, no jump) with one hop spike on
    // the offset line. Narrow support holds the single band throughout.
    { center: { x: 0, y: -0.5, z: 124 }, halfExtents: { x: 1.6, y: 0.5, z: 4 } },
    { center: { x: -1.3, y: -0.5, z: 132 }, halfExtents: { x: 1.6, y: 0.5, z: 4 } },
    // River containment (z 140.5..143.5): east pillar + curb + shelf + rims.
    { center: { x: 4.9, y: 1.75, z: 142 }, halfExtents: { x: 0.5, y: 1.75, z: 1 } },
    { center: { x: 4.375, y: -0.1, z: 142 }, halfExtents: { x: 0.375, y: 0.75, z: 1.75 } },
    { center: { x: -7.4, y: -1.15, z: 142 }, halfExtents: { x: 2, y: 0.5, z: 1.75 } },
    { center: { x: -6.4, y: -0.1, z: 140.3 }, halfExtents: { x: 2.4, y: 0.85, z: 0.3 } },
    { center: { x: -6.4, y: -0.1, z: 143.7 }, halfExtents: { x: 2.4, y: 0.85, z: 0.3 } },
    // River takeoff strip (narrow, z 136..140.5).
    { center: { x: 0, y: -0.5, z: 138.25 }, halfExtents: { x: 1.6, y: 0.5, z: 2.25 } },
    // Post-river strip (narrow, z 144..168 — side lanes are void, leaving
    // center falls) for the kept proving double (160 + 164).
    { center: { x: 0, y: -0.5, z: 156 }, halfExtents: { x: 1.6, y: 0.5, z: 12 } },
    // Exit drop island (top −1.5, z 170..174): fast-fall off the strip,
    // immediate jump back up to the handover road.
    { center: { x: 0, y: -2, z: 172 }, halfExtents: { x: 1.6, y: 0.5, z: 2 } },
    // Handover road (wide recovery, z 176..184).
    { center: { x: 0, y: -0.5, z: 180 }, halfExtents: { x: 5.4, y: 0.5, z: 4 } },
    // Forge flanking towers (off-route silhouettes).
    { center: { x: 9, y: 4, z: 60 }, halfExtents: { x: 1.5, y: 8, z: 3 } },
    { center: { x: -9, y: 4, z: 110 }, halfExtents: { x: 1.5, y: 8, z: 3 } },

    // ================= ACT 2 SKYBRIDGE ISLANDS (176..430, M9.1) =================
    // M9.1 REBUILD (anchor-preserving): pads (271.3 / 306.3), orb (333.5),
    // ferry-void (393), HIGH/LOW branch split and all lava stay on their
    // musical Z — but every wide slab between them is split into narrow
    // strips + stubs, threaded with teeth corridors, hop spikes and doors.
    // Entry road (top 0, z 176..190, narrowed — the F-drop jump lands
    // center and the island takeoff leaves center; teeth hold the line).
    { center: { x: 0, y: -0.5, z: 183 }, halfExtents: { x: 1.6, y: 0.5, z: 7 } },
    // Entry island chain (1-lane, alternating offsets — takeoffs sit
    // ≥ 0.7 u after each landing so one-shot edges never fire mid-air).
    { center: { x: 0, y: -0.5, z: 193 }, halfExtents: { x: 1.6, y: 0.5, z: 3 } },
    { center: { x: -2.6, y: -0.5, z: 204 }, halfExtents: { x: 1.6, y: 0.5, z: 3 } },
    { center: { x: 2.6, y: -0.5, z: 213 }, halfExtents: { x: 1.6, y: 0.5, z: 3 } },
    { center: { x: 0, y: -0.5, z: 222 }, halfExtents: { x: 1.6, y: 0.5, z: 3 } },
    // Stair landing (top 0, z 227..236) + offset stairs (risers 1.5, faces
    // placed for apex-on-face takeoffs after each landing; the drop off
    // stair 2 lands with room for the pad hop).
    { center: { x: 0, y: -0.5, z: 231.5 }, halfExtents: { x: 5.4, y: 0.5, z: 4.5 } },
    { center: { x: 1.3, y: 0.75, z: 243 }, halfExtents: { x: 1.3, y: 0.75, z: 5 } },
    { center: { x: -1.3, y: 1.5, z: 253.5 }, halfExtents: { x: 1.3, y: 1.5, z: 4 } },
    // LOW road (top 0, z 227..262) under the stairs — the alternate weaves
    // around the stair fronts here (stairs block bands statically).
    { center: { x: 0, y: -0.5, z: 244.5 }, halfExtents: { x: 5.4, y: 0.5, z: 17.5 } },
    // Pad approach split (z 262..280): center strip (primary drop + hop +
    // pad run) + lane-0 side strip (alternate weave) — lane-2 side is void.
    { center: { x: 0, y: -0.5, z: 271 }, halfExtents: { x: 1.6, y: 0.5, z: 9 } },
    { center: { x: 2.6, y: -0.5, z: 271 }, halfExtents: { x: 2, y: 0.5, z: 9 } },
    // Pad-split floor (top 0, z 280..312) NARROWED to lanes 0+1: the
    // alternate LOW weave runs lane 0 here while the primary pad flight
    // passes overhead (the narrowed support caps the bands at two).
    { center: { x: 2.05, y: -0.5, z: 296 }, halfExtents: { x: 3.35, y: 0.5, z: 16 } },
    // MID deck after the pad (top 4.5, z 280..312) NARROWED to lanes 1+2
    // over the LOW branch: slab spans y 2..4.5, 2 u run-under corridor.
    { center: { x: -1, y: 3.25, z: 296 }, halfExtents: { x: 2.2, y: 1.25, z: 16 } },
    { center: { x: 6.5, y: 1, z: 288 }, halfExtents: { x: 1, y: 1, z: 1 } },
    { center: { x: -6.5, y: 1, z: 296 }, halfExtents: { x: 1, y: 1, z: 1 } },
    { center: { x: 6.5, y: 1, z: 304 }, halfExtents: { x: 1, y: 1, z: 1 } },
    // HIGH island (top 8, z 312..330) NARROWED + overhang ceiling (bottom 11).
    { center: { x: 0, y: 6, z: 321 }, halfExtents: { x: 1.6, y: 2, z: 9 } },
    { center: { x: 0, y: 12, z: 321 }, halfExtents: { x: 5.4, y: 1, z: 9 } },
    // HIGH landing (top 8, z 340..347) NARROWED after the required orb gap.
    { center: { x: 0, y: 7.5, z: 343.5 }, halfExtents: { x: 1.6, y: 0.5, z: 3.5 } },
    // MID drop slab (top 4.5, z 347..360) NARROWED over the LOW route.
    { center: { x: 0, y: 3.25, z: 353.5 }, halfExtents: { x: 1.6, y: 1.25, z: 6.5 } },
    { center: { x: 4, y: 1, z: 350 }, halfExtents: { x: 0.5, y: 1, z: 1 } },
    { center: { x: -4, y: 1, z: 357 }, halfExtents: { x: 0.5, y: 1, z: 1 } },
    // LOW ground route beneath the HIGH line (kept full — the M9 doors
    // hold lanes 1+2 statically; the primary center fall lands here).
    { center: { x: 0, y: -0.5, z: 319 }, halfExtents: { x: 5.4, y: 0.5, z: 7 } },
    { center: { x: 0, y: -0.5, z: 335 }, halfExtents: { x: 5.4, y: 0.5, z: 9 } },
    { center: { x: 0, y: -0.5, z: 353 }, halfExtents: { x: 5.4, y: 0.5, z: 9 } },
    // LOW runway to the void (top 0, z 360..378, lanes 0+1 — the primary
    // center fall and the alternate lane-0 line share it; lane 2 is void).
    { center: { x: 2.05, y: -0.5, z: 369 }, halfExtents: { x: 3.35, y: 0.5, z: 9 } },
    // Far runway (top 0, z 408..430) NARROWED with discipline teeth +
    // exit orb-hop (mid-flight reshaper into the second hop).
    { center: { x: 0, y: -0.5, z: 419 }, halfExtents: { x: 1.6, y: 0.5, z: 11 } },
    // Skybridge side pools containment.
    { center: { x: -8.5, y: -4.5, z: 240 }, halfExtents: { x: 3.5, y: 0.5, z: 45.5 } },
    { center: { x: -11.625, y: -2.25, z: 240 }, halfExtents: { x: 0.375, y: 0.75, z: 45.5 } },
    { center: { x: 8.5, y: -4.5, z: 240 }, halfExtents: { x: 3.5, y: 0.5, z: 45.5 } },
    { center: { x: 11.625, y: -2.25, z: 240 }, halfExtents: { x: 0.375, y: 0.75, z: 45.5 } },
    // Island chain support pillars (visual verticality, off-route).
    { center: { x: 5, y: -4, z: 196 }, halfExtents: { x: 1, y: 4, z: 1.5 } },
    { center: { x: -5, y: -4, z: 250 }, halfExtents: { x: 1, y: 4, z: 1.5 } },

    // ================= ACT 3 MAZE RUNNER (430..720, M9.1) =================
    // M9.1 REBUILD: the 3 two-door walls become 5 SINGLE doors + 1 double
    // split-door with hop spikes + teeth jogs between (one shared line,
    // both variants); the upper deck narrows to a 1-lane hole-chain with
    // hop rhythm; the lower deck narrows to a lanes-1+2 weave strip fed by
    // a transition runway (alternate). Ferry pair + 2× exit untouched.
    // Lower runway (top 0, z 430..540 — doors sculpt the single line).
    { center: { x: 0, y: -0.5, z: 485 }, halfExtents: { x: 5.4, y: 0.5, z: 55 } },
    // Upper deck (top 4.5) NARROWED to a 1-lane hole-chain (joints at
    // 560..564 + 584..588 are the precision jumps): slab spans y 3.5..4.5
    // so the alternate weave + exit jump fit underneath (jump envelope).
    { center: { x: 0, y: 4, z: 550 }, halfExtents: { x: 1.6, y: 0.5, z: 10 } },
    { center: { x: 0, y: 4, z: 574 }, halfExtents: { x: 1.6, y: 0.5, z: 10 } },
    { center: { x: 0, y: 4, z: 605 }, halfExtents: { x: 1.6, y: 0.5, z: 17 } },
    // Deck support pillars (off-route, x=±6.5).
    { center: { x: 6.5, y: 1.75, z: 560 }, halfExtents: { x: 1, y: 1.75, z: 1 } },
    { center: { x: -6.5, y: 1.75, z: 584 }, halfExtents: { x: 1, y: 1.75, z: 1 } },
    { center: { x: 6.5, y: 1.75, z: 605 }, halfExtents: { x: 1, y: 1.75, z: 1 } },
    // Lower weave strip (top 0, z 548..622, lanes 1+2) + transition runway
    // (full, z 534..548 — the alternate crosses from lane 0 to lane 2).
    { center: { x: 0, y: -0.5, z: 541 }, halfExtents: { x: 5.4, y: 0.5, z: 7 } },
    { center: { x: -1.3, y: -0.5, z: 585 }, halfExtents: { x: 2.6, y: 0.5, z: 37 } },
    // Exit slab (top 0, z 628..660) NARROWED with a hop spike.
    { center: { x: 0, y: -0.5, z: 644 }, halfExtents: { x: 1.6, y: 0.5, z: 16 } },
    // Post-ferry slab (top 0, z 688..720 — kept full: the 2× gates need
    // every lane for the one-tap line).
    { center: { x: 0, y: -0.5, z: 704 }, halfExtents: { x: 5.4, y: 0.5, z: 16 } },
    // Maze chamber containment + lava pool rim (east pool z 465..505).
    { center: { x: 9, y: -4.5, z: 485 }, halfExtents: { x: 3.5, y: 0.5, z: 40.5 } },
    { center: { x: 12.125, y: -2.25, z: 485 }, halfExtents: { x: 0.375, y: 0.75, z: 40.5 } },
    // Maze towers flanking the doors (multi-storey silhouettes).
    { center: { x: 8, y: 5, z: 450 }, halfExtents: { x: 1.5, y: 9, z: 2 } },
    { center: { x: -8, y: 5, z: 480 }, halfExtents: { x: 1.5, y: 9, z: 2 } },
    { center: { x: 8, y: 5, z: 510 }, halfExtents: { x: 1.5, y: 9, z: 2 } },
    // Maze vent stack (rock rising from the east pool, side-mounts the
    // lava source vent — off-route).
    { center: { x: 10.4, y: -0.5, z: 470 }, halfExtents: { x: 0.5, y: 3.5, z: 1 } },

    // ================= ACT 4 GRAVITY SPIRE (720..920, M9.1) =================
    // M9.1 REBUILD (portals/orbs/pad/lava on their musical Z): narrowed
    // entry + ceiling hole-chain (dive-hop rhythm), wall hop, shaft ff-drop.
    { center: { x: 0, y: -0.5, z: 732.5 }, halfExtents: { x: 1.6, y: 0.5, z: 12.5 } },
    // Ceiling run slabs (underside y=10, z 745..776 + 779..795, 1-lane).
    { center: { x: 0, y: 10.5, z: 760.5 }, halfExtents: { x: 1.6, y: 0.5, z: 15.5 } },
    { center: { x: 0, y: 10.5, z: 787 }, halfExtents: { x: 1.6, y: 0.5, z: 8 } },
    // Left-wall slab (face x=5.4, y −1..11, z 795..835).
    { center: { x: 5.9, y: 5, z: 815 }, halfExtents: { x: 0.5, y: 6, z: 20 } },
    // Right-wall slab (face x=−5.4, y −1..7, z 835..865).
    { center: { x: -5.9, y: 3, z: 850 }, halfExtents: { x: 0.5, y: 4, z: 15 } },
    // Floor runway (starts 858, under the wall exit, narrowed) + fall
    // shaft (hole z 890..896, lower floor top −6, pad catches the fall).
    { center: { x: 0, y: -0.5, z: 874 }, halfExtents: { x: 1.6, y: 0.5, z: 16 } },
    { center: { x: 0, y: -6.5, z: 894 }, halfExtents: { x: 1.6, y: 0.5, z: 4 } },
    { center: { x: 0, y: -0.5, z: 911 }, halfExtents: { x: 1.6, y: 0.5, z: 9 } },
    // Orb-traverse ceiling slab (underside y=10, z 900..918).
    { center: { x: 0, y: 10.5, z: 909 }, halfExtents: { x: 5.4, y: 0.5, z: 9 } },
    // Spire lava-strip containment (basin floor + rims, z 908..915).
    { center: { x: 0, y: -1.5, z: 911.5 }, halfExtents: { x: 4.5, y: 0.5, z: 4 } },
    { center: { x: -4.375, y: -0.5, z: 911.5 }, halfExtents: { x: 0.375, y: 1, z: 4 } },
    { center: { x: 0, y: -0.5, z: 907.75 }, halfExtents: { x: 4.5, y: 1, z: 0.375 } },
    { center: { x: 0, y: -0.5, z: 915.25 }, halfExtents: { x: 4.5, y: 1, z: 0.375 } },
    // Spire vent pillar (east source mount — river-pillar clone, off-route).
    { center: { x: 4.9, y: 1.75, z: 911.5 }, halfExtents: { x: 0.5, y: 1.75, z: 1 } },
    // Spire vertical frames (over/under route crossings).
    { center: { x: 0, y: 13, z: 760 }, halfExtents: { x: 7, y: 0.8, z: 1 } },
    { center: { x: 7.5, y: 5, z: 815 }, halfExtents: { x: 1, y: 9, z: 2 } },

    // ================= ACT 5 CHOMPER FOUNDRY (920..1110, M9.1) =================
    // M9.1 (chomper triggers/portals/speed/ferry/lava on their musical Z):
    // narrowed entry + ceiling (1-lane, center line), hop before the weave
    // gates, center hop on the ceiling traverse (portal-flight return).
    { center: { x: 0, y: -0.5, z: 927.5 }, halfExtents: { x: 1.6, y: 0.5, z: 7.5 } },
    // Far slab after the ferry void (top 0, z 965..1000 — kept full: the
    // weave gates force lane excursions).
    { center: { x: 0, y: -0.5, z: 982.5 }, halfExtents: { x: 5.4, y: 0.5, z: 17.5 } },
    // Ceiling slab for the #3 swap (underside y=10, z 1000..1030, 1-lane).
    { center: { x: 0, y: 10.5, z: 1015 }, halfExtents: { x: 1.6, y: 0.5, z: 15 } },
    // Low-ceiling block for the #4 lane dodge (bottom y=2.2, z 1060..1066
    // — M9: shifted downstream so the 2× lava-jump flight lands under its
    // lip (top clearance 1.05 u) and runs beneath it; the lengthened 2×
    // lunge tail still runs under it).
    { center: { x: 0, y: 3.6, z: 1063 }, halfExtents: { x: 5.4, y: 1.4, z: 3 } },
    // Foundry pools containment.
    { center: { x: -8.5, y: -4.5, z: 1000 }, halfExtents: { x: 3.5, y: 0.5, z: 50.5 } },
    { center: { x: -11.625, y: -2.25, z: 1000 }, halfExtents: { x: 0.375, y: 0.75, z: 50.5 } },
    { center: { x: 8.5, y: -4.5, z: 1000 }, halfExtents: { x: 3.5, y: 0.5, z: 50.5 } },
    { center: { x: 11.625, y: -2.25, z: 1000 }, halfExtents: { x: 0.375, y: 0.75, z: 50.5 } },
    // #4 lava-gap slabs (route crosses z 1045..1048 over the strip;
    // low ceiling starts AFTER the gap so the jump never head-bumps).
    { center: { x: 0, y: -0.5, z: 1027.5 }, halfExtents: { x: 5.4, y: 0.5, z: 17.5 } },
    // Chomp-low strip (lanes 1+2, z 1048..1078 — the 2× door transit
    // needs width; lane 0 is void) + slalom run (full, z 1078..1100).
    { center: { x: -1.3, y: -0.5, z: 1063 }, halfExtents: { x: 2.6, y: 0.5, z: 15 } },
    { center: { x: 0, y: -0.5, z: 1089 }, halfExtents: { x: 5.4, y: 0.5, z: 11 } },
    // Chain-anchor pillars for the foundry Chompers.
    { center: { x: 10, y: 0, z: 952 }, halfExtents: { x: 1, y: 5, z: 1.5 } },
    { center: { x: -10, y: 0, z: 995 }, halfExtents: { x: 1, y: 5, z: 1.5 } },
    { center: { x: 10, y: 8, z: 1015 }, halfExtents: { x: 1, y: 5, z: 1.5 } },
    { center: { x: 10, y: 0, z: 1052 }, halfExtents: { x: 1, y: 5, z: 1.5 } },

    // ================= ACT 6 SHIP ABYSS (1110..1330) =================
    // Landing runway before the gate + exit runway.
    { center: { x: 0, y: -0.5, z: 1102.5 }, halfExtents: { x: 5.4, y: 0.5, z: 7.5 } },
    // Tunnel shell (floor top −3, ceiling bottom 9, walls x=±6).
    { center: { x: 0, y: -3.5, z: 1220 }, halfExtents: { x: 7, y: 0.5, z: 110 } },
    { center: { x: 0, y: 9.5, z: 1220 }, halfExtents: { x: 7, y: 0.5, z: 110 } },
    { center: { x: -6.5, y: 3, z: 1220 }, halfExtents: { x: 0.5, y: 6, z: 110 } },
    { center: { x: 6.5, y: 3, z: 1220 }, halfExtents: { x: 0.5, y: 6, z: 110 } },
    // Rise wall (top 2, z 1124..1128 — climb early).
    { center: { x: 0, y: -0.5, z: 1126 }, halfExtents: { x: 5.4, y: 2.5, z: 2 } },
    // Dive block (bottom 6, z 1140..1146).
    { center: { x: 0, y: 7.5, z: 1143 }, halfExtents: { x: 5.4, y: 1.5, z: 3 } },
    // Alternating teeth: ceiling (bottom 5.5) / floor (top 0.5) — slalom
    // slot 0.5..5.5 (fairness margins: dust-grazes are not difficulty).
    // M9.1 extends the same rhythm to the invert gate (a correction every
    // ~0.5–1 s through the whole approach).
    { center: { x: 0, y: 7.25, z: 1153.5 }, halfExtents: { x: 5.4, y: 1.75, z: 1.5 } },
    { center: { x: 0, y: -1.25, z: 1161.5 }, halfExtents: { x: 5.4, y: 1.75, z: 1.5 } },
    { center: { x: 0, y: 7.25, z: 1169.5 }, halfExtents: { x: 5.4, y: 1.75, z: 1.5 } },
    { center: { x: 0, y: -1.25, z: 1177.5 }, halfExtents: { x: 5.4, y: 1.75, z: 1.5 } },
    { center: { x: 0, y: 7.25, z: 1185.5 }, halfExtents: { x: 5.4, y: 1.75, z: 1.5 } },
    { center: { x: 0, y: -1.25, z: 1193.5 }, halfExtents: { x: 5.4, y: 1.75, z: 1.5 } },
    // Pillar slalom (full height, one lane blocked each — lateral gates
    // forcing X steering THROUGH the vertical slalom: 3D threading).
    { center: { x: 2.6, y: 3, z: 1182 }, halfExtents: { x: 1.3, y: 6, z: 2 } },
    { center: { x: -2.6, y: 3, z: 1192 }, halfExtents: { x: 1.3, y: 6, z: 2 } },
    { center: { x: 2.6, y: 3, z: 1207 }, halfExtents: { x: 1.3, y: 6, z: 2 } },
    { center: { x: -2.6, y: 3, z: 1222 }, halfExtents: { x: 1.3, y: 6, z: 2 } },
    // Inverted ribs: floor ribs (top −1.5) + ceiling ribs (bottom 7.5).
    { center: { x: 0, y: -2.25, z: 1210 }, halfExtents: { x: 5.4, y: 0.75, z: 1.5 } },
    { center: { x: 0, y: 8.25, z: 1215 }, halfExtents: { x: 5.4, y: 0.75, z: 1.5 } },
    { center: { x: 0, y: -2.25, z: 1220 }, halfExtents: { x: 5.4, y: 0.75, z: 1.5 } },
    { center: { x: 0, y: 8.25, z: 1225 }, halfExtents: { x: 5.4, y: 0.75, z: 1.5 } },
    { center: { x: 0, y: -2.25, z: 1230 }, halfExtents: { x: 5.4, y: 0.75, z: 1.5 } },
    // Mid slot gate (slot y 1.5..5.5, z 1238..1241 — 4 u tall so the
    // dive reads as piloting, not pixel threading; the ship box keeps
    // 0.45+ clearance top and bottom on the reference line).
    { center: { x: 0, y: 7.25, z: 1239.5 }, halfExtents: { x: 5.4, y: 1.75, z: 1.5 } },
    { center: { x: 0, y: -0.75, z: 1239.5 }, halfExtents: { x: 5.4, y: 2.25, z: 1.5 } },
    // S-weave offsets: high block (bottom 4, z 1258..1262), low (top 1, z 1268..1272).
    { center: { x: 0, y: 6.5, z: 1260 }, halfExtents: { x: 5.4, y: 2.5, z: 2 } },
    { center: { x: 0, y: -1, z: 1270 }, halfExtents: { x: 5.4, y: 2, z: 2 } },
    { center: { x: 0, y: 3, z: 1280 }, halfExtents: { x: 1.3, y: 6, z: 2 } },
    // S-weave side pillar (dodged from the far side, then hold the line
    // through the S and the center pillar — pillars 4 u apart cannot be
    // threaded with lane precision, so only one side pillar stands here).
    { center: { x: -2.6, y: 3, z: 1264 }, halfExtents: { x: 1.3, y: 6, z: 2 } },
    // Burst teeth (alternating, z 1290..1298 — same fair slot).
    { center: { x: 0, y: 7.25, z: 1290 }, halfExtents: { x: 5.4, y: 1.75, z: 1.5 } },
    { center: { x: 0, y: -1.25, z: 1294 }, halfExtents: { x: 5.4, y: 1.75, z: 1.5 } },
    { center: { x: 0, y: 7.25, z: 1298 }, halfExtents: { x: 5.4, y: 1.75, z: 1.5 } },
    // Burst side pillars (3D threading through the inverted burst).
    { center: { x: 2.6, y: 3, z: 1292 }, halfExtents: { x: 1.3, y: 6, z: 2 } },
    { center: { x: -2.6, y: 3, z: 1298 }, halfExtents: { x: 1.3, y: 6, z: 2 } },
    // Ship-exit landing runway (top 0, z 1310..1330).
    { center: { x: 0, y: -0.5, z: 1320 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
    // ================= ACT 7 SPIDER SPIRE (1330..1510, M9.1) =================
    // M9.1 (mode/gravity portals on their musical Z): four dodge walls
    // (up/down snap pairs), a 9-snap climb chain (every 5 u), narrowed
    // shaft slabs (precision snap landings), discipline teeth.
    { center: { x: 0, y: -0.5, z: 1345 }, halfExtents: { x: 5.4, y: 0.5, z: 15 } },
    // Ceiling snap slab (underside y=10, z 1340..1400).
    { center: { x: 0, y: 10.5, z: 1370 }, halfExtents: { x: 5.4, y: 0.5, z: 30 } },
    // Spider dodge walls (y 0..3 — snap up before, down after).
    { center: { x: 0, y: 1.5, z: 1350 }, halfExtents: { x: 5.4, y: 1.5, z: 1.5 } },
    { center: { x: 0, y: 1.5, z: 1365 }, halfExtents: { x: 5.4, y: 1.5, z: 1.5 } },
    { center: { x: 0, y: 1.5, z: 1380 }, halfExtents: { x: 5.4, y: 1.5, z: 1.5 } },
    { center: { x: 0, y: 1.5, z: 1395 }, halfExtents: { x: 5.4, y: 1.5, z: 1.5 } },
    // Runway dodge wall (y 8..10, z 1446..1450): the floor path is
    // blocked, the ceiling path (underside 12) clears it — snap up, run,
    // snap down. Missing the first snap meets the wall (frontImpact).
    { center: { x: 0, y: 9, z: 1448 }, halfExtents: { x: 5.4, y: 1, z: 2 } },
    // Climb shaft NARROWED (1-lane precision snap landings): floor A
    // (top 0, z 1400..1414).
    { center: { x: 0, y: -0.5, z: 1407 }, halfExtents: { x: 1.6, y: 0.5, z: 7 } },
    // Ceiling A (underside 8, z 1404..1418).
    { center: { x: 0, y: 8.5, z: 1411 }, halfExtents: { x: 1.6, y: 0.5, z: 7 } },
    // Floor B (top 4.5, z 1416..1430).
    { center: { x: 0, y: 4, z: 1423 }, halfExtents: { x: 1.6, y: 0.5, z: 7 } },
    // Ceiling B (underside 12, z 1420..1434).
    { center: { x: 0, y: 12.5, z: 1427 }, halfExtents: { x: 1.6, y: 0.5, z: 7 } },
    // Floor C (top 8, z 1432..1446) + HIGH runway (top 8, z 1446..1460).
    { center: { x: 0, y: 7.5, z: 1439 }, halfExtents: { x: 1.6, y: 0.5, z: 7 } },
    { center: { x: 0, y: 7.5, z: 1453 }, halfExtents: { x: 1.6, y: 0.5, z: 7 } },
    // Runway snap ceiling (underside 12, z 1444..1454) for the dodge wall.
    { center: { x: 0, y: 12.5, z: 1449 }, halfExtents: { x: 1.6, y: 0.5, z: 5 } },
    // Wall slabs (faces x=±5.4, z 1460..1490; the left wall reaches down
    // to y=2 so the return snap catches a low rider).
    { center: { x: 5.9, y: 7, z: 1475 }, halfExtents: { x: 0.5, y: 5, z: 15 } },
    { center: { x: -5.9, y: 8, z: 1475 }, halfExtents: { x: 0.5, y: 4, z: 15 } },
    // LOW landing runway (top 0, z 1490..1510).
    { center: { x: 0, y: -0.5, z: 1500 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
    // Spire tower dressing.
    { center: { x: 8, y: 6, z: 1420 }, halfExtents: { x: 1.5, y: 10, z: 2 } },
    { center: { x: -8, y: 6, z: 1445 }, halfExtents: { x: 1.5, y: 10, z: 2 } },

    // ================= ACT 8 VOID TERMINAL (1510..1620) =================
    { center: { x: 0, y: -0.5, z: 1512.5 }, halfExtents: { x: 5.4, y: 0.5, z: 7.5 } },
    // HIGH deck (top 8) NARROWED (1-lane) with two REQUIRED 8 u orb gaps
    // + the 6 u lift hole: [1530,1543] + [1551,1559] + [1567,1572], hole
    // 1572..1578. Hop spikes time the orb setups (orbs fire mid-flight or
    // grounded into their windows — never moved, beat-anchored).
    { center: { x: 0, y: 7.5, z: 1536.5 }, halfExtents: { x: 1.6, y: 0.5, z: 6.5 } },
    { center: { x: 0, y: 7.5, z: 1555 }, halfExtents: { x: 1.6, y: 0.5, z: 4 } },
    { center: { x: 0, y: 7.5, z: 1569.5 }, halfExtents: { x: 1.6, y: 0.5, z: 2.5 } },
    // Deck support pillars (off-route, x=±4.5, y 0..8).
    { center: { x: 4.5, y: 4, z: 1540 }, halfExtents: { x: 0.5, y: 4, z: 1 } },
    { center: { x: -4.5, y: 4, z: 1560 }, halfExtents: { x: 0.5, y: 4, z: 1 } },
    { center: { x: 4.5, y: 4, z: 1575 }, halfExtents: { x: 0.5, y: 4, z: 1 } },
    // LOW deck (top 0, lane 2) with teleport-entry hop + two jump holes
    // (gaps 4 u): [1530,1546] + [1550,1566] + [1570,1580].
    { center: { x: -2.6, y: -0.5, z: 1538 }, halfExtents: { x: 1.3, y: 0.5, z: 8 } },
    { center: { x: -2.6, y: -0.5, z: 1558 }, halfExtents: { x: 1.3, y: 0.5, z: 8 } },
    { center: { x: -2.6, y: -0.5, z: 1575 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    // Reconnect runway (top 0) split by the lift shaft (gap 1570..1580).
    { center: { x: 0, y: -0.5, z: 1569 }, halfExtents: { x: 5.4, y: 0.5, z: 1 } },
    { center: { x: 0, y: -0.5, z: 1590 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },

    // ================= ACT 9 CORE REMIX (1600..1790) =================
    // Maw-exit slab (top 0, z 1614..1626, narrowed) + hop + orb reshaper
    // + three offset islands (center → lane 0 → lane 2) + portal pre-steer.
    { center: { x: 0, y: -0.5, z: 1620 }, halfExtents: { x: 1.6, y: 0.5, z: 6 } },
    { center: { x: 0, y: -0.5, z: 1630 }, halfExtents: { x: 1.6, y: 0.5, z: 3 } },
    { center: { x: 2.6, y: -0.5, z: 1641 }, halfExtents: { x: 1.6, y: 0.5, z: 3 } },
    { center: { x: -2.6, y: -0.5, z: 1652 }, halfExtents: { x: 1.6, y: 0.5, z: 3 } },
    // Launch slab 1655..1662 (lanes 1+2 — catches the island-3 exit
    // solidly, then steers to center for the bounded 2× gate) + 8 u void
    // gap 1662..1670 (miss the gate = void).
    { center: { x: 0, y: -0.5, z: 1658.5 }, halfExtents: { x: 2, y: 0.5, z: 3.5 } },
    // Weave runway (top 0, z 1672..1696).
    { center: { x: 0, y: -0.5, z: 1684 }, halfExtents: { x: 5.4, y: 0.5, z: 12 } },
    // Remix ceiling slab (underside y=10, z 1696..1708).
    { center: { x: 0, y: 10.5, z: 1702 }, halfExtents: { x: 5.4, y: 0.5, z: 6 } },
    // Remix floor (top 0, z 1708..1718) + wall slab (face x=5.4, z 1718..1732).
    { center: { x: 0, y: -0.5, z: 1713 }, halfExtents: { x: 5.4, y: 0.5, z: 5 } },
    { center: { x: 5.9, y: 3, z: 1725 }, halfExtents: { x: 0.5, y: 4, z: 7 } },
    // Spider runway (top 0, z 1732..1756 — catches the high wall exit).
    { center: { x: 0, y: -0.5, z: 1744 }, halfExtents: { x: 5.4, y: 0.5, z: 12 } },
    // Remix snap ceiling (underside 8, z 1740..1752).
    { center: { x: 0, y: 8.5, z: 1746 }, halfExtents: { x: 5.4, y: 0.5, z: 6 } },
    // Post-spider runway (top 0, z 1750..1768).
    { center: { x: 0, y: -0.5, z: 1759 }, halfExtents: { x: 5.4, y: 0.5, z: 9 } },
    // Final river slabs (route crosses z 1770.5..1773.5).
    { center: { x: 0, y: -0.5, z: 1766 }, halfExtents: { x: 5.4, y: 0.5, z: 7 } },
    { center: { x: 0, y: -0.5, z: 1782 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
    // River containment (east pillar + curb + shelf + rims, z 1772).
    { center: { x: 4.9, y: 1.75, z: 1772 }, halfExtents: { x: 0.5, y: 1.75, z: 1 } },
    { center: { x: 4.375, y: -0.1, z: 1772 }, halfExtents: { x: 0.375, y: 0.75, z: 1.75 } },
    { center: { x: -7.4, y: -1.15, z: 1772 }, halfExtents: { x: 2, y: 0.5, z: 1.75 } },
    { center: { x: -6.4, y: -0.1, z: 1770.3 }, halfExtents: { x: 2.4, y: 0.85, z: 0.3 } },
    { center: { x: -6.4, y: -0.1, z: 1773.7 }, halfExtents: { x: 2.4, y: 0.85, z: 0.3 } },
    // Finale Chomper anchor pillar.
    { center: { x: -10, y: 0, z: 1758 }, halfExtents: { x: 1, y: 5, z: 1.5 } },
  ],

  hazards: [
    // ================= ACT 1 (M9.1 rebuild) =================
    // Sky-pier hop spike + center tooth (forces the drop-side lane — the
    // tooth sits 6 u past its tap so the lateral transit completes first).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 4.75, z: 89 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 4.75, z: 101 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Catcher spikes (force the immediate double transfer A → B → road).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 109.3 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 118.5 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Jog hop spike (on the offset line — takeoff keeps 2 u lead, and the
    // flight lands on the takeoff strip with room for the river takeoff).
    { kind: 'hazard', visual: 'spike', center: { x: -1.3, y: 0.25, z: 130 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Kept proving double (160 + 164, jumps 147 + 157.5 inside the
    // envelope — the combo both routes must execute).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 160 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 164 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Handover teeth jog (dodge + return for the island takeoff).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 179 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },

    // ================= ACT 2 (M9.1 rebuild) =================
    // Entry chain + stairs: clean precision (transfers + risers are the
    // challenge; no spikes on the takeoff/landing spots).
    // Alternate stair-drop combo (lane 0): drop-jump off stair 1, hop,
    // teeth dodge + forced return, side-strip hop — every tap answers
    // geometry (the shared center hop spike forces the lane-0 return).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 257 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 260 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Pad-approach hops: center strip (shared) + lane-0 side strip.
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 266 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 272 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Split-zone teeth (lanes 1+2 — the alternate holds lane 0, the
    // primary pad flight passes overhead, y 4.7+).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 274 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 274 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Side-strip teeth jog (lane 0 — dodge + return before the weave).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 285 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // M9.1 LOW weave jog (narrowed lanes-0+1 floor — dodge + return pairs;
    // the narrowed support caps the bands at two).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 292 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 306 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // MID deck spikes (narrowed deck serves lanes 1+2 — off-deck M9 teeth
    // removed; on-deck timing kept. Driver: lane 1 at 284, lane 2 at 294).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 4.75, z: 284 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 4.75, z: 294 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 4.75, z: 300 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // HIGH spike (narrowed island — single timing under the overhang; the
    // 319 flight clears it, then the gap takeoff).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 8.25, z: 322 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // LOW ground-route spikes (beneath the HIGH line) + the M9 lane-0
    // commitment teeth (alternate data: lane 0 throughout 312–360 —
    // grounded at 324/336/350, so full-height doors punish deviation
    // while the orb flight passes overhead).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 320 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 340 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -1.3, y: 1.5, z: 324 }, halfExtents: { x: 2.6, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -1.3, y: 1.5, z: 336 }, halfExtents: { x: 2.6, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -1.3, y: 1.5, z: 350 }, halfExtents: { x: 2.6, y: 1.5, z: 0.5 } },
    // Far runway (narrowed strip): hop + mid-flight orb + hop pair.
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 414 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 428 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 418 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 418 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 424 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 424 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // M9 funnel: HIGH-drop + ferry-approach discipline (primary falls
    // center 356–368, both lines settle after; the falling line clears
    // every tooth vertically, the settled lines hold their lanes).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 356 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 356 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 362 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 362 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Ferry-approach hop spike (center — the primary HIGH-drop line hops
    // it and boards a touch later; the alternate runs lane 0 underneath
    // the flight and boards on the M9 timing).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 370 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // HIGH landing narrowed (1-lane) — no teeth needed, support holds it.

    // ================= ACT 3 (M9.1 rebuild) =================
    // Maze approach hop (the far-ruin flight clears 430 high; land, hop,
    // orb-hop over the teeth jog, hop again — door 1 passed running).
    // Approach teeth (lanes 0+2 — the center line holds for the gate).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 439 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 439 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 432 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 432 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 436 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 436 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 442 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Approach teeth jog (dodge + return for door 1 — door passed
    // RUNNING, centered; the first hop comes after it).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 449 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Door 1 (z 452): single lane-1 opening (one shared line from here).
    { kind: 'killFront', visual: 'block', center: { x: 3.35, y: 1.5, z: 452 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -3.35, y: 1.5, z: 452 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    // Hop spike (lane 1) + door-2 steer.
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 458 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Door 2 (z 470): single lane-2 opening (orb-assisted hop through it).
    // Door 2 (z 470): single lane-2 opening.
    { kind: 'killFront', visual: 'block', center: { x: 0, y: 1.5, z: 470 }, halfExtents: { x: 1.3, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 3.35, y: 1.5, z: 470 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    // Hop spike (lane 2) + door-3 landing align (single-step swing).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 476 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Door 3 (z 486): single lane-1 opening.
    { kind: 'killFront', visual: 'block', center: { x: 3.35, y: 1.5, z: 486 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -3.35, y: 1.5, z: 486 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    // Hop spike (lane 1) + door-4 ride (hold the line).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 487 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Door 4 (z 502): single lane-1 opening.
    { kind: 'killFront', visual: 'block', center: { x: 3.35, y: 1.5, z: 502 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -3.35, y: 1.5, z: 502 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    // Hop spike (lane 2) + door-5 pre-steer (mid-flight).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 508 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Teeth dodge (lane 0 — both variants swerve to lane 1 and back).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 515 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Door 5 (z 518): double lane-0+lane-1 opening (split-zone language —
    // the teeth-dodge return passes here without a pixel-centering demand).
    { kind: 'killFront', visual: 'block', center: { x: -3.35, y: 1.5, z: 518 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    // Hop spike (lane 0) + door-6/pad pre-steer.
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 523 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Alternate transition hop (lane 0, over the door-6 approach).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 532 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Door 6 (z 534): double lane-0+lane-1 opening (the split — primary
    // takes lane 1 into the pad, alternate lane 0 around it).
    { kind: 'killFront', visual: 'block', center: { x: -3.35, y: 1.5, z: 534 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    // Upper hole-chain (narrowed 1-lane — hop rhythm + two joint holes;
    // the narrow support holds the single band, spikes time the hops).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 4.75, z: 552 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 4.75, z: 572 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 4.75, z: 602 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 4.75, z: 612 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Transition hop spike (lane 2 — the alternate lands the strip moving).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 544 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Lower weave strip (narrowed lanes 1+2 — alternating teeth force the
    // weave; the narrow support caps the bands at two).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 556 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 566 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 576 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 586 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 596 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Lower exit hop (carries the weave to the exit-gap takeoff) + teeth
    // jog (dodge + return for the centered exit takeoff).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 602 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 612 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Exit-slab hop pair (narrowed strip; the ferry-boarding run after
    // the second hop is a documented boarding breath).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 636 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 646 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Left-wall hop spike (high line — dive out and back; fills the
    // wall-portal run).
    { kind: 'hazard', visual: 'spike', mount: 'leftWall', center: { x: 5.15, y: 9, z: 829 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },
    // 2× exit weave gates (single-lane blocks, one-tap line at speed:
    // lane 1 through 700, lane 0 through 706 + 712).
    { kind: 'killFront', visual: 'block', center: { x: 2.6, y: 1.5, z: 700 }, halfExtents: { x: 1.3, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 0, y: 1.5, z: 708 }, halfExtents: { x: 1.3, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -2.6, y: 1.5, z: 712 }, halfExtents: { x: 1.3, y: 1.5, z: 0.5 } },
    // M9 funnel: spire-entry discipline (both lines transit 0→1 through
    // 716–724 — lane 2 carries teeth the transit clears laterally).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 720 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 726 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },

    // ================= ACT 4 (M9.1 rebuild) =================
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 730 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 738 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Entry hop spike (the narrowed runway holds center — hop it and let
    // the ceiling portal fire mid-flight into the up-fall landing).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 740 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Ceiling dive-hop rhythm (narrowed 1-lane + joint hole 776..779).
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 9.75, z: 755 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 9.75, z: 764 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 9.75, z: 784 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 9.75, z: 788 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 9.75, z: 794 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Left-wall low spike (forces the high wall line).
    { kind: 'hazard', visual: 'spike', mount: 'leftWall', center: { x: 5.15, y: 1, z: 815 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },
    // Left-wall hop spike (dive out and back on the high line).
    { kind: 'hazard', visual: 'spike', mount: 'leftWall', center: { x: 5.15, y: 9, z: 815 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },
    // Right-wall staircase spikes (up around y-3, down before y-5.6).
    { kind: 'hazard', visual: 'spike', mount: 'rightWall', center: { x: -5.15, y: 3, z: 848 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },
    { kind: 'hazard', visual: 'spike', mount: 'rightWall', center: { x: -5.15, y: 5.6, z: 860 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },
    // Shaft-exit spike (immediate jump after the pad launch).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 916 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Spire-entry rhythm hops (fill the runway before the flip) + M9
    // funnel teeth (driver holds center through 864–890 — the wall-exit
    // transit has settled by 868).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 872 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 882 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 876 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 876 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 886 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 886 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },

    // ================= ACT 5 (M9.1 rebuild) =================
    // Entry narrowed (1-lane) — support holds the line, teeth removed.
    // Entry hop spike (carries the shaft-exit landing to the board jump).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 925 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Ferry-exit hop spike (the exit flight lands here; weave taps steer
    // mid-flight for gate 982).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 972 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Weave-exit teeth (lanes 0+2 every 2 u — both lines hold center for
    // the ceiling portal; no taps needed).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 992 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 992 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 994 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 994 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 996 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 996 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 998 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 998 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1000 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1000 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Weave gates around the #2 lunge.
    { kind: 'killFront', visual: 'block', center: { x: 0, y: 1.5, z: 975 }, halfExtents: { x: 1.3, y: 1.5, z: 0.5 } },
    // M9 funnel: slalom-entry discipline (both lines dodge lane 2 through
    // the lengthened lunge — lane 0 carries a tooth at the return).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1058 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 2.6, y: 1.5, z: 982 }, halfExtents: { x: 3.9, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 3.35, y: 1.5, z: 989 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -3.35, y: 1.5, z: 989 }, halfExtents: { x: 2.05, y: 1.5, z: 0.5 } },
    // Ceiling hop spike (centered for the narrowed traverse — dive-hop
    // into the portal-flight return).
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 9.75, z: 1026 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Chomp-low approach teeth (lane 0 only — both lines run lane 1 here
    // and dodge to lane 0 at the lunge; lane-1/2 teeth would hit the line).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1038 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1042 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // M9 foundry slalom (2× weave walls, single-door commitment each —
    // the maze-wall precedent at 2× lane-change spacing: 10 u lead per
    // tap). Doors: lane 2 through 1080, lane 1 through 1096. The old 1×
    // spike triple + approach spikes are replaced — the doors force the
    // line, and the 1096–1110 runout is the last breath before the Ship.
    { kind: 'killFront', visual: 'block', center: { x: 2.6, y: 1.5, z: 1080 }, halfExtents: { x: 3.9, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 2.6, y: 1.5, z: 1096 }, halfExtents: { x: 1.3, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -2.6, y: 1.5, z: 1096 }, halfExtents: { x: 1.3, y: 1.5, z: 0.5 } },
    // Ship-approach teeth (lanes 0+2 — both lines hold center for the
    // ship gate; no taps needed).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1100 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1100 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1104 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1104 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // M9: approach spikes removed for the 2× slalom (the 1080/1096 doors
    // + the lengthened #4 lunge carry this stretch; 1096–1110 breathes).

    // ================= ACT 7 (M9.1 rebuild) =================
    // M9 funnel: ship-exit runway discipline (driver holds center 1310–
    // 1334 through the 1318 rhythm hop) — lanes 0+2 carry teeth.
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1316 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1316 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1324 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1324 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1330 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1330 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Spider discipline teeth (lanes 0+2 — the snap line holds center).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1348 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1348 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1362 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1362 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1378 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1378 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1392 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1392 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Spider-entry teeth (lanes 0+2 — the ship-exit line holds center
    // for the spider gate; no taps needed).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1334 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1334 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1338 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1338 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Spider-gate teeth (lanes 0+2 on the LOW landing runway — the
    // ship-exit line holds center; no taps needed).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1502 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1502 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Temple ceiling spike (forces a lane move on the ceiling run).
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 9.75, z: 1360 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Wall spikes (force the wall ↔ wall spider snaps).
    { kind: 'hazard', visual: 'spike', mount: 'leftWall', center: { x: 5.15, y: 3, z: 1470 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },
    { kind: 'hazard', visual: 'spike', mount: 'rightWall', center: { x: -5.15, y: 5.6, z: 1480 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },

    // ================= ACT 8 =================
    // Choice dividers (missing all three rings meets a wall; tops y=5 so
    // the pad-launched HIGH flight passes over). M9: +2.2 u with the pad.
    { kind: 'killFront', visual: 'block', center: { x: 1.3, y: 2.5, z: 1522.2 }, halfExtents: { x: 0.35, y: 2.5, z: 1 } },
    { kind: 'killFront', visual: 'block', center: { x: -1.3, y: 2.5, z: 1522.2 }, halfExtents: { x: 0.35, y: 2.5, z: 1 } },
    // Gantry approach spikes (hop into the split: center launches HIGH,
    // lane 2 runs LOW; lane 0 meets no deck and dies).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 1506 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1510 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Alternate teleport-flight hop (lane 2 — 2 u pop-over lead so the
    // swept path clears the spike corner before the ring fires mid-flight).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1519 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // HIGH hop spikes (center, narrowed deck — takeoffs sit 1.5 u past
    // each orb landing so press edges never fire mid-air; the narrowed
    // support holds the single band, off-deck teeth removed).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 8.25, z: 1540 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 8.25, z: 1558 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // LOW teleport-entry hop spike + hole-edge spike (after the hole
    // landing, never inside it).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1538 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1558 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // LOW exit hop spike (takeoff 1.5 u past the hole-2 landing).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1578 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Reconnect hop spike (exit the lift with intent).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 1590 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Maw-approach teeth (lane 2 only — the HIGH line holds center and
    // the alternate holds lane 0; no taps needed).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1592 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },

    // ================= ACT 9 (M9.1 islands rebuilt above) =================
    // Maw-exit hop spike (carries the ff landing to the orb reshaper).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 1622 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Weave hop spike (lane 0 — dodge out mid-boosted-flight, hop past
    // the boosted landing, recenter mid-flight for the lane-1 gate).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1683 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // 2× weave gates.
    { kind: 'killFront', visual: 'block', center: { x: 0, y: 1.5, z: 1676 }, halfExtents: { x: 1.3, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: -2.6, y: 1.5, z: 1684 }, halfExtents: { x: 1.3, y: 1.5, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 2.6, y: 1.5, z: 1692 }, halfExtents: { x: 1.3, y: 1.5, z: 0.5 } },
    // Remix ceiling spike.
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 9.75, z: 1702 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Remix wall spike (forces the high wall line).
    { kind: 'hazard', visual: 'spike', mount: 'leftWall', center: { x: 5.15, y: 1, z: 1724 }, halfExtents: { x: 0.25, y: 0.25, z: 0.9 } },
    // Post-spider teeth (lanes 1+2, past the chomp-dodge transit — both
    // lines hold lane 0 for the river takeoff; no taps needed; the M9
    // 1762/1768 pairs continue the corridor).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 1756 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1756 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 1758 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1758 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Remix spider dodge wall (y 0..3).
    { kind: 'killFront', visual: 'block', center: { x: 0, y: 1.5, z: 1746 }, halfExtents: { x: 5.4, y: 1.5, z: 1.5 } },
    // M9 funnel: post-spider runway discipline (driver lane 0 through the
    // river takeoff, lane 1 after the 1772 recenter).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 1762 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1762 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 1768 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1768 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1780 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1780 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 1784 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 1784 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
  ],
  visualSetpieces: [
    // Forge watchers + maze markers.
    { id: 'ps-mark-forge', kind: 'guardian', center: { x: 8, y: 3, z: 100 }, halfExtents: { x: 2, y: 3, z: 1.5 } },
    { id: 'ps-mark-maze-1', kind: 'guardian', center: { x: -8, y: 3, z: 450 }, halfExtents: { x: 2, y: 3, z: 1.5 } },
    { id: 'ps-mark-maze-2', kind: 'guardian', center: { x: 8, y: 3, z: 510 }, halfExtents: { x: 2, y: 3, z: 1.5 } },
    // Island + foundry menace below the route.
    { id: 'ps-menace-islands', kind: 'lava', center: { x: 0, y: -6, z: 240 }, halfExtents: { x: 5, y: 1, z: 40 } },
    { id: 'ps-menace-foundry', kind: 'lava', center: { x: 0, y: -6, z: 1000 }, halfExtents: { x: 5, y: 1, z: 40 } },
    // Abyss exterior glow + spire watcher + void lake + core arch.
    { id: 'ps-abyss-glow', kind: 'lava', center: { x: -11, y: 3, z: 1220 }, halfExtents: { x: 2, y: 4, z: 40 } },
    { id: 'ps-spire-watcher', kind: 'guardian', center: { x: -10, y: 6, z: 1420 }, halfExtents: { x: 3, y: 4, z: 1.5 } },
    { id: 'ps-void-lake', kind: 'lava', center: { x: 0, y: -8, z: 1555 }, halfExtents: { x: 8, y: 1, z: 30 } },
    { id: 'ps-core-arch', kind: 'guardian', center: { x: 0, y: 7, z: 1792 }, halfExtents: { x: 7, y: 4, z: 1.5 } },
  ],
  /**
   * Nine-scene visual arc — one identity per act (fingerprint-excluded).
   * Same M8.5 hues; boundaries follow the redesigned acts.
   */
  /**
   * M9.1 visual-overdrive arc — one unmistakable palette + energy per act
   * (PRIMARY route accent / SECONDARY fog / ACCENT background /
   * IMPACT environment + VFX surge). Energy follows the music: groove →
   * loud → break → loud → build → climax → quiet breakdown → climax.
   * Values stay in-contract (bloom ⇒ BLOOM_CONTRACT, exposure 0.5..2);
   * saturation is local color, never a global wash (see §59 principles).
   */
  visualSequence: {
    sections: [
      {
        id: 'ps-forge',
        startZ: -10,
        endZ: 170,
        blendIn: 1,
        overrides: {
          background: 0x1a0a02,
          fogColor: 0x4d1a05,
          routeAccent: 0xffc233,
          environmentIntensity: 1.5,
          exposure: 1.1,
          vfxIntensity: 1.2,
        },
      },
      {
        id: 'ps-islands',
        startZ: 170,
        endZ: 430,
        blendIn: 20,
        overrides: {
          background: 0x073325,
          fogColor: 0x0f6b52,
          routeAccent: 0x2dffc4,
          environmentIntensity: 1.45,
          vfxIntensity: 1.2,
        },
      },
      {
        id: 'ps-labyrinth',
        startZ: 430,
        endZ: 720,
        blendIn: 20,
        overrides: {
          background: 0x200e40,
          fogColor: 0x521e86,
          routeAccent: 0xb44dff,
          environmentIntensity: 1.55,
          vfxIntensity: 1.25,
        },
      },
      {
        id: 'ps-cathedral',
        startZ: 720,
        endZ: 920,
        blendIn: 20,
        overrides: {
          background: 0x061a2e,
          fogColor: 0x10517f,
          routeAccent: 0x35c8ff,
          environmentIntensity: 1.6,
          vfxIntensity: 1.3,
          streakIntensity: 1.3,
        },
      },
      {
        id: 'ps-canyon',
        startZ: 920,
        endZ: 1110,
        blendIn: 20,
        overrides: {
          background: 0x2b0603,
          fogColor: 0x7d1008,
          routeAccent: 0xff3b1f,
          environmentIntensity: 1.7,
          exposure: 1.12,
          vfxIntensity: 1.3,
        },
      },
      {
        id: 'ps-reactor',
        startZ: 1110,
        endZ: 1330,
        blendIn: 20,
        overrides: {
          background: 0x04220f,
          fogColor: 0x0f6631,
          routeAccent: 0x3dff7a,
          environmentIntensity: 1.65,
          vfxIntensity: 1.3,
          streakIntensity: 1.4,
        },
      },
      {
        id: 'ps-temple',
        startZ: 1330,
        endZ: 1510,
        blendIn: 20,
        overrides: {
          background: 0x281e06,
          fogColor: 0x7d6210,
          routeAccent: 0xffd23d,
          environmentIntensity: 1.7,
          exposure: 1.12,
          vfxIntensity: 1.3,
        },
      },
      {
        id: 'ps-void',
        startZ: 1510,
        endZ: 1620,
        blendIn: 20,
        overrides: {
          background: 0x030312,
          fogColor: 0x161649,
          fogNear: 26,
          fogFar: 150,
          routeAccent: 0x6a5cff,
          environmentIntensity: 1.0,
          vfxIntensity: 1.0,
        },
      },
      {
        id: 'ps-core',
        startZ: 1620,
        endZ: 1800,
        blendIn: 20,
        overrides: {
          background: 0x280417,
          fogColor: 0x7d0f4d,
          routeAccent: 0xff4dd2,
          environmentIntensity: 1.85,
          exposure: 1.18,
          vfxIntensity: 1.45,
          streakIntensity: 1.45,
        },
      },
    ],
  },
  /**
   * M9 beat-anchored rhythm cues (presentation-only, never gameplay — see
   * `src/visuals/rhythmCues.ts`): every cue carries the Gravity Lessons
   * beat index the reference traversal reaches at its z (measured from
   * the scripted reference route, pinned by `tests/musicAlignment.test.ts`).
   * Cue z tracks its gameplay moment (portal/entry/lunge/section); the
   * beat is the musical identity. Sorted by z; beats non-decreasing.
   */
  rhythmCues: [
    { id: 'ps-cue-intro', z: 0, role: 'intro', beat: 0 },
    { id: 'ps-cue-stairs', z: 40, role: 'build', beat: 6 },
    { id: 'ps-cue-orb-forge', z: 50, role: 'orbHit', beat: 8 },
    { id: 'ps-cue-drop', z: 90, role: 'drop', beat: 13 },
    { id: 'ps-cue-river', z: 136, role: 'accent', beat: 20 },
    { id: 'ps-cue-islands', z: 170, role: 'sectionChange', beat: 25 },
    { id: 'ps-cue-lift', z: 262, role: 'accent', beat: 38 },
    { id: 'ps-cue-high', z: 312, role: 'build', beat: 45 },
    { id: 'ps-cue-orb-low-a', z: 317, role: 'orbHit', beat: 46 },
    { id: 'ps-cue-orb-low-b', z: 329, role: 'orbHit', beat: 47 },
    { id: 'ps-cue-orb-sky', z: 330, role: 'orbHit', beat: 48 },
    { id: 'ps-cue-ferry', z: 378, role: 'accent', beat: 54 },
    { id: 'ps-cue-orb-ferry-exit', z: 417, role: 'orbHit', beat: 60 },
    { id: 'ps-cue-orb-approach', z: 430.5, role: 'orbHit', beat: 62 },
    { id: 'ps-cue-maze', z: 430, role: 'sectionChange', beat: 62 },
    { id: 'ps-cue-orb-maze-a', z: 468, role: 'orbHit', beat: 67 },
    { id: 'ps-cue-orb-maze-b', z: 499, role: 'orbHit', beat: 72 },
    { id: 'ps-cue-pad-maze', z: 530, role: 'padHit', beat: 76 },
    { id: 'ps-cue-orb-pad-maze', z: 539, role: 'orbHit', beat: 77 },
    { id: 'ps-cue-ferry-pair', z: 660, role: 'accent', beat: 95 },
    { id: 'ps-cue-speed-maze', z: 692, role: 'speedHit', beat: 99 },
    { id: 'ps-cue-spire', z: 723, role: 'gravityHit', beat: 101 },
    { id: 'ps-cue-ceiling', z: 742.5, role: 'gravityHit', beat: 104 },
    { id: 'ps-cue-wall-left', z: 798.4, role: 'gravityHit', beat: 112 },
    { id: 'ps-cue-wall-right', z: 833.5, role: 'gravityHit', beat: 117 },
    { id: 'ps-cue-spire-down', z: 861.4, role: 'gravityHit', beat: 121 },
    { id: 'ps-cue-shaft', z: 890, role: 'drop', beat: 125 },
    { id: 'ps-cue-foundry', z: 920, role: 'sectionChange', beat: 130 },
    { id: 'ps-cue-chomp-ferry', z: 940, role: 'accent', beat: 133 },
    { id: 'ps-cue-chomp-weave', z: 985, role: 'accent', beat: 140 },
    { id: 'ps-cue-ceil-swap', z: 1001.3, role: 'gravityHit', beat: 141 },
    { id: 'ps-cue-chomp-ceil', z: 1015, role: 'accent', beat: 143 },
    { id: 'ps-cue-foundry-down', z: 1030, role: 'gravityHit', beat: 145 },
    { id: 'ps-cue-speed-foundry', z: 1036.5, role: 'speedHit', beat: 146 },
    { id: 'ps-cue-chomp-low', z: 1052, role: 'accent', beat: 147 },
    { id: 'ps-cue-abyss', z: 1107, role: 'sectionChange', beat: 151 },
    { id: 'ps-cue-invert', z: 1200, role: 'drop', beat: 164 },
    { id: 'ps-cue-revert', z: 1250, role: 'sectionChange', beat: 171 },
    { id: 'ps-cue-invert2', z: 1286, role: 'sectionChange', beat: 176 },
    { id: 'ps-cue-revert2', z: 1305, role: 'sectionChange', beat: 179 },
    { id: 'ps-cue-speed-spider', z: 1315, role: 'speedHit', beat: 180 },
    { id: 'ps-cue-spire-climb', z: 1330, role: 'sectionChange', beat: 182 },
    { id: 'ps-cue-wall-calm', z: 1453.5, role: 'sectionChange', beat: 190 },
    { id: 'ps-cue-wall-snap', z: 1460, role: 'gravityHit', beat: 191 },
    { id: 'ps-cue-speed-wall-burst', z: 1489, role: 'speedHit', beat: 195 },
    { id: 'ps-cue-wall-floor', z: 1490, role: 'gravityHit', beat: 195 },
    { id: 'ps-cue-void', z: 1510, role: 'sectionChange', beat: 197 },
    { id: 'ps-cue-teleport', z: 1522.2, role: 'accent', beat: 200 },
    { id: 'ps-cue-maw', z: 1597, role: 'accent', beat: 209 },
    { id: 'ps-cue-core', z: 1620, role: 'climax', beat: 210 },
    { id: 'ps-cue-orb-maw-exit', z: 1625, role: 'orbHit', beat: 210 },
    { id: 'ps-cue-orb-island-c', z: 1647, role: 'orbHit', beat: 213 },
    { id: 'ps-cue-speed', z: 1662, role: 'speedHit', beat: 216 },
    { id: 'ps-cue-calm', z: 1694, role: 'sectionChange', beat: 218 },
    { id: 'ps-cue-chomp-final', z: 1748, role: 'accent', beat: 226 },
    { id: 'ps-cue-speed2', z: 1754, role: 'speedHit', beat: 227 },
    { id: 'ps-cue-release', z: 1776, role: 'release', beat: 228 },
    { id: 'ps-cue-release-speed', z: 1778, role: 'sectionChange', beat: 228 },
    { id: 'ps-cue-finish', z: 1790, role: 'finish', beat: 230 },
  ],
  theme: TEST_LEVEL.theme,
};
