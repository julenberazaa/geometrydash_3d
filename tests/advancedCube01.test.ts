import { describe, expect, it } from 'vitest';
import fixtureRaw from './fixtures/replays/validation-level-02-v1.json?raw';
import { GameSimulation } from '../src/game/GameSimulation';
import { ADVANCED_CUBE_01 } from '../src/content/levels/advancedCube01';
import { VERTICAL_SLICE_01 } from '../src/content/levels/verticalSlice01';
import { VALIDATION_LEVEL_02 } from '../src/content/levels/validationLevel02';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import {
  getLevel,
  registeredLevelIds,
  resolveLevel,
} from '../src/content/levelRegistry';
import { CUBE_TUNING } from '../src/player/cubeTuning';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { REPLAY_RULESET_VERSION, REPLAY_SCHEMA_VERSION } from '../src/replay/replayFormat';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { cueIdAtZ, prepareRhythmCues } from '../src/visuals/rhythmCues';
import { loadLevel } from '../src/level/levelRuntime';
import { LevelView } from '../src/rendering/LevelView';
import { makeTestLibrary } from './helpers/visuals';
import type { LevelDefinition } from '../src/level/levelDefinition';
import {
  ADVANCED_CUBE_01_SCRIPT,
  AdvancedCube01Driver,
} from './helpers/advancedCube01Script';
import { VerticalSlice01Driver } from './helpers/verticalSlice01Script';
import { recordAttempt, playReplay } from './helpers/replay';

/**
 * M7.3 advanced-Cube suite: production level 02 (harder, vertical,
 * fragmented, teleport debut + polish) on the frozen controller. All driving
 * uses legal physical inputs — no debug placement, no state mutation.
 *
 * Deterministic anchors (measured, pinned): finish tick 7475 = 62.292 s,
 * 0 deaths, 2 teleports (lava hop 489 → 513 + maw 524 → 634), 2 gravity
 * transitions, 2 pads, 2 orbs, 2x climbed and released.
 */

/** Run the verification route headlessly; returns the terminal sim + ticks. */
const runVerificationRoute = (
  actions = ADVANCED_CUBE_01_SCRIPT,
  maxTicks = 40000,
): { sim: GameSimulation; ticks: number; maxSpeed: number; minX: number; maxX: number } => {
  const sim = new GameSimulation(ADVANCED_CUBE_01);
  const driver = new AdvancedCube01Driver(actions);
  let ticks = 0;
  let maxSpeed = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (; ticks < maxTicks; ticks++) {
    if (sim.status !== 'running') break;
    sim.update(driver.nextInput(sim.player.position.z));
    maxSpeed = Math.max(maxSpeed, sim.speedMultiplier);
    minX = Math.min(minX, sim.player.position.x);
    maxX = Math.max(maxX, sim.player.position.x);
  }
  return { sim, ticks, maxSpeed, minX, maxX };
};

/** Grounded-center samples along the verification route (height-band proof). */
const sampleGroundedHeights = (): number[] => {
  const sim = new GameSimulation(ADVANCED_CUBE_01);
  const driver = new AdvancedCube01Driver();
  const heights: number[] = [];
  for (let ticks = 0; ticks < 40000; ticks++) {
    if (sim.status !== 'running') break;
    sim.update(driver.nextInput(sim.player.position.z));
    if (sim.player.grounded && ticks % 6 === 0) heights.push(sim.player.position.y);
  }
  expect(sim.status).toBe('finished');
  return heights;
};

