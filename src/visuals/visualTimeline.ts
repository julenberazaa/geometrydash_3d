import type { ProductionTheme } from './productionTheme';
import { BLOOM_CONTRACT } from './productionTheme';
import type {
  VisualSection,
  VisualSectionOverride,
  VisualSequenceDefinition,
} from '../level/levelDefinition';

/**
 * Visual timeline controller (M6C1) — the ONE renderer-side owner that
 * computes CURRENT VISUAL STATE = BASE THEME + CURRENT SECTION +
 * TRANSITION INTERPOLATION.
 *
 * Position-driven, never wall-clock-driven: section identity derives ONLY
 * from the authoritative forward position (player Z). Same gameplay
 * location → same section on every machine and render FPS. Render-time
 * smoothing is just the blend interpolation below (presentation only).
 *
 * No accumulation, no drift: every evaluation is a pure function of
 * (base theme, sequence data, z) written into a caller-owned scratch
 * `VisualState` — `current = interpolate(prev, next, t)`, never
 * `current += delta`. Sampling forward/backward/repeatedly yields
 * bit-identical results (pinned by test).
 *
 * THREE-free by construction (colors interpolate as hex integers): the
 * simulation could never import this for gameplay even by accident, and
 * the module stays unit-testable without a GL context. Views apply the
 * resolved hex values with setHex.
 */

/** Fully-resolved per-frame presentation state (caller-owned scratch). */
export interface VisualState {
  sectionId: string;
  /** 0..1 progress of z within the active section's [startZ, endZ]. */
  sectionT: number;
  background: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  routeBody: number;
  routeSurface: number;
  routeAccent: number;
  environmentIntensity: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  exposure: number;
  vfxIntensity: number;
  streakIntensity: number;
}

/** Cold-path sorted copy of a sequence (evaluation assumes startZ order). */
export type PreparedVisualSequence = readonly VisualSection[];

/**
 * Prepare a level's optional sequence for evaluation: sorted copy by
 * startZ (stable). Cold path — RendererHost calls once per level load.
 */
export const prepareVisualSequence = (
  seq: VisualSequenceDefinition | undefined,
): PreparedVisualSequence => {
  if (seq === undefined) return [];
  return [...seq.sections].sort((a, b) => a.startZ - b.startZ);
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpChannel = (a: number, b: number, t: number): number =>
  Math.round(lerp(a, b, t));

/** Deterministic RGB-space hex interpolation (no THREE dependency). */
export const lerpHex = (a: number, b: number, t: number): number => {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (lerpChannel(ar, br, t) << 16) |
    (lerpChannel(ag, bg, t) << 8) |
    lerpChannel(ab, bb, t)
  );
};

const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

const writeBase = (base: ProductionTheme, out: VisualState, sectionId: string): void => {
  out.sectionId = sectionId;
  out.sectionT = 0;
  out.background = base.background;
  out.fogColor = base.fogColor;
  out.fogNear = base.fogNear;
  out.fogFar = base.fogFar;
  out.routeBody = base.routeBody;
  out.routeSurface = base.routeTop;
  out.routeAccent = base.routeEdge;
  out.environmentIntensity = 1;
  out.bloomStrength = base.bloomStrength;
  out.bloomRadius = base.bloomRadius;
  out.bloomThreshold = base.bloomThreshold;
  out.exposure = base.exposure;
  out.vfxIntensity = 1;
  out.streakIntensity = 1;
};

/**
 * Restore the exact M6A+M6B baseline into `out` through the SAME code path
 * as evaluation (structural guarantee: triggers-off === base, never an
 * approximation). The RendererHost applies this to every owned system when
 * triggers disable so no stale section state can remain.
 */
export const resetVisualState = (base: ProductionTheme, out: VisualState): void => {
  writeBase(base, out, 'base');
};

const numField = (
  prev: number | undefined,
  next: number | undefined,
  base: number,
  t: number,
): number => {
  const p = prev ?? base;
  return lerp(p, next ?? p, t);
};

