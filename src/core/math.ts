/**
 * Small gameplay-math utilities used by the simulation.
 * Deliberately THREE-free so the simulation runs headless in tests.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const cloneVec3 = (v: Readonly<Vec3>): Vec3 => ({ x: v.x, y: v.y, z: v.z });

export const copyVec3 = (target: Vec3, src: Readonly<Vec3>): void => {
  target.x = src.x;
  target.y = src.y;
  target.z = src.z;
};

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Frame-rate independent exponential damping factor for render-side smoothing.
 * lambda is the smoothing rate (higher = snappier).
 */
export const dampFactor = (lambda: number, dt: number): number => 1 - Math.exp(-lambda * dt);

export const approxEqual = (a: number, b: number, epsilon: number): boolean =>
  Math.abs(a - b) <= epsilon;

/** Deterministic PRNG (mulberry32) for procedural *visual* dressing only. Never for gameplay. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
