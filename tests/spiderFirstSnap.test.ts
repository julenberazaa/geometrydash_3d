import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import type { PhysicalInputSnapshot } from '../src/input/InputSystem';
import { idleInput } from './helpers/simulation';

/**
 * M9.3 spider first-snap regression (human-observed bug):
 *
 * A primary press on the exact mode-entry step was consumed by the
 * pre-portal mode (cube jump) while the handoff zeroed the jump's only
 * effect — a hidden dead input forcing a double-press for the first
 * upside-down snap. `processModePortals` now honors the entry-step edge
 * as a snap attempt, so the first valid snap behaves exactly like later
 * ones (contract in `GameSimulation.trySpiderSnap`).
 */

const THEME = TEST_LEVEL.theme;
const LANES = [2.6, 0, -2.6];

const edge = (held: boolean, pressed: boolean) => ({
  held,
  pressedThisStep: pressed,
  releasedThisStep: false,
});
/** Single Space tap edge (press + release in one step). */
const pressSpace: PhysicalInputSnapshot = {
  space: { held: false, pressedThisStep: true, releasedThisStep: true },
  up: edge(false, false),
  down: edge(false, false),
  laneLeft: edge(false, false),
  laneRight: edge(false, false),
};
/** Space held with NO edge (must never snap — edge only). */
const holdSpaceHeld: PhysicalInputSnapshot = {
  space: { held: true, pressedThisStep: false, releasedThisStep: false },
  up: edge(false, false),
  down: edge(false, false),
  laneLeft: edge(false, false),
  laneRight: edge(false, false),
};

interface ArenaOpts {
  /** Underside height of the ceiling slab (undefined = no ceiling). */
  ceilingUnderside?: number;
  /** Hazard band filling the snap transit (kills like a normal snap). */
  transitHazard?: boolean;
  /** Checkpoint before the gate (restore path). */
  checkpoint?: boolean;
}

/** Spider room: floor runway + optional ceiling, bounded spider gate. */
const makeArena = (opts: ArenaOpts = {}): GameSimulation => {
  const solids: LevelDefinition['solids'] = [
    { center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 150 } },
  ];
  if (opts.ceilingUnderside !== undefined) {
    const u = opts.ceilingUnderside;
    solids.push({ center: { x: 0, y: u + 0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 150 } });
  }
  const hazards: LevelDefinition['hazards'] =
    opts.transitHazard === true
      ? // Band inside the snap transit (y 1.2..4.9, z 3..13) but above the
        // grounded cube path (box top 1.1) — the cube reaches the gate
        // alive, the entry-step snap transit crosses the band and dies.
        [{ kind: 'hazard', visual: 'spike', center: { x: 0, y: 3.05, z: 8 }, halfExtents: { x: 0.5, y: 1.85, z: 5 } }]
      : [];
  const def: LevelDefinition = {
    id: 'm93-spider-first-snap',
    displayName: 'M9.3 SPIDER FIRST SNAP',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: 300,
    deathY: -14,
    deathYMax: 14,
    solids,
    hazards,
    modePortals: [
      {
        id: 'spider-on',
        z: 10,
        target: 'spider',
        triggerCenter: { x: 0, y: 1.5, z: 10 },
        triggerHalfExtents: { x: 1.5, y: 1.5, z: 1.5 },
      },
    ],
    theme: THEME,
  };
  if (opts.checkpoint === true) {
    def.checkpoints = [
      {
        id: 'cp-entry',
        displayName: 'ENTRY',
        center: { x: 0, y: 0.55, z: 4 },
        halfExtents: { x: 2, y: 1.2, z: 2.5 },
      },
    ];
  }
  return new GameSimulation(def);
};

/** Idle-step count of the step on which the spider gate fires. */
const findEntryTick = (sim: GameSimulation, budget = 3000): number => {
  for (let i = 1; i <= budget; i++) {
    sim.update(idleInput);
    if (sim.playerMode === 'spider') return i;
  }
  throw new Error('never entered spider mode');
};

