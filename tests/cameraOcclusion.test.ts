import { describe, expect, it } from 'vitest';
import {
  CameraOcclusionResolver,
  CAMERA_OCCLUSION_TUNING,
  type CameraBlocker,
} from '../src/camera/CameraOcclusionResolver';

const DT = 1 / 60;
const TUNE = CAMERA_OCCLUSION_TUNING;

const box = (
  id: string,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
): CameraBlocker => ({
  id,
  minX: cx - hx, minY: cy - hy, minZ: cz - hz,
  maxX: cx + hx, maxY: cy + hy, maxZ: cz + hz,
});

/** Classic chase pose: focus at origin-ish, eye behind (−Z) and above. */
const FOCUS = { x: 0, y: 1, z: 100 };
const EYE = { x: 0, y: 4.8, z: 91.5 };
const LOOK = { x: 0, y: 1.6, z: 110 };

/** Segment focus→eye crosses `b` (expanded) iff the resolver must pull in. */
const segmentClearOf = (
  from: Readonly<{ x: number; y: number; z: number }>,
  to: Readonly<{ x: number; y: number; z: number }>,
  blockers: readonly CameraBlocker[],
): boolean => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  for (let s = 0; s <= steps; s++) {
    const px = from.x + (dx * s) / steps;
    const py = from.y + (dy * s) / steps;
    const pz = from.z + (dz * s) / steps;
    for (const b of blockers) {
      if (
        px > b.minX - TUNE.sweepRadius && px < b.maxX + TUNE.sweepRadius &&
        py > b.minY - TUNE.sweepRadius && py < b.maxY + TUNE.sweepRadius &&
        pz > b.minZ - TUNE.sweepRadius && pz < b.maxZ + TUNE.sweepRadius
      ) {
        return false;
      }
    }
  }
  return true;
};

