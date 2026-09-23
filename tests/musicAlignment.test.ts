import { describe, expect, it } from 'vitest';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { ShowcaseDriver } from './helpers/showcaseScript';
import {
  alignEvents,
  collectMusicEvents,
  summarizeAlignment,
  type MusicEventType,
} from './helpers/musicAlignment';
import { GRAVITY_LESSONS_FINAL_BEAT, beatAtTime, beatTime } from '../src/audio/musicTrack';
import { prepareRhythmCues } from '../src/visuals/rhythmCues';

/**
 * M9 music-alignment contract (THE DESCENT × Gravity Lessons).
 *
 * The reference route's gameplay events land on the authored 120 BPM grid
 * (authored by moving portals/pads/orbs/rings/triggers in z — gameplay
 * never reads beats). AUTHORED_BEATS is the contract: event id → intended
 * beat. Tiers (measured, reported honestly):
 * - MAJOR strong moments (pads, orbs, modes, teleports, chomper lunges,
 *   drop-speeds, finish): target ±70 ms; pin median ≤ 70 ms.
 * - Max-error pin documents the constrained outliers (recovery pad-shaft,
 *   physics-locked ceiling hop, river-locked spider pair, wall-calm lip
 *   window, syncopated ship-tunnel flips) — automation reports, the human
 *   gate judges feel.
 * - Cue honesty: every cue beat matches the reference arrival at its z.
 */
const AUTHORED_BEATS: Readonly<Record<string, number>> = {
  'pad:ps-pad-sky': 39,
  'pad:ps-pad-ridge': 44,
  'jumpOrb:ps-orb-sky': 48,
  'pad:ps-pad-maze': 76,
  'speedPortal:ps-speed-maze': 99,
  'speedPortal:ps-speed-spire': 101,
  'gravityPortal:ps-spire-up': 104,
  'gravityPortal:ps-spire-wall': 112,
  'gravityPortal:ps-spire-right': 117,
  'gravityPortal:ps-spire-down': 121,
  'pad:ps-pad-shaft': 126,
  'gravityOrb:ps-gorb-spire': 127,
  'gravityOrb:ps-gorb-spire-back': 129,
  'chomperLunge:ps-chomp-ferry': 133,
  'chomperLunge:ps-chomp-weave': 140,
  'gravityPortal:ps-foundry-up': 141,
  'chomperLunge:ps-chomp-ceil': 143,
  'gravityPortal:ps-foundry-down': 145,
  'speedPortal:ps-speed-foundry': 146,
  'chomperLunge:ps-chomp-low': 147,
  'modePortal:ps-ship-on': 151,
  'speedPortal:ps-speed-approach': 152,
  'gravityPortal:ps-abyss-invert': 164,
  'gravityPortal:ps-abyss-revert': 171,
  'gravityPortal:ps-abyss-invert2': 176,
  'gravityPortal:ps-abyss-revert2': 179,
  'modePortal:ps-ship-off': 180,
  'speedPortal:ps-speed-spider': 180,
  'modePortal:ps-spider-on': 182,
  'speedPortal:ps-speed-wall-calm': 190,
  'gravityPortal:ps-climb-wall': 191,
  'gravityPortal:ps-climb-floor': 195,
  'modePortal:ps-spider-off': 197,
  'speedPortal:ps-speed-void': 198,
  'pad:ps-pad-high': 199,
  'teleport:ps-teleport-high': 200,
  'jumpOrb:ps-orb-terminal-a': 202,
  'jumpOrb:ps-orb-terminal-b': 204,
  'teleport:ps-teleport-maw': 209,
  'speedPortal:ps-speed-remix': 216,
  'speedPortal:ps-speed-calm': 218,
  'gravityPortal:ps-remix-up': 218,
  'gravityPortal:ps-remix-down': 220,
  'gravityPortal:ps-remix-wall': 221,
  'gravityPortal:ps-remix-floor': 223,
  'modePortal:ps-remix-spider-on': 225,
  'modePortal:ps-remix-spider-off': 226,
  'speedPortal:ps-speed-remix2': 226,
  'chomperLunge:ps-chomp-final': 227,
  'speedPortal:ps-speed-calm2': 228,
  'finish:finish': 230,
};

const MAJOR: ReadonlySet<MusicEventType> = new Set([
  'pad', 'jumpOrb', 'gravityOrb', 'gravityPortal', 'speedPortal',
  'modePortal', 'teleport', 'chomperLunge', 'finish',
]);