describe('M9.3 spider first-snap contract', () => {
  it('a press ON the entry step snaps upside-down (no double-press)', () => {
    const entryTick = findEntryTick(makeArena({ ceilingUnderside: 6 }));
    const sim = makeArena({ ceilingUnderside: 6 });
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.status).toBe('running');
    expect(sim.playerMode).toBe('spider');
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.player.position.y).toBeCloseTo(5.45, 5);
    // The entry snap resolves at the bottom of the step (post-portal), so
    // no grounding probe runs after it — the very next step grounds.
    expect(sim.player.grounded).toBe(false);
    sim.update(idleInput);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.supportColliderId).not.toBeNull();
  });

  it('a press one step AFTER entry snaps identically (first-action parity)', () => {
    const entryTick = findEntryTick(makeArena({ ceilingUnderside: 6 }));
    const sim = makeArena({ ceilingUnderside: 6 });
    for (let i = 1; i <= entryTick; i++) sim.update(idleInput);
    expect(sim.playerMode).toBe('spider');
    expect(sim.gravityMode).toBe('floor');
    sim.update(pressSpace);
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.player.position.y).toBeCloseTo(5.45, 5);
    expect(sim.player.grounded).toBe(true);
  });

  it('held input without an edge on entry does not auto-snap', () => {
    const entryTick = findEntryTick(makeArena({ ceilingUnderside: 6 }));
    const sim = makeArena({ ceilingUnderside: 6 });
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(holdSpaceHeld);
    expect(sim.playerMode).toBe('spider');
    expect(sim.gravityMode).toBe('floor');
  });

  it('entry-step press with no opposite support is safely ignored', () => {
    const entryTick = findEntryTick(makeArena());
    const sim = makeArena();
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.status).toBe('running');
    expect(sim.playerMode).toBe('spider');
    expect(sim.gravityMode).toBe('floor');
  });

  it('entry-step press through a transit hazard dies like a normal snap', () => {
    const entryTick = findEntryTick(makeArena({ ceilingUnderside: 6, transitHazard: true }));
    const sim = makeArena({ ceilingUnderside: 6, transitHazard: true });
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.status).toBe('dead');
    // Lethal wins: no gravity flip on the killing step.
    expect(sim.gravityMode).toBe('floor');
  });

  it('M9.3 DESCENT entry: entry-step press performs the first upside-down snap', () => {
    const placed = (): GameSimulation => {
      const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
      sim.debugPlaceAt(0, 0.55, 1340);
      return sim;
    };
    const entryTick = findEntryTick(placed());
    const sim = placed();
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.status).toBe('running');
    expect(sim.playerMode).toBe('spider');
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.player.position.y).toBeCloseTo(9.45, 5);
  });

  it('restart re-arms the entry edge (entry-step press snaps again)', () => {
    const entryTick = findEntryTick(makeArena({ ceilingUnderside: 6 }));
    const sim = makeArena({ ceilingUnderside: 6 });
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.gravityMode).toBe('ceiling');
    sim.restart();
    expect(sim.playerMode).toBe('cube');
    // Restart returns to the origin deterministically: the same tick
    // crosses the gate again, and the entry-step press snaps again.
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.playerMode).toBe('spider');
    expect(sim.gravityMode).toBe('ceiling');
  });

  it('checkpoint restore preserves the entry edge (re-cross + entry press snaps)', () => {
    const entryTick = findEntryTick(makeArena({ ceilingUnderside: 6, checkpoint: true }));
    const sim = makeArena({ ceilingUnderside: 6, checkpoint: true });
    sim.setCheckpointRespawnEnabled(true);
    // Drive past the checkpoint (z4) and the gate with an entry-step press.
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.isCheckpointActivated('cp-entry')).toBe(true);
    // Checkpoint respawn returns to the pre-entry snapshot; re-crossing
    // the gate with an entry-step press must snap again. Restores are
    // idempotent, so measure the re-cross offset, restore again, and
    // press on the exact re-entry step.
    sim.respawn();
    expect(sim.playerMode).toBe('cube');
    let reEntry = 0;
    while (sim.playerMode !== 'spider' && reEntry < 3000) {
      sim.update(idleInput);
      reEntry++;
    }
    expect(sim.playerMode).toBe('spider');
    sim.respawn();
    for (let i = 1; i < reEntry; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.playerMode).toBe('spider');
    expect(sim.gravityMode).toBe('ceiling');
  });
});
