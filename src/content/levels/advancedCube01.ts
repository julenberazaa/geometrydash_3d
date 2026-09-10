import type { LevelDefinition } from '../../level/levelDefinition';

/**
 * Advanced Cube 01 (M7.2) — HARD production Cube level + teleport debut.
 *
 * A genuinely new level (vertical-slice-01 is preserved untouched): more
 * vertical (LOW/MID/HIGH floor bands + a substantial ceiling world), more
 * fragmented (single-lane islands, narrow bridges, offset landings), denser
 * hazards, one fast-fall gate, and a single paired TELEPORT portal that
 * jumps the route through a guardian-setpiece void into a new palette.
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
 *   PHASE 1  z  -10..176  precision ascent (LOW → MID → HIGH → drop)
 *   PHASE 2  z 176..325   hazard garden (MID/HIGH + fast-fall gate)
 *   PHASE 3  z 322..519   ceiling world + MID return + floor pad + orb road
 *   PHASE 4  z 510..712   teleport setpiece (entry 514 → exit 634) + orb
 *   PHASE 5  z 708..930   2x fragmented climax + 1x technical epilogue
 * Teleport skips 514..634 (120 u ≈ 10 s). Estimated run ≈ 64 s; the exact
 * deterministic duration is pinned by test (see tests/advancedCube01.test.ts).
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
  finishZ: 944,
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
      entryZ: 514,
      exit: { x: 0, y: 1.75, z: 634 },
      exitLaneIndex: 1,
      style: 'maw',
    },
  ],
  visualSetpieces: [
    {
      id: 'ac-guardian-maw',
      kind: 'guardian',
      center: { x: 0, y: 5, z: 522 },
      halfExtents: { x: 7, y: 4.5, z: 1.5 },
    },
  ],

  solids: [
    // --- PHASE 1: precision ascent (LOW → MID → HIGH → drop) ---
    // Start recovery: LOW top 0, z -10..10 (full-width tool).
    { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
    // Center bridge LOW: z 10..30 (spike z 22 jumped).
    { center: { x: 0, y: -0.5, z: 20 }, halfExtents: { x: 1.3, y: 0.5, z: 10 } },
    // Right island LOW: z 34..46 (gap 30..34, transfer R mid-air).
    { center: { x: -2.6, y: -0.5, z: 40 }, halfExtents: { x: 1.3, y: 0.5, z: 6 } },
    // MID center island: top 1.2, z 50..62 (gap 46..50, transfer L + rise).
    { center: { x: 0, y: 0.7, z: 56 }, halfExtents: { x: 1.3, y: 0.5, z: 6 } },
    // MID left island: top 1.2, z 66..78 (gap 62..66, transfer L).
    { center: { x: 2.6, y: 0.7, z: 72 }, halfExtents: { x: 1.3, y: 0.5, z: 6 } },
    // HIGH center island: top 2.4, z 82..94 (gap 78..82, transfer R + rise).
    { center: { x: 0, y: 1.9, z: 88 }, halfExtents: { x: 1.3, y: 0.5, z: 6 } },
    // Drop to LOW two-lane L+C: z 98..128 (gap 94..98, intentional fall).
    { center: { x: 1.3, y: -0.5, z: 113 }, halfExtents: { x: 2.6, y: 0.5, z: 15 } },
    // Center bridge LOW: z 132..148 (gap 128..132, transfer R to center).
    { center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 1.3, y: 0.5, z: 8 } },
    // Recovery runway LOW: z 152..176 (gap 148..152, full-width tool).
    { center: { x: 0, y: -0.5, z: 164 }, halfExtents: { x: 5.4, y: 0.5, z: 12 } },

    // --- PHASE 2: hazard garden (MID/HIGH + fast-fall gate) ---
    // MID two-lane C+R: top 1.2, z 180..210 (gap 176..180 step-up).
    { center: { x: -1.3, y: 0.7, z: 195 }, halfExtents: { x: 2.6, y: 0.5, z: 15 } },
    // HIGH right island: top 2.4, z 214..226 (gap 210..214, rise, stay R).
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
    { center: { x: -1.3, y: -0.5, z: 267 }, halfExtents: { x: 2.6, y: 0.5, z: 10 } },
    // LOW center bridge: z 281..301 (gap 277..281, transfer center).
    { center: { x: 0, y: -0.5, z: 291 }, halfExtents: { x: 1.3, y: 0.5, z: 10 } },
    // LOW two-lane L+C: z 305..325 (gap 301..305; portal-up approach).
    { center: { x: 1.3, y: -0.5, z: 315 }, halfExtents: { x: 2.6, y: 0.5, z: 10 } },

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
    // Floor LOW center bridge: top 0, z 471..491 (gap 467..471, anticipation).
    { center: { x: 0, y: -0.5, z: 481 }, halfExtents: { x: 1.3, y: 0.5, z: 10 } },
    // Floor LOW two-lane L+C: top 0, z 495..519 (gap 491..495; teleport
    // entry z 514 sits on this runway; guardian looms at z 520).
    { center: { x: 1.3, y: -0.5, z: 507 }, halfExtents: { x: 2.6, y: 0.5, z: 12 } },

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
    // 2x MID center island: top 1.2, z 793..825 (gap 783..793 + transfer L).
    { center: { x: 0, y: 0.7, z: 809 }, halfExtents: { x: 1.3, y: 0.5, z: 16 } },
    // 2x HIGH left island: top 2.4, z 831..855 (gap 825..831 + transfer L).
    { center: { x: 2.6, y: 1.9, z: 843 }, halfExtents: { x: 1.3, y: 0.5, z: 12 } },
    // 2x drop to LOW two-lane L+C: z 859..889 (gap 855..859, fall).
    { center: { x: 1.3, y: -0.5, z: 874 }, halfExtents: { x: 2.6, y: 0.5, z: 15 } },
    // 1x epilogue two-lane L+C: z 889..915 (release portal at its start).
    { center: { x: 1.3, y: -0.5, z: 902 }, halfExtents: { x: 2.6, y: 0.5, z: 13 } },
    // 1x epilogue center island: z 919..935 (gap 915..919; final spike jump).
    { center: { x: 0, y: -0.5, z: 927 }, halfExtents: { x: 1.3, y: 0.5, z: 8 } },
    // Release runway: z 939..959 (gap 935..939; finish at 944; no hazards).
    { center: { x: 0, y: -0.5, z: 949 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
  ],

  hazards: [
    // Phase 1: bridge spike (z 22) → weave on the L+C two-lane (spike C
    // z 112 → commit L, spike L z 122 → commit C; R is off this platform).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 22 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 112 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 122 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 2: MID weave (safe C z 192, safe R z 202) → HIGH island spike
    // (z 237 jump) → two-lane full-width row (z 266 jump) → bridge spike
    // (z 290 jump).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 1.45, z: 192 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 1.45, z: 202 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 2.65, z: 235 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 266 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 266 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 290 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 3 ceiling: dip/commit pair (center z 344, right z 360 — tips DOWN).
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 5.75, z: 344 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: -2.6, y: 5.75, z: 360 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 3 floor: MID spike (z 428 covers L → commit center for the pad).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 1.45, z: 428 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 3 floor bridge spike (z 481 jump) + anticipation spike (z 505).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 481 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 505 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 4: post-exit spike (z 646 covers R → commit center) + orb-road
    // spike (z 700 jump on the 2x approach bridge).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 1.45, z: 646 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 700 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Phase 5 2x: island spike (z 762 jump) → drop weave (safe C z 870,
    // safe L z 880) → epilogue weave (safe L z 899) + final island spike
    // (z 921 jump).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 762 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 874 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 886 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 899 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 927 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
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
        endZ: 950,
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
    { id: 'ac-cue-fastfall', z: 243, role: 'drop' },
    { id: 'ac-cue-abyss', z: 322, role: 'sectionChange' },
    { id: 'ac-cue-gravity-hit', z: 322, role: 'gravityHit' },
    { id: 'ac-cue-pad-ceiling', z: 391, role: 'padHit' },
    { id: 'ac-cue-gravity-orb', z: 420, role: 'gravityHit' },
    { id: 'ac-cue-return', z: 441, role: 'sectionChange' },
    { id: 'ac-cue-pad-floor', z: 437, role: 'padHit' },
    { id: 'ac-cue-maw', z: 500, role: 'sectionChange' },
    { id: 'ac-cue-teleport-in', z: 514, role: 'drop' },
    { id: 'ac-cue-teleport-out', z: 634, role: 'sectionChange' },
    { id: 'ac-cue-furnace', z: 626, role: 'sectionChange' },
    { id: 'ac-cue-orb-jump', z: 678, role: 'orbHit' },
    { id: 'ac-cue-storm', z: 708, role: 'sectionChange' },
    { id: 'ac-cue-speed', z: 708, role: 'speedHit' },
    { id: 'ac-cue-storm-peak', z: 831, role: 'climax' },
    { id: 'ac-cue-release', z: 873, role: 'release' },
    { id: 'ac-cue-epilogue', z: 919, role: 'accent' },
    { id: 'ac-cue-finish', z: 944, role: 'finish' },
  ],
};
