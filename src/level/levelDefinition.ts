import type { ColliderKind } from '../collision/collider';
import type { GravityMode } from '../player/playerState';
import type { Vec3 } from '../core/math';

/**
 * Declarative level content. Engine behavior lives in code; THIS is data.
 * A future level = a new file here + zero engine changes (spec §21).
 */

/**
 * Gravity transition portal (M3): a deterministic forward-crossing plane at
 * world Z spanning the route. When the player's Z crosses `z` in the forward
 * direction, gravity switches to `target`. One-shot per attempt by
 * construction (forward motion never revisits a plane; respawn re-arms it).
 */
export interface GravityPortalDef {
  /** Stable identifier (debug/QA). */
  id: string;
  /** World Z of the crossing plane. */
  z: number;
  /** Gravity mode to switch to when crossed. */
  target: GravityMode;
}

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
  /**
   * Lane centers along X, ordered by lane index. Convention (M1.1): index
   * increases toward screen-right (world −X under the +Z chase camera), so
   * index 0 is the screen-left lane. Length defines laneCount; do not
   * hardcode 3 in engine code.
   */
  laneCenters: number[];
  /** Base forward speed for this level. */
  baseForwardSpeed: number;
  /** Z beyond which the run is complete. */
  finishZ: number;
  /** Death plane relative to world Y; falling below = death. */
  deathY: number;
  /**
   * Upper death bound (M3): rising above this world Y = death. Optional for
   * backward compatibility; required for levels with ceiling gravity so
   * upward void falls terminate fairly. Never an engine hardcoded height.
   */
  deathYMax?: number;
  /**
   * Starting gravity mode for this level (default 'floor' when omitted).
   * Existing levels remain valid unchanged.
   */
  startGravityMode?: GravityMode;
  /**
   * Gravity transition portals (M3), processed in ascending Z order.
   * Optional; levels without portals behave exactly as before.
   */
  gravityPortals?: GravityPortalDef[];
  solids: LevelSolid[];
  hazards: LevelHazard[];
  theme: LevelTheme;
}
