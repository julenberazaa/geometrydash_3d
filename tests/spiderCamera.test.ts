import { describe, it, expect } from 'vitest';
import {
  ChaseCamera,
  SPIDER_SWAP_GLIDE_SECONDS,
} from '../src/camera/ChaseCamera';
import { vec3 } from '../src/core/math';

/**
 * M8.2 Spider-camera smoothing (human playtest: Spider swaps whip harder
 * than gravity flips).
 *
 * Root cause: the Spider snap teleports the player (up to 14 u) AND flips
 * the framing side in one tick, while gravity portals move the player
 * continuously. The camera endpoints were always correct — the RATE was
 * the bug (look λ=9/s over a ~6 u desired jump). Fix: a 0.55 s
 * presentation-only glide envelope, armed ONLY by Spider-context swaps
 * (gravity-portal/Cube/Ship paths never arm it — pinned by the existing
 * cameraFraming suite running unarmed).
 */

const DT = 1 / 60;

/** A Spider-swap-like discontinuity: floor run pose -> ceiling pose. */
const runSwap = (cam: ChaseCamera, armed: boolean): { peakEye: number; peakLook: number; endEye: number; endLook: number } => {
  const floor = vec3(0, 0.55, 100);
  const ceil = vec3(0, 5.45, 100);
  cam.snapTo(floor, 0, 'aboveFocus');
  if (armed) cam.noteSpiderSwap();
  // The snap teleports the player; the framing side flips next frame.
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
    peakEye = Math.max(peakEye, Math.hypot(dx, dy));
    px = cam.currentPosition.x;
    py = cam.currentPosition.y;
    const qx = cam.currentLookTarget.x - lx;
    const qy = cam.currentLookTarget.y - ly;
    peakLook = Math.max(peakLook, Math.hypot(qx, qy));
    lx = cam.currentLookTarget.x;
    ly = cam.currentLookTarget.y;
  }
  return {
    peakEye,
    peakLook,
    endEye: cam.currentPosition.y,
    endLook: cam.currentLookTarget.y,
  };
};

describe('M8.2 spider-swap camera glide', () => {
  it('the armed glide whips less than the legacy path (eye and look)', () => {
    const legacy = runSwap(new ChaseCamera(), false);
    const glided = runSwap(new ChaseCamera(), true);
    // The envelope meaningfully slows the violent first frames (≥25%).
    expect(glided.peakEye).toBeLessThan(legacy.peakEye * 0.75);
    expect(glided.peakLook).toBeLessThan(legacy.peakLook * 0.75);
  });

  it('the glide converges to the exact same endpoints', () => {
    const legacy = runSwap(new ChaseCamera(), false);
    const glided = runSwap(new ChaseCamera(), true);
    expect(glided.endEye).toBeCloseTo(legacy.endEye, 6);
    expect(glided.endLook).toBeCloseTo(legacy.endLook, 6);
  });

  it('snapTo cuts the envelope (teleports never glide)', () => {
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
    // clock advances; displacement purely from prior state is nil).
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
