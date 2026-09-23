import { describe, expect, it } from 'vitest';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { ShowcaseDriver } from './helpers/showcaseScript';
import {
  alignEvents,
  collectMusicEvents,
  summarizeAlignment,
  type MusicEventType,
} from './helpers/musicAlignment';
import { GRAVITY_LESSONS_FINAL_BEAT, beatTime } from '../src/audio/musicTrack';

/**
 * M9 music-alignment audit (THE DESCENT × Gravity Lessons) — measures how
 * well authored reference-route event times land on the 120 BPM grid.
 * Diagnostic phase: reports nearest-beat errors + the finish-vs-beat-230
 * gap that the retime must close. The tight authored-anchor pins land with
 * the level reauthor (same file, honest measured bounds).
 */
const MAJOR: ReadonlySet<MusicEventType> = new Set([
  'pad', 'jumpOrb', 'gravityOrb', 'gravityPortal', 'speedPortal',
  'modePortal', 'teleport', 'chomperLunge', 'finish',
]);

describe('M9 music alignment audit', () => {
  it('primary route: event-vs-grid report', { timeout: 120000 }, () => {
    const driver = new ShowcaseDriver('primary');
    const { events, status } = collectMusicEvents(
      PRODUCTION_SHOWCASE_01, (z, sim) => driver.nextInput(z, sim),
    );
    expect(status).toBe('finished');
    const aligned = alignEvents(events);
    const finish = aligned.find((e) => e.type === 'finish');
    expect(finish).toBeDefined();
    console.log(
      `finish: t=${finish?.time.toFixed(2)}s vs beat-230 ${beatTime(GRAVITY_LESSONS_FINAL_BEAT).toFixed(2)}s ` +
        `(gap ${((finish?.time ?? 0) - beatTime(GRAVITY_LESSONS_FINAL_BEAT)).toFixed(2)}s)`,
    );
    const majors = aligned.filter((e) => MAJOR.has(e.type));
    const summary = summarizeAlignment(majors.map((e) => e.beatError));
    console.log(
      `majors: n=${summary.count} nearest-beat median|err|=${(summary.medianAbsError * 1000).toFixed(0)}ms ` +
        `max=${(summary.maxAbsError * 1000).toFixed(0)}ms`,
    );
    for (const e of majors) {
      if (e.type === 'jump' || e.type === 'spiderSnap') continue;
      console.log(
        `  ${e.type} ${e.id} t=${e.time.toFixed(2)}s beat~${e.nearestBeat} err=${(e.beatError * 1000).toFixed(0)}ms`,
      );
    }
    // Structural pins (hold for any reauthoring): events ordered in time,
    // every major family present, finish recorded exactly once.
    const times = aligned.map((e) => e.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const family of ['gravityPortal', 'speedPortal', 'modePortal', 'teleport', 'chomperLunge', 'finish'] as const) {
      expect(aligned.some((e) => e.type === family), family).toBe(true);
    }
    expect(aligned.filter((e) => e.type === 'finish').length).toBe(1);
  });
});
