import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import type { LevelDefinition } from '../src/level/levelDefinition';
import type { PhysicalInputSnapshot } from '../src/input/InputSystem';
import { idleInput } from './helpers/simulation';
import { recordAttempt, playReplay } from './helpers/replay';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { computeStateFingerprint } from '../src/replay/stateFingerprint';
import {
  createMovingPlatformState,
  platformPose,
  platformPeakSpeed,
  resetMovingPlatformState,
  stepMovingPlatform,
} from '../src/game/movingPlatformSystem';
import {
  MAX_MOVING_PLATFORMS,
  validateMovingPlatforms,
} from '../src/level/movingPlatformAuthoring';

/**
 * M8.6 moving-platform suite: deterministic tick-derived ferries/elevators
 * as simulation-owned dynamic solids. Compact data-driven fixtures (engine
 * never hardcodes content); the showcase level consumes the same path.
 */

const THEME = {
  background: 0x07040f,
  fogColor: 0x140b26,
  fogNear: 30,
  fogFar: 130,
  platform: 0x17122a,
  platformTop: 0x241b42,
  edge: 0xb44dff,
  hazard: 0xff9d00,
};

interface PlatformOpts {
  id?: string;
  base?: { x: number; y: number; z: number };
  halfExtents?: { x: number; y: number; z: number };
  axis?: 'x' | 'y';
  amplitude?: number;
  periodTicks?: number;
  phaseTicks?: number;
}

/**
 * Runway top y=0 with a void gap (z 50..70) bridged by the default ferry:
 * a WIDE lateral ferry (half X 3 ≥ travel 2.6 + rider 0.55, so the deck is
 * always under a center-lane crosser — deterministic boarding) + one
 * configurable platform slot for the specialized fixtures below.
 */
const makeLevel = (platforms: PlatformOpts[] = [{}], gapless = false): LevelDefinition => ({
  id: 'platform-test',
  displayName: 'PLATFORM TEST',
  start: { x: 0, y: 1.5, z: 0 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 14,
  finishZ: 200,
  deathY: -14,
  deathYMax: 14,
  solids: gapless
    ? [{ center: { x: 0, y: -0.5, z: 100 }, halfExtents: { x: 5.4, y: 0.5, z: 110 } }]
    : [
        { center: { x: 0, y: -0.5, z: 20 }, halfExtents: { x: 5.4, y: 0.5, z: 30 } },
        { center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 70 } },
      ],
  hazards: [],
  theme: THEME,
  movingPlatforms: platforms.map((p, i) => ({
    id: p.id ?? `ferry-${String(i)}`,
    base: p.base ?? { x: 0, y: -0.5, z: 60 },
    halfExtents: p.halfExtents ?? { x: 3, y: 0.5, z: 10 },
    axis: p.axis ?? 'x',
    amplitude: p.amplitude ?? 2.6,
    periodTicks: p.periodTicks ?? 240,
    phaseTicks: p.phaseTicks ?? 0,
  })),
});

/** Run onto the ferry deck (z ≈ 52) with idle inputs; asserts boarding. */
const runOntoFerry = (sim: GameSimulation, id: string): void => {
  for (let i = 0; i < 1200 && sim.player.position.z < 52 && sim.status === 'running'; i++) {
    sim.update(idleInput);
  }
  expect(sim.status).toBe('running');
  expect(sim.player.supportColliderId).toBe(`platform-${id}`);
};

const pressSpace: PhysicalInputSnapshot = {
  ...idleInput,
  space: { held: true, pressedThisStep: true, releasedThisStep: false },
};

const settle = (sim: GameSimulation): void => {
  for (let i = 0; i < 240 && !sim.player.grounded; i++) sim.update(idleInput);
  expect(sim.player.grounded).toBe(true);
};

