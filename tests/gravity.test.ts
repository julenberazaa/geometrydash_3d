import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { GameplayFrame } from '../src/player/gameplayFrame';
import type { LevelDefinition } from '../src/level/levelDefinition';
import type { PhysicalInputSnapshot } from '../src/input/InputSystem';
import { interpretPhysicalInput } from '../src/input/InputSystem';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { idleInput, tapLaneLeft, tapLaneRight } from './helpers/simulation';

/**
 * M3 gravity suite: gameplay frames, portals, ceiling support/movement, void
 * bounds, precedence and determinism. Floor behavior is pinned separately by
 * tests/floorCompat.test.ts (exact-float golden trajectories) and the
 * pre-existing suites, which stay green unmodified.
 */

/** Compact data-driven gravity playground (never hardcoded in the engine). */
const GRAVITY_LEVEL: LevelDefinition = {
  id: 'gravity-test-01',
  displayName: 'GRAVITY TEST 01',
  start: { x: 0, y: 1.5, z: 0 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 14,
  finishZ: 300,
  deathY: -14,
  deathYMax: 14,
  startGravityMode: 'floor',
  gravityPortals: [
    { id: 'up-1', z: 20, target: 'ceiling' },
    { id: 'down-1', z: 80, target: 'floor' },
  ],
  solids: [
    // Floor runway top y=0, z -10..130
    { center: { x: 0, y: -0.5, z: 60 }, halfExtents: { x: 5.4, y: 0.5, z: 70 } },
    // Ceiling slab underside y=6, z 20..90 (starts at the portal plane so the
    // rising Cube lands on the underside instead of overshooting past it)
    { center: { x: 0, y: 7, z: 55 }, halfExtents: { x: 5.4, y: 1, z: 35 } },
  ],
  hazards: [],
  theme: {
    background: 0x07040f,
    fogColor: 0x140b26,
    fogNear: 30,
    fogFar: 130,
    platform: 0x17122a,
    platformTop: 0x241b42,
    edge: 0xb44dff,
    hazard: 0xff9d00,
  },
};

/** Level whose START is on the ceiling (level-defined start gravity). */
const CEILING_START_LEVEL: LevelDefinition = {
  ...GRAVITY_LEVEL,
  id: 'gravity-test-ceiling-start',
  start: { x: 0, y: 5.0, z: 40 },
  startGravityMode: 'ceiling',
};

const makeGravitySim = (level: LevelDefinition = GRAVITY_LEVEL): GameSimulation =>
  new GameSimulation(level);

const runUntil = (
  sim: GameSimulation,
  predicate: () => boolean,
  maxSteps = 1200,
): boolean => {
  for (let i = 0; i < maxSteps; i++) {
    sim.update(idleInput);
    if (predicate()) return true;
  }
  return false;
};

const settleFloor = (sim: GameSimulation): void => {
  expect(runUntil(sim, () => sim.player.grounded)).toBe(true);
};

const settleCeiling = (sim: GameSimulation): void => {
  expect(
    runUntil(sim, () => sim.player.grounded && sim.gravityMode === 'ceiling'),
  ).toBe(true);
};

const tapRight = (): PhysicalInputSnapshot => ({
  ...idleInput,
  laneRight: { held: false, pressedThisStep: true, releasedThisStep: true },
});

const tapLeft = (): PhysicalInputSnapshot => ({
  ...idleInput,
  laneLeft: { held: false, pressedThisStep: true, releasedThisStep: true },
});

const holdDown = (): PhysicalInputSnapshot => ({ ...idleInput, down: { held: true, pressedThisStep: true, releasedThisStep: false } });
const holdUp = (): PhysicalInputSnapshot => ({ ...idleInput, up: { held: true, pressedThisStep: true, releasedThisStep: false } });
const holdSpace = (): PhysicalInputSnapshot => ({ ...idleInput, space: { held: true, pressedThisStep: true, releasedThisStep: false } });

describe('GameplayFrame data (explicit, never cross-product-derived)', () => {
  it('Floor frame: gravity -Y, surfaceNormal +Y, laneAxis -X, forward +Z', () => {
    const f = GameplayFrame.floor();
    expect(f.gravityVector.y).toBe(-1);
    expect(f.surfaceNormal.y).toBe(1);
    expect(f.laneAxis.x).toBe(-1);
    expect(f.forwardAxis.z).toBe(1);
    // Zero components (including negated zeros) are all zero-valued.
    expect(Math.abs(f.gravityVector.x) + Math.abs(f.gravityVector.z)).toBe(0);
    expect(Math.abs(f.surfaceNormal.x) + Math.abs(f.surfaceNormal.z)).toBe(0);
    expect(Math.abs(f.laneAxis.y) + Math.abs(f.laneAxis.z)).toBe(0);
    expect(Math.abs(f.forwardAxis.x) + Math.abs(f.forwardAxis.y)).toBe(0);
  });

  it('Ceiling frame: gravity +Y, surfaceNormal -Y, SAME laneAxis -X and forward +Z', () => {
    const f = GameplayFrame.ceiling();
    expect(f.gravityVector.y).toBe(1);
    expect(f.surfaceNormal.y).toBe(-1);
    // Gravity flip must NEVER mirror lanes: laneAxis stays -X.
    expect(f.laneAxis.x).toBe(-1);
    expect(f.forwardAxis.z).toBe(1);
    expect(Math.abs(f.gravityVector.x) + Math.abs(f.gravityVector.z)).toBe(0);
    expect(Math.abs(f.surfaceNormal.x) + Math.abs(f.surfaceNormal.z)).toBe(0);
    expect(Math.abs(f.laneAxis.y) + Math.abs(f.laneAxis.z)).toBe(0);
    expect(Math.abs(f.forwardAxis.x) + Math.abs(f.forwardAxis.y)).toBe(0);
  });

  it('interpretPhysicalInput: Floor Up/Space jump + Down fast-fall (unchanged)', () => {
    const phys: PhysicalInputSnapshot = {
      space: { held: true, pressedThisStep: true, releasedThisStep: false },
      up: { held: false, pressedThisStep: false, releasedThisStep: false },
      down: { held: true, pressedThisStep: false, releasedThisStep: false },
      laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
      laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
    };
    const logical = interpretPhysicalInput(phys, 'floor');
    expect(logical.jump.held).toBe(true);
    expect(logical.fastFall.held).toBe(true);
  });

  it('interpretPhysicalInput: Ceiling Down/Space jump + Up fast-fall (reversed arrows)', () => {
    const phys: PhysicalInputSnapshot = {
      space: { held: false, pressedThisStep: false, releasedThisStep: false },
      up: { held: true, pressedThisStep: false, releasedThisStep: false },
      down: { held: true, pressedThisStep: true, releasedThisStep: false },
      laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
      laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
    };
    const logical = interpretPhysicalInput(phys, 'ceiling');
    expect(logical.jump.held).toBe(true); // Down jumps on ceiling
    expect(logical.jump.pressedThisStep).toBe(true);
    expect(logical.fastFall.held).toBe(true); // Up fast-falls on ceiling
  });
});

describe('Gravity portal transitions', () => {
  it('Floor -> Ceiling: triggers exactly once, preserves position and velocity, clears support', () => {
    const sim = makeGravitySim();
    settleFloor(sim);
    // Lateral motion to verify it survives the flip: tap right shortly before
    // the plane so the maneuver is still in flight at the crossing.
    expect(runUntil(sim, () => sim.player.position.z > 17, 600)).toBe(true);
    sim.update(tapRight());
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling', 600)).toBe(true);
    // The crossing step itself: portal z=20 lies in (prevZ, currentZ].
    expect(sim.player.position.z).toBeGreaterThanOrEqual(20);
    expect(sim.player.position.z).toBeLessThan(20.2);
    expect(sim.player.gravityMode).toBe('ceiling');
    expect(sim.lastPortalId).toBe('up-1');
    expect(sim.portalTransitionCount).toBe(1);
    // Grounding ran BEFORE portal processing this step, so the transition
    // cleared support and vertical velocity is still at rest this step.
    expect(sim.player.grounded).toBe(false);
    expect(sim.player.supportColliderId).toBeNull();
    // Forward + lateral velocity preserved; no jump impulse injected.
    expect(sim.player.velocity.z).toBe(14);
    expect(sim.player.velocity.y).toBe(0);
    expect(sim.player.velocity.x).toBeLessThan(0); // right tap survived the flip
    // No further transitions while the plane stays behind (run well past it).
    for (let i = 0; i < 300; i++) sim.update(idleInput);
    expect(sim.portalTransitionCount).toBe(1);
  });

  it('Ceiling -> Floor: triggers exactly once and the Cube falls back to the floor', () => {
    const sim = makeGravitySim();
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(sim);
    const flipsAfterUp = sim.portalTransitionCount;
    expect(runUntil(sim, () => sim.gravityMode === 'floor', 1200)).toBe(true);
    expect(sim.lastPortalId).toBe('down-1');
    expect(sim.portalTransitionCount).toBe(flipsAfterUp + 1);
    // Falls physically (positive downward speed) rather than snapping.
    let sawDownwardMotion = false;
    for (let i = 0; i < 200 && !sim.player.grounded; i++) {
      sim.update(idleInput);
      if (sim.player.velocity.y < -1) sawDownwardMotion = true;
    }
    expect(sawDownwardMotion).toBe(true);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.position.y).toBeCloseTo(0.55, 2);
  });

  it('Deterministic: identical input/portal sequences produce identical trajectories', () => {
    const script = (sim: GameSimulation): number[] => {
      const marks: number[] = [];
      for (let t = 0; t < 1400; t++) {
        sim.update(t === 5 ? tapRight() : idleInput);
        if (t % 100 === 0) {
          const p = sim.player.position;
          marks.push(p.x, p.y, p.z);
        }
      }
      return marks;
    };
    const a = script(makeGravitySim());
    const b = script(makeGravitySim());
    expect(b).toEqual(a);
  });
});

