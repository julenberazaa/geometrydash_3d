import type { Vec3 } from '../core/math';
import { vec3, copyVec3 } from '../core/math';
import type { Aabb, Collider } from './collider';
import { colliderToAabb, sweepAxis } from './collider';
import type { CollisionWorld } from './CollisionWorld';

/**
 * Axis-separated swept movement of an AABB through the collision world.
 *
 * Order per step: Y first (gravity / landing), then Z (forward), then X (lateral).
 * Each axis' motion is clipped against solids using exact swept queries, so no
 * combination of speeds can tunnel through a static box within one step —
 * including future 4x speed portals and thin walls.
 *
 * Blocking kinds are `solid` AND `killFront` (identical movement blocking and
 * ground support; the frontal-kill decision lives in GameSimulation and is
 * derived from contact normal + approach motion, never from kind alone).
 * `hazard` never blocks — it is overlap-tested by the simulation.
 *
 * Determinism: per axis the strictly smallest time-of-impact wins; ties keep
 * the first candidate in world query order (cell-index order, then level
 * insertion order) — deterministic for a fixed level definition.
 *
 * The caller owns `position`; it is advanced in place.
 */

export interface ContactSurface {
  readonly collider: Collider;
  /** Normal pointing away from the solid toward the player. */
  readonly normal: Vec3;
}

export interface MoveResult {
  /** True when downward (-gravity-axis) motion was blocked by a solid. */
  hitFloor: boolean;
  /** True when upward (+gravity-opposed) motion was blocked. */
  hitCeiling: boolean;
  floorContact: ContactSurface | null;
  ceilingContact: ContactSurface | null;
  /** Wall contacts from Z/X clipping (normals horizontal). */
  wallContacts: ContactSurface[];
  /** Position after the Y clip (== start position when delta.y === 0).
   *  Reused scratch: together with the caller's pre-step position and the
   *  final position these define the authoritative swept path
   *  (prev → afterY → afterZ → final) for exact hazard overlap tests. */
  positionAfterY: Vec3;
  /** Position after the Z clip. Reused scratch, see `positionAfterY`. */
  positionAfterZ: Vec3;
}

export const createMoveResult = (): MoveResult => ({
  hitFloor: false,
  hitCeiling: false,
  floorContact: null,
  ceilingContact: null,
  wallContacts: [],
  positionAfterY: vec3(),
  positionAfterZ: vec3(),
});

const scratchCandidates: Collider[] = [];

/** Horizontal skin for support probes: prevents wall sides from counting as ground. */
const SUPPORT_SKIN = 0.02;
/** Tolerance above foot level that still counts as a valid support surface. */
const GROUND_SURFACE_EPSILON = 0.02;

function buildProbeBox(position: Readonly<Vec3>, half: Readonly<Vec3>, delta: Readonly<Vec3>): Aabb {
  return {
    minX: position.x + Math.min(0, delta.x) - half.x,
    maxX: position.x + Math.max(0, delta.x) + half.x,
    minY: position.y + Math.min(0, delta.y) - half.y,
    maxY: position.y + Math.max(0, delta.y) + half.y,
    minZ: position.z + Math.min(0, delta.z) - half.z,
    maxZ: position.z + Math.max(0, delta.z) + half.z,
  };
}

/** Sweep one axis against blocking candidates; returns clipped toi (<=1) and best contact. */
function clipAxis(
  candidates: readonly Collider[],
  position: Readonly<Vec3>,
  half: Readonly<Vec3>,
  axis: 'x' | 'y' | 'z',
  amount: number,
): { toi: number; collider: Collider | null } {
  let bestToi = 1;
  let bestCollider: Collider | null = null;
  for (const c of candidates) {
    if (c.kind !== 'solid' && c.kind !== 'killFront') continue;
    const hit = sweepAxis(position, half, axis, amount, colliderToAabb(c));
    if (hit && hit.toi < bestToi) {
      bestToi = hit.toi;
      bestCollider = c;
    }
  }
  return { toi: bestToi, collider: bestCollider };
}

