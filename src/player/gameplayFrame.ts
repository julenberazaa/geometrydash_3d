import { vec3, type Vec3 } from '../core/math';

/**
 * Player gameplay frame: the four directions all controller math is expressed in.
 *
 * Milestone M1 ships Floor gravity only, but the contract exists so Ceiling /
 * Wall modes later change FRAME DATA, not controller code.
 *
 * IMPORTANT (per spec): laneAxis is explicit data, never derived from
 * cross(gravity, forward) — future ceiling/wall gameplay must preserve the same
 * left/right lane orientation rather than mirroring with the cross product.
 */
export class GameplayFrame {
  /** Unit vector the player perpetually travels along (+Z for M1). */
  readonly forwardAxis: Vec3;
  /** Unit vector pointing "down" in gameplay terms (-Y for M1 Floor mode). */
  readonly gravityVector: Vec3;
  /** Current support surface normal; equals -gravityVector when airborne. */
  readonly surfaceNormal: Vec3;
  /** Unit vector toward increasing lane index (+X for M1); explicit data. */
  readonly laneAxis: Vec3;

  constructor(
    forward: Readonly<Vec3>,
    gravity: Readonly<Vec3>,
    lane: Readonly<Vec3>,
    surfaceNormal?: Readonly<Vec3>,
  ) {
    this.forwardAxis = vec3(forward.x, forward.y, forward.z);
    this.gravityVector = vec3(gravity.x, gravity.y, gravity.z);
    this.laneAxis = vec3(lane.x, lane.y, lane.z);
    const n = surfaceNormal ?? {
      x: -gravity.x,
      y: -gravity.y,
      z: -gravity.z,
    };
    this.surfaceNormal = vec3(n.x, n.y, n.z);
  }

  public static floor(): GameplayFrame {
    return new GameplayFrame(
      { x: 0, y: 0, z: 1 }, // forward +Z
      { x: 0, y: -1, z: 0 }, // gravity -Y
      { x: 1, y: 0, z: 0 }, // lanes +X
    );
  }
}
