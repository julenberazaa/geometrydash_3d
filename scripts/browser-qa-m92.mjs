/**
 * M9.2 browser gate (dev tool, not shipped) — audio graph + checkpoint
 * practice mode proof with a real browser (system Chrome).
 *
 * A. Asset: GET /audio/Gravity_Lessons.mp3 -> HTTP 200 + expected bytes.
 * B. Selector: bare URL shows THE DESCENT mode selector (CLASSIC RUN +
 *    CHECKPOINT RUN buttons); the gate holds the sim at tick 0.
 * C. CLASSIC RUN click: transport live + STRUCTURAL GRAPH assertion
 *    (sourceCreated + sourceConnected + gainConnected + effectiveGain > 0
 *    + graphReady) — never again TRANSPORT PASS with no output path.
 *    runMode classic, music target/actual advance with the sim clock.
 * D. CHECKPOINT RUN click: runMode checkpoint; teleport to cp-forge ->
 *    activates 1/8; kill -> auto-respawn AT cp-forge (z, mode, speed);
 *    music re-seeks to the checkpoint time (NOT 0); camera snapped near
 *    the player; cp-skybridge latest-wins; R restarts at the checkpoint;
 *    Shift+R returns to the origin with progress cleared.
 * E. ?music=off matrix: selector still gates; CHECKPOINT click starts
 *    silent checkpoint mode; bare click starts silent classic.
 * F. FAIL-LOUD preserved: blocked asset -> gate latches, sim frozen.
 * G. Zero console/page errors on every page except the expected blocked
 *    mp3 noise on the abort page.
 *
 * Headless Chrome has no speakers: C asserts the complete output-path
 * structure (the M9/M9.1 silence root cause). HUMAN AUDIBLE MUSIC PASS
 * stays open and must be confirmed by a human with sound on.
 *
 * Usage: QA_URL=http://localhost:5174/ node scripts/browser-qa-m92.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.QA_URL ?? 'http://localhost:5174/';
const EXPECTED_BYTES = 2923848;
const EXPECTED_DURATION = 121.574;

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
const mainConsoleErrors = [];
const mainPageErrors = [];

const graph = (p) => ev(p, () => ({
  created: window.__gd3d.musicSourceCreated(),
  source: window.__gd3d.musicSourceConnected(),
  gain: window.__gd3d.musicGainConnected(),
  eff: window.__gd3d.musicEffectiveGain(),
  ready: window.__gd3d.musicGraphReady(),
  state: window.__gd3d.musicState(),
  ctx: window.__gd3d.musicContextState(),
  buffer: window.__gd3d.musicBufferDuration(),
}));

// --- A. Asset serves (HTTP 200 + byte size). ---
{
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') mainConsoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => mainPageErrors.push(String(err)));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  const asset = await ev(page, async () => {
    const r = await fetch('/audio/Gravity_Lessons.mp3');
    const buf = await r.arrayBuffer();
    return { status: r.status, bytes: buf.byteLength };
  });
  log('m92 asset HTTP 200 + byte size', asset.status === 200 && asset.bytes === EXPECTED_BYTES, JSON.stringify(asset));

  // --- B. Selector gate holds at tick 0. ---
  const gate = await ev(page, () => ({
    awaiting: window.__gd3d.awaitingStart(),
    z: window.__gd3d.playerPosition().z,
    checkpoints: window.__gd3d.checkpointCount(),
    classicVisible: document.querySelector('.hud-mode-button')?.offsetParent !== null,
    buttons: document.querySelectorAll('.hud-mode-button').length,
  }));
  log(
    'm92 mode selector holds at tick 0',
    gate.awaiting === true && Math.abs(gate.z + 4) < 0.01 && gate.checkpoints === 8 && gate.buttons === 2,
    JSON.stringify(gate),
  );
  await page.screenshot({ path: 'qa/screenshots/m92-selector.png' });

  // --- C. CLASSIC RUN: transport + structural graph assertion. ---
  await page.getByRole('button', { name: 'CLASSIC RUN' }).click();
  await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
  await sleep(page, 500);
  const g = await graph(page);
  const graphOk =
    g.created === true && g.source === true && g.gain === true &&
    g.eff > 0 && g.ready === true && g.state === 'playing' &&
    g.ctx === 'running' && Math.abs(g.buffer - EXPECTED_DURATION) < 1.0;
  log('m92 CLASSIC graph wired (source→gain→destination)', graphOk, JSON.stringify(g));
  const classic = await ev(page, () => ({
    mode: window.__gd3d.runMode(),
    active: window.__gd3d.activeCheckpointId(),
    target: window.__gd3d.musicTargetTime(),
    actual: window.__gd3d.musicActualTime(),
  }));
  log(
    'm92 CLASSIC run mode, no checkpoint, music tracks sim',
    classic.mode === 'classic' && classic.active === null && classic.target > 0 && classic.actual > 0,
    JSON.stringify(classic),
  );
  await page.close();
}

// --- D. CHECKPOINT RUN: activate -> die -> respawn at crystal. ---
{
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') mainConsoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => mainPageErrors.push(String(err)));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  await page.getByRole('button', { name: 'CHECKPOINT RUN' }).click();
  await page.waitForFunction(() => window.__gd3d.musicState() === 'playing', null, { timeout: 60000 });
  const started = await ev(page, () => ({
    mode: window.__gd3d.runMode(),
    ready: window.__gd3d.musicGraphReady(),
  }));
  log('m92 CHECKPOINT run starts with graph ready', started.mode === 'checkpoint' && started.ready === true, JSON.stringify(started));

  // Step just inside cp-forge (spikes at 160/164 kill idle runners, so
  // land past them at z=166 and walk into the volume entry at ~167.5).
  await ev(page, () => window.__gd3d.debugTeleport(0, 0.55, 166));
  await page.waitForFunction(() => window.__gd3d.activeCheckpointId() === 'cp-forge', null, { timeout: 30000 });
  const cp1 = await ev(page, () => ({
    active: window.__gd3d.activeCheckpointId(),
    progress: window.__gd3d.checkpointProgress(),
    events: window.__gd3d.checkpointEventCount(),
    music: window.__gd3d.musicState(),
    anchor: window.__gd3d.musicTargetTime(),
  }));
  log('m92 cp-forge activates 1/8', cp1.active === 'cp-forge' && cp1.progress.activeIndex === 1 && cp1.progress.total === 8, JSON.stringify(cp1));
  await page.screenshot({ path: 'qa/screenshots/m92-crystal-forge.png' });

  // Die: void-drop, then the hold auto-respawns AT cp-forge.
  await ev(page, () => {
    const p = window.__gd3d.playerPosition();
    window.__gd3d.debugTeleport(p.x, -100, p.z);
  });
  await page.waitForFunction(() => window.__gd3d.status() === 'dead', null, { timeout: 30000 });
  await page.waitForFunction(
    () => window.__gd3d.status() === 'running' && window.__gd3d.activeCheckpointId() === 'cp-forge',
    null,
    { timeout: 30000 },
  );
  // Pause immediately: freeze the restored moment for stable assertions.
  await page.keyboard.press('KeyP');
  const restored = await ev(page, () => ({
    active: window.__gd3d.activeCheckpointId(),
    z: window.__gd3d.playerPosition().z,
    mode: window.__gd3d.playerMode(),
    speed: window.__gd3d.speedMultiplier(),
    target: window.__gd3d.musicTargetTime(),
    eye: window.__gd3d.cameraEye(),
    up: window.__gd3d.cameraUpY(),
    p: window.__gd3d.playerPosition(),
  }));
  const eyeDist = Math.hypot(restored.eye.x - restored.p.x, restored.eye.y - restored.p.y, restored.eye.z - restored.p.z);
  // Music must re-seek to the CHECKPOINT anchor captured at activation
  // (the teleport shortcut compresses sim time, so the anchor itself is
  // small — the assertion is anchor-equality, i.e. a rewind to the saved
  // time rather than song 0 or the pre-death time; exact elapsed restore
  // is pinned headless in tests/checkpoints.test.ts).
  const respawnOk =
    restored.active === 'cp-forge' && Math.abs(restored.z - 170) < 8 &&
    restored.mode === 'cube' && restored.speed === 1 &&
    Math.abs(restored.target - cp1.anchor) < 2.5 && eyeDist < 20 && Math.abs(restored.up - 1) < 0.01;
  log('m92 death respawns at cp-forge with music+camera', respawnOk, JSON.stringify({ ...restored, anchor: cp1.anchor, eyeDist: eyeDist.toFixed(1) }));
  await page.keyboard.press('KeyP');

  // Latest-wins: jump to cp-skybridge, die, respawn there instead.
  await ev(page, () => window.__gd3d.debugTeleport(3.7, 0.55, 392));
  await page.waitForFunction(() => window.__gd3d.activeCheckpointId() === 'cp-skybridge', null, { timeout: 30000 });
  await ev(page, () => {
    const p = window.__gd3d.playerPosition();
    window.__gd3d.debugTeleport(p.x, -100, p.z);
  });
  await page.waitForFunction(
    () => window.__gd3d.status() === 'running' && Math.abs(window.__gd3d.playerPosition().z - 395) < 8,
    null,
    { timeout: 30000 },
  );
  const cp2 = await ev(page, () => ({
    active: window.__gd3d.activeCheckpointId(),
    z: window.__gd3d.playerPosition().z,
    progress: window.__gd3d.checkpointProgress(),
  }));
  log('m92 latest checkpoint wins (cp-skybridge)', cp2.active === 'cp-skybridge' && cp2.progress.activeIndex === 2, JSON.stringify(cp2));

  // R restarts at the checkpoint (not the origin).
  const attemptsBefore = await ev(page, () => window.__gd3d.attempts());
  await page.keyboard.press('KeyR');
  await sleep(page, 400);
  const afterR = await ev(page, () => ({
    z: window.__gd3d.playerPosition().z,
    active: window.__gd3d.activeCheckpointId(),
    attempts: window.__gd3d.attempts(),
  }));
  log(
    'm92 R restarts from the checkpoint',
    Math.abs(afterR.z - 395) < 10 && afterR.active === 'cp-skybridge' && afterR.attempts === attemptsBefore + 1,
    JSON.stringify(afterR),
  );

  // Shift+R: full origin restart, progress cleared (the sim runs idle
  // from the origin, so the z window admits a few units of drift).
  await page.keyboard.press('Shift+KeyR');
  await sleep(page, 400);
  const afterFull = await ev(page, () => ({
    z: window.__gd3d.playerPosition().z,
    active: window.__gd3d.activeCheckpointId(),
    progress: window.__gd3d.checkpointProgress(),
  }));
  log(
    'm92 Shift+R full restart clears progress',
    Math.abs(afterFull.z + 4) < 10 && afterFull.active === null && afterFull.progress.activeIndex === 0,
    JSON.stringify(afterFull),
  );
  await page.close();
}

// --- E. ?music=off matrix: selector gates, clicks start silent. ---
{
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') mainConsoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => mainPageErrors.push(String(err)));
  await page.goto(`${URL}?music=off`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  const gated = await ev(page, () => ({
    awaiting: window.__gd3d.awaitingStart(),
    buttons: document.querySelectorAll('.hud-mode-button').length,
  }));
  log('m92 ?music=off still gates on the selector', gated.awaiting === true && gated.buttons === 2, JSON.stringify(gated));
  await page.getByRole('button', { name: 'CHECKPOINT RUN' }).click();
  await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
  const silentCp = await ev(page, () => ({
    awaiting: window.__gd3d.awaitingStart(),
    mode: window.__gd3d.runMode(),
    music: window.__gd3d.musicState(),
    z: window.__gd3d.playerPosition().z,
  }));
  log(
    'm92 ?music=off CHECKPOINT starts silent in checkpoint mode',
    silentCp.awaiting === false && silentCp.mode === 'checkpoint' && silentCp.music === 'none' && silentCp.z > -3,
    JSON.stringify(silentCp),
  );
  await page.close();

  const page2 = await browser.newPage();
  await page2.goto(`${URL}?music=off`, { waitUntil: 'load', timeout: 60000 });
  await page2.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  // Bare container click (bottom-right corner, far from the mode buttons).
  await page2.mouse.click(1200, 650);
  await page2.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
  const silentClassic = await ev(page2, () => ({
    mode: window.__gd3d.runMode(),
    music: window.__gd3d.musicState(),
  }));
  log(
    'm92 ?music=off bare click starts silent classic',
    silentClassic.mode === 'classic' && silentClassic.music === 'none',
    JSON.stringify(silentClassic),
  );
  await page2.close();
}

// --- F. FAIL-LOUD preserved with the selector present. ---
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**/audio/Gravity_Lessons.mp3', (route) => route.abort('failed'));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__gd3d.startGateFailed() === true, null, { timeout: 30000 });
  const failed = await ev(page, () => ({
    failed: window.__gd3d.startGateFailed(),
    awaiting: window.__gd3d.awaitingStart(),
    z: window.__gd3d.playerPosition().z,
    music: window.__gd3d.musicState(),
  }));
  log(
    'm92 audio failure is loud (no silent start)',
    failed.failed === true && failed.awaiting === true && Math.abs(failed.z + 4) < 0.01 && failed.music === 'failed',
    JSON.stringify(failed),
  );
  await page.unroute('**/audio/Gravity_Lessons.mp3');
  await ctx.close();
}

log('m92 zero console errors (all clean pages)', mainConsoleErrors.length === 0, mainConsoleErrors.slice(0, 3).join(' | '));
log('m92 zero page errors (all clean pages)', mainPageErrors.length === 0, mainPageErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nM9.2 BROWSER GATE: ${failed.length === 0 ? 'PASS' : 'FAILED'} (${results.length - failed.length}/${results.length})`);
console.log('NOTE: graph-structure pass != HUMAN AUDIBLE MUSIC PASS (needs human with sound on).');
process.exit(failed.length === 0 ? 0 : 1);
