import { describe, it, expect } from 'vitest';
import {
  ChaseCamera,
  SPIDER_SWAP_GLIDE_SECONDS,
} from '../src/camera/ChaseCamera';
import { vec3 } from '../src/core/math';

/**
 * M8.3 Spider-camera continuity (human playtest: the swap still feels like
 * a teleport/reload).
 *
 * Root cause (audited): the M8.2 glide only slowed the exponential RATE,
 * but `RendererHost` hard-CUT the camera on every swap — a Spider
 * floor↔ceiling swap displaces the player >5 u in one tick, tripping the
 * teleport detector and calling `snapTo` BEFORE the glide armed. The fix:
 * Spider-context gravity swaps skip the snap; `noteSpiderSwap` captures
 * the pre-swap pose and the envelope blends it onto the moving desired
 * framing with a smootherstep profile (zero velocity at both ends).
 * Teleport portals / respawn / R-teleport still snap (pinned below).
 */

const DT = 1 / 60;

/** A Spider-swap-like discontinuity: floor run pose -> ceiling pose. */
const runSwap = (cam: ChaseCamera, armed: boolean): {
  firstEye: number;
  firstLook: number;
  peakEye: number;
  peakLook: number;
  endEye: number;
  endLook: number;
} => {
  const floor = vec3(0, 0.55, 100);
  const ceil = vec3(0, 5.45, 100);
  cam.snapTo(floor, 0, 'aboveFocus');
  if (armed) cam.noteSpiderSwap();
  // The swap teleports the player; the framing side flips next frame.
  // (M8.3: the host no longer snapTo-cuts here — the glide blends.)
  let firstEye = -1;
  let firstLook = -1;
  let peakEye = 0;
  let peakLook = 0;
  let px = cam.currentPosition.x;
  let py = cam.currentPosition.y;
  let lx = cam.currentLookTarget.x;
  let ly = cam.currentLookTarget.y;
  for (let i = 0; i < 240; i++) {
    cam.update(ceil, 0, DT, 'belowFocus');
    const dx = cam.currentPosition.x - px;
    const dy = cam.currentPosition.y - py;
    const eyeStep = Math.hypot(dx, dy);
    peakEye = Math.max(peakEye, eyeStep);
    px = cam.currentPosition.x;
    py = cam.currentPosition.y;
    const qx = cam.currentLookTarget.x - lx;
    const qy = cam.currentLookTarget.y - ly;
    const lookStep = Math.hypot(qx, qy);
    peakLook = Math.max(peakLook, lookStep);
    lx = cam.currentLookTarget.x;
    ly = cam.currentLookTarget.y;
    if (i === 0) {
      firstEye = eyeStep;
      firstLook = lookStep;
    }
  }
  return {
    firstEye,
    firstLook,
    peakEye,
    peakLook,
    endEye: cam.currentPosition.y,
    endLook: cam.currentLookTarget.y,
  };
};

describe('M8.3 spider-swap camera continuity', () => {
  it('the armed glide starts with ~zero velocity (no cut on frame one)', () => {
    const legacy = runSwap(new ChaseCamera(), false);
    const glided = runSwap(new ChaseCamera(), true);
    // Smootherstep starts flat: the first frame must cover a negligible
    // fraction of what the legacy exponential path covers immediately.
    expect(glided.firstEye).toBeLessThan(legacy.firstEye * 0.05);
    expect(glided.firstLook).toBeLessThan(legacy.firstLook * 0.05);
  });

  it('the armed glide peaks far below the legacy whip (eye and look)', () => {
    const legacy = runSwap(new ChaseCamera(), false);
    const glided = runSwap(new ChaseCamera(), true);
    expect(glided.peakEye).toBeLessThan(legacy.peakEye * 0.5);
    expect(glided.peakLook).toBeLessThan(legacy.peakLook * 0.5);
  });

  it('the glide converges to the exact same endpoints', () => {
    const legacy = runSwap(new ChaseCamera(), false);
    const glided = runSwap(new ChaseCamera(), true);
    expect(glided.endEye).toBeCloseTo(legacy.endEye, 6);
    expect(glided.endLook).toBeCloseTo(legacy.endLook, 6);
  });

  it('snapTo cuts the envelope (teleports/respawn never glide)', () => {
    const cam = new ChaseCamera();
    cam.snapTo(vec3(0, 0.55, 100), 0, 'aboveFocus');
    cam.noteSpiderSwap();
    cam.update(vec3(0, 5.45, 100), 0, DT, 'belowFocus');
    const midY = cam.currentPosition.y;
    // A snap mid-glide cuts straight to the desired framing.
    cam.snapTo(vec3(0, 5.45, 100), 0, 'belowFocus');
    const desiredY = 5.45 * 0.35 + -0.3;
    expect(cam.currentPosition.y).toBeCloseTo(desiredY, 6);
    expect(cam.currentPosition.y).not.toBeCloseTo(midY, 1);
  });

  it('the envelope lasts one glide window, then legacy rates resume', () => {
    const cam = new ChaseCamera();
    cam.snapTo(vec3(0, 0.55, 100), 0, 'aboveFocus');
    cam.noteSpiderSwap();
    // Exhaust the envelope with tiny steps (player static — only the
    // clock advances; the blend holds the pose on its target).
    const steps = Math.ceil(SPIDER_SWAP_GLIDE_SECONDS / DT) + 5;
    for (let i = 0; i < steps; i++) cam.update(vec3(0, 0.55, 100), 0, DT, 'aboveFocus');
    // After the window, a fresh swap-sized error corrects at legacy rate:
    // one frame must cover the legacy first-frame fraction (≈ look λ=9).
    const before = cam.currentLookTarget.y;
    cam.update(vec3(0, 5.45, 100), 0, DT, 'belowFocus');
    const after = cam.currentLookTarget.y;
    // Legacy look lambda covers 1−e^(−9/60) ≈ 13.9% of the 3.7 u
    // desired jump (0.515) — the exact legacy first-frame fraction.
    expect(after - before).toBeCloseTo(0.515, 2);
  });
});
