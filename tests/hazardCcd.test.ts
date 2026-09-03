import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { CollisionWorld } from '../src/collision/CollisionWorld';
import { moveAabbThroughWorld, createMoveResult } from '../src/collision/moveAabb';
import {
  aabbOverlap,
  createSweptPathScratch,
  sweptPathOverlaps,
  type Aabb,
} from '../src/collision/collider';
import { vec3, cloneVec3, type Vec3 } from '../src/core/math';
import { CUBE_TUNING } from '../src/player/cubeTuning';
import { idleInput } from './helpers/simulation';

/**
 * M2.1 hazard CCD fairness suite. The hazard kill test must follow the
 * AUTHORITATIVE axis-separated path (Y → Z → X, exactly as
 * `moveAabbThroughWorld` clips it) — the swept volume of a single-axis
 * segment is exactly the envelope of its two endpoint cubes, so the union of
 * the three segment boxes is the exact path volume. The previous algorithm
 * tested one loose pre/post-step union rectangle, whose corner regions are
 * NEVER visited whenever two axes move in the same step — a false kill.
 *
 * Geometry below uses large per-step deltas (collision-unit level, like 4×
 * speed-portal displacement) to make the corner regions unambiguous.
 */

const HALF = CUBE_TUNING.colliderSize / 2;
const halfVec = vec3(HALF, HALF, HALF);

interface StepOutcome {
  final: Vec3;
  afterY: Vec3;
  afterZ: Vec3;
  /** Hazard hit under the CURRENT exact swept-path algorithm. */
  hit: boolean;
  /** Hazard hit under the OLD loose pre/post union rectangle (for regression
   *  documentation: proves the fixture really is the old false-positive). */
  looseHit: boolean;
}

/** Drive ONE authoritative step through `world` from `prev` by `delta` and
 *  evaluate both the exact swept-path test and the old loose-union test. */
const runStep = (
  world: CollisionWorld,
  prev: Readonly<Vec3>,
  delta: Readonly<Vec3>,
  hazard: Readonly<Aabb>,
): StepOutcome => {
  const pos = vec3(prev.x, prev.y, prev.z);
  const result = createMoveResult();
  moveAabbThroughWorld(world, pos, halfVec, delta, result);
  const looseBox = {
    minX: Math.min(prev.x, pos.x) - halfVec.x,
    maxX: Math.max(prev.x, pos.x) + halfVec.x,
    minY: Math.min(prev.y, pos.y) - halfVec.y,
    maxY: Math.max(prev.y, pos.y) + halfVec.y,
    minZ: Math.min(prev.z, pos.z) - halfVec.z,
    maxZ: Math.max(prev.z, pos.z) + halfVec.z,
  };
  return {
    final: cloneVec3(pos),
    afterY: cloneVec3(result.positionAfterY),
    afterZ: cloneVec3(result.positionAfterZ),
    hit: sweptPathOverlaps(
      createSweptPathScratch(),
      prev,
      result.positionAfterY,
      result.positionAfterZ,
      pos,
      halfVec,
      hazard,
    ),
    looseHit: aabbOverlap(looseBox, hazard),
  };
};

const worldWithHazard = (center: Readonly<Vec3>, half: Readonly<Vec3>): CollisionWorld => {
  const world = new CollisionWorld(8);
  world.add({
    id: 'hazard-1',
    kind: 'hazard',
    center: vec3(center.x, center.y, center.z),
    halfExtents: vec3(half.x, half.y, half.z),
  });
  return world;
};

