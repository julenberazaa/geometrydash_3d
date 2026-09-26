import { describe, it, expect } from 'vitest';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { TheDescentClassicDriver } from './helpers/theDescentClassicScript';
import {
  auditSightlines,
  SIGHTLINE_THRESHOLDS,
  type SightlineReport,
} from './helpers/sightline';
import { LevelView } from '../src/rendering/LevelView';
import { loadLevel } from '../src/level/levelRuntime';
import { makeTestLibrary } from './helpers/visuals';

/**
 * M9.6.1 telegraphing contract (GAME_DESIGN §7.10) — executable pins on
 * THE DESCENT, both reference routes.
 *
 * Method: headless sightline sweep (resolved camera eye + frustum +
 * occlusion per tick). Only on-line threats count (another deck's
 * business is not a violation). Thresholds live in SIGHTLINE_THRESHOLDS
 * (single owner, mirrors the design text).
 *
 * Known blind spots are pinned as EXPLICIT windows (not silent passes):
 * the 6 spider snaps whose destinations leave the frame (5 mandatory +
 * 1 optional — snap-zone markers cover them; see the snapmark test).
 */

const KNOWN_BLIND_SNAP_WINDOWS: { lo: number; hi: number; mandatory: boolean }[] = [
  { lo: 1341, hi: 1350, mandatory: true }, // entry snap (skip = frontImpact)
  { lo: 1353, hi: 1359, mandatory: false }, // skip finishes (optional)
  { lo: 1361, hi: 1367, mandatory: true }, // skip = void
  { lo: 1397, hi: 1403, mandatory: true }, // skip = void
  { lo: 1479, hi: 1485, mandatory: true }, // skip = void (wall run)
  { lo: 1746, hi: 1752, mandatory: true }, // skip = void (remix)
];

const checkRoute = (report: SightlineReport, variant: string): void => {
  expect(report.finished, `${variant} completes under the audit`).toBe(true);
  expect(report.ticks, `${variant} anchor band`).toBeGreaterThan(14000);

  // R-decision (0.7 s): doors / lateral spikes / chompers / teleports.
  // Sequenced-door followers (tutorial rhythm): the gap may read within
  // 0.5 s of travel after the previous on-line door's plane.
  const decisions = report.verdicts.filter(
    (v) => v.online && (v.kind === 'door' || v.kind === 'spike' || v.kind === 'chomper' || v.kind === 'teleport'),
  );
  expect(decisions.length, `${variant} has on-line decisions`).toBeGreaterThan(10);
  const onlineDoors = report.verdicts
    .filter((v) => v.kind === 'door' && v.online)
    .sort((a, b) => a.actZ - b.actZ);
  for (const v of decisions) {
    if (v.sightTime >= SIGHTLINE_THRESHOLDS.decision) continue;
    if (v.kind === 'door' && v.seenAtZ !== null) {
      const idx = onlineDoors.findIndex((d) => d.id === v.id);
      const prev = idx > 0 ? onlineDoors[idx - 1] : undefined;
      if (
        prev !== undefined &&
        v.seenAtZ <= prev.actZ + 7 &&
        v.sightTime >= 0
      ) {
        continue; // sequenced follower (A1 rhythm, gap frames teach it)
      }
    }
    expect(
      false,
      `${variant} R-decision violation: ${v.id} act@${v.actZ} sight=${v.sightTime.toFixed(2)}s`,
    ).toBe(true);
  }

  // R-action (0.5 s): orb windows.
  for (const v of report.verdicts.filter((w) => w.online && w.kind === 'orb')) {
    expect(
      v.sightTime,
      `${variant} R-action violation: ${v.id} act@${v.actZ} sight=${v.sightTime.toFixed(2)}s`,
    ).toBeGreaterThanOrEqual(SIGHTLINE_THRESHOLDS.action);
  }

  // R-routing (0.4 s): portals. Pads pass by sight OR approach shaping
  // (runner lateral spread ≤2.5 u over the 15 u before the pad).
  for (const v of report.verdicts.filter((w) => w.online && w.kind === 'portal')) {
    expect(
      v.sightTime,
      `${variant} R-routing violation: ${v.id} act@${v.actZ} sight=${v.sightTime.toFixed(2)}s`,
    ).toBeGreaterThanOrEqual(SIGHTLINE_THRESHOLDS.routing);
  }
  for (const v of report.verdicts.filter((w) => w.online && w.kind === 'pad')) {
    const ok =
      v.sightTime >= SIGHTLINE_THRESHOLDS.routing || v.approachSpread <= 2.5;
    expect(
      ok,
      `${variant} R-routing violation: ${v.id} sight=${v.sightTime.toFixed(2)}s spread=${v.approachSpread.toFixed(2)}`,
    ).toBe(true);
  }

  // R-chomper is inside R-decision (dormant watched against the trigger).

  // R-drop: no fatal no-input walk-offs; every resolved one is fair
  // (landing reads, or curb: visible edge + clear landing zone).
  for (const w of report.walkoffs) {
    expect(w.fatal, `${variant} fatal blind walk-off at z=${w.takeoffZ.toFixed(1)}`).toBe(false);
    expect(
      w.ok,
      `${variant} R-drop violation: takeoff@${w.takeoffZ.toFixed(1)} landing@${w.landingZ.toFixed(1)} ` +
        `seenAtTakeoff=${w.landingSeenAtTakeoff} lead=${w.leadTime.toFixed(2)} edge=${w.edgeVisible} clear=${w.landingZoneClear}`,
    ).toBe(true);
  }

  // R-spider: blind destinations are pinned as explicit windows (markers
  // cover them — see the snapmark coverage test). No NEW blind spots.
  const blind = report.spiderSnaps.filter((s) => !s.destVisible);
  expect(blind.length, `${variant} blind-snap count pinned`).toBe(KNOWN_BLIND_SNAP_WINDOWS.length);
  for (const b of blind) {
    const known = KNOWN_BLIND_SNAP_WINDOWS.some((w) => b.z >= w.lo && b.z <= w.hi);
    expect(known, `${variant} NEW blind spider snap @ z=${b.z.toFixed(1)}`).toBe(true);
  }
  // Blindness here is framing (never occlusion — the column is open).
  for (const b of blind) {
    const snap = report.spiderSnaps.find((s) => s.z === b.z);
    expect(snap?.reason, `${variant} blind snap @ ${b.z.toFixed(1)} must be framing, not occlusion`).toBe('out-of-frame');
  }
};

