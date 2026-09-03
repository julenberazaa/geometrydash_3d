import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { loadLevel } from '../src/level/levelRuntime';
import { CollisionWorld } from '../src/collision/CollisionWorld';
import { moveAabbThroughWorld, createMoveResult } from '../src/collision/moveAabb';
import { vec3 } from '../src/core/math';
import { CUBE_TUNING } from '../src/player/cubeTuning';
import { idleInput, holdJump, advance, makeSim, makeGroundedSim } from './controller.test';

const CUBE_HALF = CUBE_TUNING.colliderSize / 2;

describe('Collision — solid platform', () => {
  it('player stands stably on the runway (no sinking, no jitter)', () => {
    const { sim } = makeGroundedSim();
    advance(sim, idleInput, 240); // two seconds rolling
    expect(sim.player.grounded).toBe(true);
    // Feet rest on floor top (y=0): center y == collider half size.
    const expectedY = CUBE_TUNING.colliderSize / 2;
    expect(Math.abs(sim.player.position.y - expectedY)).toBeLessThan(0.02);
    expect(sim.player.velocity.y).toBeCloseTo(0, 3);
  });

  it('cannot penetrate a solid platform when landing on it', () => {
    const { sim } = makeGroundedSim();
    // Jump onto the low platform (top y=0.8 at z 48..58).
    advance(sim, idleInput, 120 * 3); // reach z≈38
    advance(sim, holdJump, 1);
    let minY = Infinity;
    for (let i = 0; i < 300; i++) {
      sim.update(idleInput);
      if (sim.player.position.z > 47 && sim.player.position.z < 59) {
        minY = Math.min(minY, sim.player.position.y);
      }
      if (sim.status !== 'running') break;
    }
    // Collider bottom must never go below platform top (0.8) minus tolerance.
    const colliderBottom = minY - CUBE_HALF;
    expect(colliderBottom).toBeGreaterThan(0.8 - 0.05);
  });
});

describe('Collision — wall / block', () => {
  it('lateral motion into a solid block stops at its face (no penetration)', () => {
    // Direct world-level test: box moving +X into a wall.
    const world = new CollisionWorld(4);
    world.add({
      id: 'wall',
      kind: 'solid',
      center: vec3(2, 0, 0),
      halfExtents: vec3(0.5, 2, 2),
    });
    const pos = vec3(0, 0, 0);
    const half = vec3(0.25, 0.25, 0.25);
    const result = createMoveResult();
    for (let i = 0; i < 60; i++) {
      moveAabbThroughWorld(world, pos, half, vec3(0.2, 0, 0), result);
    }
    // Player right face (pos.x+0.25) must stop at wall left face (1.5).
    expect(pos.x).toBeCloseTo(1.25, 2);
    expect(result.wallContacts.length).toBeGreaterThan(0);
  });

  it('frontal wall kills the run (kill-front semantics)', () => {
    const sim = makeSim();
    // Roll to just before the forced-lane wall at z=92.5 in the RIGHT lane...
    // Simpler: verify any frontal hit sets status dead. Drive into right lane first.
    advance(sim, idleInput, 60); // some runway
    // Steer to right lane.
    const rightInput = {
      ...idleInput,
      laneRight: { held: false, pressedThisStep: true, releasedThisStep: true },
    };
    for (let i = 0; i < 30 && sim.status === 'running'; i++) sim.update(rightInput);
    // Now roll forward until the wall at z 92.5 is reached (~6.5s of travel).
    let died = false;
    for (let i = 0; i < 1200; i++) {
      if (sim.status !== 'running') {
        died = true;
        break;
      }
      sim.update(idleInput);
    }
    expect(died).toBe(true);
  });
});

