import { describe, expect, it } from 'vitest';
import {
  GRAVITY_LESSONS_BEAT_OFFSET,
  GRAVITY_LESSONS_BEAT_PERIOD,
  GRAVITY_LESSONS_BPM,
  GRAVITY_LESSONS_DURATION,
  GRAVITY_LESSONS_FINAL_BEAT,
  GRAVITY_LESSONS_FINAL_TIME,
  GRAVITY_LESSONS_ANCHORS,
  GRAVITY_LESSONS_SECTIONS,
  beatAtTime,
  beatPhase,
  beatTime,
  sectionAtTime,
  targetMusicTime,
  validateMusicMap,
} from '../src/audio/musicTrack';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import type { LevelDefinition } from '../src/level/levelDefinition';

/**
 * M9 music-map contract: the authored Gravity Lessons timeline (measured
 * locally from the shipped file — 120 BPM, beat 0 at 0.06 s, final impact
 * beat 230 at 115.06 s). Pure data + pure beat math: no audio, no clocks,
 * no DOM. Gameplay never reads this module (authority boundary).
 */
describe('music track map (M9 Gravity Lessons)', () => {
  it('declares the measured constants', () => {
    expect(GRAVITY_LESSONS_BPM).toBe(120);
    expect(GRAVITY_LESSONS_BEAT_PERIOD).toBe(0.5);
    expect(GRAVITY_LESSONS_BEAT_OFFSET).toBe(0.06);
    expect(GRAVITY_LESSONS_DURATION).toBe(121.574);
    expect(GRAVITY_LESSONS_FINAL_BEAT).toBe(230);
    expect(GRAVITY_LESSONS_FINAL_TIME).toBeCloseTo(115.06, 9);
  });

  it('maps integer beats to the measured grid', () => {
    expect(beatTime(0)).toBeCloseTo(0.06, 9);
    expect(beatTime(2)).toBeCloseTo(1.06, 9); // first strong onset
    // Drop-A impact measured at 19.0 s in a 0.5 s window — grid beat 38
    // (19.06 s) sits inside that window.
    expect(beatTime(38)).toBeCloseTo(19.06, 9);
    expect(beatTime(92)).toBeCloseTo(46.06, 9); // drop-B impact window
    expect(beatTime(184)).toBeCloseTo(92.06, 9); // climax impact window
    expect(beatTime(230)).toBeCloseTo(115.06, 9); // final impact
  });

  it('inverts grid times back to beats', () => {
    expect(beatAtTime(0.06)).toBe(0);
    expect(beatAtTime(1.06)).toBe(2);
    expect(beatAtTime(115.06)).toBe(230);
    expect(beatAtTime(-5)).toBe(0);
    expect(beatPhase(19.06)).toBeLessThan(0.01);
    expect(beatPhase(19.06 + 0.25)).toBeCloseTo(0.5, 9);
  });

  it('resolves the measured arrangement sections', () => {
    expect(sectionAtTime(0).id).toBe('count-in');
    expect(sectionAtTime(2.0).id).toBe('intro');
    expect(sectionAtTime(19.0).id).toBe('drop-a');
    expect(sectionAtTime(41.5).id).toBe('break');
    expect(sectionAtTime(46.0).id).toBe('drop-b');
    expect(sectionAtTime(56.0).id).toBe('breakdown');
    expect(sectionAtTime(74.0).id).toBe('build');
    expect(sectionAtTime(92.0).id).toBe('climax');
    expect(sectionAtTime(112.0).id).toBe('outro');
    expect(sectionAtTime(115.06).id).toBe('outro');
  });

  it('validates structurally (contiguous sections, anchors in range)', () => {
    expect(validateMusicMap()).toBeNull();
    expect(GRAVITY_LESSONS_SECTIONS[0]?.startBeat).toBe(0);
    const last = GRAVITY_LESSONS_SECTIONS[GRAVITY_LESSONS_SECTIONS.length - 1];
    expect(last?.endBeat).toBe(231);
    const times = GRAVITY_LESSONS_ANCHORS.map((a) => a.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('derives the deterministic target from sim time (sim-time master)', () => {
    expect(targetMusicTime(0, 0)).toBe(0);
    expect(targetMusicTime(10.5, 0)).toBeCloseTo(10.5, 12);
    expect(targetMusicTime(10.5, 1.25)).toBeCloseTo(11.75, 12);
    expect(targetMusicTime(-1, 0)).toBe(0);
  });

  it('keeps music binding + cue beat anchors out of the gameplay fingerprint', () => {
    const base = computeLevelFingerprint(PRODUCTION_SHOWCASE_01);
    const stripped: LevelDefinition = { ...PRODUCTION_SHOWCASE_01, musicTrack: undefined };
    expect(computeLevelFingerprint(stripped)).toBe(base);
    const rebound: LevelDefinition = {
      ...PRODUCTION_SHOWCASE_01,
      musicTrack: { audioPath: 'audio/Other.mp3', trackOffset: 3 },
    };
    expect(computeLevelFingerprint(rebound)).toBe(base);
    const cues = (PRODUCTION_SHOWCASE_01.rhythmCues ?? []).map((c) => ({ ...c, beat: 100 }));
    const rebeated: LevelDefinition = { ...PRODUCTION_SHOWCASE_01, rhythmCues: cues };
    expect(computeLevelFingerprint(rebeated)).toBe(base);
  });
});
