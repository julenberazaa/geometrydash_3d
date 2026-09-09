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
import { REPLAY_RULESET_VERSION, REPLAY_SCHEMA_VERSION } from '../src/replay/replayFormat';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { cueIdAtZ, prepareRhythmCues } from '../src/visuals/rhythmCues';
import type { LevelDefinition } from '../src/level/levelDefinition';
import {
  VERTICAL_SLICE_01_SCRIPT,
  VerticalSlice01Driver,
} from './helpers/verticalSlice01Script';
import { recordAttempt, playReplay } from './helpers/replay';

/**
 * M7.1 vertical-slice suite: precision topology, difficulty, fairness
 * margins, visual/beat metadata contracts, replay verification and
 * production-level invariants. All driving uses legal physical inputs —
 * no debug teleport, no state mutation.
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

/** Sample the verification route: one record per 6 ticks (x, grounded, z, mode). */
const sampleRoute = (): Array<{ x: number; grounded: boolean; z: number; mode: string }> => {
  const sim = new GameSimulation(VERTICAL_SLICE_01);
  const driver = new VerticalSlice01Driver();
  const samples: Array<{ x: number; grounded: boolean; z: number; mode: string }> = [];
  for (let ticks = 0; ticks < 30000; ticks++) {
    if (sim.status !== 'running') break;
    sim.update(driver.nextInput(sim.player.position.z));
    if (ticks % 6 === 0) {
      samples.push({
        x: sim.player.position.x,
        grounded: sim.player.grounded,
        z: sim.player.position.z,
        mode: sim.gravityMode,
      });
    }
  }
  expect(sim.status).toBe('finished');
  return samples;
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

  it('keeps the engine free of level-specific branches', () => {
    const modules = import.meta.glob(
      '../src/{game/GameSimulation,player/CubeController,player/cubeTuning,collision/moveAabb,collision/CollisionWorld,collision/collider}.ts',
      { eager: true, query: '?raw', import: 'default' },
    );
    const entries = Object.entries(modules).filter((e): e is [string, string] => typeof e[1] === 'string');
    expect(entries.length).toBe(6);
    for (const [file, source] of entries) {
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
    // Exact deterministic duration anchor (ticks/120): the M7.1 rework keeps
    // the portal/speed skeleton, so the constant-speed clock is unchanged.
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

  it('needs no fast-fall input anywhere on the verification route', () => {
    // M7.1 authors no fast-fall requirement: the script emits only lane taps
    // and jump presses, and still finishes.
    const kinds = new Set(VERTICAL_SLICE_01_SCRIPT.map((a) => a.kind));
    expect([...kinds].sort()).toEqual(['jumpPress', 'tapLeft', 'tapRight']);
    const { sim } = runVerificationRoute();
    expect(sim.status).toBe('finished');
  });
});

describe('vertical slice 01 precision topology (M7.1)', () => {
  it('builds the route mostly from narrow/partial-width platforms', () => {
    const narrow = VERTICAL_SLICE_01.solids.filter((s) => s.halfExtents.x <= 2.7);
    expect(narrow.length).toBeGreaterThanOrEqual(15);
    expect(VERTICAL_SLICE_01.solids.length).toBeGreaterThanOrEqual(20);
  });

  it('no longer uses full-width slabs as the dominant topology', () => {
    let fullLength = 0;
    let totalLength = 0;
    for (const s of VERTICAL_SLICE_01.solids) {
      const length = s.halfExtents.z * 2;
      totalLength += length;
      if (s.halfExtents.x > 2.7) fullLength += length;
    }
    // Three short recovery/release tools only (start, portal approach, release).
    const fullSlabs = VERTICAL_SLICE_01.solids.filter((s) => s.halfExtents.x > 2.7);
    expect(fullSlabs.length).toBeLessThanOrEqual(3);
    expect(fullLength / totalLength).toBeLessThan(0.35);
  });

  it('offers single-lane islands that the route genuinely lands on', () => {
    const lanes = VERTICAL_SLICE_01.laneCenters;
    const islands = VERTICAL_SLICE_01.solids.filter(
      (s) =>
        s.halfExtents.x <= 1.4 &&
        s.center.y < 1 &&
        lanes.some((lane) => Math.abs(s.center.x - lane) < 0.01),
    );
    expect(islands.length).toBeGreaterThanOrEqual(3);
    // The verification route demonstrably lands on them (grounded samples
    // near the island center inside its z span).
    const samples = sampleRoute();
    for (const island of islands.slice(0, 4)) {
      const z0 = island.center.z - island.halfExtents.z;
      const z1 = island.center.z + island.halfExtents.z;
      const landed = samples.some(
        (s) =>
          s.grounded &&
          s.mode === 'floor' &&
          s.z > z0 + 1 &&
          s.z < z1 - 1 &&
          Math.abs(s.x - island.center.x) < 0.6,
      );
      expect(landed, `island at z=${island.center.z}`).toBe(true);
    }
  });

  it('offers a two-lane platform (lateral choice without corridor freedom)', () => {
    const twoLane = VERTICAL_SLICE_01.solids.filter(
      (s) => s.halfExtents.x > 1.4 && s.halfExtents.x <= 2.7,
    );
    expect(twoLane.length).toBeGreaterThanOrEqual(3);
  });

  it('requires an airborne lateral transfer (route minus the tap dies)', () => {
    // First island transfer: without the mid-air move right, the Cube jumps
    // the gap but lands off the right island (center has no support there).
    const withoutTransfer = VERTICAL_SLICE_01_SCRIPT.filter((a) => a.atZ !== 34.5);
    const sim = new GameSimulation(VERTICAL_SLICE_01);
    const driver = new VerticalSlice01Driver(withoutTransfer);
    for (let ticks = 0; ticks < 30000 && sim.attempts <= 1; ticks++) {
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('void');
    expect(sim.deathPosition.z).toBeLessThan(60);
  });

  it('constrains valid solutions: a lane-lazy route dies in the island chain', () => {
    // Jumps only, zero lane taps: the old full-width road would carry this
    // to the portal; the island chain must not.
    const jumpsOnly = VERTICAL_SLICE_01_SCRIPT.filter((a) => a.kind === 'jumpPress');
    const sim = new GameSimulation(VERTICAL_SLICE_01);
    const driver = new VerticalSlice01Driver(jumpsOnly);
    for (let ticks = 0; ticks < 30000 && sim.attempts <= 1; ticks++) {
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.deathPosition.z).toBeLessThan(150);
  });

  it('runs a narrow ceiling section (single-lane bridge the route uses)', () => {
    const narrowCeiling = VERTICAL_SLICE_01.solids.filter(
      (s) => s.center.y > 1 && s.halfExtents.x <= 1.4,
    );
    expect(narrowCeiling.length).toBeGreaterThanOrEqual(1);
    const samples = sampleRoute();
    const bridge = narrowCeiling[0];
    if (!bridge) throw new Error('expected a narrow ceiling bridge');
    const z0 = bridge.center.z - bridge.halfExtents.z;
    const z1 = bridge.center.z + bridge.halfExtents.z;
    const used = samples.some(
      (s) =>
        s.grounded && s.mode === 'ceiling' && s.z > z0 && s.z < z1 && Math.abs(s.x - bridge.center.x) < 0.6,
    );
    expect(used).toBe(true);
  });

  it('marks ceiling spikes with the ceiling mount (visual contract)', () => {
    const ceilingSpikes = VERTICAL_SLICE_01.hazards.filter((h) => h.center.y > 3);
    expect(ceilingSpikes.length).toBeGreaterThanOrEqual(1);
    for (const hz of ceilingSpikes) expect(hz.mount).toBe('ceiling');
    const floorSpikes = VERTICAL_SLICE_01.hazards.filter((h) => h.center.y < 3);
    expect(floorSpikes.length).toBeGreaterThanOrEqual(1);
    for (const hz of floorSpikes) expect(hz.mount ?? 'floor').toBe('floor');
  });
});

describe('vertical slice 01 jump / gap margins', () => {
  it('keeps standard jumps well inside the frozen envelope', () => {
    const range = jumpRange(12);
    expect(range).toBeGreaterThan(7.4); // frozen-tuning sanity anchor
    // Every plain gap: width <= 5 u, i.e. >= 2.5 u margin.
    const plainGaps: Array<readonly [number, number]> = [
      [34, 38], [50, 54], [66, 70.5], [82, 84], [96, 100],
      [130, 134.5], [150, 154], [230, 234], [274, 276], [480, 484],
    ];
    for (const [start, end] of plainGaps) {
      expect(end - start).toBeLessThanOrEqual(5);
      expect(range - (end - start)).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('keeps documented lateral margin on every single-lane island', () => {
    // Island width 2.6 − collider 1.1 = 1.5 total → 0.75 u per side (>= 0.5).
    for (const s of VERTICAL_SLICE_01.solids) {
      if (s.halfExtents.x <= 1.4) {
        const marginPerSide = (s.halfExtents.x * 2 - CUBE_TUNING.colliderSize) / 2;
        expect(marginPerSide).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it('makes both pad gaps uncrossable without the pad', () => {
    const range = jumpRange(12);
    for (const [start, end] of [[244, 252], [313, 321]] as const) {
      const width = end - start;
      expect(width).toBeGreaterThan(range); // a plain jump dies...
      expect(width).toBeLessThanOrEqual(range + 1); // ...but the pad has margin
    }
  });

  it('makes the orb gap require the orb and the 2x gaps require 2x', () => {
    const range1x = jumpRange(12);
    expect(358 - 350).toBeGreaterThan(range1x); // orb gap: no-press flight dies
    expect(358 - 350).toBeLessThanOrEqual(12); // orb-assisted flight covers it
    for (const [start, end] of [[538, 549], [596, 606]] as const) {
      expect(end - start).toBeGreaterThan(range1x); // 1x-proof...
      expect(end - start).toBeLessThanOrEqual(jumpRange(24) - 4); // ...2x margin
    }
  });

  it('proves the jump orb is required on the authored route', () => {
    // Same route minus the orb press edge: the attempt must die in the gap.
    const withoutOrb = VERTICAL_SLICE_01_SCRIPT.filter((a) => a.atZ !== 352.5);
    const sim = new GameSimulation(VERTICAL_SLICE_01);
    const driver = new VerticalSlice01Driver(withoutOrb);
    for (let ticks = 0; ticks < 30000 && sim.attempts <= 1; ticks++) {
      sim.update(driver.nextInput(sim.player.position.z));
    }
    expect(sim.attempts).toBeGreaterThan(1); // a death happened...
    // ...falling into the orb gap (the void record lands past the edge
    // because the cube keeps moving forward while falling to deathY).
    expect(sim.lastDeathCause).toBe('void');
    expect(sim.deathPosition.z).toBeGreaterThanOrEqual(348);
    expect(sim.deathPosition.z).toBeLessThanOrEqual(368);
  });
});

describe('vertical slice 01 visual + beat metadata contracts', () => {
  it('authors six distinct visual scenes', () => {
    const sections = VERTICAL_SLICE_01.visualSequence?.sections ?? [];
    expect(sections.map((s) => s.id)).toEqual([
      'vs-opening',
      'vs-precision',
      'vs-gravity',
      'vs-tech',
      'vs-climax',
      'vs-release',
    ]);
    // Later scenes actually transform the look (not a restrained retint).
    const gravity = sections.find((s) => s.id === 'vs-gravity')?.overrides;
    expect(gravity?.background).not.toBe(VERTICAL_SLICE_01.theme.background);
    expect(gravity?.fogColor).not.toBe(VERTICAL_SLICE_01.theme.fogColor);
    const climax = sections.find((s) => s.id === 'vs-climax')?.overrides;
    expect(climax?.bloomStrength).toBeGreaterThan(0.5);
    expect(climax?.streakIntensity).toBeGreaterThanOrEqual(1.5);
  });

  it('keeps every presentation layer out of the gameplay fingerprint', () => {
    const base = computeLevelFingerprint(VERTICAL_SLICE_01);
    const stripped: LevelDefinition = {
      ...VERTICAL_SLICE_01,
      theme: { ...VERTICAL_SLICE_01.theme },
      visualSequence: undefined,
      rhythmCues: undefined,
      hazards: VERTICAL_SLICE_01.hazards.map(({ visual: _v, mount: _m, ...rest }) => rest),
    };
    expect(computeLevelFingerprint(stripped)).toBe(base);
  });

  it('binds rhythm cues to deterministic forward positions', () => {
    const cues = prepareRhythmCues(VERTICAL_SLICE_01);
    expect(cues.length).toBeGreaterThanOrEqual(10);
    expect(cueIdAtZ(cues, -20)).toBeNull();
    expect(cueIdAtZ(cues, -10)).toBe('m71-cue-intro');
    expect(cueIdAtZ(cues, 170)).toBe('m71-cue-gravity-hit');
    expect(cueIdAtZ(cues, 518)).toBe('m71-cue-drop');
    expect(cueIdAtZ(cues, 648)).toBe('m71-cue-release');
    expect(cueIdAtZ(cues, 680)).toBe('m71-cue-finish');
    // Same z → same cue, every evaluation (no clocks involved).
    expect(cueIdAtZ(cues, 300)).toBe(cueIdAtZ(prepareRhythmCues(VERTICAL_SLICE_01), 300));
  });

  it('pins the replay container versions (ReplayV1 unchanged)', () => {
    expect(REPLAY_SCHEMA_VERSION).toBe(1);
    expect(REPLAY_RULESET_VERSION).toBe(1);
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
    // No presentation state leaks into the tape (visuals, punch, cues).
    const serialized = JSON.stringify(replay);
    for (const key of ['visual', 'section', 'punch', 'rhythm', 'cue', 'bloom', 'fog', 'exposure', 'trigger']) {
      expect(serialized).not.toContain(`"${key}`);
    }
    const verification = playReplay(sim, coordinator, replay);
    expect(verification.kind).toBe('pass');
    expect(sim.status).toBe('finished');
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
