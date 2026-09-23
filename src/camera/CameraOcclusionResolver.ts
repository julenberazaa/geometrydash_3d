import type { Vec3 } from '../core/math';
import { vec3, dampFactor } from '../core/math';

/**
 * Camera-blocking volume for the occlusion resolver (M8.6 Bug B).
 *
 * A structural AABB + id — NOT the gameplay `Collider`: the resolver is
 * presentation-side and must never alias simulation state. The host adapts
 * static solid colliders (once per level, cold path) and live moving-platform
 * poses (fixed ≤8 scratch entries, updated in place) into this shape.
 * Only opaque non-hazard solids are ever admitted (hazards, lava, portals
 * and kill volumes never pull the camera and are never faded).
 */
export interface CameraBlocker {
  readonly id: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface CameraOcclusionTuning {
  /** Sphere-sweep radius (expanded-AABB test) around the eye-focus segment. */
  sweepRadius: number;
  /** Safety skin between the resolved eye and the blocking face. */
  wallSkin: number;
  /** Minimum usable player-eye distance (never inside the Cube). */
  minFocusDistance: number;
  /** Restore rate when the obstruction clears (slow — natural relax). */
  restoreSmoothing: number;
}

export const CAMERA_OCCLUSION_TUNING: CameraOcclusionTuning = {
  sweepRadius: 0.35,
  wallSkin: 0.25,
  minFocusDistance: 1.6,
  restoreSmoothing: 2.4,
};

/**
 * CameraOcclusionResolver (M8.6 Bug B) — resolves the ChaseCamera's ideal
 * smoothed eye/look pose against blocking geometry WITHOUT orbiting: the
 * camera keeps its established chase language (no yaw cuts, no roll) and
 * PULLS IN along the focus→eye axis ahead of the nearest obstruction.
 *
 * Pipeline (per rendered frame, presentation-only, sim never touched):
 *  1. sweep the focus→desired-eye segment (sphere-equivalent expanded-AABB
 *     slab test) against the bounded blocker set → nearest entry fraction;
 *  2. convert to a needed pull-in distance (0 when clear);
 *  3. asymmetric response: the pull tracks obstruction APPEARANCE immediately
 *     (a lagging contract would hide the player for whole frames; continuous
 *     obstruction motion still yields continuous pose motion — only a
 *     discontinuous wall slam moves the eye discontinuously, which is
 *     correct), while the RESTORE relaxes slowly for a natural ease-out;
 *  4. clamp to the minimum focus distance; if the segment is STILL blocked
 *     at the minimum, report `stillOccluded` so the renderer-only occluder
 *     fade (last resort) can reveal the player.
 * Edge flicker cannot vibrate the pose: upward tracking never lags, and the
 * slow restore never chases flicker back down within a frame.
 *
 * Zero per-frame allocation: the resolved pose lives in owned Vec3s, the
 * sweep uses scalar scratch, blockers are host-owned and read-only here.
 */
export class CameraOcclusionResolver {
  private readonly tuning: CameraOcclusionTuning;
  /** Smoothed pull-in distance along focus→eye (0 = full follow distance). */
  private pullDistance = 0;
  private readonly resolvedEye: Vec3 = vec3(0, 0, 0);
  private readonly resolvedLook: Vec3 = vec3(0, 0, 0);
  private readonly idealEye: Vec3 = vec3(0, 0, 0);
  private occluded = false;
  private stillOccluded = false;
  private occluderCount = 0;
  private nearestBlockerId: string | null = null;

  constructor(tuning: CameraOcclusionTuning = CAMERA_OCCLUSION_TUNING) {
    this.tuning = tuning;
  }

  /**
   * Resolve one frame. `focus` is the player visibility point, `desiredEye`
   * the ChaseCamera's smoothed ideal pose, `blockers` the bounded
   * camera-blocking set. `snap` (teleport/respawn) applies the needed
   * pull-in immediately — the new camera can never spawn behind geometry.
   */
  public resolve(
    focus: Readonly<Vec3>,
    desiredEye: Readonly<Vec3>,
    desiredLook: Readonly<Vec3>,
    blockers: readonly CameraBlocker[],
    renderDtSeconds: number,
    snap = false,
  ): void {
    const t = this.tuning;
    this.idealEye.x = desiredEye.x;
    this.idealEye.y = desiredEye.y;
    this.idealEye.z = desiredEye.z;

    const dx = desiredEye.x - focus.x;
    const dy = desiredEye.y - focus.y;
    const dz = desiredEye.z - focus.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1e-6) {
      this.resolvedEye.x = desiredEye.x;
      this.resolvedEye.y = desiredEye.y;
      this.resolvedEye.z = desiredEye.z;
      this.resolvedLook.x = desiredLook.x;
      this.resolvedLook.y = desiredLook.y;
      this.resolvedLook.z = desiredLook.z;
      this.pullDistance = 0;
      this.occluded = false;
      this.stillOccluded = false;
      this.occluderCount = 0;
      this.nearestBlockerId = null;
      return;
    }
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;

    // Nearest blocking entry along focus→eye (+sweep radius expansion).
    let bestT = Infinity;
    let count = 0;
    let nearest: string | null = null;
    for (let i = 0; i < blockers.length; i++) {
      const b = blockers[i];
      if (b === undefined) continue;
      const entry = segmentAabbEntry(
        focus.x, focus.y, focus.z, nx, ny, nz, dist,
        b.minX - t.sweepRadius, b.minY - t.sweepRadius, b.minZ - t.sweepRadius,
        b.maxX + t.sweepRadius, b.maxY + t.sweepRadius, b.maxZ + t.sweepRadius,
      );
      if (entry === null) continue;
      count++;
      if (entry < bestT) {
        bestT = entry;
        nearest = b.id;
      }
    }
    this.occluderCount = count;
    this.nearestBlockerId = nearest;

