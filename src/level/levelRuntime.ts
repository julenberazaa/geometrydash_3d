import type { Collider } from '../collision/collider';
import type { LevelDefinition } from './levelDefinition';
import { CollisionWorld } from '../collision/CollisionWorld';
import type { Vec3 } from '../core/math';
import { vec3 } from '../core/math';

export interface LoadedLevel {
  def: LevelDefinition;
  world: CollisionWorld;
  /** Flat collider list in definition order (solids then hazards). */
  colliders: Collider[];
  laneCenters: readonly number[];
  start: Readonly<Vec3>;
}

/** Build runtime collision data from a declarative level. Pure: no THREE, no DOM. */
export const loadLevel = (def: LevelDefinition): LoadedLevel => {
  const colliders: Collider[] = [];
  let index = 0;
  for (const s of def.solids) {
    colliders.push({
      id: `solid-${index++}`,
      kind: 'solid',
      center: vec3(s.center.x, s.center.y, s.center.z),
      halfExtents: vec3(s.halfExtents.x, s.halfExtents.y, s.halfExtents.z),
    });
  }
  for (const h of def.hazards) {
    colliders.push({
      id: `hazard-${index++}`,
      kind: h.kind,
      center: vec3(h.center.x, h.center.y, h.center.z),
      halfExtents: vec3(h.halfExtents.x, h.halfExtents.y, h.halfExtents.z),
    });
  }

  const world = new CollisionWorld(8);
  world.addAll(colliders);

  return {
    def,
    world,
    colliders,
    laneCenters: def.laneCenters,
    start: def.start,
  };
};

/**
 * Progress through the level as [0..1] from real forward distance:
 * (playerZ - startZ) / (finishZ - startZ), clamped.
 */
export const computeProgress = (
  playerZ: number,
  startZ: number,
  finishZ: number,
): number => {
  const total = finishZ - startZ;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (playerZ - startZ) / total));
};
