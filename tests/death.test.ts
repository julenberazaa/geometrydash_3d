import { describe, it, expect } from 'vitest';
import { GameSimulation, DEATH_HOLD_TICKS } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { CollisionWorld } from '../src/collision/CollisionWorld';
import { moveAabbThroughWorld, createMoveResult } from '../src/collision/moveAabb';
import { vec3 } from '../src/core/math';
import { CUBE_TUNING } from '../src/player/cubeTuning';
import {
  idleInput,
  holdJump,
  holdFastFall,
  tapLaneLeft,
  tapLaneRight,
  advance,
} from './helpers/simulation';

/**
 * M2 death/restart/collision-fairness suite. All restart timing is asserted in
 * deterministic simulation ticks, never wall-clock. Fixture levels are built
 * here (data-driven, zero engine changes); the shared test level is only used
 * for spike-fairness pins and full-trajectory determinism.
 */

const THEME = TEST_LEVEL.theme;
const LANES = [2.6, 0, -2.6];

interface ArenaOptions {
  solids?: LevelDefinition['solids'];
  hazards?: LevelDefinition['hazards'];
  finishZ?: number;
  deathY?: number;
}

const RUNWAY = {
  center: { x: 0, y: -0.5, z: 20 },
  halfExtents: { x: 5.4, y: 0.5, z: 30 },
};

const makeArena = (opts: ArenaOptions = {}): GameSimulation => {
  const def: LevelDefinition = {
    id: 'm2-fixture',
    displayName: 'M2 FIXTURE',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: opts.finishZ ?? 60,
    deathY: opts.deathY ?? -14,
    solids: opts.solids ?? [{ ...RUNWAY }],
    hazards: opts.hazards ?? [],
    theme: THEME,
  };
  return new GameSimulation(def);
};

/** Step until dead or the budget runs out; returns steps taken. */
const runUntilDead = (sim: GameSimulation, budget = 900): number => {
  let steps = 0;
  while (sim.status === 'running' && steps < budget) {
    sim.update(idleInput);
    steps++;
  }
  return steps;
};

const settle = (sim: GameSimulation): void => {
  for (let i = 0; i < 120 && !sim.player.grounded; i++) sim.update(idleInput);
  if (!sim.player.grounded) throw new Error('fixture never settled');
};

describe('M2 — frontal impact death', () => {
  it('frontal solid impact kills with cause frontImpact and contact record', () => {
    let deaths = 0;
    const def: LevelDefinition = {
      id: 'm2-frontal',
      displayName: 'M2 FRONTAL',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [
        { ...RUNWAY },
        { center: { x: 0, y: 1, z: 20 }, halfExtents: { x: 5.4, y: 1, z: 0.5 } },
      ],
      hazards: [],
      theme: THEME,
    };
    const sim2 = new GameSimulation(def, { onDeath: () => deaths++ });
    const steps = runUntilDead(sim2);
    expect(steps).toBeLessThan(900);
    expect(sim2.status).toBe('dead');
    expect(sim2.deathCause).toBe('frontImpact');
    expect(sim2.lastLethalColliderId).toBe('solid-1');
    expect(sim2.lastContactNormal.z).toBeLessThan(-0.5);
    expect(sim2.lastPreImpactVelocity.z).toBeGreaterThan(0);
    expect(deaths).toBe(1);
  });

  it('jumping into a wall face still kills (collision during jump)', () => {
    const sim = makeArena({
      solids: [
        { ...RUNWAY },
        { center: { x: 0, y: 2, z: 24 }, halfExtents: { x: 5.4, y: 2, z: 0.5 } },
      ],
    });
    settle(sim);
    // Take off late so the rising arc meets the face at z=23.5.
    while (sim.player.position.z < 17 && sim.status === 'running') sim.update(idleInput);
    sim.update(holdJump);
    const steps = runUntilDead(sim, 300);
    expect(steps).toBeLessThan(300);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('frontImpact');
  });

  it('wall sitting on the runway kills a grounded runner (simultaneous wall+ground)', () => {
    const sim = makeArena({
      solids: [
        { ...RUNWAY },
        { center: { x: 0, y: 1, z: 20 }, halfExtents: { x: 5.4, y: 1, z: 0.5 } },
      ],
    });
    const steps = runUntilDead(sim);
    expect(steps).toBeLessThan(900);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('frontImpact');
  });
});

