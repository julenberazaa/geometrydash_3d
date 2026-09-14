import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { loadLevel } from '../src/level/levelRuntime';
import { LevelView } from '../src/rendering/LevelView';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { validatePortalBounds } from '../src/level/portalAuthoring';
import { MULTIMODE_GAUNTLET_01 } from '../src/content/levels/multimodeGauntlet01';
import { idleInput, advance } from './helpers/simulation';
import { makeTestLibrary } from './helpers/visuals';

/**
 * M8.1 bounded portal activation (human playtest bug):
 *
 * Gravity / speed / mode portals fired on the bare Z-plane crossing even
 * when the player passed far outside the visible gate opening. Every kind
 * now accepts an optional bounded trigger volume: the swept step path must
 * overlap the gate box, or nothing fires. Volume-less definitions keep the
 * legacy plane crossing (compatibility) and hash byte-identically to
 * before (no replay regression).
 */

const THEME = TEST_LEVEL.theme;
const LANES = [2.6, 0, -2.6];

const runway = { center: { x: 0, y: -0.5, z: 90 }, halfExtents: { x: 5.4, y: 0.5, z: 100 } };

const bareDef = (overrides: Partial<LevelDefinition> = {}): LevelDefinition => ({
  id: 'm81-portal-bounds-fixture',
  displayName: 'M8.1 PORTAL BOUNDS FIXTURE',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [...LANES],
  baseForwardSpeed: 14,
  finishZ: 200,
  deathY: -14,
  deathYMax: 14,
  solids: [{ ...runway }],
  hazards: [],
  theme: THEME,
  ...overrides,
});

const GATE = {
  triggerCenter: { x: 0, y: 1.5, z: 60 },
  triggerHalfExtents: { x: 2, y: 2, z: 1.5 },
};

describe('M8.1 bounded gravity portals', () => {
  it('fires inside the gate volume', () => {
    const sim = new GameSimulation(
      bareDef({ gravityPortals: [{ id: 'g', z: 60, target: 'ceiling', ...GATE }] }),
    );
    advance(sim, idleInput, 600);
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.lastPortalId).toBe('g');
  });

  it('does NOT fire when crossing the plane outside the volume', () => {
    const def = bareDef({
      start: { x: 0, y: 10, z: -4 },
      gravityPortals: [{ id: 'g', z: 60, target: 'ceiling', ...GATE }],
      solids: [
        { center: { x: 0, y: 8.5, z: 90 }, halfExtents: { x: 5.4, y: 0.5, z: 100 } },
      ],
    });
    const sim = new GameSimulation(def);
    // Ride a high slab 8.5 u above the gate: same Z crossing, no trigger.
    for (let i = 0; i < 200 && sim.status === 'running'; i++) sim.update(idleInput);
    advance(sim, idleInput, 400);
    expect(sim.player.position.z).toBeGreaterThan(60);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.lastPortalId).toBeNull();
  });

  it('legacy volume-less portals keep the plane crossing', () => {
    const sim = new GameSimulation(
      bareDef({ gravityPortals: [{ id: 'g', z: 60, target: 'ceiling' }] }),
    );
    advance(sim, idleInput, 600);
    expect(sim.gravityMode).toBe('ceiling');
  });
});

describe('M8.1 bounded speed portals', () => {
  const speedDef = (startX: number, bounded: boolean): LevelDefinition =>
    bareDef({
      start: { x: startX, y: 1.5, z: -4 },
      // Lane intent matches the start X, so the cube holds its line.
      startLaneIndex: startX === 0 ? 1 : 0,
      speedPortals: bounded
        ? [{ id: 's', z: 60, multiplier: 2, ...GATE }]
        : [{ id: 's', z: 60, multiplier: 2 }],
    });

  it('fires inside the gate volume', () => {
    const sim = new GameSimulation(speedDef(0, true));
    advance(sim, idleInput, 600);
    expect(sim.speedMultiplier).toBe(2);
  });

  it('does NOT fire when crossing the plane outside the volume', () => {
    // Wide runway lets lane 0 (x = 2.6) pass beside the narrow gate.
    const sim = new GameSimulation(speedDef(2.6, true));
    advance(sim, idleInput, 600);
    expect(sim.player.position.z).toBeGreaterThan(60);
    expect(sim.speedMultiplier).toBe(1);
  });

  it('legacy volume-less speed portals keep the plane crossing', () => {
    const sim = new GameSimulation(speedDef(2.6, false));
    advance(sim, idleInput, 600);
    expect(sim.speedMultiplier).toBe(2);
  });
});

