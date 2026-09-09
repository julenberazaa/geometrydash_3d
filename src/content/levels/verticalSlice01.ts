import type { LevelDefinition } from '../../level/levelDefinition';

/**
 * Vertical Slice 01 (M7.1) — PRECISION, DIFFICULTY & SPECTACLE REWORK.
 *
 * Same dramatic skeleton as M7 (portal/speed Z positions, mechanic flow and
 * ~51.6 s duration are unchanged — forward motion is constant-speed so extra
 * jumps never change the clock), but the route topology is rebuilt for
 * intentional landings: full-width slabs survive only as three short
 * recovery/release tools; everything else is single-lane islands (2.6 u
 * wide), two-lane platforms (5.2 u), narrow bridges and staggered offsets
 * that require airborne lane correction.
 *
 * Platform fairness (frozen tuning: collider 1.1 wide, lane spacing 2.6,
 * lateral max 16 u/s, jump impulse 13.2 / gravity 42 → airtime 0.629 s):
 * - Single-lane island (halfX 1.3, width 2.6, centered on a lane): the Cube
 *   footprint (±0.55) keeps 0.75 u of margin per side. Precision, not
 *   pixel-perfect: a settled landing never depends on sub-tick variance.
 * - Two-lane platform (halfX 2.6, width 5.2): 0.75 u outer margins, allows
 *   one deliberate lateral choice but never full-corridor freedom.
 * - Narrow bridge (halfX 1.3 continuous): overcorrection past the edge lane
 *   leaves support (virtual-lane teeter → side fall), so taps must be exact.
 * - Airborne transfers move exactly ONE lane per jump (2.6 u lateral in
 *   ~0.63 s of airtime needs ~0.25 s at cruise — comfortable but deliberate).
 *
 * Envelopes (unchanged tuning):
 * - 1x jump range at base speed 12: 7.55 u → standard gaps <= 5 u keep
 *   >= 2.5 u; island gaps 4..5 u.
 * - Ceiling pad impulse 22: ~12.6 u forward; pad z=243 lands ~254.2 past
 *   the 244..252 gap (plain max ~251.5 — REQUIRED).
 * - Floor pad impulse 23: ~13.1 u forward; pad z=311 lands ~322.8 past the
 *   313..321 gap (plain max ~320.6 — REQUIRED).
 * - Jump orb impulse 15: press z~352.5 lands ~361 past the 348..358 gap
 *   (no-press flight lands ~353.5 — REQUIRED).
 * - Gravity orb z=285: jump at ~282.5 (down off the ceiling), press at
 *   ~284.5 inside the y 2.5..4.3 window, floor landing on F1.
 * - 2x jump range: 15.1 u → sprint gaps 10..11 u keep ~4..5 u margin.
 *
 * Act timing at base speed 12 (finish z=680, start z=-4, 2x over z 518..648
 * saves 130/24 s): 684/12 - 130/24 ≈ 51.6 s.
 *
 *   ACT I   z -10..170  precision introduction (bridge, island chain with
 *                        three airborne transfers, elevated hop, weave)
 *   ACT II  z 170..440  gravity / technical build (narrow ceiling world,
 *                        ceiling pad, orb return, floor pad, orb, callback)
 *   ACT III z 440..680  speed climax (1x weave, 2x island sprint, release)
 *
 * Screen-side convention (M1.1): laneCenters index 0/1/2 = screen-left /
 * center / screen-right (world x +2.6 / 0 / −2.6).
 */
