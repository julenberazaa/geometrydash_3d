import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import {
  DEFAULT_LEVEL_ID,
  getLevel,
  registeredLevelIds,
  resolveLevel,
} from '../src/content/levelRegistry';
import { PRODUCTION_LEVEL_CARDS } from '../src/content/levelMetadata';
import { validateLavaAuthoring } from '../src/level/lavaAuthoring';
import { validatePortalBounds } from '../src/level/portalAuthoring';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { recordAttempt, playReplay } from './helpers/replay';
import {
  TheDescentClassicDriver,
  driveTheDescentClassicToFinish,
} from './helpers/theDescentClassicScript';
import { ShowcaseDriver } from './helpers/showcaseScript';

/**
 * M9.4 historical-level contract (THE DESCENT, `the-descent`):
 * - registered as an independent production level (own id, default stays
 *   the evolved route, card metadata derives from the registry data)
 * - content independent from the evolved route (no shared mutable arrays;
 *   distinct gameplay fingerprint)
 * - valid authoring (sourced/contained lava, bounded portals, 8 crystals,
 *   own music-track declaration)
 * - the frozen M9.2 driver still completes it on the current engine with
 *   zero deaths, and the tape replays VERIFIED
 */
describe('M9.4 THE DESCENT (frozen M9.2 route)', () => {
  it('is registered with its own level id', () => {
    expect(registeredLevelIds()).toContain('the-descent');
    expect(THE_DESCENT_CLASSIC.id).toBe('the-descent');
    expect(THE_DESCENT_CLASSIC.displayName).toBe('THE DESCENT');
    expect(resolveLevel('the-descent').level.id).toBe('the-descent');
    expect(resolveLevel('the-descent').ok).toBe(true);
    expect(getLevel('the-descent')).toBe(THE_DESCENT_CLASSIC);
  });

  it('leaves the evolved route as the default level', () => {
    expect(DEFAULT_LEVEL_ID).toBe('production-showcase-01');
    expect(resolveLevel(null).level.id).toBe('production-showcase-01');
    expect(PRODUCTION_SHOWCASE_01.displayName).toBe('THE DESCENT — EVOLVED');
  });

  it('is covered by declarative card metadata', () => {
    const ids = PRODUCTION_LEVEL_CARDS.map((c) => c.levelId);
    expect(ids).toContain('the-descent');
    expect(ids).toContain('production-showcase-01');
    for (const card of PRODUCTION_LEVEL_CARDS) {
      expect(getLevel(card.levelId)?.id, card.levelId).toBe(card.levelId);
    }
  });

  it('shares no mutable content with the evolved route', () => {
    expect(THE_DESCENT_CLASSIC).not.toBe(PRODUCTION_SHOWCASE_01);
    expect(THE_DESCENT_CLASSIC.solids).not.toBe(PRODUCTION_SHOWCASE_01.solids);
    expect(THE_DESCENT_CLASSIC.hazards).not.toBe(PRODUCTION_SHOWCASE_01.hazards);
    expect(THE_DESCENT_CLASSIC.gravityPortals).not.toBe(PRODUCTION_SHOWCASE_01.gravityPortals);
    expect(THE_DESCENT_CLASSIC.checkpoints).not.toBe(PRODUCTION_SHOWCASE_01.checkpoints);
    expect(THE_DESCENT_CLASSIC.laneCenters).not.toBe(PRODUCTION_SHOWCASE_01.laneCenters);
    // Gameplay identity differs (M9.3 re-authored the route).
    expect(computeLevelFingerprint(THE_DESCENT_CLASSIC)).not.toBe(
      computeLevelFingerprint(PRODUCTION_SHOWCASE_01),
    );
  });

  it('authors only sourced/contained lava with bounded portals', () => {
    expect(validateLavaAuthoring(THE_DESCENT_CLASSIC)).toEqual([]);
    expect((THE_DESCENT_CLASSIC.lava ?? []).length).toBeGreaterThan(0);
    expect(validatePortalBounds(THE_DESCENT_CLASSIC)).toEqual([]);
  });

  it('authors the same 8 checkpoint crystals with its own music declaration', () => {
    const ids = (THE_DESCENT_CLASSIC.checkpoints ?? []).map((c) => c.id);
    expect(ids).toEqual([
      'cp-forge',
      'cp-skybridge',
      'cp-labyrinth',
      'cp-cathedral',
      'cp-foundry',
      'cp-reactor',
      'cp-temple',
      'cp-core',
    ]);
    expect(THE_DESCENT_CLASSIC.musicTrack?.audioPath).toBe('/audio/Gravity_Lessons.mp3');
    expect(THE_DESCENT_CLASSIC.musicTrack?.trackOffset).toBe(0);
  });

  it('completes the frozen M9.2 reference route with zero deaths', { timeout: 60000 }, () => {
    const sim = new GameSimulation(THE_DESCENT_CLASSIC);
    const { ticks, modes, gravities } = driveTheDescentClassicToFinish(sim);
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    // Frozen anchor: the M9.2 reference route finishes at tick 13799
    // (115.06 s, beat-230 impact) — the M9.3 engine work is time-neutral
    // here too.
    expect(ticks).toBe(13799);
    expect([...modes].sort()).toEqual(['cube', 'ship', 'spider']);
    expect([...gravities].sort()).toEqual(['ceiling', 'floor', 'leftWall', 'rightWall']);
  });

  it('completes the alternate route with zero deaths', { timeout: 60000 }, () => {
    const sim = new GameSimulation(THE_DESCENT_CLASSIC);
    const { ticks } = driveTheDescentClassicToFinish(sim, new TheDescentClassicDriver('alternate'));
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    expect(ticks).toBe(13799);
  });

  it('replays the frozen-route completion tape VERIFIED', { timeout: 60000 }, () => {
    const sim = new GameSimulation(THE_DESCENT_CLASSIC);
    const coordinator = new ReplayCoordinator(sim);
    const driver = new TheDescentClassicDriver('primary');
    recordAttempt(sim, coordinator, () => driver.nextInput(sim.player.position.z, sim));
    const replay = coordinator.lastReplay;
    expect(replay).not.toBeNull();
    expect(replay?.outcome.status).toBe('finished');
    expect(replay?.levelId).toBe('the-descent');
    const verification = playReplay(sim, coordinator, replay);
    expect(verification.kind).toBe('pass');
    expect(sim.status).toBe('finished');
  });

  it('rejects cross-level replays in both directions', { timeout: 120000 }, () => {
    // Record a finished tape on each production level.
    const classicSim = new GameSimulation(THE_DESCENT_CLASSIC);
    const classicCoordinator = new ReplayCoordinator(classicSim);
    const classicDriver = new TheDescentClassicDriver('primary');
    recordAttempt(classicSim, classicCoordinator, () =>
      classicDriver.nextInput(classicSim.player.position.z, classicSim),
    );
    const classicTape = classicCoordinator.lastReplay;
    expect(classicTape?.outcome.status).toBe('finished');

    const evolvedSim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    const evolvedCoordinator = new ReplayCoordinator(evolvedSim);
    const evolvedDriver = new ShowcaseDriver('primary');
    recordAttempt(evolvedSim, evolvedCoordinator, () =>
      evolvedDriver.nextInput(evolvedSim.player.position.z, evolvedSim),
    );
    const evolvedTape = evolvedCoordinator.lastReplay;
    expect(evolvedTape?.outcome.status).toBe('finished');

    // A THE DESCENT tape is never playable against the evolved route.
    const crossSim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    const crossCoordinator = new ReplayCoordinator(crossSim);
    expect(crossCoordinator.startReplay(classicTape).ok).toBe(false);
    // And an evolved tape is never accepted for THE DESCENT.
    const crossSim2 = new GameSimulation(THE_DESCENT_CLASSIC);
    const crossCoordinator2 = new ReplayCoordinator(crossSim2);
    expect(crossCoordinator2.startReplay(evolvedTape).ok).toBe(false);
  });
});