describe('M2 — killFront kind semantics', () => {
  const killWall = {
    kind: 'killFront' as const,
    center: { x: 0, y: 2, z: 20 },
    halfExtents: { x: 5.4, y: 2, z: 0.5 },
  };

  it('frontal killFront impact kills with cause frontImpact', () => {
    const sim = makeArena({ hazards: [{ ...killWall }] });
    const steps = runUntilDead(sim);
    expect(steps).toBeLessThan(900);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('frontImpact');
    expect(sim.lastLethalColliderId).toBe('hazard-1');
  });

  it('lateral scrape on a killFront side face blocks without killing', () => {
    const sim = makeArena({
      hazards: [
        {
          kind: 'killFront',
          center: { x: 3, y: 2, z: 20 },
          halfExtents: { x: 1, y: 2, z: 30 },
        },
      ],
    });
    settle(sim);
    sim.update(tapLaneLeft); // steer toward +X into the x=2 face
    advance(sim, idleInput, 300);
    expect(sim.status).toBe('running');
    expect(sim.deathCause).toBeNull();
    // Blocked exactly at face (2.0) minus player half (0.55).
    expect(sim.player.position.x).toBeCloseTo(1.45, 1);
  });

  it('landing on top of a killFront volume is safe and grounds', () => {
    const sim = makeArena({
      solids: [{ center: { x: 0, y: -0.5, z: -2.5 }, halfExtents: { x: 5.4, y: 0.5, z: 7.5 } }],
      hazards: [
        {
          kind: 'killFront',
          center: { x: 0, y: -0.6, z: 10 },
          halfExtents: { x: 5.4, y: 0.4, z: 5 },
        },
      ],
    });
    for (let i = 0; i < 400 && !(sim.player.position.z > 11); i++) sim.update(idleInput);
    expect(sim.player.position.z).toBeGreaterThan(11);
    expect(sim.status).toBe('running');
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.supportColliderId).toBe('hazard-1');
    // Feet rest on the killFront top (y=-0.2): center == -0.2 + half.
    expect(sim.player.position.y).toBeCloseTo(-0.2 + CUBE_TUNING.colliderSize / 2, 1);
  });
});

describe('M2 — hazard and void death', () => {
  it('running through a spike kills with cause hazard', () => {
    const sim = makeArena({
      hazards: [
        {
          kind: 'hazard',
          visual: 'spike',
          center: { x: 0, y: 0.25, z: 10 },
          halfExtents: { x: 0.5, y: 0.25, z: 0.5 },
        },
      ],
    });
    const steps = runUntilDead(sim);
    expect(steps).toBeLessThan(900);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('hazard');
    expect(sim.lastLethalColliderId).toBe('hazard-1');
  });

  it('running off the track ends in a void death', () => {
    const sim = makeArena({
      solids: [{ center: { x: 0, y: -0.5, z: -2.5 }, halfExtents: { x: 5.4, y: 0.5, z: 7.5 } }],
    });
    const steps = runUntilDead(sim, 1200);
    expect(steps).toBeLessThan(1200);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('void');
    expect(sim.lastLethalColliderId).toBeNull();
  });
});

