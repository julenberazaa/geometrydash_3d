import { describe, it, expect } from 'vitest';
import { FixedStepLoop } from '../src/core/FixedStepLoop';
import { MAX_CATCHUP_STEPS_PER_FRAME } from '../src/core/constants';

/**
 * Synthetic frame pump: feeds pre-recorded frame times into the loop, like a
 * browser running at a given refresh rate. Fully deterministic (no real clock).
 */
class ManualFrameClock {
  public time = 0;
  private queued: Array<(nowMs: number) => void> = [];

  public readonly requester = (cb: (nowMs: number) => void): void => {
    this.queued.push(cb);
  };

  public readonly now = (): number => this.time;

  /** Advance one rendered frame of `frameDtMs` and pump the loop. */
  public tick(frameDtMs: number): number {
    const pending = this.queued;
    this.queued = [];
    this.time += frameDtMs;
    for (const cb of pending) cb(this.time);
    return this.time;
  }
}

const makeLoop = (
  clock: ManualFrameClock,
  onUpdate: (dt: number) => void,
): FixedStepLoop =>
  new FixedStepLoop(
    { update: onUpdate, render: () => {} },
    { frameRequester: clock.requester, now: clock.now },
  );

describe('FixedStepLoop — fixed timestep invariance', () => {
  it('runs one step per nominal step of simulated time at high render rates', () => {
    const clock = new ManualFrameClock();
    let steps = 0;
    const loop = makeLoop(clock, () => steps++);
    loop.start();

    // Exactly 1 second of wall time at ~120 FPS frames.
    for (let i = 0; i < 120; i++) clock.tick(1000 / 120);
    // Accumulator rounding may lose at most the sub-step remainder (<1 step).
    expect(steps).toBeGreaterThanOrEqual(119);
    expect(steps).toBeLessThanOrEqual(120);
    loop.stop();
  });

  it('produces equivalent simulated time across 30/60/120/144 FPS render cadences', () => {
    const cadenceMs: Array<[string, number]> = [
      ['30fps', 1000 / 30],
      ['60fps', 1000 / 60],
      ['120fps', 1000 / 120],
      ['144fps', 1000 / 144],
    ];
    const results: Array<{ name: string; steps: number }> = [];

    for (const [name, dt] of cadenceMs) {
      const clock = new ManualFrameClock();
      let steps = 0;
      const loop = makeLoop(clock, () => steps++);
      loop.start();
      // Feed exactly 5 seconds of wall time in whole-number frame counts.
      const frames = Math.round((5 * 1000) / dt);
      for (let i = 0; i < frames; i++) clock.tick(dt);
      loop.stop();
      results.push({ name, steps });
    }

    // INTEGER step-count invariant (deliberately not seconds-based).
    // 5 s at 120 Hz is exactly 600 steps. The only legitimate loss is the
    // final accumulator remainder (< 1 step) plus at most ~1 step of
    // floating-point edge from inexact frame deltas (e.g. 1000/30 ms is not
    // representable in binary). A previous seconds-based assertion
    // (`|simSeconds - 5| < 3 * SIMULATION_DT`) failed by 3.5e-16 on the 30 FPS
    // cadence for TWO compounding reasons, both fixed, neither by loosening:
    //   1. the catch-up cap used to equal the exact 30 FPS need (4 steps),
    //      so FP jitter pushed carried time into the spiral-of-death discard
    //      and dropped whole simulation steps (fixed by headroom in the cap);
    //   2. `steps * SIMULATION_DT` in floating point can exceed the decimal
    //      threshold by 1 ulp even for the ideal count (fixed by asserting
    //      exact integer counts instead of FP seconds).
    for (const r of results) {
      expect(r.steps).toBeGreaterThanOrEqual(598);
      expect(r.steps).toBeLessThanOrEqual(600);
    }
    // Cadences must also agree with EACH OTHER: render rate must not change
    // the simulated trajectory (max spread 2 steps ~= 16.7 ms over 5 s).
    const counts = results.map((r) => r.steps);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });

  it('clamps pathological frame deltas (backgrounded tab)', () => {
    const clock = new ManualFrameClock();
    let steps = 0;
    const loop = makeLoop(clock, () => steps++);
    loop.start();
    // Simulate tab hidden for 10 seconds: single giant delta.
    clock.tick(10_000);
    // Bounded by the catch-up cap regardless of delta size.
    expect(steps).toBe(MAX_CATCHUP_STEPS_PER_FRAME);
    loop.stop();
  });

  it('does not spiral of death: long frames run bounded steps', () => {
    const clock = new ManualFrameClock();
    let steps = 0;
    const loop = makeLoop(clock, () => steps++);
    loop.start();
    for (let i = 0; i < 20; i++) clock.tick(500); // twenty 0.5 s hitches
    expect(steps).toBe(20 * MAX_CATCHUP_STEPS_PER_FRAME); // capped each frame
    loop.stop();
  });

  it('interpolation alpha stays in [0,1) while running', () => {
    const clock = new ManualFrameClock();
    const alphas: number[] = [];
    const loop = new FixedStepLoop(
      { update: () => {}, render: (alpha) => alphas.push(alpha) },
      { frameRequester: clock.requester, now: clock.now },
    );
    loop.start();
    for (let i = 0; i < 50; i++) clock.tick(1000 / 120);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
    loop.stop();
  });

  it('alpha stays in range even under heavy batching (headless frames)', () => {
    const clock = new ManualFrameClock();
    const alphas: number[] = [];
    const loop = new FixedStepLoop(
      { update: () => {}, render: (alpha) => alphas.push(alpha) },
      { frameRequester: clock.requester, now: clock.now },
    );
    loop.start();
    // Headless-style long frames force max catch-up every frame; the leftover
    // accumulator is discarded so alpha must never exceed 1.
    for (let i = 0; i < 30; i++) clock.tick(200); // 5 steps' worth each
    expect(alphas.length).toBeGreaterThan(0);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
    loop.stop();
  });
});
