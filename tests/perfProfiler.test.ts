import { describe, expect, it } from 'vitest';
import { PerfProfiler } from '../src/debug/perfProfiler';

/**
 * M6D profiler regression: the DEBUG frame profiler must stay bounded,
 * allocation-free in the hot path, and statistically honest — without
 * altering gameplay behavior (it never touches the sim).
 */
describe('perf profiler bounded history', () => {
  it('holds at most capacity samples while the session total keeps growing', () => {
    const profiler = new PerfProfiler(64);
    expect(profiler.capacity).toBe(64);
    let now = 1000;
    for (let i = 0; i < 500; i++) {
      now += 16.7;
      profiler.recordFrame(now);
    }
    expect(profiler.samples).toBe(64);
    expect(profiler.framesTotal).toBe(500);
    const snap = profiler.snapshot();
    expect(snap.frames).toBe(64);
    expect(snap.capacity).toBe(64);
  });

  it('reports honest percentiles on a synthetic window', () => {
    const profiler = new PerfProfiler(128);
    let now = 0;
    // 100 steady 16.7 ms frames + 4 slow 40 ms frames.
    for (let i = 0; i < 100; i++) {
      now += 16.7;
      profiler.recordFrame(now);
    }
    for (let i = 0; i < 4; i++) {
      now += 40;
      profiler.recordFrame(now);
    }
    const snap = profiler.snapshot();
    // 104 calls arm the clock once, yielding 103 intervals.
    expect(snap.frames).toBe(103);
    expect(snap.p50).toBeCloseTo(16.7, 1);
    expect(snap.p95).toBeCloseTo(16.7, 1);
    expect(snap.p99).toBeCloseTo(40, 0);
    expect(snap.max).toBeCloseTo(40, 5);
    expect(snap.over25).toBe(4);
    expect(snap.over33).toBe(4);
    expect(snap.over50).toBe(0);
    expect(snap.fps).toBeGreaterThan(50);
  });

  it('beginSampling discards warmup but keeps the session total', () => {
    const profiler = new PerfProfiler(64);
    let now = 5000;
    for (let i = 0; i < 30; i++) {
      now += 200; // slow warmup frames
      profiler.recordFrame(now);
    }
    expect(profiler.samples).toBeGreaterThan(0);
    profiler.beginSampling();
    expect(profiler.samples).toBe(0);
    expect(profiler.framesTotal).toBe(30);
    now += 16.7;
    profiler.recordFrame(now); // arms only — no interval yet
    now += 16.7;
    profiler.recordFrame(now);
    const snap = profiler.snapshot();
    expect(snap.frames).toBe(1);
    expect(snap.over25).toBe(0);
  });

  it('empty snapshot is zeroed (profiler off / no frames yet)', () => {
    const snap = new PerfProfiler(32).snapshot();
    expect(snap.frames).toBe(0);
    expect(snap.fps).toBe(0);
    expect(snap.p99).toBe(0);
    expect(snap.max).toBe(0);
  });

  it('ignores clock jumps instead of recording garbage intervals', () => {
    const profiler = new PerfProfiler(32);
    profiler.recordFrame(1000);
    profiler.recordFrame(1016.7);
    profiler.recordFrame(9999999); // tab stall / clock jump
    const snap = profiler.snapshot();
    expect(snap.frames).toBe(1);
    expect(snap.max).toBeLessThan(100);
  });
});
