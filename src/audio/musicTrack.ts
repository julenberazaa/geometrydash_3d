/**
 * Gravity Lessons music map (M9) — the authored musical timeline of
 * `public/audio/Gravity_Lessons.mp3`, measured locally from the shipped
 * file (see `specs/milestones/M9_GRAVITY_LESSONS_RHYTHM_POLISH.md` §3).
 *
 * THREE-free, DOM-free, clock-free: pure data + pure beat/section math.
 * The simulation NEVER imports this for gameplay (authority boundary —
 * gameplay is authored to MATCH this map, never driven by it); the
 * presentation layer (MusicDirector target time, rhythm pulses, alignment
 * tooling) reads it. No audio ships in this module — no playback, no
 * analyser, no FFT.
 *
 * Measured facts: stable 120 BPM, beat k at 0.06 + 0.5·k seconds, first
 * sustained sound ≈ 0.95 s, final impact (beat 230) at 115.06 s, digital
 * silence from ≈ 115.3 s to the 121.574 s file end.
 */

/** Beats per minute (stable across the whole track — verified by grid fit). */
export const GRAVITY_LESSONS_BPM = 120;
/** Beat period in seconds. */
export const GRAVITY_LESSONS_BEAT_PERIOD = 0.5;
/** Track time of beat 0 (grid phase — verified across all sections). */
export const GRAVITY_LESSONS_BEAT_OFFSET = 0.06;
/** Decoded file duration in seconds (ffprobe 121.573833). */
export const GRAVITY_LESSONS_DURATION = 121.574;
/** Final musical impact: beat index the finish is authored against. */
export const GRAVITY_LESSONS_FINAL_BEAT = 230;
/** Track time of the final impact (0.06 + 230·0.5). */
export const GRAVITY_LESSONS_FINAL_TIME = 115.06;
/** Last track time carrying sustained musical content (≈). */
export const GRAVITY_LESSONS_MUSIC_END = 115.3;

/**
 * Production music output volume (M9.1 — SINGLE owner). The MusicDirector
 * defaults to this; death SFX stays subordinate (peak 0.1). No scattered
 * music gains exist anywhere else in the codebase.
 */
export const MUSIC_DEFAULT_VOLUME = 0.9;

/** Musical energy tier driving presentation density (authored, not heard). */
export type MusicEnergy = 'silence' | 'groove' | 'loud' | 'break' | 'quiet' | 'build' | 'outro';

/** ONE authored song section: a beat range with an energy tier. */
export interface MusicSection {
  /** Stable identifier (debug/QA/F1). */
  id: string;
  /** First beat index (inclusive). */
  startBeat: number;
  /** Beat index where the next section takes over (exclusive). */
  endBeat: number;
  /** Presentation energy tier. */
  energy: MusicEnergy;
  /** Human-readable arrangement note. */
  label: string;
}

/**
 * The Gravity Lessons arrangement as beat ranges (endBeat is exclusive;
 * contiguous — section identity is a pure function of the beat index).
 */
export const GRAVITY_LESSONS_SECTIONS: readonly MusicSection[] = [
  { id: 'count-in', startBeat: 0, endBeat: 4, energy: 'silence', label: 'Silence / count-in (first hit beat 2)' },
  { id: 'intro', startBeat: 4, endBeat: 38, energy: 'groove', label: 'Intro groove (moderate 8ths)' },
  { id: 'drop-a', startBeat: 38, endBeat: 83, energy: 'loud', label: 'Drop A (+7dB hit at beat 38)' },
  { id: 'break', startBeat: 83, endBeat: 92, energy: 'break', label: 'Break / stutter (dips + hits)' },
  { id: 'drop-b', startBeat: 92, endBeat: 112, energy: 'loud', label: 'Drop B (loudest)' },
  { id: 'breakdown', startBeat: 112, endBeat: 148, energy: 'quiet', label: 'Breakdown (quiet, strange gravity)' },
  { id: 'build', startBeat: 148, endBeat: 184, energy: 'build', label: 'Build (rising from ~beat 176)' },
  { id: 'climax', startBeat: 184, endBeat: 224, energy: 'loud', label: 'Climax (loud sustained)' },
  { id: 'outro', startBeat: 224, endBeat: 231, energy: 'outro', label: 'Outro decay into beat-230 impact' },
];

