import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { VALIDATION_LEVEL_02 } from '../src/content/levels/validationLevel02';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { decodeReplayFrame } from '../src/replay/replayInputCodec';
import { parseReplay, validateReplayObject, type ReplayV1 } from '../src/replay/replayFormat';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { playReplay } from './helpers/replay';
import fixtureRaw from './fixtures/replays/validation-level-02-v1.json?raw';

/**
 * M5 golden replay: the committed fixture
 * `tests/fixtures/replays/validation-level-02-v1.json` is replayed on a
 * FRESH simulation through the REAL ReplayCoordinator protocol.
 *
 * The fixture is PERSISTED evidence — this test NEVER generates expected
 * hashes; it loads them from the file. Regenerate only intentionally via
 * `npx vite-node scripts/generate-replay-fixture.ts` (see the provenance
 * block inside the fixture).
 */

interface FixtureFile {
  _provenance: { levelId: string; frameCount: number; outcome: { status: string } };
  replay: ReplayV1;
}

const loadFixture = (): FixtureFile => {
  const file = JSON.parse(fixtureRaw) as FixtureFile;
  // Structural validation of the persisted tape (never trusted blindly).
  const validated = validateReplayObject(file.replay);
  if (!validated.ok) throw new Error(`golden replay invalid: ${validated.reason}`);
  // parseReplay must accept the canonical serialization of the same object.
  const reparsed = parseReplay(JSON.stringify(file.replay));
  if (!reparsed.ok) throw new Error(`golden replay does not parse: ${reparsed.reason}`);
  return { ...file, replay: validated.replay };
};

describe('golden replay (committed fixture)', () => {
  it('exists with provenance and verifies on a fresh simulation', () => {
    const { _provenance, replay } = loadFixture();
    expect(_provenance.levelId).toBe('validation-02');
    expect(replay.levelId).toBe('validation-02');
    expect(replay.levelFingerprint).toBe(computeLevelFingerprint(VALIDATION_LEVEL_02));
    // Pinned deterministic size: the scripted playthrough is tick-exact.
    // Changes ONLY with an intentional physics/script change + fixture regen.
    expect(replay.frameCount).toBe(2346);
    expect(_provenance.frameCount).toBe(2346);

    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    expect(playReplay(sim, coordinator, replay).kind).toBe('pass');
    expect(sim.status).toBe('finished');
    expect(sim.player.position.z).toBeGreaterThanOrEqual(VALIDATION_LEVEL_02.finishZ);
    expect(replay.outcome).toEqual({ status: 'finished', deathCause: null });
  });

  it('a single meaningful input mutation diverges at the mutated tick (negative proof)', () => {
    const { replay } = loadFixture();
    let mutatedIndex = -1;
    for (let i = 0; i < replay.frameCount; i++) {
      if (decodeReplayFrame(replay.inputFrames[i] ?? 0).space.pressedThisStep) {
        mutatedIndex = i;
        break;
      }
    }
    // Pinned: the first jump press of the scripted playthrough is the gap
    // jump. If the script or physics intentionally change, regen the fixture
    // AND update this pin together (never one without the other).
    expect(mutatedIndex).toBe(651);
    const mutated: ReplayV1 = { ...replay, inputFrames: [...replay.inputFrames] };
    mutated.inputFrames[mutatedIndex] = 0;

    const sim = new GameSimulation(VALIDATION_LEVEL_02);
    const coordinator = new ReplayCoordinator(sim);
    const verification = playReplay(sim, coordinator, mutated);
    expect(verification.kind).toBe('diverged');
    if (verification.kind === 'diverged') {
      expect(verification.tick).toBe(651);
      expect(verification.expectedHash).toBe(replay.stateHashes[651]);
    }
  });
});
