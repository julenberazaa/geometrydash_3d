/**
 * M9.6.1 browser gate (dev tool, not shipped) — Descent telegraphing +
 * biome overhaul with a real browser.
 *
 * 1. Menu boots (hub regression).
 * 2. START Descent classic: snapmarkCount === 6, dressInstances in
 *    bounded authored/seeded dressing, session shape sane.
 * 3. Gap-frame legibility stills (A1 doors, maze 599 doors, foundry).
 * 4. Spider snap-marker stills (entries show mint diamonds).
 * 5. Biome stills, one per act (judged by a human from the PNGs).
 * 6. Completion: a fresh current-content primary tape finishes in-page
 *    REPLAY VERIFIED after the authored obstacle changes.
 * 7. Perf: draw calls vs the Rift control (same renderer path, no
 *    dressing declared) + resource counts, zero errors.
 *
 * Usage: QA_URL=http://localhost:5174/ node scripts/browser-qa-m961.mjs
 * (requires the dev server + system Chrome; generates its own current tape).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyGpuRenderer } from './perfGateLib.mjs';

const URL = process.env.QA_URL ?? 'http://localhost:5174/';
const measuredUrl = new globalThis.URL(URL);
measuredUrl.searchParams.set('perf', '1');
// Current-content primary tape (generated every run so gameplay edits never
// accidentally replay a stale fingerprint).
const TAPE = path.join(os.tmpdir(), `m961-descent-primary-${process.pid}.json`);
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR ?? 'qa/screenshots');
const BIOME_BANDS = new Map([
  ['m961-biome-forge', [-10, 170]], ['m961-biome-islands', [170, 430]],
  ['m961-biome-labyrinth', [430, 720]], ['m961-biome-cathedral', [720, 920]],
  ['m961-biome-canyon', [920, 1110]], ['m961-biome-reactor', [1110, 1330]],
  ['m961-biome-temple', [1330, 1510]], ['m961-biome-void', [1510, 1620]],
  ['m961-biome-core', [1620, 1800]],
]);
const withinBiomeBudget = (row) => {
  const band = BIOME_BANDS.get(row.name);
  return band !== undefined && row.z >= band[0] && row.z < band[1]
    && row.calls <= 450 && row.triangles <= 70000;
};
// Gameplay geometry changes invalidate old fingerprints. Record and verify a
// fresh deterministic Descent tape before every browser run.
execFileSync('npx vite-node scripts/generate-m91-tape.ts ' + JSON.stringify(TAPE) + ' the-descent', {
  stdio: 'inherit', shell: true,
});

const results = [];
const biomePerf = [];
let failures = 0;
const log = (name, ok, detail) => {
  results.push({ name, ok, detail: detail ?? '' });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
};
const ev = (page, fn, arg) => (arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg));
const sleep = (page, ms) => page.waitForTimeout(ms);

const browser = await chromium.launch({
  channel: 'chrome',
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const consoleErrors = [];
const pageErrors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => pageErrors.push(String(err)));

const waitGame = () =>
  page.waitForFunction(() => window.__gd3d !== undefined && window.__gd3d.screen() === 'game', null, { timeout: 60000 });
const waitMenu = () =>
  page.waitForFunction(() => window.__gd3d !== undefined && window.__gd3d.screen() === 'menu', null, { timeout: 60000 });
const screenshot = async (name) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
};
/** Teleport + short settle + pause-frozen still (retry once on death).
 *  Pausing guarantees no death mid-shot; menu overlay + PAUSED banner hide
 *  via CSS for the capture (restored after). Optional drive actions
 *  (weave taps/jumps) feed real keyboard input while settling, polled by
 *  forward position — staged teleports into weaves die without them. */
