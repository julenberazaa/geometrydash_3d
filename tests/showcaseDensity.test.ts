import { describe, it, expect } from 'vitest';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { ShowcaseDriver } from './helpers/showcaseScript';
import { collectRouteMetrics } from './helpers/routeMetrics';

/**
 * M8.6 density / verticality / lateral-movement contract (THE DESCENT).
 *
 * Pure test-side observation of the scripted reference runs (no engine
 * changes): pins the M8.6 redesign far above the measured M8.5 baseline
 * (60 action events / 116 s = 0.52 /s, 30 jump edges, 12 lane edges,
 * 0 fast-fall ticks, 8 passive gaps >= 4 s, 32 supports, dy 206.6 / dx
 * 89.4 u — see the M8.6 spec) so the level can never silently regress
 * back into a flat obstacle course. Pins sit below the measured M8.6
 * values with margin; human feel remains authority (metrics detect
 * emptiness, never certify fun).
 */
describe('M8.6 showcase density contract', () => {
  it('primary route: input density far above the M8.5 baseline', { timeout: 60000 }, () => {
    const driver = new ShowcaseDriver('primary');
    const m = collectRouteMetrics(PRODUCTION_SHOWCASE_01, (z, sim) =>
      driver.nextInput(z, sim),
    );
    expect(m.status).toBe('finished');
    expect(m.attempts).toBe(1);
    // Cube/Spider skill jumps (Ship thrust excluded): 97 measured.
    expect(m.cubeJumpEdges).toBeGreaterThanOrEqual(85);
    // Logical lane edges incl. wall-gravity Up/Down taps: 62 measured.
    expect(m.laneEdges).toBeGreaterThanOrEqual(50);
    // Falling as a skill ("dejarse caer"): fast-fall deliberately held.
    expect(m.fastFallHeld).toBeGreaterThan(0);
    // No passive travel: max action gap 1.47 s measured, no exemptions.
    expect(m.maxActionGapTicks).toBeLessThanOrEqual(180);
    // Interactions punctuate the route (not orb spam — every one alters
    // the required execution on the reference line).
    expect(m.pads).toBeGreaterThanOrEqual(4);
    expect(m.orbs).toBeGreaterThanOrEqual(4);
    expect(m.gravityTransitions).toBeGreaterThanOrEqual(10);
    expect(m.modeTransitions).toBeGreaterThanOrEqual(5);
    expect(m.spiderPresses).toBeGreaterThanOrEqual(10);
  });

  it('alternate route: input density far above the M8.5 baseline', { timeout: 60000 }, () => {
    const driver = new ShowcaseDriver('alternate');
    const m = collectRouteMetrics(PRODUCTION_SHOWCASE_01, (z, sim) =>
      driver.nextInput(z, sim),
    );
    expect(m.status).toBe('finished');
    expect(m.attempts).toBe(1);
    // 93 skill jumps measured on the LOW technical line.
    expect(m.cubeJumpEdges).toBeGreaterThanOrEqual(85);
    // 70 lane edges measured (the LOW line weaves more).
    expect(m.laneEdges).toBeGreaterThanOrEqual(50);
    expect(m.fastFallHeld).toBeGreaterThan(0);
    // Max action gap 1.43 s measured, no exemptions.
    expect(m.maxActionGapTicks).toBeLessThanOrEqual(180);
    // The LOW line skips the act-2 pads/orbs but keeps the gravity-orbs,
    // the shaft pad, every gravity/mode transition and the Spider snaps.
    expect(m.pads).toBeGreaterThanOrEqual(1);
    expect(m.orbs).toBeGreaterThanOrEqual(2);
    expect(m.gravityTransitions).toBeGreaterThanOrEqual(10);
    expect(m.modeTransitions).toBeGreaterThanOrEqual(5);
    expect(m.spiderPresses).toBeGreaterThanOrEqual(10);
  });

  it('primary route: multi-height architecture (never one floor)', { timeout: 60000 }, () => {
    const driver = new ShowcaseDriver('primary');
    const m = collectRouteMetrics(PRODUCTION_SHOWCASE_01, (z, sim) =>
      driver.nextInput(z, sim),
    );
    // Y span -3.78..12.64 measured (LOW / MID / HIGH + shafts + ceiling).
    expect(m.yRange).toBeGreaterThanOrEqual(12);
    // 9 two-unit bands visited, 239 transitions measured.
    expect(m.bandsVisited).toBeGreaterThanOrEqual(8);
    expect(m.bandTransitions).toBeGreaterThanOrEqual(150);
    // Total vertical travel 561.7 u measured (M8.5: 206.6).
    expect(m.sumDy).toBeGreaterThanOrEqual(400);
    // 79 distinct supports measured (M8.5: 32).
    expect(m.distinctSupports).toBeGreaterThanOrEqual(64);
  });

  it('alternate route: multi-height architecture (never one floor)', { timeout: 60000 }, () => {
    const driver = new ShowcaseDriver('alternate');
    const m = collectRouteMetrics(PRODUCTION_SHOWCASE_01, (z, sim) =>
      driver.nextInput(z, sim),
    );
    expect(m.yRange).toBeGreaterThanOrEqual(12);
    // 8 bands / 205 transitions measured on the LOW line.
    expect(m.bandsVisited).toBeGreaterThanOrEqual(8);
    expect(m.bandTransitions).toBeGreaterThanOrEqual(150);
    // Total vertical travel 505 u measured (M8.5: 206.6).
    expect(m.sumDy).toBeGreaterThanOrEqual(400);
    // 76 distinct supports measured (M8.5: 32).
    expect(m.distinctSupports).toBeGreaterThanOrEqual(64);
  });

  it('both routes: real lateral 3D motion (not three obvious corridors)', { timeout: 120000 }, () => {
    for (const variant of ['primary', 'alternate'] as const) {
      const driver = new ShowcaseDriver(variant);
      const m = collectRouteMetrics(PRODUCTION_SHOWCASE_01, (z, sim) =>
        driver.nextInput(z, sim),
      );
      // X span ~11.6+ u measured (M8.5: 9.7) with 44+ direction reversals.
      expect(m.xRange).toBeGreaterThanOrEqual(8);
      expect(m.xReversals).toBeGreaterThanOrEqual(20);
      // Total lateral travel ~200 u measured (M8.5: 89.4).
      expect(m.sumDx).toBeGreaterThanOrEqual(150);
    }
  });

  it('moving islands carry the rider on both routes', { timeout: 120000 }, () => {
    for (const variant of ['primary', 'alternate'] as const) {
      const driver = new ShowcaseDriver(variant);
      const m = collectRouteMetrics(PRODUCTION_SHOWCASE_01, (z, sim) =>
        driver.nextInput(z, sim),
      );
      // The maze ferry pair + void ferry + Chomper ferry ride on both
      // routes (the HIGH elevator additionally rides on primary).
      expect(m.platformSupports.length).toBeGreaterThanOrEqual(4);
      expect(m.platformSupportTicks).toBeGreaterThan(100);
    }
    const primary = new ShowcaseDriver('primary');
    const pm = collectRouteMetrics(PRODUCTION_SHOWCASE_01, (z, sim) =>
      primary.nextInput(z, sim),
    );
    expect(pm.platformSupports).toContain('platform-ps-lift-void');
  });
});
