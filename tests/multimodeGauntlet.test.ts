import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { MULTIMODE_GAUNTLET_01 } from '../src/content/levels/multimodeGauntlet01';
import { registeredLevelIds } from '../src/content/levelRegistry';
import { validateLavaAuthoring } from '../src/level/lavaAuthoring';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { idleInput } from './helpers/simulation';
import { recordAttempt, playReplay } from './helpers/replay';
import { MultimodeDriver, driveMultimodeToFinish } from './helpers/multimodeGauntletScript';

/**
 * M8E multimode-gauntlet integration contract:
 * - registered + lava physically grounded (no floating slabs)
 * - scripted REAL-INPUT completion (no teleports/state edits): finishes
 *   with zero deaths through every section
 * - all three player modes + all four gravity modes actually entered
 * - both Chompers activate (telegraph → lunge → spent)
 * - wrong maze doors kill frontally; gap pools kill as lava
 * - trap decoys are visibly spiked while the center route stays clean
 * - the completion tape replays VERIFIED (input-only determinism)
 */
describe('M8E multimode gauntlet', () => {
  it('is registered with its own gameplay identity', () => {
    expect(registeredLevelIds()).toContain('multimode-gauntlet-01');
    expect(computeLevelFingerprint(MULTIMODE_GAUNTLET_01)).not.toBe(
      computeLevelFingerprint(TEST_LEVEL),
    );
  });

  it('authors only sourced/contained lava (no floating slabs)', () => {
    expect(validateLavaAuthoring(MULTIMODE_GAUNTLET_01)).toEqual([]);
    expect((MULTIMODE_GAUNTLET_01.lava ?? []).length).toBeGreaterThan(0);
  });

  it('completes through legal inputs with zero deaths (~80-100 s)', () => {
    const sim = new GameSimulation(MULTIMODE_GAUNTLET_01);
    const { ticks, modes, gravities } = driveMultimodeToFinish(sim);
    expect(sim.status).toBe('finished');
    expect(sim.attempts).toBe(1);
    const seconds = ticks / 120;
    expect(seconds).toBeGreaterThan(80);
    expect(seconds).toBeLessThan(100);
    expect([...modes].sort()).toEqual(['cube', 'ship', 'spider']);
    expect([...gravities].sort()).toEqual(['ceiling', 'floor', 'leftWall', 'rightWall']);
    // Both Chompers committed to their lunges and rest spent.
    for (const st of sim.chomperStates) expect(st.phase).toBe('spent');
  });

  it('replays the completion tape VERIFIED', () => {
    const sim = new GameSimulation(MULTIMODE_GAUNTLET_01);
    const coordinator = new ReplayCoordinator(sim);
    const driver = new MultimodeDriver();
    recordAttempt(sim, coordinator, () => driver.nextInput(sim.player.position.z, sim));
    const replay = coordinator.lastReplay;
    expect(replay).not.toBeNull();
    expect(replay?.outcome.status).toBe('finished');
    expect(replay?.levelId).toBe('multimode-gauntlet-01');
    const verification = playReplay(sim, coordinator, replay);
    expect(verification.kind).toBe('pass');
    expect(sim.status).toBe('finished');
  });

  it('kills frontally through the wrong maze door', () => {
    const sim = new GameSimulation(MULTIMODE_GAUNTLET_01);
    // Jump both S1 gaps but hold center: wall 1 (z 180) has its door on
    // lane 0, so the center lane runs straight into killFront.
    const driver = new MultimodeDriver([37.5, 87.5], [], []);
    let tick = 0;
    for (; tick < 6000 && sim.attempts === 1; tick++) {
      sim.update(driver.nextInput(sim.player.position.z, sim));
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('frontImpact');
    expect(sim.deathPosition.z).toBeGreaterThan(150);
    expect(sim.deathPosition.z).toBeLessThan(200);
  });

  it('kills as lava in the S1 gap basins', () => {
    const sim = new GameSimulation(MULTIMODE_GAUNTLET_01);
    // No jumps at all: the Cube drops into the first gap basin.
    for (let tick = 0; tick < 2000 && sim.attempts === 1; tick++) {
      sim.update(idleInput);
    }
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathCause).toBe('lava');
  });

  it('traps read visibly: decoy islands are spiked, the center route is clean', () => {
    const def = MULTIMODE_GAUNTLET_01;
    const decoySpikes = def.hazards.filter(
      (h) => Math.abs(h.center.x) > 2 && h.center.z >= 1000 && h.center.z <= 1030,
    );
    expect(decoySpikes.length).toBe(8);
    const centerHazards = def.hazards.filter(
      (h) => Math.abs(h.center.x) < 2 && h.center.z >= 990 && h.center.z <= 1030,
    );
    expect(centerHazards).toEqual([]);
  });
});