const still = async (name, x, y, z, ms = 400, drive = []) => {
  let status = 'unknown';
  let capturedZ = NaN;
  for (let attempt = 0; attempt < 2; attempt++) {
    await ev(page, ([px, py, pz]) => window.__gd3d.debugTeleport(px, py, pz), [x, y, z]);
    const fired = new Set();
    const settleEnd = Date.now() + ms;
    while (Date.now() < settleEnd) {
      const pz = await ev(page, () => window.__gd3d.playerPosition().z);
      for (let di = 0; di < drive.length; di++) {
        if (!fired.has(di) && pz >= drive[di].atZ) {
          fired.add(di);
          await page.keyboard.press(drive[di].key);
        }
      }
      await sleep(page, 25);
    }
    const state = await ev(page, () => ({ status: window.__gd3d.status(), z: window.__gd3d.playerPosition().z }));
    status = state.status;
    if (status !== 'running' || Math.abs(state.z - z) > 20) {
      await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
      continue;
    }
    capturedZ = state.z;
    if (name.startsWith('m961-biome-')) {
      biomePerf.push({ name, z: state.z, ...(await ev(page, () => window.__gd3d.rendererStats())) });
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.m94-pause-menu')?.style.display === 'block', null, { timeout: 10000 });
    await ev(page, () => {
      const pauseMenu = document.querySelector('.m94-pause-menu');
      if (pauseMenu !== null) pauseMenu.style.visibility = 'hidden';
      const banner = document.querySelector('.hud-message');
      if (banner !== null) banner.style.visibility = 'hidden';
    });
    await screenshot(name);
    await ev(page, () => {
      const pauseMenu = document.querySelector('.m94-pause-menu');
      if (pauseMenu !== null) pauseMenu.style.visibility = '';
      const banner = document.querySelector('.hud-message');
      if (banner !== null) banner.style.visibility = '';
    });
    await page.keyboard.press('Escape');
    await sleep(page, 300);
    break;
  }
  console.log(`still ${name}: status=${status} capturedZ=${capturedZ.toFixed(1)} targetZ=${z}`);
  log(`${name} captured on route`, status === 'running' && Math.abs(capturedZ - z) <= 20);
  return status;
};

// --- 1. Menu boots (hub regression). ---
await page.goto(measuredUrl.href, { waitUntil: 'load', timeout: 60000 });
await waitMenu();
await sleep(page, 1500);
const menu = await ev(page, () => ({
  hubReady: window.__gd3d.hubReady(),
  hubCanvases: window.__gd3d.hubCanvases(),
  cards: window.__gd3d.menuCards(),
}));
log(
  'm961 menu boots with the hub',
  menu.hubReady === true && menu.hubCanvases === 1 && menu.cards.length === 2,
  JSON.stringify(menu),
);

// --- 2. START Descent classic: markers + dressing probes. ---
await page.evaluate(() => window.__gd3d.selectLevel('the-descent'));
await page.click('.m94-start-button');
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicPlaying() === true, null, { timeout: 60000 });
await sleep(page, 800);
const dress = await ev(page, () => ({
  snaps: window.__gd3d.snapmarkCount(),
  dress: window.__gd3d.dressInstances(),
  shape: {
    canvases: document.querySelectorAll('canvas').length,
    huds: document.querySelectorAll('.hud').length,
  },
}));
log(
  'm961 markers (6) + dressing (bounded, substantial) present',
  dress.snaps === 6 && dress.dress > 100 && dress.dress <= 220 &&
    dress.shape.canvases === 1 && dress.shape.huds === 1,
  JSON.stringify(dress),
);

// --- 3. Gap-frame legibility stills (driver-exact states). ---
await still('m961-gap-a1', 0, 2.05, 43, 120);
await still('m961-gap-maze', 0, 5.05, 590, 400, [{ atZ: 594, key: 'ArrowRight' }]);
await still('m961-gap-foundry', 0, 1.0, 1080);

