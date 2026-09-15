import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import {
  DEFAULT_LEVEL_ID,
  getLevel,
  registeredLevelIds,
  resolveLevel,
} from '../src/content/levelRegistry';
import { validateLavaAuthoring } from '../src/level/lavaAuthoring';
import { validatePortalBounds } from '../src/level/portalAuthoring';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { idleInput, tapLaneLeft, tapLaneRight } from './helpers/simulation';
import { recordAttempt, playReplay } from './helpers/replay';
import { ShowcaseDriver, driveShowcaseToFinish } from './helpers/showcaseScript';

/**
 * M8.5 production-showcase contract:
 * - registered as the DEFAULT level; explicit ?level= still resolves old
 *   levels; unknown ids fall back to the showcase with a logged reason
 * - only sourced/contained lava; every portal/teleport gate bounded to
 *   its visible ring
 * - scripted REAL-INPUT reference-route completion: finished, 0 deaths,
 *   115–130 s, every mode + gravity, all Chompers spent, both teleports
 * - the completion tape replays VERIFIED (input-only determinism)
 * - alternate-route completion through the side chain + low teleport
 * - mandatory routing: wrong maze doors, missed river hops, missed orb
 *   gaps and missed teleport rings all fail by geometry (never arbitrary)
 */
describe('M8.5 production showcase', () => {
  it('is registered with its own gameplay identity', () => {
    expect(registeredLevelIds()).toContain('production-showcase-01');
    expect(computeLevelFingerprint(PRODUCTION_SHOWCASE_01)).not.toBe(
      computeLevelFingerprint(TEST_LEVEL),
    );
  });

  it('is the default level with deterministic override behavior', () => {
    expect(DEFAULT_LEVEL_ID).toBe('production-showcase-01');
    expect(resolveLevel(null).level.id).toBe('production-showcase-01');
    expect(resolveLevel(undefined).level.id).toBe('production-showcase-01');
    expect(resolveLevel('').level.id).toBe('production-showcase-01');
    // Explicit selection of legacy levels still works.
    for (const id of [
      'controller-test-01',
      'validation-02',
      'vertical-slice-01',
      'advanced-cube-01',
      'multimode-gauntlet-01',
    ]) {
      const resolution = resolveLevel(id);
      expect(resolution.ok).toBe(true);
      expect(resolution.level.id).toBe(id);
      expect(getLevel(id)?.id).toBe(id);
    }
    // Unknown ids fall back to the showcase explicitly, never silently.
    const fallback = resolveLevel('no-such-level');
    expect(fallback.ok).toBe(false);
    expect(fallback.level.id).toBe('production-showcase-01');
    expect(fallback.reason).toContain('production-showcase-01');
  });

  it('authors only sourced/contained lava (no floating slabs)', () => {
    expect(validateLavaAuthoring(PRODUCTION_SHOWCASE_01)).toEqual([]);
    expect((PRODUCTION_SHOWCASE_01.lava ?? []).length).toBeGreaterThan(0);
  });

  it('bounds every gravity/speed/mode portal and teleport entry to its ring', () => {
    expect(validatePortalBounds(PRODUCTION_SHOWCASE_01)).toEqual([]);
    const def = PRODUCTION_SHOWCASE_01;
    expect((def.gravityPortals ?? []).length).toBe(10);
    expect((def.modePortals ?? []).length).toBe(4);
    expect((def.speedPortals ?? []).length).toBe(2);
    expect((def.teleportPortals ?? []).length).toBe(3);
    for (const p of def.gravityPortals ?? []) {
      expect(p.triggerCenter, p.id).toBeDefined();
      expect(p.triggerHalfExtents, p.id).toBeDefined();
    }
    for (const p of def.modePortals ?? []) {
      expect(p.triggerCenter, p.id).toBeDefined();
      expect(p.triggerHalfExtents, p.id).toBeDefined();
    }
    for (const p of def.speedPortals ?? []) {
      expect(p.triggerCenter, p.id).toBeDefined();
      expect(p.triggerHalfExtents, p.id).toBeDefined();
    }
    for (const p of def.teleportPortals ?? []) {
      expect(p.entryCenter, p.id).toBeDefined();
      expect(p.entryHalfExtents, p.id).toBeDefined();
    }
  });

  it('completes the reference route with zero deaths in 115–130 s', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    const { ticks, modes, gravities } = driveShowcaseToFinish(sim);
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    const seconds = ticks / 120;
    expect(seconds).toBeGreaterThanOrEqual(115);
    expect(seconds).toBeLessThanOrEqual(130);
    expect([...modes].sort()).toEqual(['cube', 'ship', 'spider']);
    expect([...gravities].sort()).toEqual(['ceiling', 'floor', 'leftWall', 'rightWall']);
    // All four Chompers committed to their lunges and rest spent.
    expect(sim.chomperStates.length).toBe(4);
    for (const st of sim.chomperStates) expect(st.phase).toBe('spent');
    // Reference route takes the high teleport + the maw hop (never low).
    expect(sim.isTeleportUsed('ps-teleport-high')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-maw')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-low')).toBe(false);
    // Speed authority returns to 1× for the finish.
    expect(sim.speedMultiplier).toBe(1);
  });

  it('replays the reference completion tape VERIFIED', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    const coordinator = new ReplayCoordinator(sim);
    const driver = new ShowcaseDriver('primary');
    recordAttempt(sim, coordinator, () => driver.nextInput(sim.player.position.z, sim));
    const replay = coordinator.lastReplay;
    expect(replay).not.toBeNull();
    expect(replay?.outcome.status).toBe('finished');
    expect(replay?.levelId).toBe('production-showcase-01');
    const verification = playReplay(sim, coordinator, replay);
    expect(verification.kind).toBe('pass');
    expect(sim.status).toBe('finished');
  });

  it('completes the alternate route (side chain + low teleport) with zero deaths', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    const { ticks } = driveShowcaseToFinish(sim, new ShowcaseDriver('alternate'));
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    const seconds = ticks / 120;
    expect(seconds).toBeGreaterThanOrEqual(115);
    expect(seconds).toBeLessThanOrEqual(130);
    // Alternate route takes the low teleport + the maw hop (never high).
    expect(sim.isTeleportUsed('ps-teleport-low')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-maw')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-high')).toBe(false);
    for (const st of sim.chomperStates) expect(st.phase).toBe('spent');
  });

  it('kills frontally through the wrong maze door', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // Jump the ACT 1 gaps + river but hold center: wall 1 (z 405) has
    // doors on lanes 0/2, so the center lane runs into killFront.
    const driver = new ShowcaseDriver('primary');
    // Strip the maze taps by consuming a fresh driver up to the maze.
    void driver;
    const jumps = [37.5, 93.5, 172.5, 192.0, 235.5, 251.5, 267.5, 291.5, 352.0];
    const splitTaps = [
      { atZ: 150, dir: 'left' as const },
      { atZ: 162, dir: 'right' as const },
    ];
    let ji = 0;
    let ti = 0;
    let tick = 0;
    for (; tick < 9000 && sim.attempts === 1; tick++) {
      const z = sim.player.position.z;
      if (sim.playerMode === 'ship') break;
      if (ji < jumps.length && z >= (jumps[ji] as number)) {
        ji++;
        sim.update({
          space: { held: true, pressedThisStep: true, releasedThisStep: false },
          up: { held: false, pressedThisStep: false, releasedThisStep: false },
          down: { held: false, pressedThisStep: false, releasedThisStep: false },
          laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
          laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
        });
        sim.update(idleInput);
        tick++;
        continue;
      }
      const splitTap = splitTaps[ti];
      if (splitTap !== undefined && z >= splitTap.atZ) {
        ti++;
        sim.update(splitTap.dir === 'left' ? tapLaneLeft : tapLaneRight);
        continue;
      }
      sim.update(idleInput);
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.deathPosition.z).toBeGreaterThan(380);
    expect(sim.deathPosition.z).toBeLessThan(420);
  });

  it('kills as lava in the ACT 1 gap basins', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    for (let tick = 0; tick < 2000 && sim.attempts === 1; tick++) {
      sim.update(idleInput);
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('lava');
  });

  it('kills as lava when the forge river hop is missed', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // Jump both gap basins + the spike but NOT the river: lava.
    const jumps = [37.5, 93.5, 172.5];
    const splitTaps = [
      { atZ: 150, dir: 'left' as const },
      { atZ: 162, dir: 'right' as const },
    ];
    let ji = 0;
    let ti = 0;
    for (let tick = 0; tick < 6000 && sim.attempts === 1; tick++) {
      const z = sim.player.position.z;
      if (ji < jumps.length && z >= (jumps[ji] as number)) {
        ji++;
        sim.update({
          space: { held: true, pressedThisStep: true, releasedThisStep: false },
          up: { held: false, pressedThisStep: false, releasedThisStep: false },
          down: { held: false, pressedThisStep: false, releasedThisStep: false },
          laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
          laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
        });
        continue;
      }
      const splitTap = splitTaps[ti];
      if (splitTap !== undefined && z >= splitTap.atZ) {
        ti++;
        sim.update(splitTap.dir === 'left' ? tapLaneLeft : tapLaneRight);
        continue;
      }
      sim.update(idleInput);
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('lava');
    expect(sim.deathPosition.z).toBeGreaterThan(190);
    expect(sim.deathPosition.z).toBeLessThan(200);
  });

  it('fails by geometry (void) when the orb gap is crossed without the orb', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // Full reference inputs EXCEPT the orb press: the plain run into the
    // 9 u gap must fall to the void (the orb is mandatory routing).
    const driver = new ShowcaseDriver('primary');
    void driver;
    const jumps = [37.5, 93.5, 172.5, 192.0, 235.5, 251.5, 267.5, 291.5];
    const taps = [
      { atZ: 150, dir: 'left' as const },
      { atZ: 162, dir: 'right' as const },
    ];
    let ji = 0;
    let ti = 0;
    for (let tick = 0; tick < 9000 && sim.attempts === 1; tick++) {
      const z = sim.player.position.z;
      if (ji < jumps.length && z >= (jumps[ji] as number)) {
        ji++;
        sim.update({
          space: { held: true, pressedThisStep: true, releasedThisStep: false },
          up: { held: false, pressedThisStep: false, releasedThisStep: false },
          down: { held: false, pressedThisStep: false, releasedThisStep: false },
          laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
          laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
        });
        sim.update(idleInput);
        tick++;
        continue;
      }
      const tap = taps[ti];
      if (tap !== undefined && z >= tap.atZ) {
        ti++;
        sim.update(tap.dir === 'left' ? tapLaneLeft : tapLaneRight);
        continue;
      }
      sim.update(idleInput);
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('void');
    expect(sim.deathPosition.z).toBeGreaterThan(350);
    expect(sim.deathPosition.z).toBeLessThan(375);
  });

  it('kills frontally on the choice divider when both teleport rings are missed', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // Teleport straight onto the divider line past the gantry approach:
    // the run meets the killFront divider (never an arbitrary kill).
    sim.debugPlaceAt(0, 1.5, 1350);
    for (let tick = 0; tick < 2000 && sim.attempts === 1; tick++) {
      sim.update(idleInput);
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.deathPosition.z).toBeGreaterThan(1355);
    expect(sim.deathPosition.z).toBeLessThan(1370);
  });
});

