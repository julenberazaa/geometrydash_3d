import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { VALIDATION_LEVEL_02 } from '../src/content/levels/validationLevel02';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import {
  DEFAULT_LEVEL_ID,
  getLevel,
  registeredLevelIds,
  resolveLevel,
} from '../src/content/levelRegistry';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { Level02Driver } from './helpers/level02Script';
import { recordAttempt, playReplay } from './helpers/replay';

/**
 * M5 second-level suite: the level registry contract, Level 02 as a distinct
 * data-driven LevelDefinition, and the deterministic scripted playthrough of
 * Level 02 through the REAL simulation (no debug teleport), which also
 * produces a verified replay.
 */

describe('level registry', () => {
  it('registers both levels with unique ids', () => {
    const ids = registeredLevelIds();
    expect(ids).toContain(TEST_LEVEL.id);
    expect(ids).toContain(VALIDATION_LEVEL_02.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves Test Level 01 by id and as the default', () => {
    expect(getLevel(TEST_LEVEL.id)).toBe(TEST_LEVEL);
    const def = resolveLevel(null);
    expect(def.ok).toBe(true);
    expect(def.level.id).toBe(TEST_LEVEL.id);
    expect(DEFAULT_LEVEL_ID).toBe(TEST_LEVEL.id);
  });

  it('resolves Validation Level 02 by id', () => {
    const def = resolveLevel(VALIDATION_LEVEL_02.id);
    expect(def.ok).toBe(true);
    expect(def.level).toBe(VALIDATION_LEVEL_02);
  });

  it('rejects unknown ids with an explicit logged fallback', () => {
    const def = resolveLevel('no-such-level');
    expect(def.ok).toBe(false);
    expect(def.level.id).toBe(TEST_LEVEL.id);
    expect(def.reason).toContain('no-such-level');
    expect(def.reason).toContain(DEFAULT_LEVEL_ID);
  });
});

describe('validation level 02 (distinct data-driven content)', () => {
  it('loads independently as a simulation with its own identity', () => {
    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    expect(sim.level.def.id).toBe('validation-02');
    expect(sim.level.def.displayName).toBe('VALIDATION LEVEL 02');
    expect(sim.player.targetLaneIndex).toBe(0);
    expect(sim.currentForwardSpeed).toBe(11);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.level.jumpPads.length).toBe(1);
    expect(sim.level.gravityOrbs.length).toBe(1);
    expect(sim.level.gravityPortals.length).toBe(1);
    expect(sim.level.speedPortals.length).toBe(1);
  });

  it('has a different gameplay fingerprint than Test Level 01', () => {
    expect(computeLevelFingerprint(VALIDATION_LEVEL_02)).not.toBe(computeLevelFingerprint(TEST_LEVEL));
  });
});

describe('validation level 02 deterministic playthrough (real inputs, no teleport)', () => {
  it('finishes and exercises lane decisions, gap jumps, portal, ceiling pad, gravity orb and speed portal', () => {
    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const driver = new Level02Driver();
    let portalFlipsWhenFinished = -1;
    let padCount = -1;
    let orbCount = -1;
    let speedTier = -1;
    let lastInteraction = '';
    let ticks = 0;

    for (; ticks < 60000; ticks++) {
      if (sim.status !== 'running') break;
      sim.update(driver.nextInput(sim.player.position.z));
    }

    expect(sim.status).toBe('finished');
    expect(sim.player.position.z).toBeGreaterThanOrEqual(VALIDATION_LEVEL_02.finishZ);
    portalFlipsWhenFinished = sim.portalTransitionCount;
    padCount = sim.padActivationCount;
    orbCount = sim.orbActivationCount;
    speedTier = sim.speedMultiplier;
    lastInteraction = sim.lastInteractionId ?? '';
    void portalFlipsWhenFinished; // read once at finish, asserted below

    // Mechanics actually exercised (not just visually present in data):
    expect(portalFlipsWhenFinished).toBeGreaterThanOrEqual(1); // gravity portal up
    expect(padCount).toBe(1); // ceiling jump pad fired
    expect(orbCount).toBe(1); // gravity orb activated
    expect(speedTier).toBe(2); // 2x speed portal crossed
    expect(lastInteraction).toBe('v2-speed-2x');
    // The ceiling section was really run upside down at some point.
    expect(sim.portalTransitionCount).toBeGreaterThanOrEqual(1);
  });

  it('produces a verified record -> replay of the same playthrough', () => {
    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    const driver = new Level02Driver();
    const ticksUsed = recordAttempt(sim, coordinator, () => {
      const input = driver.nextInput(sim.player.position.z);
      return input;
    });
    expect(ticksUsed).toBeGreaterThan(0);
    const replay = coordinator.lastReplay;
    expect(replay).not.toBeNull();
    expect(replay?.outcome.status).toBe('finished');
    expect(replay?.frameCount).toBeGreaterThan(0);
    expect(replay?.levelId).toBe('validation-02');
    expect(replay?.levelFingerprint).toBe(coordinator.levelFingerprint);

    const verification = playReplay(sim, coordinator, replay);
    expect(verification.kind).toBe('pass');
    expect(sim.status).toBe('finished');
  });
});
