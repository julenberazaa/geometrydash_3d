/**
 * M9.6 browser gate (dev tool, not shipped) — island hub + input
 * reliability + spider feel, with a real browser.
 *
 * A. Hub menu: 2 cards + hub scene (1 hub canvas), default rift/classic,
 *    beacon mirror; panel selection; 3D island picking; mode slider.
 * B. Session + input: START disposes the hub; pointer tap jumps (C1);
 *    no spurious pause after menu use (C2 focus-blur proof); live pause
 *    mode switch.
 * C. Spider (RIFT): keyboard snap + beam + anchors (D); pointer tap
 *    delivers the spider edge (C1+D).
 * D. Menu return + level/mode switching + audio isolation + zero errors.
 *
 * Usage: QA_URL=http://localhost:5173/ node scripts/browser-qa-m96.mjs
 * (requires the dev server; system Chrome via playwright).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.QA_URL ?? 'http://localhost:5173/';
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
  hubCanvases: document.querySelectorAll('.m96-hub-canvas').length,
  huds: document.querySelectorAll('.hud').length,
  pauseMenus: document.querySelectorAll('.m94-pause-menu').length,
  menuButtons: document.querySelectorAll('.hud-menu-button').length,
}));
const screenshot = async (name) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
};

// --- A1. Hub menu boots: cards + scene + default selection + beacons. ---
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await waitMenu();
await sleep(page, 2000);
const menu = await ev(page, () => ({
  cards: [...document.querySelectorAll('.m94-card')].map((e) => e.dataset.levelId),
  titles: [...document.querySelectorAll('.m94-card-title')].map((e) => e.textContent),
  tags: [...document.querySelectorAll('.m94-card-tag')].map((e) => e.textContent),
  selectedCard: document.querySelector('.m94-card.m94-selected')?.dataset.levelId ?? null,
  selectedMode: document.querySelector('.m94-mode-button.m94-selected')?.textContent ?? null,
  slider: document.querySelector('.m96-mode-slider') !== null,
  hubReady: window.__gd3d.hubReady(),
  hubCanvases: window.__gd3d.hubCanvases(),
  canvases: document.querySelectorAll('canvas').length,
  sel: window.__gd3d.selectedLevel(),
  mode: window.__gd3d.selectedMode(),
  beaconD: window.__gd3d.hubBeacon('the-descent'),
  beaconR: window.__gd3d.hubBeacon('production-showcase-01'),
}));
log(
  'm96 hub menu boots (2 cards + scene + rift/classic + beacon mirror)',
  menu.cards.length === 2 && menu.cards.includes('the-descent') &&
    menu.cards.includes('production-showcase-01') && menu.hubReady === true &&
    menu.hubCanvases === 1 && menu.canvases === 1 &&
    menu.titles.includes('THE DESCENT') && menu.titles.includes('GRAVITY RIFT') &&
    menu.tags.includes('ORIGINAL M8.6') && menu.tags.includes('EXPERT') &&
    menu.selectedCard === 'production-showcase-01' && menu.sel === 'production-showcase-01' &&
    (menu.selectedMode ?? '').includes('CLASSIC') && menu.mode === 'classic' &&
    menu.slider === true && menu.beaconR === 1 && menu.beaconD === 0.28,
  JSON.stringify(menu),
);
await screenshot('m96-hub-rift');

// --- A2. Panel selection mirrors into the hub. ---
await page.click('.m94-card[data-level-id="the-descent"]');
await sleep(page, 600);
const panelPick = await ev(page, () => ({
  sel: window.__gd3d.selectedLevel(),
  hubSel: window.__gd3d.hubSelected(),
  beaconD: window.__gd3d.hubBeacon('the-descent'),
  beaconR: window.__gd3d.hubBeacon('production-showcase-01'),
  activePanel: document.querySelector('.m96-island-panel.m94-selected')?.dataset.levelId ?? null,
}));
log(
  'm96 panel selection mirrors (descent beacon 1, rift 0.28)',
  panelPick.sel === 'the-descent' && panelPick.hubSel === 'the-descent' &&
    panelPick.beaconD === 1 && panelPick.beaconR === 0.28 &&
    panelPick.activePanel === 'the-descent',
  JSON.stringify(panelPick),
);
await screenshot('m96-hub-descent');

// --- A3. 3D island picking (raycast path, not DOM). ---
await page.click('.m94-card[data-level-id="production-showcase-01"]');
await sleep(page, 400);
await page.mouse.click(320, 250); // left island (descent) in the vista band
await sleep(page, 600);
const rayPick = await ev(page, () => window.__gd3d.selectedLevel());
log('m96 3D island click selects the-descent', rayPick === 'the-descent', rayPick);
await page.mouse.click(960, 250); // right island (rift)
await sleep(page, 600);
const rayPick2 = await ev(page, () => window.__gd3d.selectedLevel());
log('m96 3D island click selects production-showcase-01', rayPick2 === 'production-showcase-01', rayPick2);

// --- A4. Mode slider both directions. ---
const sliderBox = await (await page.$('.m96-mode-slider')).boundingBox();
await page.mouse.click(sliderBox.x + sliderBox.width * 0.78, sliderBox.y + sliderBox.height / 2);
await sleep(page, 400);
const toCheckpoint = await ev(page, () => ({
  mode: window.__gd3d.selectedMode(),
  sliderState: document.querySelector('.m96-mode-slider.m96-checkpoint') !== null,
}));
await page.mouse.click(sliderBox.x + sliderBox.width * 0.22, sliderBox.y + sliderBox.height / 2);
await sleep(page, 400);
const toClassic = await ev(page, () => ({
  mode: window.__gd3d.selectedMode(),
  sliderState: document.querySelector('.m96-mode-slider.m96-checkpoint') !== null,
}));
log(
  'm96 mode slider switches checkpoint/classic with thumb state',
  toCheckpoint.mode === 'checkpoint' && toCheckpoint.sliderState === true &&
    toClassic.mode === 'classic' && toClassic.sliderState === false,
  JSON.stringify({ toCheckpoint, toClassic }),
);
await screenshot('m96-slider');

// --- B1. START disposes the hub, runs THE DESCENT classic. ---
await page.evaluate(() => window.__gd3d.selectLevel('the-descent'));
await page.click('.m94-start-button');
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicPlaying() === true, null, { timeout: 60000 });
await sleep(page, 1000);
const started = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  mode: window.__gd3d.runMode(),
  fp: window.__gd3d.replayLevelFingerprint(),
  graph: window.__gd3d.musicGraphReady(),
}));
const startedShape = await sessionShape();
const descentFp = started.fp;
log(
  'm96 START runs THE DESCENT classic (hub disposed, 1 session canvas)',
  started.level === 'the-descent' && started.mode === 'classic' &&
    started.graph === true && startedShape.canvases === 1 &&
    startedShape.hubCanvases === 0 && startedShape.huds === 1,
  JSON.stringify({ ...started, fp: descentFp.slice(0, 12), ...startedShape }),
);
await screenshot('m96-game-descent');

// --- B2. Pointer tap jumps (C1: clicks are primary input). ---
const jumps0 = await ev(page, () => window.__gd3d.jumps());
await page.mouse.move(640, 360);
await page.mouse.down();
await sleep(page, 80);
await page.mouse.up();
await sleep(page, 900);
const jumps1 = await ev(page, () => window.__gd3d.jumps());
log('m96 pointer tap on canvas jumps (C1)', jumps1 > jumps0, `jumps ${jumps0} -> ${jumps1}`);

// --- B3. No spurious pause after menu use (C2 focus-blur proof). ---
// Staged mid-road at z=150 (flat full-width slab; the only nearby spike
// ahead is the center 164, ~1 s away): the spawn staging raced the entry
// gap — the grounded-wait could resolve at z≈12 with the press landing
// past the lip. The diag scripts proved delivery + BODY focus.
await ev(page, () => { window.__gd3d.debugTeleport(0, 0.55, 150); });
await page.waitForFunction(
  () => window.__gd3d.status() === 'running' && window.__gd3d.grounded() === true,
  null, { timeout: 30000 },
);
await page.click('.hud-menu-button');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
await sleep(page, 150);
await page.waitForFunction(
  () => window.__gd3d.status() === 'running' && window.__gd3d.grounded() === true,
  null, { timeout: 30000 },
);
const jumps2 = await ev(page, () => window.__gd3d.jumps());
await page.evaluate(() => {
  window.__b3spy = { downs: 0, ups: 0 };
  window.addEventListener('keydown', () => { window.__b3spy.downs++; }, true);
  window.addEventListener('keyup', () => { window.__b3spy.ups++; }, true);
});
const prePress = await ev(page, () => ({
  z: +window.__gd3d.playerPosition().z.toFixed(2),
  grounded: window.__gd3d.grounded(),
  status: window.__gd3d.status(),
  steps: window.__gd3d.simSteps(),
  active: document.activeElement ? document.activeElement.tagName : 'none',
}));
await page.keyboard.press('Space');
await sleep(page, 500);
const focusProof = await ev(page, () => ({
  paused: window.__gd3d.paused(),
  status: window.__gd3d.status(),
  jumps: window.__gd3d.jumps(),
  spy: window.__b3spy,
}));
log(
  'm96 Space after menu use jumps without pausing (C2)',
  focusProof.paused === false && focusProof.jumps > jumps2,
  JSON.stringify({ ...focusProof, jumpsBefore: jumps2, prePress }),
);

// --- B4. Live pause-menu mode switch to checkpoint. ---
await ev(page, () => { window.__gd3d.setRunMode('classic'); });
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'CHECKPOINT' }).click();
await sleep(page, 300);
await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
await sleep(page, 400);
const liveSwitch = await ev(page, () => ({
  mode: window.__gd3d.runMode(),
  kind: window.__gd3d.attemptKind(),
  paused: window.__gd3d.paused(),
}));
log(
  'm96 live CHECKPOINT switch mid-attempt (practice taint)',
  liveSwitch.mode === 'checkpoint' && liveSwitch.kind === 'practice' && liveSwitch.paused === false,
  JSON.stringify(liveSwitch),
);

// --- C0. MAIN MENU rebuilds the hub with zero session residue. ---
await page.keyboard.press('Escape');
await pauseOpen();
await page.keyboard.press('r');
await sleep(page, 150);
const pausedRestart = await ev(page, () => ({
  paused: window.__gd3d.paused(),
  playing: window.__gd3d.musicPlaying(),
  source: window.__gd3d.musicSourceCreated(),
}));
log('m96 restart while paused keeps music stopped',
  pausedRestart.paused === true && pausedRestart.playing === false && pausedRestart.source === false,
  JSON.stringify(pausedRestart));
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await sleep(page, 800);
const backAtMenu = await ev(page, () => ({
  hubReady: window.__gd3d.hubReady(),
  hubCanvases: window.__gd3d.hubCanvases(),
  canvases: document.querySelectorAll('canvas').length,
  huds: document.querySelectorAll('.hud').length,
  pauseMenus: document.querySelectorAll('.m94-pause-menu').length,
  cards: document.querySelectorAll('.m94-card').length,
}));
log(
  'm96 MAIN MENU rebuilds hub, zero session residue',
  backAtMenu.hubReady === true && backAtMenu.hubCanvases === 1 &&
    backAtMenu.canvases === 1 && backAtMenu.huds === 0 &&
    backAtMenu.pauseMenus === 0 && backAtMenu.cards === 2,
  JSON.stringify(backAtMenu),
);

// --- C1. RIFT session for the spider checks. ---
await page.evaluate(() => window.__gd3d.selectLevel('production-showcase-01'));
await page.click('.m94-start-button');
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicPlaying() === true, null, { timeout: 60000 });
const riftFp = await ev(page, () => window.__gd3d.replayLevelFingerprint());
log('m96 rift fingerprint isolated from descent', riftFp !== descentFp, `${riftFp.slice(0, 12)} vs ${descentFp.slice(0, 12)}`);

// --- C2. Keyboard spider snap: count + anchors + beam (D). ---
await ev(page, () => { window.__gd3d.debugTeleport(0, 0.55, 1330); });
await page.waitForFunction(() => window.__gd3d.playerMode() === 'spider', null, { timeout: 30000 });
let snapped = false;
let beamSeen = false;
for (let attempt = 0; attempt < 3 && !snapped; attempt++) {
  const before = await ev(page, () => window.__gd3d.spiderSnapCount());
  await page.keyboard.press('Space');
  // Catch the 0.32 s beam live (poll 50 ms).
  for (let i = 0; i < 12; i++) {
    await sleep(page, 50);
    const live = await ev(page, () => ({
      snaps: window.__gd3d.spiderSnapCount(),
      beam: window.__gd3d.spiderBeamActive(),
    }));
    if (live.beam === true) {
      beamSeen = true;
      await screenshot('m96-beam');
    }
    if (live.snaps > before) {
      snapped = true;
      break;
    }
  }
  if (!snapped) await sleep(page, 400);
}
const snapProof = await ev(page, () => ({
  snaps: window.__gd3d.spiderSnapCount(),
  plays: window.__gd3d.spiderBeamPlays(),
  anchor: window.__gd3d.lastSpiderSnap(),
  rejects: window.__gd3d.spiderRejectCount(),
  gravity: window.__gd3d.gravityMode(),
}));
const anchorDy = snapProof.anchor !== null ? Math.abs(snapProof.anchor.to.y - snapProof.anchor.from.y) : 0;
log(
  'm96 keyboard spider snap records count + anchors + beam (D)',
  snapped === true && snapProof.snaps >= 1 && snapProof.plays >= 1 &&
    beamSeen === true && snapProof.anchor !== null && anchorDy > 1,
  JSON.stringify({ ...snapProof, anchorDy, beamSeen }),
);

// --- C3. Pointer tap delivers the spider edge (C1+D). ---
const edgeBefore = await ev(page, () => ({
  snaps: window.__gd3d.spiderSnapCount(),
  rejects: window.__gd3d.spiderRejectCount(),
}));
await page.mouse.move(640, 360);
await page.mouse.down();
await sleep(page, 80);
await page.mouse.up();
await sleep(page, 600);
const edgeAfter = await ev(page, () => ({
  snaps: window.__gd3d.spiderSnapCount(),
  rejects: window.__gd3d.spiderRejectCount(),
}));
const edgesDelivered = (edgeAfter.snaps + edgeAfter.rejects) - (edgeBefore.snaps + edgeBefore.rejects);
log(
  'm96 pointer tap delivers the spider press edge (C1)',
  edgesDelivered >= 1,
  `snaps ${edgeBefore.snaps}->${edgeAfter.snaps}, rejects ${edgeBefore.rejects}->${edgeAfter.rejects}`,
);
await screenshot('m96-game-rift');

// --- D1. Return + switch + restart isolation + audio budget. ---
const zenithBefore = audioRequests.filter((u) => u.includes('Zenith_of_the_Path')).length;
const gravityBefore = audioRequests.filter((u) => u.includes('Gravity_Lessons')).length;
await page.keyboard.press('Escape');
await pauseOpen();
await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
await waitMenu();
await sleep(page, 800);
await page.evaluate(() => window.__gd3d.selectLevel('the-descent'));
await page.click('.m94-start-button');
await waitGame();
await page.waitForFunction(() => window.__gd3d.musicPlaying() === true, null, { timeout: 60000 });
const backDescent = await ev(page, () => ({
  level: window.__gd3d.levelId(),
  fp: window.__gd3d.replayLevelFingerprint(),
}));
const backShape = await sessionShape();
const zenithAfter = audioRequests.filter((u) => u.includes('Zenith_of_the_Path')).length;
const gravityAfter = audioRequests.filter((u) => u.includes('Gravity_Lessons')).length;
log(
  'm96 repeat switch: one session, stable descent fp, one fetch per session',
  backDescent.level === 'the-descent' && backDescent.fp === descentFp &&
    backShape.canvases === 1 && backShape.huds === 1 && backShape.pauseMenus === 1 &&
    zenithAfter === zenithBefore + 1 && gravityAfter === gravityBefore,
  JSON.stringify({
    ...backDescent, fp: backDescent.fp.slice(0, 12), ...backShape,
    zenith: `${zenithBefore}->${zenithAfter}`, gravity: `${gravityBefore}->${gravityAfter}`,
  }),
);

// --- D2. Zero console/page errors. ---
log(
  'm96 zero console/page errors',
  consoleErrors.length === 0 && pageErrors.length === 0,
  JSON.stringify({ consoleErrors, pageErrors }),
);

console.log(`\nm96: ${results.length - failures}/${results.length} passed`);
await browser.close();
process.exit(failures > 0 ? 1 : 0);
