/**
 * Manual golden-replay generator (M5). NOT part of `npm run verify`.
 *
 * Records the deterministic Level02Driver playthrough through the REAL
 * ReplayCoordinator protocol and persists the completed replay (input tape +
 * per-tick verification hashes + outcome) as a committed fixture.
 *
 * Usage:
 *   npx vite-node scripts/generate-replay-fixture.ts
 *
 * Regeneration is INTENTIONAL: run it only when the deterministic ruleset or
 * the scripted playthrough deliberately changes (which also requires bumping
 * REPLAY_RULESET_VERSION or documenting why the old fixture still verifies).
 * The committed fixture is verified by tests/replayGolden.test.ts, which
 * NEVER regenerates expectations — it loads the file and replays it.
 */
import fs from 'node:fs';
import path from 'node:path';
import nodeChildProcess from 'node:child_process';
import { GameSimulation } from '../src/game/GameSimulation';
import { VALIDATION_LEVEL_02 } from '../src/content/levels/validationLevel02';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { serializeReplay } from '../src/replay/replayFormat';
import { Level02Driver } from '../tests/helpers/level02Script';
import { recordAttempt, playReplay } from '../tests/helpers/replay';

const OUT = path.resolve('tests/fixtures/replays/validation-level-02-v1.json');

const sim = new GameSimulation(VALIDATION_LEVEL_02);
const coordinator = new ReplayCoordinator(sim);
const driver = new Level02Driver();
recordAttempt(sim, coordinator, () => driver.nextInput(sim.player.position.z));

const replay = coordinator.lastReplay;
if (replay === null) throw new Error('no completed attempt recorded');
if (replay.outcome.status !== 'finished') {
  throw new Error(`scripted playthrough did not finish (status=${replay.outcome.status})`);
}

// Self-check before persisting: a FRESH simulation must verify the tape.
const verifySim = new GameSimulation(VALIDATION_LEVEL_02);
const verifyCoordinator = new ReplayCoordinator(verifySim);
const verification = playReplay(verifySim, verifyCoordinator, replay);
if (verification.kind !== 'pass') {
  throw new Error(`fresh-simulation self-check failed: ${JSON.stringify(verification)}`);
}

const gitSha = (() => {
  try {
    return nodeChildProcess.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

const payload = {
  _provenance: {
    note: 'Committed golden replay (M5). Regenerate ONLY intentionally via `npx vite-node scripts/generate-replay-fixture.ts`. Tests load this file; they never regenerate it.',
    generatedFromCommit: gitSha,
    levelId: replay.levelId,
    frameCount: replay.frameCount,
    outcome: replay.outcome,
  },
  replay,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
const bytes = fs.statSync(OUT).size;
console.log(`wrote ${OUT} (${replay.frameCount} frames, ${bytes} bytes, outcome=${replay.outcome.status})`);
