import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { loadLevel } from '../src/level/levelRuntime';
import { LevelView } from '../src/rendering/LevelView';
import { InteractionView } from '../src/rendering/InteractionView';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { PRODUCTION_THEME } from '../src/visuals/productionTheme';
import { idleInput, advance } from './helpers/simulation';
import { makeTestLibrary } from './helpers/visuals';

/**
 * M8A compact professional portal family + bounded teleport entries:
 * - gravity/speed portals render as small round ring gates (never walls);
 * - new teleport entries fire only inside their authored volume (a visual
 *   miss can no longer trigger accidentally);
 * - legacy volume-less teleports keep the plane crossing (compatibility).
 */

const THEME = TEST_LEVEL.theme;
const LANES = [2.6, 0, -2.6];

const bareDef = (overrides: Partial<LevelDefinition> = {}): LevelDefinition => ({
  id: 'm8a-portal-fixture',
  displayName: 'M8A PORTAL FIXTURE',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [...LANES],
  baseForwardSpeed: 14,
  finishZ: 200,
  deathY: -14,
  solids: [{ center: { x: 0, y: -0.5, z: 90 }, halfExtents: { x: 5.4, y: 0.5, z: 100 } }],
  hazards: [],
  theme: THEME,
  ...overrides,
});

describe('M8A compact gravity portal visuals', () => {
  it('renders one small ring gate, not a route-spanning wall', () => {
    const library = makeTestLibrary();
    const view = new LevelView(
      loadLevel(bareDef({ solids: [], gravityPortals: [{ id: 'g', z: 20, target: 'ceiling' }] })),
      library,
    );
    // Ring + inner rim + energy disc + direction glyph = 4 meshes.
    expect(view.group.children.length).toBe(4);
    let maxAbsX = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const child of view.group.children) {
      maxAbsX = Math.max(maxAbsX, Math.abs(child.position.x));
      // Halo tube radius scales with the ring; bound the frame generously.
      expect(Math.abs(child.position.x)).toBeLessThanOrEqual(2.6);
      minY = Math.min(minY, child.position.y);
      maxY = Math.max(maxY, child.position.y);
    }
    expect(maxAbsX).toBe(0);
    // Compact vertically: the ring (r 1.7 at y 1.7) fits in 0..3.4.
    expect(minY).toBeGreaterThanOrEqual(-0.1);
    expect(maxY).toBeLessThanOrEqual(3.5);
    view.dispose();
    library.dispose();
  });

  it('centers ceiling-approach rings high on the approach surface', () => {
    const library = makeTestLibrary();
    const view = new LevelView(
      loadLevel(bareDef({ solids: [], gravityPortals: [{ id: 'g', z: 20, target: 'floor' }] })),
      library,
    );
    expect(view.group.children.length).toBe(4);
    for (const child of view.group.children) {
      expect(child.position.y).toBeCloseTo(4.9, 6);
    }
    view.dispose();
    library.dispose();
  });
});

describe('M8A compact speed portal visuals', () => {
  it('renders a small tier ring, not a post-and-bar gateway', () => {
    const def = bareDef({ speedPortals: [{ id: 's', z: 20, multiplier: 2 }] });
    const sim = new GameSimulation(def);
    const library = makeTestLibrary();
    const view = new InteractionView(sim.level, sim, library, { ...PRODUCTION_THEME });
    // Ring + rim + 2 tier chevrons + 8 pooled VFX rings (idle) = 12.
    expect(view.group.children.length).toBe(12);
    for (const child of view.group.children) {
      if (!child.visible) continue; // pooled VFX rings rest hidden at origin
      expect(Math.abs(child.position.x)).toBeLessThanOrEqual(2.2);
      expect(child.position.y).toBeGreaterThanOrEqual(0);
      expect(child.position.y).toBeLessThanOrEqual(3.5);
    }
    view.dispose();
    library.dispose();
  });
});

