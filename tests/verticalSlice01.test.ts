import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { VALIDATION_LEVEL_02 } from '../src/content/levels/validationLevel02';
import { VERTICAL_SLICE_01 } from '../src/content/levels/verticalSlice01';
import {
  getLevel,
  registeredLevelIds,
  resolveLevel,
} from '../src/content/levelRegistry';
import { CUBE_TUNING } from '../src/player/cubeTuning';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import type { LevelDefinition } from '../src/level/levelDefinition';
import {
  VERTICAL_SLICE_01_SCRIPT,
  VerticalSlice01Driver,
} from './helpers/verticalSlice01Script';
import { recordAttempt, playReplay } from './helpers/replay';

/**
 * M7 vertical-slice suite: registry identity, the deterministic real-input
 * completion route (~51.6 s), mechanic coverage, fairness margins, replay
 * verification, and production-level invariants. All driving uses legal
 * physical inputs — no debug teleport, no state mutation.
 */

/** Run the verification route headlessly; returns the terminal sim + ticks. */
const runVerificationRoute = (
  actions = VERTICAL_SLICE_01_SCRIPT,
  maxTicks = 30000,
): { sim: GameSimulation; ticks: number; maxSpeed: number; minX: number; maxX: number } => {
  const sim = new GameSimulation(VERTICAL_SLICE_01);
  const driver = new VerticalSlice01Driver(actions);
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

/** Plain-jump forward range at a forward speed (airtime = 2*impulse/g). */
const jumpRange = (forwardSpeed: number, impulse = CUBE_TUNING.jumpImpulse): number =>
  forwardSpeed * ((2 * impulse) / CUBE_TUNING.gravityAcceleration);

describe('vertical slice 01 registry + identity', () => {
  it('is registered as a distinct third level', () => {
    const ids = registeredLevelIds();
    expect(ids).toContain('vertical-slice-01');
    expect(new Set(ids).size).toBe(ids.length);
    expect(getLevel('vertical-slice-01')).toBe(VERTICAL_SLICE_01);
  });

  it('resolves through the ?level= route with its display name', () => {
    const resolved = resolveLevel('vertical-slice-01');
    expect(resolved.ok).toBe(true);
    expect(resolved.level.displayName).toBe('VERTICAL SLICE 01');
  });

  it('has a different gameplay fingerprint than both validation levels', () => {
    const fp = computeLevelFingerprint(VERTICAL_SLICE_01);
    expect(fp).not.toBe(computeLevelFingerprint(TEST_LEVEL));
    expect(fp).not.toBe(computeLevelFingerprint(VALIDATION_LEVEL_02));
  });

  it('starts centered at 1x on the floor with an upper void bound', () => {
    const sim = new GameSimulation(VERTICAL_SLICE_01);
    expect(sim.player.targetLaneIndex).toBe(1);
    expect(sim.currentForwardSpeed).toBe(12);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.speedMultiplier).toBe(1);
    expect(VERTICAL_SLICE_01.deathYMax).toBe(12);
  });
});

