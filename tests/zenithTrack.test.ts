import { describe, it, expect } from 'vitest';
import {
  ZENITH_BEAT_OFFSET,
  ZENITH_BEAT_PERIOD,
  ZENITH_BPM,
  ZENITH_DURATION,
  ZENITH_AUDIO_PATH,
  ZENITH_SECTIONS,
  validateZenithMap,
  zenithBeatTime,
  zenithBeatAtTime,
  zenithSectionAtTime,
  gridForAudioPath,
  pulseScaleForAudioPath,
  GRAVITY_GRID,
  ZENITH_GRID,
} from '../src/audio/zenithTrack';
import {
  evaluateRhythmPulse,
  makeRhythmImpactState,
  makeRhythmPulse,
  updateRhythmImpact,
} from '../src/visuals/rhythmPulse';

/**
 * M9.5 Zenith track contract: the authored Zenith of the Path map is
 * structurally valid, the beat math matches the measured 120 BPM grid,
 * per-track resolution keeps Gravity Lessons the default, and the pulse
 * engine evaluates the Zenith grid (restrained scale on Descent only).
 */
describe('M9.5 Zenith track', () => {
  it('declares the measured track facts', () => {
    expect(ZENITH_BPM).toBe(120);
    expect(ZENITH_BEAT_PERIOD).toBe(0.5);
    expect(ZENITH_BEAT_OFFSET).toBe(0.03);
    expect(ZENITH_DURATION).toBe(127.713);
    expect(ZENITH_AUDIO_PATH).toBe('/audio/Zenith_of_the_Path.mp3');
  });

  it('ships a structurally valid section map', () => {
    expect(validateZenithMap()).toBeNull();
    // Contiguous beat coverage from 0.
    expect(ZENITH_SECTIONS[0]?.startBeat).toBe(0);
    for (let i = 1; i < ZENITH_SECTIONS.length; i++) {
      expect(ZENITH_SECTIONS[i]?.startBeat).toBe(ZENITH_SECTIONS[i - 1]?.endBeat);
    }
  });

  it('beats land on the measured onset grid', () => {
    // Measured impacts: drop-a 20.03, drop-b 40.03, climax 56.03, finale 108.03.
    expect(zenithBeatTime(40)).toBeCloseTo(20.03, 9);
    expect(zenithBeatTime(80)).toBeCloseTo(40.03, 9);
    expect(zenithBeatTime(112)).toBeCloseTo(56.03, 9);
    expect(zenithBeatTime(216)).toBeCloseTo(108.03, 9);
    expect(zenithBeatAtTime(20.03)).toBe(40);
    expect(zenithSectionAtTime(20.03).id).toBe('drop-a');
    expect(zenithSectionAtTime(40.03).id).toBe('drop-b');
    expect(zenithSectionAtTime(56.03).id).toBe('climax');
    expect(zenithSectionAtTime(74).id).toBe('breakdown');
    expect(zenithSectionAtTime(100).id).toBe('build');
    expect(zenithSectionAtTime(108.03).id).toBe('finale');
    expect(zenithSectionAtTime(126).id).toBe('outro');
  });

  it('resolves Gravity by default and Zenith by audio path', () => {
    expect(gridForAudioPath(null)).toBe(GRAVITY_GRID);
    expect(gridForAudioPath(undefined)).toBe(GRAVITY_GRID);
    expect(gridForAudioPath('/audio/Gravity_Lessons.mp3')).toBe(GRAVITY_GRID);
    expect(gridForAudioPath(ZENITH_AUDIO_PATH)).toBe(ZENITH_GRID);
    expect(gridForAudioPath('/audio/unknown.mp3')).toBe(GRAVITY_GRID);
  });

  it('restrains the Descent pulse scale and keeps Rift at 1.0', () => {
    expect(pulseScaleForAudioPath(null)).toBe(1.0);
    expect(pulseScaleForAudioPath('/audio/Gravity_Lessons.mp3')).toBe(1.0);
    expect(pulseScaleForAudioPath(ZENITH_AUDIO_PATH)).toBe(0.55);
  });

  it('evaluates the Zenith grid through the shared pulse engine', () => {
    const out = makeRhythmPulse();
    evaluateRhythmPulse(20.03, out, ZENITH_GRID);
    expect(out.sectionId).toBe('drop-a');
    expect(out.beat).toBeCloseTo(1, 9);
    evaluateRhythmPulse(74, out, ZENITH_GRID);
    expect(out.sectionId).toBe('breakdown');
    expect(out.drop).toBeLessThan(0.2);
    // Default (omitted grid) stays Gravity Lessons.
    evaluateRhythmPulse(19.06, out);
    expect(out.sectionId).toBe('drop-a');
  });

  it('fires section-entry impacts on Zenith loud sections incl. finale', () => {
    const state = makeRhythmImpactState();
    updateRhythmImpact(state, 19.4, 0, ZENITH_GRID); // intro arrival
    expect(state.energy).toBe(0);
    updateRhythmImpact(state, 20.1, 0, ZENITH_GRID); // drop-a entry
    expect(state.energy).toBe(1);
    updateRhythmImpact(state, 74, 0, ZENITH_GRID); // breakdown: no fire
    updateRhythmImpact(state, 74, 10, ZENITH_GRID); // exact rest
    expect(state.energy).toBe(0);
    updateRhythmImpact(state, 108.1, 0, ZENITH_GRID); // finale entry fires
    expect(state.energy).toBe(1);
  });
});
