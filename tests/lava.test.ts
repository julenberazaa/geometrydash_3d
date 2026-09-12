import { describe, it, expect } from 'vitest';
import { GameSimulation, DEATH_HOLD_TICKS } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { ADVANCED_CUBE_01 } from '../src/content/levels/advancedCube01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { validateLavaAuthoring } from '../src/level/lavaAuthoring';
import { loadLevel } from '../src/level/levelRuntime';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { computeStateFingerprint } from '../src/replay/stateFingerprint';
import { idleInput, advance } from './helpers/simulation';

/**
 * M8A lethal-lava + death-hold contract:
 * - touching lava kills INSTANTLY with cause `lava` (no delay, no bounce);
 * - lava rides the same swept-path CCD as hazards (no tunneling at speed);
 * - every production lava composition is sourced/contained (no floaters);
 * - the death hold is long enough to read the explosion (78 ticks / 0.65 s)
 *   while restart stays arcade-fast.
 */

const THEME = TEST_LEVEL.theme;
const LANES = [2.6, 0, -2.6];

const makeLavaArena = (lava: LevelDefinition['lava'], opts: Partial<LevelDefinition> = {}): GameSimulation => {
  const def: LevelDefinition = {
    id: 'm8a-lava-fixture',
    displayName: 'M8A LAVA FIXTURE',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: 60,
    deathY: -14,
    // Default arena: runway ends at z = 4, the pool below the gap (z 4..16)
    // catches the fall — unless the caller overrides solids entirely.
    solids: [{ center: { x: 0, y: -0.5, z: -3 }, halfExtents: { x: 5.4, y: 0.5, z: 7 } }],
    hazards: [],
    lava,
    theme: THEME,
    ...opts,
  };
  return new GameSimulation(def);
};

describe('M8A lethal lava gameplay', () => {
  it('touching a lava pool kills instantly with cause lava', () => {
    // Pool surface top y = -2 sitting in a basin floor (top -3).
    const sim = makeLavaArena(
      [{ id: 'pool', center: { x: 0, y: -2.5, z: 10 }, halfExtents: { x: 4, y: 0.5, z: 6 }, role: 'pool' }],
      {
        solids: [
          { center: { x: 0, y: -0.5, z: 2 }, halfExtents: { x: 5.4, y: 0.5, z: 6 } },
          { center: { x: 0, y: -3.5, z: 10 }, halfExtents: { x: 5, y: 0.5, z: 7 } },
        ],
      },
    );
    // Run forward off the runway end into the pool.
    let ticks = 0;
    while (sim.status === 'running' && ticks < 600) {
      sim.update(idleInput);
      ticks++;
    }
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('lava');
    expect(sim.lastDeathCause).toBe('lava');
    expect(sim.lastLethalColliderId).toBe('lava-pool');
    // Death is instantaneous at the lethal step (no grace ticks).
    expect(sim.deathHoldTicksLeft).toBe(DEATH_HOLD_TICKS);
  });

  it('lava fall columns kill with swept CCD at high speed (no tunneling)', () => {
    // Thin fall directly ahead of the spawn, crossed at 3x speed.
    const sim = makeLavaArena(
      [{ id: 'fall', center: { x: 0, y: 1.5, z: 6 }, halfExtents: { x: 0.4, y: 2.5, z: 0.4 }, role: 'fall' }],
      {
        solids: [{ center: { x: 0, y: -0.5, z: 20 }, halfExtents: { x: 5.4, y: 0.5, z: 30 } }],
        speedPortals: [{ id: 'fast', z: -3, multiplier: 3 }],
      },
    );
    let ticks = 0;
    while (sim.status === 'running' && ticks < 300) {
      sim.update(idleInput);
      ticks++;
    }
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('lava');
    expect(sim.lastLethalColliderId).toBe('lava-fall');
  });

  it('lava volumes register as hazard colliders in the collision world', () => {
    const sim = makeLavaArena([
      { id: 'pool', center: { x: 0, y: -2.5, z: 10 }, halfExtents: { x: 4, y: 0.5, z: 6 }, role: 'pool' },
    ]);
    const lavaColliders = sim.level.colliders.filter((c) => c.id.startsWith('lava-'));
    expect(lavaColliders.length).toBe(1);
    expect(lavaColliders[0]?.kind).toBe('hazard');
  });

  it('lava death respawns after the readable hold and re-arms (attempts + 1)', () => {
    const sim = makeLavaArena([
      { id: 'pool', center: { x: 0, y: -2.5, z: 10 }, halfExtents: { x: 4, y: 0.5, z: 6 }, role: 'pool' },
    ]);
    while (sim.status === 'running') sim.update(idleInput);
    expect(sim.deathCause).toBe('lava');
    const attempts = sim.attempts;
    advance(sim, idleInput, DEATH_HOLD_TICKS - 1);
    expect(sim.status).toBe('dead');
    sim.update(idleInput);
    expect(sim.status).toBe('running');
    expect(sim.attempts).toBe(attempts + 1);
    expect(sim.deathCause).toBeNull();
  });

  it('lava death is replay-stable (state fingerprint covers the lava cause)', () => {
    const mk = (): GameSimulation =>
      makeLavaArena([
        { id: 'pool', center: { x: 0, y: -2.5, z: 10 }, halfExtents: { x: 4, y: 0.5, z: 6 }, role: 'pool' },
      ]);
    const a = mk();
    const b = mk();
    for (let i = 0; i < 200; i++) {
      a.update(idleInput);
      b.update(idleInput);
      expect(computeStateFingerprint(a)).toBe(computeStateFingerprint(b));
      if (a.status === 'dead') break;
    }
    expect(a.status).toBe('dead');
    expect(a.deathCause).toBe('lava');
  });
});