describe('Ceiling physics', () => {
  it('Ceiling gravity accelerates the Cube upward after the flip', () => {
    const sim = makeGravitySim();
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    let sawUpwardVelocity = false;
    for (let i = 0; i < 60; i++) {
      sim.update(idleInput);
      if (sim.player.velocity.y > 1) sawUpwardVelocity = true;
    }
    expect(sawUpwardVelocity).toBe(true);
  });

  it('Ceiling support: clips at the underside, grounds, and stays stably grounded', () => {
    const sim = makeGravitySim();
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(sim);
    for (let i = 0; i < 10; i++) sim.update(idleInput); // settle into full contact
    expect(sim.player.position.y).toBeCloseTo(5.45, 3); // underside 6 - half 0.55
    expect(sim.player.supportColliderId).toContain('solid');
    // No grounded/airborne vibration over a full second of ceiling running.
    let airborneTicks = 0;
    for (let i = 0; i < 120; i++) {
      sim.update(idleInput);
      if (!sim.player.grounded) airborneTicks++;
    }
    expect(airborneTicks).toBe(0);
    expect(sim.player.velocity.y).toBeCloseTo(0, 4);
  });

  it('Ceiling jump via ArrowDown and via Space; grounded ArrowUp does NOT jump', () => {
    const jumpSpeed = (key: 'down' | 'space'): number => {
      const sim = makeGravitySim();
      settleFloor(sim);
      expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
      settleCeiling(sim);
      sim.update(key === 'down' ? holdDown() : holdSpace());
      const vy = sim.player.velocity.y;
      settleCeilingAfterJump(sim);
      return vy;
    };
    const settleCeilingAfterJump = (sim: GameSimulation): void => {
      expect(runUntil(sim, () => sim.player.grounded, 600)).toBe(true);
    };
    expect(jumpSpeed('down')).toBeCloseTo(-13.2, 3);
    expect(jumpSpeed('space')).toBeCloseTo(-13.2, 3);

    // ArrowUp grounded on the ceiling: no jump (it is the fast-fall key there).
    const sim = makeGravitySim();
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(sim);
    sim.update(holdUp());
    expect(sim.player.velocity.y).toBeCloseTo(0, 4);
    expect(sim.player.grounded).toBe(true);
  });

  it('Ceiling hold-to-repeat re-jumps after every landing', () => {
    let jumps = 0;
    const counting = new GameSimulation(GRAVITY_LEVEL, { onJump: () => jumps++ });
    settleFloor(counting);
    expect(runUntil(counting, () => counting.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(counting);
    for (let i = 0; i < 240; i++) counting.update(holdSpace());
    expect(jumps).toBeGreaterThanOrEqual(3);
  });

  it('Ceiling fast-fall: ArrowUp while airborne accelerates toward +Y', () => {
    const sim = makeGravitySim();
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(sim);
    sim.update(holdSpace()); // jump away from ceiling (downward)
    // Airborne now; holding Up must add +Y acceleration beyond plain gravity.
    for (let i = 0; i < 10; i++) sim.update(holdUp());
    const fastVy = sim.player.velocity.y;
    const sim2 = makeGravitySim();
    settleFloor(sim2);
    expect(runUntil(sim2, () => sim2.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(sim2);
    sim2.update(holdSpace());
    for (let i = 0; i < 10; i++) sim2.update(idleInput);
    const plainVy = sim2.player.velocity.y;
    expect(fastVy).toBeGreaterThan(plainVy);
    expect(fastVy - plainVy).toBeCloseTo(55 * 10 / 120, 1); // fastFallAcceleration
  });

  it('Lane screen convention unchanged on Ceiling: Right = screen-right (-X), Left = +X', () => {
    const sim = makeGravitySim();
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(sim);
    const before = sim.player.targetLaneIndex;
    sim.update(tapRight());
    expect(sim.player.targetLaneIndex).toBe(before + 1);
    expect(sim.player.velocity.x).toBeLessThan(0);
    // Let the outward maneuver complete (arrive + stabilize), then tap back.
    for (let i = 0; i < 200; i++) sim.update(idleInput);
    expect(Math.abs(sim.player.velocity.x)).toBeLessThan(0.01);
    sim.update(tapLeft());
    expect(sim.player.targetLaneIndex).toBe(before);
    expect(sim.player.velocity.x).toBeGreaterThan(0);
  });

  it('Airborne lane correction still works on Ceiling', () => {
    const sim = makeGravitySim();
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(sim);
    sim.update(holdSpace()); // airborne
    sim.update(tapRight());
    expect(sim.player.targetLaneIndex).toBe(2);
    // Velocity steers toward the new target while airborne (X motion, no snap).
    let movedInAir = false;
    for (let i = 0; i < 30 && !sim.player.grounded; i++) {
      const x0 = sim.player.position.x;
      sim.update(idleInput);
      if (Math.abs(sim.player.position.x - x0) > 0 && x0 > sim.player.position.x) movedInAir = true;
    }
    expect(movedInAir).toBe(true);
  });

  it('Ceiling lateral fall-off loses support physically, then dies at the UPPER void', () => {
    const sim = makeGravitySim();
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(sim);
    // Outward taps past the screen-right edge lane -> virtual lanes: edge,
    // teeter (still supported), then full exit.
    sim.update(tapRight());
    for (let i = 0; i < 40; i++) sim.update(idleInput);
    sim.update(tapRight());
    for (let i = 0; i < 40; i++) sim.update(idleInput);
    expect(sim.player.grounded).toBe(true); // teetering on the slab edge
    sim.update(tapRight());
    // Support loss must be physical: grounded drops, no instant side kill.
    expect(runUntil(sim, () => !sim.player.grounded, 300)).toBe(true);
    expect(sim.status).toBe('running');
    // Accelerates upward into the void, dies with cause void (never front/hazard).
    expect(runUntil(sim, () => sim.status === 'dead', 600)).toBe(true);
    expect(sim.deathCause).toBe('void');
    expect(sim.player.position.y).toBeGreaterThanOrEqual(13.9);
  });
});

describe('Void bounds and start gravity', () => {
  it('Lower void death unchanged (Floor fall)', () => {
    const sim = makeGravitySim({ ...GRAVITY_LEVEL, gravityPortals: [] });
    settleFloor(sim);
    // Push past the runway end and fall (forward motion carries it off the edge).
    expect(runUntil(sim, () => sim.status === 'dead', 2400)).toBe(true);
    expect(sim.deathCause).toBe('void');
    expect(sim.player.position.y).toBeLessThan(-13.9);
  });

  it('startGravityMode ceiling: level starts attached to the ceiling; respawn keeps it', () => {
    const sim = makeGravitySim(CEILING_START_LEVEL);
    expect(sim.gravityMode).toBe('ceiling');
    settleCeiling(sim);
    for (let i = 0; i < 10; i++) sim.update(idleInput);
    expect(sim.player.position.y).toBeCloseTo(5.45, 3);
    sim.restart();
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.lastPortalId).toBeNull();
    settleCeiling(sim);
  });

  it('Death from ceiling + respawn restores the level start gravity (floor)', () => {
    const sim = makeGravitySim();
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(sim);
    sim.update(tapRight());
    for (let i = 0; i < 40; i++) sim.update(idleInput);
    sim.update(tapRight());
    for (let i = 0; i < 40; i++) sim.update(idleInput);
    sim.update(tapRight());
    expect(runUntil(sim, () => sim.status === 'dead', 600)).toBe(true);
    // Auto-respawn after the 36-tick hold.
    expect(runUntil(sim, () => sim.player.grounded, 200)).toBe(true);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.player.gravityMode).toBe('floor');
    expect(sim.lastPortalId).toBeNull();
  });

  it('Manual R from ceiling restores floor start immediately', () => {
    const sim = makeGravitySim();
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(sim);
    sim.restart();
    expect(sim.gravityMode).toBe('floor');
    expect(sim.player.position.z).toBe(0);
    expect(sim.player.grounded).toBe(false);
    settleFloor(sim);
    for (let i = 0; i < 10; i++) sim.update(idleInput);
    expect(sim.player.position.y).toBeCloseTo(0.55, 3);
  });
});

describe('Precedence, hazards and frontal rule under both gravities', () => {
  /** Level where a hazard sits right on the up-portal plane. */
  const PORTAL_HAZARD_LEVEL: LevelDefinition = {
    ...GRAVITY_LEVEL,
    id: 'gravity-test-portal-hazard',
    gravityPortals: [{ id: 'up-1', z: 20.5, target: 'ceiling' }],
    hazards: [
      {
        kind: 'hazard',
        visual: 'spike',
        center: { x: 0, y: 0.3, z: 22 },
        halfExtents: { x: 5.4, y: 0.3, z: 0.5 },
      },
    ],
  };

  it('Lethal contact in a step is NOT undone by a gravity portal (death wins)', () => {
    const sim = makeGravitySim(PORTAL_HAZARD_LEVEL);
    settleFloor(sim);
    expect(runUntil(sim, () => sim.status === 'dead', 600)).toBe(true);
    expect(sim.deathCause).toBe('hazard');
    // The portal plane (z=20.5) was crossed on the way, but the death stands.
    expect(sim.player.position.z).toBeGreaterThanOrEqual(20);
    // Respawn resets the attempt cleanly to the start mode.
    expect(runUntil(sim, () => sim.player.grounded, 200)).toBe(true);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.player.position.z).toBeLessThan(5); // back near the start
  });

  it('Hazard CCD catches UPWARD swept motion (rising into a thin hazard)', () => {
    const RISING_HAZARD: LevelDefinition = {
      ...GRAVITY_LEVEL,
      id: 'gravity-test-rising-hazard',
      hazards: [
        {
          kind: 'hazard',
          visual: 'spike',
          center: { x: 0, y: 3.05, z: 24.5 },
          halfExtents: { x: 5.4, y: 0.1, z: 0.2 },
        },
      ],
    };
    const sim = makeGravitySim(RISING_HAZARD);
    settleFloor(sim);
    expect(runUntil(sim, () => sim.gravityMode === 'ceiling')).toBe(true);
    expect(runUntil(sim, () => sim.status === 'dead', 400)).toBe(true);
    expect(sim.deathCause).toBe('hazard');
    expect(sim.player.position.y).toBeGreaterThan(2);
  });

  it('Frontal impact still kills on the Ceiling; lateral scrape still survives', () => {
    const CEILING_WALL: LevelDefinition = {
      ...GRAVITY_LEVEL,
      id: 'gravity-test-ceiling-wall',
      solids: [
        // Long floor runway so the return-to-floor run can reach the finish.
        { center: { x: 0, y: -0.5, z: 150 }, halfExtents: { x: 5.4, y: 0.5, z: 160 } },
        // Ceiling slab underside y=6, z 20..60
        { center: { x: 0, y: 7, z: 40 }, halfExtents: { x: 5.4, y: 1, z: 20 } },
        // Wall ON the ceiling path: blocks the screen-left half only (x 1.3..5.4),
        // z 40..41, hanging under the slab (y 4.5..6). Center lane (x=0) scrapes by.
        { center: { x: 3.35, y: 5.25, z: 40.5 }, halfExtents: { x: 2.05, y: 0.75, z: 0.5 } },
      ],
      gravityPortals: [
        { id: 'up-1', z: 20, target: 'ceiling' },
        { id: 'down-1', z: 55, target: 'floor' },
      ],
    };
    // Head-on: run the wall lane (screen-left half, world +X, lane index 0).
    const frontal = makeGravitySim(CEILING_WALL);
    settleFloor(frontal);
    frontal.update({
      ...idleInput,
      laneLeft: { held: false, pressedThisStep: true, releasedThisStep: true },
    });
    expect(runUntil(frontal, () => frontal.gravityMode === 'ceiling')).toBe(true);
    // Steer back toward x ~ +2.6 stays inside the wall lane.
    expect(runUntil(frontal, () => frontal.status === 'dead', 600)).toBe(true);
    expect(frontal.deathCause).toBe('frontImpact');

    // Side scrape: approach in the center lane so only the wall SIDE is touched.
    const scrape = makeGravitySim(CEILING_WALL);
    settleFloor(scrape);
    expect(runUntil(scrape, () => scrape.gravityMode === 'ceiling')).toBe(true);
    settleCeiling(scrape);
    for (let i = 0; i < 2800 && scrape.status === 'running'; i++) scrape.update(idleInput);
    expect(scrape.status).toBe('finished');
  });
});

describe('Test-level gravity section playthrough (data-driven content)', () => {
  /**
   * Full deterministic playthrough of the appended M3 section through the REAL
   * Test Level geometry: Floor run -> portal up -> rise -> ceiling run ->
   * ceiling gap jump -> portal down -> fall -> Floor -> finish. Per-step
   * closed-loop jump windows (precision gaps like z 122..129.5 have ~0.3 u
   * takeoff windows that only per-step polling can hit deterministically).
   */
  it('plays Floor -> Ceiling -> Floor end to end and finishes', () => {
    const sim = makeGravitySim(TEST_LEVEL);
    // Jump takeoff windows (z ranges, grounded gate), in traversal order.
    // M4 additions: runway F edge (jump-orb gap) and runway G edge (jump
    // before the gravity orb window, which sits above the grounded envelope).
    const jumps: Array<[number, number]> = [
      [39.8, 45],      // runway -> low platform (top 0.8)
      [54.5, 58],      // low platform -> elevated (top 1.6)
      [73.6, 76],      // elevated -> landing pad (drop to 0)
      [121.69, 121.99],// weave runway -> elevated island (top 1.2; tight)
      [138.35, 141.4], // island -> narrow center island (drop to 0)
      [151.9, 153.9],  // center island -> final runway (flat 2.5 gap)
      [228.65, 232.5], // ceiling slab A -> slab B across the 6 u ceiling gap
      [329.5, 331.5],  // M4: runway F edge -> jump-orb gap (z 332..342)
      [348.0, 350.5],  // M4: runway G edge -> jump toward the gravity orb
    ];
    // M4 orb press windows (z ranges, AIRBORNE press edge, one-shot each):
    // the jump orb at z 337 and the gravity orb at z 352.
    const orbPresses: Array<[number, number]> = [
      [336.0, 338.0],
      [351.0, 352.9],
    ];
    const laneTaps: Array<[number, PhysicalInputSnapshot]> = [
      [110, tapLaneRight], // screen-right lane before the z=116 spikes
      [132, tapLaneLeft],  // recenter on the island for the narrow landing
    ];
    let ji = 0;
    let li = 0;
    let oi = 0;
    let finished = false;
    for (let t = 0; t < 9000; t++) {
      const z = sim.player.position.z;
      const laneTap = li < laneTaps.length ? laneTaps[li] : undefined;
      if (laneTap !== undefined && z >= laneTap[0]) {
        sim.update(laneTap[1]);
        li++;
        continue;
      }
      const orbPress = oi < orbPresses.length ? orbPresses[oi] : undefined;
      if (orbPress !== undefined && z >= orbPress[0] && z <= orbPress[1]) {
        sim.update(holdSpace()); // press edge while airborne inside the window
        oi++;
        continue;
      }
      const jump = ji < jumps.length ? jumps[ji] : undefined;
      if (jump !== undefined && sim.player.grounded && z >= jump[0] && z <= jump[1]) {
        sim.update(holdSpace()); // Space is the universal jump key
        ji++;
        continue;
      }
      sim.update(idleInput);
      if (sim.status === 'finished') {
        finished = true;
        break;
      }
      expect(
        sim.status,
        `died at tick ${t} z=${z.toFixed(1)} mode=${sim.gravityMode}`,
      ).toBe('running');
    }
    expect(finished).toBe(true);
    expect(ji).toBe(jumps.length);
    expect(oi).toBe(orbPresses.length);
    // M3 portals (up, down) + the M4 gravity orb + M4 portal-down-2.
    expect(sim.portalTransitionCount).toBe(4);
    expect(sim.lastPortalId).toBe('portal-down-2');
    expect(sim.gravityMode).toBe('floor');
    // M4 interactions all fired exactly once: pad, both orbs, 2x portal.
    expect(sim.padActivationCount).toBe(1);
    expect(sim.orbActivationCount).toBe(2);
    expect(sim.speedPortalCount).toBe(1);
    expect(sim.speedMultiplier).toBe(2);
  });
});