describe('M9 music alignment audit', () => {
  it('primary route: authored anchors land on the grid', { timeout: 120000 }, () => {
    const driver = new ShowcaseDriver('primary');
    const { events, status } = collectMusicEvents(
      PRODUCTION_SHOWCASE_01, (z, sim) => driver.nextInput(z, sim),
    );
    expect(status).toBe('finished');
    const aligned = alignEvents(events, AUTHORED_BEATS);
    // Every authored event fired exactly once (the low teleport belongs
    // to the alternate route and never fires here — it is not mapped).
    const mapped = aligned.filter((e) => e.authoredBeat !== null);
    expect(mapped.length).toBe(Object.keys(AUTHORED_BEATS).length);
    // The finish lands on the final impact (beat 230).
    const finish = aligned.find((e) => e.type === 'finish');
    expect(finish).toBeDefined();
    console.log(
      `finish: t=${finish?.time.toFixed(2)}s vs beat-230 ${beatTime(GRAVITY_LESSONS_FINAL_BEAT).toFixed(2)}s ` +
        `(gap ${((finish?.time ?? 0) - beatTime(GRAVITY_LESSONS_FINAL_BEAT)).toFixed(2)}s)`,
    );
    expect(Math.abs((finish?.authoredError ?? 99))).toBeLessThanOrEqual(0.14);
    // Major-anchor accuracy (median meets the ±70 ms major target; the max
    // documents the constrained outliers listed above).
    const majors = aligned.filter((e) => MAJOR.has(e.type) && e.authoredError !== null);
    const summary = summarizeAlignment(majors.map((e) => e.authoredError as number));
    const within70 = majors.filter((e) => Math.abs(e.authoredError as number) <= 0.07).length;
    console.log(
      `majors: n=${summary.count} authored median|err|=${(summary.medianAbsError * 1000).toFixed(0)}ms ` +
        `max=${(summary.maxAbsError * 1000).toFixed(0)}ms within70=${within70}`,
    );
    for (const e of majors) {
      if (e.type === 'jump' || e.type === 'spiderSnap') continue;
      console.log(
        `  ${e.type} ${e.id} t=${e.time.toFixed(2)}s beat=${e.authoredBeat} err=${((e.authoredError as number) * 1000).toFixed(0)}ms`,
      );
    }
    expect(summary.medianAbsError).toBeLessThanOrEqual(0.07);
    expect(summary.maxAbsError).toBeLessThanOrEqual(0.36);
    expect(within70).toBeGreaterThanOrEqual(26);
    // Structural pins (hold for any reauthoring): events ordered in time,
    // every major family present, finish recorded exactly once.
    const times = aligned.map((e) => e.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const family of ['gravityPortal', 'speedPortal', 'modePortal', 'teleport', 'chomperLunge', 'finish'] as const) {
      expect(aligned.some((e) => e.type === family), family).toBe(true);
    }
    expect(aligned.filter((e) => e.type === 'finish').length).toBe(1);
  });

  it('cue beats honestly map the reference arrival', { timeout: 120000 }, () => {
    // Every cue beat matches the primary reference arrival at its z
    // (±1 beat — anchors track reality, never aspiration), beats never
    // run backward with z, and the finish cue is beat 230.
    const driver = new ShowcaseDriver('primary');
    const { events } = collectMusicEvents(
      PRODUCTION_SHOWCASE_01, (z, sim) => driver.nextInput(z, sim),
    );
    const cues = prepareRhythmCues(PRODUCTION_SHOWCASE_01);
    expect(cues.length).toBeGreaterThan(30);
    let prevZ = -Infinity;
    let prevBeat = -Infinity;
    for (const cue of cues) {
      expect(cue.z).toBeGreaterThanOrEqual(prevZ);
      expect(cue.beat ?? -1).toBeGreaterThanOrEqual(0);
      expect(cue.beat ?? 9999).toBeGreaterThanOrEqual(prevBeat);
      prevZ = cue.z;
      prevBeat = cue.beat ?? prevBeat;
      // Honesty: nearest arrival sample at the cue z agrees with the beat.
      const near = events.filter((e) => Math.abs(e.z - cue.z) < 12);
      if (near.length > 0 && cue.beat !== undefined) {
        const t = near.reduce((a, b) => (Math.abs(b.z - cue.z) < Math.abs(a.z - cue.z) ? b : a)).time;
        expect(Math.abs(beatAtTime(t) - cue.beat)).toBeLessThanOrEqual(1);
      }
    }
    expect(cues[cues.length - 1]?.id).toBe('ps-cue-finish');
    expect(cues[cues.length - 1]?.beat).toBe(230);
  });
});
