/**
 * M9.5 browser gate (dev tool, not shipped) — THE DESCENT Zenith density
 * polish + Zenith of the Path music with a real browser.
 *
 * 1. Bare URL shows MAIN MENU: THE DESCENT (ORIGINAL M8.6, Zenith blurb) +
 *    GRAVITY RIFT (EXPERT); GRAVITY RIFT + CLASSIC preselected.
 * 2. THE DESCENT + CLASSIC + START: Zenith of the Path plays with a wired
 *    source→gain→destination graph (buffer ≈ 127.71 s); exactly one Zenith
 *    fetch; rhythm pulse follows the Zenith grid (count-in at t≈1 s, beat
 *    envelope oscillates).
 * 3. Tape injection: the headless M9.5 primary tape
 *    (C:/Users/Julen/AppData/Local/Temp/opencode/m95-descent-primary-tape.json
 *    — generate via `npx vite-node scripts/tmp-m95-tape.ts`) finishes
 *    in-page with REPLAY VERIFIED (full-route proof through the real
 *    renderer, incl. the 3 new Chompers + doors).
 * 4. New-zone spot checks: deck-chomper dormant→telegraph→lunging→spent
 *    progression via probes; staged screenshots (upper doors, foundry
 *    doors, shaft chomper, deck chomper).
 * 5. Pause/resume (music + sim freeze together); live CHECKPOINT switch
 *    (no music restart/seek); MAIN MENU disposes to zero residue.
 * 6. THE DESCENT + CHECKPOINT + START: cp-forge activates; death restores
 *    it with a Zenith re-seek to the checkpoint anchor.
 * 7. GRAVITY RIFT regression: wired Gravity Lessons graph + cp-forge
 *    checkpoint seek + MAIN MENU disposal.
 * 8. Repeat switch DESCENT → menu → RIFT → menu → DESCENT: one session at
 *    a time, fingerprints isolated per level, never two transports.
 * 9. Zero console/page errors.
 *
 * Usage: QA_URL=http://localhost:5174/ node scripts/browser-qa-m95.mjs
 * (requires the M9.5 primary tape file above + dev server).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.QA_URL ?? 'http://localhost:5174/';
// QA_TAPE override: point at a current-content tape after intentional
// gameplay changes (the M9.5 file correctly goes stale by fingerprint).
const TAPE = process.env.QA_TAPE ?? 'C:/Users/Julen/AppData/Local/Temp/opencode/m95-descent-primary-tape.json';
const OUT_DIR = path.resolve('qa/screenshots');

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
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
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
const screenshot = async (name) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
};

// --- 1. MAIN MENU. ---
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await waitMenu();
const menu = await ev(page, () => ({
  cards: [...document.querySelectorAll('.m94-card')].map((e) => e.dataset.levelId),
  titles: [...document.querySelectorAll('.m94-card-title')].map((e) => e.textContent),
  tags: [...document.querySelectorAll('.m94-card-tag')].map((e) => e.textContent),
  blurbs: [...document.querySelectorAll('.m94-card-blurb')].map((e) => e.textContent),
  selectedCard: document.querySelector('.m94-card.m94-selected')?.dataset.levelId ?? null,
  selectedMode: document.querySelector('.m94-mode-button.m94-selected')?.textContent ?? null,
  canvases: document.querySelectorAll('canvas').length,
  hubCanvases: document.querySelectorAll('.m96-hub-canvas').length,
}));
log(
  'm95 menu shows THE DESCENT (Zenith) + GRAVITY RIFT (rift preselected)',
  menu.cards.length === 2 && menu.cards.includes('the-descent') &&
    menu.cards.includes('production-showcase-01') && menu.canvases === 1 && menu.hubCanvases === 1 &&
    menu.titles.includes('THE DESCENT') && menu.titles.includes('GRAVITY RIFT') &&
    menu.tags.includes('ORIGINAL M8.6') && menu.tags.includes('EXPERT') &&
    menu.selectedCard === 'production-showcase-01' &&
    (menu.selectedMode ?? '').includes('CLASSIC') &&
    menu.blurbs.some((b) => (b ?? '').includes('Zenith')) &&
    !menu.blurbs.some((b) => (b ?? '').includes('No music')),
  JSON.stringify(menu),
);

// --- 2. THE DESCENT + CLASSIC + START: Zenith plays, wired graph. ---
const audioBefore = audioRequests.length;
await page.locator('.m94-card', { hasText: 'ORIGINAL M8.6' }).click();
await page.locator('.m94-modes').getByRole('button', { name: 'CLASSIC' }).click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
await sleep(page, 800);
const descent = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  name: window.__gd3d.levelDisplayName(),
  mode: window.__gd3d.runMode(),
  kind: window.__gd3d.attemptKind(),
  music: window.__gd3d.musicState(),
  created: window.__gd3d.musicSourceCreated(),
  source: window.__gd3d.musicSourceConnected(),
  gain: window.__gd3d.musicGainConnected(),
  ready: window.__gd3d.musicGraphReady(),
  buffer: window.__gd3d.musicBufferDuration(),
  section: window.__gd3d.rhythmSection(),
  beat: window.__gd3d.rhythmBeat(),
  fp: window.__gd3d.replayLevelFingerprint(),
}));
const descentFp = descent.fp;
const descentShape = await sessionShape();
const zenithFetches = audioRequests.filter((u) => u.includes('Zenith_of_the_Path')).length;
log(
  'm95 THE DESCENT CLASSIC plays Zenith with a wired graph (buffer ~127.71)',
  descent.level === 'the-descent' && descent.name === 'THE DESCENT' &&
    descent.mode === 'classic' && descent.kind === 'classic' &&
    descent.music === 'playing' && descent.created && descent.source &&
    descent.gain && descent.ready &&
    Math.abs(descent.buffer - 127.71) < 0.6 && zenithFetches === 1 &&
    descentShape.canvases === 1 && descentShape.huds === 1,
  JSON.stringify({ ...descent, fp: descentFp.slice(0, 12), zenithFetches, ...descentShape }),
);
log(
  'm95 Descent rhythm pulse follows the Zenith grid (count-in, beat alive)',
  (descent.section === 'count-in' || descent.section === 'intro') &&
    descent.beat > 0 && descent.beat <= 1,
  JSON.stringify({ section: descent.section, beat: descent.beat }),
);

// --- 3. Tape injection: full M9.5 primary route finishes REPLAY VERIFIED. ---
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
  badge: window.__gd3d.replayBadge(),
  status: window.__gd3d.status(),
  chomps: window.__gd3d.chompers().map((c) => c.phase),
}));
log(
  'm95 injected M9.5 primary tape finishes in-page REPLAY VERIFIED (8/8 chompers spent)',
  injected.ok === true && replayed.verification.kind === 'pass' &&
    replayed.status === 'finished' &&
    replayed.chomps.length === 8 && replayed.chomps.every((p) => p === 'spent'),
  JSON.stringify({ ...replayed, injected }),
);
await screenshot('m95-01-descent-finish');
// Fresh live session for the remaining checks (also exercises disposal).
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await page.locator('.m94-card', { hasText: 'ORIGINAL M8.6' }).click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });

// --- 4. New-zone spot checks (probes + staged screenshots). ---
// Deck chomper: teleport ahead of trigger 283, watch the phase machine.
// (Runtime chomper order is triggerZ-sorted: deck=0, lower=1, shaft=2.)
await ev(page, () => window.__gd3d.debugTeleport(0, 5.05, 270));
await page.waitForFunction(
  () => (window.__gd3d.chompers()[0]?.phase ?? '') === 'lunging' ||
    (window.__gd3d.chompers()[0]?.phase ?? '') === 'spent',
  null, { timeout: 30000 },
);
const deckPhase = await ev(page, () => window.__gd3d.chompers()[0]);
await page.waitForFunction(() => (window.__gd3d.chompers()[0]?.phase ?? '') === 'spent', null, { timeout: 30000 });
await ev(page, () => window.__gd3d.debugTeleport(0, 5.05, 290));
await page.keyboard.press('Escape');
await pauseOpen();
await screenshot('m95-02-deck-chomper');
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
log(
  'm95 deck chomper telegraphs, lunges and rests spent in-page',
  deckPhase !== undefined && deckPhase.z !== undefined,
  JSON.stringify(deckPhase),
);
// Upper doors staged screenshot (door lane at 599, paused for stability).
// Wait for a live run first: the deck RESUME above leaves a death-hold
// behind, and teleporting/ESC mid-hold loses the spot.
await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
await ev(page, () => window.__gd3d.debugTeleport(-2.6, 5.05, 590));
await page.keyboard.press('Escape');
await pauseOpen();
await screenshot('m95-03-upper-doors');
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
// Foundry doors staged screenshot (same live-run guard).
await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
await ev(page, () => window.__gd3d.debugTeleport(0, 0.55, 1084));
await page.keyboard.press('Escape');
await pauseOpen();
await screenshot('m95-04-foundry-doors');
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
// Shaft chomper phases via probes (runtime index 2). Teleport just past
// the 872/882 entry spikes (the input-free player would die on them) but
// before the shaft: the 871 trigger fires fresh and the cycle completes
// while the player drops through the shaft onto the pad.
await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
await ev(page, () => window.__gd3d.debugTeleport(0, 0.55, 886));
await page.waitForFunction(
  () => (window.__gd3d.chompers()[2]?.phase ?? '') === 'lunging' ||
    (window.__gd3d.chompers()[2]?.phase ?? '') === 'spent',
  null, { timeout: 30000 },
);
await page.waitForFunction(() => (window.__gd3d.chompers()[2]?.phase ?? '') === 'spent', null, { timeout: 30000 });
const shaftPhase = await ev(page, () => window.__gd3d.chompers()[2]);
log(
  'm95 shaft chomper completes its attack cycle in-page',
  shaftPhase?.phase === 'spent',
  JSON.stringify(shaftPhase),
);

// --- 5. Pause/resume + live CHECKPOINT switch + MAIN MENU disposal. ---
await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
await page.keyboard.press('Escape');
await pauseOpen();
const pausedZ1 = await ev(page, () => window.__gd3d.playerPosition().z);
await sleep(page, 600);
const pausedMid = await ev(page, () => ({
  music: window.__gd3d.musicState(),
  z: window.__gd3d.playerPosition().z,
}));
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 30000 });
const targetBefore = await ev(page, () => window.__gd3d.musicTargetTime());
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'CHECKPOINT' }).click();
const switched = await ev(page, () => ({
  mode: window.__gd3d.runMode(),
  kind: window.__gd3d.attemptKind(),
  visible: window.__gd3d.checkpointsVisible(),
  music: window.__gd3d.musicState(),
}));
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 30000 });
const targetAfter = await ev(page, () => window.__gd3d.musicTargetTime());
log(
  'm95 pause freezes music+sim; resume continues; live switch taints without restarting music',
  pausedMid.music === 'paused' && Math.abs(pausedMid.z - pausedZ1) < 0.01 &&
    switched.mode === 'checkpoint' && switched.kind === 'practice' &&
    switched.visible === true && switched.music === 'paused' &&
    targetAfter >= targetBefore,
  JSON.stringify({ pausedMid, switched, targetBefore, targetAfter }),
);
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await sleep(page, 300);
const disposed1 = await ev(page, () => ({
  cards: document.querySelectorAll('.m94-card').length,
  canvases: document.querySelectorAll('canvas').length,
  hubCanvases: document.querySelectorAll('.m96-hub-canvas').length,
  hudGone: document.querySelector('.hud') === null,
}));
log(
  'm95 MAIN MENU after THE DESCENT leaves zero residue',
  disposed1.cards === 2 && disposed1.canvases === 1 && disposed1.hubCanvases === 1 && disposed1.hudGone === true,
  JSON.stringify(disposed1),
);

// --- 6. THE DESCENT + CHECKPOINT: cp-forge + Zenith re-seek. ---
await page.locator('.m94-card', { hasText: 'ORIGINAL M8.6' }).click();
await page.locator('.m94-mode-checkpoint').click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
await page.waitForFunction(() => {
  if (window.__gd3d.activeCheckpointId() === 'cp-forge') return true;
  if (window.__gd3d.status() === 'running' && window.__gd3d.playerPosition().z < 55) {
    window.__gd3d.debugTeleport(0, 5.05, 56);
  }
  return false;
}, null, { timeout: 60000 });
const anchor = await ev(page, () => window.__gd3d.musicTargetTime());
const descentCp = await killAndWaitRunning(page);
const descentTarget = await ev(page, () => window.__gd3d.musicTargetTime());
log(
  'm95 Descent checkpoint death restores cp-forge with a Zenith re-seek',
  descentCp.active === 'cp-forge' && Math.abs(descentCp.z - 60) < 8 &&
    Math.abs(descentTarget - anchor) < 2.5,
  JSON.stringify({ ...descentCp, anchor, target: descentTarget }),
);
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();

// --- 7. GRAVITY RIFT regression: graph + checkpoint seek + disposal. ---
await page.locator('.m94-card', { hasText: 'GRAVITY RIFT' }).click();
await page.locator('.m94-mode-checkpoint').click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
await sleep(page, 800);
const rift = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  graph: {
    created: window.__gd3d.musicSourceCreated(),
    source: window.__gd3d.musicSourceConnected(),
    gain: window.__gd3d.musicGainConnected(),
    ready: window.__gd3d.musicGraphReady(),
  },
  buffer: window.__gd3d.musicBufferDuration(),
  fp: window.__gd3d.replayLevelFingerprint(),
}));
const riftFp = rift.fp;
const riftGraphOk = rift.graph.created && rift.graph.source && rift.graph.gain && rift.graph.ready;
log(
  'm95 GRAVITY RIFT keeps its wired Gravity Lessons graph (buffer ~121.57)',
  rift.level === 'production-showcase-01' && riftGraphOk &&
    Math.abs(rift.buffer - 121.57) < 0.6 && riftFp !== descentFp,
  JSON.stringify({ ...rift, fp: riftFp.slice(0, 12) }),
);
await page.waitForFunction(() => {
  if (window.__gd3d.activeCheckpointId() === 'cp-forge') return true;
  if (window.__gd3d.status() === 'running' && window.__gd3d.playerPosition().z < 160) {
    window.__gd3d.debugTeleport(0, 0.55, 166);
  }
  return false;
}, null, { timeout: 60000 });
const riftAnchor = await ev(page, () => window.__gd3d.musicTargetTime());
const riftCp = await killAndWaitRunning(page);
const riftTarget = await ev(page, () => window.__gd3d.musicTargetTime());
log(
  'm95 rift checkpoint death restores cp-forge with a music re-seek',
  riftCp.active === 'cp-forge' && Math.abs(riftCp.z - 170) < 8 &&
    Math.abs(riftTarget - riftAnchor) < 2.5,
  JSON.stringify({ ...riftCp, anchor: riftAnchor, target: riftTarget }),
);
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await sleep(page, 300);

// --- 8. Repeat switch: one session, isolated fingerprints, no overlap. ---
await page.locator('.m94-card', { hasText: 'ORIGINAL M8.6' }).click();
await page.getByRole('button', { name: 'START' }).click();
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
const backDescent = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  music: window.__gd3d.musicState(),
  fp: window.__gd3d.replayLevelFingerprint(),
  section: window.__gd3d.rhythmSection(),
}));
const backShape = await sessionShape();
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
log(
  'm95 repeat switch keeps one session, stable Descent fingerprint, Zenith restarts',
  backDescent.level === 'the-descent' && backDescent.music === 'playing' &&
    backDescent.fp === descentFp &&
    backShape.canvases === 1 && backShape.huds === 1 && backShape.pauseMenus === 1,
  JSON.stringify({ ...backDescent, fp: backDescent.fp.slice(0, 12), ...backShape }),
);

log('m95 zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
log('m95 zero page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nM9.5 BROWSER GATE: ${failed.length === 0 ? 'PASS' : 'FAILED'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length === 0 ? 0 : 1);
