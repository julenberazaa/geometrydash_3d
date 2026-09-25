import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import type { PhysicalInputSnapshot } from '../src/input/InputSystem';
import { idleInput } from './helpers/simulation';

/**
 * M9.6 spider observability + press-forgiveness contract.
 *
 * Audit findings (see the M9.6 spec):
 * - C5: an ignored spider press was silent (no counter, no anchor) — it
 *   read exactly like a dropped input. Snaps now record
 *   `spiderSnapEventCount` + `lastSpiderSnapFrom/To`; ignored presses
 *   record `spiderRejectCount` + `lastSpiderRejectReason`.
 * - D2: a press that lands while no opposite support is in range was
 *   silently ignored (zero forgiveness). A 6-tick deterministic buffer
 *   re-attempts the snap as the player travels into range. The buffer
 *   ONLY re-attempts the snap — it never fabricates input (pads/orbs/
 *   gravity logic never observe it), it clears on death/respawn/
 *   restart/mode-exit, and it rides checkpoint snapshots.
 *
 * Arenas below mirror `spiderFirstSnap.test.ts` (own local copies — test
 * files must never import another `*.test.ts` module).
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

interface ArenaOpts {
  /** Ceiling slab z-range start (undefined = no ceiling → no support). */
  ceilingZ0?: number;
  /** Underside height of the ceiling slab (default 6). */
  ceilingUnderside?: number;
  /** Tall side wall scraping the runner (forces the blocked verdict). */
  sideWall?: boolean;
}