describe('hazard CCD — false-positive regression (loose union corner)', () => {
  it('corner slab: large +Y then +X step does NOT kill a hazard the path never enters', () => {
    // Path: (0,0,0) -> Y -> (0,3,0) -> Z (no motion) -> X -> (3,3,0).
    // Old loose union rectangle: x [-0.55, 3.55] x y [-0.55, 3.55].
    // The never-visited corner slab is x [0.55, 3.55] x y [-0.55, 2.45].
    // The hazard sits fully inside that slab.
    const hazard = {
      minX: 1.7,
      maxX: 2.3,
      minY: 0.7,
      maxY: 1.3,
      minZ: -0.3,
      maxZ: 0.3,
    };
    const world = worldWithHazard(vec3(2, 1, 0), vec3(0.3, 0.3, 0.3));
    const step = runStep(world, vec3(0, 0, 0), vec3(3, 3, 0), hazard);

    // The old algorithm DID kill here — this is the regression being pinned.
    expect(step.looseHit).toBe(true);
    // The authoritative path never enters the corner slab: survive.
    expect(step.hit).toBe(false);
    expect(step.afterY.x).toBe(0); // X motion happens strictly after Y
    expect(step.afterY.y).toBeCloseTo(3, 10);
    expect(step.final.x).toBeCloseTo(3, 10);
  });

  it('corner slab: lateral change during forward motion (+X during +Z) survives', () => {
    // Path: (0,0,0) -> Y (no motion) -> Z -> (0,0,6) -> X -> (3,0,6).
    // Corner slab: x [0.55, 3.55] x z [-0.55, 5.45] — hazard inside it.
    const hazard = {
      minX: 1.7,
      maxX: 2.3,
      minY: -0.5,
      maxY: 0.5,
      minZ: 1.7,
      maxZ: 2.3,
    };
    const world = worldWithHazard(vec3(2, 0, 2), vec3(0.3, 0.5, 0.3));
    const step = runStep(world, vec3(0, 0, 0), vec3(3, 0, 6), hazard);

    expect(step.looseHit).toBe(true);
    expect(step.hit).toBe(false);
  });

  it('clipped path: hazard below a floor that stops the fall does NOT kill', () => {
    // Fall of -6 is clipped by a floor with its top at y = 1 (player center
    // stops at 1.55). A hazard under the floor overlaps the UNCLIPPED union
    // rectangle but not the authoritative (clipped) swept path.
    const world = new CollisionWorld(8);
    world.add({
      id: 'floor',
      kind: 'solid',
      center: vec3(5, 0.5, 0),
      halfExtents: vec3(6, 0.5, 5),
    });
    world.add({
      id: 'hazard-1',
      kind: 'hazard',
      center: vec3(0, -1, 0),
      halfExtents: vec3(0.3, 0.3, 0.3),
    });
    const hazard: Aabb = { minX: -0.3, maxX: 0.3, minY: -1.3, maxY: -0.7, minZ: -0.3, maxZ: 0.3 };
    const step = runStep(world, vec3(0, 3, 0), vec3(0, -6, 0), hazard);

    expect(step.afterY.y).toBeCloseTo(1 + HALF, 10); // Y motion was clipped
    // An UNCLIPPED swept segment (falling the full -6) would span
    // y [-3.55, 3.55] and hit the hazard — the authoritative path must be
    // built from the clipped intermediate, which this asserts implicitly:
    // the exact test survives because the Y segment stops at the floor.
    const unclippedYBox = {
      minX: -HALF,
      maxX: HALF,
      minY: -3 - HALF,
      maxY: 3 + HALF,
      minZ: -HALF,
      maxZ: HALF,
    };
    expect(aabbOverlap(unclippedYBox, hazard)).toBe(true);
    expect(step.hit).toBe(false);
  });
});

