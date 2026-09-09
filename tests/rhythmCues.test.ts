import { describe, expect, it } from 'vitest';
import {
  cueAtZ,
  cueIdAtZ,
  prepareRhythmCues,
  type RhythmCue,
} from '../src/visuals/rhythmCues';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { VERTICAL_SLICE_01 } from '../src/content/levels/verticalSlice01';
import type { LevelDefinition } from '../src/level/levelDefinition';

/**
 * M7.1 beat-ready cue contract (presentation only — no audio ships).
 *
 * Cues bind semantic musical roles to authored forward positions so a
 * future song can map them onto beats/bars/drops. Identity is purely
 * positional (same z → same cue, no clocks); cues never reach the
 * simulation, the fingerprint, or ReplayV1.
 */

const SAMPLE: readonly RhythmCue[] = [
  { id: 'a-intro', z: -10, role: 'intro' },
  { id: 'a-hit', z: 100, role: 'gravityHit' },
  { id: 'a-drop', z: 200, role: 'drop' },
];

describe('rhythm cues (M7.1 beat-ready metadata)', () => {
  it('resolves the active cue purely from forward position', () => {
    const cues = prepareRhythmCues({ rhythmCues: [...SAMPLE] });
    expect(cueAtZ(cues, -11)).toBeNull();
    expect(cueAtZ(cues, -10)?.id).toBe('a-intro');
    expect(cueAtZ(cues, 99)?.id).toBe('a-intro');
    expect(cueAtZ(cues, 100)?.id).toBe('a-hit');
    expect(cueAtZ(cues, 500)?.id).toBe('a-drop');
  });

  it('sorts cues by z regardless of authoring order', () => {
    const cues = prepareRhythmCues({ rhythmCues: [...SAMPLE].reverse() });
    expect(cues.map((c) => c.id)).toEqual(['a-intro', 'a-hit', 'a-drop']);
    expect(cueIdAtZ(cues, 150)).toBe('a-hit');
  });

  it('is empty-safe (levels without cues resolve null)', () => {
    expect(prepareRhythmCues({}).length).toBe(0);
    expect(cueIdAtZ(prepareRhythmCues({}), 100)).toBeNull();
  });

  it('never affects the gameplay fingerprint', () => {
    const base = computeLevelFingerprint(VERTICAL_SLICE_01);
    const removed: LevelDefinition = { ...VERTICAL_SLICE_01, rhythmCues: undefined };
    expect(computeLevelFingerprint(removed)).toBe(base);
    const mutated: LevelDefinition = {
      ...VERTICAL_SLICE_01,
      rhythmCues: [{ id: 'x', z: 0, role: 'accent' }],
    };
    expect(computeLevelFingerprint(mutated)).toBe(base);
  });

  it('covers every mechanic hit and section boundary of the slice', () => {
    const cues = prepareRhythmCues(VERTICAL_SLICE_01);
    const roles = cues.map((c) => c.role);
    for (const role of ['intro', 'sectionChange', 'gravityHit', 'padHit', 'orbHit', 'drop', 'release', 'finish'] as const) {
      expect(roles, role).toContain(role);
    }
    const byId = new Map(cues.map((c) => [c.id, c]));
    // Mechanic hits coincide with their gameplay positions.
    expect(byId.get('m71-cue-gravity-hit')?.z).toBe(170);
    expect(byId.get('m71-cue-pad-ceiling')?.z).toBe(243);
    expect(byId.get('m71-cue-pad-floor')?.z).toBe(311);
    expect(byId.get('m71-cue-orb-jump')?.z).toBe(352);
    expect(byId.get('m71-cue-drop')?.z).toBe(518);
  });

  it('uses no wall-clock identity (module contains no timers)', () => {
    // Cue identity must stay mappable to simulation time later; wall-clock
    // calls here would break determinism. Structural pin on the module.
    // Strip comments first (the header documents the Date.now() ban itself).
    const modules = import.meta.glob('../src/visuals/rhythmCues.ts', {
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
    expect(cueIdAtZ(prepareRhythmCues(VERTICAL_SLICE_01), 285)).toBe('m71-cue-gravity-orb');
  });
});
