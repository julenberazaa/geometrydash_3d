import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { SHIP_TUNING } from '../src/player/shipTuning';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { loadLevel } from '../src/level/levelRuntime';
import { LevelView } from '../src/rendering/LevelView';
import { PlayerView } from '../src/rendering/PlayerView';
import { VfxSystem } from '../src/rendering/VfxSystem';
import { PRODUCTION_THEME } from '../src/visuals/productionTheme';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { computeStateFingerprint } from '../src/replay/stateFingerprint';
import type { PhysicalInputSnapshot } from '../src/input/InputSystem';
import { idleInput, advance } from './helpers/simulation';
import { makeTestLibrary } from './helpers/visuals';
import { makeSimView, runFrames } from './helpers/vfxSimView';

/**
 * M8C player-mode contract (Ship + Spider):
 * - one authoritative mode in GameSimulation; rendering observes;
 * - mode portals are deterministic one-shot forward crossings with a clean
 *   transient handoff (support cleared, along-gravity velocity zeroed,
 *   forward flow preserved);
 * - Ship = continuous thrust flight; Spider = instant opposite-surface
 *   snaps that cannot bypass lethal geometry;
 * - replay stays input-only; fingerprints extend conditionally.
 */

const THEME = TEST_LEVEL.theme;
const LANES = [2.6, 0, -2.6];

const edge = (held: boolean, pressed: boolean) => ({
  held,
  pressedThisStep: pressed,
  releasedThisStep: false,
});
const holdSpace: PhysicalInputSnapshot = {
  space: edge(true, true),
  up: edge(false, false),
  down: edge(false, false),
  laneLeft: edge(false, false),
  laneRight: edge(false, false),
};
const holdSpaceHeld: PhysicalInputSnapshot = {
  space: { held: true, pressedThisStep: false, releasedThisStep: false },
  up: edge(false, false),
  down: edge(false, false),
  laneLeft: edge(false, false),
  laneRight: edge(false, false),
};
const pressSpace: PhysicalInputSnapshot = {
  space: { held: false, pressedThisStep: true, releasedThisStep: true },
  up: edge(false, false),
  down: edge(false, false),
  laneLeft: edge(false, false),
  laneRight: edge(false, false),
};

/** Ship corridor: floor runway + ceiling slab (fly between y 0..6). */
const makeShipArena = (overrides: Partial<LevelDefinition> = {}): GameSimulation => {
  const def: LevelDefinition = {
    id: 'm8c-ship-fixture',
    displayName: 'M8C SHIP FIXTURE',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: 300,
    deathY: -14,
    deathYMax: 14,
    solids: [
      { center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 150 } },
      { center: { x: 0, y: 7, z: 140 }, halfExtents: { x: 5.4, y: 1, z: 150 } },
    ],
    hazards: [],
    modePortals: [{ id: 'ship-on', z: 10, target: 'ship' }],
    theme: THEME,
    ...overrides,
  };
  return new GameSimulation(def);
};

/** Spider room: floor runway + full ceiling slab (snap up/down). */
const makeSpiderArena = (overrides: Partial<LevelDefinition> = {}): GameSimulation => {
  const def: LevelDefinition = {
    id: 'm8c-spider-fixture',
    displayName: 'M8C SPIDER FIXTURE',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: 300,
    deathY: -14,
    deathYMax: 14,
    solids: [
      { center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 150 } },
      { center: { x: 0, y: 7, z: 140 }, halfExtents: { x: 5.4, y: 1, z: 150 } },
    ],
    hazards: [],
    modePortals: [{ id: 'spider-on', z: 10, target: 'spider' }],
    theme: THEME,
    ...overrides,
  };
  return new GameSimulation(def);
};

const driveToMode = (sim: GameSimulation, mode: string, budget = 3000): void => {
  for (let i = 0; i < budget && sim.status === 'running'; i++) {
    sim.update(idleInput);
    if (sim.playerMode === mode) return;
  }
  if (sim.playerMode !== mode) throw new Error(`never entered ${mode}`);
};