describe('M2 — death-state correctness', () => {
  const wallArena = (): GameSimulation =>
    makeArena({
      solids: [
        { ...RUNWAY },
        { center: { x: 0, y: 1, z: 20 }, halfExtents: { x: 5.4, y: 1, z: 0.5 } },
      ],
    });

  it('hazard death emits exactly once and auto-respawns after exactly 36 ticks', () => {
    let deaths = 0;
    const sim = new GameSimulation(wallArena().level.def, {
      onDeath: () => deaths++,
    });
    runUntilDead(sim);
    expect(deaths).toBe(1);
    const attemptsAtDeath = sim.attempts;
    // 35 more ticks: still dead, no second event, no attempt change.
    advance(sim, idleInput, DEATH_HOLD_TICKS - 1);
    expect(sim.status).toBe('dead');
    expect(deaths).toBe(1);
    expect(sim.attempts).toBe(attemptsAtDeath);
    // Tick 36: respawn, exactly one attempt.
    sim.update(idleInput);
    expect(sim.status).toBe('running');
    expect(sim.attempts).toBe(attemptsAtDeath + 1);
    expect(deaths).toBe(1);
  });

  it('dead steps freeze position and sim time; inputs while dead are ignored', () => {
    const sim = wallArena();
    runUntilDead(sim);
    const frozen = { ...sim.player.position };
    const frozenTime = sim.elapsedSimTime;
    for (let i = 0; i < 10; i++) sim.update(holdJump);
    expect(sim.player.position.x).toBe(frozen.x);
    expect(sim.player.position.y).toBe(frozen.y);
    expect(sim.player.position.z).toBe(frozen.z);
    expect(sim.elapsedSimTime).toBe(frozenTime);
    expect(sim.status).toBe('dead');
  });

  it('respawn fully resets transient gameplay state', () => {
    const sim = wallArena();
    settle(sim);
    sim.update(tapLaneRight); // dirty the lane intent before dying
    runUntilDead(sim);
    expect(sim.status).toBe('dead');
    advance(sim, idleInput, DEATH_HOLD_TICKS);
    expect(sim.status).toBe('running');
    expect(sim.player.position.x).toBeCloseTo(0, 5);
    expect(sim.player.position.y).toBeCloseTo(1.5, 5);
    expect(sim.player.position.z).toBeCloseTo(-4, 5);
    expect(sim.player.velocity.x).toBe(0);
    expect(sim.player.velocity.y).toBe(0);
    expect(sim.player.velocity.z).toBe(0);
    expect(sim.player.grounded).toBe(false);
    expect(sim.player.supportColliderId).toBeNull();
    expect(sim.player.targetLaneIndex).toBe(1);
    expect(sim.deathCause).toBeNull();
    expect(sim.lastLethalColliderId).toBeNull();
    // ...while the stable last-death record is retained for QA/analytics.
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.lastDeathLethalId).toBe('solid-1');
    expect(sim.deathHoldTicksLeft).toBe(0);
    expect(sim.elapsedSimTime).toBe(0);
  });

  it('finish can never trigger after death', () => {
    const sim = makeArena({
      solids: [
        { ...RUNWAY },
        { center: { x: 0, y: 1, z: 20 }, halfExtents: { x: 5.4, y: 1, z: 0.5 } },
      ],
      finishZ: 25,
    });
    runUntilDead(sim);
    expect(sim.status).toBe('dead');
    // Teleport past the finish while dead: still dead, never finished.
    sim.player.position.z = 30;
    sim.update(idleInput);
    expect(sim.status).toBe('dead');
    // One update already consumed one hold tick; the remaining 35 respawn exactly.
    advance(sim, idleInput, DEATH_HOLD_TICKS - 1);
    expect(sim.status).toBe('running');
    expect(sim.player.position.z).toBeCloseTo(-4, 5);
  });
});

describe('M2 — restart semantics', () => {
  it('R while running restarts immediately with exactly one attempt (not death)', () => {
    let deaths = 0;
    const sim = new GameSimulation(TEST_LEVEL, { onDeath: () => deaths++ });
    advance(sim, idleInput, 100);
    const attemptsBefore = sim.attempts;
    sim.restart();
    expect(sim.attempts).toBe(attemptsBefore + 1);
    expect(sim.status).toBe('running');
    expect(sim.deathCause).toBeNull();
    expect(deaths).toBe(0);
    expect(sim.player.position.z).toBeCloseTo(TEST_LEVEL.start.z, 5);
  });

  it('R while dead respawns deterministically with no double attempt', () => {
    const sim = makeArena({
      solids: [
        { ...RUNWAY },
        { center: { x: 0, y: 1, z: 20 }, halfExtents: { x: 5.4, y: 1, z: 0.5 } },
      ],
    });
    runUntilDead(sim);
    const attemptsAtDeath = sim.attempts;
    sim.restart();
    expect(sim.status).toBe('running');
    expect(sim.attempts).toBe(attemptsAtDeath + 1);
    expect(sim.player.position.z).toBeCloseTo(-4, 5);
    // The cleared hold timer must not fire a second respawn later.
    advance(sim, idleInput, 60);
    expect(sim.attempts).toBe(attemptsAtDeath + 1);
  });

  it('repeated R presses produce exactly one attempt each', () => {
    const sim = makeArena();
    settle(sim);
    for (let i = 0; i < 5; i++) {
      const before = sim.attempts;
      sim.restart();
      expect(sim.attempts).toBe(before + 1);
      expect(sim.status).toBe('running');
    }
  });
});