describe('advanced cube 01 registry + identity', () => {
  it('is registered as a distinct fourth level', () => {
    const ids = registeredLevelIds();
    expect(ids).toContain('advanced-cube-01');
    expect(new Set(ids).size).toBe(ids.length);
    expect(getLevel('advanced-cube-01')).toBe(ADVANCED_CUBE_01);
  });

  it('resolves through the ?level= route with its display name', () => {
    const resolved = resolveLevel('advanced-cube-01');
    expect(resolved.ok).toBe(true);
    expect(resolved.level.displayName).toBe('ADVANCED CUBE 01');
  });

  it('is genuinely distinct content (own fingerprint, own length)', () => {
    const fp = computeLevelFingerprint(ADVANCED_CUBE_01);
    expect(fp).not.toBe(computeLevelFingerprint(TEST_LEVEL));
    expect(fp).not.toBe(computeLevelFingerprint(VALIDATION_LEVEL_02));
    expect(fp).not.toBe(computeLevelFingerprint(VERTICAL_SLICE_01));
    expect(ADVANCED_CUBE_01.finishZ).toBe(960);
    expect(ADVANCED_CUBE_01.finishZ).toBeGreaterThan(VERTICAL_SLICE_01.finishZ);
  });

  it('leaves vertical-slice-01 registered and behaviorally intact', () => {
    expect(getLevel('vertical-slice-01')).toBe(VERTICAL_SLICE_01);
    const sim = new GameSimulation(VERTICAL_SLICE_01);
    const driver = new VerticalSlice01Driver();
    let ticks = 0;
    for (; ticks < 30000; ticks++) {
      if (sim.status !== 'running') break;
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.status).toBe('finished');
    expect(ticks).toBe(6190); // M7.1 deterministic anchor, unchanged
  });

  it('keeps the engine free of level-specific branches', () => {
    const modules = import.meta.glob(
      '../src/{game/GameSimulation,player/CubeController,player/cubeTuning,collision/moveAabb,collision/CollisionWorld,collision/collider}.ts',
      { eager: true, query: '?raw', import: 'default' },
    );
    const entries = Object.entries(modules).filter((e): e is [string, string] => typeof e[1] === 'string');
    expect(entries.length).toBe(6);
    for (const [file, source] of entries) {
      expect(source, file).not.toContain('advanced-cube');
      expect(source, file).not.toContain('advancedCube');
      expect(source, file).not.toContain('vertical-slice');
      expect(source, file).not.toContain('verticalSlice');
    }
  });

  it('leaves the frozen Cube controller tuning untouched', () => {
    expect(CUBE_TUNING.jumpImpulse).toBe(13.2);
    expect(CUBE_TUNING.gravityAcceleration).toBe(42);
    expect(CUBE_TUNING.fastFallAcceleration).toBe(55);
    expect(CUBE_TUNING.laneAccel).toBe(110);
    expect(CUBE_TUNING.laneMaxSpeed).toBe(16);
    expect(CUBE_TUNING.laneBrakeDecel).toBe(135);
    expect(CUBE_TUNING.colliderSize).toBe(1.1);
    expect(CUBE_TUNING.laneSpacing).toBe(2.6);
  });
});

describe('advanced cube 01 deterministic completion (real inputs)', () => {
  it('finishes naturally with zero deaths', () => {
    const { sim, ticks } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    expect(sim.player.position.z).toBeGreaterThanOrEqual(ADVANCED_CUBE_01.finishZ);
    expect(sim.attempts).toBe(1);
    expect(sim.lastDeathCause).toBeNull();
    expect(ticks).toBeGreaterThan(0);
  });

  it('completes in 60-75 s with the exact deterministic anchor', () => {
    const { sim, ticks } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    const seconds = sim.elapsedSimTime;
    expect(seconds).toBeGreaterThanOrEqual(60.0);
    expect(seconds).toBeLessThanOrEqual(75.0);
    // Preferred band 62-70 s (a substantial step past the ~51.6 s slice).
    expect(seconds).toBeGreaterThanOrEqual(62.0);
    expect(seconds).toBeLessThanOrEqual(70.0);
    expect(ticks).toBe(7475);
    expect(seconds).toBeCloseTo(7475 / 120, 6);
  });

  it('is deterministic across runs', () => {
    const first = runVerificationRoute();
    const second = runVerificationRoute();
    expect(first.sim.status).toBe('finished');
    expect(second.ticks).toBe(first.ticks);
    expect(second.sim.elapsedSimTime).toBe(first.sim.elapsedSimTime);
    expect(second.sim.player.position.x).toBe(first.sim.player.position.x);
    expect(second.sim.player.position.z).toBe(first.sim.player.position.z);
  });

  it('uses all three lane positions meaningfully', () => {
    const { sim, minX, maxX } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    expect(minX).toBeLessThan(-2); // right island / right weave answers
    expect(maxX).toBeGreaterThan(2); // left islands / left weave answers
  });

  it('exercises portals, pads, orbs, teleport and the speed route', () => {
    const { sim, maxSpeed } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    expect(sim.portalTransitionCount).toBe(2); // portal up + gravity orb
    expect(sim.lastPortalId).toBe('ac-portal-up-1');
    expect(sim.padActivationCount).toBe(2); // ceiling pad + MID floor pad
    expect(sim.orbActivationCount).toBe(2); // jump orb + gravity orb
    for (const id of ['ac-pad-ceiling', 'ac-pad-floor', 'ac-orb-jump', 'ac-orb-gravity']) {
      expect(sim.isInteractionUsed(id)).toBe(true);
    }
    expect(sim.teleportEventCount).toBe(2);
    expect(sim.lastTeleportId).toBe('ac-teleport-maw');
    expect(sim.isTeleportUsed('ac-teleport-maw')).toBe(true);
    expect(sim.isTeleportUsed('ac-teleport-hop')).toBe(true);
    expect(sim.speedPortalCount).toBe(2); // 2x climb + 1x release
    expect(sim.lastSpeedPortalId).toBe('ac-speed-1x');
    expect(maxSpeed).toBe(2);
    expect(sim.speedMultiplier).toBe(1);
  });

  it('never uses debug placement on the verification route', () => {
    const sim = new GameSimulation(ADVANCED_CUBE_01);
    let placements = 0;
    const original = sim.debugPlaceAt.bind(sim);
    sim.debugPlaceAt = (...args: [number, number, number]): void => {
      placements += 1;
      original(...args);
    };
    const driver = new AdvancedCube01Driver();
    for (let ticks = 0; ticks < 40000; ticks++) {
      if (sim.status !== 'running') break;
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.status).toBe('finished');
    expect(placements).toBe(0);
  });

  it('requires an airborne lateral transfer (route minus the tap dies)', () => {
    const withoutTransfer = ADVANCED_CUBE_01_SCRIPT.filter((a) => a.atZ !== 30.5);
    const sim = new GameSimulation(ADVANCED_CUBE_01);
    const driver = new AdvancedCube01Driver(withoutTransfer);
    for (let ticks = 0; ticks < 40000 && sim.attempts <= 1; ticks++) {
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.attempts).toBeGreaterThan(1);
    // M8A: the missed-transfer fall lands in the contained chain-basin
    // lava (previously the void bound) — lava IS the gap punishment now.
    expect(sim.lastDeathCause).toBe('lava');
    expect(sim.deathPosition.z).toBeLessThan(60);
  });

  it('constrains valid solutions: a lane-lazy route dies in the island chain', () => {
    const jumpsOnly = ADVANCED_CUBE_01_SCRIPT.filter(
      (a) => a.kind === 'jumpPress' || a.kind === 'fastFall',
    );
    const sim = new GameSimulation(ADVANCED_CUBE_01);
    const driver = new AdvancedCube01Driver(jumpsOnly);
    for (let ticks = 0; ticks < 40000 && sim.attempts <= 1; ticks++) {
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.deathPosition.z).toBeLessThan(150);
  });
});