describe('M8.1 bounded mode portals', () => {
  it('fires inside the gate volume, misses outside it', () => {
    const through = new GameSimulation(
      bareDef({ modePortals: [{ id: 'm', z: 60, target: 'ship', ...GATE }] }),
    );
    advance(through, idleInput, 600);
    expect(through.playerMode).toBe('ship');

    const past = new GameSimulation(
      bareDef({
        start: { x: 0, y: 10, z: -4 },
        solids: [
          { center: { x: 0, y: 8.5, z: 90 }, halfExtents: { x: 5.4, y: 0.5, z: 100 } },
        ],
        modePortals: [{ id: 'm', z: 60, target: 'ship', ...GATE }],
      }),
    );
    for (let i = 0; i < 200 && past.status === 'running'; i++) past.update(idleInput);
    advance(past, idleInput, 400);
    expect(past.player.position.z).toBeGreaterThan(60);
    expect(past.playerMode).toBe('cube');
  });

  it('legacy volume-less mode portals keep the plane crossing', () => {
    const sim = new GameSimulation(
      bareDef({ modePortals: [{ id: 'm', z: 60, target: 'ship' }] }),
    );
    advance(sim, idleInput, 600);
    expect(sim.playerMode).toBe('ship');
  });
});

describe('M8.1 volume/visual agreement', () => {
  it('bounded gravity rings render on their trigger volume', () => {
    const library = makeTestLibrary();
    const view = new LevelView(
      loadLevel(
        bareDef({
          solids: [],
          gravityPortals: [
            {
              id: 'g',
              z: 60,
              target: 'ceiling',
              triggerCenter: { x: 1, y: 2.5, z: 60 },
              triggerHalfExtents: { x: 2, y: 2, z: 1.5 },
            },
          ],
        }),
      ),
      library,
    );
    // Ring + rim + disc + glyph all share the volume center.
    expect(view.group.children.length).toBe(4);
    for (const child of view.group.children) {
      expect(child.position.x).toBeCloseTo(1, 6);
      expect(child.position.y).toBeCloseTo(2.5, 6);
    }
    view.dispose();
    library.dispose();
  });

  it('bounded mode rings render on their trigger volume', () => {
    const library = makeTestLibrary();
    const sim = new GameSimulation(
      bareDef({
        modePortals: [
          {
            id: 'm',
            z: 60,
            target: 'ship',
            triggerCenter: { x: -1, y: 2, z: 60 },
            triggerHalfExtents: { x: 2, y: 2, z: 1.5 },
          },
        ],
      }),
    );
    const view = new LevelView(sim.level, library);
    // The mode gate (ring + rim + disc + glyph) sits on the volume
    // center; the runway meshes live far from the gate plane.
    const gate = view.group.children.filter(
      (c) => Math.abs(c.position.z - 60) < 0.01,
    );
    expect(gate.length).toBe(4);
    for (const child of gate) {
      expect(child.position.x).toBeCloseTo(-1, 6);
      expect(child.position.y).toBeCloseTo(2, 6);
    }
    view.dispose();
    library.dispose();
  });
});

