import {
  GRAVITY_LESSONS_BEAT_OFFSET,
  GRAVITY_LESSONS_BEAT_PERIOD,
  sectionAtTime,
  type MusicEnergy,
} from '../audio/musicTrack';

/**
 * Rhythm pulse controller (M9) — deterministic music-reactive visual
 * modulation WITHOUT audio analysis. The pulse envelopes derive PURELY
 * from the deterministic sim-time-derived music time + the authored
 * Gravity Lessons beat grid/section map (`src/audio/musicTrack.ts`):
 * no AudioContext reads, no FFT, no wall clocks, no frame counters.
 *
 * Consequences (pinned by test):
 * - Pause freezes the sim clock → the pulse freezes (same time in →
 *   same envelope out — pure function, no accumulation, no drift).
 * - Replays reproduce pulses exactly (same trajectory → same times).
 * - `?music=off` keeps pulses (they are authored level rhythm, not heard
 *   audio); `?triggers=off` silences them with the rest of the trigger
 *   layer; `?fx=off` keeps working (the VFX leg is skipped there).
 * - Three strobing bound: every envelope is a smooth exponential decay
 *   (never a square wave); downbeats arrive every 2 s (never
 *   high-frequency); bloom/exposure/environment legs reuse the existing
 *   in-contract clamps; player/hazard/route identities are never touched.
 *
 * Hierarchy (mirrors the musical arrangement):
 * - eighth: 8th-note subdivision micro-pulse (route-edge shimmer).
 * - beat: quarter-beat pulse (edge/emissive + environment light answer).
 * - downbeat: bar pulse, every 4th beat (bloom accent + beam burst).
 * - drop: section-energy pump (loud sections breathe WITH the beat;
 *   quiet sections barely move).
 * - impact: one-shot section-entry hit when arriving LOUD (decays with
 *   render dt — pass 0 while paused to freeze with presentation pause).
 */

/** Section-energy pump tiers (authored, not heard). */
const ENERGY_TIER: Record<MusicEnergy, number> = {
  silence: 0,
  groove: 0.35,
  loud: 1,
  break: 0.55,
  quiet: 0.12,
  build: 0.7,
  outro: 0.3,
};

/** Sections whose entry fires the impact envelope. */
const IMPACT_SECTIONS: ReadonlySet<string> = new Set(['drop-a', 'drop-b', 'climax']);

/** Caller-owned per-frame pulse levels (reused scratch, zero allocation). */
export interface RhythmPulse {
  eighth: number;
  beat: number;
  downbeat: number;
  drop: number;
  sectionId: string;
}

/** Caller-owned impact state (one per RendererHost, reused every frame). */
export interface RhythmImpactState {
  energy: number;
  lastSectionId: string | null;
}

export const makeRhythmPulse = (): RhythmPulse => ({
  eighth: 0,
  beat: 0,
  downbeat: 0,
  drop: 0,
  sectionId: 'count-in',
});

export const makeRhythmImpactState = (): RhythmImpactState => ({
  energy: 0,
  lastSectionId: null,
});

const decaySince = (musicTime: number, period: number, rate: number): number => {
  const rel = musicTime - GRAVITY_LESSONS_BEAT_OFFSET;
  const phase = rel - Math.floor(rel / period) * period;
  const since = phase < 0 ? phase + period : phase;
  return Math.exp(-since * rate);
};

/**
 * Evaluate the beat-grid envelopes at a deterministic music time into
 * caller-owned `out`. Pure function of time (pause/replay-safe).
 */
export const evaluateRhythmPulse = (musicTimeSeconds: number, out: RhythmPulse): void => {
  const t = Math.max(0, musicTimeSeconds);
  out.eighth = decaySince(t, GRAVITY_LESSONS_BEAT_PERIOD / 2, 9);
  out.beat = decaySince(t, GRAVITY_LESSONS_BEAT_PERIOD, 7);
  out.downbeat = decaySince(t, GRAVITY_LESSONS_BEAT_PERIOD * 4, 5);
  const section = sectionAtTime(t);
  out.sectionId = section.id;
  const tier = ENERGY_TIER[section.energy];
  out.drop = tier * (0.4 + 0.6 * out.beat);
};

/**
 * Section-entry impact envelope: fires (restarts at peak) when the music
 * time enters a loud section, decays with render dt (pass 0 while paused
 * to freeze with presentation pause — same discipline as VfxSystem).
 */
export const updateRhythmImpact = (
  state: RhythmImpactState,
  musicTimeSeconds: number,
  dtSeconds: number,
): void => {
  const section = sectionAtTime(Math.max(0, musicTimeSeconds)).id;
  if (state.lastSectionId !== section) {
    state.lastSectionId = section;
    if (IMPACT_SECTIONS.has(section)) state.energy = 1;
  }
  const dt = Math.max(0, dtSeconds);
  if (dt === 0) return;
  if (state.energy > 0) {
    state.energy *= Math.exp(-dt * 1.8);
    if (state.energy < 0.003) state.energy = 0;
  }
};

/** Zero the impact envelope (triggers-off edge — exact rest). */
export const clearRhythmImpact = (state: RhythmImpactState): void => {
  state.energy = 0;
  state.lastSectionId = null;
};