describe('advanced cube 01 vertical geometry (real height bands)', () => {
  it('authors LOW, MID, HIGH and ceiling bands as gameplay surfaces', () => {
    const tops = ADVANCED_CUBE_01.solids.map((s) => s.center.y + s.halfExtents.y);
    const hasLow = tops.some((t) => Math.abs(t - 0) < 0.01);
    const hasMid = tops.some((t) => Math.abs(t - 1.2) < 0.01);
    const hasHigh = tops.some((t) => Math.abs(t - 2.4) < 0.01);
    const ceilings = ADVANCED_CUBE_01.solids.filter(
      (s) => s.center.y - s.halfExtents.y >= 6 && s.center.y > 1,
    );
    expect(hasLow).toBe(true);
    expect(hasMid).toBe(true);
    expect(hasHigh).toBe(true);
    expect(ceilings.length).toBeGreaterThanOrEqual(3);
  });

  it('the route genuinely runs at several heights (grounded samples)', () => {
    const heights = sampleGroundedHeights();
    const near = (target: number): boolean =>
      heights.some((h) => Math.abs(h - target) < 0.1);
    expect(near(0.55)).toBe(true); // LOW run height
    expect(near(1.75)).toBe(true); // MID run height
    expect(near(2.95)).toBe(true); // HIGH run height
    expect(near(5.45)).toBe(true); // ceiling run height
  });

  it('runs a substantial ceiling section (slab length + mode time)', () => {
    const ceilings = ADVANCED_CUBE_01.solids.filter(
      (s) => s.center.y - s.halfExtents.y >= 6 && s.center.y > 1,
    );
    const totalLength = ceilings.reduce((sum, s) => sum + s.halfExtents.z * 2, 0);
    expect(totalLength).toBeGreaterThanOrEqual(80);
    // Behaviorally: the verification route spends real seconds on the ceiling.
    const sim = new GameSimulation(ADVANCED_CUBE_01);
    const driver = new AdvancedCube01Driver();
    let ceilingTicks = 0;
    for (let ticks = 0; ticks < 40000; ticks++) {
      if (sim.status !== 'running') break;
      sim.update(driver.nextInput(sim.player.position.z));
      if (sim.gravityMode === 'ceiling') ceilingTicks += 1;
    }
    expect(sim.status).toBe('finished');
    expect(ceilingTicks / 120).toBeGreaterThanOrEqual(8);
  });

  it('builds the route mostly from narrow/partial-width platforms', () => {
    const narrow = ADVANCED_CUBE_01.solids.filter((s) => s.halfExtents.x <= 2.7);
    expect(narrow.length).toBeGreaterThanOrEqual(15);
    // At least one critical landing is substantially narrower than the
    // full-width recovery slabs (recovery tools exist AND are the minority).
    // Overhead air-gate bars/pylons (y >= 3.5) are not route surface, and
    // M8A lava-basin architecture (tops below y -1) is containment, not
    // route: only slabs the cube can stand on count as full-width route.
    const routeSlabs = ADVANCED_CUBE_01.solids.filter(
      (s) => s.center.y < 3 && s.center.y + s.halfExtents.y >= -1,
    );
    const full = routeSlabs.filter((s) => s.halfExtents.x > 2.7);
    expect(full.length).toBeGreaterThanOrEqual(1);
    expect(full.length).toBeLessThanOrEqual(4);
    const islands = ADVANCED_CUBE_01.solids.filter((s) => s.halfExtents.x <= 1.4);
    expect(islands.length).toBeGreaterThanOrEqual(12);
  });

  it('keeps documented lateral margin on every single-lane island', () => {
    for (const s of ADVANCED_CUBE_01.solids) {
      // M8A basin rims are narrow containment walls below the route, not
      // landable islands (tops below y -1) — excluded like overhead bars.
      if (s.halfExtents.x <= 1.4 && s.center.y < 3 && s.center.y + s.halfExtents.y >= -1) {
        const marginPerSide = (s.halfExtents.x * 2 - CUBE_TUNING.colliderSize) / 2;
        expect(marginPerSide).toBeGreaterThanOrEqual(0.5);
      }
    }
  });
});

