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
 *
 * M3.3 SURFACE-RELATIVE PROJECTION SYMMETRY: the below-focus framing is the
 * EXACT mirror of the above-focus framing about the corridor mid-plane, so
 * the Cube face OPPOSITE the support surface (the free face — top face on
 * Floor, bottom face on Ceiling) projects with the same apparent size and
 * perspective on every gravity surface. The mirror is vertical only: X/Z
 * framing, up vector, FOV and roll (none) are identical on both sides.
 */
/**
 * Which side of the focus the camera frames it from. `aboveFocus` is the
 * classic floor framing (elevated, looking down ahead); `belowFocus` is the
 * ceiling framing (hanging mid-corridor, looking up at the contact surface).
 * The value follows the simulation's gravity mode — the WORLD framing logic
 * never rolls or rotates.
 */
export type CameraFocusSide = 'aboveFocus' | 'belowFocus';

export interface CameraTuning {
  /** Distance behind the player along -forward. */
  followDistance: number;
  /** Camera height anchor on the free-face side (aboveFocus framing). */
  height: number;
  /**
   * Vertical parallax factor shared by BOTH focus sides: the eye tracks this
   * fraction of the player's vertical motion, so jump framing reads the same
   * way on every gravity surface (mirrored along gravity).
   */
  verticalParallax: number;
  /**
   * Y anchor of the below-focus height line `playerY * verticalParallax +
   * belowFocusAnchor`. Together with `height` it satisfies the M3.3 mirror:
   * the below-focus line is the above-focus line reflected about the corridor
   * mid-plane y = 3 (floor support plane 0 ↔ ceiling underside 6; floor rest
   * cube y 0.55 + eye offset +3.84 ↔ ceiling rest cube y 5.45 + eye offset
   * −3.84), so the rest eye sits the SAME distance on the free-face side of
   * the player on both surfaces. Like the M3.1 framing constants, this anchor
   * is tuned for corridor-style levels (support planes 0/6); a future level
   * with a very different ceiling band may need a declared framing hint.
   */
  belowFocusAnchor: number;
  /** How far ahead of the player the look target sits (units along forward). */
  lookAhead: number;
  /** Vertical offset of the look target toward the free-face side of the
   *  player center (above on Floor, mirrored below on Ceiling). */
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
  verticalParallax: 0.35,
  belowFocusAnchor: -0.3,
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
   * gameplay never reads camera state). `focusSide` follows the simulation's
   * gravity mode (RendererHost maps it); the damped position smoothing makes
   * the desired-height change at a gravity flip a short glide, never a cut.
   */
  public update(
    playerPosition: Readonly<Vec3>,
    trackCenterX: number,
    renderDtSeconds: number,
    focusSide: CameraFocusSide = 'aboveFocus',
  ): void {
    const t = this.tuning;

    // Desired: behind + elevated + track-centered with a small damped bias.
    const lateralOffset = playerPosition.x - trackCenterX;
    const bias = Math.max(
      -t.maxLateralBias,
      Math.min(t.maxLateralBias, lateralOffset * t.lateralBiasFactor),
    );
    const desiredX = trackCenterX + bias;
    // Surface-relative vertical framing (M3.3): both height lines share the
    // same parallax slope and are exact mirrors about the corridor mid-plane,
    // so the free face opposite the support projects identically on both
    // surfaces. On the ceiling the eye hangs BELOW the focus (the open
    // corridor side) so it can never be pulled up into the slab the player
    // runs under.
    const below = focusSide === 'belowFocus';
    const desiredY = below
      ? playerPosition.y * t.verticalParallax + t.belowFocusAnchor
      : playerPosition.y * t.verticalParallax + t.height;
    const desiredZ = playerPosition.z - t.followDistance;

    const desiredLookX = trackCenterX + bias * 0.5;
    // Look bias mirrors with the framing side: toward the free face on every
    // gravity surface (above the cube on Floor, below it on Ceiling) so the
    // view pitch — and with it the free-face perspective — mirrors exactly.
    const desiredLookY = playerPosition.y + (below ? -t.lookHeightBias : t.lookHeightBias);
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
  public snapTo(
    playerPosition: Readonly<Vec3>,
    trackCenterX: number,
    focusSide: CameraFocusSide = 'aboveFocus',
  ): void {
    this.initialized = false;
    this.update(playerPosition, trackCenterX, 1, focusSide);
  }

  public get currentPosition(): Readonly<Vec3> {
    return this.position;
  }

  public get currentLookTarget(): Readonly<Vec3> {
    return this.lookTarget;
  }
}
