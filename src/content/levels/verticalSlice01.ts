import type { LevelDefinition } from '../../level/levelDefinition';

/**
 * Vertical Slice 01 (M7) — the FIRST PRODUCTION Cube vertical slice.
 *
 * A ~52 s authored level on the frozen M1–M6 production stack (zero engine
 * changes): three-act pacing, one substantial ceiling passage plus a short
 * inversion callback, a required floor pad, a required ceiling pad, a
 * required jump orb, a gravity-orb return, a 2x sprint with a 1x release,
 * and a deliberately authored visual arc. NOT a validation track.
 *
 * Envelopes (frozen tuning: jump impulse 13.2, gravity 42, airtime 0.629 s):
 * - 1x jump range at base speed 12: 7.55 u → standard gaps <= 5.5 u
 *   (margin >= 2 u); near-limit gaps are rare and intentional.
 * - 2x jump range: 15.1 u → the 2x gap is 11 u (margin ~4 u).
 * - Floor pad impulse 23: airtime 1.095 s → 13.1 u forward; fires ~1.35 u
 *   before its center (swept contact), so pad z=314 lands ~325.8 past the
 *   316..324 gap (plain jump max 323.5 — the pad is REQUIRED).
 * - Ceiling pad impulse 22: 12.6 u forward; pad z=243 lands ~254.2 past the
 *   244..252 gap (plain max ~251.5 — REQUIRED).
 * - Jump orb impulse 15: 8.6 u second flight; press z~353.2 lands ~361.8
 *   past the 350..360 gap (no-press flight lands ~356.5 — REQUIRED).
 * - Gravity orb z=285: jump at ~282.5 (down off the ceiling), press at
 *   ~284.5 inside the y 2.5..4.3 window, floor landing ~289.
 *
 * Act timing at base speed 12 (finish z=680, start z=-4, 2x over z 518..648
 * saves 130/24 s): 684/12 - 130/24 ≈ 51.6 s.
 *
 *   ACT I   z -10..170  establish/flow (runway, hops, weave, recovery)
 *   ACT II  z 170..440  transform/build (ceiling world, pads, orbs, callback)
 *   ACT III z 440..680  climax/release (1x weave, 2x sprint, 1x release)
 *
 * Screen-side convention (M1.1): laneCenters index 0/1/2 = screen-left /
 * center / screen-right (world x +2.6 / 0 / -2.6).
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
      center: { x: 0, y: 5.85, z: 243 },
      halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
      surface: 'ceiling',
      impulse: 22,
    },
    {
      id: 'vs-pad-floor',
      center: { x: 0, y: 0.15, z: 314 },
      halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
      surface: 'floor',
      impulse: 23,
    },
  ],
  jumpOrbs: [
    {
      id: 'vs-orb-jump',
      center: { x: 0, y: 2.2, z: 354 },
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
    // --- ACT I: establish / flow ---
    // Runway A: top y=0, z -10..48 (opening runway + lane markers).
    { center: { x: 0, y: -0.5, z: 19 }, halfExtents: { x: 5.4, y: 0.5, z: 29 } },
    // Lane marker blocks BETWEEN lanes (cosmetic rhythm, copied pattern).
    { center: { x: 1.3, y: -0.15, z: 12 }, halfExtents: { x: 0.35, y: 0.35, z: 0.35 } },
    { center: { x: -1.3, y: -0.15, z: 18 }, halfExtents: { x: 0.35, y: 0.35, z: 0.35 } },
    { center: { x: 1.3, y: -0.15, z: 24 }, halfExtents: { x: 0.35, y: 0.35, z: 0.35 } },
    // Platform B: top y=0.8, z 48..58 (hop up from the runway).
    { center: { x: 0, y: 0, z: 53 }, halfExtents: { x: 5.4, y: 0.8, z: 5 } },
    // Platform C: top y=1.6, z 62..76 (second hop; gap 58..62).
    { center: { x: 0, y: 0, z: 69 }, halfExtents: { x: 5.4, y: 1.6, z: 7 } },
    // Landing D: top y=0, z 81.5..100 (gap 76..81.5, 5.5 u).
    { center: { x: 0, y: -0.5, z: 90.75 }, halfExtents: { x: 5.4, y: 0.5, z: 9.25 } },
    // Wall blocking the screen-right lane (forced lane change, copied pattern).
    { center: { x: -2.925, y: 2.0, z: 92 }, halfExtents: { x: 0.975, y: 2.0, z: 0.5 } },
    // Weave runway E: top y=0, z 100..150.
    { center: { x: 0, y: -0.5, z: 125 }, halfExtents: { x: 5.4, y: 0.5, z: 25 } },
    // Landing F: top y=0, z 155..176 (gap 150..155, 5 u).
    { center: { x: 0, y: -0.5, z: 165.5 }, halfExtents: { x: 5.4, y: 0.5, z: 10.5 } },

    // --- ACT II: transform / build (ceiling world) ---
    // Ceiling slab A: underside y=6, z 174..230 (rise landing ~177).
    { center: { x: 0, y: 7, z: 202 }, halfExtents: { x: 5.4, y: 1, z: 28 } },
    // Ceiling slab B: underside y=6, z 235..244 (gap 230..235, 5 u jump).
    { center: { x: 0, y: 7, z: 239.5 }, halfExtents: { x: 5.4, y: 1, z: 4.5 } },
    // Ceiling slab C: underside y=6, z 252..300 (pad gap 244..252, 8 u).
    { center: { x: 0, y: 7, z: 276 }, halfExtents: { x: 5.4, y: 1, z: 24 } },
    // Floor runway D: top y=0, z 262..316 (orb-flip landing ~289).
    { center: { x: 0, y: -0.5, z: 289 }, halfExtents: { x: 5.4, y: 0.5, z: 27 } },
    // Runway E: top y=0, z 324..350 (pad landing ~325.8; pad gap 316..324).
    { center: { x: 0, y: -0.5, z: 337 }, halfExtents: { x: 5.4, y: 0.5, z: 13 } },
    // Runway F: top y=0, z 360..400 (orb landing ~361.8; orb gap 350..360).
    { center: { x: 0, y: -0.5, z: 380 }, halfExtents: { x: 5.4, y: 0.5, z: 20 } },
    // Ceiling slab D: underside y=6, z 388..420 (short inversion callback).
    { center: { x: 0, y: 7, z: 404 }, halfExtents: { x: 5.4, y: 1, z: 16 } },
    // Runway G: top y=0, z 400..470 (portal-down landing ~421).
    { center: { x: 0, y: -0.5, z: 435 }, halfExtents: { x: 5.4, y: 0.5, z: 35 } },

    // --- ACT III: climax / release ---
    // Runway H: top y=0, z 470..518 (1x closing weave).
    { center: { x: 0, y: -0.5, z: 494 }, halfExtents: { x: 5.4, y: 0.5, z: 24 } },
    // Runway I1: top y=0, z 518..540 (2x takeoff).
    { center: { x: 0, y: -0.5, z: 529 }, halfExtents: { x: 5.4, y: 0.5, z: 11 } },
    // Runway I2: top y=0, z 551..648 (2x sprint; gap 540..551, 11 u).
    { center: { x: 0, y: -0.5, z: 599.5 }, halfExtents: { x: 5.4, y: 0.5, z: 48.5 } },
    // Runway J: top y=0, z 648..684 (1x release + finish at 680).
    { center: { x: 0, y: -0.5, z: 666 }, halfExtents: { x: 5.4, y: 0.5, z: 18 } },
  ],

  hazards: [
    // Act I weave: safe screen-right (row z=30), safe screen-left (z=112),
    // safe center (z=126) — asymmetric, single taps.
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 30 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 30 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 112 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 112 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 126 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 126 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Ceiling lane commitment: spikes mounted on the run surface (the same
    // cone language as floor spikes, base flush with the ceiling underside:
    // the visible cone below y=6 matches the gameplay box exactly). A lane
    // answer is required — jumping under them also works (fair either way).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 5.75, z: 200 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 5.75, z: 216 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 5.75, z: 216 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Callback ceiling spike (center lane, z=402).
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 5.75, z: 402 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // Act III 1x weave: safe center (z=480), safe screen-right (z=494).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 480 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 480 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 494 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 494 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    // 2x sprint weave: hold screen-right (z=580), then commit screen-left (z=610).
    { kind: 'hazard', visual: 'spike', center: { x: 2.6, y: 0.25, z: 580 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 580 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: 0, y: 0.25, z: 610 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
    { kind: 'hazard', visual: 'spike', center: { x: -2.6, y: 0.25, z: 610 }, halfExtents: { x: 0.5, y: 0.25, z: 0.5 } },
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
   * M7 authored visual arc (real art direction for the slice, not a proof):
   * violet/cyan opening → deep-blue inversion → violet combination →
   * high-energy 2x sprint → calm release. Player/hazard identities are
   * structurally stable (no such fields exist); fingerprint-excluded.
   */
  visualSequence: {
    sections: [
      { id: 'vs-opening', startZ: -10, endZ: 170, blendIn: 1, overrides: {} },
      {
        id: 'vs-inversion',
        startZ: 170,
        endZ: 300,
        blendIn: 24,
        overrides: {
          background: 0x050214,
          fogColor: 0x0d1a33,
          exposure: 1.08,
          environmentIntensity: 0.9,
          vfxIntensity: 0.95,
        },
      },
      {
        id: 'vs-combination',
        startZ: 300,
        endZ: 518,
        blendIn: 20,
        overrides: {
          background: 0x0a0518,
          fogColor: 0x1a0d2e,
          routeAccent: 0x7d4dff,
          environmentIntensity: 1.2,
          vfxIntensity: 1.15,
        },
      },
      {
        id: 'vs-sprint',
        startZ: 518,
        endZ: 648,
        blendIn: 10,
        overrides: {
          bloomStrength: 0.55,
          exposure: 1.2,
          vfxIntensity: 1.25,
          streakIntensity: 1.5,
        },
      },
      {
        id: 'vs-release',
        startZ: 648,
        endZ: 690,
        blendIn: 8,
        overrides: {
          bloomStrength: 0.45,
          exposure: 1.1,
          environmentIntensity: 0.9,
          vfxIntensity: 0.9,
          streakIntensity: 0.8,
        },
      },
    ],
  },
};