const hexField = (
  prev: number | undefined,
  next: number | undefined,
  base: number,
  t: number,
): number => {
  const p = prev ?? base;
  return lerpHex(p, next ?? p, t);
};

/**
 * Evaluate the timeline at forward position `z` into caller-owned `out`.
 * Zero allocation; deterministic in (base, sections, z).
 */
export const evaluateVisualSequence = (
  base: ProductionTheme,
  sections: PreparedVisualSequence,
  z: number,
  out: VisualState,
): void => {
  let active = -1;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s === undefined) continue;
    if (s.startZ <= z) active = i;
    else break; // prepared order: startZ ascending
  }
  if (active < 0) {
    writeBase(base, out, 'base');
    return;
  }
  const sec = sections[active];
  if (sec === undefined) {
    writeBase(base, out, 'base');
    return;
  }
  const prev: VisualSectionOverride = active > 0 ? (sections[active - 1]?.overrides ?? {}) : {};
  const next: VisualSectionOverride = sec.overrides;
  const blendIn = Math.max(0, sec.blendIn ?? 10);
  const t = smooth(blendIn <= 0 ? 1 : (z - sec.startZ) / blendIn);

  out.sectionId = sec.id;
  out.sectionT = sec.endZ > sec.startZ ? clamp01((z - sec.startZ) / (sec.endZ - sec.startZ)) : 1;
  out.background = hexField(prev.background, next.background, base.background, t);
  out.fogColor = hexField(prev.fogColor, next.fogColor, base.fogColor, t);
  out.fogNear = Math.max(1, numField(prev.fogNear, next.fogNear, base.fogNear, t));
  out.fogFar = numField(prev.fogFar, next.fogFar, base.fogFar, t);
  if (out.fogFar < out.fogNear + 1) out.fogFar = out.fogNear + 1;
  out.routeBody = hexField(prev.routeBody, next.routeBody, base.routeBody, t);
  out.routeSurface = hexField(prev.routeSurface, next.routeSurface, base.routeTop, t);
  out.routeAccent = hexField(prev.routeAccent, next.routeAccent, base.routeEdge, t);
  out.environmentIntensity = clamp(numField(prev.environmentIntensity, next.environmentIntensity, 1, t), 0, 2);
  // Timeline bloom overrides MUST obey the M6A bloom contract (pinned).
  out.bloomStrength = clamp(
    numField(prev.bloomStrength, next.bloomStrength, base.bloomStrength, t),
    0,
    BLOOM_CONTRACT.maxStrength,
  );
  out.bloomRadius = clamp(
    numField(prev.bloomRadius, next.bloomRadius, base.bloomRadius, t),
    0,
    BLOOM_CONTRACT.maxRadius,
  );
  out.bloomThreshold = clamp(
    numField(prev.bloomThreshold, next.bloomThreshold, base.bloomThreshold, t),
    BLOOM_CONTRACT.minThreshold,
    1,
  );
  out.exposure = clamp(numField(prev.exposure, next.exposure, base.exposure, t), 0.5, 2);
  out.vfxIntensity = clamp(numField(prev.vfxIntensity, next.vfxIntensity, 1, t), 0, 2);
  out.streakIntensity = clamp(numField(prev.streakIntensity, next.streakIntensity, 1, t), 0, 2);
};

/** Fresh scratch state (cold paths + tests only; the host reuses one). */
export const makeVisualState = (): VisualState => ({
  sectionId: 'base',
  sectionT: 0,
  background: 0x000000,
  fogColor: 0x000000,
  fogNear: 30,
  fogFar: 130,
  routeBody: 0x000000,
  routeSurface: 0x000000,
  routeAccent: 0x000000,
  environmentIntensity: 1,
  bloomStrength: 0.45,
  bloomRadius: 0.5,
  bloomThreshold: 0.8,
  exposure: 1.15,
  vfxIntensity: 1,
  streakIntensity: 1,
});