export const VERTICAL_SLICE_01: LevelDefinition = {
  id: 'vertical-slice-01',
  displayName: 'VERTICAL SLICE 01',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 12,
  finishZ: 680,
  deathY: -14,
  deathYMax: 12,
  startGravityMode: 'floor',
  gravityPortals: [
    { id: 'vs-portal-up-1', z: 170, target: 'ceiling' },
    { id: 'vs-portal-up-2', z: 385, target: 'ceiling' },
    { id: 'vs-portal-down-2', z: 415, target: 'floor' },
  ],
  speedPortals: [
    { id: 'vs-speed-2x', z: 518, multiplier: 2 },
    { id: 'vs-speed-1x', z: 648, multiplier: 1 },
  ],
  jumpPads: [
    {
      id: 'vs-pad-ceiling',
      center: { x: -2.6, y: 5.85, z: 243 },
      halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
      surface: 'ceiling',
      impulse: 22,
    },
    {
      id: 'vs-pad-floor',
      center: { x: 0, y: 0.15, z: 311 },
      halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
      surface: 'floor',
      impulse: 23,
    },
  ],
  jumpOrbs: [
    {
      id: 'vs-orb-jump',
      center: { x: 0, y: 2.2, z: 352 },
      halfExtents: { x: 0.9, y: 0.9, z: 0.9 },
      impulse: 15,
    },
  ],
  gravityOrbs: [
    {
      id: 'vs-orb-gravity',
      center: { x: 0, y: 3.4, z: 285 },
      halfExtents: { x: 0.9, y: 0.9, z: 0.8 },
    },
  ],

  solids: [
    // --- ACT I: precision introduction ---
    // Start recovery: top y=0, z -10..14 (the ONLY full-width slab in Act I).
    { center: { x: 0, y: -0.5, z: 2 }, halfExtents: { x: 5.4, y: 0.5, z: 12 } },
    // Center bridge: single-lane, z 14..34 (no lane freedom; jump the spike).
    { center: { x: 0, y: -0.5, z: 24 }, halfExtents: { x: 1.3, y: 0.5, z: 10 } },
    // Island chain over the void (gap 34..38): right island z 38..50.
    // Takeoff center → land screen-right: FIRST airborne lateral transfer.
    { center: { x: -2.6, y: -0.5, z: 44 }, halfExtents: { x: 1.3, y: 0.5, z: 6 } },
    // Center island z 54..66 (gap 50..54): transfer back to center.
    { center: { x: 0, y: -0.5, z: 60 }, halfExtents: { x: 1.3, y: 0.5, z: 6 } },
    // Left island z 70.5..82 (gap 66..70.5): transfer to screen-left.
    { center: { x: 2.6, y: -0.5, z: 76.25 }, halfExtents: { x: 1.3, y: 0.5, z: 5.75 } },
    // Elevated left platform: top y=0.8, z 84..96 (step-up gap 82..84).
    { center: { x: 2.6, y: 0.4, z: 90 }, halfExtents: { x: 1.3, y: 0.4, z: 6 } },
    // Two-lane platform L+C: z 100..130 (drop gap 96..100; one lateral choice).
    { center: { x: 1.3, y: -0.5, z: 115 }, halfExtents: { x: 2.6, y: 0.5, z: 15 } },
    // Center bridge z 134.5..150 (gap 130..134.5 + transfer to center).
    { center: { x: 0, y: -0.5, z: 142.25 }, halfExtents: { x: 1.3, y: 0.5, z: 7.75 } },
    // Recovery runway: top y=0, z 154..176 (gap 150..154, 4 u; portal approach).
    { center: { x: 0, y: -0.5, z: 165 }, halfExtents: { x: 5.4, y: 0.5, z: 11 } },

    // --- ACT II: gravity / technical build (ceiling world) ---
    // Ceiling two-lane L+C: underside y=6, z 174..230 (rise landing ~177).
    { center: { x: 1.3, y: 7, z: 202 }, halfExtents: { x: 2.6, y: 1, z: 28 } },
    // Ceiling two-lane C+R: underside y=6, z 234..244 (gap 230..234, 4 u).
    { center: { x: -1.3, y: 7, z: 239 }, halfExtents: { x: 2.6, y: 1, z: 5 } },
    // Ceiling two-lane C+R: underside y=6, z 252..274 (pad gap 244..252).
    { center: { x: -1.3, y: 7, z: 263 }, halfExtents: { x: 2.6, y: 1, z: 11 } },
    // Ceiling center bridge: underside y=6, z 276..288 (hop gap 274..276).
    { center: { x: 0, y: 7, z: 282 }, halfExtents: { x: 1.3, y: 1, z: 6 } },
    // Floor two-lane C+R: top y=0, z 280..313 (orb-flip landing ~289).
    { center: { x: -1.3, y: -0.5, z: 296.5 }, halfExtents: { x: 2.6, y: 0.5, z: 16.5 } },
    // Floor center island: top y=0, z 321..348 (pad gap 313..321).
    { center: { x: 0, y: -0.5, z: 334.5 }, halfExtents: { x: 1.3, y: 0.5, z: 13.5 } },
    // Floor center bridge: top y=0, z 358..402 (orb gap 348..358; portal
    // approach; shares z 388..402 with the callback slab as a corridor).
    { center: { x: 0, y: -0.5, z: 380 }, halfExtents: { x: 1.3, y: 0.5, z: 22 } },
    // Ceiling callback slab: underside y=6, z 388..412 (short inversion).
    { center: { x: 0, y: 7, z: 400 }, halfExtents: { x: 1.3, y: 1, z: 12 } },
    // Floor center bridge: top y=0, z 412..445 (portal-down landing ~422).
    { center: { x: 0, y: -0.5, z: 428.5 }, halfExtents: { x: 1.3, y: 0.5, z: 16.5 } },

    // --- ACT III: climax / release ---
    // Two-lane L+C: top y=0, z 445..480 (1x closing weave).
    { center: { x: 1.3, y: -0.5, z: 462.5 }, halfExtents: { x: 2.6, y: 0.5, z: 17.5 } },
    // Center bridge: top y=0, z 484..518 (gap 480..484; 2x portal approach).
    { center: { x: 0, y: -0.5, z: 501 }, halfExtents: { x: 1.3, y: 0.5, z: 17 } },
    // 2x takeoff bridge: top y=0, z 518..538 (portal plane at its start).
    { center: { x: 0, y: -0.5, z: 528 }, halfExtents: { x: 1.3, y: 0.5, z: 10 } },
    // 2x sprint, right island: top y=0, z 549..596 (gap 538..549 + transfer).
    { center: { x: -2.6, y: -0.5, z: 572.5 }, halfExtents: { x: 1.3, y: 0.5, z: 23.5 } },
    // 2x sprint, two-lane L+C: top y=0, z 606..648 (gap 596..606 + transfer).
    { center: { x: 1.3, y: -0.5, z: 627 }, halfExtents: { x: 2.6, y: 0.5, z: 21 } },
    // Release: top y=0, z 648..684 (1x; finish at 680; no hazards).
    { center: { x: 0, y: -0.5, z: 666 }, halfExtents: { x: 5.4, y: 0.5, z: 18 } },
  ],

  hazards: [
    // Act I: bridge spike (jump over, z=30) → island spike (jump over, z=60)
    // → weave on the two-lane (safe C at z=112, safe L at z=122).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 22 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 60 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 112 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 122 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Ceiling: dip under the center spike (z=200), commit center past the
    // screen-left spike (z=216) — tips point DOWN (mount: ceiling).
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 5.75, z: 200 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 2.6, y: 5.75, z: 216 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Floor bridge spike (jump over, z=372) on the orb-landing bridge.
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 372 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Callback ceiling spike (dip under, z=402) — tips point DOWN.
    { kind: 'hazard', visual: 'spike', mount: 'ceiling', center: { x: 0, y: 5.75, z: 402 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Act III 1x weave: safe center (z=460), safe screen-left (z=472).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 460 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 472 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // 2x sprint: jump over the screen-right spike (z=580) on the narrow
    // island, then commit screen-left past the center spike (z=626).
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 580 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 626 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
  ],

  theme: {
    background: 0x060313,
    fogColor: 0x120826,
    fogNear: 30,
    fogFar: 130,
    platform: 0x141026,
    platformTop: 0x201640,
    edge: 0x4fd2ff,
    hazard: 0xff9d00,
  },
  /**
   * M7.1 visual arc: six clearly distinct scenes (each recognizable from one
   * screenshot) — deep-violet opening → electric precision build → navy
   * gravity world → magenta tech section → high-energy cyan/magenta climax
   * → calm teal release. Player cyan anchor and hazard orange never change
   * (structural); fingerprint-excluded.
   */
  visualSequence: {
    sections: [
      { id: 'vs-opening', startZ: -10, endZ: 100, blendIn: 1, overrides: {} },
      {
        id: 'vs-precision',
        startZ: 100,
        endZ: 170,
        blendIn: 20,
        overrides: {
          background: 0x0d0422,
          fogColor: 0x1e0c3a,
          routeAccent: 0x7d5dff,
          environmentIntensity: 1.2,
          vfxIntensity: 1.1,
        },
      },
      {
        id: 'vs-gravity',
        startZ: 170,
        endZ: 300,
        blendIn: 24,
        overrides: {
          background: 0x02081a,
          fogColor: 0x0a2044,
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
        id: 'vs-tech',
        startZ: 300,
        endZ: 440,
        blendIn: 20,
        overrides: {
          background: 0x1a0518,
          fogColor: 0x3d0a33,
          routeAccent: 0xff4dd2,
          environmentIntensity: 1.25,
          vfxIntensity: 1.15,
        },
      },
      {
        id: 'vs-climax',
        startZ: 440,
        endZ: 648,
        blendIn: 16,
        overrides: {
          background: 0x0b0620,
          fogColor: 0x2a0f45,
          routeAccent: 0x4ff2ff,
          environmentIntensity: 1.4,
          bloomStrength: 0.6,
          exposure: 1.25,
          vfxIntensity: 1.3,
          streakIntensity: 1.6,
        },
      },
      {
        id: 'vs-release',
        startZ: 648,
        endZ: 690,
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
   * M7.1 beat-ready cues: semantic markers for FUTURE music mapping
   * (presentation-only — no audio ships; excluded from the fingerprint and
   * from replays; the visual timeline resolves independently). Positions
   * coincide with section boundaries and mechanic hits so a future song can
   * map intro / build / hits / drop / release onto downbeats and drops.
   */
  rhythmCues: [
    { id: 'm71-cue-intro', z: -10, role: 'intro' },
    { id: 'm71-cue-first-jump', z: 22, role: 'accent' },
    { id: 'm71-cue-islands', z: 38, role: 'build' },
    { id: 'm71-cue-precision', z: 100, role: 'sectionChange' },
    { id: 'm71-cue-portal-run', z: 134, role: 'build' },
    { id: 'm71-cue-inversion', z: 170, role: 'sectionChange' },
    { id: 'm71-cue-gravity-hit', z: 170, role: 'gravityHit' },
    { id: 'm71-cue-pad-ceiling', z: 243, role: 'padHit' },
    { id: 'm71-cue-gravity-orb', z: 285, role: 'gravityHit' },
    { id: 'm71-cue-tech', z: 300, role: 'sectionChange' },
    { id: 'm71-cue-pad-floor', z: 311, role: 'padHit' },
    { id: 'm71-cue-orb-jump', z: 352, role: 'orbHit' },
    { id: 'm71-cue-callback', z: 385, role: 'gravityHit' },
    { id: 'm71-cue-climax', z: 440, role: 'sectionChange' },
    { id: 'm71-cue-sprint', z: 518, role: 'speedHit' },
    { id: 'm71-cue-drop', z: 518, role: 'drop' },
    { id: 'm71-cue-sprint-accent', z: 580, role: 'accent' },
    { id: 'm71-cue-climax-peak', z: 626, role: 'climax' },
    { id: 'm71-cue-release', z: 648, role: 'release' },
    { id: 'm71-cue-finish', z: 680, role: 'finish' },
  ],
};
