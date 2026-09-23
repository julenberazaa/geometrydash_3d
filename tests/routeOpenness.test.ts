import { describe, expect, it } from 'vitest';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { ShowcaseDriver } from './helpers/showcaseScript';
import { collectTrajectory, analyzeRouteOpenness, M91_RECOVERY_WINDOWS } from './helpers/routeOpenness';

/**
 * M9 route-openness audit (THE DESCENT) — the human complaint made
 * measurable: "can the player advance safely through many lateral
 * positions without meaningful action?"
 *
 * Method: reference trajectory + per-lane safe-band test (supported +
 * hazard-free + no frontal block in the decision window) at every 2 u on
 * Floor/Cube sections. 1 band = precise single flow line, 2 = meaningful
 * alternative, 3+ = the permissive multi-line problem.
 *
 * Static scope: Cube/Floor only (ship/spider/ceiling/wall + ferry rides
 * excluded — reported as coverage); Chompers excluded (dynamic, but their
 * zones carry static weave gates that DO constrain).
 */
describe('M9 route openness audit', () => {
  it('primary route: openness report (diagnostic + lane-discipline proof)', { timeout: 120000 }, () => {
    const driver = new ShowcaseDriver('primary');
    const traj = collectTrajectory(PRODUCTION_SHOWCASE_01, (z, sim) => driver.nextInput(z, sim));
    expect(traj.status).toBe('finished');
    expect(traj.floorCubeSamples).toBeGreaterThan(8000);
    const report = analyzeRouteOpenness(PRODUCTION_SHOWCASE_01, traj.samples, {
      recoveryWindows: M91_RECOVERY_WINDOWS,
    });
    console.log(
      `openness: samples=${report.coverage} open(3+)b=${(report.openFraction * 100).toFixed(1)}% ` +
        `one=${(report.oneBandFraction * 100).toFixed(1)}% two=${(report.twoBandFraction * 100).toFixed(1)}%`,
    );
    for (const s of report.openStretches.slice(0, 12)) {
      console.log(`  open stretch z ${s.z0}..${s.z1} (len ${s.length})`);
    }
    // Lane discipline is load-bearing somewhere: the lane-lazy variant
    // (no taps, no reactive steering) must die before the finish.
    const lazy = new ShowcaseDriver('primary', { laneLazy: true });
    const lazyTraj = collectTrajectory(PRODUCTION_SHOWCASE_01, (z, sim) => lazy.nextInput(z, sim));
    console.log(`lane-lazy: status=${lazyTraj.status} ticks=${lazyTraj.ticks}`);
    expect(lazyTraj.status).not.toBe('finished');
    // M9 precision-routing contract (pins sit below the measured funneled
    // values with margin — human feel remains authority; the metric
    // detects permissive multi-line travel, never certifies fun):
    // demanding gameplay is mostly ONE safe band (occasionally two).
    expect(report.openFraction).toBeLessThanOrEqual(0.5);
    expect(report.oneBandFraction).toBeGreaterThanOrEqual(0.38);
  });

  it('alternate route: openness report', { timeout: 120000 }, () => {
    const driver = new ShowcaseDriver('alternate');
    const traj = collectTrajectory(PRODUCTION_SHOWCASE_01, (z, sim) => driver.nextInput(z, sim));
    expect(traj.status).toBe('finished');
    const report = analyzeRouteOpenness(PRODUCTION_SHOWCASE_01, traj.samples, {
      recoveryWindows: M91_RECOVERY_WINDOWS,
    });
    console.log(
      `openness-alt: samples=${report.coverage} open(3+)b=${(report.openFraction * 100).toFixed(1)}% ` +
        `one=${(report.oneBandFraction * 100).toFixed(1)}% two=${(report.twoBandFraction * 100).toFixed(1)}%`,
    );
    expect(report.openFraction).toBeLessThanOrEqual(0.5);
    expect(report.oneBandFraction).toBeGreaterThanOrEqual(0.38);
    for (const s of report.openStretches.slice(0, 12)) {
      console.log(`  open stretch z ${s.z0}..${s.z1} (len ${s.length})`);
    }
  });
});