// --- 4. Spider snap-marker stills (mint diamonds on the line). ---
// (Retry on death: the entry runway is hot without inputs. Wait for a
// live session before each teleport — debugTeleport is a no-op while
// dead and the run would chase its own respawn tail otherwise.)
for (let attempt = 0; attempt < 3; attempt++) {
  await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
  await ev(page, ([px, py, pz]) => window.__gd3d.debugTeleport(px, py, pz), [0, 0.55, 1332]);
  try {
    await page.waitForFunction(() => window.__gd3d.playerMode() === 'spider', null, { timeout: 12000 });
    break;
  } catch {
    await sleep(page, 1000);
  }
}
await page.waitForFunction(() => window.__gd3d.playerMode() === 'spider', null, { timeout: 30000 });
await page.waitForFunction(() => window.__gd3d.playerMode() === 'spider', null, { timeout: 30000 });
await sleep(page, 250);
await screenshot('m961-snap-entry');
const snapView = await ev(page, () => ({
  snaps: window.__gd3d.spiderSnapCount(), z: window.__gd3d.playerPosition().z,
}));
log('m961 spider entry shows the line (markers ahead)', snapView.z > 1325, JSON.stringify(snapView));
// Exercise the first Descent snap with an actual key edge, then observe the
// vertical beam while it is active. A marker-only still cannot prove input.
let descentSnap = null;
// One input attempt: a retry would hide the ignored-first-press regression.
{
  await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
  await ev(page, () => window.__gd3d.debugTeleport(0, 0.55, 1339.4));
  await page.waitForFunction(() => window.__gd3d.playerMode() === 'spider', null, { timeout: 10000 });
  await sleep(page, 75);
  const before = await ev(page, () => window.__gd3d.spiderSnapCount());
  await page.keyboard.press('Space');
  for (let i = 0; i < 10; i++) {
    const live = await ev(page, () => ({
      snaps: window.__gd3d.spiderSnapCount(),
      beam: window.__gd3d.spiderBeamActive(),
      anchor: window.__gd3d.lastSpiderSnap(),
    }));
    if (live.snaps > before) {
      descentSnap = live;
      if (live.beam) await screenshot('m961-spider-beam');
      break;
    }
    await sleep(page, 25);
  }
}
log('m961 Descent key edge snaps immediately with visible beam',
  descentSnap !== null && descentSnap.beam === true &&
    descentSnap.anchor !== null && Math.abs(descentSnap.anchor.to.y - descentSnap.anchor.from.y) > 1,
  JSON.stringify(descentSnap));

// --- 5. Biome stills, one per act (driver-exact states where known). ---
await still('m961-biome-forge', 0, 3.6, 100);
await still('m961-biome-islands', 0, 0.55, 270);
await still('m961-biome-labyrinth', 0, 0.55, 450, 90);
await still('m961-biome-cathedral', 0, 0.55, 732, 120);
await still('m961-biome-canyon', 0, 1.98, 940, 90);
await still('m961-biome-reactor', 0, 3.1, 1150);
await still('m961-biome-temple', 0, 0.55, 1330);
await still('m961-biome-void', 0, 12.6, 1550, 200);
await still('m961-biome-core', 2.6, 0.55, 1680);

// Fast art iteration is explicitly a partial run, never a completion gate.
if (process.env.QA_STILLS_ONLY === '1') {
  fs.writeFileSync(path.join(OUT_DIR, 'stills-workload.json'), JSON.stringify(biomePerf, null, 2));
  log('partial stills: bounded rendering workload',
    biomePerf.length === 9 && biomePerf.every(withinBiomeBudget),
    JSON.stringify(biomePerf));
  log('partial stills: zero console/page errors', consoleErrors.length === 0 && pageErrors.length === 0,
    JSON.stringify({ consoleErrors, pageErrors }));
  console.log('PARTIAL art inspection only — full replay/menu/performance gates not run');
  await browser.close();
  process.exit(failures > 0 ? 1 : 0);
}

