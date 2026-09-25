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
import { collectRouteMetrics } from './helpers/routeMetrics';

/**
 * M9.4.1 original-level contract (THE DESCENT, `the-descent`):
 * - the REAL pre-M8.6 M8.5 production route from Git revision 34db456
 *   (NOT the M9.2 snapshot M9.4 froze by mistake — M9.2 is already
 *   post-M8.6 super-difficult content)
 * - registered as an independent production level (own id, default stays
 *   the evolved route, card metadata derives from the registry data)
 * - content independent from the evolved route (no shared mutable arrays;
 *   distinct gameplay fingerprint; drastically lower density)
 * - valid authoring (sourced/contained lava, bounded portals, 8 crystals
 *   authored for THIS geometry, own background-music declaration)
 * - the recovered M8.5 driver still completes it on the current engine
 *   with zero deaths at the historical 13955-tick anchor, and the tape
 *   replays VERIFIED
 */
describe('M9.4.1 THE DESCENT (original M8.5 route)', () => {
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
    // Gameplay identity differs (M8.6+ re-authored the route twice over).
    expect(computeLevelFingerprint(THE_DESCENT_CLASSIC)).not.toBe(
      computeLevelFingerprint(PRODUCTION_SHOWCASE_01),
    );
  });

  it('provenance: carries the M8.5 content signature, not M8.6/M9.2', () => {
    // Finish + interaction census: the original ends at z=1750 with the
    // M8.5 portal/chomper census; the evolved route ends at z=1790 with
    // strictly more of everything (funnels, ferries, extra Chomper).
    expect(THE_DESCENT_CLASSIC.finishZ).toBe(1750);
    expect(PRODUCTION_SHOWCASE_01.finishZ).toBe(1790);
    expect((THE_DESCENT_CLASSIC.movingPlatforms ?? []).length).toBe(0);
    expect((PRODUCTION_SHOWCASE_01.movingPlatforms ?? []).length).toBeGreaterThan(0);
    expect((THE_DESCENT_CLASSIC.gravityPortals ?? []).map((p) => p.id)).toEqual([
      'ps-wall-left',
      'ps-ceiling',
      'ps-wall-right',
      'ps-floor-again',
      'ps-ship-invert',
      'ps-ship-revert',
      'ps-temple-wall',
      'ps-temple-floor',
      'ps-final-wall',
      'ps-final-floor',
    ]);
    expect((THE_DESCENT_CLASSIC.modePortals ?? []).map((p) => p.id)).toEqual([
      'ps-ship-on',
      'ps-ship-off',
      'ps-spider-on',
      'ps-spider-off',
    ]);
    expect((THE_DESCENT_CLASSIC.teleportPortals ?? []).map((p) => p.id)).toEqual([
      'ps-teleport-high',
      'ps-teleport-low',
      'ps-teleport-maw',
    ]);
    expect((THE_DESCENT_CLASSIC.speedPortals ?? []).map((p) => p.id)).toEqual([
      'ps-speed-2x',
      'ps-speed-1x',
    ]);
    expect((THE_DESCENT_CLASSIC.chompers ?? []).length).toBe(4);
    expect((PRODUCTION_SHOWCASE_01.chompers ?? []).length).toBeGreaterThan(4);
    expect((THE_DESCENT_CLASSIC.jumpPads ?? []).length).toBe(2);
    expect((THE_DESCENT_CLASSIC.jumpOrbs ?? []).length).toBe(2);
    // Raw content volume: the original is a fraction of the evolved route.
    expect(THE_DESCENT_CLASSIC.solids.length).toBe(100);
    expect(THE_DESCENT_CLASSIC.hazards.length).toBe(32);
    expect(THE_DESCENT_CLASSIC.solids.length).toBeLessThan(
      PRODUCTION_SHOWCASE_01.solids.length,
    );
    expect(THE_DESCENT_CLASSIC.hazards.length).toBeLessThan(
      PRODUCTION_SHOWCASE_01.hazards.length,
    );
  });

  it('provenance: route density matches the M8.5 audit, far below evolved', () => {
    // M8.6 flatness audit (measured M8.5 primary route): ~60 action events,
    // ~30 jump edges, ~12 lane edges, 0 fast-fall, 32 distinct supports,
    // sum|dY| ~206.6, sum|dX| ~89.4. Someone swapping in a later
    // super-difficult snapshot trips every one of these.
    const primaryDriver = new TheDescentClassicDriver('primary');
    const primary = collectRouteMetrics(THE_DESCENT_CLASSIC, (z, sim) =>
      primaryDriver.nextInput(z, sim),
    );
    expect(primary.status).toBe('finished');
    expect(primary.ticks).toBe(13955);
    expect(primary.actionEvents).toBe(67);
    expect(primary.jumpEdges).toBe(30);
    expect(primary.laneEdges).toBe(12);
    expect(primary.fastFallHeld).toBe(0);
    expect(primary.distinctSupports).toBe(32);
    expect(primary.supportChanges).toBe(78);
    expect(primary.sumDy).toBeCloseTo(206.6, 1);
    expect(primary.sumDx).toBeCloseTo(89.4, 1);
    expect(primary.gravityTransitions).toBe(16);
    expect(primary.modeTransitions).toBe(4);

    const alternateDriver = new TheDescentClassicDriver('alternate');
    const alternate = collectRouteMetrics(THE_DESCENT_CLASSIC, (z, sim) =>
      alternateDriver.nextInput(z, sim),
    );
    expect(alternate.status).toBe('finished');
    expect(alternate.ticks).toBe(13955);
    expect(alternate.fastFallHeld).toBe(0);
    expect(alternate.distinctSupports).toBe(32);
    expect(alternate.jumpEdges).toBeLessThan(40);
    expect(alternate.laneEdges).toBeLessThan(25);
    expect(alternate.actionEvents).toBeLessThan(90);

    // And the evolved route lives on another planet density-wise.
    const evolvedDriver = new ShowcaseDriver('primary');
    const evolved = collectRouteMetrics(PRODUCTION_SHOWCASE_01, (z, sim) =>
      evolvedDriver.nextInput(z, sim),
    );
    expect(evolved.status).toBe('finished');
    expect(evolved.actionEvents).toBeGreaterThan(500);
    expect(evolved.distinctSupports).toBeGreaterThan(64);
    expect(evolved.actionEvents).toBeGreaterThan(primary.actionEvents * 5);
  });

  it('authors only sourced/contained lava with bounded portals', () => {
    expect(validateLavaAuthoring(THE_DESCENT_CLASSIC)).toEqual([]);
    expect((THE_DESCENT_CLASSIC.lava ?? []).length).toBeGreaterThan(0);
    expect(validatePortalBounds(THE_DESCENT_CLASSIC)).toEqual([]);
  });

  it('authors 8 checkpoint crystals for its own geometry + background music', () => {
    const ids = (THE_DESCENT_CLASSIC.checkpoints ?? []).map((c) => c.id);
    expect(ids).toEqual([
      'cp-forge',
      'cp-islands',
      'cp-labyrinth',
      'cp-cathedral',
      'cp-canyon',
      'cp-reactor',
      'cp-temple',
      'cp-core',
    ]);
    // Background music only: the M8.5 route predates M9 rhythm authoring
    // and is NOT beat-mapped (geometry untouched for sync).
    expect(THE_DESCENT_CLASSIC.musicTrack?.audioPath).toBe('/audio/Gravity_Lessons.mp3');
    expect(THE_DESCENT_CLASSIC.musicTrack?.trackOffset).toBe(0);
  });

  it('completes the recovered M8.5 reference route with zero deaths', { timeout: 60000 }, () => {
    const sim = new GameSimulation(THE_DESCENT_CLASSIC);
    const { ticks, modes, gravities } = driveTheDescentClassicToFinish(sim);
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    // Historical anchor: the M8.5 reference route finishes at tick 13955
    // (116.29 s) — reproduced tick-exact on the current engine.
    expect(ticks).toBe(13955);
    expect([...modes].sort()).toEqual(['cube', 'ship', 'spider']);
    expect([...gravities].sort()).toEqual(['ceiling', 'floor', 'leftWall', 'rightWall']);
  });

  it('completes the alternate route with zero deaths', { timeout: 60000 }, () => {
    const sim = new GameSimulation(THE_DESCENT_CLASSIC);
    const { ticks } = driveTheDescentClassicToFinish(sim, new TheDescentClassicDriver('alternate'));
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    expect(ticks).toBe(13955);
  });

  it('all 8 crystals activate on both M8.5 routes, trajectory untouched', { timeout: 120000 }, () => {
    for (const variant of ['primary', 'alternate'] as const) {
      const sim = new GameSimulation(THE_DESCENT_CLASSIC);
      sim.setCheckpointRespawnEnabled(true);
      const driver = new TheDescentClassicDriver(variant);
      const activated: string[] = [];
      let tick = 0;
      for (; tick < 30000; tick++) {
        if (sim.status !== 'running') break;
        sim.update(driver.nextInput(sim.player.position.z, sim));
        const last = sim.lastCheckpointId;
        if (last !== null && !activated.includes(last)) activated.push(last);
      }
      expect(sim.status).toBe('finished');
      // Checkpoint detection never perturbs the trajectory.
      expect(tick).toBe(13955);
      expect(activated).toEqual([
        'cp-forge',
        'cp-islands',
        'cp-labyrinth',
        'cp-cathedral',
        'cp-canyon',
        'cp-reactor',
        'cp-temple',
        'cp-core',
      ]);
      expect(sim.checkpointProgress()).toEqual({ activeIndex: 8, total: 8 });
    }
  });

  it('replays the original-route completion tape VERIFIED', { timeout: 60000 }, () => {
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
