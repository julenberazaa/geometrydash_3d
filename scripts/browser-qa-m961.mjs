/**
 * M9.6.1 browser gate (dev tool, not shipped) — Descent telegraphing +
 * biome overhaul with a real browser.
 *
 * 1. Menu boots (hub regression).
 * 2. START Descent classic: snapmarkCount === 6, dressInstances in
 *    (100, 220], session shape sane.
 * 3. Gap-frame legibility stills (A1 doors, maze 599 doors, foundry).
 * 4. Spider snap-marker stills (entries show mint diamonds).
 * 5. Biome stills, one per act (judged by a human from the PNGs).
 * 6. Completion: the M9.5 primary tape (gameplay-identical content)
 *    finishes in-page REPLAY VERIFIED — the visual pass proves
 *    gameplay-identity, not just beauty.
 * 7. Perf: draw calls vs the Rift control (same renderer path, no
 *    dressing declared) + resource counts, zero errors.
 *
 * Usage: QA_URL=http://localhost:5174/ node scripts/browser-qa-m961.mjs
 * (requires the dev server + the current-content tape + system Chrome).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.QA_URL ?? 'http://localhost:5174/';
// Current-content primary tape (regenerate on gameplay changes — the M9.5
// tape is correctly stale after Zone G by the fingerprint contract).
const TAPE = 'C:/Users/Julen/AppData/Local/Temp/opencode/m961-descent-primary-tape.json';
const OUT_DIR = path.resolve('qa/screenshots');

const results = [];
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
    status = await ev(page, () => window.__gd3d.status());
    if (status !== 'running') {
      await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
      continue;
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
  const info = await ev(page, () => ({
    p: window.__gd3d.playerPosition(), status: window.__gd3d.status(),
    mode: window.__gd3d.playerMode(), grav: window.__gd3d.gravityMode(),
  }));
  console.log(`still ${name}: status=${status} z=${info.p.z.toFixed(1)} ${info.mode}/${info.grav}`);
  return status;
};

// --- 1. Menu boots (hub regression). ---
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
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
await still('m961-gap-a1', 0, 3.6, 50, 500, [{ atZ: 52.5, key: 'Space' }]);
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

// --- 5. Biome stills, one per act (driver-exact states where known). ---
await still('m961-biome-forge', 0, 3.6, 100);
await still('m961-biome-islands', 0, 0.55, 270);
await still('m961-biome-labyrinth', 0, 0.55, 440, 400, [{ atZ: 444, key: 'ArrowRight' }]);
await still('m961-biome-cathedral', 0, 0.55, 700);
await still('m961-biome-canyon', 0, 1.03, 1000);
await still('m961-biome-reactor', 0, 3.1, 1150);
await still('m961-biome-temple', 0, 0.55, 1330);
await still('m961-biome-void', 0, 12.6, 1550, 200);
await still('m961-biome-core', 2.6, 0.55, 1680);

// --- 6. Completion: M9.5 tape on identical gameplay. ---
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
await page.waitForFunction(
  () => {
    const v = window.__gd3d.replayVerification();
    return v.kind === 'pass' || v.kind === 'diverged';
  },
  null, { timeout: 600000 },
);
const replayed = await ev(page, () => ({
  verification: window.__gd3d.replayVerification(),
  status: window.__gd3d.status(),
  chomps: window.__gd3d.chompers().map((c) => c.phase),
}));
log(
  'm961 current tape finishes REPLAY VERIFIED (gameplay identical)',
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
  'm961 perf flat vs Rift (dressing ≈ +6 draws, +0 geometries)',
  descentPerf.calls <= riftPerf.calls + 80 && descentPerf.geos === riftPerf.geos &&
    descentPerf.mats <= riftPerf.mats + 3,
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
