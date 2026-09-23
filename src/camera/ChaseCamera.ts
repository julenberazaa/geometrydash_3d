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
 *
 * M8.6 MULTI-HEIGHT GENERALIZATION: the M3.3 height lines were functions of
 * ABSOLUTE player height with corridor-tuned intercepts — outside the 0/6
 * band the eye-player offset drifted with world height (measured in
 * tests/cameraFraming.test.ts: floor eye below the player on high decks,
 * ceiling eye above it on low decks). Each focus side now keeps a SLOW
 * height-line intercept adapting toward its deck-invariant line while
 * grounded; airborne the intercepts freeze, preserving the proven transient
 * shape. Rest framing is deck-invariant: support/world height may change;
 * camera-player framing does not.
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
  /**
   * Free-face-side eye distance at rest (M8.6): the corridor rest offset
   * 3.8425 u (old `height` 4.2 − 0.65 · corridor floor rest 0.55), preserved
   * as the deck-invariant reference — a player on a deck at Y=20 is framed
   * exactly like the same player at Y=2. Above the player on Floor/walls,
   * mirrored below on Ceiling.
   */
  eyeHeight: number;
  /**
   * Deck-relative readability slope (M8.6, the classic `verticalParallax`
   * 0.35): the desired eye always tracks this fraction of player height, so
   * airborne transients (jumps, drops, portal flights) keep the exact proven
   * corridor transient shape on every deck. The intercepts (below) carry the
   * deck adaptation instead.
   */
  heightParallax: number;
  /**
   * Intercept adaptation rate (M8.6, exponential damping lambda, 1/s):
   * while grounded, the active side's intercept chases its deck-invariant
   * target fast enough to re-frame stairs/deck landings in under a second,
   * with a smooth damped glide — never a snap. Airborne the intercepts
   * freeze (jump readability + portal-flight shape preserved).
   */
  interceptAdaptRate: number;
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
  eyeHeight: 3.8425,
  heightParallax: 0.35,
  interceptAdaptRate: 4.0,
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
 * Corridor rest heights (M3.1): the deck-invariant adaptation below is
 * anchored so its fixed points are EXACTLY the legacy corridor constants
 * (above 4.2 at floor rest 0.55, below −0.3 at ceiling rest 5.45) — corridor
 * behavior is preserved by construction, not by coincidence.
 */
export const CORRIDOR_FLOOR_REST_Y = 0.55;
export const CORRIDOR_CEILING_REST_Y = 5.45;

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
  /**
   * M8.6 deck intercepts (presentation-only state): the slow per-side height-
   * line intercepts the desired eye offsets from. Each side adapts toward its
   * deck-invariant line ONLY while grounded (stairs, decks, ferries); airborne
   * (jumps, drops, portal flights) they freeze, so transients keep the exact
   * proven 0.35-slope shape re-centered on the current deck. Initialized to
   * the corridor constants, which are the fixed points of the adaptation at
   * corridor rest heights — corridor behavior is preserved by construction.
   */
  private aboveIntercept: number;
  private belowIntercept: number;

  constructor(tuning: CameraTuning = CAMERA_TUNING) {
    this.tuning = tuning;
    // Corridor fixed points of the adaptation (see update): at corridor
    // rest the deck-invariant targets equal the legacy constants exactly.
    const slope = 1 - tuning.heightParallax;
    this.aboveIntercept = CORRIDOR_FLOOR_REST_Y * slope + tuning.eyeHeight;
    this.belowIntercept = CORRIDOR_CEILING_REST_Y * slope - tuning.eyeHeight;
    this.position = vec3(0, tuning.eyeHeight, -tuning.followDistance);
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
    grounded = true,
  ): void {
    const t = this.tuning;
    const below = focusSide === 'belowFocus';

    // M8.6 deck-intercept adaptation FIRST: while grounded, the ACTIVE side's
    // intercept chases its deck-invariant target (the line whose rest offset
    // is exactly ±eyeHeight at the CURRENT deck), so stairs, deck landings
    // and ferry rides re-frame smoothly in under a second. Airborne the
    // intercepts freeze — jumps, drops and portal flights keep the proven
    // 0.35-slope transient shape. The inactive side keeps its last adapted
    // value and re-adapts on return. Pause (dt 0) freezes adaptation like
    // every presentation clock. Snaps cut the POSE (see snapTo) but keep the
    // adapted intercepts — the cut lands on the best-known framing and the
    // glide finishes the job, never a stale-deck swoosh.
    if (grounded) {
      const slope = 1 - t.heightParallax;
      const target = below
        ? playerPosition.y * slope - t.eyeHeight
        : playerPosition.y * slope + t.eyeHeight;
      // A snap (init/teleport/respawn) cuts: land the intercept EXACTLY on
      // the new deck's line so the cut frames correctly from frame one.
      const k = this.initialized ? dampFactor(t.interceptAdaptRate, renderDtSeconds) : 1;
      if (below) {
        this.belowIntercept += (target - this.belowIntercept) * k;
      } else {
        this.aboveIntercept += (target - this.aboveIntercept) * k;
      }
    }

    // Desired: behind + elevated + track-centered with a small damped bias.
    const lateralOffset = playerPosition.x - trackCenterX;
    const bias = Math.max(
      -t.maxLateralBias,
      Math.min(t.maxLateralBias, lateralOffset * t.lateralBiasFactor),
    );
    // M8B wall framing: shift the eye toward the free-face side (open
    // corridor side of the wall run) while keeping the floor-like height,
    // so the side free face opens up AND the top face stays readable.
    // Corridor rest numbers are preserved (regression-pinned); the height
    // line is now deck-relative (see below).
    const freeMinus = focusSide === 'freeMinusFocus';
    const freePlus = focusSide === 'freePlusFocus';
    const desiredX =
      trackCenterX + bias + (freeMinus ? -t.wallFreeSideOffset : freePlus ? t.wallFreeSideOffset : 0);
    // Surface-relative vertical framing (M3.3, generalized M8.6): the
    // desired eye rides the active side's height line — the classic 0.35
    // slope with a slowly deck-adapted intercept. Airborne this is the
    // proven corridor transient shape re-centered on the current deck;
    // grounded-and-settled the rest eye sits EXACTLY ±eyeHeight on the
    // free-face side at EVERY deck height, so a deck at Y=20 frames like
    // the corridor. On the ceiling the eye hangs BELOW the focus (the open
    // side) so it can never be pulled up into the slab the player runs
    // under. Walls keep the elevated floor line (top-face readable) plus
    // the free-side X shift. Corridor rest numbers are fixed points of the
    // adaptation (regression-pinned).
    const intercept = below ? this.belowIntercept : this.aboveIntercept;
    const desiredY = playerPosition.y * t.heightParallax + intercept;
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