describe('CameraOcclusionResolver visibility contract (M8.6 Bug B)', () => {
  it('A. no blocker: resolved eye == desired eye', () => {
    const r = new CameraOcclusionResolver();
    r.resolve(FOCUS, EYE, LOOK, [], DT);
    expect(r.currentResolvedEye.x).toBeCloseTo(EYE.x, 9);
    expect(r.currentResolvedEye.y).toBeCloseTo(EYE.y, 9);
    expect(r.currentResolvedEye.z).toBeCloseTo(EYE.z, 9);
    expect(r.isOccluded).toBe(false);
    expect(r.pullInDistance).toBe(0);
    expect(r.needsOccluderFade).toBe(false);
  });

  it('B. wall between player and camera: eye pulls in ahead of the wall', () => {
    // Wall slab straddling the segment midpoint (focus z=100 → eye z=91.5).
    const wall = box('wall', 0, 2.5, 95.5, 6, 3, 0.6);
    const r = new CameraOcclusionResolver();
    for (let i = 0; i < 120; i++) r.resolve(FOCUS, EYE, LOOK, [wall], DT);
    const eye = r.currentResolvedEye;
    expect(r.isOccluded).toBe(true);
    expect(r.occluderId).toBe('wall');
    // Resolved eye stays on the player side of the wall face (+skin).
    expect(eye.z).toBeGreaterThan(wall.maxZ + TUNE.wallSkin - 0.05);
    expect(eye.z).toBeLessThan(FOCUS.z);
    expect(segmentClearOf(FOCUS, eye, [wall])).toBe(true);
  });

  it('C. wall behind the desired camera: no change', () => {
    const behind = box('behind', 0, 2.5, 84, 6, 3, 1);
    const r = new CameraOcclusionResolver();
    r.resolve(FOCUS, EYE, LOOK, [behind], DT);
    expect(r.currentResolvedEye.z).toBeCloseTo(EYE.z, 9);
    expect(r.isOccluded).toBe(false);
  });

  it('D. narrow corridor: eye remains outside geometry with a clear segment', () => {
    // Desired eye buried inside a side wall of a narrow corridor run.
    const left = box('left', -4, 2, 95, 1, 4, 12);
    const focus = { x: -1.5, y: 1, z: 100 };
    const buriedEye = { x: -4.2, y: 4.8, z: 91.5 };
    const r = new CameraOcclusionResolver();
    for (let i = 0; i < 120; i++) r.resolve(focus, buriedEye, LOOK, [left], DT);
    const eye = r.currentResolvedEye;
    const inside =
      eye.x > left.minX && eye.x < left.maxX &&
      eye.y > left.minY && eye.y < left.maxY &&
      eye.z > left.minZ && eye.z < left.maxZ;
    expect(inside).toBe(false);
    expect(segmentClearOf(focus, eye, [left])).toBe(true);
  });

  it('E. blocker appears: camera contracts with no one-frame player loss', () => {
    const wall = box('wall', 0, 2.5, 95.5, 6, 3, 0.6);
    const r = new CameraOcclusionResolver();
    for (let i = 0; i < 30; i++) {
      r.resolve(FOCUS, EYE, LOOK, [], DT);
      expect(segmentClearOf(FOCUS, r.currentResolvedEye, [])).toBe(true);
    }
    // Slam the wall in: EVERY intermediate resolved pose must stay visible.
    for (let i = 0; i < 120; i++) {
      r.resolve(FOCUS, EYE, LOOK, [wall], DT);
      expect(segmentClearOf(FOCUS, r.currentResolvedEye, [wall])).toBe(true);
    }
  });

  it('F. blocker clears: camera relaxes back gradually, not instantly', () => {
    const wall = box('wall', 0, 2.5, 95.5, 6, 3, 0.6);
    const r = new CameraOcclusionResolver();
    for (let i = 0; i < 120; i++) r.resolve(FOCUS, EYE, LOOK, [wall], DT);
    const pulled = r.pullInDistance;
    expect(pulled).toBeGreaterThan(0.5);
    r.resolve(FOCUS, EYE, LOOK, [], DT);
    // First clear frame: still mostly pulled in (gradual restore).
    expect(r.pullInDistance).toBeGreaterThan(pulled * 0.8);
    // After ~3 s of clear frames: fully restored.
    for (let i = 0; i < 240; i++) r.resolve(FOCUS, EYE, LOOK, [], DT);
    expect(r.pullInDistance).toBe(0);
    expect(r.currentResolvedEye.z).toBeCloseTo(EYE.z, 6);
  });

  it('G. multiple blockers: the nearest relevant blocker wins', () => {
    const near = box('near', 0, 2.5, 97.5, 6, 3, 0.5);
    const far = box('far', 0, 2.5, 94, 6, 3, 0.5);
    const r = new CameraOcclusionResolver();
    for (let i = 0; i < 120; i++) r.resolve(FOCUS, EYE, LOOK, [far, near], DT);
    expect(r.occluderId).toBe('near');
    const eye = r.currentResolvedEye;
    expect(eye.z).toBeGreaterThan(near.maxZ);
    expect(r.blockerCount).toBe(2);
  });

  it('H. wall-gravity framing (free-side X offset pose) resolves generically', () => {
    // Eye shifted toward −X like freeMinusFocus; wall between side and eye.
    const focus = { x: 2, y: 6, z: 200 };
    const eye = { x: -1.4, y: 9.8, z: 191.5 };
    const wall = box('sidewall', 0.5, 7, 195.5, 0.6, 4, 2);
    const r = new CameraOcclusionResolver();
    for (let i = 0; i < 120; i++) r.resolve(focus, eye, LOOK, [wall], DT);
    expect(r.isOccluded).toBe(true);
    expect(segmentClearOf(focus, r.currentResolvedEye, [wall])).toBe(true);
    // No yaw trickery: the resolved eye stays on the focus→eye line.
    const e = r.currentResolvedEye;
    const dirX = eye.x - focus.x;
    const dirZ = eye.z - focus.z;
    const k = (e.z - focus.z) / dirZ;
    expect(e.x).toBeCloseTo(focus.x + dirX * k, 6);
  });

  it('I. moving blocker: the updated pose affects resolution', () => {
    const r = new CameraOcclusionResolver();
    const mover: CameraBlocker = { id: 'ferry', minX: -6, minY: -10, minZ: -10, maxX: 6, maxY: 10, maxZ: 60 };
    for (let i = 0; i < 30; i++) r.resolve(FOCUS, EYE, LOOK, [mover], DT);
    expect(r.isOccluded).toBe(false);
    // The platform travels up into the sight line (authoritative pose read).
    mover.minY = -1; mover.maxY = 5; mover.minZ = 93; mover.maxZ = 98;
    for (let i = 0; i < 120; i++) r.resolve(FOCUS, EYE, LOOK, [mover], DT);
    expect(r.isOccluded).toBe(true);
    expect(r.occluderId).toBe('ferry');
    expect(segmentClearOf(FOCUS, r.currentResolvedEye, [mover])).toBe(true);
  });

  it('J. teleport snap: immediate safe pose, no one-frame loss', () => {
    const wall = box('wall', 0, 2.5, 95.5, 6, 3, 0.6);
    const r = new CameraOcclusionResolver();
    r.resolve(FOCUS, EYE, LOOK, [wall], DT, true);
    expect(segmentClearOf(FOCUS, r.currentResolvedEye, [wall])).toBe(true);
    expect(r.isOccluded).toBe(true);
  });

  it('minimum distance clamp + fade trigger when nothing usable exists', () => {
    // A shell around the focus: any pull-in stays inside blockers.
    const shell = box('shell', 0, 1, 99, 3, 3, 3);
    const r = new CameraOcclusionResolver();
    for (let i = 0; i < 120; i++) r.resolve(FOCUS, EYE, LOOK, [shell], DT, i === 0);
    const eye = r.currentResolvedEye;
    const dist = Math.hypot(eye.x - FOCUS.x, eye.y - FOCUS.y, eye.z - FOCUS.z);
    expect(dist).toBeGreaterThanOrEqual(TUNE.minFocusDistance - 1e-6);
    expect(r.needsOccluderFade).toBe(true);
    expect(r.occluderId).toBe('shell');
  });
});
