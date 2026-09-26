import { describe, expect, it } from 'vitest';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { TheDescentClassicDriver } from './helpers/theDescentClassicScript';
import { ShowcaseDriver } from './helpers/showcaseScript';
import { analyzeRouteOpenness, collectTrajectory, M91_RECOVERY_WINDOWS } from './helpers/routeOpenness';
import { idleInput } from './helpers/simulation';

describe('THE DESCENT route density', () => {
  for (const variant of ['primary', 'alternate'] as const) {
    it(`${variant} completes while the maze exit requires a narrow read`, { timeout: 120000 }, () => {
      const driver = new TheDescentClassicDriver(variant);
      const trajectory = collectTrajectory(THE_DESCENT_CLASSIC, (z, sim) => driver.nextInput(z, sim));
      expect(trajectory.status).toBe('finished');
      const report = analyzeRouteOpenness(THE_DESCENT_CLASSIC, trajectory.samples, {
        recoveryWindows: M91_RECOVERY_WINDOWS,
      });
      expect(report.coverage).toBeGreaterThan(350);
      expect(report.openFraction).toBeLessThan(variant === 'primary' ? 0.5 : 0.52);
      expect(report.samples.filter((s) => s.z >= 632 && s.z <= 640).every((s) => s.bands === 1)).toBe(true);
      expect(report.samples.filter((s) => s.z >= 644 && s.z <= 650).every((s) => s.bands <= 1)).toBe(true);
    });

    it(`${variant} cannot cruise past the maze exit without its existing jump`, { timeout: 120000 }, () => {
      const driver = new TheDescentClassicDriver(variant);
      const trajectory = collectTrajectory(THE_DESCENT_CLASSIC, (z, sim) => {
        const input = driver.nextInput(z, sim);
        return z >= 639.5 && z <= 641 && input.space.pressedThisStep ? idleInput : input;
      });
      expect(trajectory.status).not.toBe('finished');
      expect(trajectory.samples.at(-1)?.z).toBeLessThan(650);
    });
  }

  it('the lower branch cannot cruise past its existing z559 jump', { timeout: 120000 }, () => {
    const driver = new TheDescentClassicDriver('alternate');
    const trajectory = collectTrajectory(THE_DESCENT_CLASSIC, (z, sim) => {
      const input = driver.nextInput(z, sim);
      return z >= 558.5 && z <= 560 && input.space.pressedThisStep ? idleInput : input;
    });
    expect(trajectory.status).not.toBe('finished');
    expect(trajectory.samples.at(-1)?.z).toBeLessThan(570);
  });

  it('GRAVITY RIFT comparison remains complete and substantially tighter', { timeout: 120000 }, () => {
    const driver = new ShowcaseDriver('primary');
    const trajectory = collectTrajectory(PRODUCTION_SHOWCASE_01, (z, sim) => driver.nextInput(z, sim));
    expect(trajectory.status).toBe('finished');
    const report = analyzeRouteOpenness(PRODUCTION_SHOWCASE_01, trajectory.samples, {
      recoveryWindows: M91_RECOVERY_WINDOWS,
    });
    expect(report.openFraction).toBeLessThan(0.12);
  });
});
