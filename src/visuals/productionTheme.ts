import type { LevelTheme } from '../level/levelDefinition';
import { PALETTE, SPEED_TIER_COLORS } from './palette';

/**
 * Production visual theme (M6A) — renderer-owned visual configuration.
 *
 * ONE owner for every purely-visual tuning value: palette, material
 * response, fog, lighting, tone mapping/exposure, and bloom. No scattered
 * magic constants in the view classes.
 *
 * Hierarchy (see specs/milestones/M6_VISUAL_PRODUCTION_SYSTEM.md):
 *   1. player (cyan — highest focal priority)
 *   2. hazards (warm orange — second priority, never bloom-hidden)
 *   3. playable route (dark body + violet/blue edge language)
 *   4. interactions (semantic accents per mechanic, never all one neon)
 *   5. environment (depth only — must not compete)
 *
 * Anti-goal: "neon everything". Dark surfaces stay dark; bloom reinforces
 * important edges instead of washing the scene (see BLOOM_CONTRACT).
 *
 * This type is presentation-only: `computeLevelFingerprint()` never reads
 * it, so re-theming keeps committed M5 replays compatible (pinned by
 * tests/visualFoundation.test.ts).
 */
export interface ProductionTheme {
  /** Scene background (near-black) + fog envelope. */
  background: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  /** Playable route: dark charcoal/blue body, readable surface plane. */
  routeBody: number;
  routeTop: number;
  /** Ceiling run surface (free-face parity with routeTop). */
  routeUnder: number;
  /** Neon edge-rail language (top rails + underside rails). */
  routeEdge: number;
  routeEdgeEmissiveIntensity: number;
  routeRoughness: number;
  routeMetalness: number;
  /** Player: cyan-dominant, bright free face, restrained emissive. */
  playerBody: number;
  playerFace: number;
  playerEdge: number;
  playerFaceEmissiveIntensity: number;
  playerBodyRoughness: number;
  playerBodyMetalness: number;
  /** Hazards: warm orange, crisp silhouette at every speed. */
  hazard: number;
  hazardEmissiveIntensity: number;
  /** Gravity portals: cyan = flip up, warm = flip down. */
  portalUp: number;
  portalDown: number;
  /** M4 interaction accents: yellow family = jump impulse, blue = gravity. */
  padJump: number;
  orbJump: number;
  orbGravity: number;
  interactionDim: number;
  speedTierColors: Readonly<Record<string, number>>;
  finishGate: number;
  starField: number;
  /** Minimum viable lighting: one hemisphere + one directional. No point
   *  lights — emissive/material design carries the neon response. */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  dirColor: number;
  dirIntensity: number;
  /** Tone mapping / exposure (applied on the WebGLRenderer, honored by the
   *  post pipeline's OutputPass and by the direct-render fallback alike). */
  exposure: number;
  /** Controlled bloom (see BLOOM_CONTRACT below). */
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  /** Device-pixel-ratio cap (perf headroom). */
  dprCap: number;
}

/**
 * Bloom contract (M6A): bloom must reinforce important edges, never wash
 * the scene. Enforced by tests/visualFoundation.test.ts.
 * - threshold HIGH (>= 0.6): dark route/environment never bloom.
 * - strength RESTRAINED (<= 0.7): edges glow, hazards/player stay crisp.
 * - radius bounded (<= 0.6): no giant halos, no full-screen purple wash.
 */
export const BLOOM_CONTRACT = {
  minThreshold: 0.6,
  maxStrength: 0.7,
  maxRadius: 0.6,
} as const;

/** Renderer color-management + performance configuration (single owner). */
export const RENDERER_CONFIG = {
  /** ACES gives the neon-on-dark response without white clipping. */
  toneMapping: 'ACESFilmic' as const,
  antialias: true,
  powerPreference: 'high-performance' as const,
  /** Post pipeline enabled by default; `?post=off` forces direct render
   *  (playable fallback — same scene, no composer passes). */
  enabledByDefault: true,
} as const;

/** Default production language: deep violet/blue route, cyan player,
 *  warm orange danger, near-black environment (normal.png direction). */