describe('M9.6.1 snap-zone markers cover the blind forced snaps', () => {
  it('marks every blind press window with a runner-line diamond', () => {
    const marks = (THE_DESCENT_CLASSIC.visualSetpieces ?? []).filter((s) => s.kind === 'snapmark');
    expect(marks.length).toBe(6);
    const windows = [
      { lo: 1341, hi: 1350, x: 0, y: 2.15 },
      { lo: 1353, hi: 1359, x: 2.6, y: 7.85 },
      { lo: 1361, hi: 1367, x: 2.6, y: 2.15 },
      { lo: 1397, hi: 1403, x: 0, y: 7.85 },
      { lo: 1479, hi: 1485, x: -3.4, y: 3.0 },
      { lo: 1746, hi: 1752, x: 0, y: 5.85 },
    ];
    for (const w of windows) {
      const mark = marks.find((m) => m.center.z >= w.lo && m.center.z <= w.hi);
      expect(mark, `snapmark missing near z=${w.lo}`).toBeDefined();
      if (mark === undefined) continue;
      // Runner-line placement (free-face offset, off the support plane).
      expect(Math.abs(mark.center.x - w.x)).toBeLessThanOrEqual(0.6);
      expect(Math.abs(mark.center.y - w.y)).toBeLessThanOrEqual(0.6);
      expect(Math.abs(mark.center.x)).toBeGreaterThanOrEqual(0);
    }
  });

  it('renders the markers as one static instanced mesh (LevelView)', () => {
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(THE_DESCENT_CLASSIC), library);
    try {
      expect(view.snapmarkCount).toBe(6);
      expect(library.materialCount).toBeGreaterThan(0);
    } finally {
      view.dispose();
    }
    expect(view.snapmarkCount).toBe(0);
  });
});

describe('M9.6.1 telegraphing contract on THE DESCENT', () => {
  it('primary route reads fair on every rule', { timeout: 180000 }, () => {
    const report = auditSightlines(
      THE_DESCENT_CLASSIC,
      new TheDescentClassicDriver('primary'),
    );
    checkRoute(report, 'primary');
  });

  it('alternate route reads fair on every rule', { timeout: 180000 }, () => {
    const report = auditSightlines(
      THE_DESCENT_CLASSIC,
      new TheDescentClassicDriver('alternate'),
    );
    checkRoute(report, 'alternate');
  });
});