describe('M8.1 portal-volume fingerprints', () => {
  it('volume-less portals hash as before; volumes change the hash reversibly', () => {
    const plain = bareDef({
      gravityPortals: [{ id: 'g', z: 60, target: 'ceiling' }],
      speedPortals: [{ id: 's', z: 80, multiplier: 2 }],
      modePortals: [{ id: 'm', z: 100, target: 'ship' }],
    });
    const before = computeLevelFingerprint(plain);
    const bounded = bareDef({
      gravityPortals: [{ id: 'g', z: 60, target: 'ceiling', ...GATE }],
      speedPortals: [{ id: 's', z: 80, multiplier: 2, ...GATE }],
      modePortals: [{ id: 'm', z: 100, target: 'ship', ...GATE }],
    });
    // Volumes are gameplay: the hash MUST move (a trigger changed).
    expect(computeLevelFingerprint(bounded)).not.toBe(before);
    // Removing the volumes restores the exact original bytes.
    expect(computeLevelFingerprint(plain)).toBe(before);
  });
});

/**
 * M8.2 opening-sized gates (human playtest: "state changes even if the
 * player passes outside the portal").
 *
 * Root cause (proven): the M8.1 mechanism was exact, but gauntlet volumes
 * were corridor-sized boxes — passing 3+ u beside the visible ring still
 * overlapped the box and fired. Volumes must match the ring OPENING
 * (radius + margin), enforced by `validatePortalBounds`.
 */
describe('M8.2 opening-sized gates', () => {
  // Ring 1.45 + margin → an opening-sized gate half of 1.6.
  const SMALL_GATE = {
    triggerCenter: { x: 0, y: 1.5, z: 60 },
    triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
  };
  // Corridor line past the ring: lane 0 (x = 2.6) clears a 1.6-half gate
  // (player box 2.05..3.15 vs gate max 1.6) but sat INSIDE the old M8.1
  // corridor boxes — the exact reported scenario.
  const besideDef = (overrides: Partial<LevelDefinition> = {}): LevelDefinition =>
    bareDef({
      start: { x: 2.6, y: 1.5, z: -4 },
      startLaneIndex: 0,
      ...overrides,
    });

  it('gravity: through the opening fires, lane-0 line past the ring does NOT', () => {
    const through = new GameSimulation(
      bareDef({ gravityPortals: [{ id: 'g', z: 60, target: 'ceiling', ...SMALL_GATE }] }),
    );
    advance(through, idleInput, 600);
    expect(through.gravityMode).toBe('ceiling');

    const beside = new GameSimulation(
      besideDef({ gravityPortals: [{ id: 'g', z: 60, target: 'ceiling', ...SMALL_GATE }] }),
    );
    advance(beside, idleInput, 600);
    expect(beside.player.position.z).toBeGreaterThan(60);
    expect(beside.gravityMode).toBe('floor');
    expect(beside.lastPortalId).toBeNull();
  });

  it('mode: through the opening fires, lane-0 line past the ring does NOT', () => {
    const through = new GameSimulation(
      bareDef({ modePortals: [{ id: 'm', z: 60, target: 'ship', ...SMALL_GATE }] }),
    );
    advance(through, idleInput, 600);
    expect(through.playerMode).toBe('ship');

    const beside = new GameSimulation(
      besideDef({ modePortals: [{ id: 'm', z: 60, target: 'ship', ...SMALL_GATE }] }),
    );
    advance(beside, idleInput, 600);
    expect(beside.player.position.z).toBeGreaterThan(60);
    expect(beside.playerMode).toBe('cube');
  });

  it('speed: through the opening fires, lane-0 line past the ring does NOT', () => {
    const through = new GameSimulation(
      bareDef({ speedPortals: [{ id: 's', z: 60, multiplier: 2, ...SMALL_GATE }] }),
    );
    advance(through, idleInput, 600);
    expect(through.speedMultiplier).toBe(2);

    const beside = new GameSimulation(
      besideDef({ speedPortals: [{ id: 's', z: 60, multiplier: 2, ...SMALL_GATE }] }),
    );
    advance(beside, idleInput, 600);
    expect(beside.player.position.z).toBeGreaterThan(60);
    expect(beside.speedMultiplier).toBe(1);
  });

  it('teleport: bounded entry fires through the ring, not past it', () => {
    const entry = {
      entryCenter: { x: 0, y: 1.5, z: 60 },
      entryHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
    };
    const portal = (extra: object): object => ({
      id: 't',
      entryZ: 60,
      exit: { x: 0, y: 1.5, z: 100 },
      exitLaneIndex: 1,
      ...entry,
      ...extra,
    });
    const through = new GameSimulation(
      bareDef({ teleportPortals: [portal({}) as never] }),
    );
    advance(through, idleInput, 600);
    expect(through.teleportEventCount).toBe(1);

    const beside = new GameSimulation(
      besideDef({ teleportPortals: [portal({}) as never] }),
    );
    advance(beside, idleInput, 600);
    expect(beside.player.position.z).toBeGreaterThan(60);
    expect(beside.player.position.z).toBeLessThan(100);
    expect(beside.teleportEventCount).toBe(0);
  });

  it('a missed gravity gate fails later by geometry (void), never by fiat', () => {
    // Gate hangs high above the floor run (unreachable); the floor ends
    // in a 10 u gap right after — the runner falls to the void on the
    // ORIGINAL surface with no portal state mutated.
    const sim = new GameSimulation(
      bareDef({
        solids: [
          { center: { x: 0, y: -0.5, z: 30 }, halfExtents: { x: 5.4, y: 0.5, z: 40 } },
          { center: { x: 0, y: -0.5, z: 135 }, halfExtents: { x: 5.4, y: 0.5, z: 55 } },
        ],
        gravityPortals: [
          {
            id: 'g',
            z: 60,
            target: 'ceiling',
            triggerCenter: { x: 0, y: 6, z: 60 },
            triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
          },
        ],
      }),
    );
    for (let i = 0; i < 1200 && sim.status === 'running'; i++) sim.update(idleInput);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('void');
    expect(sim.gravityMode).toBe('floor');
    expect(sim.lastPortalId).toBeNull();
  });
});

