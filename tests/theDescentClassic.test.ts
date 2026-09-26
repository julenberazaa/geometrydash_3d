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
import { idleInput } from './helpers/simulation';
import { ShowcaseDriver } from './helpers/showcaseScript';
import { collectRouteMetrics } from './helpers/routeMetrics';

/**
 * M9.5 THE DESCENT contract (`the-descent`):
 * - the M8.6 density-verticality production route (M9.4.2 provenance) plus
 *   the M9.5 SURGICAL polish: +3 Chompers (deck/lower/shaft), the LOW
 *   under-deck weave, upper/lower maze doors, foundry-exit doors replacing
 *   one hop (−1 spike). Foundation systems (portals/pads/orbs/teleports/
 *   platforms/checkpoints/music binding) otherwise unchanged.
 * - registered as an independent production level (own id, GRAVITY RIFT
 *   stays the default, card metadata derives from the registry data)
 * - content independent from GRAVITY RIFT (no shared mutable arrays;
 *   distinct gameplay fingerprint)
 * - valid authoring (sourced/contained lava, bounded portals, 8 crystals
 *   authored for the M8.6 geometry, Zenith music declaration)
 * - the M9.5 reference driver completes it on the current engine with
 *   zero deaths at the preserved 14797-tick anchor, and the tape replays
 *   VERIFIED
 */
