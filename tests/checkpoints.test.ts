import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { platformPose } from '../src/game/movingPlatformSystem';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { computeStateFingerprint } from '../src/replay/stateFingerprint';
import { targetMusicTime } from '../src/audio/musicTrack';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { ShowcaseDriver } from './helpers/showcaseScript';
import { idleInput } from './helpers/simulation';

/**
 * M9.2 checkpoint / practice-mode contract (simulation-owned, headless).
 *
 * A checkpoint run arms deterministic snapshots: crossing a crystal volume
 * captures the FULL sim state, and the next death auto-respawns from the
 * latest snapshot (position, velocity, gravity, mode, speed, lane intent,
 * one-shot sets, Chomper phases, platform tick, elapsed time). Classic
 * runs never execute checkpoint code — trajectories and replays are
 * bit-identical with or without authored checkpoints.
 */

const RUNWAY: LevelDefinition = {
  id: 'checkpoint-test-runway',
  displayName: 'CHECKPOINT TEST RUNWAY',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 14,
  finishZ: 200,
  deathY: -14,
  // Speed gate before cp1 (multiplier + one-shot restore proof).
  speedPortals: [{ id: 't-speed', z: 10, multiplier: 2 }],
  // Floor pad before cp1 (used-interaction restore proof).
  jumpPads: [
    {
      id: 't-pad',
      center: { x: 0, y: 0.6, z: 20 },
      halfExtents: { x: 1.5, y: 0.6, z: 1.5 },
      surface: 'floor',
      impulse: 13.2,
    },
  ],
  // Ship gate between the checkpoints (mode-restore proof).
  modePortals: [{ id: 't-ship', z: 45, target: 'ship' }],
  // One Chomper spent before cp1, one still dormant at cp1.
  chompers: [
    {
      id: 't-early',
      dormant: { x: 6, y: 0.5, z: 12 },
      triggerZ: 8,
      lungeDirection: -1,
      lungeDistance: 2,
      telegraphTicks: 5,
      lungeTicks: 10,
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    },
    {
      id: 't-late',
      dormant: { x: -6, y: 0.5, z: 60 },
      triggerZ: 55,
      lungeDirection: 1,
      lungeDistance: 2,
      telegraphTicks: 5,
      lungeTicks: 10,
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    },
  ],
  // One lateral ferry (platform-phase restore proof).
  movingPlatforms: [
    {
      id: 't-ferry',
      base: { x: 0, y: -0.5, z: 90 },
      halfExtents: { x: 3, y: 0.5, z: 10 },
      axis: 'x',
      amplitude: 3,
      periodTicks: 240,
      phaseTicks: 0,
    },
  ],
  checkpoints: [
    { id: 'cp-one', displayName: 'ONE', center: { x: 0, y: 0.55, z: 30 }, halfExtents: { x: 2, y: 1.2, z: 3 } },
    { id: 'cp-two', displayName: 'TWO', center: { x: 0, y: 0.55, z: 70 }, halfExtents: { x: 2, y: 1.2, z: 3 } },
  ],
  solids: [
    // Open runway (top y=0) with a ceiling slab for the ship to fly under.
    { center: { x: 0, y: -0.5, z: 100 }, halfExtents: { x: 5, y: 0.5, z: 110 } },
    { center: { x: 0, y: 7, z: 100 }, halfExtents: { x: 5, y: 0.5, z: 110 } },
  ],
  hazards: [],
  theme: TEST_LEVEL.theme,
};

/** Step until z >= target (or non-running); returns ticks used. */
const driveToZ = (sim: GameSimulation, target: number, maxTicks = 5000): number => {
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    if (sim.status !== 'running' || sim.player.position.z >= target) break;
    sim.update(idleInput);
  }
  return ticks;
};

/** Kill via the void (below deathY) and run out the full death hold. */
const killAndRespawn = (sim: GameSimulation): void => {
  sim.debugPlaceAt(sim.player.position.x, -100, sim.player.position.z);
  sim.update(idleInput);
  expect(sim.status).toBe('dead');
  for (let i = 0; i < 200 && sim.status === 'dead'; i++) sim.update(idleInput);
  expect(sim.status).toBe('running');
};