    // Needed pull-in: keep the eye `wallSkin` ahead of the nearest face.
    let needed = 0;
    if (bestT !== Infinity) {
      needed = Math.max(0, dist - (bestT - t.wallSkin));
    }
    // Never pull past the minimum usable distance.
    const maxPull = Math.max(0, dist - t.minFocusDistance);
    const clamped = Math.min(needed, maxPull);
    if (snap || clamped > this.pullDistance) {
      // Track appearance immediately (snap or newly grown obstruction): the
      // eye can never lag inside geometry. Continuous obstruction motion
      // keeps the pose continuous; only the restore is smoothed.
      this.pullDistance = clamped;
    } else {
      this.pullDistance += (clamped - this.pullDistance) * dampFactor(t.restoreSmoothing, renderDtSeconds);
      if (Math.abs(this.pullDistance - clamped) < 0.001) this.pullDistance = clamped;
    }

    const resolvedDist = Math.max(t.minFocusDistance, dist - this.pullDistance);
    this.resolvedEye.x = focus.x + nx * resolvedDist;
    this.resolvedEye.y = focus.y + ny * resolvedDist;
    this.resolvedEye.z = focus.z + nz * resolvedDist;
    // Eye-inside-solid escape: pulling toward the player can drag the eye
    // into NEARBY geometry (tunnel walls, the deck below). The old
    // non-penetration invariant outranks pull-in — walk back toward the
    // ideal until outside all solids. The re-crossed occluder (if any) is
    // exactly the fade fallback's target, explicitly allowed by the
    // visibility contract. Bounded steps, zero allocation, pulled frames
    // only (the common clear case pays nothing).
    if (this.pullDistance > 0.001) {
      let walk = resolvedDist;
      const step = 0.15;
      for (let i = 0; i < 64 && walk < dist; i++) {
        if (!pointInsideAnySolid(
          focus.x + nx * walk, focus.y + ny * walk, focus.z + nz * walk,
          blockers,
        )) {
          break;
        }
        walk = Math.min(dist, walk + step);
      }
      this.resolvedEye.x = focus.x + nx * walk;
      this.resolvedEye.y = focus.y + ny * walk;
      this.resolvedEye.z = focus.z + nz * walk;
      // Keep the smoothed state consistent with the escaped pose so the
      // restore relaxes from where the eye actually is.
      this.pullDistance = Math.max(0, dist - walk);
    }
    this.resolvedLook.x = desiredLook.x;
    this.resolvedLook.y = desiredLook.y;
    this.resolvedLook.z = desiredLook.z;
    this.occluded = this.pullDistance > 0.01 || needed > 0;
    // Still blocked at the minimum distance → engage the fade fallback.
    this.stillOccluded = needed > maxPull + 0.001;
  }

  /** Snap predicate helper: teleport/respawn call resolve(..., snap=true). */
  public get currentResolvedEye(): Readonly<Vec3> {
    return this.resolvedEye;
  }

  public get currentResolvedLook(): Readonly<Vec3> {
    return this.resolvedLook;
  }

  public get currentIdealEye(): Readonly<Vec3> {
    return this.idealEye;
  }

  /** True while pulled in (or newly obstructed): presentation/debug only. */
  public get isOccluded(): boolean {
    return this.occluded;
  }

  /** Blockers intersecting the ideal segment this frame (debug only). */
  public get blockerCount(): number {
    return this.occluderCount;
  }

  /** Nearest blocking id (drives the fade fallback; null when clear). */
  public get occluderId(): string | null {
    return this.nearestBlockerId;
  }

  public get pullInDistance(): number {
    return this.pullDistance;
  }

  /** True when no usable camera position exists (fade fallback trigger). */
  public get needsOccluderFade(): boolean {
    return this.stillOccluded;
  }
}

/**
 * True iff the point sits inside (or within penetration skin of) any
 * blocker. The skin matches the historical eye non-penetration auditor.
 */
const EYE_SOLID_SKIN = 0.05;

const pointInsideAnySolid = (
  px: number, py: number, pz: number,
  blockers: readonly CameraBlocker[],
): boolean => {
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    if (b === undefined) continue;
    if (
      px > b.minX - EYE_SOLID_SKIN && px < b.maxX + EYE_SOLID_SKIN &&
      py > b.minY - EYE_SOLID_SKIN && py < b.maxY + EYE_SOLID_SKIN &&
      pz > b.minZ - EYE_SOLID_SKIN && pz < b.maxZ + EYE_SOLID_SKIN
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Entry fraction of the ray (origin + dir·[0, maxDist]) into the AABB, or
 * null when missed. Origin-inside counts as entry 0 (the eye is already in
 * geometry — pull all the way to the focus). Pure scalar math, no allocation.
 */
const segmentAabbEntry = (
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): number | null => {
  let tmin = 0;
  let tmax = maxDist;
  // X slab.
  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return null;
  } else {
    const inv = 1 / dx;
    let a = (minX - ox) * inv;
    let b = (maxX - ox) * inv;
    if (a > b) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
    if (tmin > tmax) return null;
  }
  // Y slab.
  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return null;
  } else {
    const inv = 1 / dy;
    let a = (minY - oy) * inv;
    let b = (maxY - oy) * inv;
    if (a > b) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
    if (tmin > tmax) return null;
  }
  // Z slab.
  if (Math.abs(dz) < 1e-9) {
    if (oz < minZ || oz > maxZ) return null;
  } else {
    const inv = 1 / dz;
    let a = (minZ - oz) * inv;
    let b = (maxZ - oz) * inv;
    if (a > b) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
    if (tmin > tmax) return null;
  }
  return tmin;
};
