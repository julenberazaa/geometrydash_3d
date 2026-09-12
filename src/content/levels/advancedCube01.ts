import type { LevelDefinition } from '../../level/levelDefinition';

/**
 * Advanced Cube 01 (M7.2/M7.3) — HARD production Cube level + teleport debut.
 *
 * M7.3 polish/rework: harder and more vertical (offset island pairs with
 * mid-air transfers, a third ceiling spike, maze-like killFront lane walls,
 * tall spikes, denser groups, a second short-hop teleport whose entry and
 * exit share one readable frame, lethal contained lava, a chained beast
 * setpiece, smaller rounder portal rings, glowing mini-islands, closed
 * block corners) — same frozen controller, same fairness contract.
 *
 * A genuinely new level (vertical-slice-01 is preserved untouched): more
 * vertical (LOW/MID/HIGH floor bands + a substantial ceiling world), more
 * fragmented (single-lane islands, narrow bridges, offset landings), denser
 * hazards, one fast-fall gate, and paired TELEPORT portals (a long maw jump
 * through a guardian mouth + a short lava-lake hop) that the route must
 * take — missing a ring is the void.
 *
 * Height bands (frozen tuning: collider 1.1, jump impulse 13.2 / gravity 42
 * → apex 2.07, airtime 0.629 s; base speed 12 → 1x range 7.55 u):
 * - LOW floor:  top y = 0   (center.y -0.5, halfY 0.5)
 * - MID floor:  top y = 1.2 (center.y  0.7, halfY 0.5) — reachable from LOW
 * - HIGH floor: top y = 2.4 (center.y  1.9, halfY 0.5) — reachable from MID
 *   (rise 1.2 < apex 2.07), NOT directly from LOW (rise 2.4 > apex).
 * - CEILING:    underside y = 6 (center.y 7, halfY 1) — M7.1-proven band.
 *
 * Fairness (measured, documented for the human gate):
 * - Single-lane islands keep 0.75 u lateral margin per side (2.6 − 1.1).
 * - Standard 1x gaps <= 5 u keep >= 2.5 u inside the 7.55 u envelope.
 * - Pad gaps (8 u) exceed plain range (pads REQUIRED, M7.1-clone offsets).
 * - Orb gap (8 u) exceeds plain range (orb REQUIRED — proven behaviorally).
 * - 2x gaps (10..11 u) keep ~4..5 u inside the 15.1 u envelope.
 * - Fast-fall gate (HIGH → LOW short island): FF lands mid-island with a
 *   ~3.5 u takeoff window; the same taps without FF land at the island edge
 *   with a ~2-tick reaction window and die in the follow-up gap (proven).
 *
 * Z budget (forward speed is constant per tier, so time = distance/speed):
 *   PHASE 1  z  -10..176  precision ascent (LOW → MID → HIGH → offset drop)
 *   PHASE 2  z 176..325   hazard garden (maze wall + MID/HIGH + fast-fall)
 *   PHASE 3  z 322..527   ceiling world + MID return + floor pad + hop road
 *   PHASE 4  z 511..712   lava hop over REAL lava (489 → 513) + maw setpiece (524 → 634)
 *   PHASE 5  z 708..960   2x fragmented climax + 1x technical epilogue
 * Teleport skips 489..513 (24 u lava lake) and 524..634 (110 u of void —
 * no portals, pads, orbs or geometry inside). The exact deterministic
 * duration is pinned by test (see tests/advancedCube01.test.ts).
 *
 * Screen-side convention (M1.1): laneCenters index 0/1/2 = screen-left /
 * center / screen-right (world x +2.6 / 0 / −2.6).
 */
