import type { Vec3 } from '../core/math';

/**
 * Explicit gameplay collider categories.
 * Visual geometry is NEVER the collider; colliders are pure gameplay data
 * (see ARCHITECTURE.md). Non-solid future categories (triggers, portals) will
 * live outside solid queries rather than changing call sites.
 */
export type ColliderKind = 'solid' | 'hazard' | 'killFront';

export interface Collider {
  /** Stable identifier within the level. */
  readonly id: string;
  readonly kind: ColliderKind;
  /** Center of the box in world space. */
  readonly center: Vec3;
  /** Full half extents (x = width/2, y = height/2, z = depth/2). */
  readonly halfExtents: Vec3;
}

export interface Aabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export const colliderToAabb = (c: Readonly<Collider>): Aabb => ({
  minX: c.center.x - c.halfExtents.x,
  maxX: c.center.x + c.halfExtents.x,
  minY: c.center.y - c.halfExtents.y,
  maxY: c.center.y + c.halfExtents.y,
  minZ: c.center.z - c.halfExtents.z,
  maxZ: c.center.z + c.halfExtents.z,
});

export const translateAabb = (
  out: Aabb,
  box: Readonly<Aabb>,
  byX: number,
  byY: number,
  byZ: number,
): void => {
  out.minX = box.minX + byX;
  out.maxX = box.maxX + byX;
  out.minY = box.minY + byY;
  out.maxY = box.maxY + byY;
  out.minZ = box.minZ + byZ;
  out.maxZ = box.maxZ + byZ;
};

export const aabbOverlap = (a: Readonly<Aabb>, b: Readonly<Aabb>): boolean =>
  a.minX < b.maxX &&
  a.maxX > b.minX &&
  a.minY < b.maxY &&
  a.maxY > b.minY &&
  a.minZ < b.maxZ &&
  a.maxZ > b.minZ;

/**
 * Exact swept-volume box of an AABB translated from `from` to `to` along a
 * SINGLE axis: the min/max envelope of the two endpoint cubes. For one-axis
 * motion every swept point lies in this envelope and every envelope point is
 * swept through, so overlap against this box is EXACT — no iteration. With
 * multi-axis deltas this degenerates to the loose enclosing rectangle, which
 * is NOT the swept volume (its corner regions are never visited).
 * `out` is caller-owned scratch (hot loop: zero allocation).
 */
export function sweptSegmentAabb(
  out: Aabb,
  from: Readonly<Vec3>,
  to: Readonly<Vec3>,
  half: Readonly<Vec3>,
): void {
  out.minX = Math.min(from.x, to.x) - half.x;
  out.maxX = Math.max(from.x, to.x) + half.x;
  out.minY = Math.min(from.y, to.y) - half.y;
  out.maxY = Math.max(from.y, to.y) + half.y;
  out.minZ = Math.min(from.z, to.z) - half.z;
  out.maxZ = Math.max(from.z, to.z) + half.z;
}

export interface SweptPathScratch {
  y: Aabb;
  z: Aabb;
  x: Aabb;
}

export const createSweptPathScratch = (): SweptPathScratch => ({
  y: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
  z: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
  x: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
});

/**
 * True iff `target` overlaps ANY single-axis swept segment volume of the
 * authoritative Y → Z → X step path (prev → afterY → afterZ → final), where
 * the intermediate points include solid clipping (exactly the positions
 * `moveAabbThroughWorld` passes through). This is the exact hazard hit test:
 * start overlap (inside the Y segment box), end overlap (inside the X
 * segment box), and thin-hazard tunneling (each segment sweeps its full
 * displacement) are all covered by construction. `scratch` is caller-owned.
 */
export function sweptPathOverlaps(
  scratch: SweptPathScratch,
  prev: Readonly<Vec3>,
  afterY: Readonly<Vec3>,
  afterZ: Readonly<Vec3>,
  final: Readonly<Vec3>,
  half: Readonly<Vec3>,
  target: Readonly<Aabb>,
): boolean {
  sweptSegmentAabb(scratch.y, prev, afterY, half);
  sweptSegmentAabb(scratch.z, afterY, afterZ, half);
  sweptSegmentAabb(scratch.x, afterZ, final, half);
  return (
    aabbOverlap(scratch.y, target) ||
    aabbOverlap(scratch.z, target) ||
    aabbOverlap(scratch.x, target)
  );
}

/**
 * Exact single-axis swept query: does box B block A's translation of `amount`
 * along `axis` this step?
 *
 * Method: Minkowski-expand B by A's half extents, then solve the 1D slab
 * interval intersection for the motion segment [p, p+amount] on that axis,
 * requiring overlap on the two perpendicular axes. Exact for AABBs — no
 * iteration, fully deterministic.
 *
 * Returns the fraction [0..1] of `amount` at which A first touches B,
 * or null if B does not obstruct this axis' motion.
 * Overlap already present => toi 0.
 */
export function sweepAxis(
  aCenter: Readonly<Vec3>,
  aHalf: Readonly<Vec3>,
  axis: 'x' | 'y' | 'z',
  amount: number,
  b: Readonly<Aabb>,
): { toi: number } | null {
  // Perpendicular ranges of the expanded box relative to A's center line.
  let pMin: number, pMax: number, p: number, d: number;

  if (axis === 'x') {
    p = aCenter.x;
    d = amount;
    // Perpendicular Y/Z must already overlap the expanded slab region.
    if (
      aCenter.y - aHalf.y >= b.maxY || aCenter.y + aHalf.y <= b.minY ||
      aCenter.z - aHalf.z >= b.maxZ || aCenter.z + aHalf.z <= b.minZ
    ) {
      return null;
    }
    pMin = b.minX - aHalf.x;
    pMax = b.maxX + aHalf.x;
  } else if (axis === 'y') {
    p = aCenter.y;
    d = amount;
    if (
      aCenter.x - aHalf.x >= b.maxX || aCenter.x + aHalf.x <= b.minX ||
      aCenter.z - aHalf.z >= b.maxZ || aCenter.z + aHalf.z <= b.minZ
    ) {
      return null;
    }
    pMin = b.minY - aHalf.y;
    pMax = b.maxY + aHalf.y;
  } else {
    p = aCenter.z;
    d = amount;
    if (
      aCenter.x - aHalf.x >= b.maxX || aCenter.x + aHalf.x <= b.minX ||
      aCenter.y - aHalf.y >= b.maxY || aCenter.y + aHalf.y <= b.minY
    ) {
      return null;
    }
    pMin = b.minZ - aHalf.z;
    pMax = b.maxZ + aHalf.z;
  }

  // Already overlapping on the motion axis (expanded space).
  if (p > pMin && p < pMax) return { toi: 0 };

  if (d === 0) return null;

  // Distance from p to the near face in the direction of motion.
  const target = d > 0 ? pMin : pMax;
  const dist = target - p;
  if (d > 0 && dist < 0) return null; // moving away
  if (d < 0 && dist > 0) return null; // moving away

  const toi = dist / d; // in (0..1] because |dist| <= |d| when approaching
  if (toi < 0 || toi > 1) return null;
  return { toi };
}