describe('M2 — determinism and corner behavior', () => {
  it('identical input streams produce identical trajectories', () => {
    const record = (): Array<[number, number, number]> => {
      const sim = new GameSimulation(TEST_LEVEL);
      const out: Array<[number, number, number]> = [];
      const script: Array<{ at: number; input: typeof idleInput }> = [
        { at: 100, input: tapLaneRight },
        { at: 151, input: holdJump },
        { at: 272, input: tapLaneLeft },
        { at: 273, input: holdFastFall },
      ];
      let cursor = 0;
      for (let step = 0; step < 354; step++) {
        let input = idleInput;
        if (cursor < script.length && script[cursor]?.at === step) {
          input = script[cursor]?.input ?? idleInput;
          cursor++;
        }
        sim.update(input);
        out.push([sim.player.position.x, sim.player.position.y, sim.player.position.z]);
      }
      return out;
    };
    const a = record();
    const b = record();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]?.[0]).toBe(b[i]?.[0]);
      expect(a[i]?.[1]).toBe(b[i]?.[1]);
      expect(a[i]?.[2]).toBe(b[i]?.[2]);
    }
  });

  it('side-blocked lane settle is pinned and identical across runs', () => {
    const drive = (): number => {
      const sim = makeArena({
        solids: [
          { ...RUNWAY },
          { center: { x: 3.45, y: -0.5, z: 20 }, halfExtents: { x: 1.95, y: 3, z: 30 } },
        ],
      });
      settle(sim);
      sim.update(tapLaneLeft);
      advance(sim, idleInput, 240);
      expect(sim.status).toBe('running');
      return sim.player.position.x;
    };
    const x1 = drive();
    const x2 = drive();
    // Wall face at x=1.5 minus player half 0.55: hard geometric pin.
    expect(x1).toBeCloseTo(0.95, 2);
    expect(x2).toBe(x1);
  });

  it('high-displacement frontal impact on killFront cannot tunnel', () => {
    const world = new CollisionWorld(8);
    world.add({
      id: 'thin-kill',
      kind: 'killFront',
      center: vec3(0, 0, 100),
      halfExtents: vec3(5, 5, 0.05),
    });
    const pos = vec3(0, 0, 98);
    const half = vec3(0.25, 0.25, 0.25);
    const result = createMoveResult();
    // 4x-equivalent per-step displacement straight through the thin face.
    moveAabbThroughWorld(world, pos, half, vec3(0, 0, 56 / 120), result);
    for (let i = 0; i < 60 && result.wallContacts.length === 0; i++) {
      moveAabbThroughWorld(world, pos, half, vec3(0, 0, 56 / 120), result);
    }
    expect(result.wallContacts.length).toBeGreaterThan(0);
    expect(result.wallContacts[0]?.collider.kind).toBe('killFront');
    expect(pos.z).toBeLessThan(100);
    expect(pos.z).toBeGreaterThan(99);
  });
});

describe('M2 — spike fairness (test-level pins)', () => {
  it('spike gameplay boxes keep a fairness margin (smaller than their visuals)', () => {
    // LevelView draws each spike 1.1 wide and ~0.85 tall; gameplay must be smaller.
    for (const h of TEST_LEVEL.hazards) {
      expect(h.halfExtents.x * 2).toBeLessThanOrEqual(1.0);
      expect(h.halfExtents.y * 2).toBeLessThanOrEqual(0.5);
      expect(h.halfExtents.z * 2).toBeLessThanOrEqual(1.0);
    }
  });

  it('adjacent-lane spike rows are survivable from the safe lane', () => {
    const sim = makeArena({
      hazards: [
        {
          kind: 'hazard',
          visual: 'spike',
          center: { x: -2.6, y: 0.25, z: 10 },
          halfExtents: { x: 0.5, y: 0.25, z: 0.5 },
        },
        {
          kind: 'hazard',
          visual: 'spike',
          center: { x: 2.6, y: 0.25, z: 10 },
          halfExtents: { x: 0.5, y: 0.25, z: 0.5 },
        },
      ],
    });
    settle(sim);
    for (let i = 0; i < 300 && sim.player.position.z < 13; i++) sim.update(idleInput);
    expect(sim.player.position.z).toBeGreaterThan(13);
    expect(sim.status).toBe('running');
  });

  it('a timed jump clears a center spike; running through it dies', () => {
    const spike = {
      kind: 'hazard' as const,
      visual: 'spike' as const,
      center: { x: 0, y: 0.25, z: 10 },
      halfExtents: { x: 0.5, y: 0.25, z: 0.5 },
    };
    // Runner: no jump, dies.
    const doomed = makeArena({ hazards: [{ ...spike }] });
    runUntilDead(doomed, 400);
    expect(doomed.status).toBe('dead');
    expect(doomed.deathCause).toBe('hazard');
    // Jumper: take off at z≈4 (8.8-unit arc clears z 9.45..10.55 + body).
    const jumper = makeArena({ hazards: [{ ...spike }] });
    settle(jumper);
    while (jumper.player.position.z < 4 && jumper.status === 'running') {
      jumper.update(idleInput);
    }
    jumper.update(holdJump);
    for (let i = 0; i < 300 && jumper.player.position.z < 14; i++) {
      jumper.update(idleInput);
    }
    expect(jumper.player.position.z).toBeGreaterThan(14);
    expect(jumper.status).toBe('running');
  });
});