describe('M8A bounded teleport entries', () => {
  const volumeDef = (): LevelDefinition =>
    bareDef({
      teleportPortals: [
        {
          id: 't-volume',
          entryZ: 30,
          entryCenter: { x: 0, y: 1, z: 30 },
          entryHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
          exit: { x: 0, y: 1.5, z: 120 },
          exitLaneIndex: 1,
        },
      ],
    });

  it('fires when the swept path passes through the entry volume', () => {
    const sim = new GameSimulation(volumeDef());
    // Settle then run through the volume on the center lane.
    for (let i = 0; i < 120 && !sim.player.grounded; i++) sim.update(idleInput);
    while (sim.status === 'running' && !sim.isTeleportUsed('t-volume')) sim.update(idleInput);
    expect(sim.isTeleportUsed('t-volume')).toBe(true);
    expect(sim.lastTeleportId).toBe('t-volume');
    expect(sim.player.position.z).toBeGreaterThanOrEqual(119);
  });

  it('does NOT fire when flying past the ring outside the volume', () => {
    // Whole run on lane 0 (world x +2.6, footprint 2.05..3.15): outside
    // the ±1.5 entry box while crossing the same Z.
    const def = volumeDef();
    def.startLaneIndex = 0;
    def.start = { x: 2.6, y: 1.5, z: -4 };
    const sim = new GameSimulation(def);
    for (let i = 0; i < 120 && !sim.player.grounded; i++) sim.update(idleInput);
    while (sim.status === 'running' && sim.player.position.z < 40) sim.update(idleInput);
    expect(sim.player.position.z).toBeGreaterThanOrEqual(31);
    expect(sim.isTeleportUsed('t-volume')).toBe(false);
    expect(sim.teleportEventCount).toBe(0);
  });

  it('legacy volume-less teleports keep the plane crossing', () => {
    const sim = new GameSimulation(
      bareDef({
        teleportPortals: [
          {
            id: 't-legacy',
            entryZ: 30,
            exit: { x: 0, y: 1.5, z: 120 },
            exitLaneIndex: 1,
          },
        ],
      }),
    );
    for (let i = 0; i < 120 && !sim.player.grounded; i++) sim.update(idleInput);
    while (sim.status === 'running' && !sim.isTeleportUsed('t-legacy')) sim.update(idleInput);
    expect(sim.isTeleportUsed('t-legacy')).toBe(true);
  });

  it('a lethal step still wins over a bounded entry (death before teleport)', () => {
    const def = volumeDef();
    def.hazards = [
      { kind: 'hazard', center: { x: 0, y: 0.5, z: 29 }, halfExtents: { x: 1, y: 0.5, z: 0.5 } },
    ];
    const sim = new GameSimulation(def);
    for (let i = 0; i < 120 && !sim.player.grounded; i++) sim.update(idleInput);
    while (sim.status === 'running') sim.update(idleInput);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('hazard');
    expect(sim.isTeleportUsed('t-volume')).toBe(false);
  });

  it('bounded volumes are fingerprinted; volume-less teleports hash as before', () => {
    const legacy: LevelDefinition = bareDef({
      teleportPortals: [{ id: 't', entryZ: 30, exit: { x: 0, y: 1.5, z: 120 }, exitLaneIndex: 1 }],
    });
    const bounded: LevelDefinition = bareDef({
      teleportPortals: [
        {
          id: 't',
          entryZ: 30,
          entryCenter: { x: 0, y: 1, z: 30 },
          entryHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
          exit: { x: 0, y: 1.5, z: 120 },
          exitLaneIndex: 1,
        },
      ],
    });
    expect(computeLevelFingerprint(bounded)).not.toBe(computeLevelFingerprint(legacy));
    // Deterministic: same volume definition hashes identically.
    expect(computeLevelFingerprint(bounded)).toBe(computeLevelFingerprint(structuredClone(bounded)));
  });

  it('teleport reset/re-arm works for bounded entries', () => {
    const sim = new GameSimulation(volumeDef());
    for (let i = 0; i < 120 && !sim.player.grounded; i++) sim.update(idleInput);
    while (sim.status === 'running' && !sim.isTeleportUsed('t-volume')) sim.update(idleInput);
    expect(sim.isTeleportUsed('t-volume')).toBe(true);
    const attempts = sim.attempts;
    sim.restart();
    expect(sim.attempts).toBe(attempts + 1);
    expect(sim.isTeleportUsed('t-volume')).toBe(false);
    advance(sim, idleInput, 5);
    expect(sim.status).toBe('running');
  });
});