describe('advanced cube 01 hazard design (denser but fair)', () => {
  it('carries more meaningful hazards than M7.1, relatively and absolutely', () => {
    // M7.3: 29 hazards (25 spikes incl. 3 tall + triple ceiling, 4 maze
    // walls) vs M7.1's 12 — density up without spam (every hazard shapes
    // the route: weaves, island jumps, rows, walls).
    expect(ADVANCED_CUBE_01.hazards.length).toBeGreaterThanOrEqual(24);
    const walls = ADVANCED_CUBE_01.hazards.filter((h) => h.kind === 'killFront');
    expect(walls.length).toBeGreaterThanOrEqual(4);
    const density = (level: LevelDefinition): number =>
      (level.hazards.length / (level.finishZ - level.start.z)) * 100;
    expect(density(ADVANCED_CUBE_01)).toBeGreaterThan(density(VERTICAL_SLICE_01));
  });

  it('marks floor spikes floor and ceiling spikes ceiling (no regression)', () => {
    const ceilingSpikes = ADVANCED_CUBE_01.hazards.filter((h) => h.center.y > 3);
    expect(ceilingSpikes.length).toBeGreaterThanOrEqual(1);
    for (const hz of ceilingSpikes) expect(hz.mount).toBe('ceiling');
    const floorSpikes = ADVANCED_CUBE_01.hazards.filter((h) => h.center.y < 3);
    expect(floorSpikes.length).toBeGreaterThanOrEqual(10);
    for (const hz of floorSpikes) expect(hz.mount ?? 'floor').toBe('floor');
  });

  it('keeps spike gameplay boxes fair (smaller than the visual read)', () => {
    // M7.3 tall spikes (halfY 0.35) stay far inside the frozen jump apex
    // (2.07) — taller read, same fair jump.
    for (const hz of ADVANCED_CUBE_01.hazards) {
      if (hz.kind === 'killFront') continue; // walls kill frontally, never by overlap
      expect(hz.halfExtents.x).toBeLessThanOrEqual(0.5);
      expect(hz.halfExtents.y).toBeLessThanOrEqual(0.4);
      expect(hz.halfExtents.z).toBeLessThanOrEqual(0.5);
    }
    const tall = ADVANCED_CUBE_01.hazards.filter(
      (h) => h.kind === 'hazard' && h.halfExtents.y > 0.25,
    );
    expect(tall.length).toBeGreaterThanOrEqual(3);
    // The verification route clears every tall spike (behavioral proof the
    // taller read never becomes an unfair box).
    const { sim } = runVerificationRoute();
    expect(sim.status).toBe('finished');
  });

  it('makes both pad gaps uncrossable without the pad', () => {
    const range = 12 * ((2 * CUBE_TUNING.jumpImpulse) / CUBE_TUNING.gravityAcceleration);
    expect(range).toBeGreaterThan(7.4);
    for (const [start, end] of [[392, 400], [441, 449]] as const) {
      expect(end - start).toBeGreaterThan(range);
    }
  });

  it('proves the jump orb is required on the authored route', () => {
    const withoutOrb = ADVANCED_CUBE_01_SCRIPT.filter((a) => a.atZ !== 678.3);
    const sim = new GameSimulation(ADVANCED_CUBE_01);
    const driver = new AdvancedCube01Driver(withoutOrb);
    for (let ticks = 0; ticks < 40000 && sim.attempts <= 1; ticks++) {
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('void');
    expect(sim.deathPosition.z).toBeGreaterThanOrEqual(672);
    expect(sim.deathPosition.z).toBeLessThanOrEqual(696);
  });
});

describe('advanced cube 01 fast-fall gate', () => {
  it('the scripted fast-fall route lands mid-island with room to jump', () => {
    // Fast-fall hold (22 ticks from z 244.5) lands on the 247..253 island;
    // assert the first grounded sample past z 246 sits on the island.
    const sim = new GameSimulation(ADVANCED_CUBE_01);
    const driver = new AdvancedCube01Driver();
    let landingZ = -1;
    for (let ticks = 0; ticks < 40000; ticks++) {
      if (sim.status !== 'running') break;
      sim.update(driver.nextInput(sim.player.position.z));
      if (sim.player.grounded && sim.player.position.z > 246 && landingZ < 0) {
        landingZ = sim.player.position.z;
      }
      if (landingZ > 0) break;
    }
    expect(landingZ).toBeGreaterThanOrEqual(247);
    expect(landingZ).toBeLessThanOrEqual(251.5);
  });

  it('proves fast-fall is the authored solution (same taps, no hold, dies)', () => {
    const withoutFF = ADVANCED_CUBE_01_SCRIPT.filter((a) => a.kind !== 'fastFall');
    const sim = new GameSimulation(ADVANCED_CUBE_01);
    const driver = new AdvancedCube01Driver(withoutFF);
    for (let ticks = 0; ticks < 40000 && sim.attempts <= 1; ticks++) {
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.attempts).toBeGreaterThan(1);
    // Lands at the island edge and cannot make the follow-up gap: dies at
    // the 253..257 gap face or in it (frontImpact into S14 or void past it).
    expect(sim.deathPosition.z).toBeGreaterThanOrEqual(250);
    expect(sim.deathPosition.z).toBeLessThan(270);
  });

  it('telegraphs the gate with a visible lintel that never collides', () => {
    // The gate pylons/lintel sit beside/above the drop line (x = 0): the
    // verification route passes under them without contact (it finishes).
    const lintel = ADVANCED_CUBE_01.solids.filter((s) => Math.abs(s.center.z - 248) < 7 && s.center.y > 1.5);
    expect(lintel.length).toBeGreaterThanOrEqual(3);
    for (const s of lintel) {
      const clearX = Math.abs(s.center.x) - s.halfExtents.x > 3.9 || s.center.y - s.halfExtents.y > 5.6;
      expect(clearX, `lintel at x=${s.center.x} y=${s.center.y}`).toBe(true);
    }
    const { sim } = runVerificationRoute();
    expect(sim.status).toBe('finished');
  });
});

describe('advanced cube 01 teleport integration', () => {
  /** Step manually until the nth teleport fires; returns the firing sim. */
  const runToTeleportN = (n: number): GameSimulation => {
    const sim = new GameSimulation(ADVANCED_CUBE_01);
    const driver = new AdvancedCube01Driver();
    for (let ticks = 0; ticks < 40000; ticks++) {
      if (sim.teleportEventCount >= n || sim.status !== 'running') break;
      sim.update(driver.nextInput(sim.player.position.z));
    }
    return sim;
  };

  it('hop teleport fires first: mid-air ring 489 to grounded exit 513', () => {
    const sim = runToTeleportN(1);
    expect(sim.status).toBe('running');
    expect(sim.teleportEventCount).toBe(1);
    expect(sim.lastTeleportId).toBe('ac-teleport-hop');
    expect(sim.player.position.x).toBe(0);
    expect(sim.player.position.y).toBe(0.7);
    expect(sim.player.position.z).toBe(513);
    expect(sim.player.velocity.y).toBe(0);
    expect(sim.player.targetLaneIndex).toBe(1);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.speedMultiplier).toBe(1);
  });

  it('maw teleport fires second at the authored entry to the authored exit', () => {
    const sim = runToTeleportN(2);
    expect(sim.status).toBe('running');
    expect(sim.teleportEventCount).toBe(2);
    expect(sim.lastTeleportId).toBe('ac-teleport-maw');
    expect(sim.player.position.x).toBe(0);
    expect(sim.player.position.y).toBe(1.75);
    expect(sim.player.position.z).toBe(634);
  });

  it('the verification route takes both portals exactly once each', () => {
    const { sim } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    expect(sim.teleportEventCount).toBe(2);
    expect(sim.isTeleportUsed('ac-teleport-hop')).toBe(true);
    expect(sim.isTeleportUsed('ac-teleport-maw')).toBe(true);
  });

  it('the hop entry and exit share one readable frame (no map cut)', () => {
    const hop = (ADVANCED_CUBE_01.teleportPortals ?? []).find((t) => t.id === 'ac-teleport-hop');
    expect(hop).toBeDefined();
    if (hop === undefined) return;
    // Both rings fit inside one camera frame: exit-entry distance stays
    // far below the fog/readability range, so entry and exit are
    // co-present in the visible world.
    expect(hop.exit.z - hop.entryZ).toBeLessThanOrEqual(30);
    expect(hop.exitLaneIndex).toBe(1);
  });

  it('pins maw exit velocity/lane/support semantics on the production level', () => {
    const sim = runToTeleportN(2);
    expect(sim.player.velocity.y).toBe(0);
    expect(sim.currentForwardSpeed).toBe(12);
    expect(sim.player.targetLaneIndex).toBe(1);
    expect(sim.player.grounded).toBe(false);
    expect(sim.player.supportColliderId).toBeNull();
    expect(sim.gravityMode).toBe('floor');
    expect(sim.speedMultiplier).toBe(1);
  });

  it('skips nothing playable: no portals live inside either jumped interval', () => {
    const inHop = (z: number): boolean => z > 489 && z < 513;
    const inMaw = (z: number): boolean => z > 524 && z < 634;
    for (const p of ADVANCED_CUBE_01.gravityPortals ?? []) {
      expect(inHop(p.z)).toBe(false);
      expect(inMaw(p.z)).toBe(false);
    }
    for (const p of ADVANCED_CUBE_01.speedPortals ?? []) {
      expect(inHop(p.z)).toBe(false);
      expect(inMaw(p.z)).toBe(false);
    }
    const sim = runToTeleportN(2);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.speedMultiplier).toBe(1);
  });

  it('both entries are fair: no hazard crowds either gate', () => {
    for (const hz of ADVANCED_CUBE_01.hazards) {
      expect(Math.abs(hz.center.z - 489) < 3, `hazard at z=${hz.center.z}`).toBe(false);
      expect(Math.abs(hz.center.z - 524) < 3, `hazard at z=${hz.center.z}`).toBe(false);
    }
  });

  it('the maw exit is safe and deterministic across runs', () => {
    const first = runToTeleportN(2);
    const second = runToTeleportN(2);
    expect(second.player.position.x).toBe(first.player.position.x);
    expect(second.player.position.y).toBe(first.player.position.y);
    expect(second.player.position.z).toBe(first.player.position.z);
    // Exit volume overlaps support (grounded within a few steps) and no
    // hazard: the run continues without an avoidance input.
    const sim = first;
    for (let i = 0; i < 30 && sim.status === 'running'; i++) sim.update(new AdvancedCube01Driver().nextInput(sim.player.position.z));
    expect(sim.status).toBe('running');
  });

  it('teleport gameplay data changes the fingerprint; style does not', () => {
    const base = computeLevelFingerprint(ADVANCED_CUBE_01);
    const noTeleport: LevelDefinition = { ...ADVANCED_CUBE_01, teleportPortals: [] };
    expect(computeLevelFingerprint(noTeleport)).not.toBe(base);
    const restyled: LevelDefinition = {
      ...ADVANCED_CUBE_01,
      teleportPortals: (ADVANCED_CUBE_01.teleportPortals ?? []).map((t) => ({ ...t, style: 'gate' as const })),
    };
    expect(computeLevelFingerprint(restyled)).toBe(base);
  });

  it('setpieces and rhythm cues stay fingerprint-excluded', () => {
    const base = computeLevelFingerprint(ADVANCED_CUBE_01);
    const stripped: LevelDefinition = {
      ...ADVANCED_CUBE_01,
      visualSetpieces: undefined,
      rhythmCues: undefined,
      visualSequence: undefined,
      theme: { ...ADVANCED_CUBE_01.theme },
      hazards: ADVANCED_CUBE_01.hazards.map(({ visual: _v, mount: _m, ...rest }) => rest),
    };
    expect(computeLevelFingerprint(stripped)).toBe(base);
  });

  it('restart re-arms both teleports for a fresh attempt', () => {
    const { sim } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    const attempts = sim.attempts;
    sim.restart();
    expect(sim.attempts).toBe(attempts + 1);
    expect(sim.isTeleportUsed('ac-teleport-maw')).toBe(false);
    expect(sim.isTeleportUsed('ac-teleport-hop')).toBe(false);
    expect(sim.lastTeleportId).toBeNull();
    expect(sim.player.position.z).toBe(ADVANCED_CUBE_01.start.z);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.speedMultiplier).toBe(1);
    expect(sim.isInteractionUsed('ac-pad-floor')).toBe(false);
  });
});