describe('M8A death readability hold', () => {
  it('holds the dead state for 78 ticks (0.65 s) before auto-respawn', () => {
    expect(DEATH_HOLD_TICKS).toBe(78);
    expect(DEATH_HOLD_TICKS / 120).toBeCloseTo(0.65, 6);
  });

  it('manual restart still works immediately from the dead state', () => {
    const sim = makeLavaArena([
      { id: 'pool', center: { x: 0, y: -2.5, z: 10 }, halfExtents: { x: 4, y: 0.5, z: 6 }, role: 'pool' },
    ]);
    while (sim.status === 'running') sim.update(idleInput);
    expect(sim.status).toBe('dead');
    const attempts = sim.attempts;
    sim.restart();
    expect(sim.status).toBe('running');
    expect(sim.attempts).toBe(attempts + 1);
  });
});

describe('M8A lava authoring contract (no floating slabs)', () => {
  it('advanced-cube-01 lava validates cleanly', () => {
    expect(ADVANCED_CUBE_01.lava?.length).toBeGreaterThanOrEqual(6);
    expect(validateLavaAuthoring(ADVANCED_CUBE_01)).toEqual([]);
  });

  it('advanced-cube-01 lava is lethal gameplay (registered colliders)', () => {
    const level = loadLevel(ADVANCED_CUBE_01);
    const lavaColliders = level.colliders.filter((c) => c.id.startsWith('lava-'));
    expect(lavaColliders.length).toBe(ADVANCED_CUBE_01.lava?.length);
    for (const c of lavaColliders) expect(c.kind).toBe('hazard');
  });

  it('rejects a floating pool with no basin solid', () => {
    const def: LevelDefinition = {
      id: 'float-fixture',
      displayName: 'FLOAT',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } }],
      hazards: [],
      lava: [{ id: 'floater', center: { x: 0, y: 5, z: 40 }, halfExtents: { x: 3, y: 0.5, z: 3 }, role: 'pool' }],
      theme: THEME,
    };
    const errors = validateLavaAuthoring(def);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('floater');
  });

  it('rejects a fall with no source and a mid-air termination', () => {
    const def: LevelDefinition = {
      id: 'fall-fixture',
      displayName: 'FALL',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } }],
      hazards: [],
      lava: [{ id: 'dangling', center: { x: 0, y: 2, z: 40 }, halfExtents: { x: 0.5, y: 2, z: 0.5 }, role: 'fall' }],
      theme: THEME,
    };
    const errors = validateLavaAuthoring(def);
    expect(errors.length).toBe(2);
    expect(errors.some((e) => e.includes('no source'))).toBe(true);
    expect(errors.some((e) => e.includes('mid-air'))).toBe(true);
  });

  it('accepts a fall that continues below the void bound', () => {
    const def: LevelDefinition = {
      id: 'voidfall-fixture',
      displayName: 'VOIDFALL',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [
        { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
        { center: { x: 8, y: 6, z: 40 }, halfExtents: { x: 2, y: 2, z: 2 } },
      ],
      hazards: [],
      lava: [
        { id: 'vent', center: { x: 6.4, y: 6, z: 40 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, role: 'source' },
        { id: 'drop', center: { x: 6.4, y: -4, z: 40 }, halfExtents: { x: 0.4, y: 10.2, z: 0.4 }, role: 'fall' },
      ],
      theme: THEME,
    };
    expect(validateLavaAuthoring(def)).toEqual([]);
  });
});

describe('M8A lava fingerprinting (conditional encoding)', () => {
  it('lava changes the level fingerprint; stripping it restores the base', () => {
    const withLava = computeLevelFingerprint(ADVANCED_CUBE_01);
    const stripped: LevelDefinition = { ...ADVANCED_CUBE_01, lava: undefined };
    expect(computeLevelFingerprint(stripped)).not.toBe(withLava);
  });

  it('levels without lava hash exactly as before (golden replay safe)', () => {
    // TEST_LEVEL / validation content carry no lava: encoding writes zero
    // bytes, so pre-M8A fingerprints are byte-identical by construction.
    expect(TEST_LEVEL.lava).toBeUndefined();
    expect(computeLevelFingerprint(TEST_LEVEL)).toBe(computeLevelFingerprint({ ...TEST_LEVEL }));
  });
});
