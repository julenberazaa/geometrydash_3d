import type { Vec3 } from '../core/math';
import { vec3 } from '../core/math';

/**
 * Which side of the world the player is currently attached to / pulled toward.
 * M3 ships Floor and Ceiling only; wall modes are future work and MUST NOT be
 * assumed by any code path yet. The authoritative value lives on
 * `GameSimulation` (see ARCHITECTURE.md); this mirror on the player state is
 * read-only presentation of that authority.
 */
export type GravityMode = 'floor' | 'ceiling';

/**
 * Pure simulation state of the player. THREE.js never touches this.
 * Position is the CENTER of the gameplay hitbox.
 */
export interface PlayerState {
  position: Vec3;
  /** World-space velocity; accelerations come from the GameplayFrame vectors. */
  velocity: Vec3;
  grounded: boolean;
  /** Lane intent index (not a position). Physical X stays continuous. */
  targetLaneIndex: number;
  /** Number of lanes configured by the level (bounds targetLaneIndex). */
  laneCount: number;
  gravityMode: GravityMode;
  /** Id of the collider currently supporting the player, when grounded. */
  supportColliderId: string | null;
}

export interface PlayerStartState {
  position: Vec3;
  laneIndex: number;
  laneCount: number;
  /** Starting gravity orientation (defaults to 'floor'). */
  gravityMode?: GravityMode;
}

export const createPlayerState = (start: PlayerStartState): PlayerState => ({
  position: vec3(start.position.x, start.position.y, start.position.z),
  velocity: vec3(0, 0, 0),
  grounded: false,
  targetLaneIndex: start.laneIndex,
  laneCount: start.laneCount,
  gravityMode: start.gravityMode ?? 'floor',
  supportColliderId: null,
});

export const resetPlayerState = (state: PlayerState, start: PlayerStartState): void => {
  state.position.x = start.position.x;
  state.position.y = start.position.y;
  state.position.z = start.position.z;
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.velocity.z = 0;
  state.grounded = false;
  state.targetLaneIndex = start.laneIndex;
  state.gravityMode = start.gravityMode ?? 'floor';
  state.supportColliderId = null;
};