describe('M8C mode portals', () => {
  it('cube -> ship transition preserves flow and clears transient state', () => {
    const sim = makeShipArena();
    expect(sim.playerMode).toBe('cube');
    driveToMode(sim, 'ship');
    expect(sim.player.playerMode).toBe('ship');
    expect(sim.modeTransitionCount).toBe(1);
    expect(sim.lastModePortalId).toBe('ship-on');
    expect(sim.isModePortalUsed('ship-on')).toBe(true);
    // Clean handoff: support cleared, along-gravity velocity zeroed.
    expect(sim.player.grounded).toBe(false);
    expect(sim.player.supportColliderId).toBeNull();
    expect(sim.player.velocity.y).toBeCloseTo(0, 9);
    // Forward flow preserved at full speed.
    expect(sim.player.velocity.z).toBeCloseTo(14, 9);
  });

  it('mode portals are one-shot per attempt and re-arm on restart', () => {
    const sim = makeShipArena({
      modePortals: [
        { id: 'ship-on', z: 10, target: 'ship' },
        { id: 'cube-back', z: 60, target: 'cube' },
      ],
    });
    driveToMode(sim, 'ship');
    driveToMode(sim, 'cube');
    expect(sim.modeTransitionCount).toBe(2);
    const attempts = sim.attempts;
    sim.restart();
    expect(sim.attempts).toBe(attempts + 1);
    expect(sim.playerMode).toBe('cube');
    expect(sim.isModePortalUsed('ship-on')).toBe(false);
    expect(sim.lastModePortalId).toBeNull();
  });

  it('crossing a same-mode portal is a no-op (debug id only)', () => {
    const sim = makeShipArena({ modePortals: [{ id: 'noop', z: 10, target: 'cube' }] });
    for (let i = 0; i < 600 && sim.status === 'running'; i++) sim.update(idleInput);
    expect(sim.lastModePortalId).toBe('noop');
    expect(sim.modeTransitionCount).toBe(0);
    expect(sim.playerMode).toBe('cube');
  });

  it('lethal steps win over mode transitions (death before portal)', () => {
    const sim = makeShipArena({
      hazards: [{ kind: 'hazard', center: { x: 0, y: 0.5, z: 9 }, halfExtents: { x: 2, y: 0.5, z: 0.5 } }],
    });
    for (let i = 0; i < 120 && !sim.player.grounded; i++) sim.update(idleInput);
    while (sim.status === 'running') sim.update(idleInput);
    expect(sim.status).toBe('dead');
    expect(sim.playerMode).toBe('cube');
    expect(sim.modeTransitionCount).toBe(0);
  });
});

