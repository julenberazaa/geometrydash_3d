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
 * ceiling framing (hanging mid-corridor, looking up at the contact
 * surface); `freeMinusFocus` / `freePlusFocus` are the M8B wall framings —
 * the eye shifts toward the FREE-face side (−X for leftWall support,
 * +X for rightWall) while STAYING elevated like the floor framing, so the
 * Cube's side free face AND its top face stay readable in one stable view.
 * The value follows the simulation's gravity mode — the WORLD framing
 * logic never rolls or rotates (`camera.up` stays world +Y everywhere).
 */
export type CameraFocusSide = 'aboveFocus' | 'belowFocus' | 'freeMinusFocus' | 'freePlusFocus';

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
  /**
   * M8B wall-framing eye offset toward the free-face side (world units
   * along X). Large enough to open the side free face (~3.4 u at the
   * ~10 u follow distance ≈ 19°), small enough to keep the route and
   * the top face in frame.
   */
  wallFreeSideOffset: number;
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
  wallFreeSideOffset: 3.4,
};

/**
 * M8.2 Spider-swap glide: how long (render seconds) the camera takes to
 * travel from the pre-swap framing to the post-swap framing. M8.3: this
 * is a POSE-CAPTURE blend, not a rate change — arming snapshots the live
 * eye/look pose and the envelope eases it onto the (moving) desired
 * framing with a smootherstep profile (zero velocity at both ends, so no
 * cut and no whip). Endpoints are identical to the legacy path by
 * construction. Gravity-portal/Cube/Ship framing never enters this
 * envelope (their lambdas are byte-untouched).
 */
export const SPIDER_SWAP_GLIDE_SECONDS = 0.55;

export class ChaseCamera {
  private readonly tuning: CameraTuning;
  private readonly position: Vec3;
  private readonly lookTarget: Vec3;
  private initialized = false;
  /**
   * M8.2 Spider-swap envelope clock (render seconds since the last
   * Spider-context gravity swap; Infinity at rest). M8.3: arming also
   * snapshots the live eye/look pose (`glideFromPos/Look`) — while open,
   * update() blends that snapshot onto the moving desired framing with
   * a smootherstep profile instead of exponential damping.
   */
  private swapEnvelope = Infinity;
  private readonly glideFromPos: Vec3 = vec3(0, 0, 0);
  private readonly glideFromLook: Vec3 = vec3(0, 0, 0);

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
  /**
   * M8.3: arm the Spider-swap glide (called by the rendering host when
   * the simulation's gravity flips inside Spider mode INSTEAD of
   * snapping — the swap displacement is a sanctioned transition, not a
   * teleport). Captures the live pose so the envelope can blend it onto
   * the post-swap framing with zero initial velocity. Pure presentation
   * state — gameplay never reads it. Gravity-portal flips never call
   * this, so their approved feel is numerically untouched.
   */
  public noteSpiderSwap(): void {
    this.glideFromPos.x = this.position.x;
    this.glideFromPos.y = this.position.y;
    this.glideFromPos.z = this.position.z;
    this.glideFromLook.x = this.lookTarget.x;
    this.glideFromLook.y = this.lookTarget.y;
    this.glideFromLook.z = this.lookTarget.z;
    this.swapEnvelope = 0;
  }

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
    // M8B wall framing: shift the eye toward the free-face side (open
    // corridor side of the wall run) while keeping the floor-like height,
    // so the side free face opens up AND the top face stays readable.
    // Floor/Ceiling formulas are byte-untouched (regression-pinned).
    const freeMinus = focusSide === 'freeMinusFocus';
    const freePlus = focusSide === 'freePlusFocus';
    const desiredX =
      trackCenterX + bias + (freeMinus ? -t.wallFreeSideOffset : freePlus ? t.wallFreeSideOffset : 0);
    // Surface-relative vertical framing (M3.3): both height lines share the
    // same parallax slope and are exact mirrors about the corridor mid-plane,
    // so the free face opposite the support projects identically on both
    // surfaces. On the ceiling the eye hangs BELOW the focus (the open
    // corridor side) so it can never be pulled up into the slab the player
    // runs under. Walls keep the elevated floor line (top-face readable).
    const below = focusSide === 'belowFocus';
    const desiredY = below
      ? playerPosition.y * t.verticalParallax + t.belowFocusAnchor
      : playerPosition.y * t.verticalParallax + t.height;
    const desiredZ = playerPosition.z - t.followDistance;

    const desiredLookX =
      trackCenterX + bias * 0.5 + (freeMinus ? -t.lookHeightBias : freePlus ? t.lookHeightBias : 0);
    // Look bias mirrors with the framing side: toward the free face on every
    // gravity surface (above the cube on Floor, below it on Ceiling) so the
    // view pitch — and with it the free-face perspective — mirrors exactly.
    // On walls the look nudges toward the free side while staying above,
    // keeping both the side free face and the top face in view.
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

    // M8.3 Spider-swap glide: while the envelope is open, blend the
    // captured pre-swap pose onto the (moving) desired framing with a
    // smootherstep profile — zero velocity at both ends, so the
    // transition reads as one continuous move, never a cut or a whip.
    // The clock advances on render dt, so pause freezes the glide too.
    // At s = 1 the pose EQUALS the desired framing exactly, and the
    // profile arrives with the target's own velocity, so handing back
    // to exponential damping is seamless.
    this.swapEnvelope += renderDtSeconds;
    const glideT = Math.min(1, this.swapEnvelope / SPIDER_SWAP_GLIDE_SECONDS);
    if (glideT < 1) {
      const s = glideT * glideT * glideT * (glideT * (glideT * 6 - 15) + 10);
      this.position.x = this.glideFromPos.x + (desiredX - this.glideFromPos.x) * s;
      this.position.y = this.glideFromPos.y + (desiredY - this.glideFromPos.y) * s;
      this.position.z = this.glideFromPos.z + (desiredZ - this.glideFromPos.z) * s;
      this.lookTarget.x = this.glideFromLook.x + (desiredLookX - this.glideFromLook.x) * s;
      this.lookTarget.y = this.glideFromLook.y + (desiredLookY - this.glideFromLook.y) * s;
      this.lookTarget.z = this.glideFromLook.z + (desiredLookZ - this.glideFromLook.z) * s;
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
    // A snap cuts — it must never inherit an open glide envelope.
    this.swapEnvelope = Infinity;
    this.update(playerPosition, trackCenterX, 1, focusSide);
  }

  public get currentPosition(): Readonly<Vec3> {
    return this.position;
  }

  public get currentLookTarget(): Readonly<Vec3> {
    return this.lookTarget;
  }
}
