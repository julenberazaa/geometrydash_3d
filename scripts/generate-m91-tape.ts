/**
 * Production QA tape generator (dev tool, NOT part of `npm run verify`).
 *
 * Records the deterministic primary-route playthrough of
 * production-showcase-01 (or THE DESCENT) through the REAL ReplayCoordinator protocol and
 * writes the serialized input tape to a temp file for the in-page tape
 * gate (`scripts/browser-qa-m91-playthrough.mjs`).
 *
 * The tape is regenerated fresh on every gate run (never committed): the
 * level is under active rebuild, and the unit suite (`tests/showcase.test.ts`)
 * already proves the same driver finishes tick-for-tick.
 *
 * Usage:
 *   npx vite-node scripts/generate-m91-tape.ts <outPath> [the-descent]
 */
import fs from 'node:fs';
import { GameSimulation } from '../src/game/GameSimulation';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { serializeReplay } from '../src/replay/replayFormat';
import { ShowcaseDriver } from '../tests/helpers/showcaseScript';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { TheDescentClassicDriver } from '../tests/helpers/theDescentClassicScript';
import { recordAttempt, playReplay } from '../tests/helpers/replay';

const out = process.argv[2];
if (!out) throw new Error('usage: generate-m91-tape.ts <outPath> [the-descent]');
const levelId = process.argv[3] ?? 'production-showcase-01';
if (levelId !== 'production-showcase-01' && levelId !== 'the-descent') {
  throw new Error(`unsupported QA level: ${levelId}`);
}

const level = levelId === 'the-descent' ? THE_DESCENT_CLASSIC : PRODUCTION_SHOWCASE_01;
const sim = new GameSimulation(level);
const coordinator = new ReplayCoordinator(sim);
if (levelId === 'the-descent') {
  const driver = new TheDescentClassicDriver('primary');
  recordAttempt(sim, coordinator, () => driver.nextInput(sim.player.position.z, sim));
} else {
  const driver = new ShowcaseDriver('primary');
  recordAttempt(sim, coordinator, () => driver.nextInput(sim.player.position.z, sim));
}

const replay = coordinator.lastReplay;
if (replay === null) throw new Error('no completed attempt recorded');
if (replay.outcome.status !== 'finished') {
  throw new Error(`primary driver did not finish (status=${replay.outcome.status})`);
}

// Self-check before persisting: a FRESH simulation must verify the tape.
const verifySim = new GameSimulation(level);
const verifyCoordinator = new ReplayCoordinator(verifySim);
const verification = playReplay(verifySim, verifyCoordinator, replay);
if (verification.kind !== 'pass') {
  throw new Error(`fresh-simulation self-check failed: ${JSON.stringify(verification)}`);
}

fs.writeFileSync(out, serializeReplay(replay));
console.log(`wrote ${out} (${replay.frameCount} frames, outcome=${replay.outcome.status})`);