describe('hazard CCD — true positives (continuous sweep)', () => {
  it('high-speed forward pass through a thin hazard kills (no tunneling)', () => {
    // 4x-equivalent per-step displacement straight over a z~0.1 hazard:
    // neither endpoint cube touches it — only the swept segment does.
    const hazard = {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
      minZ: 1.95,
      maxZ: 2.05,
    };
    const world = worldWithHazard(vec3(0, 0, 2), vec3(1, 1, 0.05));
    const step = runStep(world, vec3(0, 0, 0), vec3(0, 0, 4), hazard);
    expect(step.hit).toBe(true);
    expect(step.final.z).toBeCloseTo(4, 10); // hazard never blocked the motion
  });

  it('diagonal path whose actual swept way (Y then X) meets the hazard kills', () => {
    // Falling (-Y) while changing lanes (+X). The hazard is met mid-fall,
    // before any lateral motion: only the Y segment box contains it.
    const hazard = {
      minX: -0.2,
      maxX: 0.2,
      minY: -2.2,
      maxY: -1.8,
      minZ: -0.3,
      maxZ: 0.3,
    };
    const world = worldWithHazard(vec3(0, -2, 0), vec3(0.2, 0.2, 0.3));
    const step = runStep(world, vec3(0, 0, 0), vec3(3, -3, 0), hazard);
    expect(step.hit).toBe(true);
  });

  it('start overlap kills (hazard inside the cube before the step)', () => {
    const hazard = {
      minX: -0.3,
      maxX: 0.3,
      minY: 0,
      maxY: 0.6,
      minZ: -0.3,
      maxZ: 0.3,
    };
    const world = worldWithHazard(vec3(0, 0.3, 0), vec3(0.3, 0.3, 0.3));
    const step = runStep(world, vec3(0, 0, 0), vec3(0, 3, 0), hazard);
    expect(step.hit).toBe(true);
    // Sanity: the FINAL cube is far from the hazard — the kill comes from
    // the start of the path (Y segment includes the pre-step cube).
    expect(step.final.y).toBeCloseTo(3, 10);
  });

  it('end overlap kills (hazard inside the cube after the step)', () => {
    const hazard = {
      minX: -0.3,
      maxX: 0.3,
      minY: -0.3,
      maxY: 0.3,
      minZ: 2.7,
      maxZ: 3.3,
    };
    const world = worldWithHazard(vec3(0, 0, 3), vec3(0.3, 0.3, 0.3));
    const step = runStep(world, vec3(0, 0, 0), vec3(0, 0, 3), hazard);
    expect(step.hit).toBe(true);
    // Sanity: the START cube is far from the hazard.
    expect(step.afterY.z).toBe(0);
  });
});

describe('hazard CCD — simulation integration', () => {
  const FAST_SPEED = 56; // 4x the Test Level base speed — level DATA, not tuning
  const makeFastSim = (): GameSimulation => {
    const def: LevelDefinition = {
      id: 'm2-hazard-ccd-fixture',
      displayName: 'HAZARD CCD FIXTURE',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...TEST_LEVEL.laneCenters],
      baseForwardSpeed: FAST_SPEED,
      finishZ: 60,
      deathY: -14,
      solids: [{ center: { x: 0, y: -0.5, z: 20 }, halfExtents: { x: 5.4, y: 0.5, z: 30 } }],
      hazards: [
        {
          kind: 'hazard',
          visual: 'spike',
          center: { x: 0, y: 0.25, z: 10 },
          halfExtents: { x: 2, y: 0.25, z: 0.05 },
        },
      ],
      theme: TEST_LEVEL.theme,
    };
    return new GameSimulation(def);
  };

  const runUntilDead = (sim: GameSimulation, budget = 600): number => {
    let steps = 0;
    while (sim.status === 'running' && steps < budget) {
      sim.update(idleInput);
      steps++;
    }
    return steps;
  };

  it('a 4x-speed runner through a z-thin hazard dies with cause hazard (deterministic)', () => {
    const a = makeFastSim();
    const stepsA = runUntilDead(a);
    expect(a.status).toBe('dead');
    expect(a.deathCause).toBe('hazard');
    expect(a.lastLethalColliderId).toBe('hazard-1');
    expect(stepsA).toBeLessThan(600);
    // Run it twice: identical death step.
    const b = makeFastSim();
    const stepsB = runUntilDead(b);
    expect(stepsB).toBe(stepsA);
    expect(b.deathCause).toBe('hazard');
  });
});
