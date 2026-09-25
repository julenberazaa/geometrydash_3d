import { describe, expect, it } from 'vitest';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { TheDescentClassicDriver } from './helpers/theDescentClassicScript';
import {
  alignEvents,
  collectMusicEvents,
  summarizeAlignment,
  type MusicEventType,
} from './helpers/musicAlignment';
import { ZENITH_GRID } from '../src/audio/zenithTrack';

/**
 * M9.5 Descent × Zenith MODERATE alignment contract.
 *
 * THE DESCENT keeps its M8.6 timing (no retime — the 14797-tick anchor
 * holds); only the NEW M9.5 edits were placed against the Zenith grid,
 * plus a few structural coincidences the offset-0 mapping gives for
 * free. AUTHORED_BEATS is that contract: event id → intended Zenith
 * beat (120 BPM, offset 0.03 s). Tiers (measured, reported honestly):
 * - MAJOR (the 3 new lunges + the structural moments they compose
 *   with): target ±150 ms.
 * - MAPPED max ≤ 250 ms (teleport-high −180 ms and the finish −222 ms
 *   are documented loose ends — the finish is a cut, not a landing).
 * - Everything else reports nearest-beat errors diagnostically (the
 *   level was authored for Gravity Lessons' different grid; moderate
 *   sync makes no claim there).
 */
const AUTHORED_BEATS: Readonly<Record<string, number>> = {
  'pad:ps-pad-sky': 39,
  'chomperLunge:ps-chomp-deck': 42,
  'pad:ps-pad-ridge': 44,
  'jumpOrb:ps-orb-sky': 48,
  'pad:ps-pad-maze': 76,
  'chomperLunge:ps-chomp-lower': 87,
  'chomperLunge:ps-chomp-shaft': 124,
  'modePortal:ps-ship-on': 158,
  'modePortal:ps-spider-on': 189,
  'modePortal:ps-spider-off': 213,
  'teleport:ps-teleport-high': 216,
  'finish:finish': 247,
};

const MAJOR: ReadonlySet<MusicEventType> = new Set([
  'pad',
  'jumpOrb',
  'modePortal',
  'chomperLunge',
]);

describe('M9.5 Descent x Zenith moderate alignment', () => {
  it('primary route: new edits land near the Zenith grid, finish reported', { timeout: 120000 }, () => {
    const driver = new TheDescentClassicDriver('primary');
    const { events, status } = collectMusicEvents(
      THE_DESCENT_CLASSIC,
      (z, sim) => driver.nextInput(z, sim),
    );
    expect(status).toBe('finished');
    const aligned = alignEvents(events, AUTHORED_BEATS, ZENITH_GRID);
    const mapped = aligned.filter((e) => e.authoredBeat !== null);
    expect(mapped.length).toBe(Object.keys(AUTHORED_BEATS).length);
    const majors = mapped.filter((e) => MAJOR.has(e.type) && e.id !== 'finish');
    const summary = summarizeAlignment(majors.map((e) => e.authoredError as number));
    const mappedSummary = summarizeAlignment(mapped.map((e) => e.authoredError as number));
    for (const e of mapped) {
      console.log(
        `  ${e.type} ${e.id} t=${e.time.toFixed(2)}s beat=${e.authoredBeat} err=${((e.authoredError as number) * 1000).toFixed(0)}ms`,
      );
    }
    console.log(
      `majors: n=${summary.count} median|err|=${(summary.medianAbsError * 1000).toFixed(0)}ms ` +
        `max=${(summary.maxAbsError * 1000).toFixed(0)}ms; mapped max=${(mappedSummary.maxAbsError * 1000).toFixed(0)}ms`,
    );
    // New lunges: deck −130 ms, lower +87 ms, shaft −30 ms.
    const lunges = mapped.filter((e) => e.type === 'chomperLunge');
    expect(lunges.length).toBe(3);
    for (const e of lunges.filter((l) => l.id.startsWith('ps-chomp-deck') || l.id.startsWith('ps-chomp-lower') || l.id.startsWith('ps-chomp-shaft'))) {
      expect(Math.abs(e.authoredError as number)).toBeLessThanOrEqual(0.15);
    }
    expect(summary.maxAbsError).toBeLessThanOrEqual(0.15);
    expect(mappedSummary.maxAbsError).toBeLessThanOrEqual(0.25);
    // Finish is reported, never forced onto a beat.
    const finish = mapped.find((e) => e.type === 'finish');
    expect(finish?.authoredBeat).toBe(247);
  });

  it('alternate route: shared anchors agree', { timeout: 120000 }, () => {
    const driver = new TheDescentClassicDriver('alternate');
    const { events, status } = collectMusicEvents(
      THE_DESCENT_CLASSIC,
      (z, sim) => driver.nextInput(z, sim),
    );
    expect(status).toBe('finished');
    // The LOW line skips the HIGH pads/orb/teleport; every shared anchor
    // (incl. all 3 new lunges) fires identically on both variants.
    const shared: Readonly<Record<string, number>> = {
      'chomperLunge:ps-chomp-deck': 42,
      'chomperLunge:ps-chomp-lower': 87,
      'chomperLunge:ps-chomp-shaft': 124,
      'modePortal:ps-ship-on': 158,
      'modePortal:ps-spider-on': 189,
      'finish:finish': 247,
    };
    const aligned = alignEvents(events, shared, ZENITH_GRID);
    const mapped = aligned.filter((e) => e.authoredBeat !== null);
    expect(mapped.length).toBe(Object.keys(shared).length);
    for (const e of mapped) {
      if (e.type === 'finish') continue;
      expect(Math.abs(e.authoredError as number)).toBeLessThanOrEqual(0.15);
    }
  });
});