const makeArena = (opts: ArenaOpts = {}): GameSimulation => {
  const solids: LevelDefinition['solids'] = [
    { center: { x: 0, y: -0.5, z: 140 }, halfExtents: { x: 5.4, y: 0.5, z: 150 } },
  ];
  if (opts.ceilingZ0 !== undefined) {
    const u = opts.ceilingUnderside ?? 6;
    const z0 = opts.ceilingZ0;
    const z1 = 150;
    solids.push({
      center: { x: 0, y: u + 0.5, z: (z0 + z1) / 2 },
      halfExtents: { x: 5.4, y: 0.5, z: (z1 - z0) / 2 },
    });
  }
  if (opts.sideWall === true) {
    // Tall slab intruding 0.15 into the runner's x-footprint: the Z
    // straddle rule lets forward motion continue (parallel rest), while
    // any upward snap transit overlaps it with a face strictly short of
    // the ceiling plane → the press is blocked, never a clip.
    solids.push({
      center: { x: 2.7, y: 4.5, z: 140 },
      halfExtents: { x: 2.3, y: 5.5, z: 150 },
    });
  }
  const def: LevelDefinition = {
    id: 'm96-spider-snap',
    displayName: 'M9.6 SPIDER SNAP',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: 300,
    deathY: -14,
    deathYMax: 14,
    solids,
    hazards: [],
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

describe('M9.6 spider observability + press buffer', () => {
  it('an immediate snap records the count and the exact travel anchors', () => {
    const entryTick = findEntryTick(makeArena({ ceilingZ0: -10 }));
    const sim = makeArena({ ceilingZ0: -10 });
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.status).toBe('running');
    expect(sim.playerMode).toBe('spider');
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.spiderSnapEventCount).toBe(1);
    expect(sim.spiderRejectCount).toBe(0);
    expect(sim.lastSpiderRejectReason).toBeNull();
    // From: the grounded floor runner; to: resting under the ceiling face.
    expect(sim.lastSpiderSnapFrom.y).toBeCloseTo(0.55, 2);
    expect(sim.lastSpiderSnapTo.y).toBeCloseTo(5.45, 5);
    expect(sim.lastSpiderSnapTo.x).toBeCloseTo(sim.player.position.x, 9);
    expect(sim.lastSpiderSnapTo.z).toBeCloseTo(sim.player.position.z, 9);
  });

  it('a press with no opposite support is rejected (no-support), once', () => {
    const entryTick = findEntryTick(makeArena());
    const sim = makeArena();
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.status).toBe('running');
    expect(sim.playerMode).toBe('spider');
    expect(sim.gravityMode).toBe('floor');
    expect(sim.spiderSnapEventCount).toBe(0);
    expect(sim.spiderRejectCount).toBe(1);
    expect(sim.lastSpiderRejectReason).toBe('no-support');
    // Buffered re-attempts tick down without double-counting the reject.
    for (let i = 0; i < 10; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.spiderSnapEventCount).toBe(0);
    expect(sim.spiderRejectCount).toBe(1);
  });

  it('a press whose transit is blocked is rejected (blocked), once', () => {
    const entryTick = findEntryTick(makeArena({ ceilingZ0: -10, sideWall: true }));
    const sim = makeArena({ ceilingZ0: -10, sideWall: true });
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    expect(sim.status).toBe('running');
    sim.update(pressSpace);
    expect(sim.status).toBe('running');
    expect(sim.playerMode).toBe('spider');
    // The ceiling is in range but the side wall stands inside the transit:
    // ignored (never clip), never a launch, never a death.
    expect(sim.gravityMode).toBe('floor');
    expect(sim.spiderSnapEventCount).toBe(0);
    expect(sim.spiderRejectCount).toBe(1);
    expect(sim.lastSpiderRejectReason).toBe('blocked');
    for (let i = 0; i < 10; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.spiderRejectCount).toBe(1);
  });

  it('the buffer fires the snap when support comes in range — no second press', () => {
    const probe = makeArena();
    const entryTick = findEntryTick(probe);
    const entryZ = probe.player.position.z;
    // Ceiling starts 0.3 u past the entry footprint: the entry-step press
    // is genuinely ignored, then ~3 ticks of travel bring it in range.
    const sim = makeArena({ ceilingZ0: entryZ + 0.85 });
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.playerMode).toBe('spider');
    expect(sim.gravityMode).toBe('floor');
    expect(sim.spiderRejectCount).toBe(1);
    // Idle only from here — the snap below comes from the armed buffer.
    for (let i = 0; i < 6; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.spiderSnapEventCount).toBe(1);
    expect(sim.player.position.y).toBeCloseTo(5.45, 4);
    // …and the buffer is consumed (no repeat firing).
    for (let i = 0; i < 10; i++) sim.update(idleInput);
    expect(sim.spiderSnapEventCount).toBe(1);
  });

  it('the buffer expires: no phantom snap after the window, fresh press still works', () => {
    const probe = makeArena();
    const entryTick = findEntryTick(probe);
    const entryZ = probe.player.position.z;
    // Ceiling 1.45 u past the entry footprint (~12 ticks away — beyond
    // the 6-tick window).
    const sim = makeArena({ ceilingZ0: entryZ + 2.0 });
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.spiderRejectCount).toBe(1);
    for (let i = 0; i < 8; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.spiderSnapEventCount).toBe(0);
    // Travel on until the footprint overlaps the ceiling: still no snap
    // (the armed press expired — inputs are never invented).
    for (let i = 0; i < 10; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.spiderSnapEventCount).toBe(0);
    // A fresh press edge snaps immediately (support now in range).
    sim.update(pressSpace);
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.spiderSnapEventCount).toBe(1);
  });

  it('restart clears an armed buffer (no cross-attempt press leakage)', () => {
    const entryTick = findEntryTick(makeArena());
    const sim = makeArena();
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.spiderRejectCount).toBe(1);
    sim.restart();
    expect(sim.playerMode).toBe('cube');
    // Re-enter and run idle past the window: the pre-restart press must
    // not fire from beyond the reset.
    for (let i = 1; i <= entryTick; i++) sim.update(idleInput);
    expect(sim.playerMode).toBe('spider');
    for (let i = 0; i < 10; i++) sim.update(idleInput);
    expect(sim.spiderSnapEventCount).toBe(0);
  });

  it('checkpoint snapshots carry the armed buffer across a restore', () => {
    const probe = makeArena();
    const entryTick = findEntryTick(probe);
    const entryZ = probe.player.position.z;
    const sim = makeArena({ ceilingZ0: entryZ + 0.85 });
    for (let i = 1; i < entryTick; i++) sim.update(idleInput);
    sim.update(pressSpace);
    expect(sim.spiderRejectCount).toBe(1);
    const snap = sim.captureCheckpointState('cp-test');
    sim.update(idleInput);
    sim.restoreCheckpointState(snap);
    // The restore re-seats the armed press: idle travel still snaps.
    for (let i = 0; i < 6; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.spiderSnapEventCount).toBe(1);
  });

  it('identical tapes produce identical snap anchors (determinism)', () => {
    const run = (): { count: number; fromY: number; toY: number; grav: string } => {
      const entryTick = findEntryTick(makeArena({ ceilingZ0: -10 }));
      const sim = makeArena({ ceilingZ0: -10 });
      for (let i = 1; i < entryTick; i++) sim.update(idleInput);
      sim.update(pressSpace);
      for (let i = 0; i < 30; i++) sim.update(idleInput);
      return {
        count: sim.spiderSnapEventCount,
        fromY: sim.lastSpiderSnapFrom.y,
        toY: sim.lastSpiderSnapTo.y,
        grav: sim.gravityMode,
      };
    };
    expect(run()).toEqual(run());
  });
});
