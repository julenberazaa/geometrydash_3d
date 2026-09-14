import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import type { LevelDefinition } from '../src/level/levelDefinition';
import type { PhysicalInputSnapshot } from '../src/input/InputSystem';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { idleInput, advance } from './helpers/simulation';

/**
 * M8.1 wall-lane input-debt regression (human playtest bug):
 *
 * On a wall, pressing further toward the blocked side (Down at the bottom
 * wall lane, whose way is barred by the floor) moved nothing physically but
 * kept decrementing the internal lane target. Coming back then needed one
 * extra press per impossible input. Impossible moves must not accumulate
 * hidden debt: intent is clamped to one meaningful lean step beyond the
 * deepest reachable lane, so a single press back always recovers — while
 * the lean-against-the-wall settle itself is preserved.
 */

const THEME = TEST_LEVEL.theme;
const LANES = [2.6, 0, -2.6];

const edge = (held: boolean, pressed: boolean) => ({
  held,
  pressedThisStep: pressed,
  releasedThisStep: false,
});
const physical = (overrides: Partial<PhysicalInputSnapshot>): PhysicalInputSnapshot => ({
  space: edge(false, false),
  up: edge(false, false),
  down: edge(false, false),
  laneLeft: edge(false, false),
  laneRight: edge(false, false),
  ...overrides,
});
// On wall gravity the lane axis is vertical: Down decrements, Up increments.
const pressDown = physical({ down: edge(false, true) });
const pressUp = physical({ up: edge(false, true) });
const tapLeft = physical({ laneLeft: edge(false, true) });
const tapRight = physical({ laneRight: edge(false, true) });

/** LeftWall arena: +X wall face (x = 5) + a floor (top y = 0) below lane 0. */
const makeWallBottomArena = (): GameSimulation => {
  const def: LevelDefinition = {
    id: 'm81-wall-debt-fixture',
    displayName: 'M8.1 WALL DEBT FIXTURE',
    start: { x: 4.4, y: 3, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 0,
    finishZ: 200,
    deathY: -14,
    deathYMax: 14,
    startGravityMode: 'leftWall',
    solids: [
      { center: { x: 6, y: 3, z: 60 }, halfExtents: { x: 1, y: 5, z: 70 } },
      { center: { x: 0, y: -0.5, z: 60 }, halfExtents: { x: 5.4, y: 0.5, z: 70 } },
    ],
    hazards: [],
    theme: THEME,
  };
  return new GameSimulation(def);
};

/** Floor arena with a tall side wall blocking lane 0 from the right. */
const makeFloorSideWallArena = (): GameSimulation => {
  const def: LevelDefinition = {
    id: 'm81-floor-debt-fixture',
    displayName: 'M8.1 FLOOR DEBT FIXTURE',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 0,
    finishZ: 200,
    deathY: -14,
    solids: [
      { center: { x: 0, y: -0.5, z: 60 }, halfExtents: { x: 5.4, y: 0.5, z: 70 } },
      { center: { x: 3.45, y: 3, z: 60 }, halfExtents: { x: 1.95, y: 4, z: 70 } },
    ],
    hazards: [],
    theme: THEME,
  };
  return new GameSimulation(def);
};

describe('M8.1 lane-debt resync', () => {
  it('wall-bottom impossible presses do not accumulate debt', () => {
    const sim = makeWallBottomArena();
    // Settle onto the wall at lane 1 (y -> 3).
    advance(sim, idleInput, 240);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.position.y).toBeCloseTo(3, 0);
    // One Down: legal move to lane 0, settles leaning on the floor.
    sim.update(pressDown);
    advance(sim, idleInput, 240);
    expect(sim.player.targetLaneIndex).toBe(0);
    expect(sim.status).toBe('running');
    const leanY = sim.player.position.y;
    expect(leanY).toBeLessThan(1.2);
    // Three more Downs: physically impossible — the target must NOT drift.
    sim.update(pressDown);
    sim.update(pressDown);
    sim.update(pressDown);
    advance(sim, idleInput, 30);
    expect(sim.player.targetLaneIndex).toBe(0);
    // A single Up recovers to lane 1 immediately (no hidden debt to undo).
    sim.update(pressUp);
    expect(sim.player.targetLaneIndex).toBe(1);
    advance(sim, idleInput, 240);
    expect(sim.player.position.y).toBeCloseTo(3, 0);
  });

  it('floor side-wall impossible presses do not accumulate debt', () => {
    const sim = makeFloorSideWallArena();
    advance(sim, idleInput, 120);
    expect(sim.player.grounded).toBe(true);
    // One Left: legal lean against the side wall (x -> wall face).
    sim.update(tapLeft);
    advance(sim, idleInput, 240);
    expect(sim.player.targetLaneIndex).toBe(0);
    expect(sim.player.position.x).toBeCloseTo(0.95, 1);
    // Three more Lefts: impossible — the target must stay pinned at 0.
    sim.update(tapLeft);
    sim.update(tapLeft);
    sim.update(tapLeft);
    advance(sim, idleInput, 30);
    expect(sim.player.targetLaneIndex).toBe(0);
    expect(sim.player.position.x).toBeCloseTo(0.95, 1);
    // A single Right recovers to lane 1 immediately.
    sim.update(tapRight);
    expect(sim.player.targetLaneIndex).toBe(1);
    advance(sim, idleInput, 240);
    expect(sim.player.position.x).toBeCloseTo(0, 1);
  });

  it('open-edge virtual lanes still accumulate without a wall (M1.2 fall-off intact)', () => {
    const def: LevelDefinition = {
      id: 'm81-open-edge-fixture',
      displayName: 'M8.1 OPEN EDGE FIXTURE',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 0,
      finishZ: 200,
      deathY: -14,
      solids: [
        { center: { x: 0, y: -0.5, z: 60 }, halfExtents: { x: 5.4, y: 0.5, z: 70 } },
      ],
      hazards: [],
      theme: THEME,
    };
    const sim = new GameSimulation(def);
    advance(sim, idleInput, 120);
    // No side wall: repeated outward taps still address virtual lanes
    // (the M1.2 lateral fall-off contract — no contact, no resync).
    sim.update(tapLeft);
    sim.update(tapLeft);
    sim.update(tapLeft);
    expect(sim.player.targetLaneIndex).toBe(-2);
  });
});