/** Explicit non-grid anchors (stutter hits + finale) as track seconds. */
export const GRAVITY_LESSONS_ANCHORS: readonly { id: string; time: number; label: string }[] = [
  { id: 'intro-hit', time: 2.0, label: 'Intro groove entry (+6.8dB)' },
  { id: 'drop-a-hit', time: 19.0, label: 'Drop A impact (+7.2dB)' },
  { id: 'break-dip', time: 41.5, label: 'Break dip (−9.1dB)' },
  { id: 'stutter-1', time: 42.0, label: 'Stutter hit 1 (+15.7dB)' },
  { id: 'stutter-2', time: 44.0, label: 'Stutter hit 2 (+13.5dB)' },
  { id: 'drop-b-hit', time: 46.0, label: 'Drop B impact (+7.9dB)' },
  { id: 'breakdown-dip', time: 56.0, label: 'Breakdown entry' },
  { id: 'build-rise', time: 88.0, label: 'Build rise audible' },
  { id: 'climax-hit', time: 92.0, label: 'Climax impact' },
  { id: 'outro-start', time: 112.0, label: 'Outro decay (−6.1dB)' },
  { id: 'final-impact', time: GRAVITY_LESSONS_FINAL_TIME, label: 'Final impact (beat 230)' },
];

/** Track time in seconds of an integer beat index. */
export const beatTime = (beat: number): number =>
  GRAVITY_LESSONS_BEAT_OFFSET + beat * GRAVITY_LESSONS_BEAT_PERIOD;

/** Nearest integer beat index at a track time (clamped ≥ 0). */
export const beatAtTime = (timeSeconds: number): number =>
  Math.max(0, Math.round((timeSeconds - GRAVITY_LESSONS_BEAT_OFFSET) / GRAVITY_LESSONS_BEAT_PERIOD));

/** Fractional beat phase at a track time (0 = exactly on a beat). */
export const beatPhase = (timeSeconds: number): number => {
  const rel = (timeSeconds - GRAVITY_LESSONS_BEAT_OFFSET) / GRAVITY_LESSONS_BEAT_PERIOD;
  const frac = rel - Math.floor(rel);
  return Math.min(frac, 1 - frac);
};

/** Section active at a track time (last section with startBeat ≤ beat). */
export const sectionAtTime = (timeSeconds: number): MusicSection => {
  const beat = beatAtTime(timeSeconds);
  let active: MusicSection = GRAVITY_LESSONS_SECTIONS[0] as MusicSection;
  for (const section of GRAVITY_LESSONS_SECTIONS) {
    if (section.startBeat <= beat) active = section;
    else break;
  }
  return active;
};

/**
 * Sim-time master (M9 authority rule): the EXPECTED musical time for a
 * deterministic simulation time. Audio OUTPUT follows this value; the
 * simulation never follows audio output.
 */
export const targetMusicTime = (simTimeSeconds: number, trackOffsetSeconds: number): number =>
  Math.max(0, simTimeSeconds + trackOffsetSeconds);

/**
 * Validate the authored map structurally (sections contiguous/ordered,
 * anchors inside the file, finale consistent with beat 230).
 * Returns a reason string when invalid, null when valid.
 */
export const validateMusicMap = (): string | null => {
  let prevEnd = 0;
  for (const section of GRAVITY_LESSONS_SECTIONS) {
    if (section.startBeat !== prevEnd) return `section ${section.id} starts at ${section.startBeat}, expected ${prevEnd}`;
    if (section.endBeat <= section.startBeat) return `section ${section.id} has empty beat range`;
    prevEnd = section.endBeat;
  }
  for (const anchor of GRAVITY_LESSONS_ANCHORS) {
    if (anchor.time < 0 || anchor.time > GRAVITY_LESSONS_DURATION) {
      return `anchor ${anchor.id} at ${anchor.time}s outside the track`;
    }
  }
  const finale = GRAVITY_LESSONS_ANCHORS.find((a) => a.id === 'final-impact');
  if (finale === undefined || Math.abs(finale.time - beatTime(GRAVITY_LESSONS_FINAL_BEAT)) > 1e-9) {
    return 'final-impact anchor disagrees with beat 230';
  }
  return null;
};
