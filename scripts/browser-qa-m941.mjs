/**
 * M9.4.1 browser gate (dev tool, not shipped) — the §29 human flow:
 * M8.6 THE DESCENT vs GRAVITY RIFT are really different levels, and MAIN
 * MENU is reachable from any active run.
 *
 * 1. Bare URL shows MAIN MENU (exactly two production cards).
 * 2. THE DESCENT (M9.5) + CLASSIC + START → the polished level
 *    id/fingerprint, with Zenith playing.
 * 3. ☰ MENU button opens the pause menu; RESUME continues.
 * 4. ESC opens the pause menu; switch to CHECKPOINT → tainted practice,
 *    crystals visible; resume.
 * 5. ESC → MAIN MENU → session fully disposed (no canvas, no HUD).
 * 6. GRAVITY RIFT + CHECKPOINT + START → current level id/fingerprint (!= descent).
 * 7. Activate cp-forge → death restores it (with music re-seek).
 * 8. ESC → switch CLASSIC → resume + die → origin.
 * 9. ESC → MAIN MENU → THE DESCENT + START again → descent fingerprint,
 *    single canvas/HUD/pause-menu, Zenith rewired (no duplicates).
 * 10. Zero console/page errors.
 *
 * Usage: QA_URL=http://localhost:5174/ node scripts/browser-qa-m941.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.QA_URL ?? 'http://localhost:5174/';

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok, detail: detail ?? '' });
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
const pauseOpen = () =>
  page.waitForFunction(() => document.querySelector('.m94-pause-menu')?.style.display === 'block', null, { timeout: 10000 });
const killAndWaitRunning = async () => {
  await ev(page, () => {
    const p = window.__gd3d.playerPosition();
    window.__gd3d.debugTeleport(p.x, -100, p.z);
  });
  await page.waitForFunction(() => window.__gd3d.status() === 'dead', null, { timeout: 30000 });
  await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
  return ev(page, () => ({
    z: window.__gd3d.playerPosition().z,
    active: window.__gd3d.activeCheckpointId(),
  }));
};

// --- 1. MAIN MENU on the bare URL. ---
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await waitMenu();
const menu = await ev(page, () => ({
  cards: [...document.querySelectorAll('.m94-card')].map((e) => e.dataset.levelId),
  titles: [...document.querySelectorAll('.m94-card-title')].map((e) => e.textContent),
  tags: [...document.querySelectorAll('.m94-card-tag')].map((e) => e.textContent),
  canvases: document.querySelectorAll('canvas').length,
  probeCards: window.__gd3d.menuCards(),
}));
log(
  'm941 main menu holds exactly the two production levels',
  menu.cards.length === 2 && menu.cards.includes('the-descent') &&
    menu.cards.includes('production-showcase-01') && menu.canvases === 0 &&
    (menu.probeCards ?? []).length === 2 &&
    menu.titles.includes('THE DESCENT') && menu.titles.includes('GRAVITY RIFT') &&
    menu.tags.includes('ORIGINAL M8.6') && menu.tags.includes('EXPERT'),
  JSON.stringify(menu),
);

// --- 2. THE DESCENT (M9.5) + CLASSIC + START — Zenith plays on this level. ---
await page.locator('.m94-card', { hasText: 'ORIGINAL M8.6' }).click();
await page.locator('.m94-modes').getByRole('button', { name: 'CLASSIC' }).click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
await sleep(page, 800);
const original = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  name: window.__gd3d.levelDisplayName(),
  mode: window.__gd3d.runMode(),
  kind: window.__gd3d.attemptKind(),
  visible: window.__gd3d.checkpointsVisible(),
  count: window.__gd3d.checkpointCount(),
  music: window.__gd3d.musicState(),
  ready: window.__gd3d.musicGraphReady(),
  finishZ: window.__gd3d.playerPosition().z,
  fp: window.__gd3d.replayLevelFingerprint(),
  canvases: document.querySelectorAll('canvas').length,
}));
const originalFp = original.fp;
log(
  'm941 M9.5 DESCENT CLASSIC starts the polished level with Zenith playing',
  original.level === 'the-descent' && original.name === 'THE DESCENT' &&
    original.mode === 'classic' && original.kind === 'classic' &&
    original.visible === false && original.count === 8 && original.canvases === 1 &&
    original.music === 'playing' && original.ready === true,
  JSON.stringify({ ...original, fp: originalFp.slice(0, 12) }),
);

// --- 3. ☰ MENU button opens the pause menu; RESUME continues. ---
await page.locator('.hud-menu-button').click();
await pauseOpen();
const viaButton = await ev(page, () => ({ paused: window.__gd3d.paused() }));
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
log('m941 HUD MENU button pauses and resumes', viaButton.paused === true, JSON.stringify(viaButton));

// --- 4. ESC → pause → CHECKPOINT → resume (tainted, crystals visible). ---
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'CHECKPOINT' }).click();
const switched = await ev(page, () => ({
  mode: window.__gd3d.runMode(),
  kind: window.__gd3d.attemptKind(),
  visible: window.__gd3d.checkpointsVisible(),
  paused: window.__gd3d.paused(),
}));
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
log(
  'm941 ESC pause-switch to CHECKPOINT taints practice with crystals',
  switched.mode === 'checkpoint' && switched.kind === 'practice' &&
    switched.visible === true && switched.paused === true,
  JSON.stringify(switched),
);

// --- 5. ESC → MAIN MENU disposes the session. ---
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await sleep(page, 300);
const disposed = await ev(page, () => ({
  cards: document.querySelectorAll('.m94-card').length,
  canvases: document.querySelectorAll('canvas').length,
  hudGone: document.querySelector('.hud') === null,
  pauseGone: document.querySelector('.m94-pause-menu') === null,
}));
log(
  'm941 MAIN MENU fully disposes the session',
  disposed.cards === 2 && disposed.canvases === 0 &&
    disposed.hudGone === true && disposed.pauseGone === true,
  JSON.stringify(disposed),
);

// --- 6. GRAVITY RIFT + CHECKPOINT + START. ---
await page.locator('.m94-card', { hasText: 'GRAVITY RIFT' }).click();
await page.locator('.m94-mode-checkpoint').click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
await sleep(page, 800);
const evolved = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  name: window.__gd3d.levelDisplayName(),
  mode: window.__gd3d.runMode(),
  kind: window.__gd3d.attemptKind(),
  fp: window.__gd3d.replayLevelFingerprint(),
}));
log(
  'm941 RIFT CHECKPOINT is a different level session',
  evolved.level === 'production-showcase-01' && evolved.name === 'GRAVITY RIFT' &&
    evolved.mode === 'checkpoint' && evolved.kind === 'practice' && evolved.fp !== originalFp,
  JSON.stringify({ ...evolved, fp: evolved.fp.slice(0, 12) }),
);

// --- 7. Rift cp-forge activates; death restores it. ---
await page.waitForFunction(() => {
  if (window.__gd3d.activeCheckpointId() === 'cp-forge') return true;
  if (window.__gd3d.status() === 'running' && window.__gd3d.playerPosition().z < 160) {
    window.__gd3d.debugTeleport(0, 0.55, 166);
  }
  return false;
}, null, { timeout: 60000 });
const evolvedCp = await killAndWaitRunning(page);
log(
  'm941 rift checkpoint death restores cp-forge',
  evolvedCp.active === 'cp-forge' && Math.abs(evolvedCp.z - 170) < 8,
  JSON.stringify(evolvedCp),
);

// --- 8. ESC → CLASSIC → resume + die → origin. ---
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'CLASSIC' }).click();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
const backAtOrigin = await killAndWaitRunning(page);
log(
  'm941 classic death returns to the origin',
  Math.abs(backAtOrigin.z + 4) < 8,
  JSON.stringify(backAtOrigin),
);

// --- 9. ESC → MAIN MENU → THE DESCENT again: same fingerprint, no duplicates, Zenith restarts. ---
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await page.locator('.m94-card', { hasText: 'ORIGINAL M8.6' }).click();
await page.locator('.m94-modes').getByRole('button', { name: 'CLASSIC' }).click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
await sleep(page, 800);
const again = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  music: window.__gd3d.musicState(),
  fp: window.__gd3d.replayLevelFingerprint(),
  canvases: document.querySelectorAll('canvas').length,
  huds: document.querySelectorAll('.hud').length,
  pauseMenus: document.querySelectorAll('.m94-pause-menu').length,
  menuButtons: document.querySelectorAll('.hud-menu-button').length,
  graph: {
    created: window.__gd3d.musicSourceCreated(),
    source: window.__gd3d.musicSourceConnected(),
    gain: window.__gd3d.musicGainConnected(),
    ready: window.__gd3d.musicGraphReady(),
  },
}));
const graphWired = again.graph.created && again.graph.source && again.graph.gain && again.graph.ready;
log(
  'm941 DESCENT restart is identical with Zenith rewired and no duplicate session residue',
  again.level === 'the-descent' && again.fp === originalFp &&
    again.canvases === 1 && again.huds === 1 && again.pauseMenus === 1 &&
    again.menuButtons === 1 && graphWired && again.music === 'playing',
  JSON.stringify({ ...again, fp: again.fp.slice(0, 12) }),
);

log('m941 zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
log('m941 zero page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nM9.4.1 BROWSER GATE: ${failed.length === 0 ? 'PASS' : 'FAILED'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length === 0 ? 0 : 1);
