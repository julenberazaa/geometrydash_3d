/**
 * M9.4 browser gate (dev tool, not shipped) — level select + live
 * practice-mode switching with a real browser (system Chrome).
 *
 * A. Bare URL shows the level-select menu (2 cards, GRAVITY RIFT preselected,
 *    CLASSIC preselected, no auto-start).
 * B. THE DESCENT + CHECKPOINT + START: session starts with the wired
 *    Zenith graph (M9.5 — musicState playing, runMode checkpoint,
 *    attemptKind practice, crystals visible).
 * C. M9.3 spot: island-contact pulse fires live after the start landing.
 * D. cp-forge activates 1/8 via the crystal volume.
 * E. Pause menu opens (P): overlay visible, sim + music frozen.
 * F. Pause-menu switch to CLASSIC: tainted practice banner, crystals hide,
 *    sim time + music target untouched (no seek on toggle).
 * G. Resume continues; death goes to the ORIGIN (classic) while the earned
 *    crystal stays retained internally.
 * H. CHECKPOINT back ON (running toggle, no seek) → death restores
 *    cp-forge (earned progress was never erased).
 * I. R restarts at the checkpoint; Shift+R full-restarts (progress
 *    cleared, fresh practice attempt in checkpoint mode).
 * J. CLASSIC + Shift+R clears the taint (fresh clean classic attempt).
 * K. MAIN MENU returns to the menu (session disposed: no canvas, no HUD,
 *    music stopped); a fresh GRAVITY RIFT + CLASSIC session starts cleanly with
 *    its own level id/fingerprint.
 * L. M9.3 spot: spider ring + one-press snap work in-page on the rift
 *    route; pause-switch to CHECKPOINT taints (music target preserved);
 *    cp-forge restores after death; return to menu.
 * M. Zero console/page errors on every page.
 *
 * Usage: QA_URL=http://localhost:5174/ node scripts/browser-qa-m94.mjs
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
const watch = (page) => {
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
};
const freshPage = async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  return page;
};
const waitGame = (page) =>
  page.waitForFunction(() => window.__gd3d !== undefined && window.__gd3d.screen() === 'game', null, { timeout: 60000 });
const waitMenu = (page) =>
  page.waitForFunction(() => window.__gd3d !== undefined && window.__gd3d.screen() === 'menu', null, { timeout: 60000 });

const graph = (p) => ev(p, () => ({
  created: window.__gd3d.musicSourceCreated(),
  source: window.__gd3d.musicSourceConnected(),
  gain: window.__gd3d.musicGainConnected(),
  eff: window.__gd3d.musicEffectiveGain(),
  ready: window.__gd3d.musicGraphReady(),
  state: window.__gd3d.musicState(),
  ctx: window.__gd3d.musicContextState(),
}));
const killAndWaitRunning = async (page) => {
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

// --- A. Menu renders on the bare URL. ---
let descentFingerprint = null;
{
  const page = await freshPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await waitMenu(page);
  const menu = await ev(page, () => ({
    cards: document.querySelectorAll('.m94-card').length,
    selectedCard: document.querySelector('.m94-card.m94-selected')?.dataset.levelId ?? null,
    selectedMode: document.querySelector('.m94-mode-button.m94-selected')?.textContent ?? null,
    titles: [...document.querySelectorAll('.m94-card-title')].map((e) => e.textContent),
    z: null,
  }));
  log(
    'm94 menu renders with 2 cards, GRAVITY RIFT + CLASSIC preselected',
    menu.cards === 2 &&
      menu.selectedCard === 'production-showcase-01' &&
      (menu.selectedMode ?? '').includes('CLASSIC') &&
      menu.titles.includes('THE DESCENT') &&
      menu.titles.includes('GRAVITY RIFT'),
    JSON.stringify(menu),
  );
  await page.screenshot({ path: 'qa/screenshots/m94-menu.png' });

  // --- B. THE DESCENT + CHECKPOINT + START (Zenith plays on this level). ---
  await page.locator('.m94-card', { hasText: 'ORIGINAL M8.6' }).click();
  await page.locator('.m94-mode-checkpoint').click();
  await page.getByRole('button', { name: 'START' }).click();
  await waitGame(page);
  // M9.5: THE DESCENT declares Zenith of the Path — the gesture starts
  // the run with a wired source→gain→destination graph (buffer ≈127.71).
  await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
  await sleep(page, 800);
  const g = await graph(page);
  const started = await ev(page, () => ({
    level: window.__gd3d.levelId(),
    mode: window.__gd3d.runMode(),
    kind: window.__gd3d.attemptKind(),
    visible: window.__gd3d.checkpointsVisible(),
    count: window.__gd3d.checkpointCount(),
    fp: window.__gd3d.replayLevelFingerprint(),
    buffer: window.__gd3d.musicBufferDuration(),
  }));
  descentFingerprint = started.fp;
  const graphWired =
    g.created === true && g.source === true && g.gain === true &&
    g.ready === true && g.state === 'playing' &&
    Math.abs(started.buffer - 127.71) < 0.6;
  log('m94 THE DESCENT CHECKPOINT starts with the wired Zenith graph', graphWired, JSON.stringify({ ...g, buffer: started.buffer }));
  log(
    'm94 session identity (level/mode/taint/crystals)',
    started.level === 'the-descent' && started.mode === 'checkpoint' &&
      started.kind === 'practice' && started.visible === true && started.count === 8,
    JSON.stringify({ ...started, fp: started.fp.slice(0, 12) }),
  );
  await page.screenshot({ path: 'qa/screenshots/m94-descent-checkpoint.png' });

  // --- C. M9.3 spot: contact pulse fires on the start landing. ---
  const pulse = await ev(page, () => window.__gd3d.contactPulseCount());
  log('m94 island-contact pulse fires live', pulse >= 1, `count=${pulse}`);

  // --- D. cp-forge activates. ---
  // The idle runner dies and re-runs at the origin on its own, and a
  // teleport mid-death-hold is ignored — but re-placing EVERY poll would
  // yank the runner back and freeze progress. So place only while still
  // at the origin (z < 50), then let it settle into the volume.
  // (M9.4.2: the M8.6 cp-forge sits at z=60 on the stairs deck, y=5.05 —
  // teleport straight onto the proven standing state.)
  await page.waitForFunction(() => {
    if (window.__gd3d.activeCheckpointId() === 'cp-forge') return true;
    if (window.__gd3d.status() === 'running' && window.__gd3d.playerPosition().z < 50) {
      window.__gd3d.debugTeleport(0, 5.05, 60);
    }
    return false;
  }, null, { timeout: 60000 });
  const cp1 = await ev(page, () => ({
    progress: window.__gd3d.checkpointProgress(),
    target: window.__gd3d.musicTargetTime(),
  }));
  log('m94 cp-forge activates 1/8', cp1.progress.activeIndex === 1 && cp1.progress.total === 8, JSON.stringify(cp1));

  // --- E. Pause menu freezes sim + music. ---
  // Read the step counter twice AFTER pausing (a step may legitimately run
  // between the pre-pause read and the keypress landing).
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => document.querySelector('.m94-pause-menu')?.style.display === 'block', null, { timeout: 10000 });
  await sleep(page, 700);
  const stepsA = await ev(page, () => window.__gd3d.simSteps());
  await sleep(page, 500);
  const frozen = await ev(page, () => ({
    steps: window.__gd3d.simSteps(),
    playing: window.__gd3d.musicPlaying(),
    paused: window.__gd3d.paused(),
  }));
  log(
    'm94 pause menu freezes sim + music',
    frozen.steps === stepsA && frozen.playing === false && frozen.paused === true,
    JSON.stringify({ stepsA, ...frozen }),
  );
  await page.screenshot({ path: 'qa/screenshots/m94-pause-menu.png' });

  // --- F. Pause-menu switch to CLASSIC: taint banner, crystals hide, music target untouched. ---
  const targetBefore = await ev(page, () => window.__gd3d.musicTargetTime());
  await page.locator('.m94-pause-menu').getByRole('button', { name: 'CLASSIC' }).click();
  const switched = await ev(page, () => ({
    mode: window.__gd3d.runMode(),
    kind: window.__gd3d.attemptKind(),
    visible: window.__gd3d.checkpointsVisible(),
    badge: document.querySelector('.hud-mode-badge')?.textContent ?? null,
    target: window.__gd3d.musicTargetTime(),
  }));
  log(
    'm94 CLASSIC switch taints (practice banner, crystals hidden, music target preserved)',
    switched.mode === 'classic' && switched.kind === 'practice' &&
      switched.visible === false &&
      (switched.badge ?? '').includes('PRACTICE RUN') &&
      switched.target === targetBefore,
    JSON.stringify(switched),
  );

  // --- G. Resume; death goes to the ORIGIN (classic) with crystal retained. ---
  await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
  await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
  const afterDeath = await killAndWaitRunning(page);
  const retained = await ev(page, () => ({
    kind: window.__gd3d.attemptKind(),
    z: window.__gd3d.playerPosition().z,
    active: window.__gd3d.activeCheckpointId(),
  }));
  log(
    'm94 classic death restarts at origin, earned crystal retained',
    Math.abs(afterDeath.z + 4) < 8 && retained.active === 'cp-forge' && retained.kind === 'practice',
    JSON.stringify(retained),
  );

  // --- H. Running toggle back to CHECKPOINT (nothing to seek) → death restores cp-forge. ---
  const t0 = await ev(page, () => window.__gd3d.musicTargetTime());
  await ev(page, () => window.__gd3d.setRunMode('checkpoint'));
  await sleep(page, 600);
  const t1 = await ev(page, () => ({
    target: window.__gd3d.musicTargetTime(),
    mode: window.__gd3d.runMode(),
    visible: window.__gd3d.checkpointsVisible(),
  }));
  const noSeek = t1.target >= t0 - 0.5 && t1.target - t0 < 2.5 && t1.mode === 'checkpoint' && t1.visible === true;
  log('m94 running toggle seeks nothing', noSeek, JSON.stringify({ t0, ...t1 }));
  const restored = await killAndWaitRunning(page);
  log(
    'm94 re-armed checkpoint restores cp-forge without re-earning',
    restored.active === 'cp-forge' && Math.abs(restored.z - 60) < 8,
    JSON.stringify(restored),
  );

  // --- I. R restarts at the checkpoint; Shift+R full-restarts. ---
  await page.keyboard.press('KeyR');
  await sleep(page, 400);
  const afterR = await ev(page, () => ({
    z: window.__gd3d.playerPosition().z,
    active: window.__gd3d.activeCheckpointId(),
  }));
  log(
    'm94 R restarts from the checkpoint',
    Math.abs(afterR.z - 60) < 10 && afterR.active === 'cp-forge',
    JSON.stringify(afterR),
  );
  await page.keyboard.press('Shift+KeyR');
  await sleep(page, 400);
  const afterFull = await ev(page, () => ({
    z: window.__gd3d.playerPosition().z,
    active: window.__gd3d.activeCheckpointId(),
    progress: window.__gd3d.checkpointProgress(),
    kind: window.__gd3d.attemptKind(),
  }));
  log(
    'm94 Shift+R full restart clears progress (fresh practice in checkpoint mode)',
    Math.abs(afterFull.z + 4) < 10 && afterFull.active === null &&
      afterFull.progress.activeIndex === 0 && afterFull.kind === 'practice',
    JSON.stringify(afterFull),
  );

  // --- J. CLASSIC + Shift+R clears the taint. ---
  await ev(page, () => window.__gd3d.setRunMode('classic'));
  await page.keyboard.press('Shift+KeyR');
  await sleep(page, 400);
  const clean = await ev(page, () => ({
    mode: window.__gd3d.runMode(),
    kind: window.__gd3d.attemptKind(),
    badge: document.querySelector('.hud-mode-badge')?.style.display ?? null,
  }));
  log(
    'm94 full restart in classic opens a clean attempt',
    clean.mode === 'classic' && clean.kind === 'classic' && clean.badge === 'none',
    JSON.stringify(clean),
  );

  // --- K. MAIN MENU returns to the menu with the session disposed. ---
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => document.querySelector('.m94-pause-menu')?.style.display === 'block', null, { timeout: 10000 });
  await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
  await waitMenu(page);
  await sleep(page, 300);
  const backAtMenu = await ev(page, () => ({
    cards: document.querySelectorAll('.m94-card').length,
    canvases: document.querySelectorAll('canvas').length,
    hudGone: document.querySelector('.hud') === null,
  }));
  log(
    'm94 MAIN MENU disposes the session and shows the menu',
    backAtMenu.cards === 2 && backAtMenu.canvases === 0 && backAtMenu.hudGone === true,
    JSON.stringify(backAtMenu),
  );
  await page.close();
}

// --- K2/RIFT session on a second page (fresh session, own identity). ---
let evolvedFingerprint = null;
{
  const page = await freshPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await waitMenu(page);
  await page.locator('.m94-card', { hasText: 'GRAVITY RIFT' }).click();
  await page.getByRole('button', { name: 'START' }).click();
  await waitGame(page);
  await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
  await sleep(page, 800);
  const g = await graph(page);
  const started = await ev(page, () => ({
    level: window.__gd3d.levelId(),
    name: window.__gd3d.levelDisplayName(),
    mode: window.__gd3d.runMode(),
    kind: window.__gd3d.attemptKind(),
    visible: window.__gd3d.checkpointsVisible(),
    fp: window.__gd3d.replayLevelFingerprint(),
    canvases: document.querySelectorAll('canvas').length,
  }));
  evolvedFingerprint = started.fp;
  const graphOk = g.created === true && g.source === true && g.gain === true && g.eff > 0 && g.ready === true;
  log('m94 RIFT CLASSIC starts clean with wired graph', graphOk, JSON.stringify(g));
  log(
    'm94 rift session has its own identity (no leakage)',
    started.level === 'production-showcase-01' && started.name === 'GRAVITY RIFT' &&
      started.mode === 'classic' && started.kind === 'classic' && started.visible === false &&
      started.fp !== descentFingerprint && started.canvases === 1,
    JSON.stringify({ ...started, fp: started.fp.slice(0, 12), descent: (descentFingerprint ?? '').slice(0, 12) }),
  );
  await page.screenshot({ path: 'qa/screenshots/m94-evolved-classic.png' });

  // --- L1. M9.3 spot: spider ring + one-press snap in-page. ---
  await page.waitForFunction(() => {
    if (window.__gd3d.playerMode() === 'spider') return true;
    if (window.__gd3d.status() === 'running' && window.__gd3d.playerPosition().z < 1330) {
      window.__gd3d.debugTeleport(0, 0.55, 1336);
    }
    return false;
  }, null, { timeout: 60000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__gd3d.gravityMode() === 'ceiling', null, { timeout: 15000 });
  const snap = await ev(page, () => ({
    mode: window.__gd3d.playerMode(),
    grav: window.__gd3d.gravityMode(),
    status: window.__gd3d.status(),
  }));
  log('m94 spider one-press snap flips gravity in-page', snap.mode === 'spider' && snap.grav === 'ceiling', JSON.stringify(snap));

  // --- L2. Pause-switch to CHECKPOINT taints without seeking music. ---
  const t0 = await ev(page, () => window.__gd3d.musicTargetTime());
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => document.querySelector('.m94-pause-menu')?.style.display === 'block', null, { timeout: 10000 });
  await page.locator('.m94-pause-menu').getByRole('button', { name: 'CHECKPOINT' }).click();
  const tainted = await ev(page, () => ({
    mode: window.__gd3d.runMode(),
    kind: window.__gd3d.attemptKind(),
    visible: window.__gd3d.checkpointsVisible(),
    target: window.__gd3d.musicTargetTime(),
  }));
  log(
    'm94 rift pause-switch taints practice (music untouched)',
    tainted.mode === 'checkpoint' && tainted.kind === 'practice' && tainted.visible === true &&
      Math.abs(tainted.target - t0) < 0.05,
    JSON.stringify(tainted),
  );
  await page.locator('.m94-pause-menu').getByRole('button', { name: 'RESUME' }).click();
  await page.waitForFunction(() => window.__gd3d.playerPosition().z > 1330, null, { timeout: 30000 });

  // --- L3. Checkpoint restore on the evolved route. ---
  await page.waitForFunction(() => {
    if (window.__gd3d.activeCheckpointId() === 'cp-forge') return true;
    if (window.__gd3d.status() === 'running' && window.__gd3d.playerPosition().z < 160) {
      window.__gd3d.debugTeleport(0, 0.55, 166);
    }
    return false;
  }, null, { timeout: 60000 });
  const restored = await killAndWaitRunning(page);
  log(
    'm94 rift checkpoint death restores cp-forge',
    restored.active === 'cp-forge' && Math.abs(restored.z - 170) < 8,
    JSON.stringify(restored),
  );

  // --- Return to menu; session disposed. ---
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => document.querySelector('.m94-pause-menu')?.style.display === 'block', null, { timeout: 10000 });
  await page.locator('.m94-pause-menu').getByRole('button', { name: 'MAIN MENU' }).click();
  await waitMenu(page);
  const final = await ev(page, () => ({
    canvases: document.querySelectorAll('canvas').length,
  }));
  log('m94 final return disposes the rift session', final.canvases === 0, JSON.stringify(final));
  await page.close();
}

// --- M. Finish semantics: tainted finish is practice, clean finish is official. ---
{
  const page = await freshPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await waitMenu(page);
  await page.locator('.m94-card', { hasText: 'GRAVITY RIFT' }).click();
  await page.getByRole('button', { name: 'START' }).click();
  await waitGame(page);
  await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
  // Taint without dying: classic -> checkpoint -> classic.
  await ev(page, () => window.__gd3d.setRunMode('checkpoint'));
  await ev(page, () => window.__gd3d.setRunMode('classic'));
  await ev(page, () => window.__gd3d.debugTeleport(0, 0.55, 1780));
  await page.waitForFunction(() => window.__gd3d.status() === 'finished', null, { timeout: 30000 });
  const taintedFinish = await ev(page, () => ({
    kind: window.__gd3d.attemptKind(),
    msg: document.querySelector('.hud-message')?.textContent ?? null,
    hasReplay: window.__gd3d.hasReplay(),
  }));
  log(
    'm94 tainted finish is PRACTICE with no replay tape',
    taintedFinish.kind === 'practice' && (taintedFinish.msg ?? '').includes('PRACTICE COMPLETE') && taintedFinish.hasReplay === false,
    JSON.stringify(taintedFinish),
  );
  // Full restart clears the taint: the same shortcut finish is official.
  await page.keyboard.press('Shift+KeyR');
  await page.waitForFunction(() => window.__gd3d.status() === 'running', null, { timeout: 30000 });
  await ev(page, () => window.__gd3d.debugTeleport(0, 0.55, 1780));
  await page.waitForFunction(() => window.__gd3d.status() === 'finished', null, { timeout: 30000 });
  const cleanFinish = await ev(page, () => ({
    kind: window.__gd3d.attemptKind(),
    msg: document.querySelector('.hud-message')?.textContent ?? null,
    hasReplay: window.__gd3d.hasReplay(),
    replayLevel: window.__gd3d.replayLevelId(),
  }));
  log(
    'm94 clean-classic finish is official with a bound tape',
    cleanFinish.kind === 'classic' && (cleanFinish.msg ?? '').includes('LEVEL COMPLETE') &&
      cleanFinish.hasReplay === true && cleanFinish.replayLevel === 'production-showcase-01',
    JSON.stringify(cleanFinish),
  );
  await page.close();
}

// --- N. Direct `?level=` + `?mode=` entry contract (Zenith level). ---
{
  const page = await freshPage();
  await page.goto(`${URL}?level=the-descent&mode=checkpoint`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__gd3d !== undefined && window.__gd3d.screen() === 'game', null, { timeout: 60000 });
  const gated = await ev(page, () => ({
    awaiting: window.__gd3d.awaitingStart(),
    level: window.__gd3d.levelId(),
  }));
  await page.keyboard.press('Space');
  // M9.5: THE DESCENT declares Zenith — the gesture starts the run with
  // musicState playing (fail-loud gate still applies on audio failure).
  await page.waitForFunction(
    () => window.__gd3d.awaitingStart() === false && window.__gd3d.musicState() === 'playing',
    null,
    { timeout: 60000 },
  );
  const entered = await ev(page, () => ({
    mode: window.__gd3d.runMode(),
    kind: window.__gd3d.attemptKind(),
    music: window.__gd3d.musicState(),
  }));
  log(
    'm94 ?level=+?mode= enters directly in the preselected mode (Zenith playing)',
    gated.awaiting === true && gated.level === 'the-descent' &&
      entered.mode === 'checkpoint' && entered.kind === 'practice' && entered.music === 'playing',
    JSON.stringify({ ...gated, ...entered }),
  );
  await page.close();
}

log('m94 zero console errors (all pages)', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
log('m94 zero page errors (all pages)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nM9.4 BROWSER GATE: ${failed.length === 0 ? 'PASS' : 'FAILED'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length === 0 ? 0 : 1);