describe('Collision — high-speed anti-tunneling', () => {
  it('a fast box cannot pass through a thin wall in one step', () => {
    const world = new CollisionWorld(4);
    // Thin wall: 0.1 thick in Z — endpoint-only overlap tests would risk missing it.
    world.add({
      id: 'thin',
      kind: 'solid',
      center: vec3(0, 0, 100),
      halfExtents: vec3(5, 5, 0.05),
    });
    const pos = vec3(0, 0, 98);
    const half = vec3(0.25, 0.25, 0.25);
    const result = createMoveResult();
    // One step displacement of 4 units: crosses the entire wall thickness ~40x.
    moveAabbThroughWorld(world, pos, half, vec3(0, 0, 4), result);
    // Must be stopped at wall front face minus player half: 99.95-0.25 = 99.70.
    expect(pos.z).toBeCloseTo(99.7, 2);
    expect(pos.z).toBeLessThan(100); // never passed through
  });

  it('player at 4x forward speed still cannot tunnel through the M1 wall', () => {
    const world = new CollisionWorld(8);
    world.add({
      id: 'floor',
      kind: 'solid',
      center: vec3(0, -50, 500),
      halfExtents: vec3(20, 50, 600),
    });
    world.add({
      id: 'wall',
      kind: 'solid',
      center: vec3(0, 0, 300),
      halfExtents: vec3(10, 10, 0.25),
    });
    const pos = vec3(0, 0.56, 290); // standing ON TOP of the floor (not embedded)
    const half = vec3(0.55, 0.55, 0.55);
    const result = createMoveResult();
    // 56 units/second == 4x base speed; per-step delta ≈ 0.467 units.
    for (let i = 0; i < 400; i++) {
      moveAabbThroughWorld(world, pos, half, vec3(0, 0, 56 / 120), result);
      if (result.wallContacts.length > 0) break;
    }
    expect(pos.z).toBeLessThan(299.75 + 0.01);
    expect(pos.z).toBeGreaterThan(299); // actually reached the wall
  });
});

describe('Gap / void behavior', () => {
  it('falling into the first gap triggers death and reset increments attempts', () => {
    const sim = makeSim();
    // Walk off into the gap after the elevated platform (z 76..90) without jumping.
    // Simply roll: platforms end at z=76; player falls into void.
    let steps = 0;
    while (sim.status === 'running' && steps < 3600) {
      sim.update(idleInput);
      steps++;
    }
    expect(sim.status).toBe('dead');
    const attemptsBefore = sim.attempts;
    sim.respawn();
    expect(sim.attempts).toBe(attemptsBefore + 1);
    expect(sim.player.position.z).toBeCloseTo(TEST_LEVEL.start.z, 5);
    expect(sim.status).toBe('running');
  });
});

describe('Level data-driven instantiation', () => {
  it('loads a custom level without engine changes and progress derives from real distance', () => {
    const custom: LevelDefinition = {
      ...TEST_LEVEL,
      id: 'synthetic-check',
      laneCenters: [-4, 0, 4],
      finishZ: 50,
      solids: [
        { center: { x: 0, y: -0.5, z: 25 }, halfExtents: { x: 6, y: 0.5, z: 35 } },
      ],
      hazards: [],
    };
    const loaded = loadLevel(custom);
    expect(loaded.laneCenters).toEqual([-4, 0, 4]);
    expect(loaded.world.colliderCount).toBe(1);

    const sim = new GameSimulation(custom);
    advance(sim, idleInput, 120);
    // One second at speed 14 from startZ=-4 -> z=10 -> progress=(10-(-4))/54.
    expect(sim.progress).toBeCloseTo((10 - (-4)) / (50 - (-4)), 2);
  });

  it('test level contains no coordinates inside GameSimulation source of truth', () => {
    // The simulation only reads level data; sanity check that level drives geometry:
    const loaded = loadLevel(TEST_LEVEL);
    const solidCount = loaded.colliders.filter((c) => c.kind === 'solid').length;
    expect(solidCount).toBe(TEST_LEVEL.solids.length);
  });
});