describe('advanced cube 01 teleport + setpiece presentation structure', () => {
  it('builds paired teleport rings, guardians, lava and chains from level data', () => {
    const library = makeTestLibrary();
    const full = new LevelView(loadLevel(ADVANCED_CUBE_01), library);
    const fullCount = full.group.children.length;
    const stripped: LevelDefinition = {
      ...ADVANCED_CUBE_01,
      teleportPortals: [],
      visualSetpieces: [],
    };
    const bare = new LevelView(loadLevel(stripped), library);
    const bareCount = bare.group.children.length;
    // M8A presentation meshes: maw entry (ring + rim + pane + 8 teeth =
    // 11) + hop entry (3) + two exit rings (3 + 3) + maw guardian (body +
    // jaw + 6 teeth + 2 eyes + 4 chain links = 14) + storm beast (body +
    // jaw + 6 teeth + 2 eyes + 3 links = 13): exactly 47. (The stripped
    // baseline keeps the lethal lava volumes, so both sides carry the
    // same lava meshes — the delta is portals + guardians only.)
    expect(fullCount - bareCount).toBe(47);
    expect(fullCount).toBeGreaterThan(bareCount);
    full.dispose();
    bare.dispose();
    library.dispose();
  });

  it('shares teleport/setpiece materials and geometries (no new pools)', () => {
    const library = makeTestLibrary();
    const before = library.materialCount;
    const view = new LevelView(loadLevel(ADVANCED_CUBE_01), library);
    // Views create Meshes only: building gates + guardian adds nothing.
    expect(library.materialCount).toBe(before);
    expect(library.geometryCount).toBe(8);
    view.dispose();
    library.dispose();
  });
});

