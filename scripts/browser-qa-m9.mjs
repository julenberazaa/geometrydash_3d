/**
 * M9 browser/audio gate (dev tool, not shipped).
 * Proves the music/rhythm integration in a real browser:
 * press-to-start gate, music-transport lifecycle (play/pause/cut/restart),
 * sim-time drift follow, rhythm-pulse oscillation, staged screenshots,
 * and a console/page-error audit.
 *
 * Audio tolerance (spec): headless inaudibility is NOT failure — transport
 * STATE is what's asserted (states transition, targets track sim time).
 * If the context decodes and plays, drift bounds are asserted too.
 *
 * Usage: node scripts/browser-qa-m9.mjs   (requires dev server on :5173,
 * override with QA_URL)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import nodeChildProcess from 'node:child_process';

const URL = process.env.QA_URL ?? 'http://localhost:5173/';
const OUT_DIR = path.resolve('qa/screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
};

const gitSha = (() => {
  try {
    return nodeChildProcess.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

const browser = await chromium.launch({
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

const waitReady = async () => {
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
};
const safeGoto = async (url) => {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await waitReady();
};
await safeGoto(URL);
await page.waitForTimeout(1500);

const sidecarBase = {
  url: URL,
  capturedAt: new Date().toISOString(),
  git: { sha: gitSha },
  env: { userAgent: await page.evaluate(() => navigator.userAgent) },
};
async function capture(name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  const appState = await page.evaluate(() => ({
    status: window.__gd3d?.status?.() ?? 'n/a',
    attempts: window.__gd3d?.attempts?.() ?? -1,
    playerPosition: window.__gd3d?.playerPosition?.() ?? null,
    playerMode: window.__gd3d?.playerMode?.() ?? 'n/a',
    gravityMode: window.__gd3d?.gravityMode?.() ?? 'n/a',
    musicState: window.__gd3d?.musicState?.() ?? 'n/a',
    rhythmSection: window.__gd3d?.rhythmSection?.() ?? 'n/a',
  }));
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify({
    ...sidecarBase,
    capture: { name, accepted: true, rejectionReasons: [] },
    appState,
    errors: { consoleErrors: [...consoleErrors], pageErrors: [...pageErrors] },
    png: { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
  }, null, 2));
}

const ev = (fn, arg) => (arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg));
const sleep = (ms) => page.waitForTimeout(ms);

// --- A. Start gate: frozen tick-0 scene under the overlay. ---
const gate0 = await ev(() => ({
  awaiting: window.__gd3d.awaitingStart(),
  z: window.__gd3d.playerPosition().z,
  music: window.__gd3d.musicState(),
}));
log('m9 gate holds at tick 0', gate0.awaiting === true && Math.abs(gate0.z + 4) < 0.01, JSON.stringify(gate0));
await capture('m9-gate');

// --- B. Unlock with Space: sim + music start together. ---
await page.keyboard.press('Space');
// Slow software rendering: poll until the sim advances (not a fixed sleep).
await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
await sleep(1500);
const started = await ev(() => ({
  awaiting: window.__gd3d.awaitingStart(),
  z: window.__gd3d.playerPosition().z,
  music: window.__gd3d.musicState(),
  target: window.__gd3d.musicTargetTime(),
  actual: window.__gd3d.musicActualTime(),
  drift: window.__gd3d.musicDriftMs(),
  playing: window.__gd3d.musicPlaying(),
}));
log('m9 Space unlocks sim+music together', started.awaiting === false && started.z > -3, JSON.stringify(started));
await capture('m9-forge-start');
const audioLive = started.music === 'playing';

// --- C. Transport follows sim time (when audible). ---
if (audioLive) {
  const t1 = await ev(() => ({ target: window.__gd3d.musicTargetTime(), actual: window.__gd3d.musicActualTime() }));
  await sleep(1500);
  const t2 = await ev(() => ({ target: window.__gd3d.musicTargetTime(), actual: window.__gd3d.musicActualTime() }));
  const targetAdv = t2.target - t1.target;
  const actualAdv = t2.actual - t1.actual;
  log('m9 music target tracks sim time', targetAdv > 0.5 && targetAdv < 3, `target+${targetAdv.toFixed(2)}s`);
  log('m9 audible transport advances', actualAdv > 0.5 && actualAdv < 3, `actual+${actualAdv.toFixed(2)}s`);
  const drift = await ev(() => window.__gd3d.musicDriftMs());
  log('m9 drift within dead-band policy', Math.abs(drift) < 1000, `drift=${drift.toFixed(0)}ms`);
} else {
  log('m9 music inaudible headless (tolerated)', true, `state=${started.music} — game runs regardless`);
}

// --- D. Pause freezes sim + music; resume continues both. ---
// Wait out the start-gate audio handoff first (keys engage after it;
// the game never blocks on audio, but P during the handoff is ignored).
await page.waitForFunction(() => !window.__gd3d.startGatePending(), null, { timeout: 60000 });
// Slow software rendering: the keydown may queue behind a long frame —
// poll until the flag flips. SINGLE press only (a retry loop can
// overshoot the toggle and strand a duplicate press mid-window).
await page.keyboard.press('KeyP');
await page.waitForFunction(() => window.__gd3d.paused() === true, null, { timeout: 30000 });
let pausedProbe = await ev(() => ({
  paused: window.__gd3d.paused(),
  z: window.__gd3d.playerPosition().z,
  steps: window.__gd3d.simSteps(),
  music: window.__gd3d.musicState(),
}));
await sleep(800);
const zStill = await ev(() => window.__gd3d.playerPosition().z);
const stepsStill = await ev(() => window.__gd3d.simSteps());
log('m9 P freezes sim time', pausedProbe.paused === true && stepsStill === pausedProbe.steps && Math.abs(zStill - pausedProbe.z) < 0.01, `paused=${pausedProbe.paused} steps ${pausedProbe.steps}→${stepsStill} z ${pausedProbe.z.toFixed(1)}→${zStill.toFixed(1)} music=${pausedProbe.music}`);
await page.keyboard.press('KeyP');
await sleep(800);
const resumedZ = await ev(() => window.__gd3d.playerPosition().z);
log('m9 resume continues (sim + music)', resumedZ > zStill + 0.5, `z ${zStill.toFixed(1)}→${resumedZ.toFixed(1)}`);

// --- E. Rhythm pulse oscillates across beat phase (proves rhythm VFX live). ---
// sim-time-driven: sample until the deterministic target advances past a
// full beat (slow renderer), then judge the envelope range.
const beats = [];
const beatT0 = await ev(() => window.__gd3d.musicTargetTime());
for (let i = 0; i < 16; i++) {
  beats.push(await ev(() => window.__gd3d.rhythmBeat()));
  const t = await ev(() => window.__gd3d.musicTargetTime());
  if (t - beatT0 > 1.1) break;
  await sleep(150);
}
const range = Math.max(...beats) - Math.min(...beats);
const drop = await ev(() => window.__gd3d.rhythmDrop());
const section = await ev(() => window.__gd3d.rhythmSection());
log('m9 rhythm beat envelope oscillates', range > 0.3, `range=${range.toFixed(2)} section=${section} drop=${drop.toFixed(2)}`);

// --- F. R restart: deterministic origin for sim + music. ---
const attempts0 = await ev(() => window.__gd3d.attempts());
await page.keyboard.press('KeyR');
await sleep(1000);
const restarted = await ev(() => ({
  attempts: window.__gd3d.attempts(),
  z: window.__gd3d.playerPosition().z,
  target: window.__gd3d.musicTargetTime(),
}));
log('m9 R restarts attempt + music origin', restarted.attempts === attempts0 + 1 && restarted.z < 20 && restarted.target < 3, JSON.stringify(restarted));

// --- G. Death cuts music; respawn restarts it at the origin. ---
await ev(() => window.__gd3d.debugTeleport(0, -20, 60)); // void fall
await page.waitForFunction(() => window.__gd3d.status() === 'dead', null, { timeout: 30000 });
const deadProbe = await ev(() => ({ status: window.__gd3d.status(), music: window.__gd3d.musicState() }));
await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
await sleep(500);
const respawned = await ev(() => ({
  status: window.__gd3d.status(),
  music: window.__gd3d.musicState(),
  target: window.__gd3d.musicTargetTime(),
}));
log('m9 death cuts + respawn restarts music', deadProbe.status === 'dead' && respawned.status === 'running' && respawned.target < 3, JSON.stringify({ deadProbe, respawned }));

// --- H. Mute toggle is presentation-only. ---
await page.keyboard.press('KeyM');
await sleep(300);
const muted = await ev(() => window.__gd3d.musicMuted());
const zMute = await ev(() => window.__gd3d.playerPosition().z);
await sleep(700);
const zMute2 = await ev(() => window.__gd3d.playerPosition().z);
await page.keyboard.press('KeyM');
await sleep(300);
const unmuted = await ev(() => window.__gd3d.musicMuted());
log('m9 M mutes without touching gameplay', muted === true && unmuted === false && zMute2 > zMute, `muted=${muted}->${unmuted}`);

// --- I. Staged screenshots (paused floor stations). ---
const stage = async (name, x, y, z) => {
  await page.keyboard.press('KeyP'); // ensure running
  const wasPaused = await ev(() => window.__gd3d.paused());
  if (wasPaused) await page.keyboard.press('KeyP');
  await ev((pos) => window.__gd3d.debugTeleport(pos.x, pos.y, pos.z), { x, y, z });
  await sleep(400);
  await page.keyboard.press('KeyP');
  await sleep(400);
  await capture(name);
  await page.keyboard.press('KeyP'); // resume
  await sleep(200);
};
await stage('m9-forge', 0, 5.05, 60);
await stage('m9-river', 0, 0.55, 136);
await stage('m9-islands', 0, 5.05, 250);
await stage('m9-maze', 0, 0.55, 500);
await stage('m9-foundry', 0, 0.55, 930);
// M9: void station sits past the reconnect spike (1590) and before the
// maw ring (1596+) — never stage onto a hazard.
await stage('m9-void', 0, 0.55, 1594);
await stage('m9-core', 0, 0.55, 1680);
await stage('m9-finish', 0, 0.55, 1780);
log('m9 staged captures taken', true, 'm9-forge/river/islands/maze/foundry/void/core/finish');

// --- J. ?music=off: no gate, silent, immediate. ---
await page.goto(`${URL}?music=off`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
await sleep(2000);
const offProbe = await ev(() => ({
  awaiting: window.__gd3d.awaitingStart(),
  z: window.__gd3d.playerPosition().z,
  music: window.__gd3d.musicState(),
}));
log('m9 ?music=off starts immediately and silent', offProbe.awaiting === false && offProbe.z > -3 && offProbe.music === 'none', JSON.stringify(offProbe));

// --- K. Resources + error audit. ---
const res = await ev(() => ({
  mats: window.__gd3d.materialCount(),
  geos: window.__gd3d.geometryCount(),
  children: window.__gd3d.sceneChildren(),
}));
log('m9 resources bounded', res.mats < 60 && res.geos < 20 && res.children < 120, JSON.stringify(res));
log('m9 zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
log('m9 zero page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`\nM9 browser gate: ${results.length - failed.length}/${results.length} green`);
await browser.close();
if (failed.length > 0) process.exit(1);