describe('M8C Ship flight', () => {
  it('thrust rises away from gravity; release falls back', () => {
    const sim = makeShipArena();
    driveToMode(sim, 'ship');
    const y0 = sim.player.position.y;
    advance(sim, holdSpace, 30);
    expect(sim.player.position.y).toBeGreaterThan(y0 + 0.5);
    expect(sim.shipThrusting).toBe(true);
    const peak = sim.player.position.y;
    advance(sim, idleInput, 150);
    expect(sim.shipThrusting).toBe(false);
    // Release kills the climb and falls all the way back to the runway.
    expect(sim.player.position.y).toBeLessThan(peak - 1);
    expect(sim.player.grounded).toBe(true);
  });

  it('clamps at mode-owned terminal speeds (deterministic)', () => {
    // Open-sky rise: no ceiling slab, high upper bound — terminal rise is
    // observable without landing.
    const sky = makeShipArena({
      deathYMax: 40,
      solids: [{ center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 150 } }],
    });
    driveToMode(sky, 'ship');
    advance(sky, holdSpaceHeld, 100);
    expect(sky.status).toBe('running');
    // Rising away from the floor = +Y: terminal rise speed (floor frame).
    expect(sky.player.velocity.y).toBeCloseTo(SHIP_TUNING.maxRiseSpeed, 6);
    // Tall fall: staged high, released — terminal fall before landing.
    const fall = makeShipArena({
      solids: [{ center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 150 } }],
    });
    driveToMode(fall, 'ship');
    fall.debugPlaceAt(0, 12, 60);
    advance(fall, idleInput, 90);
    expect(fall.status).toBe('running');
    // Falling toward the floor = −Y: terminal fall speed (floor frame).
    expect(fall.player.velocity.y).toBeCloseTo(-SHIP_TUNING.maxFallSpeed, 6);
  });

  it('is deterministic run-to-run (replay-safe)', () => {
    const run = (): GameSimulation => {
      const sim = makeShipArena();
      driveToMode(sim, 'ship');
      advance(sim, holdSpaceHeld, 60);
      advance(sim, idleInput, 60);
      advance(sim, holdSpaceHeld, 60);
      return sim;
    };
    const a = run();
    const b = run();
    expect(computeStateFingerprint(a)).toBe(computeStateFingerprint(b));
  });

  it('dies on collision and restarts back in cube mode', () => {
    // Hazard inside the ceiling cruise band (ship climbs to y ~5.45 fast).
    const sim = makeShipArena({
      hazards: [{ kind: 'hazard', center: { x: 0, y: 5.2, z: 80 }, halfExtents: { x: 3, y: 0.5, z: 0.5 } }],
    });
    driveToMode(sim, 'ship');
    // Climb into the hazard band.
    for (let i = 0; i < 600 && sim.status === 'running'; i++) sim.update(holdSpaceHeld);
    expect(sim.status).toBe('dead');
    const attempts = sim.attempts;
    advance(sim, idleInput, 78 + 1);
    expect(sim.status).toBe('running');
    expect(sim.attempts).toBe(attempts + 1);
    expect(sim.playerMode).toBe('cube');
  });

  it('flies frame-generically (ceiling ship thrusts away from the ceiling)', () => {
    const sim = makeShipArena({
      startGravityMode: 'ceiling',
      start: { x: 0, y: 4.5, z: -4 },
      solids: [
        { center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 150 } },
        { center: { x: 0, y: 7, z: 140 }, halfExtents: { x: 5.4, y: 1, z: 150 } },
      ],
    });
    // Settle onto the ceiling first.
    for (let i = 0; i < 240 && !sim.player.grounded; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('ceiling');
    driveToMode(sim, 'ship');
    const y0 = sim.player.position.y;
    advance(sim, holdSpaceHeld, 40);
    // Thrust away from the ceiling = downward (−Y).
    expect(sim.player.position.y).toBeLessThan(y0 - 0.5);
    advance(sim, idleInput, 60);
    // Release = gravity pulls back up toward the ceiling.
    expect(sim.player.velocity.y).toBeGreaterThan(0);
  });

  it('keeps lane steering (Up/Down agnostic — physical lanes on floor)', () => {
    const sim = makeShipArena();
    driveToMode(sim, 'ship');
    expect(sim.player.targetLaneIndex).toBe(1);
    sim.update({
      space: edge(false, false),
      up: edge(false, false),
      down: edge(false, false),
      laneLeft: edge(false, false),
      laneRight: { held: false, pressedThisStep: true, releasedThisStep: true },
    });
    expect(sim.player.targetLaneIndex).toBe(2);
  });
});