describe('advanced cube 01 maze walls (M7.3 frontal-kill routing)', () => {
  it('authors frontal-kill walls on the route (jump wall + lane walls)', () => {
    const walls = ADVANCED_CUBE_01.hazards.filter((h) => h.kind === 'killFront');
    expect(walls.length).toBeGreaterThanOrEqual(4);
    // Lane walls stand ~2 u tall and span exactly one lane (commitment,
    // never a full block); the garden jump-wall spans the full platform
    // (unrideable — the route must clear it vertically).
    for (const w of walls) {
      if (w.halfExtents.x > 1.4) {
        expect(w.halfExtents.y * 2).toBeGreaterThanOrEqual(0.9);
      } else {
        expect(w.halfExtents.y * 2).toBeGreaterThanOrEqual(1.9);
        expect(w.halfExtents.x * 2).toBeLessThanOrEqual(2.7);
      }
    }
    // Every wall sits on a real platform (its base near a run surface).
    const tops = ADVANCED_CUBE_01.solids.map((s) => s.center.y + s.halfExtents.y);
    for (const w of walls) {
      const base = w.center.y - w.halfExtents.y;
      expect(tops.some((t) => Math.abs(base - t) < 0.05)).toBe(true);
    }
  });

  it('running the garden wall line dies frontally (the wall must be jumped)', () => {
    // Verification route minus the wall jump: the cube runs straight into
    // the full-width killFront face and dies frontImpact there.
    const noJump = ADVANCED_CUBE_01_SCRIPT.filter((a) => a.atZ !== 191.5);
    const sim = new GameSimulation(ADVANCED_CUBE_01);
    const driver = new AdvancedCube01Driver(noJump);
    for (let ticks = 0; ticks < 40000 && sim.attempts <= 1; ticks++) {
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.deathPosition.z).toBeGreaterThanOrEqual(192);
    expect(sim.deathPosition.z).toBeLessThanOrEqual(200);
  });
});

