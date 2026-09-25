/**
 * M9.4.2 browser gate (dev tool, not shipped) — M8.6 THE DESCENT (no music)
 * + GRAVITY RIFT rename + menu/session/audio switching with a real browser.
 *
 * 1. Bare URL shows MAIN MENU: exactly THE DESCENT (ORIGINAL M8.6) +
 *    GRAVITY RIFT (EXPERT); GRAVITY RIFT + CLASSIC preselected.
 * 2. THE DESCENT + CLASSIC + START: run starts with NO audio fetch, NO
 *    decode, NO music graph (musicState none) — silence is content, not
 *    failure; the canvas/HUD/input session is exactly one.
 * 3. ☰ MENU pauses; RESUME continues; ESC → CHECKPOINT live-switch (no
 *    music change possible); MAIN MENU disposes to zero residue.
 * 4. GRAVITY RIFT + CHECKPOINT + START: Gravity Lessons plays with a
 *    wired graph; cp-forge activates; death restores it with a music
 *    re-seek to the checkpoint anchor; MAIN MENU stops the music.
 * 5. Repeat switch DESCENT → menu → RIFT → menu → DESCENT: exactly one
 *    session alive at a time, fingerprints stable per level, music
 *    none → playing → none → none (never two transports).
 * 6. Zero console/page errors.
 *
 * Usage: QA_URL=http://localhost:5174/ node scripts/browser-qa-m942.mjs
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
const audioRequests = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('request', (req) => { if (req.url().includes('/audio/')) audioRequests.push(req.url()); });

const waitGame = () =>
  page.waitForFunction(() => window.__gd3d !== undefined && window.__gd3d.screen() === 'game', null, { timeout: 60000 });
const waitMenu = () =>
  page.waitForFunction(() => window.__gd3d !== undefined && window.__gd3d.screen() === 'menu', null, { timeout: 60000 });
const pauseOpen = () =>
  page.waitForFunction(() => document.querySelector('.m94-pause-menu')?.style.display === 'block', null, { timeout: 10000 });
const sessionShape = () => ev(page, () => ({
  canvases: document.querySelectorAll('canvas').length,
  huds: document.querySelectorAll('.hud').length,
  pauseMenus: document.querySelectorAll('.m94-pause-menu').length,
  menuButtons: document.querySelectorAll('.hud-menu-button').length,
}));
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

// --- 1. MAIN MENU: exactly the two intended maps. ---
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await waitMenu();
const menu = await ev(page, () => ({
  cards: [...document.querySelectorAll('.m94-card')].map((e) => e.dataset.levelId),
  titles: [...document.querySelectorAll('.m94-card-title')].map((e) => e.textContent),
  tags: [...document.querySelectorAll('.m94-card-tag')].map((e) => e.textContent),
  selectedCard: document.querySelector('.m94-card.m94-selected')?.dataset.levelId ?? null,
  selectedMode: document.querySelector('.m94-mode-button.m94-selected')?.textContent ?? null,
  canvases: document.querySelectorAll('canvas').length,
}));
log(
  'm942 menu shows THE DESCENT + GRAVITY RIFT (rift preselected)',
  menu.cards.length === 2 && menu.cards.includes('the-descent') &&
    menu.cards.includes('production-showcase-01') && menu.canvases === 0 &&
    menu.titles.includes('THE DESCENT') && menu.titles.includes('GRAVITY RIFT') &&
    menu.tags.includes('ORIGINAL M8.6') && menu.tags.includes('EXPERT') &&
    menu.selectedCard === 'production-showcase-01' &&
    (menu.selectedMode ?? '').includes('CLASSIC'),
  JSON.stringify(menu),
);

// --- 2. THE DESCENT + CLASSIC + START: silence is content. ---
const audioBefore = audioRequests.length;
await page.locator('.m94-card', { hasText: 'ORIGINAL M8.6' }).click();
await page.locator('.m94-modes').getByRole('button', { name: 'CLASSIC' }).click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
await sleep(page, 800);
const descent = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  name: window.__gd3d.levelDisplayName(),
  mode: window.__gd3d.runMode(),
  kind: window.__gd3d.attemptKind(),
  music: window.__gd3d.musicState(),
  ctx: window.__gd3d.musicContextState(),
  ready: window.__gd3d.musicGraphReady(),
  fp: window.__gd3d.replayLevelFingerprint(),
}));
const descentFp = descent.fp;
const descentShape = await sessionShape();
log(
  'm942 THE DESCENT CLASSIC starts with zero audio (no fetch, no graph)',
  descent.level === 'the-descent' && descent.name === 'THE DESCENT' &&
    descent.mode === 'classic' && descent.kind === 'classic' &&
    descent.music === 'none' && descent.ctx === 'none' && descent.ready === false &&
    audioRequests.length === audioBefore &&
    descentShape.canvases === 1 && descentShape.huds === 1,
  JSON.stringify({ ...descent, fp: descentFp.slice(0, 12), audio: audioRequests.length - audioBefore, ...descentShape }),
);

// --- 3. Pause / live-switch / MAIN MENU on the trackless level. ---
await page.locator('.hud-menu-button').click();
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'CHECKPOINT' }).click();
const descentSwitched = await ev(page, () => ({
  mode: window.__gd3d.runMode(),
  kind: window.__gd3d.attemptKind(),
  visible: window.__gd3d.checkpointsVisible(),
  music: window.__gd3d.musicState(),
}));
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
log(
  'm942 trackless live-switch taints practice with crystals, still no audio',
  descentSwitched.mode === 'checkpoint' && descentSwitched.kind === 'practice' &&
    descentSwitched.visible === true && descentSwitched.music === 'none' &&
    audioRequests.length === audioBefore,
  JSON.stringify({ ...descentSwitched, audio: audioRequests.length - audioBefore }),
);
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await sleep(page, 300);
const disposed1 = await ev(page, () => ({
  cards: document.querySelectorAll('.m94-card').length,
  canvases: document.querySelectorAll('canvas').length,
  hudGone: document.querySelector('.hud') === null,
}));
log(
  'm942 MAIN MENU after THE DESCENT leaves zero residue and zero audio',
  disposed1.cards === 2 && disposed1.canvases === 0 && disposed1.hudGone === true &&
    audioRequests.length === audioBefore,
  JSON.stringify({ ...disposed1, audio: audioRequests.length - audioBefore }),
);

// --- 4. GRAVITY RIFT + CHECKPOINT + START: music plays, checkpoint seeks. ---
await page.locator('.m94-card', { hasText: 'GRAVITY RIFT' }).click();
await page.locator('.m94-mode-checkpoint').click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
await sleep(page, 800);
const rift = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  name: window.__gd3d.levelDisplayName(),
  mode: window.__gd3d.runMode(),
  graph: {
    created: window.__gd3d.musicSourceCreated(),
    source: window.__gd3d.musicSourceConnected(),
    gain: window.__gd3d.musicGainConnected(),
    ready: window.__gd3d.musicGraphReady(),
  },
  fp: window.__gd3d.replayLevelFingerprint(),
}));
const riftFp = rift.fp;
const riftGraphOk = rift.graph.created && rift.graph.source && rift.graph.gain && rift.graph.ready;
log(
  'm942 GRAVITY RIFT CHECKPOINT starts with wired Gravity Lessons graph',
  rift.level === 'production-showcase-01' && rift.name === 'GRAVITY RIFT' &&
    rift.mode === 'checkpoint' && riftGraphOk && riftFp !== descentFp,
  JSON.stringify({ ...rift, fp: riftFp.slice(0, 12) }),
);
await page.waitForFunction(() => {
  if (window.__gd3d.activeCheckpointId() === 'cp-forge') return true;
  if (window.__gd3d.status() === 'running' && window.__gd3d.playerPosition().z < 160) {
    window.__gd3d.debugTeleport(0, 0.55, 166);
  }
  return false;
}, null, { timeout: 60000 });
const anchor = await ev(page, () => window.__gd3d.musicTargetTime());
const riftCp = await killAndWaitRunning(page);
const riftTarget = await ev(page, () => window.__gd3d.musicTargetTime());
log(
  'm942 rift checkpoint death restores cp-forge with a music re-seek',
  riftCp.active === 'cp-forge' && Math.abs(riftCp.z - 170) < 8 &&
    Math.abs(riftTarget - anchor) < 2.5,
  JSON.stringify({ ...riftCp, anchor, target: riftTarget }),
);
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await sleep(page, 300);
const disposed2 = await ev(page, () => ({
  canvases: document.querySelectorAll('canvas').length,
  hudGone: document.querySelector('.hud') === null,
}));
log(
  'm942 MAIN MENU after GRAVITY RIFT disposes the session with zero residue',
  disposed2.canvases === 0 && disposed2.hudGone === true,
  JSON.stringify(disposed2),
);

// --- 5. Repeat switch: sessions stay single, fingerprints stable. ---
// GRAVITY RIFT fetched its track exactly once; THE DESCENT must add none.
const audioAfterRift = audioRequests.length;
await page.locator('.m94-card', { hasText: 'ORIGINAL M8.6' }).click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
const backDescent = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  music: window.__gd3d.musicState(),
  fp: window.__gd3d.replayLevelFingerprint(),
}));
const backShape = await sessionShape();
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
log(
  'm942 repeat switch keeps one session, stable fingerprint, no leaked soundtrack',
  backDescent.level === 'the-descent' && backDescent.music === 'none' &&
    backDescent.fp === descentFp &&
    backShape.canvases === 1 && backShape.huds === 1 && backShape.pauseMenus === 1 &&
    audioAfterRift === audioBefore + 1 && audioRequests.length === audioAfterRift,
  JSON.stringify({ ...backDescent, fp: backDescent.fp.slice(0, 12), ...backShape, audio: audioRequests }),
);

log('m942 zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
log('m942 zero page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nM9.4.2 BROWSER GATE: ${failed.length === 0 ? 'PASS' : 'FAILED'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length === 0 ? 0 : 1);
