import { describe, it, expect } from 'vitest';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { ShowcaseDriver } from './helpers/showcaseScript';
import { collectRouteMetrics } from './helpers/routeMetrics';
import { collectTrajectory, analyzeRouteOpenness, M91_RECOVERY_WINDOWS } from './helpers/routeOpenness';

/**
 * M9.1 radical-rebuild contracts (THE DESCENT).
 *
 * Two layers (see specs/milestones/M9_1_RADICAL_RHYTHM_REBUILD.md §6):
 *  1. RATCHETS — pins sit below the measured M9.1 values with margin.
 *     They prevent silent regression into the sparse M9 layout; they do
 *     NOT claim the takeover density targets (reported separately).
 *  2. ROUTE WIDTH — the §43 hard split on the primary reference route
 *     (active gameplay only: recovery/start/finish excluded): one safe
 *     band ≥ 70%, one-or-two ≥ 90%, three-plus ≤ 10%.
 *
 * Pure test-side observation (no engine changes). Metrics detect
 * emptiness, never certify fun — human feel remains authority.
 */
describe('M9.1 radical-rebuild contracts', () => {
  it('primary route: meaningful movement far above the M9 baseline', { timeout: 120000 }, () => {
    const driver = new ShowcaseDriver('primary');
    const m = collectRouteMetrics(PRODUCTION_SHOWCASE_01, (z, sim) =>
      driver.nextInput(z, sim),
    );
    expect(m.status).toBe('finished');
    expect(m.attempts).toBe(1);
    // Measured M9.1: 122 skill jumps (M9: 92).
    expect(m.cubeJumpEdges).toBeGreaterThanOrEqual(110);
    // Measured M9.1: 90 logical lane edges (M9: 68).
    expect(m.laneEdges).toBeGreaterThanOrEqual(80);
    // Measured M9.1: 72 lateral reversals (M9: 48).
    expect(m.xReversals).toBeGreaterThanOrEqual(65);
    // Measured M9.1: 244 height-band transitions (M9: 225).
    expect(m.bandTransitions).toBeGreaterThanOrEqual(220);
    // Measured M9.1: 225 support changes, 86 distinct (M9: 202/81).
    expect(m.supportChanges).toBeGreaterThanOrEqual(200);
    expect(m.distinctSupports).toBeGreaterThanOrEqual(75);
    // Measured M9.1: 174 fast-fall engaged ticks (M9: 104).
    expect(m.ffEngagedTicks).toBeGreaterThanOrEqual(150);
    // Measured M9.1: 12 required orb activations (M9: 5).
    expect(m.orbs).toBeGreaterThanOrEqual(10);
    // Measured M9.1: 23 Spider snaps (M9: 17).
    expect(m.spiderPresses).toBeGreaterThanOrEqual(20);
    // Measured M9.1: 29 gravity transitions (M9: 32 — orbs replace two
    // portal flips with press-gated equivalents; routing is denser).
    expect(m.gravityTransitions).toBeGreaterThanOrEqual(25);
  });

  it('primary route: the §43 safe-route split (one strong line)', { timeout: 120000 }, () => {
    const driver = new ShowcaseDriver('primary');
    const traj = collectTrajectory(PRODUCTION_SHOWCASE_01, (z, sim) => driver.nextInput(z, sim));
    expect(traj.status).toBe('finished');
    const report = analyzeRouteOpenness(PRODUCTION_SHOWCASE_01, traj.samples, {
      recoveryWindows: M91_RECOVERY_WINDOWS,
    });
    console.log(
      `m91-width: samples=${report.coverage} one=${(report.oneBandFraction * 100).toFixed(1)}% ` +
        `two=${(report.twoBandFraction * 100).toFixed(1)}% open3p=${(report.openFraction * 100).toFixed(1)}%`,
    );
    // Measured M9.1: one 75.0% / one+two 90.5% / 3+ 9.5% (M9: 45/56/44).
    expect(report.oneBandFraction).toBeGreaterThanOrEqual(0.7);
    expect(report.oneBandFraction + report.twoBandFraction).toBeGreaterThanOrEqual(0.9);
    expect(report.openFraction).toBeLessThanOrEqual(0.1);
  });
});