export const ADVANCED_CUBE_01: LevelDefinition = {
  id: 'advanced-cube-01',
  displayName: 'ADVANCED CUBE 01',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 12,
  finishZ: 960,
  deathY: -14,
  deathYMax: 12,
  startGravityMode: 'floor',
  gravityPortals: [
    { id: 'ac-portal-up-1', z: 322, target: 'ceiling' },
  ],
  speedPortals: [
    { id: 'ac-speed-2x', z: 708, multiplier: 2 },
    { id: 'ac-speed-1x', z: 873, multiplier: 1 },
  ],
  jumpPads: [
    {
      id: 'ac-pad-ceiling',
      center: { x: 0, y: 5.85, z: 391 },
      halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
      surface: 'ceiling',
      impulse: 22,
    },
    {
      id: 'ac-pad-floor',
      center: { x: 0, y: 1.35, z: 437 },
      halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
      surface: 'floor',
      impulse: 23,
    },
  ],
  jumpOrbs: [
    {
      id: 'ac-orb-jump',
      center: { x: 0, y: 2.2, z: 678 },
      halfExtents: { x: 0.9, y: 0.9, z: 0.9 },
      impulse: 15,
    },
  ],
  gravityOrbs: [
    {
      id: 'ac-orb-gravity',
      center: { x: 0, y: 3.4, z: 420 },
      halfExtents: { x: 0.9, y: 0.9, z: 0.8 },
    },
  ],
  teleportPortals: [
    {
      id: 'ac-teleport-maw',
      entryZ: 524,
      exit: { x: 0, y: 1.75, z: 634 },
      exitLaneIndex: 1,
      style: 'maw',
    },
    // M7.3 short-hop pair: entry 489 (crossed MID-AIR off the 487 gap
    // jump) → exit 513 (grounded center on the 511..527 runway), a 24 u hop
    // over the lava lake. Both rings fit in one readable frame — one
    // connected moment, never a map cut. Missing the ring = the void.
    {
      id: 'ac-teleport-hop',
      entryZ: 489,
      exit: { x: 0, y: 0.7, z: 513 },
      exitLaneIndex: 1,
      style: 'gate',
    },
  ],
  visualSetpieces: [
    {
      id: 'ac-guardian-maw',
      kind: 'guardian',
      center: { x: 0, y: 5, z: 532 },
      halfExtents: { x: 7, y: 4.5, z: 1.5 },
    },
    // M7.3 chain-chomp beast watching the storm climb (off-corridor).
    {
      id: 'ac-beast-storm',
      kind: 'guardian',
      center: { x: 10, y: 4, z: 820 },
      halfExtents: { x: 5, y: 3.5, z: 1.5 },
    },
  ],
  /**
   * M8A lethal lava (GAMEPLAY — touching any volume kills instantly with
   * cause `lava`). Six contained basins under the historic lava dressing
   * spots (same footprints, now real: pool surface + basin floor + rim
   * walls) plus one source → fall → pool composition at the furnace (rock
   * pillar → vent → dense stream → basin). Every volume validates through
   * `validateLavaAuthoring` (no floating slabs). All basins sit >= 1.4 u
   * below the lowest success-path surface and outside the lane corridor,
   * so the approved route (tick 7475) is untouched — gap falls that died
   * at the void bound now die faster at the lava surface instead.
   */
  lava: [
    // Chain basin (phase 1 islands): pool top -4.2.
    { id: 'ac-lava-chain', center: { x: 0, y: -5, z: 58 }, halfExtents: { x: 4, y: 0.8, z: 24 }, role: 'pool' },
    // Fast-fall basin (phase 2 gate): pool top -2.9.
    { id: 'ac-lava-ff', center: { x: 0, y: -3.7, z: 250 }, halfExtents: { x: 3.5, y: 0.8, z: 8 }, role: 'pool' },
    // Lava lake (phase 4 hop gap): pool top -3.9.
    { id: 'ac-lava-lake', center: { x: 0, y: -4.7, z: 499 }, halfExtents: { x: 4, y: 0.8, z: 14 }, role: 'pool' },
    // Maw river (phase 4 void): pool top -6.9.
    { id: 'ac-lava-river', center: { x: 0, y: -7.7, z: 579 }, halfExtents: { x: 5, y: 0.8, z: 55 }, role: 'pool' },
    // Furnace basin (phase 4/5 beside the route): pool top -1.9.
    { id: 'ac-lava-furnace', center: { x: 6.5, y: -2.7, z: 670 }, halfExtents: { x: 2.5, y: 0.8, z: 18 }, role: 'pool' },
    // Furnace source: vent attached to the rock pillar face (x 9.5).
    { id: 'ac-lava-furnace-source', center: { x: 9.9, y: 1.5, z: 670 }, halfExtents: { x: 0.6, y: 0.6, z: 1.2 }, role: 'source' },
    // Furnace fall: dense stream from the vent into the pool (top 1.5).
    { id: 'ac-lava-furnace-fall', center: { x: 8.6, y: -0.2, z: 670 }, halfExtents: { x: 0.7, y: 1.7, z: 1.0 }, role: 'fall' },
    // Storm basin (phase 5 beside the 2x islands): pool top -2.9.
    { id: 'ac-lava-storm', center: { x: -7, y: -3.7, z: 810 }, halfExtents: { x: 3, y: 0.8, z: 25 }, role: 'pool' },
  ],

  solids: [
    // --- PHASE 1: precision ascent (LOW → MID → HIGH → drop) ---
    // Start recovery: LOW top 0, z -10..10 (full-width tool).
    { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
    // Center bridge LOW: z 10..30 (spike z 22 jumped).
    { center: { x: 0, y: -0.5, z: 20 }, halfExtents: { x: 1.3, y: 0.5, z: 10 } },
    // Right island LOW: z 34..48 (gap 30..34, transfer R mid-air). Runs to
    // 48 so the MID rise takeoff keeps a lag-proof grounded window.
    { center: { x: -2.6, y: -0.5, z: 41 }, halfExtents: { x: 1.3, y: 0.5, z: 7 } },
    // MID center island: top 1.2, z 50..62 (gap 48..50, transfer L + rise).
    { center: { x: 0, y: 0.7, z: 56 }, halfExtents: { x: 1.3, y: 0.5, z: 6 } },
    // MID left island: top 1.2, z 66..80 (gap 62..66, transfer L). Runs to
    // 80 so the HIGH rise takeoff keeps a lag-proof grounded window.
    { center: { x: 2.6, y: 0.7, z: 73 }, halfExtents: { x: 1.3, y: 0.5, z: 7 } },
    // HIGH center island: top 2.4, z 82..94 (gap 80..82, transfer R + rise).
    { center: { x: 0, y: 1.9, z: 88 }, halfExtents: { x: 1.3, y: 0.5, z: 6 } },
    // M7.3: the LOW two-lane drop becomes an OFFSET island pair — drop onto
    // the L island (transfer L mid-fall), jump its spike, transfer R
    // mid-air onto the C island, jump its spike. Two horizontal commits
    // where the two-lane needed none. Islands sized for CDP-robust
    // verification (multi-tick ground spares before every re-jump).
    { center: { x: 2.6, y: -0.5, z: 105 }, halfExtents: { x: 1.3, y: 0.5, z: 7 } },
    { center: { x: 0, y: -0.5, z: 126 }, halfExtents: { x: 1.3, y: 0.5, z: 10 } },
    // Center bridge LOW: z 138..148 (gap 136..138, straight hop).
    { center: { x: 0, y: -0.5, z: 143 }, halfExtents: { x: 1.3, y: 0.5, z: 5 } },
    // Recovery runway LOW: z 152..176 (gap 148..152, full-width tool).
    { center: { x: 0, y: -0.5, z: 164 }, halfExtents: { x: 5.4, y: 0.5, z: 12 } },

    // --- PHASE 2: hazard garden (MID/HIGH + fast-fall gate) ---
    // MID two-lane C+R: top 1.2, z 178..210 (gap 176..178 step-up; the 2u
    // gap keeps the 1.2-rise takeoff window lag-proof).
    { center: { x: -1.3, y: 0.7, z: 194 }, halfExtents: { x: 2.6, y: 0.5, z: 16 } },
    // HIGH right island: top 2.4, z 212..226 (gap 210..212, rise, stay R;
    // 2u gap for the same lag-proof rise window).
    { center: { x: -2.6, y: 1.9, z: 220 }, halfExtents: { x: 1.3, y: 0.5, z: 6 } },
    // HIGH center island: top 2.4, z 231..245 (gap 226..231, transfer L,
    // spike z 235 jumped: takeoff ~233, land ~240.5; FF takeoff ~243.5).
    { center: { x: 0, y: 1.9, z: 238 }, halfExtents: { x: 1.3, y: 0.5, z: 7 } },
    // FAST-FALL GATE: LOW center island z 247..253 (drop 2.4; jump ~243.5 +
    // fast-fall lands ~249-251 mid-island; the same taps without fast-fall
    // land at the edge ~252.8 with a ~2-tick reaction window, then die in
    // the 253..257 gap because the scripted follow-up jump fires airborne).
    { center: { x: 0, y: -0.5, z: 250 }, halfExtents: { x: 1.3, y: 0.5, z: 3 } },
    // Fast-fall telegraph gate: side pylons + a high lintel the fall passes
    // under (bottom y 6.0 clears the HIGH-top jump apex 5.57 by 0.43).
    { center: { x: -5.5, y: 4, z: 248 }, halfExtents: { x: 1, y: 2, z: 6 } },
    { center: { x: 5.5, y: 4, z: 248 }, halfExtents: { x: 1, y: 2, z: 6 } },
    { center: { x: 0, y: 6.4, z: 248 }, halfExtents: { x: 6.5, y: 0.4, z: 6 } },
    // LOW two-lane C+R: z 257..277 (gap 253..257 jumped from the FF island).
    // M7.3: split into an OFFSET island pair (C 257..272, R 274..287).
    // The C spike (264) is jumped from mid-island; the R spike (274.5)
    // sits near the island START so the gap-transfer arc flies OVER it —
    // one jump does double duty, then a final hop crosses to the bridge.
    // The C island runs to 272 so the gap re-jump keeps a multi-tick
    // ground spare even under CDP input jitter.
    { center: { x: 0, y: -0.5, z: 264.5 }, halfExtents: { x: 1.3, y: 0.5, z: 7.5 } },
    { center: { x: -2.6, y: -0.5, z: 280.5 }, halfExtents: { x: 1.3, y: 0.5, z: 6.5 } },
    // LOW center bridge: z 290..303 (gap 287..290; spike 297.5; step-up
    // gap 303..307 to the portal approach).
    { center: { x: 0, y: -0.5, z: 296.5 }, halfExtents: { x: 1.3, y: 0.5, z: 6.5 } },
    // LOW two-lane L+C: z 307..325 (portal-up approach).
    { center: { x: 1.3, y: -0.5, z: 316 }, halfExtents: { x: 2.6, y: 0.5, z: 9 } },
    // M7.3 air-gate A: decorative pylon arch over the portal approach
    // (straight, no input). Side pylons + a high bar the route passes
    // under — bottom y 6.0 clears the LOW jump apex 3.17 by a mile.
    { center: { x: -5.5, y: 4, z: 160 }, halfExtents: { x: 1, y: 2, z: 2 } },
    { center: { x: 5.5, y: 4, z: 160 }, halfExtents: { x: 1, y: 2, z: 2 } },
    { center: { x: 0, y: 6.4, z: 160 }, halfExtents: { x: 6.5, y: 0.4, z: 2 } },

    // --- PHASE 3: ceiling world + MID return + floor pad + orb road ---
    // Ceiling two-lane C+R: underside 6, z 326..376 (rise landing ~329).
    { center: { x: -1.3, y: 7, z: 351 }, halfExtents: { x: 2.6, y: 1, z: 25 } },
    // Ceiling center bridge: underside 6, z 380..392 (gap 376..380 hop).
    { center: { x: 0, y: 7, z: 386 }, halfExtents: { x: 1.3, y: 1, z: 6 } },
    // Ceiling two-lane C+R: underside 6, z 400..424 (pad gap 392..400).
    { center: { x: -1.3, y: 7, z: 412 }, halfExtents: { x: 2.6, y: 1, z: 12 } },
    // Floor MID two-lane L+C: top 1.2, z 412..441 (orb-flip landing ~424).
    { center: { x: 1.3, y: 0.7, z: 426.5 }, halfExtents: { x: 2.6, y: 0.5, z: 14.5 } },
    // Floor LOW center island: top 0, z 449..467 (pad gap 441..449).
    { center: { x: 0, y: -0.5, z: 458 }, halfExtents: { x: 1.3, y: 0.5, z: 9 } },
    // Floor LOW center bridge: top 0, z 471..487 (gap 467..471).
    { center: { x: 0, y: -0.5, z: 479 }, halfExtents: { x: 1.3, y: 0.5, z: 8 } },
    // M7.3 short-hop runway: LOW two-lane L+C z 511..527 (hop exit 513
    // lands grounded center; anticipation spike 518; maw entry 524).
    { center: { x: 1.3, y: -0.5, z: 519 }, halfExtents: { x: 2.6, y: 0.5, z: 8 } },

    // --- PHASE 4: post-teleport MID world + jump orb (entry 514 → exit 634) ---
    // MID two-lane C+R: top 1.2, z 626..656 (exit z 634 lands grounded).
    { center: { x: -1.3, y: 0.7, z: 641 }, halfExtents: { x: 2.6, y: 0.5, z: 15 } },
    // LOW center island: top 0, z 660..676 (drop gap 656..660).
    { center: { x: 0, y: -0.5, z: 668 }, halfExtents: { x: 1.3, y: 0.5, z: 8 } },
    // LOW center bridge: top 0, z 684..712 (orb gap 676..684; 2x approach).
    { center: { x: 0, y: -0.5, z: 698 }, halfExtents: { x: 1.3, y: 0.5, z: 14 } },

    // --- PHASE 5: 2x fragmented climax + 1x technical epilogue ---
    // 2x LOW center bridge: z 712..732 (portal plane at its start).
    { center: { x: 0, y: -0.5, z: 722 }, halfExtents: { x: 1.3, y: 0.5, z: 10 } },
    // 2x LOW right island: z 743..783 (gap 732..743 + transfer R).
    { center: { x: -2.6, y: -0.5, z: 763 }, halfExtents: { x: 1.3, y: 0.5, z: 20 } },
    // 2x MID center island: top 1.2, z 790..825 (gap 783..790 + transfer L).
    { center: { x: 0, y: 0.7, z: 807.5 }, halfExtents: { x: 1.3, y: 0.5, z: 17.5 } },
    // 2x HIGH left island: top 2.4, z 828..855 (gap 825..828 + transfer L).
    { center: { x: 2.6, y: 1.9, z: 841.5 }, halfExtents: { x: 1.3, y: 0.5, z: 13.5 } },
    // 2x drop to LOW two-lane L+C: z 859..889 (gap 855..859, fall).
    { center: { x: 1.3, y: -0.5, z: 874 }, halfExtents: { x: 2.6, y: 0.5, z: 15 } },
    // 1x epilogue two-lane L+C: z 889..915 (release portal at its start).
    { center: { x: 1.3, y: -0.5, z: 902 }, halfExtents: { x: 2.6, y: 0.5, z: 13 } },
    // M7.3 air-gate B: the same pylon arch over the epilogue (straight).
    { center: { x: -5.5, y: 4, z: 902 }, halfExtents: { x: 1, y: 2, z: 2 } },
    { center: { x: 5.5, y: 4, z: 902 }, halfExtents: { x: 1, y: 2, z: 2 } },
    { center: { x: 0, y: 6.4, z: 902 }, halfExtents: { x: 6.5, y: 0.4, z: 2 } },
    // 1x epilogue center island: z 919..935 (gap 915..919; final spike jump).
    { center: { x: 0, y: -0.5, z: 927 }, halfExtents: { x: 1.3, y: 0.5, z: 8 } },
    // M7.3 release hop: runway z 939..951, gap 951..955, island 955..971
    // (finish 960) — the calm release keeps moving with one last clean jump.
    { center: { x: 0, y: -0.5, z: 945 }, halfExtents: { x: 5.4, y: 0.5, z: 6 } },
    { center: { x: 0, y: -0.5, z: 963 }, halfExtents: { x: 1.3, y: 0.5, z: 8 } },

    // --- M8A lava basins: contained pools (floor + rim walls), all fully
    // below/beside the success route (rims rise poolTop + 0.5 only). ---
    // Chain basin (pool top -4.2, floor top -5.5).
    { center: { x: 0, y: -6, z: 58 }, halfExtents: { x: 5, y: 0.5, z: 25 } },
    { center: { x: -4.75, y: -4.6, z: 58 }, halfExtents: { x: 0.75, y: 0.9, z: 24.75 } },
    { center: { x: 4.75, y: -4.6, z: 58 }, halfExtents: { x: 0.75, y: 0.9, z: 24.75 } },
    { center: { x: 0, y: -4.6, z: 33.25 }, halfExtents: { x: 5.5, y: 0.9, z: 0.75 } },
    { center: { x: 0, y: -4.6, z: 82.75 }, halfExtents: { x: 5.5, y: 0.9, z: 0.75 } },
    // Fast-fall basin (pool top -2.9, floor top -4.5).
    { center: { x: 0, y: -5, z: 250 }, halfExtents: { x: 4.5, y: 0.5, z: 9 } },
    { center: { x: -4.25, y: -3.45, z: 250 }, halfExtents: { x: 0.75, y: 1.05, z: 8.75 } },
    { center: { x: 4.25, y: -3.45, z: 250 }, halfExtents: { x: 0.75, y: 1.05, z: 8.75 } },
    { center: { x: 0, y: -3.45, z: 241.25 }, halfExtents: { x: 4.5, y: 1.05, z: 0.75 } },
    { center: { x: 0, y: -3.45, z: 258.75 }, halfExtents: { x: 4.5, y: 1.05, z: 0.75 } },
    // Lava-lake basin (pool top -3.9, floor top -5.5).
    { center: { x: 0, y: -6, z: 499 }, halfExtents: { x: 5, y: 0.5, z: 15 } },
    { center: { x: -4.75, y: -4.45, z: 499 }, halfExtents: { x: 0.75, y: 1.05, z: 14.75 } },
    { center: { x: 4.75, y: -4.45, z: 499 }, halfExtents: { x: 0.75, y: 1.05, z: 14.75 } },
    { center: { x: 0, y: -4.45, z: 484.25 }, halfExtents: { x: 5.5, y: 1.05, z: 0.75 } },
    { center: { x: 0, y: -4.45, z: 513.75 }, halfExtents: { x: 5.5, y: 1.05, z: 0.75 } },
    // Maw-river basin (pool top -6.9, floor top -8.5).
    { center: { x: 0, y: -9, z: 579 }, halfExtents: { x: 6, y: 0.5, z: 56 } },
    { center: { x: -5.75, y: -7.45, z: 579 }, halfExtents: { x: 0.75, y: 1.05, z: 55.75 } },
    { center: { x: 5.75, y: -7.45, z: 579 }, halfExtents: { x: 0.75, y: 1.05, z: 55.75 } },
    { center: { x: 0, y: -7.45, z: 523.25 }, halfExtents: { x: 6.5, y: 1.05, z: 0.75 } },
    { center: { x: 0, y: -7.45, z: 634.75 }, halfExtents: { x: 6.5, y: 1.05, z: 0.75 } },
    // Furnace basin (pool top -1.9, floor top -3.5) + source rock pillar.
    { center: { x: 6.5, y: -4, z: 670 }, halfExtents: { x: 3.5, y: 0.5, z: 19 } },
    { center: { x: 3.625, y: -2.45, z: 670 }, halfExtents: { x: 0.375, y: 1.05, z: 18.75 } },
    { center: { x: 6.5, y: -2.45, z: 650.25 }, halfExtents: { x: 3.5, y: 1.05, z: 0.75 } },
    { center: { x: 6.5, y: -2.45, z: 689.75 }, halfExtents: { x: 3.5, y: 1.05, z: 0.75 } },
    // Source pillar (off-corridor rock the vent attaches to).
    { center: { x: 11, y: 0, z: 670 }, halfExtents: { x: 1.5, y: 4, z: 2 } },
    // Storm basin (pool top -2.9, floor top -4.5).
    { center: { x: -7, y: -5, z: 810 }, halfExtents: { x: 4, y: 0.5, z: 26 } },
    { center: { x: -3.625, y: -3.45, z: 810 }, halfExtents: { x: 0.375, y: 1.05, z: 25.75 } },
    { center: { x: -10.75, y: -3.45, z: 810 }, halfExtents: { x: 0.75, y: 1.05, z: 25.75 } },
    { center: { x: -7, y: -3.45, z: 783.25 }, halfExtents: { x: 4, y: 1.05, z: 0.75 } },
    { center: { x: -7, y: -3.45, z: 836.75 }, halfExtents: { x: 4, y: 1.05, z: 0.75 } },
  ],

  hazards: [
    // Phase 1: TALL bridge spike (z 22, jumped) → offset-island spikes
    // (L z 106, C z 124 — each jumped on its own island).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.35, z: 22 }, halfExtents: { x: 0.5, y: 0.35, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 106 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 127 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 2: MID maze WALL (killFront, FULL platform width z 194..196 →
    // JUMP it; edge-riding is impossible) + MID weave (spike R z 190 →
    // hold C, spike C z 202 → commit R) → HIGH
    // island spike (z 235 jump) → offset-island spikes (C z 264, R z 274.5)
    // → bridge spike (z 297.5 jump).
    { kind: 'killFront', visual: 'block', center: { x: -1.3, y: 1.7, z: 195 }, halfExtents: { x: 2.6, y: 0.5, z: 1.0 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 1.45, z: 190 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 1.45, z: 202 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 2.65, z: 236 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 264 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 274.5 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 297.5 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 3 ceiling: dip/commit pair (center z 344, right z 360 — tips
    // DOWN) + a third commit spike (center z 364, jumped).
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 5.75, z: 344 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: -2.6, y: 5.75, z: 360 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 5.75, z: 365 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 3 floor: MID maze WALL (killFront, covers L z 431..433 → hold
    // center for the pad) + MID spike (z 428 covers L → commit center).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 1.45, z: 428 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 2.6, y: 2.2, z: 432 }, halfExtents: { x: 1.3, y: 1.0, z: 1.0 } },
    // Phase 3 floor bridge spike (z 481 jump) + hop-runway spike (z 518).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 481 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 518 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 4: post-exit maze WALL (killFront, covers R z 639..641 → hold
    // center) + commit pair (z 646 covers R, z 652 covers C → commit R,
    // then drop-transfer back to center) + orb-road spike (z 700 jump).
    { kind: 'killFront', visual: 'block', center: { x: -2.6, y: 2.2, z: 640 }, halfExtents: { x: 1.3, y: 1.0, z: 1.0 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 1.45, z: 646 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 1.45, z: 654 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 700 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 5 2x: TALL island spike pair (z 760 + tall z 764, jumped as one
    // arc) → HIGH island spike (z 846 jump) → drop weave (safe C z 870,
    // safe L z 880) → epilogue maze WALL (killFront, covers L z 907..909)
    // + epilogue weave (safe L z 899) + TALL final island spike (z 927).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 760 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.35, z: 764 }, halfExtents: { x: 0.5, y: 0.35, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 2.65, z: 846 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 874 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 886 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'killFront', visual: 'block', center: { x: 2.6, y: 1.0, z: 908 }, halfExtents: { x: 1.3, y: 1.0, z: 1.0 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 899 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.35, z: 927 }, halfExtents: { x: 0.5, y: 0.35, z: 0.5 } },
  ],

  theme: {
    background: 0x0d0312,
    fogColor: 0x220826,
    fogNear: 30,
    fogFar: 130,
    platform: 0x1a1026,
    platformTop: 0x2a1640,
    edge: 0xff4d88,
    hazard: 0xff9d00,
  },
  /**
   * M7.2 visual arc: eight clearly distinct scenes — ember intro → blue
   * ascent → magenta garden → navy ceiling abyss → warm return → violet
   * teleport void → red/orange furnace → cyan storm climax → calm release.
   * Player cyan anchor and hazard orange never change (structural);
   * fingerprint-excluded.
   */
  visualSequence: {
    sections: [
      { id: 'ac-ember', startZ: -10, endZ: 98, blendIn: 1, overrides: {} },
      {
        id: 'ac-ascent',
        startZ: 98,
        endZ: 180,
        blendIn: 20,
        overrides: {
          background: 0x04122a,
          fogColor: 0x0c2c55,
          routeAccent: 0x3fa9ff,
          environmentIntensity: 1.2,
          vfxIntensity: 1.1,
        },
      },
      {
        id: 'ac-garden',
        startZ: 180,
        endZ: 322,
        blendIn: 20,
        overrides: {
          background: 0x1c0518,
          fogColor: 0x421036,
          routeAccent: 0xff4dd2,
          environmentIntensity: 1.25,
          vfxIntensity: 1.15,
        },
      },
      {
        id: 'ac-abyss',
        startZ: 322,
        endZ: 441,
        blendIn: 24,
        overrides: {
          background: 0x010614,
          fogColor: 0x081c3d,
          fogNear: 26,
          fogFar: 120,
          routeAccent: 0x3fa9ff,
          environmentIntensity: 1.4,
          exposure: 1.1,
          vfxIntensity: 1.1,
          streakIntensity: 1.2,
        },
      },
      {
        id: 'ac-return',
        startZ: 441,
        endZ: 500,
        blendIn: 20,
        overrides: {
          background: 0x160a24,
          fogColor: 0x33144d,
          routeAccent: 0xb44dff,
          environmentIntensity: 1.25,
          vfxIntensity: 1.15,
        },
      },
      {
        id: 'ac-maw',
        startZ: 500,
        endZ: 626,
        blendIn: 18,
        overrides: {
          background: 0x0a0318,
          fogColor: 0x2a0a4d,
          routeAccent: 0xc77dff,
          environmentIntensity: 1.35,
          exposure: 1.12,
          vfxIntensity: 1.2,
        },
      },
      {
        id: 'ac-furnace',
        startZ: 626,
        endZ: 708,
        blendIn: 14,
        overrides: {
          background: 0x1c0505,
          fogColor: 0x4d140a,
          routeAccent: 0xff7a3d,
          environmentIntensity: 1.35,
          exposure: 1.15,
          vfxIntensity: 1.2,
        },
      },
      {
        id: 'ac-storm',
        startZ: 708,
        endZ: 873,
        blendIn: 16,
        overrides: {
          background: 0x041a20,
          fogColor: 0x0f3d45,
          routeAccent: 0x4ff2ff,
          environmentIntensity: 1.4,
          bloomStrength: 0.6,
          exposure: 1.25,
          vfxIntensity: 1.3,
          streakIntensity: 1.6,
        },
      },
      {
        id: 'ac-calm',
        startZ: 873,
        endZ: 976,
        blendIn: 8,
        overrides: {
          background: 0x041412,
          fogColor: 0x0d2b26,
          bloomStrength: 0.4,
          exposure: 1.1,
          environmentIntensity: 0.9,
          vfxIntensity: 0.9,
          streakIntensity: 0.7,
        },
      },
    ],
  },
  /**
   * M7.2 beat-ready cues: semantic markers for FUTURE music mapping
   * (presentation-only — no audio ships; excluded from the fingerprint and
   * from replays). Positions coincide with section boundaries, height-band
   * changes, mechanic hits and the teleport pair.
   */
  rhythmCues: [
    { id: 'ac-cue-intro', z: -10, role: 'intro' },
    { id: 'ac-cue-first-jump', z: 22, role: 'accent' },
    { id: 'ac-cue-islands', z: 34, role: 'build' },
    { id: 'ac-cue-rise-mid', z: 50, role: 'accent' },
    { id: 'ac-cue-rise-high', z: 82, role: 'accent' },
    { id: 'ac-cue-ascent', z: 98, role: 'sectionChange' },
    { id: 'ac-cue-drop', z: 94, role: 'drop' },
    { id: 'ac-cue-garden', z: 180, role: 'sectionChange' },
    { id: 'ac-cue-garden-weave', z: 192, role: 'accent' },
    { id: 'ac-cue-wall', z: 195, role: 'accent' },
    { id: 'ac-cue-fastfall', z: 243, role: 'drop' },
    { id: 'ac-cue-abyss', z: 322, role: 'sectionChange' },
    { id: 'ac-cue-gravity-hit', z: 322, role: 'gravityHit' },
    { id: 'ac-cue-pad-ceiling', z: 391, role: 'padHit' },
    { id: 'ac-cue-gravity-orb', z: 420, role: 'gravityHit' },
    { id: 'ac-cue-return', z: 441, role: 'sectionChange' },
    { id: 'ac-cue-pad-floor', z: 437, role: 'padHit' },
    { id: 'ac-cue-hop-in', z: 489, role: 'drop' },
    { id: 'ac-cue-maw', z: 500, role: 'sectionChange' },
    { id: 'ac-cue-hop-out', z: 513, role: 'accent' },
    { id: 'ac-cue-teleport-in', z: 524, role: 'drop' },
    { id: 'ac-cue-teleport-out', z: 634, role: 'sectionChange' },
    { id: 'ac-cue-furnace', z: 626, role: 'sectionChange' },
    { id: 'ac-cue-orb-jump', z: 678, role: 'orbHit' },
    { id: 'ac-cue-storm', z: 708, role: 'sectionChange' },
    { id: 'ac-cue-speed', z: 708, role: 'speedHit' },
    { id: 'ac-cue-storm-peak', z: 831, role: 'climax' },
    { id: 'ac-cue-beast', z: 820, role: 'build' },
    { id: 'ac-cue-release', z: 873, role: 'release' },
    { id: 'ac-cue-epilogue', z: 919, role: 'accent' },
    { id: 'ac-cue-finish', z: 960, role: 'finish' },
  ],
};