describe('advanced cube 01 lethal lava basins (M8A gameplay)', () => {
  it('places real lethal lava below/beside the route (never on it)', () => {
    const lavas = ADVANCED_CUBE_01.lava ?? [];
    expect(lavas.length).toBeGreaterThanOrEqual(6);
    expect(lavas.some((l) => l.role === 'source')).toBe(true);
    expect(lavas.some((l) => l.role === 'fall')).toBe(true);
    expect(lavas.filter((l) => l.role === 'pool').length).toBeGreaterThanOrEqual(5);
    // Pools sit below the route surface (tops at y <= -1.5); source/fall
    // volumes live outside the lane corridor (|x| footprint beyond 4) —
    // gap falls die at the lava, never on the success path.
    for (const lava of lavas) {
      if (lava.role === 'pool') {
        expect(lava.center.y + lava.halfExtents.y).toBeLessThanOrEqual(-1.5);
      } else {
        const innerEdge = Math.abs(lava.center.x) - lava.halfExtents.x;
        expect(innerEdge).toBeGreaterThanOrEqual(4);
      }
    }
    const { sim } = runVerificationRoute();
    expect(sim.status).toBe('finished');
  });

  it('both guardians live outside the landable corridor', () => {
    const beasts = (ADVANCED_CUBE_01.visualSetpieces ?? []).filter((s) => s.kind === 'guardian');
    expect(beasts.length).toBe(2);
    for (const beast of beasts) {
      const innerEdge = Math.abs(beast.center.x) - beast.halfExtents.x;
      const beyondRunway = beast.center.z - beast.halfExtents.z > 527;
      // Outside the corridor horizontally OR past the traversed runway.
      expect(innerEdge >= 4.5 || beyondRunway).toBe(true);
    }
  });
});

describe('advanced cube 01 air-gates (M7.3 blocks in the air)', () => {
  it('the decorative arches clear every jump arc (never collide)', () => {
    const bars = ADVANCED_CUBE_01.solids.filter(
      (s) => s.center.y > 3.5 && Math.abs(s.center.x) < 0.1 && s.halfExtents.x > 3,
    );
    expect(bars.length).toBe(3); // FF lintel + two M7.3 air-gate bars
    for (const bar of bars) {
      // Bar bottoms clear the highest legal jump apex from below (HIGH top
      // 2.4 + apex 2.07 + half-cube 0.55 = 5.02) with margin.
      expect(bar.center.y - bar.halfExtents.y).toBeGreaterThan(5.4);
    }
    const { sim } = runVerificationRoute();
    expect(sim.status).toBe('finished');
  });
});