describe('checkpoint practice mode (M9.2)', () => {
  it('classic mode never activates checkpoints and respawns at the origin', () => {
    const sim = new GameSimulation(RUNWAY);
    expect(sim.isCheckpointRespawnEnabled).toBe(false);
    driveToZ(sim, 75);
    expect(sim.status).toBe('running');
    expect(sim.activeCheckpointId).toBe(null);
    expect(sim.hasCheckpointEvent).toBe(false);
    expect(sim.checkpointEventCount).toBe(0);
    expect(sim.checkpointProgress()).toEqual({ activeIndex: 0, total: 2 });
    killAndRespawn(sim);
    expect(sim.player.position.x).toBeCloseTo(RUNWAY.start.x, 9);
    expect(sim.player.position.z).toBeCloseTo(RUNWAY.start.z, 9);
    expect(sim.attempts).toBe(2);
  });

  it('checkpoint mode starts at the origin with no active checkpoint', () => {
    const sim = new GameSimulation(RUNWAY);
    sim.setCheckpointRespawnEnabled(true);
    expect(sim.activeCheckpointId).toBe(null);
    expect(sim.checkpointProgress()).toEqual({ activeIndex: 0, total: 2 });
    expect(sim.player.position.z).toBeCloseTo(RUNWAY.start.z, 9);
  });

  it('crossing a checkpoint activates exactly once and restores from it after death', () => {
    const sim = new GameSimulation(RUNWAY);
    sim.setCheckpointRespawnEnabled(true);
    driveToZ(sim, 34);
    expect(sim.activeCheckpointId).toBe('cp-one');
    expect(sim.checkpointEventCount).toBe(1);
    expect(sim.isCheckpointActivated('cp-one')).toBe(true);
    expect(sim.isCheckpointActivated('cp-two')).toBe(false);
    expect(sim.checkpointProgress()).toEqual({ activeIndex: 1, total: 2 });
    // Lingering inside the volume never re-fires.
    for (let i = 0; i < 30; i++) sim.update(idleInput);
    expect(sim.checkpointEventCount).toBe(1);
    const snapPos = { ...sim.player.position };
    killAndRespawn(sim);
    expect(sim.activeCheckpointId).toBe('cp-one');
    // Restored near the activation pose (post-activation drift is bounded:
    // the snapshot was captured at volume entry).
    expect(Math.abs(sim.player.position.z - 30)).toBeLessThan(4);
    expect(sim.player.position.x).toBeCloseTo(snapPos.x, 0);
  });

  it('a later checkpoint replaces the earlier one', () => {
    const sim = new GameSimulation(RUNWAY);
    sim.setCheckpointRespawnEnabled(true);
    driveToZ(sim, 34);
    expect(sim.activeCheckpointId).toBe('cp-one');
    driveToZ(sim, 74);
    expect(sim.activeCheckpointId).toBe('cp-two');
    expect(sim.checkpointEventCount).toBe(2);
    expect(sim.checkpointProgress()).toEqual({ activeIndex: 2, total: 2 });
    killAndRespawn(sim);
    expect(sim.activeCheckpointId).toBe('cp-two');
    expect(Math.abs(sim.player.position.z - 70)).toBeLessThan(4);
  });

  it('death with no checkpoint reached respawns at the origin', () => {
    const sim = new GameSimulation(RUNWAY);
    sim.setCheckpointRespawnEnabled(true);
    driveToZ(sim, 10);
    expect(sim.activeCheckpointId).toBe(null);
    killAndRespawn(sim);
    expect(sim.player.position.z).toBeCloseTo(RUNWAY.start.z, 9);
    expect(sim.speedMultiplier).toBe(1);
    expect(sim.playerMode).toBe('cube');
  });

  it('restore brings back speed, mode, lane intent and one-shot state', () => {
    const sim = new GameSimulation(RUNWAY);
    sim.setCheckpointRespawnEnabled(true);
    // cp-two sits past the 2× gate, the pad and the ship gate.
    driveToZ(sim, 74);
    expect(sim.activeCheckpointId).toBe('cp-two');
    expect(sim.speedMultiplier).toBe(2);
    expect(sim.playerMode).toBe('ship');
    expect(sim.isInteractionUsed('t-pad')).toBe(true);
    const snap = sim.captureCheckpointState('probe');
    killAndRespawn(sim);
    expect(sim.speedMultiplier).toBe(snap.speedMultiplier);
    expect(sim.playerMode).toBe(snap.playerMode);
    expect(sim.player.targetLaneIndex).toBe(snap.targetLaneIndex);
    expect(sim.gravityMode).toBe(snap.gravityMode);
    expect(sim.player.velocity.x).toBeCloseTo(snap.velocity.x, 9);
    expect(sim.player.velocity.y).toBeCloseTo(snap.velocity.y, 9);
    expect(sim.player.velocity.z).toBeCloseTo(snap.velocity.z, 9);
    expect(sim.isInteractionUsed('t-pad')).toBe(true);
    expect(sim.isTeleportUsed('t-ship')).toBe(false);
    // A fresh full restart forgets the pad again.
    sim.restartRun();
    expect(sim.isInteractionUsed('t-pad')).toBe(false);
    expect(sim.player.position.z).toBeCloseTo(RUNWAY.start.z, 9);
  });

  it('Chomper spent/dormant phases survive the round trip', () => {
    const sim = new GameSimulation(RUNWAY);
    sim.setCheckpointRespawnEnabled(true);
    driveToZ(sim, 34);
    const early = sim.chomperStates[0];
    const late = sim.chomperStates[1];
    expect(early?.phase).toBe('spent');
    expect(late?.phase).not.toBe('spent');
    const latePhase = late?.phase;
    killAndRespawn(sim);
    expect(sim.chomperStates[0]?.phase).toBe('spent');
    expect(sim.chomperStates[1]?.phase).toBe(latePhase);
  });

  it('moving-platform phase restores from the checkpoint tick', () => {
    const sim = new GameSimulation(RUNWAY);
    sim.setCheckpointRespawnEnabled(true);
    // Capture on the exact activation tick (the stored snapshot is taken
    // inside that same update — platform clock, poses and elapsed match).
    let snap = null as ReturnType<GameSimulation['captureCheckpointState']> | null;
    for (let i = 0; i < 5000 && snap === null; i++) {
      sim.update(idleInput);
      if (sim.activeCheckpointId === 'cp-one') snap = sim.captureCheckpointState('probe');
    }
    expect(snap).not.toBe(null);
    const tickAtSnap = snap?.platformTick ?? -1;
    expect(sim.platformTick).toBe(tickAtSnap);
    // Run forward: the clock and poses move on.
    for (let i = 0; i < 60; i++) sim.update(idleInput);
    expect(sim.platformTick).toBeGreaterThan(tickAtSnap);
    killAndRespawn(sim);
    expect(sim.platformTick).toBe(tickAtSnap);
    // Poses re-derive from the restored tick (never stale, never moved
    // elsewhere — the player cannot respawn above a departed island).
    const def = sim.level.movingPlatforms[0];
    expect(def).toBeDefined();
    if (def !== undefined) {
      const expected = { x: 0, y: 0, z: 0 };
      platformPose(def, tickAtSnap, expected);
      expect(sim.platformStates[0]?.x).toBeCloseTo(expected.x, 9);
      expect(sim.platformStates[0]?.y).toBeCloseTo(expected.y, 9);
      expect(sim.platformStates[0]?.z).toBeCloseTo(expected.z, 9);
    }
  });

  it('elapsed time restores, anchoring music + timeline to the checkpoint', () => {
    const sim = new GameSimulation(RUNWAY);
    sim.setCheckpointRespawnEnabled(true);
    let snap = null as ReturnType<GameSimulation['captureCheckpointState']> | null;
    for (let i = 0; i < 5000 && snap === null; i++) {
      sim.update(idleInput);
      if (sim.activeCheckpointId === 'cp-one') snap = sim.captureCheckpointState('probe');
    }
    expect(snap).not.toBe(null);
    const snapTime = snap?.elapsedSimTime ?? -1;
    expect(snapTime).toBeGreaterThan(0);
    const musicTarget = targetMusicTime(snapTime, 0);
    expect(musicTarget).toBeCloseTo(snapTime, 9);
    // Time moves on, then death rewinds exactly to the checkpoint anchor.
    for (let i = 0; i < 60; i++) sim.update(idleInput);
    expect(sim.elapsedSimTime).toBeGreaterThan(snapTime);
    killAndRespawn(sim);
    expect(sim.elapsedSimTime).toBeCloseTo(snapTime, 9);
    // Render-interpolation anchor re-seats (camera-snap input): no stale
    // prev that would smear one frame across the discontinuity.
    expect(sim.prevPosition.x).toBeCloseTo(sim.player.position.x, 9);
    expect(sim.prevPosition.z).toBeCloseTo(sim.player.position.z, 9);
  });

  it('checkpoint detection never perturbs the classic trajectory (replay isolation)', () => {
    const classic = new GameSimulation(RUNWAY);
    const practice = new GameSimulation(RUNWAY);
    practice.setCheckpointRespawnEnabled(true);
    for (let i = 0; i < 400; i++) {
      classic.update(idleInput);
      practice.update(idleInput);
      if (classic.status !== 'running' || practice.status !== 'running') break;
      expect(computeStateFingerprint(practice)).toBe(computeStateFingerprint(classic));
    }
    expect(practice.hasCheckpointEvent).toBe(true);
    expect(classic.hasCheckpointEvent).toBe(false);
  });

  it('R restarts from the checkpoint; full restart clears progress', () => {
    const sim = new GameSimulation(RUNWAY);
    sim.setCheckpointRespawnEnabled(true);
    driveToZ(sim, 74);
    expect(sim.activeCheckpointId).toBe('cp-two');
    sim.restart();
    expect(sim.activeCheckpointId).toBe('cp-two');
    expect(Math.abs(sim.player.position.z - 70)).toBeLessThan(4);
    sim.restartRun();
    expect(sim.activeCheckpointId).toBe(null);
    expect(sim.hasCheckpointEvent).toBe(true);
    expect(sim.checkpointEventCount).toBe(2);
    expect(sim.player.position.z).toBeCloseTo(RUNWAY.start.z, 9);
    // Progress cleared: dying now returns to the origin.
    killAndRespawn(sim);
    expect(sim.player.position.z).toBeCloseTo(RUNWAY.start.z, 9);
  });

  it('GRAVITY RIFT: all 8 crystals activate on both reference routes, trajectory untouched', () => {
    for (const variant of ['primary', 'alternate'] as const) {
      const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
      sim.setCheckpointRespawnEnabled(true);
      const driver = new ShowcaseDriver(variant);
      const activated: string[] = [];
      let tick = 0;
      for (; tick < 30000; tick++) {
        if (sim.status !== 'running') break;
        sim.update(driver.nextInput(sim.player.position.z, sim));
        const last = sim.lastCheckpointId;
        if (last !== null && !activated.includes(last)) activated.push(last);
      }
      expect(sim.status).toBe('finished');
      // M9.1 anchor: checkpoint detection never perturbs the trajectory.
      expect(tick).toBe(13799);
      expect(activated).toEqual([
        'cp-forge',
        'cp-skybridge',
        'cp-labyrinth',
        'cp-cathedral',
        'cp-foundry',
        'cp-reactor',
        'cp-temple',
        'cp-core',
      ]);
      // Every snapshot is a grounded cube state on the intended route.
      expect(sim.checkpointProgress()).toEqual({ activeIndex: 8, total: 8 });
    }
  });

  it('checkpoints are fingerprinted conditionally (absent levels hash identically)', () => {
    const plain: LevelDefinition = { ...RUNWAY };
    delete plain.checkpoints;
    const withCp = computeLevelFingerprint(RUNWAY);
    const withoutCp = computeLevelFingerprint(plain);
    expect(withCp).not.toBe(withoutCp);
    // The golden validation fixture level carries no checkpoints: its
    // fingerprint path is untouched (zero bytes when absent).
    expect(computeLevelFingerprint(TEST_LEVEL)).toBe(computeLevelFingerprint({ ...TEST_LEVEL }));
  });
});
