import type { ColliderKind } from '../collision/collider';
import type { Vec3 } from '../core/math';

/**
 * Declarative level content. Engine behavior lives in code; THIS is data.
 * A future level = a new file here + zero engine changes (spec §21).
 */

/** Visual theme values consumed by the rendering layer only. */
export interface LevelTheme {
  background: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  platform: number;
  platformTop: number;
  edge: number;
  hazard: number;
}

/** One declarative solid box. */
export interface LevelSolid {
  kind?: Extract<ColliderKind, 'solid'>;
  center: Vec3;
  halfExtents: Vec3;
}

/** One declarative hazard box. */
export interface LevelHazard {
  kind: Extract<ColliderKind, 'hazard' | 'killFront'>;
  center: Vec3;
  halfExtents: Vec3;
  /** Visual style hint consumed by rendering (e.g. spike vs block). */
  visual?: 'spike' | 'block';
}

export interface LevelDefinition {
  id: string;
  displayName: string;
  /** World-space player start (hitbox center). */
  start: Vec3;
  /** Initial lane index. */
  startLaneIndex: number;
  /** Lane centers along X. Length defines laneCount; do not hardcode 3 in engine code. */
  laneCenters: number[];
  /** Base forward speed for this level. */
  baseForwardSpeed: number;
  /** Z beyond which the run is complete. */
  finishZ: number;
  /** Death plane relative to world Y; falling below = death. */
  deathY: number;
  solids: LevelSolid[];
  hazards: LevelHazard[];
  theme: LevelTheme;
}