describe('advanced cube 01 visual + beat metadata contracts', () => {
  it('authors eight distinct visual scenes with a real teleport void', () => {
    const sections = ADVANCED_CUBE_01.visualSequence?.sections ?? [];
    expect(sections.map((s) => s.id)).toEqual([
      'ac-ember',
      'ac-ascent',
      'ac-garden',
      'ac-abyss',
      'ac-return',
      'ac-maw',
      'ac-furnace',
      'ac-storm',
      'ac-calm',
    ]);
    // Post-teleport world reads differently from the teleport void.
    const maw = sections.find((s) => s.id === 'ac-maw')?.overrides;
    const furnace = sections.find((s) => s.id === 'ac-furnace')?.overrides;
    expect(maw).toBeDefined();
    expect(furnace).toBeDefined();
    expect(maw?.background).not.toBe(furnace?.background);
    expect(maw?.fogColor).not.toBe(furnace?.fogColor);
    expect(maw?.routeAccent).not.toBe(furnace?.routeAccent);
    const storm = sections.find((s) => s.id === 'ac-storm')?.overrides;
    expect(storm?.bloomStrength).toBeGreaterThan(0.5);
    expect(storm?.streakIntensity).toBeGreaterThanOrEqual(1.5);
  });

  it('binds rhythm cues to deterministic forward positions incl. teleport', () => {
    const cues = prepareRhythmCues(ADVANCED_CUBE_01);
    expect(cues.length).toBeGreaterThanOrEqual(20);
    expect(cueIdAtZ(cues, -20)).toBeNull();
    expect(cueIdAtZ(cues, -10)).toBe('ac-cue-intro');
    expect(cueIdAtZ(cues, 322)).toBe('ac-cue-gravity-hit');
    expect(cueIdAtZ(cues, 489)).toBe('ac-cue-hop-in');
    expect(cueIdAtZ(cues, 513)).toBe('ac-cue-hop-out');
    expect(cueIdAtZ(cues, 524)).toBe('ac-cue-teleport-in');
    expect(cueIdAtZ(cues, 634)).toBe('ac-cue-teleport-out');
    expect(cueIdAtZ(cues, 708)).toBe('ac-cue-speed');
    expect(cueIdAtZ(cues, 873)).toBe('ac-cue-release');
    expect(cueIdAtZ(cues, 960)).toBe('ac-cue-finish');
    expect(cueIdAtZ(cues, 678)).toBe(cueIdAtZ(prepareRhythmCues(ADVANCED_CUBE_01), 678));
  });

  it('pins the replay container versions (ReplayV1 unchanged)', () => {
    expect(REPLAY_SCHEMA_VERSION).toBe(1);
    expect(REPLAY_RULESET_VERSION).toBe(1);
  });
});

describe('advanced cube 01 replay + reset + golden compatibility', () => {
  it('records a verified replay of the successful route', () => {
    const sim = new GameSimulation(ADVANCED_CUBE_01);
    const coordinator = new ReplayCoordinator(sim);
    const driver = new AdvancedCube01Driver();
    const ticksUsed = recordAttempt(sim, coordinator, () => driver.nextInput(sim.player.position.z));
    expect(ticksUsed).toBeGreaterThan(0);
    const replay = coordinator.lastReplay;
    expect(replay).not.toBeNull();
    expect(replay?.outcome.status).toBe('finished');
    expect(replay?.levelId).toBe('advanced-cube-01');
    expect(replay?.frameCount).toBe(7475);
    // No presentation or teleport-definition state leaks into the tape.
    const serialized = JSON.stringify(replay);
    for (const key of ['visual', 'section', 'punch', 'rhythm', 'cue', 'bloom', 'fog', 'exposure', 'trigger', 'entryZ', 'setpiece']) {
      expect(serialized).not.toContain(`"${key}`);
    }
    const verification = playReplay(sim, coordinator, replay);
    expect(verification.kind).toBe('pass');
    expect(sim.status).toBe('finished');
  });

  it('the M5 golden fixture still binds to unchanged validation content', () => {
    // The committed golden tape stores the validation level fingerprint: if
    // the conditional teleport extension had altered old fingerprints, this
    // binding would break (replayGolden would reject it).
    const parsed = JSON.parse(fixtureRaw) as {
      replay: { levelFingerprint: string; frameCount: number };
    };
    expect(computeLevelFingerprint(VALIDATION_LEVEL_02)).toBe(parsed.replay.levelFingerprint);
    expect(parsed.replay.frameCount).toBe(2346);
  });

  it('restores the production level correctly on restart (bounded lifecycle)', () => {
    const { sim } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    const before = sim.attempts;
    sim.restart();
    sim.restart();
    expect(sim.attempts).toBe(before + 2);
    expect(sim.status).toBe('running');
    expect(sim.player.position.z).toBe(ADVANCED_CUBE_01.start.z);
    expect(sim.player.targetLaneIndex).toBe(ADVANCED_CUBE_01.startLaneIndex);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.speedMultiplier).toBe(1);
    expect(sim.lastPortalId).toBeNull();
    expect(sim.lastSpeedPortalId).toBeNull();
    expect(sim.lastTeleportId).toBeNull();
    expect(sim.isInteractionUsed('ac-orb-jump')).toBe(false);
    expect(sim.isTeleportUsed('ac-teleport-maw')).toBe(false);
    expect(sim.isTeleportUsed('ac-teleport-hop')).toBe(false);
  });
});
