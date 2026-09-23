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
 * M8.6 production-showcase contract (THE DESCENT rework):
 * - registered as the DEFAULT level; explicit ?level= still resolves old
 *   levels; unknown ids fall back to the showcase with a logged reason
 * - only sourced/contained lava; every portal/teleport gate bounded to
 *   its visible ring
 * - scripted REAL-INPUT reference-route completion: finished, 0 deaths,
 *   115–130 s, every mode + gravity, all Chompers spent, both teleports
 * - the completion tape replays VERIFIED (input-only determinism)
 * - alternate-route completion through the LOW road + low teleport
 * - mandatory routing: wrong maze doors, missed river hops, missed orb
 *   gaps, missed spider snaps and missed teleport rings all fail by
 *   geometry (never arbitrary)
 */
describe('M8.6 production showcase', () => {
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
    expect((def.gravityPortals ?? []).length).toBe(16);
    expect((def.modePortals ?? []).length).toBe(6);
    // M9 musical arrangement: maze/spire/foundry/spider/wall/void/remix
    // tiers (12) — every one bounded to its ring (checked below).
    expect((def.speedPortals ?? []).length).toBe(12);
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

  it('completes the reference route with zero deaths on the musical finish', { timeout: 60000 }, () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    const { ticks, modes, gravities } = driveShowcaseToFinish(sim);
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    const seconds = ticks / 120;
    // M9: the finish lands on the Gravity Lessons final impact (beat 230
    // at 115.06 s) — the musical-finish band replaces the old 115–130 s.
    expect(seconds).toBeGreaterThanOrEqual(114);
    expect(seconds).toBeLessThanOrEqual(117);
    expect([...modes].sort()).toEqual(['cube', 'ship', 'spider']);
    expect([...gravities].sort()).toEqual(['ceiling', 'floor', 'leftWall', 'rightWall']);
    // All five Chompers committed to their lunges and rest spent.
    expect(sim.chomperStates.length).toBe(5);
    for (const st of sim.chomperStates) expect(st.phase).toBe('spent');
    // Reference route takes the high teleport + the maw hop (never low).
    expect(sim.isTeleportUsed('ps-teleport-high')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-maw')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-low')).toBe(false);
    // Speed authority returns to 1× for the finish.
    expect(sim.speedMultiplier).toBe(1);
  });

  it('replays the reference completion tape VERIFIED', { timeout: 60000 }, () => {
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

  it('completes the alternate route (side chain + low teleport) with zero deaths', { timeout: 60000 }, () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    const { ticks } = driveShowcaseToFinish(sim, new ShowcaseDriver('alternate'));
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    const seconds = ticks / 120;
    // M9: same musical-finish band as the primary route.
    expect(seconds).toBeGreaterThanOrEqual(114);
    expect(seconds).toBeLessThanOrEqual(117);
    // Alternate route takes the low teleport + the maw hop (never high).
    expect(sim.isTeleportUsed('ps-teleport-low')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-maw')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-high')).toBe(false);
    for (const st of sim.chomperStates) expect(st.phase).toBe('spent');
  });

  it('kills frontally through the wrong maze door', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // Maze wall 1 (z 450) blocks lane 0 (x 1.3..3.9) with doors on lanes
    // 1 + 2: steer onto lane 0 just before it and hold — frontImpact on
    // the wall face, never an arbitrary kill.
    sim.debugPlaceAt(0, 1.5, 436);
    sim.update(tapLaneLeft);
    for (let tick = 0; tick < 2000 && sim.attempts === 1; tick++) {
      sim.update(idleInput);
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.deathPosition.z).toBeGreaterThan(445);
    expect(sim.deathPosition.z).toBeLessThan(452);
  });

  it('face-plants into the entry gap wall without jumping', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // No inputs at all: the run leaves the entry slab (ends z 20), drops
    // into the 4 u gap and meets the far wall — jumping is mandatory from
    // the very first seconds.
    for (let tick = 0; tick < 2000 && sim.attempts === 1; tick++) {
      sim.update(idleInput);
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.deathPosition.z).toBeGreaterThan(18);
    expect(sim.deathPosition.z).toBeLessThan(28);
  });

  it('kills as lava when the forge river hop is missed', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // Jump the entry gap + stairs + deck-end drop + catcher hop (weaving
    // the MID-deck doors on the way) but NOT the at-grade river
    // (z 140.5..143.5): the lava strip kills.
    const jumps = [18, 36, 43, 53, 89, 104];
    const splitTaps = [
      { atZ: 60, dir: 'right' as const },
      { atZ: 69, dir: 'left' as const },
      { atZ: 81, dir: 'left' as const },
      // Deck-end lane recenter (the catcher island is center-only; the
      // lane settles during the jump-89 flight, same split as the driver).
      { atZ: 89.5, dir: 'right' as const },
      { atZ: 118, dir: 'right' as const },
      { atZ: 126, dir: 'left' as const },
    ];
    let ji = 0;
    let ti = 0;
    for (let tick = 0; tick < 4000 && sim.attempts === 1; tick++) {
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
    expect(sim.deathPosition.z).toBeGreaterThan(139);
    expect(sim.deathPosition.z).toBeLessThan(145);
  });

  it('loses the HIGH line when the HIGH orb is skipped', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // From the HIGH island (top 8, z 312..330) hop the traverse spike
    // (z 322), then take off at 329 WITHOUT the orb: the plain jump falls
    // a full unit short of the HIGH landing (z 340..347 — no teeter save)
    // and drops onto the LOW ground route instead — the orb is mandatory
    // to HOLD the HIGH line (missing it costs the route, never kills
    // arbitrarily).
    sim.debugPlaceAt(0, 8.55, 314);
    const hops = [319, 329];
    let hi = 0;
    let maxYpastGap = -Infinity;
    for (let tick = 0; tick < 12000 && sim.attempts === 1; tick++) {
      const z = sim.player.position.z;
      // Sample past the orb-less flight (it lands ~338): anything HIGH
      // afterwards means the line was held without the orb.
      if (z >= 340 && z <= 365) maxYpastGap = Math.max(maxYpastGap, sim.player.position.y);
      if (hi < hops.length && z >= (hops[hi] as number)) {
        hi++;
        sim.update({
          space: { held: true, pressedThisStep: true, releasedThisStep: false },
          up: { held: false, pressedThisStep: false, releasedThisStep: false },
          down: { held: false, pressedThisStep: false, releasedThisStep: false },
          laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
          laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
        });
        continue;
      }
      sim.update(idleInput);
    }
    expect(hi).toBe(2);
    expect(sim.isInteractionUsed('ps-orb-sky')).toBe(false);
    // Never regained HIGH altitude past the gap (landing top 8).
    expect(maxYpastGap).toBeLessThan(7.5);
    // The orb-less line ends on geometry further down (never arbitrary).
    expect(sim.attempts).toBeGreaterThan(1);
  });

  it('kills frontally on the runway dodge wall when the spider snap is missed', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // The ACT 7 runway dodge wall (y 8..10, z 1446..1450) blocks the floor
    // path: run the runway on the floor without snapping and the wall
    // kills frontally (the ceiling path would clear it). The wall is a
    // plain solid so the floor-line geometry kill is mode-independent —
    // the reference route snaps over it via the ceiling slab instead.
    sim.debugPlaceAt(0, 8.55, 1436);
    for (let tick = 0; tick < 2000 && sim.attempts === 1; tick++) {
      sim.update(idleInput);
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.deathPosition.z).toBeGreaterThan(1443);
    expect(sim.deathPosition.z).toBeLessThan(1450);
  });

  it('face-plants into the ferry deck when the board jump is missed', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // The LOW runway ends at z 378 and the far runway resumes at 408 with
    // the ps-ferry-void deck shuttling laterally between them: running off
    // the lip without the board jump smacks the deck's side face
    // (frontImpact vs the platform solid) — the ferry is mandatory
    // routing, and the reference route jumps on and rides it instead.
    sim.debugPlaceAt(0, 0.55, 370);
    for (let tick = 0; tick < 2000 && sim.attempts === 1; tick++) {
      sim.update(idleInput);
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.lastDeathLethalId).toBe('platform-ps-ferry-void');
    expect(sim.deathPosition.z).toBeGreaterThan(376);
    expect(sim.deathPosition.z).toBeLessThan(392);
  });

  it('kills frontally on the choice divider when both teleport rings are missed', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    // Hold lane 0 past the gantry spike (dodging the HIGH pad), then cut
    // back across the divider plane (x ±1.3, z 1521.2..1523.2) without
    // taking either teleport ring: the killFront divider meets the
    // lane-changer head-on — holding center instead would ride the pad
    // into the HIGH ring, so a lateral miss meets the wall, never nothing.
    sim.debugPlaceAt(2.6, 0.55, 1510.2);
    sim.update(tapLaneLeft);
    let tapped = false;
    for (let tick = 0; tick < 2000 && sim.attempts === 1; tick++) {
      const z = sim.player.position.z;
      if (!tapped && z >= 1518.7) {
        tapped = true;
        sim.update(tapLaneRight);
        continue;
      }
      sim.update(idleInput);
    }
    expect(tapped).toBe(true);
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.deathPosition.z).toBeGreaterThan(1517.2);
    expect(sim.deathPosition.z).toBeLessThan(1525.2);
  });
});

