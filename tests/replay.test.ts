import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { VALIDATION_LEVEL_02 } from '../src/content/levels/validationLevel02';
import { SIMULATION_HZ } from '../src/core/constants';
import {
  makeIdlePhysicalSnapshot,
  type PhysicalAction,
  type PhysicalInputSnapshot,
} from '../src/input/InputSystem';
import {
  MAX_REPLAY_FRAME,
  MIN_REPLAY_FRAME,
  decodeReplayFrame,
  encodeReplayFrame,
  isValidReplayFrame,
} from '../src/replay/replayInputCodec';
import {
  REPLAY_RULESET_VERSION,
  REPLAY_SCHEMA_VERSION,
  parseReplay,
  serializeReplay,
  validateReplayObject,
  type ReplayV1,
} from '../src/replay/replayFormat';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { computeStateFingerprint } from '../src/replay/stateFingerprint';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { Level02Driver } from './helpers/level02Script';
import { recordAttempt, playReplay } from './helpers/replay';
import { idleInput } from './helpers/simulation';

/**
 * M5 replay matrix: input codec, recording lifecycle, determinism,
 * divergence detection, compatibility rejection, fingerprints, and
 * render-cadence independence — all through the REAL ReplayCoordinator
 * protocol above the REAL GameSimulation (no transform playback, no sim
 * branching: GameSimulation has no replay code path).
 */

const ACTIONS: readonly PhysicalAction[] = ['space', 'up', 'down', 'laneLeft', 'laneRight'];

const snapshotWith = (
  action: PhysicalAction,
  held: boolean,
  pressed: boolean,
  released: boolean,
): PhysicalInputSnapshot => {
  const base = makeIdlePhysicalSnapshot();
  return Object.freeze({
    ...base,
    [action]: Object.freeze({ held, pressedThisStep: pressed, releasedThisStep: released }),
  });
};

/** Record the deterministic Level 02 playthrough; returns sim + coordinator + tape. */
const recordLevel02 = (): {
  sim: GameSimulation;
  coordinator: ReplayCoordinator;
  replay: ReplayV1;
  ticks: number;
} => {
  const sim = new GameSimulation(VALIDATION_LEVEL_02);
  const coordinator = new ReplayCoordinator(sim);
  const driver = new Level02Driver();
  const ticks = recordAttempt(sim, coordinator, () => driver.nextInput(sim.player.position.z));
  const replay = coordinator.lastReplay;
  if (replay === null) throw new Error('level 02 attempt did not complete');
  return { sim, coordinator, replay, ticks };
};

/** Record a death: an idle run on Test Level 01 falls into the first gap. */
const recordDeath = (): { sim: GameSimulation; coordinator: ReplayCoordinator; replay: ReplayV1 } => {
  const sim = new GameSimulation(TEST_LEVEL);
  const coordinator = new ReplayCoordinator(sim);
  recordAttempt(sim, coordinator, () => idleInput);
  const replay = coordinator.lastReplay;
  if (replay === null) throw new Error('death attempt did not complete');
  return { sim, coordinator, replay };
};

