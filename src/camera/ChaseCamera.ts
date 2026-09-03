import type { Vec3 } from '../core/math';
import { vec3, dampFactor } from '../core/math';

/**
 * Third-person chase camera (pure math; applied to a THREE camera by the
 * rendering layer — see ARCHITECTURE.md).
 *
 * Philosophy (spec §23):
 * - Anchored primarily to LONGITUDINAL progress at the TRACK CENTER X.
 *   The player visibly moves left/right inside the frame; lane changes never
 *   drag the camera 1:1.
 * - Optional tiny damped lateral bias toward the player (heavily limited).
 * - Slightly elevated, looking AHEAD of the player, never rolling.
 */
export interface CameraTuning {
  /** Distance behind the player along -forward. */
  followDistance: number;
  /** Camera height above the track focus Y. */
  height: number;
  /** How far ahead of the player the look target sits (units along forward). */
  lookAhead: number;
  /** Vertical offset of the look target above the player center. */
  lookHeightBias: number;
  /** Field of view in degrees. */
  fov: number;
  /** Position smoothing rate (exponential damping lambda, 1/s). */
  positionSmoothing: number;
  /** Look-target smoothing rate. */
  lookSmoothing: number;
  /** Max lateral bias toward the player (units). Small by design. */
  maxLateralBias: number;
  /** Fraction of player lateral offset converted into lateral bias. */
  lateralBiasFactor: number;
}

export const CAMERA_TUNING: CameraTuning = {
  followDistance: 8.5,
  height: 4.2,
  lookAhead: 10,
  lookHeightBias: 0.6,
  fov: 62,
  positionSmoothing: 7.5,
  lookSmoothing: 9,
  maxLateralBias: 0.55,
  lateralBiasFactor: 0.12,
};

export class ChaseCamera {
  private readonly tuning: CameraTuning;
  private readonly position: Vec3;
  private readonly lookTarget: Vec3;
  private initialized = false;

  constructor(tuning: CameraTuning = CAMERA_TUNING) {
    this.tuning = tuning;
    this.position = vec3(0, tuning.height, -tuning.followDistance);
    this.lookTarget = vec3(0, 0, tuning.lookAhead);
  }

  /**
   * Advance camera smoothing with RENDER delta time (visual-only smoothing;
   * gameplay never reads camera state).
   */
  public update(
    playerPosition: Readonly<Vec3>,
    trackCenterX: number,
    renderDtSeconds: number,
  ): void {
    const t = this.tuning;

    // Desired: behind + elevated + track-centered with a small damped bias.
    const lateralOffset = playerPosition.x - trackCenterX;
    const bias = Math.max(
      -t.maxLateralBias,
      Math.min(t.maxLateralBias, lateralOffset * t.lateralBiasFactor),
    );
    const desiredX = trackCenterX + bias;
    const desiredY = playerPosition.y * 0.35 + t.height; // gentle vertical parallax only
    const desiredZ = playerPosition.z - t.followDistance;

    const desiredLookX = trackCenterX + bias * 0.5;
    const desiredLookY = playerPosition.y + t.lookHeightBias;
    const desiredLookZ = playerPosition.z + t.lookAhead;

    if (!this.initialized) {
      this.position.x = desiredX;
      this.position.y = desiredY;
      this.position.z = desiredZ;
      this.lookTarget.x = desiredLookX;
      this.lookTarget.y = desiredLookY;
      this.lookTarget.z = desiredLookZ;
      this.initialized = true;
      return;
    }

    const posK = dampFactor(t.positionSmoothing, renderDtSeconds);
    const lookK = dampFactor(t.lookSmoothing, renderDtSeconds);
    this.position.x += (desiredX - this.position.x) * posK;
    this.position.y += (desiredY - this.position.y) * posK;
    this.position.z += (desiredZ - this.position.z) * posK;
    this.lookTarget.x += (desiredLookX - this.lookTarget.x) * lookK;
    this.lookTarget.y += (desiredLookY - this.lookTarget.y) * lookK;
    this.lookTarget.z += (desiredLookZ - this.lookTarget.z) * lookK;
  }

  /** Snap instantly (teleports/resets). */
  public snapTo(playerPosition: Readonly<Vec3>, trackCenterX: number): void {
    this.initialized = false;
    this.update(playerPosition, trackCenterX, 1);
  }

  public get currentPosition(): Readonly<Vec3> {
    return this.position;
  }

  public get currentLookTarget(): Readonly<Vec3> {
    return this.lookTarget;
  }
}
