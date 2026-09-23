/**
 * M9.1 full production playthrough gate (dev tool, not shipped).
 *
 * Proves IN PAGE with the real build (real sim + renderer + audio):
 *  - press-to-start gate + music transport live (buffer/context/gain/time)
 *  - the tick-exact primary reference tape plays to FINISH with 0 deaths
 *    and REPLAY VERIFIED, at the default budget AND under ?stepcap=4
 *    (cross-cap determinism proof)
 *  - music target follows the full 115 s sim clock in-page
 *  - ship/spider/modes/portals/ferries exercised by the tape, staged
 *    screenshots across rebuilt acts, resources bounded, zero errors
 *
 * Delivery note (measured, not assumed): wall-clock live driving (8 ms
 * polls dispatching KeyboardEvents) cannot deliver sub-2 u edges on
 * headless SwiftShader — frames take 100 ms+ (up to ~1.9 u observation
 * skips; only ~138 polls observed over minutes of run) while M9.1 demands
 * sub-1 u precision (funnel takeoff, tread transfer, orb windows). Eight
 * instrumented live runs all died on delivery timing, never on geometry
 * (unit drivers finish tick-exact, ticks13799, both routes). So the gate
 * plays the unit-recorded input tape through the in-page replay path
 * (debugStartReplayJson — the same coordinator F4 uses): identical ticks,
 * immune to wall rate. Live hands remain the human gate.
 *
 * Usage: QA_URL=http://localhost:5174/ node scripts/browser-qa-m91-playthrough.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const URL = process.env.QA_URL ?? 'http://localhost:5173/';
const OUT_DIR = path.resolve('qa/screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
};
const ev = (page, fn, arg) => (arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg));
const sleep = (page, ms) => page.waitForTimeout(ms);

// --- Tape: record the unit-exact primary run fresh (never committed). ---
const tapePath = path.join(os.tmpdir(), `m91-tape-${process.pid}.json`);
execFileSync('npx vite-node scripts/generate-m91-tape.ts ' + JSON.stringify(tapePath), { stdio: 'inherit', shell: true });
const tapeJson = fs.readFileSync(tapePath, 'utf8');
log('m91 tape recorded unit-exact', tapeJson.length > 100000, `${tapePath} ${(fs.statSync(tapePath).size / 1024).toFixed(0)}KB`);

const browser = await chromium.launch({
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const wireErrors = (page, bucket) => {
  page.on('console', (msg) => { if (msg.type() === 'error') bucket.console.push(msg.text()); });
  page.on('pageerror', (err) => bucket.pages.push(String(err)));
};

// --- Tape gate on one page: restart live, inject the tape, ride it out. ---
const runTapeGate = async (page, label, timeoutMs) => {
  await page.keyboard.press('KeyR');
  await sleep(page, 1000);
  const started = await ev(page, (tape) => window.__gd3d.debugStartReplayJson(tape), tapeJson);
  log(`m91 ${label} tape accepted`, started.ok === true, JSON.stringify(started));
  if (!started.ok) return;
  const done = await page.waitForFunction(() => window.__gd3d.status() === 'finished', null, { timeout: timeoutMs })
    .then(() => true).catch(() => false);
  const st = await ev(page, () => ({
    status: window.__gd3d.status(),
    z: window.__gd3d.playerPosition().z,
    attempts: window.__gd3d.attempts(),
    death: window.__gd3d.deathCause(),
    verification: window.__gd3d.replayVerification(),
    badge: window.__gd3d.replayBadge(),
    musicTarget: window.__gd3d.musicTargetTime(),
    simSteps: window.__gd3d.simSteps(),
  }));
  log(`m91 ${label} tape finishes`, done === true && st.z > 1780, `status=${st.status} z=${st.z.toFixed(1)}`);
  log(`m91 ${label} zero deaths`, st.death === null, `death=${st.death}`);
  log(`m91 ${label} replay VERIFIED`, st.verification.kind === 'pass', JSON.stringify(st.verification));
  log(`m91 ${label} music followed the run`, st.musicTarget > 114, `target=${st.musicTarget.toFixed(1)}s steps=${st.simSteps}`);
  await ev(page, () => window.__gd3d.setPostEnabled(false));
  await page.screenshot({ path: path.join(OUT_DIR, `m91-finish-run-${label}.png`) });
};

// --- Page 1: default budget. ---
{
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = { console: [], pages: [] };
  wireErrors(page, errors);
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  await sleep(page, 4000);
  const gate0 = await ev(page, () => ({
    awaiting: window.__gd3d.awaitingStart(),
    z: window.__gd3d.playerPosition().z,
  }));
  log('m91 gate holds at tick 0', gate0.awaiting === true && Math.abs(gate0.z + 4) < 0.01, JSON.stringify(gate0));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 60000 });
  await sleep(page, 1500);
  const live = await ev(page, () => ({
    music: window.__gd3d.musicState(),
    buffer: window.__gd3d.musicBufferDuration(),
    ctx: window.__gd3d.musicContextState(),
    gain: window.__gd3d.musicGain(),
    playing: window.__gd3d.musicPlaying(),
  }));
  const transportOk = live.music === 'playing' && Math.abs(live.buffer - 121.574) < 1 &&
    live.ctx === 'running' && live.gain > 0 && live.playing === true;
  log('m91 transport live after gesture', transportOk, JSON.stringify(live));
  await ev(page, () => window.__gd3d.setPostEnabled(false));
  await runTapeGate(page, 'cap8', 900000);

  // --- Staged screenshots (paused stations across rebuilt acts). ---
  await page.keyboard.press('KeyR');
  await sleep(page, 1000);
  await ev(page, () => window.__gd3d.setPostEnabled(true));
  await sleep(page, 1000);
  const sidecarBase = { url: URL, capturedAt: new Date().toISOString() };
  async function capture(name) {
    const file = path.join(OUT_DIR, `m91-${name}.png`);
    await page.screenshot({ path: file });
    const appState = await ev(page, () => ({
      status: window.__gd3d?.status?.() ?? 'n/a',
      attempts: window.__gd3d?.attempts?.() ?? -1,
      playerPosition: window.__gd3d?.playerPosition?.() ?? null,
      playerMode: window.__gd3d?.playerMode?.() ?? 'n/a',
      gravityMode: window.__gd3d?.gravityMode?.() ?? 'n/a',
      music: window.__gd3d?.musicState?.() ?? 'n/a',
      section: window.__gd3d?.rhythmSection?.() ?? 'n/a',
    }));
    const bytes = fs.readFileSync(file);
    fs.writeFileSync(path.join(OUT_DIR, `m91-${name}.json`), JSON.stringify({
      ...sidecarBase, capture: { name, accepted: true, rejectionReasons: [] },
      appState, errors: { consoleErrors: [...errors.console], pageErrors: [...errors.pages] },
      png: { bytes: bytes.length },
    }, null, 2));
  }
  const stage = async (name, x, y, z) => {
    await page.keyboard.press('KeyP');
    const wasPaused = await ev(page, () => window.__gd3d.paused());
    if (wasPaused) await page.keyboard.press('KeyP');
    await ev(page, (pos) => window.__gd3d.debugTeleport(pos.x, pos.y, pos.z), { x, y, z });
    await sleep(page, 400);
    await page.keyboard.press('KeyP');
    await sleep(page, 400);
    await capture(name);
    await page.keyboard.press('KeyP');
    await sleep(page, 200);
  };
  await stage('forge', 0, 5.05, 60);
  await stage('islands', 0, 5.05, 250);
  await stage('maze', 0, 0.55, 500);
  await stage('spire', 0, 0.55, 780);
  await stage('foundry', 0, 0.55, 930);
  await stage('ship', 0, 3.0, 1180);
  await stage('spider', 0, 0.55, 1360);
  await stage('void', 0, 8.55, 1540);
  await stage('core', 0, 0.55, 1680);
  await stage('finish-approach', 0, 0.55, 1780);
  log('m91 staged captures taken', true, 'forge/islands/maze/spire/foundry/ship/spider/void/core/finish');

  const res = await ev(page, () => ({
    mats: window.__gd3d.materialCount(),
    geos: window.__gd3d.geometryCount(),
    children: window.__gd3d.sceneChildren(),
    calls: window.__gd3d.rendererStats().calls,
    tris: window.__gd3d.rendererStats().triangles,
  }));
  log('m91 resources bounded', res.mats < 70 && res.geos < 25 && res.children < 160, JSON.stringify(res));
  log('m91 zero console errors', errors.console.length === 0, errors.console.slice(0, 3).join(' | '));
  log('m91 zero page errors', errors.pages.length === 0, errors.pages.slice(0, 3).join(' | '));
  await page.close();
}

// --- Page 2: ?stepcap=4 cross-cap determinism (same tape, same ticks). ---
{
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = { console: [], pages: [] };
  wireErrors(page, errors);
  await page.goto(`${URL}?stepcap=4`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  const cap = await ev(page, () => window.__gd3d.stepCap());
  log('m91 stepcap budget active', cap === 4, `stepCap=${cap}`);
  await sleep(page, 2000);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 120000 });
  await ev(page, () => window.__gd3d.setPostEnabled(false));
  await runTapeGate(page, 'stepcap4', 1500000);
  log('m91 stepcap4 zero console errors', errors.console.length === 0, errors.console.slice(0, 3).join(' | '));
  log('m91 stepcap4 zero page errors', errors.pages.length === 0, errors.pages.slice(0, 3).join(' | '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nM9.1 PLAYTHROUGH GATE: ${failed.length === 0 ? 'PASS' : 'FAILED'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length === 0 ? 0 : 1);