describe('vertical slice 01 deterministic completion (real inputs)', () => {
  it('finishes naturally with zero deaths', () => {
    const { sim, ticks } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    expect(sim.player.position.z).toBeGreaterThanOrEqual(VERTICAL_SLICE_01.finishZ);
    expect(sim.attempts).toBe(1);
    expect(sim.lastDeathCause).toBeNull();
    expect(ticks).toBeGreaterThan(0);
  });

  it('completes in 45-60 s (sweet spot 48-55 s)', () => {
    const { sim, ticks } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    const seconds = sim.elapsedSimTime;
    expect(seconds).toBeGreaterThanOrEqual(45.0);
    expect(seconds).toBeLessThanOrEqual(60.0);
    expect(seconds).toBeGreaterThanOrEqual(48);
    expect(seconds).toBeLessThanOrEqual(55);
    // Exact deterministic duration anchor (ticks/120): breaks loudly if the
    // frozen engine or the authored route ever changes behavior.
    expect(ticks).toBe(6190);
    expect(seconds).toBeCloseTo(6190 / 120, 6);
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

  it('uses all three lanes meaningfully', () => {
    const { sim, minX, maxX } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    expect(minX).toBeLessThan(-2);
    expect(maxX).toBeGreaterThan(2);
  });

  it('exercises portals, pads, orbs and the speed route', () => {
    const { sim, maxSpeed } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    expect(sim.portalTransitionCount).toBe(4); // up, gravity orb, up, down
    expect(sim.lastPortalId).toBe('vs-portal-down-2');
    expect(sim.padActivationCount).toBe(2); // ceiling pad + floor pad
    expect(sim.orbActivationCount).toBe(2); // jump orb + gravity orb
    for (const id of ['vs-pad-ceiling', 'vs-pad-floor', 'vs-orb-jump', 'vs-orb-gravity']) {
      expect(sim.isInteractionUsed(id)).toBe(true);
    }
    expect(sim.speedPortalCount).toBe(2); // 2x climb + 1x release
    expect(sim.lastSpeedPortalId).toBe('vs-speed-1x');
    expect(maxSpeed).toBe(2); // the sprint really ran at 2x
    expect(sim.speedMultiplier).toBe(1); // ...and released before the finish
    expect(sim.lastInteractionId).toBe('vs-speed-1x');
  });

  it('runs a real floor section and a substantial ceiling section', () => {
    let floorLength = 0;
    let ceilingLength = 0;
    for (const s of VERTICAL_SLICE_01.solids) {
      const length = s.halfExtents.z * 2;
      if (s.center.y < 0) floorLength += length;
      if (s.center.y > 1) ceilingLength += length;
    }
    expect(floorLength).toBeGreaterThanOrEqual(300);
    expect(ceilingLength).toBeGreaterThanOrEqual(100);
  });

  it('never uses debug placement on the verification route', () => {
    const sim = new GameSimulation(VERTICAL_SLICE_01);
    let placements = 0;
    const original = sim.debugPlaceAt.bind(sim);
    sim.debugPlaceAt = (...args: [number, number, number]): void => {
      placements += 1;
      original(...args);
    };
    const driver = new VerticalSlice01Driver();
    for (let ticks = 0; ticks < 30000; ticks++) {
      if (sim.status !== 'running') break;
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.status).toBe('finished');
    expect(placements).toBe(0);
  });
});

describe('vertical slice 01 jump / gap margins', () => {
  it('keeps standard jumps well inside the frozen envelope', () => {
    const range = jumpRange(12);
    expect(range).toBeGreaterThan(7.4); // frozen-tuning sanity anchor
    // Every plain gap: width <= 5.5 u, i.e. >= 2 u margin.
    for (const [start, end] of [[58, 62], [76, 81.5], [150, 155], [230, 235]] as const) {
      expect(end - start).toBeLessThanOrEqual(5.5);
      expect(range - (end - start)).toBeGreaterThanOrEqual(2);
    }
  });

  it('makes both pad gaps uncrossable without the pad', () => {
    const range = jumpRange(12);
    for (const [start, end] of [[244, 252], [316, 324]] as const) {
      const width = end - start;
      expect(width).toBeGreaterThan(range); // a plain jump dies...
      expect(width).toBeLessThanOrEqual(range + 1); // ...but the pad has margin
    }
  });

  it('makes the orb gap require the orb and the 2x gap require 2x', () => {
    const range1x = jumpRange(12);
    expect(360 - 350).toBeGreaterThan(range1x); // orb gap: no-press flight dies
    expect(360 - 350).toBeLessThanOrEqual(12); // orb-assisted flight covers it
    expect(551 - 540).toBeGreaterThan(range1x); // 1x-proof...
    expect(551 - 540).toBeLessThanOrEqual(jumpRange(24) - 2); // ...2x margin
  });

  it('proves the jump orb is required on the authored route', () => {
    // Same route minus the orb press edge: the attempt must die in the gap.
    const withoutOrb = VERTICAL_SLICE_01_SCRIPT.filter((a) => a.atZ !== 353.2);
    const sim = new GameSimulation(VERTICAL_SLICE_01);
    const driver = new VerticalSlice01Driver(withoutOrb);
    for (let ticks = 0; ticks < 30000 && sim.attempts <= 1; ticks++) {
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.attempts).toBeGreaterThan(1); // a death happened...
    // ...falling into the orb gap (the void record lands past the edge
    // because the cube keeps moving forward while falling to deathY).
    expect(sim.lastDeathCause).toBe('void');
    expect(sim.deathPosition.z).toBeGreaterThanOrEqual(350);
    expect(sim.deathPosition.z).toBeLessThanOrEqual(370);
  });
});

describe('vertical slice 01 replay + reset', () => {
  it('records a verified replay of the successful route', () => {
    const sim = new GameSimulation(VERTICAL_SLICE_01);
    const coordinator = new ReplayCoordinator(sim);
    const driver = new VerticalSlice01Driver();
    const ticksUsed = recordAttempt(sim, coordinator, () => driver.nextInput(sim.player.position.z));
    expect(ticksUsed).toBeGreaterThan(0);
    const replay = coordinator.lastReplay;
    expect(replay).not.toBeNull();
    expect(replay?.outcome.status).toBe('finished');
    expect(replay?.levelId).toBe('vertical-slice-01');
    const verification = playReplay(sim, coordinator, replay);
    expect(verification.kind).toBe('pass');
    expect(sim.status).toBe('finished');
  });

  it('keeps the visual sequence out of the gameplay fingerprint', () => {
    const base = computeLevelFingerprint(VERTICAL_SLICE_01);
    const stripped: LevelDefinition = { ...VERTICAL_SLICE_01, visualSequence: undefined };
    expect(computeLevelFingerprint(stripped)).toBe(base);
    const mutated: LevelDefinition = {
      ...VERTICAL_SLICE_01,
      visualSequence: { sections: [] },
    };
    expect(computeLevelFingerprint(mutated)).toBe(base);
  });

  it('restores the production level correctly on restart', () => {
    const { sim } = runVerificationRoute();
    expect(sim.status).toBe('finished');
    const attempts = sim.attempts;
    sim.restart();
    expect(sim.status).toBe('running');
    expect(sim.attempts).toBe(attempts + 1);
    expect(sim.player.position.z).toBe(VERTICAL_SLICE_01.start.z);
    expect(sim.player.targetLaneIndex).toBe(VERTICAL_SLICE_01.startLaneIndex);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.speedMultiplier).toBe(1);
    // Session-monotonic evidence counters intentionally survive respawn
    // (VFX edges); the per-attempt state is what resets.
    expect(sim.lastPortalId).toBeNull();
    expect(sim.lastSpeedPortalId).toBeNull();
    expect(sim.isInteractionUsed('vs-pad-floor')).toBe(false);
  });
});
