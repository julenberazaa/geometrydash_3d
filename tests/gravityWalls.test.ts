import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { GameplayFrame } from '../src/player/gameplayFrame';
import {
  interpretPhysicalInput,
  type PhysicalInputSnapshot,
} from '../src/input/InputSystem';
import { ChaseCamera } from '../src/camera/ChaseCamera';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { LevelDefinition, GravityPortalDef } from '../src/level/levelDefinition';
import { loadLevel } from '../src/level/levelRuntime';
import { LevelView } from '../src/rendering/LevelView';
import { PlayerView } from '../src/rendering/PlayerView';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { computeStateFingerprint } from '../src/replay/stateFingerprint';
import { idleInput, holdJump, advance } from './helpers/simulation';
import { makeTestLibrary } from './helpers/visuals';

/**
 * M8B four-way gravity contract:
 * - Floor/Ceiling behavior is UNCHANGED (floorCompat golden gate);
 * - leftWall/rightWall are real support surfaces (frames, support probing,
 *   jumps, lanes, pads, orbs, portals, void bounds);
 * - lanes never mirror; the camera never rolls; the free face stays readable.
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
const pressUp = physical({ up: edge(false, true) });
const pressDown = physical({ down: edge(false, true) });
const holdIntoLeftWall = physical({ laneLeft: edge(true, true) }); // ArrowLeft held
const holdAwayFromLeftWall = physical({ laneRight: edge(true, true) }); // ArrowRight held

/** Wall-run arena: a tall +X wall slab (face x = 5) under leftWall gravity. */
const makeWallArena = (overrides: Partial<LevelDefinition> = {}): GameSimulation => {
  const def: LevelDefinition = {
    id: 'm8b-wall-fixture',
    displayName: 'M8B WALL FIXTURE',
    start: { x: 4.4, y: 3, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: 200,
    deathY: -14,
    deathYMax: 14,
    startGravityMode: 'leftWall',
    solids: [{ center: { x: 6, y: 3, z: 60 }, halfExtents: { x: 1, y: 5, z: 70 } }],
    hazards: [],
    theme: THEME,
    ...overrides,
  };
  return new GameSimulation(def);
};

const settleWall = (sim: GameSimulation): void => {
  for (let i = 0; i < 240 && !sim.player.grounded; i++) sim.update(idleInput);
  if (!sim.player.grounded) throw new Error('wall fixture never grounded');
};

describe('M8B gravity frames', () => {
  // Frame vectors derive as exact negations (−0 appears); normalize zeros.
  const xy = (v: { x: number; y: number }): number[] => [v.x === 0 ? 0 : v.x, v.y === 0 ? 0 : v.y];
  it('defines four explicit axis-aligned frames', () => {
    const floor = GameplayFrame.forMode('floor');
    expect(xy(floor.gravityVector)).toEqual([0, -1]);
    expect(xy(floor.surfaceNormal)).toEqual([0, 1]);
    expect(xy(floor.laneAxis)).toEqual([-1, 0]);
    const ceiling = GameplayFrame.forMode('ceiling');
    expect(xy(ceiling.gravityVector)).toEqual([0, 1]);
    expect(xy(ceiling.surfaceNormal)).toEqual([0, -1]);
    expect(xy(ceiling.laneAxis)).toEqual([-1, 0]);
    // Walls: gravity ±X, lanes +Y on BOTH (never mirrored).
    const left = GameplayFrame.forMode('leftWall');
    expect(xy(left.gravityVector)).toEqual([1, 0]);
    expect(xy(left.surfaceNormal)).toEqual([-1, 0]);
    expect(xy(left.laneAxis)).toEqual([0, 1]);
    const right = GameplayFrame.forMode('rightWall');
    expect(xy(right.gravityVector)).toEqual([-1, 0]);
    expect(xy(right.surfaceNormal)).toEqual([1, 0]);
    expect(xy(right.laneAxis)).toEqual([0, 1]);
    for (const f of [floor, ceiling, left, right]) {
      expect([f.forwardAxis.x, f.forwardAxis.y, f.forwardAxis.z]).toEqual([0, 0, 1]);
    }
  });
});

describe('M8B wall input mapping', () => {
  it('maps Up/Down to lanes and horizontal keys to jump/fast-fall on walls', () => {
    // Left wall: ArrowRight (away) jumps, ArrowLeft (into) fast-falls.
    const leftJump = interpretPhysicalInput(physical({ laneRight: edge(true, true) }), 'leftWall');
    expect(leftJump.jump.held).toBe(true);
    expect(leftJump.jump.pressedThisStep).toBe(true);
    const leftFall = interpretPhysicalInput(holdIntoLeftWall, 'leftWall');
    expect(leftFall.fastFall.held).toBe(true);
    // Right wall: mirrored support keys.
    const rightJump = interpretPhysicalInput(holdIntoLeftWall, 'rightWall');
    expect(rightJump.jump.held).toBe(true);
    const rightFall = interpretPhysicalInput(holdAwayFromLeftWall, 'rightWall');
    expect(rightFall.fastFall.held).toBe(true);
    // Lanes: Up increments, Down decrements — IDENTICAL on both walls.
    for (const mode of ['leftWall', 'rightWall'] as const) {
      const up = interpretPhysicalInput(pressUp, mode);
      expect(up.laneRight.pressedThisStep).toBe(true);
      expect(up.laneLeft.pressedThisStep).toBe(false);
      const down = interpretPhysicalInput(pressDown, mode);
      expect(down.laneLeft.pressedThisStep).toBe(true);
      expect(down.laneRight.pressedThisStep).toBe(false);
    }
  });

  it('leaves Floor/Ceiling mappings untouched', () => {
    const floorJump = interpretPhysicalInput(physical({ up: edge(true, true) }), 'floor');
    expect(floorJump.jump.held).toBe(true);
    expect(floorJump.fastFall.held).toBe(false);
    const ceilingJump = interpretPhysicalInput(physical({ down: edge(true, true) }), 'ceiling');
    expect(ceilingJump.jump.held).toBe(true);
    // Space is universal on all four surfaces.
    for (const mode of ['floor', 'ceiling', 'leftWall', 'rightWall'] as const) {
      expect(interpretPhysicalInput(physical({ space: edge(true, true) }), mode).jump.held).toBe(true);
    }
  });
});

describe('M8B wall support and jumping', () => {
  it('grounds against the +X wall under leftWall gravity', () => {
    const sim = makeWallArena();
    expect(sim.gravityMode).toBe('leftWall');
    settleWall(sim);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.supportColliderId).not.toBeNull();
    // Resting contact: no drift into the wall.
    const x = sim.player.position.x;
    advance(sim, idleInput, 30);
    expect(sim.player.grounded).toBe(true);
    expect(Math.abs(sim.player.position.x - x)).toBeLessThan(0.05);
  });

  it('jumps AWAY from the wall and falls back onto it', () => {
    const sim = makeWallArena();
    settleWall(sim);
    sim.update(holdJump);
    expect(sim.player.grounded).toBe(false);
    expect(sim.player.velocity.x).toBeLessThan(-10);
    // Falls back (+X gravity) and re-grounds on the same wall.
    settleWall(sim);
    expect(sim.gravityMode).toBe('leftWall');
  });

  it('fast-fall accelerates toward the wall (ArrowLeft on leftWall)', () => {
    const plain = makeWallArena();
    plain.debugPlaceAt(0, 3, 0);
    const fast = makeWallArena();
    fast.debugPlaceAt(0, 3, 0);
    advance(plain, idleInput, 20);
    advance(fast, holdIntoLeftWall, 20);
    // Fast-fall run is further along gravity (+X) after the same steps.
    expect(fast.player.position.x).toBeGreaterThan(plain.player.position.x + 0.5);
  });

  it('mirrors support on the −X wall under rightWall gravity', () => {
    const sim = makeWallArena({
      startGravityMode: 'rightWall',
      start: { x: -4.4, y: 3, z: -4 },
      solids: [{ center: { x: -6, y: 3, z: 60 }, halfExtents: { x: 1, y: 5, z: 70 } }],
    });
    settleWall(sim);
    expect(sim.player.grounded).toBe(true);
    sim.update(holdJump);
    expect(sim.player.velocity.x).toBeGreaterThan(10);
  });
});