describe('M8.6 moving-platform kinematics', () => {
  it('derives poses purely from the tick (pingpong ends, midpoints, wrap)', () => {
    const def = {
      id: 'p', base: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 },
      axis: 'x' as const, amplitude: 2, periodTicks: 120, phaseTicks: 0,
    };
    const out = { x: 0, y: 0, z: 0 };
    platformPose(def, 0, out);
    expect(out.x).toBe(-2); // starts at one travel end
    platformPose(def, 30, out);
    expect(out.x).toBe(0); // mid-travel
    platformPose(def, 60, out);
    expect(out.x).toBe(2); // far end
    platformPose(def, 90, out);
    expect(out.x).toBe(0); // returning
    platformPose(def, 120, out);
    expect(out.x).toBe(-2); // exact period wrap
    platformPose(def, 1200, out);
    expect(out.x).toBe(-2); // ten periods later, identical
    // Y axis moves Y only; Z never moves.
    const defY = { ...def, axis: 'y' as const };
    platformPose(defY, 60, out);
    expect(out.y).toBe(2);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
  });

  it('staggers opposite-phase pairs via phaseTicks', () => {
    const a = {
      id: 'a', base: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 },
      axis: 'x' as const, amplitude: 2, periodTicks: 120, phaseTicks: 0,
    };
    const b = { ...a, id: 'b', phaseTicks: 60 };
    const outA = { x: 0, y: 0, z: 0 };
    const outB = { x: 0, y: 0, z: 0 };
    platformPose(a, 0, outA);
    platformPose(b, 0, outB);
    expect(outA.x).toBe(-2);
    expect(outB.x).toBe(2); // half period apart = mirrored
  });

  it('reports peak travel speed for the authoring guard', () => {
    const def = {
      id: 'p', base: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 },
      axis: 'x' as const, amplitude: 2, periodTicks: 120, phaseTicks: 0,
    };
    expect(platformPeakSpeed(def)).toBeCloseTo(8 / 120, 12);
  });

  it('creates, steps and resets states without allocation surprises', () => {
    const def = {
      id: 'p', base: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 },
      axis: 'x' as const, amplitude: 2, periodTicks: 120, phaseTicks: 0,
    };
    const st = createMovingPlatformState(def);
    expect(st.x).toBe(-2);
    stepMovingPlatform(st, def, 60);
    expect(st.x).toBe(2);
    expect(st.px).toBe(-2); // prev snapshot preserved
    resetMovingPlatformState(st, def);
    expect(st.x).toBe(-2);
    expect(st.px).toBe(-2);
  });
});

describe('M8.6 moving-platform authoring', () => {
  it('accepts a clean ferry definition', () => {
    expect(validateMovingPlatforms(makeLevel())).toEqual([]);
  });

  it('flags cap, id, axis, size, timing and speed violations', () => {
    const many: PlatformOpts[] = [];
    for (let i = 0; i < MAX_MOVING_PLATFORMS + 1; i++) many.push({ id: `p${String(i)}` });
    expect(validateMovingPlatforms(makeLevel(many)).length).toBeGreaterThan(0);
    expect(validateMovingPlatforms(makeLevel([{ id: 'dup' }, { id: 'dup' }])).length).toBeGreaterThan(0);
    expect(
      validateMovingPlatforms(makeLevel([{ halfExtents: { x: 0.2, y: 0.5, z: 1 } }])).length,
    ).toBeGreaterThan(0);
    expect(validateMovingPlatforms(makeLevel([{ periodTicks: 30 }])).length).toBeGreaterThan(0);
    // amp 4 over 60 ticks peaks at 0.267 u/tick — unreadably fast.
    expect(
      validateMovingPlatforms(makeLevel([{ amplitude: 4, periodTicks: 60 }])).length,
    ).toBeGreaterThan(0);
  });

  it('refuses to construct a level over the dynamic-solid cap', () => {
    const many: PlatformOpts[] = [];
    for (let i = 0; i < MAX_MOVING_PLATFORMS + 1; i++) many.push({ id: `p${String(i)}` });
    expect(() => new GameSimulation(makeLevel(many))).toThrow();
  });
});