describe('input codec', () => {
  it('round-trips every action x every held/pressed/released combination exactly', () => {
    for (const action of ACTIONS) {
      for (let combo = 0; combo < 8; combo++) {
        const held = (combo & 1) !== 0;
        const pressed = (combo & 2) !== 0;
        const released = (combo & 4) !== 0;
        const snapshot = snapshotWith(action, held, pressed, released);
        const decoded = decodeReplayFrame(encodeReplayFrame(snapshot));
        expect(decoded[action]).toEqual({ held, pressedThisStep: pressed, releasedThisStep: released });
        for (const other of ACTIONS) {
          if (other === action) continue;
          expect(decoded[other]).toEqual({ held: false, pressedThisStep: false, releasedThisStep: false });
        }
      }
    }
  });

  it('round-trips a fully simultaneous snapshot (all keys held + pressed + released)', () => {
    const all = Object.freeze({
      space: Object.freeze({ held: true, pressedThisStep: true, releasedThisStep: true }),
      up: Object.freeze({ held: true, pressedThisStep: true, releasedThisStep: true }),
      down: Object.freeze({ held: true, pressedThisStep: true, releasedThisStep: true }),
      laneLeft: Object.freeze({ held: true, pressedThisStep: true, releasedThisStep: true }),
      laneRight: Object.freeze({ held: true, pressedThisStep: true, releasedThisStep: true }),
    });
    expect(decodeReplayFrame(encodeReplayFrame(all))).toEqual(all);
  });

  it('uses one compact integer per tick with the documented bounds', () => {
    expect(MIN_REPLAY_FRAME).toBe(0);
    expect(MAX_REPLAY_FRAME).toBe(32767);
    expect(encodeReplayFrame(makeIdlePhysicalSnapshot())).toBe(0);
    expect(isValidReplayFrame(0)).toBe(true);
    expect(isValidReplayFrame(32767)).toBe(true);
  });

  it('rejects malformed frames and schemas', () => {
    expect(isValidReplayFrame(-1)).toBe(false);
    expect(isValidReplayFrame(32768)).toBe(false);
    expect(isValidReplayFrame(1.5)).toBe(false);
    expect(isValidReplayFrame('3')).toBe(false);
    expect(isValidReplayFrame(null)).toBe(false);
    expect(() => decodeReplayFrame(-1)).toThrow();
    expect(() => decodeReplayFrame(32768)).toThrow();
    expect(parseReplay('this is not json').ok).toBe(false);
    expect(validateReplayObject(null).ok).toBe(false);
    expect(validateReplayObject({}).ok).toBe(false);
  });
});