export function moveAabbThroughWorld(
  world: CollisionWorld,
  position: Vec3,
  halfExtents: Readonly<Vec3>,
  delta: Readonly<Vec3>,
  result: MoveResult,
): void {
  result.hitFloor = false;
  result.hitCeiling = false;
  result.floorContact = null;
  result.ceilingContact = null;
  result.wallContacts.length = 0;

  world.queryBox(buildProbeBox(position, halfExtents, delta), scratchCandidates);

  // --- Y axis (gravity / landing) ---
  if (delta.y !== 0) {
    const y = clipAxis(scratchCandidates, position, halfExtents, 'y', delta.y);
    position.y += delta.y * y.toi;
    if (y.collider !== null) {
      if (delta.y < 0) {
        result.hitFloor = true;
        result.floorContact = { collider: y.collider, normal: vec3(0, 1, 0) };
      } else {
        result.hitCeiling = true;
        result.ceilingContact = { collider: y.collider, normal: vec3(0, -1, 0) };
      }
    }
  }
  copyVec3(result.positionAfterY, position);

  // --- Z axis (auto-forward) ---
  if (delta.z !== 0) {
    const z = clipAxis(scratchCandidates, position, halfExtents, 'z', delta.z);
    position.z += delta.z * z.toi;
    if (z.collider !== null) {
      result.wallContacts.push({
        collider: z.collider,
        normal: vec3(0, 0, delta.z > 0 ? -1 : 1),
      });
    }
  }
  copyVec3(result.positionAfterZ, position);

  // --- X axis (lateral lane motion) ---
  if (delta.x !== 0) {
    const x = clipAxis(scratchCandidates, position, halfExtents, 'x', delta.x);
    position.x += delta.x * x.toi;
    if (x.collider !== null) {
      result.wallContacts.push({
        collider: x.collider,
        normal: vec3(delta.x > 0 ? -1 : 1, 0, 0),
      });
    }
  }
}

/**
 * Ground support probe: is there solid ground within `probeDistance` below the box?
 * Used for stable grounded state even when vertical velocity is exactly zero
 * (no Y sweep occurs that step, but the player must remain "grounded").
 */
export function probeGroundSupport(
  world: CollisionWorld,
  position: Readonly<Vec3>,
  halfExtents: Readonly<Vec3>,
  probeDistance: number,
): ContactSurface | null {
  const feetY = position.y - halfExtents.y;
  const probeBox: Aabb = {
    minX: position.x - halfExtents.x + SUPPORT_SKIN,
    maxX: position.x + halfExtents.x - SUPPORT_SKIN,
    minY: feetY - probeDistance,
    maxY: feetY + GROUND_SURFACE_EPSILON,
    minZ: position.z - halfExtents.z,
    maxZ: position.z + halfExtents.z,
  };
  const candidates: Collider[] = [];
  world.queryBox(probeBox, candidates);
  let closest: ContactSurface | null = null;
  let closestDepth = Infinity;
  for (const c of candidates) {
    if (c.kind !== 'solid' && c.kind !== 'killFront') continue;
    const b = colliderToAabb(c);
    const horizontalOverlap =
      probeBox.minX < b.maxX &&
      probeBox.maxX > b.minX &&
      probeBox.minZ < b.maxZ &&
      probeBox.maxZ > b.minZ;
    if (!horizontalOverlap) continue;
    // Candidate support surface height must sit at (or barely above) foot level
    // and within probe distance below the feet.
    if (b.maxY > probeBox.maxY || b.maxY < probeBox.minY) continue;
    const depth = feetY - b.maxY;
    if (depth < closestDepth) {
      closestDepth = depth;
      closest = { collider: c, normal: vec3(0, 1, 0) };
    }
  }
  return closest;
}