describe('M8.6 platform riding and collision', () => {
  it('carries a lateral-ferry rider along (support holds, co-travel, intent untouched)', () => {
    const sim = new GameSimulation(makeLevel());
    runOntoFerry(sim, 'ferry-0');
    // Carriage is exact-displacement; the lane servo then pulls back
    // toward the lane center (genuine rider counter-steer gameplay — the
    // vertical ride below pins the bit-exact lock where no servo fights).
    // What must hold: support never drops, rider co-travels with the deck.
    const ferryX0 = sim.platformStates[0]?.x ?? 0;
    let groundedTicks = 0;
    let maxRel = 0;
    // 120 ticks = half a period: a full end-to-end traverse (14 u of
    // forward travel — the deck's z-span holds the rider throughout).
    for (let i = 0; i < 120; i++) {
      sim.update(idleInput);
      if (sim.player.supportColliderId === 'platform-ferry-0') groundedTicks++;
      maxRel = Math.max(maxRel, Math.abs(sim.player.position.x - (sim.platformStates[0]?.x ?? 0)));
    }
    expect(sim.status).toBe('running');
    expect(sim.player.grounded).toBe(true);
    expect(groundedTicks).toBe(120);
    // The deck actually traveled under the rider (boarding phase is
    // arbitrary against the wave, so any substantial traverse proves it).
    expect(Math.abs((sim.platformStates[0]?.x ?? 0) - ferryX0)).toBeGreaterThan(1.5);
    // ...and the rider never slipped off it (relative offset stays on
    // the deck: carriage + servo equilibrium, not a slide-off).
    expect(maxRel).toBeLessThan(3);
    // Intent is never rewritten by carriage (no hidden lane debt).
    expect(sim.player.targetLaneIndex).toBe(1);
  });

  it('carries an elevator rider vertically with no launch velocity', () => {
    const sim = new GameSimulation(
      makeLevel([{ id: 'lift', base: { x: 0, y: 1, z: 60 }, axis: 'y', amplitude: 2, periodTicks: 240 }]),
    );
    // Tick-0 pose: top y = 1 − 2 + 0.5 = −0.5 — below the runway. Board
    // the lift at its low end once it surfaces: step until top ≈ 0.
    let boarded = false;
    for (let i = 0; i < 240 && !boarded; i++) {
      sim.update(idleInput);
      const st = sim.platformStates[0];
      if (st !== undefined && Math.abs(st.y + st.py - 2 * -0.5) < 0.05) {
        boarded = true;
      }
    }
    void boarded;
    const st0 = sim.platformStates[0];
    expect(st0).toBeDefined();
    // Place the rider on the current top and ride 30 ticks.
    sim.debugPlaceAt(st0?.x ?? 0, (st0?.y ?? 0) + 0.5 + 0.56, 60);
    settle(sim);
    expect(sim.player.supportColliderId).toBe('platform-lift');
    const relY0 = sim.player.position.y - (st0?.y ?? 0);
    const vy0 = sim.player.velocity.y;
    for (let i = 0; i < 30; i++) sim.update(idleInput);
    expect(sim.player.supportColliderId).toBe('platform-lift');
    expect(Math.abs(sim.player.position.y - (sim.platformStates[0]?.y ?? 0) - relY0)).toBeLessThan(1e-9);
    // No accumulated launch: vertical velocity stays near the platform's
    // own crawl (≤ peak + gravity settle), never a fling.
    expect(Math.abs(sim.player.velocity.y)).toBeLessThan(2);
    expect(Math.abs(vy0)).toBeLessThan(2);
  });

  it('pushes an elevator rider up when the platform rises into them (no tunnel, no death)', () => {
    const sim = new GameSimulation(
      makeLevel([{ id: 'lift', base: { x: 0, y: -2, z: 20 }, axis: 'y', amplitude: 2, periodTicks: 240 }]),
    );
    // Stand on runway 1 (z=6: the lift at z 10..30 surfaces under the
    // rider around tick 105..135 while they run over it).
    settle(sim);
    sim.debugPlaceAt(0, 0.56, 6);
    settle(sim);
    expect(sim.player.supportColliderId?.startsWith('solid-')).toBe(true);
    let maxY = 0;
    let sawLift = false;
    for (let i = 0; i < 200 && sim.status === 'running'; i++) {
      sim.update(idleInput);
      maxY = Math.max(maxY, sim.player.position.y);
      if (sim.player.supportColliderId === 'platform-lift') sawLift = true;
    }
    expect(sim.status).toBe('running');
    expect(sim.attempts).toBe(1);
    // The lift surfaced through the rider: pushed up and ridden.
    expect(maxY).toBeGreaterThan(0.6);
    expect(sawLift).toBe(true);
  });

  it('jumps cleanly off a ferry (support clears, ascent is the frozen jump)', () => {
    const sim = new GameSimulation(makeLevel());
    runOntoFerry(sim, 'ferry-0');
    sim.update(pressSpace);
    expect(sim.player.grounded).toBe(false);
    expect(sim.player.supportColliderId).toBeNull();
    const y0 = sim.player.position.y;
    for (let i = 0; i < 10; i++) sim.update(idleInput);
    expect(sim.player.position.y).toBeGreaterThan(y0 + 0.5);
    expect(sim.status).toBe('running');
  });

  it('lands onto a ferry from a drop with swept anti-tunneling', () => {
    const sim = new GameSimulation(makeLevel());
    // Drop from 4 u over the gap: the wide ferry is always under x=0.
    sim.debugPlaceAt(0, 4.6, 58);
    for (let i = 0; i < 120 && !sim.player.grounded; i++) sim.update(idleInput);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.supportColliderId).toBe('platform-ferry-0');
    expect(sim.status).toBe('running');
  });

  it('kills frontally when the run meets a platform wall head-on', () => {
    const sim = new GameSimulation(
      makeLevel([
        {
          id: 'wall',
          base: { x: 0, y: 2.5, z: 60 },
          halfExtents: { x: 5.4, y: 3, z: 1 },
          axis: 'x',
          amplitude: 0.5,
          periodTicks: 6000,
        },
      ],
      true, // gapless runway: the wall (not a void gap) must kill
      ),
    );
    for (let i = 0; i < 3000 && sim.attempts === 1; i++) sim.update(idleInput);
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.lastDeathLethalId).toBe('platform-wall');
  });

  it('blocks lateral motion at a platform side face without killing', () => {
    const sim = new GameSimulation(
      makeLevel([
        {
          id: 'pier',
          base: { x: -2.6, y: 2.5, z: 30 },
          halfExtents: { x: 1.3, y: 3, z: 2 },
          axis: 'x',
          amplitude: 0.5,
          periodTicks: 6000,
        },
      ]),
    );
    settle(sim);
    // Run alongside the short pier, then lean screen-right (world −X)
    // into its side face: X clips while Z passes inside the span — a
    // pure side scrape (frontal would need the −Z face).
    for (let i = 0; i < 1200 && sim.player.position.z < 28.5; i++) sim.update(idleInput);
    for (let i = 0; i < 30 && sim.status === 'running'; i++) {
      sim.update({
        ...idleInput,
        laneRight: { held: false, pressedThisStep: true, releasedThisStep: true },
      });
    }
    expect(sim.status).toBe('running');
    expect(sim.attempts).toBe(1);
    // Unblocked, 30 rapid taps would carry the Cube to x ≈ −4; the side
    // face at x=-1.3 holds it near the touch point instead.
    expect(sim.player.position.x).toBeGreaterThan(-1.5);
    // Lane-debt resync kept intent recoverable (no deep hidden debt).
    expect(sim.player.targetLaneIndex).toBeLessThanOrEqual(3);
  });

  it('hands support from ferry to static ground without a fall', () => {
    const level = makeLevel([
      { id: 'ferry', base: { x: 0, y: -0.5, z: 60 }, axis: 'x', amplitude: 2.6, periodTicks: 240 },
    ]);
    // Static island top y=0 overlapping the ferry's +X travel end.
    level.solids.push({ center: { x: 3.9, y: -0.5, z: 60 }, halfExtents: { x: 1.3, y: 0.5, z: 10 } });
    const sim = new GameSimulation(level);
    runOntoFerry(sim, 'ferry');
    let sawStatic = false;
    for (let i = 0; i < 400 && sim.status === 'running'; i++) {
      sim.update(idleInput);
      if (sim.player.supportColliderId?.startsWith('solid-') === true) sawStatic = true;
    }
    expect(sim.status).toBe('running');
    expect(sim.player.grounded).toBe(true);
    // Static geometry wins support ties (static candidates precede the
    // appended dynamic ones): the rider hands off to the island.
    expect(sawStatic).toBe(true);
  });

  it('resets the platform clock and poses on respawn', () => {
    const sim = new GameSimulation(makeLevel());
    for (let i = 0; i < 100; i++) sim.update(idleInput);
    expect(sim.platformTick).toBe(100);
    const movedX = sim.platformStates[0]?.x ?? 0;
    expect(movedX).not.toBe(-2.6);
    sim.restart();
    expect(sim.platformTick).toBe(0);
    expect(sim.platformStates[0]?.x).toBe(-2.6);
    expect(sim.platformStates[0]?.px).toBe(-2.6);
  });
});

