import type { Vec3 } from '../core/math';
import { vec3 } from '../core/math';

/**
 * Which side of the world the player is attached to.
 * Only 'floor' is functional in M1; the enum exists so the gravity system can
 * grow without changing controller contracts (spec §9).
 */
export type GravityMode = 'floor' | 'ceiling' | 'wallLeft' | 'wallRight';

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
}

export const createPlayerState = (start: PlayerStartState): PlayerState => ({
  position: vec3(start.position.x, start.position.y, start.position.z),
  velocity: vec3(0, 0, 0),
  grounded: false,
  targetLaneIndex: start.laneIndex,
  laneCount: start.laneCount,
  gravityMode: 'floor',
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
  state.gravityMode = 'floor';
  state.supportColliderId = null;
};