describe('M8B wall lane movement', () => {
  it('moves along world Y with Up/Down, one press = one lane', () => {
    const sim = makeWallArena();
    settleWall(sim);
    expect(sim.player.targetLaneIndex).toBe(1);
    sim.update(pressUp);
    expect(sim.player.targetLaneIndex).toBe(2);
    // Wall lanes default to the corridor-mid mirror: [0.4, 3, 5.6]
    // (float-rounded: 3 − 2.6 is not exact binary).
    expect(sim.level.wallLaneCenters.map((v) => Math.round(v * 10) / 10)).toEqual([0.4, 3, 5.6]);
    advance(sim, idleInput, 120);
    expect(sim.player.position.y).toBeCloseTo(5.6, 1);
    sim.update(pressDown);
    expect(sim.player.targetLaneIndex).toBe(1);
  });

  it('supports explicit wallLaneCenters per level', () => {
    const sim = makeWallArena({ wallLaneCenters: [1, 3, 5] });
    expect(sim.level.wallLaneCenters).toEqual([1, 3, 5]);
    settleWall(sim);
    sim.update(pressUp);
    advance(sim, idleInput, 120);
    expect(sim.player.position.y).toBeCloseTo(5, 1);
  });
});

describe('M8B wall transitions and interactions', () => {
  const portalDef = (portals: GravityPortalDef[]): LevelDefinition => ({
    id: 'm8b-portal-fixture',
    displayName: 'M8B PORTAL FIXTURE',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: 200,
    deathY: -14,
    deathYMax: 14,
    solids: [
      { center: { x: 0, y: -0.5, z: 10 }, halfExtents: { x: 5.4, y: 0.5, z: 20 } },
      { center: { x: 6, y: 3, z: 60 }, halfExtents: { x: 1, y: 5, z: 50 } },
    ],
    hazards: [],
    gravityPortals: portals,
    theme: THEME,
  });

  it('floor -> leftWall portal flips gravity, preserves velocity, clears support', () => {
    const sim = new GameSimulation(portalDef([{ id: 'p', z: 20, target: 'leftWall' }]));
    for (let i = 0; i < 120 && !sim.player.grounded; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('floor');
    while (sim.status === 'running' && sim.gravityMode === 'floor') sim.update(idleInput);
    expect(sim.gravityMode).toBe('leftWall');
    expect(sim.portalTransitionCount).toBe(1);
    // Falls toward +X after the flip and grounds on the wall slab.
    settleWall(sim);
    expect(sim.player.supportColliderId).not.toBeNull();
  });

  it('gravity orbs flip to the opposite surface (walls pair up)', () => {
    const def = portalDef([]);
    def.solids = [{ center: { x: 6, y: 3, z: 60 }, halfExtents: { x: 1, y: 5, z: 70 } }];
    def.startGravityMode = 'leftWall';
    def.start = { x: 4.4, y: 3, z: -4 };
    def.gravityOrbs = [{ id: 'orb', center: { x: 4.4, y: 3, z: 2 }, halfExtents: { x: 1, y: 1, z: 1 } }];
    const sim = new GameSimulation(def);
    settleWall(sim);
    // Press with the press edge landing inside the window (z 1..3):
    // flips leftWall -> rightWall.
    const press = physical({ space: edge(true, true) });
    let flipped = false;
    for (let i = 0; i < 240 && sim.status === 'running'; i++) {
      const z = sim.player.position.z;
      sim.update(z > 0.5 && z < 1.5 && !sim.isInteractionUsed('orb') ? press : idleInput);
      if (sim.gravityMode === 'rightWall') {
        flipped = true;
        break;
      }
    }
    expect(flipped).toBe(true);
    expect(sim.portalTransitionCount).toBe(1);
  });

  it('wall pads launch away from the support', () => {
    const sim = makeWallArena({
      jumpPads: [
        {
          id: 'pad',
          center: { x: 4.4, y: 3, z: 2 },
          halfExtents: { x: 1, y: 1, z: 1 },
          surface: 'leftWall',
          impulse: 15,
        },
      ],
    });
    settleWall(sim);
    while (sim.status === 'running' && !sim.isInteractionUsed('pad')) sim.update(idleInput);
    expect(sim.isInteractionUsed('pad')).toBe(true);
    expect(sim.player.velocity.x).toBeCloseTo(-15, 6);
  });

  it('side void bounds kill outward wall falls', () => {
    // Bound just above the start: the first step is already outside.
    const sim = makeWallArena({ deathXMin: 4.5 });
    expect(sim.status).toBe('running');
    sim.update(idleInput);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('void');
  });

  it('lethal checks precede wall portal transitions (death wins)', () => {
    const def = portalDef([{ id: 'p', z: 20, target: 'leftWall' }]);
    def.hazards = [
      { kind: 'hazard', center: { x: 0, y: 0.5, z: 19 }, halfExtents: { x: 2, y: 0.5, z: 0.5 } },
    ];
    const sim = new GameSimulation(def);
    for (let i = 0; i < 120 && !sim.player.grounded; i++) sim.update(idleInput);
    while (sim.status === 'running') sim.update(idleInput);
    expect(sim.status).toBe('dead');
    expect(sim.gravityMode).toBe('floor');
    expect(sim.portalTransitionCount).toBe(0);
  });
});

describe('M8B wall camera (no roll, free face readable)', () => {
  it('frames walls from the free-face side while staying elevated', () => {
    const camera = new ChaseCamera();
    // LeftWall: eye toward −X (free side), elevated like the floor line.
    camera.snapTo({ x: 4.45, y: 3, z: 40 }, 0, 'freeMinusFocus');
    const eye = camera.currentPosition;
    const look = camera.currentLookTarget;
    expect(eye.x).toBeLessThan(4.45 - 2);
    expect(eye.y).toBeCloseTo(3 * 0.35 + 4.2, 6);
    expect(look.x).toBeLessThan(0.6);
    expect(look.y).toBeCloseTo(3.6, 6);
    // RightWall mirrors in X, never in Y.
    camera.snapTo({ x: -4.45, y: 3, z: 40 }, 0, 'freePlusFocus');
    expect(camera.currentPosition.x).toBeGreaterThan(-4.45 + 2);
    expect(camera.currentPosition.y).toBeCloseTo(3 * 0.35 + 4.2, 6);
  });

  it('keeps Floor/Ceiling framing numerically unchanged', () => {
    const camera = new ChaseCamera();
    camera.snapTo({ x: 1, y: 0.55, z: 40 }, 0, 'aboveFocus');
    expect(camera.currentPosition.y).toBeCloseTo(0.55 * 0.35 + 4.2, 6);
    camera.snapTo({ x: 1, y: 5.45, z: 40 }, 0, 'belowFocus');
    expect(camera.currentPosition.y).toBeCloseTo(5.45 * 0.35 - 0.3, 6);
  });
});

describe('M8B wall player + hazard presentation', () => {
  it('aligns the cube rest pose to the support (±90° Z roll)', () => {
    const library = makeTestLibrary();
    const view = new PlayerView(library);
    view.updateFromSimulation({ x: 0, y: 0, z: 0 }, true, 0.016, 'leftWall');
    // M8C: the cube mesh rides inside the cube assembly group now.
    const cube = view.group.children[0]?.children[0];
    expect((cube?.rotation.z ?? 0)).toBeCloseTo(Math.PI / 2, 6);
    view.updateFromSimulation({ x: 0, y: 0, z: 0 }, true, 0.016, 'rightWall');
    expect((cube?.rotation.z ?? 0)).toBeCloseTo(-Math.PI / 2, 6);
    view.updateFromSimulation({ x: 0, y: 0, z: 0 }, true, 0.016, 'ceiling');
    expect((cube?.rotation.z ?? 0)).toBeCloseTo(Math.PI, 6);
    view.dispose();
    library.dispose();
  });

  it('orients wall spikes away from the support (tip ∓X)', () => {
    const library = makeTestLibrary();
    const def: LevelDefinition = {
      id: 'm8b-spike-fixture',
      displayName: 'M8B SPIKE',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 100,
      deathY: -14,
      solids: [],
      hazards: [
        { kind: 'hazard', visual: 'spike', mount: 'leftWall', center: { x: 5, y: 3, z: 20 }, halfExtents: { x: 0.25, y: 0.5, z: 0.5 } },
        { kind: 'hazard', visual: 'spike', mount: 'rightWall', center: { x: -5, y: 3, z: 30 }, halfExtents: { x: 0.25, y: 0.5, z: 0.5 } },
      ],
      theme: THEME,
    };
    const view = new LevelView(loadLevel(def), library);
    expect(view.group.children.length).toBe(2);
    const leftSpike = view.group.children[0];
    const rightSpike = view.group.children[1];
    expect(leftSpike?.rotation.z).toBeCloseTo(Math.PI / 2, 6);
    expect(rightSpike?.rotation.z).toBeCloseTo(-Math.PI / 2, 6);
    // Bases attach to the support faces (tip away from the wall).
    expect(leftSpike?.position.x ?? 0).toBeLessThan(5);
    expect(rightSpike?.position.x ?? 0).toBeGreaterThan(-5);
    view.dispose();
    library.dispose();
  });
});

describe('M8B wall fingerprints (conditional encoding)', () => {
  it('wall portals, side bounds and wall lanes change the level hash', () => {
    const base = computeLevelFingerprint(TEST_LEVEL);
    const withWalls: LevelDefinition = {
      ...TEST_LEVEL,
      gravityPortals: [{ id: 'w', z: 50, target: 'leftWall' }],
      deathXMin: -12,
      deathXMax: 12,
      wallLaneCenters: [0.4, 3, 5.6],
    };
    expect(computeLevelFingerprint(withWalls)).not.toBe(base);
  });

  it('gravity mode is part of the state hash (all four surfaces distinct)', () => {
    const sim = makeWallArena();
    const floorHash = (() => {
      const s = new GameSimulation(TEST_LEVEL);
      return computeStateFingerprint(s);
    })();
    settleWall(sim);
    expect(computeStateFingerprint(sim)).not.toBe(floorHash);
    expect(sim.gravityMode).toBe('leftWall');
  });
});