export const PRODUCTION_THEME: ProductionTheme = {
  background: 0x050309,
  fogColor: 0x120a24,
  fogNear: 30,
  fogFar: 130,
  routeBody: 0x181230,
  routeTop: 0x2a2152,
  routeUnder: 0x322a5c,
  routeEdge: 0xb44dff,
  routeEdgeEmissiveIntensity: 0.95,
  routeRoughness: 0.82,
  routeMetalness: 0.25,
  playerBody: 0x0e4a56,
  playerFace: 0x3fd8ff,
  playerEdge: 0x19e6ff,
  playerFaceEmissiveIntensity: 0.5,
  playerBodyRoughness: 0.3,
  playerBodyMetalness: 0.6,
  hazard: 0xff9d00,
  hazardEmissiveIntensity: 1.7,
  portalUp: PALETTE.portalUp,
  portalDown: PALETTE.portalDown,
  padJump: PALETTE.padJump,
  orbJump: PALETTE.orbJump,
  orbGravity: PALETTE.orbGravity,
  interactionDim: PALETTE.interactionDim,
  speedTierColors: SPEED_TIER_COLORS,
  finishGate: PALETTE.finishGate,
  starField: 0x6f5fb8,
  hemiSky: 0x8d6fff,
  hemiGround: 0x0b0616,
  hemiIntensity: 0.85,
  dirColor: 0xcfc4ff,
  dirIntensity: 1.5,
  exposure: 1.15,
  bloomStrength: 0.45,
  bloomRadius: 0.5,
  bloomThreshold: 0.8,
  dprCap: 1.5,
};

/**
 * Resolve the effective theme for a level: production defaults + the
 * level's legacy `LevelTheme` overlay (route identity only). This ACTIVATES
 * the previously renderer-ignored `LevelDefinition.theme` field — e.g.
 * validation-02 keeps its teal edge identity — while the shared production
 * language (player/hazard/interactions/bloom/exposure) stays identical
 * across levels. No engine special-case: same code path for every level.
 *
 * The overlay is renderer-only: it cannot change gameplay or the level
 * fingerprint (pinned by test).
 */
export const resolveProductionTheme = (def: { theme?: LevelTheme }): ProductionTheme => {
  const legacy = def.theme;
  if (legacy === undefined) return { ...PRODUCTION_THEME };
  return {
    ...PRODUCTION_THEME,
    background: legacy.background,
    fogColor: legacy.fogColor,
    fogNear: legacy.fogNear,
    fogFar: legacy.fogFar,
    routeBody: legacy.platform,
    routeTop: legacy.platformTop,
    routeEdge: legacy.edge,
    hazard: legacy.hazard,
  };
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Validate/normalize a candidate theme (sane defaults + clamps). Used by
 * tests and any future theme override path; the shipped game always starts
 * from PRODUCTION_THEME so this is a guard rail, not a hot path.
 */
export const validateProductionTheme = (
  candidate: Partial<ProductionTheme>,
): ProductionTheme => {
  const merged: ProductionTheme = { ...PRODUCTION_THEME, ...candidate };
  merged.exposure = clamp(merged.exposure, 0.5, 2);
  merged.bloomStrength = clamp(merged.bloomStrength, 0, BLOOM_CONTRACT.maxStrength);
  merged.bloomRadius = clamp(merged.bloomRadius, 0, BLOOM_CONTRACT.maxRadius);
  merged.bloomThreshold = clamp(merged.bloomThreshold, BLOOM_CONTRACT.minThreshold, 1);
  merged.dprCap = clamp(merged.dprCap, 1, 2);
  merged.fogNear = Math.max(1, merged.fogNear);
  merged.fogFar = Math.max(merged.fogNear + 1, merged.fogFar);
  merged.routeEdgeEmissiveIntensity = clamp(merged.routeEdgeEmissiveIntensity, 0, 4);
  merged.hazardEmissiveIntensity = clamp(merged.hazardEmissiveIntensity, 0, 4);
  merged.playerFaceEmissiveIntensity = clamp(merged.playerFaceEmissiveIntensity, 0, 4);
  return merged;
};
