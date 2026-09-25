import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { idleInput } from './helpers/simulation';

/**
 * M9.4 live mode-switch simulation contract (headless):
 * - toggling the checkpoint flag never moves the player or the clock
 * - disarming keeps earned snapshots internally (retention rule) but they
 *   are NOT usable while classic is active (death -> origin)
 * - re-arming makes the already-earned checkpoint usable again
 * - R follows the CURRENT flag; restartRun clears progress + disarms
 * - the attempt-taint decision itself lives in RunModeController
 *   (tests/runModeController.test.ts); Game wires it to these mechanics
 */
const TOGGLE_LEVEL: LevelDefinition = {
  id: 'm94-toggle-runway',
  displayName: 'M94 TOGGLE RUNWAY',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 14,
  finishZ: 300,
  deathY: -14,
  checkpoints: [
    { id: 'cp-a', displayName: 'A', center: { x: 0, y: 0.55, z: 50 }, halfExtents: { x: 2, y: 1.2, z: 2.5 } },
    { id: 'cp-b', displayName: 'B', center: { x: 0, y: 0.55, z: 120 }, halfExtents: { x: 2, y: 1.2, z: 2.5 } },
  ],
  solids: [{ center: { x: 0, y: -0.5, z: 148 }, halfExtents: { x: 5.4, y: 0.5, z: 160 } }],
  hazards: [],
  theme: TEST_LEVEL.theme,
};

const stepIdle = (sim: GameSimulation, ticks: number): void => {
  for (let i = 0; i < ticks; i++) sim.update(idleInput);
};

/** Place the runner inside a checkpoint volume until it activates. */
const activate = (sim: GameSimulation, id: 'cp-a' | 'cp-b'): void => {
  const cp = TOGGLE_LEVEL.checkpoints?.find((c) => c.id === id);
  if (!cp) throw new Error(`unknown checkpoint ${id}`);
  sim.debugPlaceAt(cp.center.x, cp.center.y, cp.center.z);
  for (let i = 0; i < 10 && sim.activeCheckpointId !== id; i++) sim.update(idleInput);
  expect(sim.activeCheckpointId).toBe(id);
};

/** Void-kill the runner and step through the death hold to auto-respawn. */
const killAndRespawn = (sim: GameSimulation): void => {
  const p = sim.player.position;
  sim.debugPlaceAt(p.x, -100, p.z);
  let guard = 0;
  while (sim.status !== 'dead' && guard++ < 10) sim.update(idleInput);
  expect(sim.status).toBe('dead');
  guard = 0;
  while (sim.status !== 'running' && guard++ < 200) sim.update(idleInput);
  expect(sim.status).toBe('running');
};

describe('M9.4 live checkpoint toggle (simulation)', () => {
  it('classic death respawns at the origin', () => {
    const sim = new GameSimulation(TOGGLE_LEVEL);
    stepIdle(sim, 120);
    expect(sim.player.position.z).toBeGreaterThan(0);
    killAndRespawn(sim);
    expect(sim.player.position.z).toBeCloseTo(-4, 1);
    expect(sim.activeCheckpointId).toBeNull();
  });

  it('checkpoint death respawns at the latest crystal', () => {
    const sim = new GameSimulation(TOGGLE_LEVEL);
    sim.setCheckpointRespawnEnabled(true);
    activate(sim, 'cp-a');
    killAndRespawn(sim);
    expect(sim.activeCheckpointId).toBe('cp-a');
    expect(sim.player.position.z).toBeCloseTo(50, 0);
  });

  it('disarming keeps the earned snapshot but death goes to the origin', () => {
    const sim = new GameSimulation(TOGGLE_LEVEL);
    sim.setCheckpointRespawnEnabled(true);
    activate(sim, 'cp-a');
    // CHECKPOINT -> CLASSIC mid-attempt: snapshot retained internally...
    sim.setCheckpointRespawnEnabled(false);
    expect(sim.activeCheckpointId).toBe('cp-a');
    // ...but NOT usable while classic is active.
    killAndRespawn(sim);
    expect(sim.player.position.z).toBeCloseTo(-4, 1);
  });

  it('re-arming makes the already-earned checkpoint usable again', () => {
    const sim = new GameSimulation(TOGGLE_LEVEL);
    sim.setCheckpointRespawnEnabled(true);
    activate(sim, 'cp-a');
    sim.setCheckpointRespawnEnabled(false);
    killAndRespawn(sim);
    expect(sim.player.position.z).toBeCloseTo(-4, 1);
    // CHECKPOINT back ON: the earned crystal restores without re-earning.
    sim.setCheckpointRespawnEnabled(true);
    killAndRespawn(sim);
    expect(sim.activeCheckpointId).toBe('cp-a');
    expect(sim.player.position.z).toBeCloseTo(50, 0);
  });

  it('R follows the current flag (checkpoint -> latest, classic -> origin)', () => {
    const sim = new GameSimulation(TOGGLE_LEVEL);
    sim.setCheckpointRespawnEnabled(true);
    activate(sim, 'cp-b');
    sim.restart();
    expect(sim.player.position.z).toBeCloseTo(120, 0);
    sim.setCheckpointRespawnEnabled(false);
    sim.restart();
    expect(sim.player.position.z).toBeCloseTo(-4, 1);
  });

  it('toggling never moves the player or the clock', () => {
    const sim = new GameSimulation(TOGGLE_LEVEL);
    stepIdle(sim, 60);
    const before = { ...sim.player.position };
    const timeBefore = sim.elapsedSimTime;
    sim.setCheckpointRespawnEnabled(true);
    sim.setCheckpointRespawnEnabled(false);
    sim.setCheckpointRespawnEnabled(true);
    expect(sim.player.position.x).toBe(before.x);
    expect(sim.player.position.y).toBe(before.y);
    expect(sim.player.position.z).toBe(before.z);
    expect(sim.elapsedSimTime).toBe(timeBefore);
  });

  it('restartRun clears progress and disarms', () => {
    const sim = new GameSimulation(TOGGLE_LEVEL);
    sim.setCheckpointRespawnEnabled(true);
    activate(sim, 'cp-a');
    sim.restartRun();
    expect(sim.isCheckpointRespawnEnabled).toBe(false);
    expect(sim.activeCheckpointId).toBeNull();
    expect(sim.player.position.z).toBeCloseTo(-4, 1);
  });

  it('both production levels expose 8 valid checkpoint crystals', () => {
    for (const def of [THE_DESCENT_CLASSIC]) {
      expect((def.checkpoints ?? []).length).toBe(8);
    }
    // Earned progress is per-simulation: two sessions never share it.
    const a = new GameSimulation(TOGGLE_LEVEL);
    const b = new GameSimulation(TOGGLE_LEVEL);
    a.setCheckpointRespawnEnabled(true);
    activate(a, 'cp-a');
    expect(b.activeCheckpointId).toBeNull();
  });
});