describe('M8.6 platform determinism and fingerprints', () => {
  it('runs the same trajectory twice (tick-derived determinism)', () => {
    const run = (): number[] => {
      const sim = new GameSimulation(makeLevel());
      sim.debugPlaceAt(-2.6, 0.56, 60);
      const xs: number[] = [];
      for (let i = 0; i < 60; i++) {
        sim.update(idleInput);
        xs.push(sim.player.position.x, sim.player.position.y);
      }
      return xs;
    };
    expect(run()).toEqual(run());
  });

  it('replays a platform ride VERIFIED through the real coordinator', () => {
    // Pure idle inputs: the run boards the ferry at the gap, rides it,
    // and continues to the finish — input-only tape, no state edits.
    const sim = new GameSimulation(makeLevel());
    const coordinator = new ReplayCoordinator(sim);
    recordAttempt(sim, coordinator, () => idleInput);
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    const replay = coordinator.lastReplay;
    expect(replay).not.toBeNull();
    const verification = playReplay(sim, coordinator, replay);
    expect(verification.kind).toBe('pass');
    expect(sim.status).toBe('finished');
  });

  it('extends the level fingerprint conditionally (zero bytes when absent)', () => {
    const withPlatforms = makeLevel();
    const without = makeLevel([]);
    expect(computeLevelFingerprint(withPlatforms)).not.toBe(computeLevelFingerprint(without));
    expect(computeLevelFingerprint(withPlatforms)).toBe(computeLevelFingerprint(makeLevel()));
    // Empty array writes zero bytes: identical hash to absent.
    const empty: LevelDefinition = { ...withPlatforms, movingPlatforms: [] };
    expect(computeLevelFingerprint(empty)).toBe(computeLevelFingerprint(without));
  });

  it('extends the state fingerprint with platform poses (clock-exact)', () => {
    const sim = new GameSimulation(makeLevel());
    const h0 = computeStateFingerprint(sim);
    for (let i = 0; i < 10; i++) sim.update(idleInput);
    const h1 = computeStateFingerprint(sim);
    expect(h1).not.toBe(h0);
    // Same steps on a fresh sim reproduce the exact hash.
    const sim2 = new GameSimulation(makeLevel());
    for (let i = 0; i < 10; i++) sim2.update(idleInput);
    expect(computeStateFingerprint(sim2)).toBe(h1);
  });
});