describe('recording lifecycle', () => {
  it('records exactly one frame per simulation tick', () => {
    const { replay, ticks } = recordLevel02();
    expect(replay.frameCount).toBe(ticks);
    expect(replay.inputFrames.length).toBe(replay.frameCount);
    expect(replay.stateHashes.length).toBe(replay.frameCount);
  });

  it('finalizes a finished attempt with the finish outcome', () => {
    const { replay } = recordLevel02();
    expect(replay.outcome).toEqual({ status: 'finished', deathCause: null });
    expect(replay.finalStateHash).toBe(replay.stateHashes[replay.stateHashes.length - 1]);
    expect(replay.levelId).toBe('validation-02');
    expect(replay.simulationHz).toBe(SIMULATION_HZ);
    expect(replay.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
    expect(replay.rulesetVersion).toBe(REPLAY_RULESET_VERSION);
  });

  it('finalizes a death attempt on the death tick with the death cause', () => {
    const { sim, replay } = recordDeath();
    expect(sim.status).toBe('dead');
    expect(replay.outcome.status).toBe('dead');
    expect(replay.outcome.deathCause).toBe(sim.deathCause);
    expect(replay.frameCount).toBeGreaterThan(0);
  });

  it('discards the partial tape on manual restart (one replay = one attempt)', () => {
    const sim = new GameSimulation(TEST_LEVEL);
    const coordinator = new ReplayCoordinator(sim);
    for (let tick = 0; tick < 100; tick++) {
      coordinator.beforeSimTick();
      sim.update(coordinator.getInputForTick(idleInput));
      coordinator.afterSimTick();
    }
    expect(sim.status).toBe('running');
    expect(coordinator.isRecording).toBe(true);
    coordinator.discardRecording();
    sim.restart();
    expect(coordinator.lastReplay).toBeNull();
    expect(coordinator.isRecording).toBe(false);
    // A subsequent full attempt still records cleanly.
    const driver = new Level02Driver();
    const sim2 = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator2 = new ReplayCoordinator(sim2);
    recordAttempt(sim2, coordinator2, () => driver.nextInput(sim2.player.position.z));
    expect(coordinator2.lastReplay?.outcome.status).toBe('finished');
  });

  it('starting playback discards the stale partial live tape (no hybrid replay)', () => {
    const { replay } = recordLevel02();
    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    // A partial live attempt: recording is armed but never finalized.
    for (let tick = 0; tick < 50; tick++) {
      coordinator.beforeSimTick();
      sim.update(coordinator.getInputForTick(idleInput));
      coordinator.afterSimTick();
    }
    expect(coordinator.isRecording).toBe(true);
    expect(coordinator.startReplay(replay).ok).toBe(true);
    expect(coordinator.isRecording).toBe(false);
    // Drive the whole playback manually, then let the dead sim sit: the
    // stale partial must NOT finalize into a phantom lastReplay.
    while (coordinator.isPlaying) {
      coordinator.beforeSimTick();
      sim.update(coordinator.getInputForTick(makeIdlePhysicalSnapshot()));
      coordinator.afterSimTick();
    }
    expect(coordinator.verification.kind).toBe('pass');
    for (let tick = 0; tick < 100; tick++) {
      coordinator.beforeSimTick();
      sim.update(coordinator.getInputForTick(idleInput));
      coordinator.afterSimTick();
    }
    expect(coordinator.lastReplay).toBeNull();
  });

  it('aborting playback resumes clean live recording (no stale resume)', () => {
    const { replay } = recordDeath(); // short death tape on Test Level 01
    const sim = new GameSimulation(TEST_LEVEL);
    const coordinator = new ReplayCoordinator(sim);
    expect(coordinator.startReplay(replay).ok).toBe(true);
    for (let tick = 0; tick < 10; tick++) {
      coordinator.beforeSimTick();
      sim.update(coordinator.getInputForTick(makeIdlePhysicalSnapshot()));
      coordinator.afterSimTick();
    }
    coordinator.abortReplay();
    expect(coordinator.isRecording).toBe(false);
    // R semantics (mirroring Game): restart into a genuine live attempt, then
    // record it to a natural death. The tape must verify on a fresh sim.
    coordinator.discardRecording();
    sim.restart();
    recordAttempt(sim, coordinator, () => idleInput);
    const fresh = coordinator.lastReplay;
    expect(fresh).not.toBeNull();
    expect(fresh?.outcome.status).toBe('dead');
    const verifySim = new GameSimulation(TEST_LEVEL);
    const verifyCoordinator = new ReplayCoordinator(verifySim);
    expect(playReplay(verifySim, verifyCoordinator, fresh).kind).toBe('pass');
  });
});

describe('determinism (record -> replay)', () => {
  it('reproduces every per-tick state hash and the terminal outcome', () => {
    const { replay } = recordLevel02();
    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    expect(playReplay(sim, coordinator, replay).kind).toBe('pass');
    expect(sim.status).toBe('finished');
  });

  it('replays the same tape twice with an identical result', () => {
    const { replay } = recordLevel02();
    const first = new GameSimulation(VALIDATION_LEVEL_02);
    const firstCoord = new ReplayCoordinator(first);
    const second = new GameSimulation(VALIDATION_LEVEL_02);
    const secondCoord = new ReplayCoordinator(second);
    expect(playReplay(first, firstCoord, replay).kind).toBe('pass');
    expect(playReplay(second, secondCoord, replay).kind).toBe('pass');
    expect(computeStateFingerprint(first)).toBe(computeStateFingerprint(second));
    expect(first.portalTransitionCount).toBe(second.portalTransitionCount);
  });

  it('reproduces gravity transitions, interaction use and speed tiers', () => {
    const { sim: live, replay } = recordLevel02();
    const liveFlips = live.portalTransitionCount;
    const livePads = live.padActivationCount;
    const liveOrbs = live.orbActivationCount;
    const liveSpeed = live.speedMultiplier;
    const livePadUsed = live.isInteractionUsed('v2-pad-ceiling');
    const liveOrbUsed = live.isInteractionUsed('v2-orb-gravity');
    expect(liveFlips).toBe(2);
    expect(livePads).toBe(1);
    expect(liveOrbs).toBe(1);
    expect(liveSpeed).toBe(2);

    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    expect(playReplay(sim, coordinator, replay).kind).toBe('pass');
    expect(sim.portalTransitionCount).toBe(liveFlips);
    expect(sim.padActivationCount).toBe(livePads);
    expect(sim.orbActivationCount).toBe(liveOrbs);
    expect(sim.speedMultiplier).toBe(liveSpeed);
    expect(sim.isInteractionUsed('v2-pad-ceiling')).toBe(livePadUsed);
    expect(sim.isInteractionUsed('v2-orb-gravity')).toBe(liveOrbUsed);
    expect(sim.lastInteractionId).toBe(live.lastInteractionId);
  });

  it('reproduces a death outcome (death tick, cause, no finish)', () => {
    const { replay } = recordDeath();
    const sim = new GameSimulation(TEST_LEVEL);
    const coordinator = new ReplayCoordinator(sim);
    expect(playReplay(sim, coordinator, replay).kind).toBe('pass');
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe(replay.outcome.deathCause);
  });
});

describe('divergence detection', () => {
  /** Zero the first jump press (gap jump): the trajectory must change that same tick. */
  it('flags a meaningful input mutation and reports the first divergent tick', () => {
    const { replay } = recordLevel02();
    let mutatedIndex = -1;
    for (let i = 0; i < replay.frameCount; i++) {
      if (decodeReplayFrame(replay.inputFrames[i] ?? 0).space.pressedThisStep) {
        mutatedIndex = i;
        break;
      }
    }
    expect(mutatedIndex).toBeGreaterThan(0);
    const mutated: ReplayV1 = { ...replay, inputFrames: [...replay.inputFrames] };
    mutated.inputFrames[mutatedIndex] = 0;
    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    const verification = playReplay(sim, coordinator, mutated);
    expect(verification.kind).toBe('diverged');
    if (verification.kind === 'diverged') {
      expect(verification.tick).toBe(mutatedIndex);
      expect(verification.expectedHash).toBe(replay.stateHashes[mutatedIndex]);
      expect(verification.actualHash).not.toBe(verification.expectedHash);
    }
  });

  it('fails when an expected per-tick hash is tampered (fault-injection proof)', () => {
    const { replay } = recordLevel02();
    const tampered: ReplayV1 = { ...replay, stateHashes: [...replay.stateHashes] };
    const victim = 500;
    tampered.stateHashes[victim] = 'deadbeefdeadbeef';
    // finalStateHash must still match the last hash or structural validation
    // rejects before playback — keep the object structurally valid.
    tampered.finalStateHash = tampered.stateHashes[tampered.stateHashes.length - 1] ?? '';
    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    const verification = playReplay(sim, coordinator, tampered);
    expect(verification.kind).toBe('diverged');
    if (verification.kind === 'diverged') expect(verification.tick).toBe(victim);
  });

  it('fails when the terminal outcome contradicts a hash-verified run', () => {
    const { replay } = recordLevel02();
    const lied: ReplayV1 = {
      ...replay,
      outcome: { status: 'dead', deathCause: 'void' },
    };
    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    const verification = playReplay(sim, coordinator, lied);
    expect(verification.kind).toBe('diverged');
  });

  it('rejects a replay whose final hash disagrees with its own tape', () => {
    const { replay } = recordLevel02();
    const broken = { ...replay, finalStateHash: 'cafecafecafecafe' };
    expect(validateReplayObject(broken).ok).toBe(false);
  });
});

describe('compatibility rejection', () => {
  it('rejects a wrong schema version', () => {
    const { replay } = recordLevel02();
    const parsed = validateReplayObject({ ...replay, schemaVersion: REPLAY_SCHEMA_VERSION + 1 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain('schemaVersion');
  });

  it('rejects a wrong ruleset version', () => {
    const { replay } = recordLevel02();
    const parsed = validateReplayObject({ ...replay, rulesetVersion: REPLAY_RULESET_VERSION + 1 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain('rulesetVersion');
  });

  it('rejects a replay recorded on a different level', () => {
    const { replay } = recordDeath(); // recorded on test-01
    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    const verification = playReplay(sim, coordinator, replay);
    expect(verification.kind).toBe('rejected');
    expect(sim.status).toBe('running'); // the live sim was never touched
  });

  it('rejects a replay whose level fingerprint no longer matches', () => {
    const { replay } = recordLevel02();
    const stale = { ...replay, levelFingerprint: '0000000000000000' };
    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    const verification = playReplay(sim, coordinator, stale);
    expect(verification.kind).toBe('rejected');
  });

  it('serializes and parses back to an exact semantic equivalent', () => {
    const { replay } = recordLevel02();
    const parsed = parseReplay(serializeReplay(replay));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.replay).toEqual(replay);
  });

  it('rejects an empty tape', () => {
    const { replay } = recordLevel02();
    expect(validateReplayObject({ ...replay, inputFrames: [], stateHashes: [], frameCount: 0 }).ok).toBe(false);
  });
});

describe('level fingerprint', () => {
  it('is stable for the same level', () => {
    expect(computeLevelFingerprint(TEST_LEVEL)).toBe(computeLevelFingerprint(TEST_LEVEL));
    expect(computeLevelFingerprint(VALIDATION_LEVEL_02)).toBe(computeLevelFingerprint(VALIDATION_LEVEL_02));
  });

  it('changes when gameplay content changes', () => {
    const moved = {
      ...VALIDATION_LEVEL_02,
      solids: VALIDATION_LEVEL_02.solids.map((s, i) =>
        i === 0 ? { ...s, center: { ...s.center, z: s.center.z + 1 } } : s,
      ),
    };
    expect(computeLevelFingerprint(moved)).not.toBe(computeLevelFingerprint(VALIDATION_LEVEL_02));
    const retimed = { ...VALIDATION_LEVEL_02, finishZ: VALIDATION_LEVEL_02.finishZ + 1 };
    expect(computeLevelFingerprint(retimed)).not.toBe(computeLevelFingerprint(VALIDATION_LEVEL_02));
    const reordered = { ...VALIDATION_LEVEL_02, solids: [...VALIDATION_LEVEL_02.solids].reverse() };
    expect(computeLevelFingerprint(reordered)).not.toBe(computeLevelFingerprint(VALIDATION_LEVEL_02));
  });

  it('ignores renderer-only styling (displayName, theme, hazard visuals)', () => {
    const restyled = {
      ...VALIDATION_LEVEL_02,
      displayName: 'A DIFFERENT LABEL',
      theme: { ...VALIDATION_LEVEL_02.theme, background: 0x123456, edge: 0x654321 },
      hazards: VALIDATION_LEVEL_02.hazards.map((h) => ({ ...h, visual: 'block' as const })),
    };
    expect(computeLevelFingerprint(restyled)).toBe(computeLevelFingerprint(VALIDATION_LEVEL_02));
  });
});

describe('render-cadence independence', () => {
  it('replays identically when ticks are grouped differently between renders', () => {
    const { replay } = recordLevel02();
    const playChunked = (chunkSize: number): { hashes: string[]; status: string } => {
      const sim = new GameSimulation(VALIDATION_LEVEL_02);
      const coordinator = new ReplayCoordinator(sim);
      const started = coordinator.startReplay(replay);
      expect(started.ok).toBe(true);
      const hashes: string[] = [];
      let consumed = 0;
      while (coordinator.isPlaying) {
        // One "render frame" consumes up to chunkSize fixed ticks; probe
        // reads (position/progress) happen between groups, exactly like a
        // renderer observing the sim — they must not affect the trajectory.
        for (let c = 0; c < chunkSize; c++) {
          if (coordinator.mode !== 'replay') break;
          coordinator.beforeSimTick();
          sim.update(coordinator.getInputForTick(makeIdlePhysicalSnapshot()));
          coordinator.afterSimTick();
          hashes.push(computeStateFingerprint(sim));
          consumed += 1;
        }
        void sim.progress;
        void sim.player.position.x;
      }
      expect(consumed).toBe(replay.frameCount);
      return { hashes, status: sim.status };
    };
    const oneByOne = playChunked(1);
    const sevenAtOnce = playChunked(7);
    expect(sevenAtOnce.status).toBe(oneByOne.status);
    expect(sevenAtOnce.hashes).toEqual(oneByOne.hashes);
    expect(sevenAtOnce.hashes[sevenAtOnce.hashes.length - 1]).toBe(replay.finalStateHash);
  });

  it('stores no render data (fixed-tick input + hashes only)', () => {
    const { replay } = recordLevel02();
    expect(Object.keys(replay).sort()).toEqual(
      [
        'finalStateHash',
        'frameCount',
        'inputFrames',
        'levelFingerprint',
        'levelId',
        'outcome',
        'rulesetVersion',
        'schemaVersion',
        'simulationHz',
        'stateHashes',
      ].sort(),
    );
    const serialized = JSON.stringify(replay);
    expect(serialized).not.toContain('timestamp');
    expect(serialized).not.toContain('camera');
    expect(serialized).not.toContain('transform');
  });
});
