import type { Collider } from '../collision/collider';
import type {
  GravityOrbDef,
  GravityPortalDef,
  JumpOrbDef,
  JumpPadDef,
  LevelDefinition,
  SpeedPortalDef,
} from './levelDefinition';
import type { GravityMode } from '../player/playerState';
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
  /** Level start gravity mode ('floor' when the level omits it). */
  startGravityMode: GravityMode;
  /** Level start speed multiplier (1 when the level omits it). */
  startSpeedMultiplier: number;
  /** Gravity portals sorted by ascending Z (portal processing order). */
  gravityPortals: readonly GravityPortalDef[];
  /** Speed portals sorted by ascending Z (processed before gravity portals). */
  speedPortals: readonly SpeedPortalDef[];
  /** Jump pads in level definition order (passive contact interactions). */
  jumpPads: readonly JumpPadDef[];
  /** Jump orbs in level definition order (active press interactions). */
  jumpOrbs: readonly JumpOrbDef[];
  /** Gravity orbs in level definition order (active press interactions). */
  gravityOrbs: readonly GravityOrbDef[];
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

  const gravityPortals = [...(def.gravityPortals ?? [])].sort((a, b) => a.z - b.z);
  const speedPortals = [...(def.speedPortals ?? [])].sort((a, b) => a.z - b.z);

  return {
    def,
    world,
    colliders,
    laneCenters: def.laneCenters,
    start: def.start,
    startGravityMode: def.startGravityMode ?? 'floor',
    startSpeedMultiplier: def.startSpeedMultiplier ?? 1,
    gravityPortals,
    speedPortals,
    jumpPads: def.jumpPads ?? [],
    jumpOrbs: def.jumpOrbs ?? [],
    gravityOrbs: def.gravityOrbs ?? [],
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