// --- 6. Completion: freshly recorded current-content tape. ---
await page.keyboard.press('Escape');
await page.waitForFunction(() => document.querySelector('.m94-pause-menu')?.style.display === 'block', null, { timeout: 10000 });
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await sleep(page, 500);
await page.evaluate(() => window.__gd3d.selectLevel('the-descent'));
await page.click('.m94-start-button');
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicPlaying() === true, null, { timeout: 60000 });
const tapeJson = fs.readFileSync(TAPE, 'utf8');
const injected = await ev(page, (json) => window.__gd3d.debugStartReplayJson(json), tapeJson);
await ev(page, () => window.__gd3d.perfBeginSampling());
const gpu = await ev(page, () => window.__gd3d.gpuIdentity());
const frameSamples = [];
const replayDeadline = Date.now() + 600000;
while (Date.now() < replayDeadline) {
  await sleep(page, 1000);
  const sample = await ev(page, () => ({
    z: window.__gd3d.playerPosition().z,
    verification: window.__gd3d.replayVerification(),
    stats: window.__gd3d.rendererStats(),
    perf: window.__gd3d.perfSnapshot(),
  }));
  frameSamples.push(sample);
  if (sample.verification.kind === 'pass' || sample.verification.kind === 'diverged') break;
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'performance.json'), JSON.stringify({
  gpu, rendererKind: classifyGpuRenderer(gpu.renderer),
  viewport: { width: 1280, height: 720 }, frameSamples,
}, null, 2));
console.log(`GPU ${classifyGpuRenderer(gpu.renderer)}: ${gpu.renderer}; ${frameSamples.length} live replay samples saved`);
const replayed = await ev(page, () => ({
  verification: window.__gd3d.replayVerification(),
  status: window.__gd3d.status(),
  chomps: window.__gd3d.chompers().map((c) => c.phase),
}));
log(
  'm961 current tape finishes REPLAY VERIFIED',
  injected.ok === true && replayed.verification.kind === 'pass' &&
    replayed.status === 'finished' &&
    replayed.chomps.length === 8 && replayed.chomps.every((p) => p === 'spent'),
  JSON.stringify({ ...replayed, injected }),
);
await screenshot('m961-descent-finish');

// --- 7. Perf vs the Rift control (no dressing declared there). ---
const descentPerf = await ev(page, () => ({
  calls: window.__gd3d.rendererStats().calls,
  tris: window.__gd3d.rendererStats().triangles,
  children: window.__gd3d.sceneChildren(),
  mats: window.__gd3d.materialCount(),
  geos: window.__gd3d.geometryCount(),
}));
// Mid-run Descent has far more drawables than the finished pose. Guard
// each act's actual live frame against a gross workload blowout; the M6D
// perf harness and real-GPU human gate remain the frame-time authority.
log('m961 per-biome bounded rendering workload',
  biomePerf.length === 9 && biomePerf.every(withinBiomeBudget),
  JSON.stringify(biomePerf));
await page.keyboard.press('Escape');
await page.waitForFunction(() => document.querySelector('.m94-pause-menu')?.style.display === 'block', null, { timeout: 10000 });
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await sleep(page, 500);
await page.evaluate(() => window.__gd3d.selectLevel('production-showcase-01'));
await page.click('.m94-start-button');
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicPlaying() === true, null, { timeout: 60000 });
await sleep(page, 1000);
const riftPerf = await ev(page, () => ({
  calls: window.__gd3d.rendererStats().calls,
  tris: window.__gd3d.rendererStats().triangles,
  children: window.__gd3d.sceneChildren(),
  mats: window.__gd3d.materialCount(),
  geos: window.__gd3d.geometryCount(),
}));
log(
  'm961 bounded shared biome route and spike resources',
  descentPerf.calls <= 100 && descentPerf.tris <= 150000 &&
    // Nine route materials + two cached spike materials per biome.
    descentPerf.geos <= riftPerf.geos + 1 && descentPerf.mats <= riftPerf.mats + 27,
  JSON.stringify({ descent: descentPerf, rift: riftPerf }),
);

// --- 8. Zero errors. ---
log(
  'm961 zero console/page errors',
  consoleErrors.length === 0 && pageErrors.length === 0,
  JSON.stringify({ consoleErrors, pageErrors }),
);

console.log(`\nm961: ${results.length - failures}/${results.length} passed`);
await browser.close();
process.exit(failures > 0 ? 1 : 0);