describe('M8.2 portal-volume authoring validation', () => {
  it('rejects corridor-sized volumes, off-plane centers, degenerate boxes', () => {
    const big = bareDef({
      gravityPortals: [
        {
          id: 'g',
          z: 60,
          target: 'ceiling',
          triggerCenter: { x: 0, y: 1.5, z: 60 },
          triggerHalfExtents: { x: 5, y: 2.5, z: 1.5 },
        },
      ],
    });
    expect(validatePortalBounds(big).length).toBeGreaterThan(0);

    const offPlane = bareDef({
      modePortals: [
        {
          id: 'm',
          z: 60,
          target: 'ship',
          triggerCenter: { x: 0, y: 1.5, z: 58 },
          triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
        },
      ],
    });
    expect(validatePortalBounds(offPlane).length).toBeGreaterThan(0);

    const degenerate = bareDef({
      speedPortals: [
        {
          id: 's',
          z: 60,
          multiplier: 2,
          triggerCenter: { x: 0, y: 1.5, z: 60 },
          triggerHalfExtents: { x: 0.1, y: 1.5, z: 1.5 },
        },
      ],
    });
    expect(validatePortalBounds(degenerate).length).toBeGreaterThan(0);
  });

  it('accepts opening-sized gates; the gauntlet validates clean', () => {
    const ok = bareDef({
      gravityPortals: [
        {
          id: 'g',
          z: 60,
          target: 'ceiling',
          triggerCenter: { x: 0, y: 1.5, z: 60 },
          triggerHalfExtents: { x: 1.6, y: 1.6, z: 1.5 },
        },
      ],
    });
    expect(validatePortalBounds(ok)).toEqual([]);
    expect(validatePortalBounds(MULTIMODE_GAUNTLET_01)).toEqual([]);
  });
});
