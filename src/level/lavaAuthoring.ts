import type { LevelDefinition, LavaVolumeDef } from './levelDefinition';

/**
 * Lava authoring validation (M8A): every lava composition must make physical
 * sense — sourced, channeled, contained. No floating slabs.
 *
 * Rules (all AABB touch/overlap tests with a small epsilon skin):
 *  1. Every `pool` touches or overlaps at least one solid (basin floor or
 *     rim wall — the pool is visibly contained, never floating).
 *  2. Every `source` touches or overlaps at least one solid (the vent is
 *     attached to rock, never floating).
 *  3. Every `fall` touches a `source`, a `pool` (spillover lip), or a
 *     solid at/above its top AND (touches a `pool` (or a solid)
 *     at/below its bottom OR extends below the level's `deathY` —
 *     visibly continuing into the void).
 *  4. Every `source` shows a working mouth (M8.2): the glowing mouth
 *     rendered on the vent's lower face must not be buried inside rock
 *     — a mouth glowing inside a pillar is invisible and the lava
 *     reads as sourceless. Vents sit proud of their rock with the
 *     mouth feeding air or the fall below.
 *  5. Every `flow`-hinted `pool` continues downstream (M8.4): it must
 *     touch or overlap another lava volume whose center lies strictly
 *     downstream along the hint — a directed flow that dead-ends in
 *     rock reads as a broken pour. (Upstream feeding stays covered by
 *     rules 2–3 on the vent/fall side.)
 *
 * Pure function of level data (no sim, no THREE). Returns human-readable
 * error strings; empty = valid. Production levels must validate cleanly
 * (pinned by `tests/lava.test.ts`).
 */

const TOUCH_EPSILON = 0.05;

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

const lavaBox = (l: LavaVolumeDef): Box => ({
  minX: l.center.x - l.halfExtents.x,
  maxX: l.center.x + l.halfExtents.x,
  minY: l.center.y - l.halfExtents.y,
  maxY: l.center.y + l.halfExtents.y,
  minZ: l.center.z - l.halfExtents.z,
  maxZ: l.center.z + l.halfExtents.z,
});

const solidBox = (s: { center: { x: number; y: number; z: number }; halfExtents: { x: number; y: number; z: number } }): Box => ({
  minX: s.center.x - s.halfExtents.x,
  maxX: s.center.x + s.halfExtents.x,
  minY: s.center.y - s.halfExtents.y,
  maxY: s.center.y + s.halfExtents.y,
  minZ: s.center.z - s.halfExtents.z,
  maxZ: s.center.z + s.halfExtents.z,
});

/** True when the boxes touch or overlap (epsilon skin on every face). */
const touches = (a: Box, b: Box): boolean =>
  a.minX <= b.maxX + TOUCH_EPSILON &&
  a.maxX >= b.minX - TOUCH_EPSILON &&
  a.minY <= b.maxY + TOUCH_EPSILON &&
  a.maxY >= b.minY - TOUCH_EPSILON &&
  a.minZ <= b.maxZ + TOUCH_EPSILON &&
  a.maxZ >= b.minZ - TOUCH_EPSILON;

/**
 * True when `other` feeds the TOP of `fall`: it reaches down to (or into)
 * the fall's top face while overlapping the fall's X/Z footprint.
 */
const feedsTop = (fall: Box, other: Box): boolean => {
  const footprint =
    fall.minX <= other.maxX + TOUCH_EPSILON &&
    fall.maxX >= other.minX - TOUCH_EPSILON &&
    fall.minZ <= other.maxZ + TOUCH_EPSILON &&
    fall.maxZ >= other.minZ - TOUCH_EPSILON;
  if (!footprint) return false;
  return other.minY <= fall.maxY + TOUCH_EPSILON && other.maxY >= fall.maxY - TOUCH_EPSILON;
};

/**
 * True when `other` receives the BOTTOM of `fall`: it reaches up to (or
 * into) the fall's bottom face while overlapping the fall's X/Z footprint.
 */
const receivesBottom = (fall: Box, other: Box): boolean => {
  const footprint =
    fall.minX <= other.maxX + TOUCH_EPSILON &&
    fall.maxX >= other.minX - TOUCH_EPSILON &&
    fall.minZ <= other.maxZ + TOUCH_EPSILON &&
    fall.maxZ >= other.minZ - TOUCH_EPSILON;
  if (!footprint) return false;
  return other.maxY >= fall.minY - TOUCH_EPSILON && other.minY <= fall.minY + TOUCH_EPSILON;
};

/** True when the volume carries a non-zero presentation flow hint. */
const hasFlow = (l: LavaVolumeDef): boolean =>
  l.flow !== undefined && (l.flow.x !== 0 || l.flow.z !== 0);

