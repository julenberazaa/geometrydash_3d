import {
  GRAVITY_LESSONS_BEAT_OFFSET,
  GRAVITY_LESSONS_BEAT_PERIOD,
  sectionAtTime as gravitySectionAtTime,
  type MusicSection,
} from './musicTrack';

/**
 * Zenith of the Path music map (M9.5) — the authored musical timeline of
 * `public/audio/Zenith_of_the_Path.mp3`, measured locally from the shipped
 * file (see `specs/milestones/M9_5_DESCENT_ZENITH_DENSITY_POLISH.md` §5).
 *
 * Same contract as `musicTrack.ts` (Gravity Lessons): THREE-free,
 * DOM-free, clock-free pure data + pure beat/section math. The simulation
 * NEVER imports this for gameplay; presentation (MusicDirector targets,
 * rhythm pulses, alignment tooling) reads it. No audio ships here.
 *
 * Measured facts: stable 120 BPM (0.5 s onset grid, phase +0.03 s),
 * entry hit 4.03 s, drop-a 20.03 s, drop-b 40.03 s, climax 56.03 s,
 * breakdown 72–92 s (quietest 2 s @74), build 92.03–108.03 s (fakeout
 * gap 105.78→108.03), finale 108.03–123.78 s, digital silence from
 * ≈124.7 s to the 127.713 s file end.
 */

export const ZENITH_BPM = 120;
/** Beat period in seconds. */
export const ZENITH_BEAT_PERIOD = 0.5;
/** Track time of beat 0 (grid phase — onset grid at +0.03 s). */
export const ZENITH_BEAT_OFFSET = 0.03;
/** Decoded file duration in seconds (ffprobe 127.712583). */
export const ZENITH_DURATION = 127.713;
/** Level-facing audio path (mirrors the Gravity Lessons convention). */
export const ZENITH_AUDIO_PATH = '/audio/Zenith_of_the_Path.mp3';
/** Final musical peak the finish sits near (last strong onset). */
export const ZENITH_FINAL_PEAK = 123.78;
/** Track time from which the file is digital silence (≈). */
export const ZENITH_SILENCE_START = 124.7;

/**
 * The Zenith arrangement as beat ranges (endBeat exclusive, contiguous —
 * section identity is a pure function of the beat index). Energy
 * vocabulary shared with `musicTrack.ts` (`MusicEnergy`); ids reuse the
 * Gravity semantic names where the energy matches so the shared
 * section-entry impact envelope fires on the same musical meanings
 * (see `rhythmPulse.ts` IMPACT_SECTIONS, incl. the Zenith-only
 * 'finale').
 */
export const ZENITH_SECTIONS: readonly MusicSection[] = [
  { id: 'count-in', startBeat: 0, endBeat: 8, energy: 'silence', label: 'Silence / count-in (entry hit beat 8)' },
  { id: 'intro', startBeat: 8, endBeat: 40, energy: 'groove', label: 'Intro groove (sparse onsets)' },
  { id: 'drop-a', startBeat: 40, endBeat: 72, energy: 'loud', label: 'Drop A (0.5 s grid from 20.03)' },
  { id: 'break', startBeat: 72, endBeat: 80, energy: 'break', label: 'Break dip (~36 s)' },
  { id: 'drop-b', startBeat: 80, endBeat: 112, energy: 'loud', label: 'Drop B (0.5 s grid from 40.03)' },
  { id: 'climax', startBeat: 112, endBeat: 144, energy: 'loud', label: 'Climax (loudest, dense grid to 72.04)' },
  { id: 'breakdown', startBeat: 144, endBeat: 184, energy: 'quiet', label: 'Breakdown (quiet, build from ~76 s)' },
  { id: 'build', startBeat: 184, endBeat: 216, energy: 'build', label: 'Build (rising from 92.03, fakeout gap 105.78-108.03)' },
  { id: 'finale', startBeat: 216, endBeat: 248, energy: 'loud', label: 'Finale (dense grid 108.03-123.78)' },
  { id: 'outro', startBeat: 248, endBeat: 256, energy: 'outro', label: 'Outro decay into digital silence (~124.7)' },
];

/** Explicit non-grid anchors (entries + finale) as track seconds. */
export const ZENITH_ANCHORS: readonly { id: string; time: number; label: string }[] = [
  { id: 'intro-entry', time: 4.03, label: 'Intro entry hit' },
  { id: 'drop-a-hit', time: 20.03, label: 'Drop A impact (0.5 s grid start)' },
  { id: 'break-dip', time: 36.0, label: 'Break dip' },
  { id: 'drop-b-hit', time: 40.03, label: 'Drop B impact' },
  { id: 'climax-hit', time: 56.03, label: 'Climax impact (loudest)' },
  { id: 'breakdown-start', time: 72.04, label: 'Breakdown start (last climax peak)' },
  { id: 'build-rise', time: 92.03, label: 'Build rise audible' },
  { id: 'fakeout-gap', time: 105.78, label: 'Pre-finale fakeout gap start' },
  { id: 'finale-hit', time: 108.03, label: 'Finale impact' },
  { id: 'final-peak', time: ZENITH_FINAL_PEAK, label: 'Final peak (finish sits ~0.5 s before)' },
  { id: 'silence-start', time: ZENITH_SILENCE_START, label: 'Digital silence start' },
];