describe('M8C Spider snaps', () => {
  it('snaps floor -> ceiling on press and flips gravity', () => {
    const sim = makeSpiderArena();
    driveToMode(sim, 'spider');
    for (let i = 0; i < 60 && !sim.player.grounded; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('floor');
    sim.update(pressSpace);
    // Resting under the ceiling (underside 6): center 5.45. The same
    // step's support probe resolves the landing immediately.
    expect(sim.player.position.y).toBeCloseTo(5.45, 6);
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.supportColliderId).not.toBeNull();
  });

  it('snaps back ceiling -> floor on the next press (hold does not repeat)', () => {
    const sim = makeSpiderArena();
    driveToMode(sim, 'spider');
    for (let i = 0; i < 60 && !sim.player.grounded; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.gravityMode).toBe('ceiling');
    // Holding does NOT re-snap (edge only).
    sim.update(holdSpaceHeld);
    expect(sim.gravityMode).toBe('ceiling');
    sim.update(pressSpace);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.player.position.y).toBeCloseTo(0.55, 6);
  });

  it('works mid-air (snap from a fall)', () => {
    const sim = makeSpiderArena();
    driveToMode(sim, 'spider');
    // Launch upward with a cube-style... spider never jumps: place mid-air.
    sim.debugPlaceAt(0, 3, 30);
    sim.update(pressSpace);
    expect(sim.player.position.y).toBeCloseTo(5.45, 6);
    expect(sim.gravityMode).toBe('ceiling');
  });

  it('ignores the press with no valid opposite support in range', () => {
    const sim = makeSpiderArena({
      solids: [{ center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 150 } }],
    });
    driveToMode(sim, 'spider');
    for (let i = 0; i < 60 && !sim.player.grounded; i++) sim.update(idleInput);
    const y = sim.player.position.y;
    sim.update(pressSpace);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.player.position.y).toBeCloseTo(y, 6);
  });

  it('lands on segmented ceilings (coplanar straddle is valid)', () => {
    const sim = makeSpiderArena({
      solids: [
        { center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 150 } },
        { center: { x: 1.35, y: 7, z: 140 }, halfExtents: { x: 1.35, y: 1, z: 150 } },
        { center: { x: -1.35, y: 7, z: 140 }, halfExtents: { x: 1.35, y: 1, z: 150 } },
      ],
    });
    driveToMode(sim, 'spider');
    for (let i = 0; i < 60 && !sim.player.grounded; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.player.position.y).toBeCloseTo(5.45, 6);
  });

  it('dies when a hazard blocks the snap path (no magic pass-through)', () => {
    // Hazard band y 2.6..5: spawn (top 2.05) and the floor run (top 1.1)
    // pass UNDER it, but the snap transit crosses it.
    const sim = makeSpiderArena({
      hazards: [{ kind: 'hazard', center: { x: 0, y: 3.8, z: 0 }, halfExtents: { x: 5, y: 1.2, z: 60 } }],
    });
    driveToMode(sim, 'spider');
    for (let i = 0; i < 60 && sim.status === 'running' && !sim.player.grounded; i++) {
      sim.update(idleInput);
    }
    // Ensure we are still running on the floor before the snap press.
    if (sim.status !== 'running') throw new Error('fixture died before the snap');
    sim.update(pressSpace);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('hazard');
    expect(sim.gravityMode).toBe('floor'); // lethal step never flips
  });

  it('snaps wall -> wall (leftWall -> rightWall)', () => {
    const def: LevelDefinition = {
      id: 'm8c-spider-wall-fixture',
      displayName: 'M8C SPIDER WALL',
      start: { x: 4.4, y: 3, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 300,
      deathY: -14,
      deathYMax: 14,
      deathXMin: -14,
      deathXMax: 14,
      startGravityMode: 'leftWall',
      solids: [
        { center: { x: 6, y: 3, z: 140 }, halfExtents: { x: 1, y: 5, z: 150 } },
        { center: { x: -6, y: 3, z: 140 }, halfExtents: { x: 1, y: 5, z: 150 } },
      ],
      hazards: [],
      modePortals: [{ id: 'spider-on', z: 10, target: 'spider' }],
      theme: THEME,
    };
    const sim = new GameSimulation(def);
    driveToMode(sim, 'spider');
    for (let i = 0; i < 240 && !sim.player.grounded; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('leftWall');
    sim.update(pressSpace);
    expect(sim.gravityMode).toBe('rightWall');
    // Resting against the −X wall (face −5): center −4.45.
    expect(sim.player.position.x).toBeCloseTo(-4.45, 6);
  });
});