/** True when the point lies strictly inside the box (epsilon shrink). */
const strictlyInside = (
  p: { x: number; y: number; z: number },
  b: Box,
): boolean =>
  p.x > b.minX + TOUCH_EPSILON &&
  p.x < b.maxX - TOUCH_EPSILON &&
  p.y > b.minY + TOUCH_EPSILON &&
  p.y < b.maxY - TOUCH_EPSILON &&
  p.z > b.minZ + TOUCH_EPSILON &&
  p.z < b.maxZ - TOUCH_EPSILON;

/**
 * Shared lava-link geometry (M8.4): the renderer reuses the exact rule-3
 * predicates so flow features (pour pulses, lips, chimneys) attach to
 * the same links the validator enforces — one concept, one owner.
 */

/** True when `other` feeds the TOP of the fall `f` (pour-over link). */
export const lavaFeedsFallTop = (f: LavaVolumeDef, other: LavaVolumeDef): boolean =>
  feedsTop(lavaBox(f), lavaBox(other));

/** True when `other` receives the BOTTOM of the fall `f` (catch link). */
export const lavaReceivesFallBottom = (f: LavaVolumeDef, other: LavaVolumeDef): boolean =>
  receivesBottom(lavaBox(f), lavaBox(other));

export const validateLavaAuthoring = (def: LevelDefinition): string[] => {
  const errors: string[] = [];
  const lava = def.lava ?? [];
  if (lava.length === 0) return errors;

  const solidBoxes = def.solids.map(solidBox);
  const lavaBoxes = new Map<string, Box>();
  for (const l of lava) lavaBoxes.set(l.id, lavaBox(l));

  for (const l of lava) {
    const box = lavaBoxes.get(l.id);
    if (box === undefined) continue;
    if (l.role === 'pool') {
      const contained = solidBoxes.some((s) => touches(box, s));
      if (!contained) {
        errors.push(`lava pool '${l.id}' touches no solid (floating slab — contain it in a basin)`);
      }
      if (hasFlow(l)) {
        // M8.4 directed flow: the pool must hand off to a downstream
        // lava volume (the next link — channel, basin, or the fall that
        // carries it over the edge). Touch/overlap keeps the pour
        // continuous; the downstream-center test keeps it directed.
        const f = l.flow as { x: number; z: number };
        const downstream = lava.some((o) => {
          if (o.id === l.id) return false;
          const ob = lavaBoxes.get(o.id);
          if (ob === undefined) return false;
          const dx = o.center.x - l.center.x;
          const dz = o.center.z - l.center.z;
          if (dx * f.x + dz * f.z <= TOUCH_EPSILON) return false;
          return touches(box, ob);
        });
        if (!downstream) {
          errors.push(
            `lava pool '${l.id}' carries a flow hint but touches no lava downstream (directed pour must continue — link a channel, basin, or drop)`,
          );
        }
      }
    } else if (l.role === 'source') {
      const attached = solidBoxes.some((s) => touches(box, s));
      if (!attached) {
        errors.push(`lava source '${l.id}' touches no solid (floating vent — attach it to rock)`);
      } else {
        // M8.2 working mouth: mirrors the render (mouth inset on the
        // vent's lower face) — a mouth buried in rock never reads.
        const mouth = {
          x: l.center.x,
          y: l.center.y - l.halfExtents.y - 0.01,
          z: l.center.z,
        };
        const buried = solidBoxes.some((s) => strictlyInside(mouth, s));
        if (buried) {
          errors.push(
            `lava source '${l.id}' mouth is buried in solid (invisible vent — sit it proud of the rock, feeding the fall)`,
          );
        }
      }
    } else {
      // Fall: needs a feeder above and a receiver below (or the void).
      // Feeders are sources, solids, AND pools (M8.4 spillover: a
      // channel surface pouring over an edge feeds the drop below it).
      let fed = solidBoxes.some((s) => feedsTop(box, s));
      if (!fed) {
        for (const other of lava) {
          if (other.id === l.id || (other.role !== 'source' && other.role !== 'pool')) continue;
          const ob = lavaBoxes.get(other.id);
          if (ob !== undefined && feedsTop(box, ob)) {
            fed = true;
            break;
          }
        }
      }
      if (!fed) {
        errors.push(`lava fall '${l.id}' has no source/solid feeding its top (unsupported stream)`);
      }
      const continuesBelowVoid = box.minY <= def.deathY + TOUCH_EPSILON;
      let received = continuesBelowVoid;
      if (!received) {
        received = solidBoxes.some((s) => receivesBottom(box, s));
      }
      if (!received) {
        for (const other of lava) {
          if (other.id === l.id || other.role !== 'pool') continue;
          const ob = lavaBoxes.get(other.id);
          if (ob !== undefined && receivesBottom(box, ob)) {
            received = true;
            break;
          }
        }
      }
      if (!received) {
        errors.push(`lava fall '${l.id}' terminates mid-air (must end in a pool, a basin, or below deathY)`);
      }
    }
  }
  return errors;
};