/** Track time in seconds of an integer beat index. */
export const zenithBeatTime = (beat: number): number =>
  ZENITH_BEAT_OFFSET + beat * ZENITH_BEAT_PERIOD;

/** Nearest integer beat index at a track time (clamped ≥ 0). */
export const zenithBeatAtTime = (timeSeconds: number): number =>
  Math.max(0, Math.round((timeSeconds - ZENITH_BEAT_OFFSET) / ZENITH_BEAT_PERIOD));

/** Section active at a track time (last section with startBeat ≤ beat). */
export const zenithSectionAtTime = (timeSeconds: number): MusicSection => {
  const beat = zenithBeatAtTime(timeSeconds);
  let active: MusicSection = ZENITH_SECTIONS[0] as MusicSection;
  for (const section of ZENITH_SECTIONS) {
    if (section.startBeat <= beat) active = section;
    else break;
  }
  return active;
};

/**
 * Validate the authored map structurally (sections contiguous/ordered,
 * anchors inside the file, finale consistent with the measured grid).
 * Returns a reason string when invalid, null when valid.
 */
export const validateZenithMap = (): string | null => {
  let prevEnd = 0;
  for (const section of ZENITH_SECTIONS) {
    if (section.startBeat !== prevEnd) return `section ${section.id} starts at ${section.startBeat}, expected ${prevEnd}`;
    if (section.endBeat <= section.startBeat) return `section ${section.id} has empty beat range`;
    prevEnd = section.endBeat;
  }
  for (const anchor of ZENITH_ANCHORS) {
    if (anchor.time < 0 || anchor.time > ZENITH_DURATION) {
      return `anchor ${anchor.id} at ${anchor.time}s outside the track`;
    }
  }
  const finale = ZENITH_ANCHORS.find((a) => a.id === 'finale-hit');
  if (finale === undefined || Math.abs(finale.time - zenithBeatTime(216)) > 1e-9) {
    return 'finale-hit anchor disagrees with beat 216';
  }
  return null;
};

/**
 * Per-track beat grid (M9.5): the rhythm layer resolves WHICH track's
 * grid/sections to evaluate from the level's declared `musicTrack`
 * audio path. Gravity Lessons stays the default so trackless levels and
 * every existing caller behave byte-identically.
 */
export interface TrackGrid {
  readonly beatOffset: number;
  readonly beatPeriod: number;
  readonly beatAtTime: (timeSeconds: number) => number;
  readonly sectionAtTime: (timeSeconds: number) => MusicSection;
}

export const GRAVITY_GRID: TrackGrid = {
  beatOffset: GRAVITY_LESSONS_BEAT_OFFSET,
  beatPeriod: GRAVITY_LESSONS_BEAT_PERIOD,
  beatAtTime: (timeSeconds: number): number =>
    Math.max(0, Math.round((timeSeconds - GRAVITY_LESSONS_BEAT_OFFSET) / GRAVITY_LESSONS_BEAT_PERIOD)),
  sectionAtTime: gravitySectionAtTime,
};

export const ZENITH_GRID: TrackGrid = {
  beatOffset: ZENITH_BEAT_OFFSET,
  beatPeriod: ZENITH_BEAT_PERIOD,
  beatAtTime: zenithBeatAtTime,
  sectionAtTime: zenithSectionAtTime,
};

/** Resolve the beat grid for a level's music-track audio path. */
export const gridForAudioPath = (audioPath: string | null | undefined): TrackGrid =>
  audioPath === ZENITH_AUDIO_PATH ? ZENITH_GRID : GRAVITY_GRID;

/**
 * Restrained per-track rhythm-pulse scale (M9.5): GRAVITY RIFT keeps the
 * full M9.1 overdrive response (1.0); THE DESCENT answers the same pulse
 * engine on the Zenith grid at a cleaner 0.55 (no white-flash spam, no
 * visual-overdrive identity copy). Applied multiplicatively to the pulse
 * legs only — at 1.0 the math is FP-exact, so Gravity behavior is
 * byte-identical.
 */
export const pulseScaleForAudioPath = (audioPath: string | null | undefined): number =>
  audioPath === ZENITH_AUDIO_PATH ? 0.55 : 1.0;