describe('M8C mode fingerprints (conditional encoding)', () => {
  it('mode portals change the level hash; plain levels hash as before', () => {
    const base = computeLevelFingerprint(TEST_LEVEL);
    expect(TEST_LEVEL.modePortals).toBeUndefined();
    const withModes: LevelDefinition = {
      ...TEST_LEVEL,
      modePortals: [{ id: 'm', z: 50, target: 'ship' }],
    };
    expect(computeLevelFingerprint(withModes)).not.toBe(base);
    expect(computeLevelFingerprint({ ...TEST_LEVEL })).toBe(base);
  });

  it('mode is part of the state hash only on mode levels', () => {
    const sim = makeShipArena();
    const before = computeStateFingerprint(sim);
    driveToMode(sim, 'ship');
    expect(computeStateFingerprint(sim)).not.toBe(before);
    // Plain levels: no mode bytes (golden replay safe).
    const plain = new GameSimulation(TEST_LEVEL);
    const h1 = computeStateFingerprint(plain);
    plain.update(idleInput);
    expect(computeStateFingerprint(plain)).not.toBe(h1); // moves...
    const a = new GameSimulation(TEST_LEVEL);
    const b = new GameSimulation(TEST_LEVEL);
    a.update(idleInput);
    b.update(idleInput);
    expect(computeStateFingerprint(a)).toBe(computeStateFingerprint(b));
  });
});

describe('M8C mode presentation', () => {
  it('builds compact mode rings (ship + spider) from level data', () => {
    const library = makeTestLibrary();
    const def: LevelDefinition = {
      ...TEST_LEVEL,
      solids: [],
      hazards: [],
      gravityPortals: [],
      speedPortals: [],
      teleportPortals: [],
      visualSetpieces: [],
      modePortals: [
        { id: 'ship', z: 20, target: 'ship' },
        { id: 'spider', z: 40, target: 'spider' },
      ],
    };
    const view = new LevelView(loadLevel(def), library);
    // 2 portals × (ring + rim + disc + glyph) = 8 meshes, all on the route.
    expect(view.group.children.length).toBe(8);
    for (const child of view.group.children) {
      expect(Math.abs(child.position.x)).toBeLessThanOrEqual(2.2);
    }
    view.dispose();
    library.dispose();
  });

  it('switches the visible model by mode (cube/ship/spider)', () => {
    const library = makeTestLibrary();
    const view = new PlayerView(library);
    view.updateFromSimulation({ x: 0, y: 1, z: 0 }, true, 0.016, 'floor', 'cube');
    expect(view.group.children[0]?.visible).toBe(true);
    expect(view.group.children[1]?.visible).toBe(false);
    view.updateFromSimulation({ x: 0, y: 1, z: 0 }, false, 0.016, 'floor', 'ship', true);
    expect(view.group.children[0]?.visible).toBe(false);
    expect(view.group.children[1]?.visible).toBe(true);
    view.updateFromSimulation({ x: 0, y: 1, z: 0 }, true, 0.016, 'floor', 'spider');
    expect(view.group.children[2]?.visible).toBe(true);
    view.dispose();
    library.dispose();
  });

  it('fires a semantic VFX pulse on mode transitions (bounded pool)', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    runFrames(vfx, sim, 10);
    const before = vfx.countersSnapshot.mode;
    sim.modeTransitionCount = 1;
    sim.playerMode = 'ship';
    runFrames(vfx, sim, 5);
    expect(vfx.countersSnapshot.mode).toBe(before + 1);
    vfx.dispose();
  });
});