describe('M9.5 THE DESCENT (M8.6 foundation + Zenith density polish)', () => {
  it('is registered with its own level id', () => {
    expect(registeredLevelIds()).toContain('the-descent');
    expect(THE_DESCENT_CLASSIC.id).toBe('the-descent');
    expect(THE_DESCENT_CLASSIC.displayName).toBe('THE DESCENT');
    expect(resolveLevel('the-descent').level.id).toBe('the-descent');
    expect(resolveLevel('the-descent').ok).toBe(true);
    expect(getLevel('the-descent')).toBe(THE_DESCENT_CLASSIC);
  });

  it('leaves GRAVITY RIFT as the default level with a stable internal id', () => {
    expect(DEFAULT_LEVEL_ID).toBe('production-showcase-01');
    expect(resolveLevel(null).level.id).toBe('production-showcase-01');
    // User-facing rename only: the internal id never changed (replay /
    // fingerprint / URL compatibility), the display name is GRAVITY RIFT.
    expect(PRODUCTION_SHOWCASE_01.id).toBe('production-showcase-01');
    expect(PRODUCTION_SHOWCASE_01.displayName).toBe('GRAVITY RIFT');
  });

  it('is covered by declarative card metadata', () => {
    const ids = PRODUCTION_LEVEL_CARDS.map((c) => c.levelId);
    expect(ids).toContain('the-descent');
    expect(ids).toContain('production-showcase-01');
    for (const card of PRODUCTION_LEVEL_CARDS) {
      expect(getLevel(card.levelId)?.id, card.levelId).toBe(card.levelId);
    }
    const descent = PRODUCTION_LEVEL_CARDS.find((c) => c.levelId === 'the-descent');
    const rift = PRODUCTION_LEVEL_CARDS.find((c) => c.levelId === 'production-showcase-01');
    expect(descent?.tag).toBe('ORIGINAL M8.6');
    expect(rift?.tag).toBe('EXPERT');
  });

  it('shares no mutable content with GRAVITY RIFT', () => {
    expect(THE_DESCENT_CLASSIC).not.toBe(PRODUCTION_SHOWCASE_01);
    expect(THE_DESCENT_CLASSIC.solids).not.toBe(PRODUCTION_SHOWCASE_01.solids);
    expect(THE_DESCENT_CLASSIC.hazards).not.toBe(PRODUCTION_SHOWCASE_01.hazards);
    expect(THE_DESCENT_CLASSIC.gravityPortals).not.toBe(PRODUCTION_SHOWCASE_01.gravityPortals);
    expect(THE_DESCENT_CLASSIC.checkpoints).not.toBe(PRODUCTION_SHOWCASE_01.checkpoints);
    expect(THE_DESCENT_CLASSIC.laneCenters).not.toBe(PRODUCTION_SHOWCASE_01.laneCenters);
    // Gameplay identity differs (the modern route was re-authored twice
    // over: M9 retime + M9.1 rebuild + M9.3 surgery).
    expect(computeLevelFingerprint(THE_DESCENT_CLASSIC)).not.toBe(
      computeLevelFingerprint(PRODUCTION_SHOWCASE_01),
    );
  });

  it('provenance: carries the M8.6 content signature plus the M9.5 surgical additions', () => {
    // Finish + interaction census: the M8.6 route ends at z=1790 with 16
    // gravity / 6 speed / 6 mode portals, 3 teleports, 5 pads, 3 jump
    // orbs, 2 gravity orbs, 5 platforms — all unchanged. M9.5 adds 3
    // Chompers (deck/lower/shaft → 8 total, at the ≤8 cap), 3 anchor
    // pillars (→ 178 solids) and +7 net hazards (LOW weave pair, upper
    // door trio, lower door, foundry door pair, minus the replaced 1100
    // hop → 84).
    expect(THE_DESCENT_CLASSIC.finishZ).toBe(1790);
    expect((THE_DESCENT_CLASSIC.movingPlatforms ?? []).map((p) => p.id)).toEqual([
      'ps-lift-void',
      'ps-ferry-void',
      'ps-ferry-maze-a',
      'ps-ferry-maze-b',
      'ps-ferry-chomp',
    ]);
    expect((THE_DESCENT_CLASSIC.gravityPortals ?? []).map((p) => p.id)).toEqual([
      'ps-spire-up',
      'ps-spire-wall',
      'ps-spire-right',
      'ps-spire-down',
      'ps-foundry-up',
      'ps-foundry-down',
      'ps-abyss-invert',
      'ps-abyss-revert',
      'ps-abyss-invert2',
      'ps-abyss-revert2',
      'ps-climb-wall',
      'ps-climb-floor',
      'ps-remix-up',
      'ps-remix-down',
      'ps-remix-wall',
      'ps-remix-floor',
    ]);
    expect((THE_DESCENT_CLASSIC.modePortals ?? []).map((p) => p.id)).toEqual([
      'ps-ship-on',
      'ps-ship-off',
      'ps-spider-on',
      'ps-spider-off',
      'ps-remix-spider-on',
      'ps-remix-spider-off',
    ]);
    expect((THE_DESCENT_CLASSIC.teleportPortals ?? []).map((p) => p.id)).toEqual([
      'ps-teleport-high',
      'ps-teleport-low',
      'ps-teleport-maw',
    ]);
    expect((THE_DESCENT_CLASSIC.speedPortals ?? []).map((p) => p.id)).toEqual([
      'ps-speed-maze',
      'ps-speed-spire',
      'ps-speed-remix',
      'ps-speed-calm',
      'ps-speed-remix2',
      'ps-speed-calm2',
    ]);
    expect((THE_DESCENT_CLASSIC.chompers ?? []).map((c) => c.id)).toEqual([
      'ps-chomp-ferry',
      'ps-chomp-weave',
      'ps-chomp-ceil',
      'ps-chomp-low',
      'ps-chomp-final',
      'ps-chomp-deck',
      'ps-chomp-lower',
      'ps-chomp-shaft',
    ]);
    expect((THE_DESCENT_CLASSIC.jumpPads ?? []).map((p) => p.id)).toEqual([
      'ps-pad-sky',
      'ps-pad-ridge',
      'ps-pad-maze',
      'ps-pad-high',
      'ps-pad-shaft',
    ]);
    expect((THE_DESCENT_CLASSIC.jumpOrbs ?? []).map((o) => o.id)).toEqual([
      'ps-orb-sky',
      'ps-orb-terminal-a',
      'ps-orb-terminal-b',
    ]);
    expect((THE_DESCENT_CLASSIC.gravityOrbs ?? []).map((o) => o.id)).toEqual([
      'ps-gorb-spire',
      'ps-gorb-spire-back',
    ]);
    // Raw content volume: M9.5 adds 3 pillars + 7 net hazards on the M8.6
    // route; the focused exit/LOW maze pass adds seven authored hazards.
    expect(THE_DESCENT_CLASSIC.solids.length).toBe(178);
    expect(THE_DESCENT_CLASSIC.hazards.length).toBe(91);
  });

  it('M9.5: primary route density (M8.6 foundation + surgical polish)', { timeout: 120000 }, () => {
    // Measured M9.5 primary route: M8.6 was 97 skill jumps / 62 lane
    // edges / 44 reversals / 79 supports / sum|dY| 557.5 / sum|dX| 197.8.
    // The polish adds laterals (upper doors + foundry doors + reactive
    // deck jump) while the 14797-tick anchor holds. M9.6 Zone G adds the
    // island weave (180.5/190.5 ride lane 0: +2 lane edges, +5.2 lateral
    // travel — exactly one out-and-back; reversals stay 48 because the
    // return pre-flips the sign the 286 tap used to flip). Exact pins:
    // swapping in any other snapshot trips them.
    const driver = new TheDescentClassicDriver('primary');
    const m = collectRouteMetrics(THE_DESCENT_CLASSIC, (z, sim) =>
      driver.nextInput(z, sim),
    );
    expect(m.status).toBe('finished');
    expect(m.ticks).toBe(14797);
    expect(m.cubeJumpEdges).toBe(98);
    expect(m.laneEdges).toBe(70);
    expect(m.xReversals).toBe(48);
    expect(m.fastFallHeld).toBe(144);
    expect(m.distinctSupports).toBe(79);
    expect(m.supportChanges).toBe(207);
    expect(m.sumDy).toBeCloseTo(553.2, 1);
    expect(m.sumDx).toBeCloseTo(218.6, 1);
    expect(m.gravityTransitions).toBe(30);
    expect(m.modeTransitions).toBe(6);
    expect(m.spiderPresses).toBe(17);
    expect(m.pads).toBe(5);
    expect(m.orbs).toBe(5);
    expect(m.yRange).toBeGreaterThanOrEqual(12);
    expect(m.bandsVisited).toBeGreaterThanOrEqual(8);
    expect(m.maxActionGapTicks).toBeLessThanOrEqual(180);
    // The maze ferry pair + void ferry + Chomper ferry ride, plus the
    // HIGH elevator on the primary line.
    expect(m.platformSupports.length).toBeGreaterThanOrEqual(4);
    expect(m.platformSupportTicks).toBeGreaterThan(100);
    expect(m.platformSupports).toContain('platform-ps-lift-void');
  });

  it('M9.5: alternate route density (M8.6 foundation + surgical polish)', { timeout: 120000 }, () => {
    // Measured M9.5 LOW technical line: M8.6 was 93 skill jumps / 70
    // lane edges / 43 reversals / 76 supports / sum|dY| 505.0 /
    // sum|dX| 209.5. The polish adds laterals (LOW weave + lower door +
    // foundry doors; the 594 hop is subsumed) while the anchor holds.
    // M9.6 Zone G adds the island weave (+2 lane edges, +5.2 travel;
    // reversals 49 → 51: the weave turnaround plus the re-armed 215
    // split switch).
    const driver = new TheDescentClassicDriver('alternate');
    const m = collectRouteMetrics(THE_DESCENT_CLASSIC, (z, sim) =>
      driver.nextInput(z, sim),
    );
    expect(m.status).toBe('finished');
    expect(m.ticks).toBe(14797);
    expect(m.cubeJumpEdges).toBe(93);
    expect(m.laneEdges).toBe(80);
    expect(m.xReversals).toBe(51);
    expect(m.fastFallHeld).toBe(35);
    expect(m.distinctSupports).toBe(76);
    expect(m.supportChanges).toBe(206);
    expect(m.sumDy).toBeCloseTo(494.1, 1);
    expect(m.sumDx).toBeCloseTo(240.1, 1);
    expect(m.gravityTransitions).toBe(30);
    expect(m.modeTransitions).toBe(6);
    expect(m.spiderPresses).toBe(17);
    expect(m.pads).toBe(1);
    expect(m.orbs).toBe(2);
    expect(m.maxActionGapTicks).toBeLessThanOrEqual(180);
    expect(m.platformSupports.length).toBeGreaterThanOrEqual(4);
    expect(m.platformSupportTicks).toBeGreaterThan(100);
  });

  it('provenance: this is NOT the M8.5 simple version', { timeout: 120000 }, () => {
    // M8.5 baseline (the exact mistake that happened twice — M9.4 froze
    // M9.2 here, M9.4.1 stored M8.5 here): 30 jumps, 12 lane edges,
    // 0 deliberate fast-fall, 32 supports, sum|dY| 206.6, sum|dX| 89.4.
    // Every M8.6 floor below sits far above the M8.5 ceiling.
    const M85 = {
      jumpEdges: 30,
      laneEdges: 12,
      fastFallHeld: 0,
      distinctSupports: 32,
      sumDy: 206.6,
      sumDx: 89.4,
    };
    for (const variant of ['primary', 'alternate'] as const) {
      const driver = new TheDescentClassicDriver(variant);
      const m = collectRouteMetrics(THE_DESCENT_CLASSIC, (z, sim) =>
        driver.nextInput(z, sim),
      );
      expect(m.status).toBe('finished');
      expect(m.cubeJumpEdges, `${variant} jumps above M8.5`).toBeGreaterThanOrEqual(85);
      expect(M85.jumpEdges).toBeLessThan(85);
      expect(m.laneEdges, `${variant} lanes above M8.5`).toBeGreaterThanOrEqual(50);
      expect(M85.laneEdges).toBeLessThan(50);
      expect(m.fastFallHeld, `${variant} fast-fall above M8.5`).toBeGreaterThan(M85.fastFallHeld);
      expect(m.distinctSupports, `${variant} supports above M8.5`).toBeGreaterThanOrEqual(64);
      expect(M85.distinctSupports).toBeLessThan(64);
      expect(m.sumDy, `${variant} vertical travel above M8.5`).toBeGreaterThanOrEqual(400);
      expect(M85.sumDy).toBeLessThan(400);
      expect(m.sumDx, `${variant} lateral travel above M8.5`).toBeGreaterThanOrEqual(150);
      expect(M85.sumDx).toBeLessThan(150);
    }
  });

  it('authors only sourced/contained lava with bounded portals', () => {
    expect(validateLavaAuthoring(THE_DESCENT_CLASSIC)).toEqual([]);
    expect((THE_DESCENT_CLASSIC.lava ?? []).length).toBe(22);
    expect(validatePortalBounds(THE_DESCENT_CLASSIC)).toEqual([]);
  });

  it('connects the cavern vent to its basin outside the outer playable lane', () => {
    const lava = THE_DESCENT_CLASSIC.lava ?? [];
    const source = lava.find((volume) => volume.id === 'ps-spire-strip-src');
    const fall = lava.find((volume) => volume.id === 'ps-spire-strip-fall');
    const pool = lava.find((volume) => volume.id === 'ps-spire-strip');
    expect(source?.role).toBe('source');
    expect(fall?.role).toBe('fall');
    expect(pool?.role).toBe('pool');
    if (!source || !fall || !pool) return;

    expect(fall.center.y + fall.halfExtents.y).toBeGreaterThanOrEqual(source.center.y - source.halfExtents.y);
    expect(fall.center.y - fall.halfExtents.y).toBeLessThanOrEqual(pool.center.y + pool.halfExtents.y);
    expect(fall.center.x - fall.halfExtents.x).toBeGreaterThan(2.6 + 0.55);
  });

  it('authors 8 checkpoint crystals for its own M8.6 geometry and declares the Zenith track', () => {
    const ids = (THE_DESCENT_CLASSIC.checkpoints ?? []).map((c) => c.id);
    expect(ids).toEqual([
      'cp-forge',
      'cp-skybridge',
      'cp-maze',
      'cp-spire',
      'cp-foundry',
      'cp-abyss',
      'cp-temple',
      'cp-remix',
    ]);
    // M9.5: THE DESCENT declares the Zenith of the Path track (offset 0)
    // through the same level-driven binding as GRAVITY RIFT (presentation-
    // only: never fingerprinted, never replayed). The sim owns only the
    // snapshot mechanics — music seek on restore is Game-owned.
    expect(THE_DESCENT_CLASSIC.musicTrack?.audioPath).toBe('/audio/Zenith_of_the_Path.mp3');
    expect(THE_DESCENT_CLASSIC.musicTrack?.trackOffset).toBe(0);
    // GRAVITY RIFT keeps its Gravity Lessons binding (background proof
    // that music-optionality is per level, not global).
    expect(PRODUCTION_SHOWCASE_01.musicTrack?.audioPath).toBe('/audio/Gravity_Lessons.mp3');
  });

  it('completes the M9.5 reference route with zero deaths', { timeout: 60000 }, () => {
    const sim = new GameSimulation(THE_DESCENT_CLASSIC);
    const { ticks, modes, gravities } = driveTheDescentClassicToFinish(sim);
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    // Preserved anchor: the M8.6 reference route finished at tick 14797
    // (123.31 s); the M9.5 surgical edits are time-neutral (no portal or
    // speed moved), so the anchor holds tick-exact with zero driver
    // repair beyond the new challenges.
    expect(ticks).toBe(14797);
    expect([...modes].sort()).toEqual(['cube', 'ship', 'spider']);
    expect([...gravities].sort()).toEqual(['ceiling', 'floor', 'leftWall', 'rightWall']);
    for (const st of sim.chomperStates) expect(st.phase).toBe('spent');
    expect(sim.isTeleportUsed('ps-teleport-high')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-maw')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-low')).toBe(false);
    expect(sim.speedMultiplier).toBe(1);
  });

  it('completes the alternate route with zero deaths', { timeout: 60000 }, () => {
    const sim = new GameSimulation(THE_DESCENT_CLASSIC);
    const { ticks } = driveTheDescentClassicToFinish(sim, new TheDescentClassicDriver('alternate'));
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    expect(ticks).toBe(14797);
    // Alternate route takes the low teleport + the maw hop (never high).
    expect(sim.isTeleportUsed('ps-teleport-low')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-maw')).toBe(true);
    expect(sim.isTeleportUsed('ps-teleport-high')).toBe(false);
    for (const st of sim.chomperStates) expect(st.phase).toBe('spent');
  });

  it('all 8 crystals activate on both M9.5 routes, trajectory untouched', { timeout: 180000 }, () => {
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
      expect(tick).toBe(14797);
      expect(activated).toEqual([
        'cp-forge',
        'cp-skybridge',
        'cp-maze',
        'cp-spire',
        'cp-foundry',
        'cp-abyss',
        'cp-temple',
        'cp-remix',
      ]);
      expect(sim.checkpointProgress()).toEqual({ activeIndex: 8, total: 8 });
    }
  });

  it('checkpoint restore works with music seek owned by Game (sim stays pure)', { timeout: 60000 }, () => {
    // Earn cp-forge on the real M8.6 route, then die: the sim restores
    // the crystal snapshot as pure simulation state (music re-seek to the
    // checkpoint sim time is Game-owned via restartMusicForSimTime —
    // the sim never touches audio).
    const sim = new GameSimulation(THE_DESCENT_CLASSIC);
    sim.setCheckpointRespawnEnabled(true);
    const driver = new TheDescentClassicDriver('primary');
    let guard = 0;
    while (sim.activeCheckpointId !== 'cp-forge' && guard++ < 3000) {
      if (sim.status !== 'running') break;
      sim.update(driver.nextInput(sim.player.position.z, sim));
    }
    expect(sim.activeCheckpointId).toBe('cp-forge');
    // Void-kill and step through the death hold: the sim auto-respawns
    // from the crystal snapshot (pure simulation state — Game re-seeks
    // Zenith of the Path to the restored sim time above the sim).
    const p = sim.player.position;
    sim.debugPlaceAt(p.x, -100, p.z);
    sim.update(idleInput);
    expect(sim.status).toBe('dead');
    let hold = 0;
    while (sim.status !== 'running' && hold++ < 200) sim.update(idleInput);
    expect(sim.status).toBe('running');
    expect(sim.activeCheckpointId).toBe('cp-forge');
    expect(Math.abs(sim.player.position.z - 60)).toBeLessThan(6);
  });

  it('replays the M9.5 completion tape VERIFIED', { timeout: 60000 }, () => {
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

  it('rejects cross-level replays in both directions', { timeout: 180000 }, () => {
    // Record a finished tape on each production level.
    const classicSim = new GameSimulation(THE_DESCENT_CLASSIC);
    const classicCoordinator = new ReplayCoordinator(classicSim);
    const classicDriver = new TheDescentClassicDriver('primary');
    recordAttempt(classicSim, classicCoordinator, () =>
      classicDriver.nextInput(classicSim.player.position.z, classicSim),
    );
    const classicTape = classicCoordinator.lastReplay;
    expect(classicTape?.outcome.status).toBe('finished');

    const riftSim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    const riftCoordinator = new ReplayCoordinator(riftSim);
    const riftDriver = new ShowcaseDriver('primary');
    recordAttempt(riftSim, riftCoordinator, () =>
      riftDriver.nextInput(riftSim.player.position.z, riftSim),
    );
    const riftTape = riftCoordinator.lastReplay;
    expect(riftTape?.outcome.status).toBe('finished');

    // A THE DESCENT tape is never playable against GRAVITY RIFT.
    const crossSim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    const crossCoordinator = new ReplayCoordinator(crossSim);
    expect(crossCoordinator.startReplay(classicTape).ok).toBe(false);
    // And a GRAVITY RIFT tape is never accepted for THE DESCENT.
    const crossSim2 = new GameSimulation(THE_DESCENT_CLASSIC);
    const crossCoordinator2 = new ReplayCoordinator(crossSim2);
    expect(crossCoordinator2.startReplay(riftTape).ok).toBe(false);
  });
});
