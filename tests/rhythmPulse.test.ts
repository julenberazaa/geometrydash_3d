import { describe, expect, it } from 'vitest';
import {
  clearRhythmImpact,
  evaluateRhythmPulse,
  makeRhythmImpactState,
  makeRhythmPulse,
  updateRhythmImpact,
} from '../src/visuals/rhythmPulse';
import { beatTime } from '../src/audio/musicTrack';

/**
 * M9 rhythm-pulse contract (presentation only): deterministic beat-grid
 * envelopes from sim-time music time — no audio reads, no wall clocks.
 * Pure function of time (pause/replay-safe), bounded 0..1, smooth decays
 * (no strobing), section-energy hierarchy (loud pumps, quiet barely).
 */
describe('rhythm pulse (M9 deterministic beat envelopes)', () => {
  it('peaks on grid lines and decays smoothly', () => {
    const out = makeRhythmPulse();
    evaluateRhythmPulse(beatTime(39), out);
    expect(out.beat).toBeCloseTo(1, 9);
    expect(out.eighth).toBeCloseTo(1, 9);
    // Halfway to the next 8th (0.125 s): both decayed, eighths faster.
    evaluateRhythmPulse(beatTime(39) + 0.125, out);
    expect(out.beat).toBeCloseTo(Math.exp(-0.125 * 7), 9);
    expect(out.eighth).toBeCloseTo(Math.exp(-0.125 * 9), 9);
    expect(out.eighth).toBeLessThan(out.beat);
  });

  it('marks bars every 4th beat', () => {
    const out = makeRhythmPulse();
    evaluateRhythmPulse(beatTime(100), out); // downbeat (drop-B re-entry)
    expect(out.downbeat).toBeCloseTo(1, 9);
    evaluateRhythmPulse(beatTime(101), out);
    expect(out.downbeat).toBeLessThan(0.1);
    expect(out.downbeat).toBeGreaterThan(0);
  });

  it('stays bounded 0..1 across the whole track', () => {
    const out = makeRhythmPulse();
    for (let t = 0; t <= 122; t += 0.05) {
      evaluateRhythmPulse(t, out);
      for (const v of [out.eighth, out.beat, out.downbeat, out.drop]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is a pure function of time (pause/replay parity)', () => {
    const a = makeRhythmPulse();
    const b = makeRhythmPulse();
    evaluateRhythmPulse(73.13, a);
    evaluateRhythmPulse(73.13, b);
    expect(a).toEqual(b);
    // Same time re-resolves identically (no accumulation, no drift).
    evaluateRhythmPulse(73.5, a);
    evaluateRhythmPulse(73.13, a);
    expect(a).toEqual(b);
  });

  it('pumps with section energy (loud breathes, quiet barely)', () => {
    const out = makeRhythmPulse();
    evaluateRhythmPulse(beatTime(100), out); // drop-b
    expect(out.sectionId).toBe('drop-b');
    const loudDrop = out.drop;
    expect(loudDrop).toBeCloseTo(1, 9);
    evaluateRhythmPulse(beatTime(130), out); // breakdown
    expect(out.sectionId).toBe('breakdown');
    expect(out.drop).toBeLessThan(loudDrop * 0.3);
    evaluateRhythmPulse(beatTime(200), out); // climax
    expect(out.sectionId).toBe('climax');
    expect(out.drop).toBeGreaterThan(0.9);
  });

  it('fires the impact envelope on loud-section entry only', () => {
    const state = makeRhythmImpactState();
    // Beat 37 (intro) arrives with no impact; beat 38 (drop-a) fires.
    // (Section identity rounds to the nearest beat — the hit anticipates
    // the boundary by up to an 8th, which reads as musical, never late.)
    updateRhythmImpact(state, 18.5, 0); // intro arrival
    expect(state.energy).toBe(0);
    updateRhythmImpact(state, 19.1, 0); // drop-a entry
    expect(state.energy).toBe(1);
    updateRhythmImpact(state, 19.1, 1); // 1 s decay
    expect(state.energy).toBeCloseTo(Math.exp(-1.8), 9);
    updateRhythmImpact(state, 56.5, 0); // breakdown entry: no fire
    expect(state.energy).toBeCloseTo(Math.exp(-1.8), 9);
    updateRhythmImpact(state, 56.5, 10); // exact rest
    expect(state.energy).toBe(0);
    updateRhythmImpact(state, 92.1, 0); // climax entry fires again
    expect(state.energy).toBe(1);
    clearRhythmImpact(state);
    expect(state.energy).toBe(0);
  });

  it('freezes the impact with dt 0 (presentation-pause parity)', () => {
    const state = makeRhythmImpactState();
    updateRhythmImpact(state, 19.1, 0);
    updateRhythmImpact(state, 30, 0);
    expect(state.energy).toBe(1);
  });

  it('uses no wall-clock identity (module contains no timers)', () => {
    const modules = import.meta.glob('../src/visuals/rhythmPulse.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    });
    const raw = Object.values(modules).filter((s): s is string => typeof s === 'string')[0] ?? '';
    expect(raw.length).toBeGreaterThan(0);
    const source = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toContain('Date.now');
    expect(source).not.toContain('performance.now');
    expect(source).not.toContain('setTimeout');
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('requestAnimationFrame');
    expect(source).not.toContain('currentTime');
  });
});
