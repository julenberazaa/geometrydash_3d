/**
 * M9.1 QA tape generator (dev tool, NOT part of `npm run verify`).
 *
 * Records the deterministic primary-route playthrough of
 * production-showcase-01 through the REAL ReplayCoordinator protocol and
 * writes the serialized input tape to a temp file for the in-page tape
 * gate (`scripts/browser-qa-m91-playthrough.mjs`).
 *
 * The tape is regenerated fresh on every gate run (never committed): the
 * level is under active rebuild, and the unit suite (`tests/showcase.test.ts`)
 * already proves the same driver finishes tick-for-tick.
 *
 * Usage:
 *   npx vite-node scripts/generate-m91-tape.ts <outPath>
 */
import fs from 'node:fs';
import { GameSimulation } from '../src/game/GameSimulation';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { serializeReplay } from '../src/replay/replayFormat';
import { ShowcaseDriver } from '../tests/helpers/showcaseScript';
import { recordAttempt, playReplay } from '../tests/helpers/replay';

const out = process.argv[2];
if (!out) throw new Error('usage: generate-m91-tape.ts <outPath>');

const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
const coordinator = new ReplayCoordinator(sim);
const driver = new ShowcaseDriver('primary');
recordAttempt(sim, coordinator, () => driver.nextInput(sim.player.position.z, sim));

const replay = coordinator.lastReplay;
if (replay === null) throw new Error('no completed attempt recorded');
if (replay.outcome.status !== 'finished') {
  throw new Error(`primary driver did not finish (status=${replay.outcome.status})`);
}

// Self-check before persisting: a FRESH simulation must verify the tape.
const verifySim = new GameSimulation(PRODUCTION_SHOWCASE_01);
const verifyCoordinator = new ReplayCoordinator(verifySim);
const verification = playReplay(verifySim, verifyCoordinator, replay);
if (verification.kind !== 'pass') {
  throw new Error(`fresh-simulation self-check failed: ${JSON.stringify(verification)}`);
}

fs.writeFileSync(out, serializeReplay(replay));
console.log(`wrote ${out} (${replay.frameCount} frames, outcome=${replay.outcome.status})`);
