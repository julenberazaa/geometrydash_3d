/**
 * M9.1 audio gate (dev tool, not shipped) — Phase A proof for the takeover.
 *
 * Proves with a real browser (not unit fakes):
 *  1. GET /audio/Gravity_Lessons.mp3 -> HTTP 200 + expected byte size.
 *  2. Press-to-start gate holds the sim at tick 0.
 *  3. After Space: decoded buffer ~= 121.57 s, AudioContext running,
 *     transport playing, muted=false, gain > 0, target AND actual time
 *     advance, drift within policy.
 *  4. FAIL-LOUD: with the asset blocked, the level does NOT start
 *     silently (gate latches MUSIC LOAD FAILED, sim frozen); explicit N
 *     starts without music.
 *  5. ?music=off starts immediately and silent (explicit silent mode).
 *
 * Headless Chromium has no speakers: this asserts TRANSPORT state (buffer,
 * context, gain, advancing time). HUMAN AUDIBLE MUSIC PASS stays open and
 * must be confirmed by a human with sound on.
 *
 * Usage: QA_URL=http://localhost:5174/ node scripts/browser-qa-m91-audio.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.QA_URL ?? 'http://localhost:5173/';
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
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
// Scoped per section: the abort-case page EXPECTS mp3 load errors (proof
// the block worked); every other page must stay console-clean.
const mainConsoleErrors = [];
const mainPageErrors = [];
const abortConsoleErrors = [];
const abortPageErrors = [];

// --- A. Asset serves (HTTP 200 + byte size), port-independent. ---
{
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') mainConsoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => mainPageErrors.push(String(err)));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  const asset = await ev(page, async () => {
    const r = await fetch('/audio/Gravity_Lessons.mp3');
    const buf = await r.arrayBuffer();
    return { status: r.status, bytes: buf.byteLength, type: r.headers.get('content-type') };
  });
  log('m91 audio asset HTTP 200 + byte size', asset.status === 200 && asset.bytes === EXPECTED_BYTES, JSON.stringify(asset));

  // --- B. Gate holds at tick 0. ---
  const gate0 = await ev(page, () => ({
    awaiting: window.__gd3d.awaitingStart(),
    z: window.__gd3d.playerPosition().z,
    music: window.__gd3d.musicState(),
  }));
  log('m91 gate holds at tick 0', gate0.awaiting === true && Math.abs(gate0.z + 4) < 0.01, JSON.stringify(gate0));

  // --- C. Space unlocks: real transport evidence. ---
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
  await sleep(page, 2000);
  const live = await ev(page, () => ({
    awaiting: window.__gd3d.awaitingStart(),
    pending: window.__gd3d.startGatePending(),
    failed: window.__gd3d.startGateFailed(),
    z: window.__gd3d.playerPosition().z,
    music: window.__gd3d.musicState(),
    buffer: window.__gd3d.musicBufferDuration(),
    ctx: window.__gd3d.musicContextState(),
    muted: window.__gd3d.musicMuted(),
    volume: window.__gd3d.musicVolume(),
    gain: window.__gd3d.musicGain(),
    target: window.__gd3d.musicTargetTime(),
    actual: window.__gd3d.musicActualTime(),
    drift: window.__gd3d.musicDriftMs(),
    playing: window.__gd3d.musicPlaying(),
  }));
  const transportOk =
    live.failed === false && live.music === 'playing' && live.playing === true &&
    Math.abs(live.buffer - EXPECTED_DURATION) < 1.0 && live.ctx === 'running' &&
    live.muted === false && live.volume > 0.5 && live.gain > 0 &&
    live.target > 0 && live.actual > 0;
  log('m91 transport live (buffer/ctx/playing/gain)', transportOk, JSON.stringify(live));
  // Headless software rendering starves the sim (8-step catch-up cap), so
  // wall-clock advance is NOT the assertion: music must track the SIM
  // clock (both advance together, whatever the wall rate).
  const t1 = await ev(page, () => ({ target: window.__gd3d.musicTargetTime(), actual: window.__gd3d.musicActualTime() }));
  await sleep(page, 1500);
  const t2 = await ev(page, () => ({ target: window.__gd3d.musicTargetTime(), actual: window.__gd3d.musicActualTime() }));
  const targetAdv = t2.target - t1.target;
  const actualAdv = t2.actual - t1.actual;
  log('m91 target music time advances', targetAdv > 0.2, `+${targetAdv.toFixed(2)}s`);
  log('m91 actual music time advances with the sim clock', actualAdv > 0.2 && Math.abs(actualAdv - targetAdv) < 0.5, `actual+${actualAdv.toFixed(2)}s vs target+${targetAdv.toFixed(2)}s`);
  const drift = await ev(page, () => window.__gd3d.musicDriftMs());
  log('m91 drift within policy', Math.abs(drift) < 1000, `drift=${drift.toFixed(0)}ms`);
  await page.close();
}

// --- D. FAIL-LOUD: blocked asset never starts silently. ---
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') abortConsoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => abortPageErrors.push(String(err)));
  await page.route('**/audio/Gravity_Lessons.mp3', (route) => route.abort('failed'));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__gd3d.startGateFailed() === true, null, { timeout: 30000 });
  await sleep(page, 1000);
  const failed = await ev(page, () => ({
    failed: window.__gd3d.startGateFailed(),
    awaiting: window.__gd3d.awaitingStart(),
    z: window.__gd3d.playerPosition().z,
    steps: window.__gd3d.simSteps(),
    music: window.__gd3d.musicState(),
  }));
  const loud = failed.failed === true && failed.awaiting === true &&
    Math.abs(failed.z + 4) < 0.01 && failed.steps === 0 && failed.music === 'failed';
  log('m91 audio failure is loud (no silent start)', loud, JSON.stringify(failed));
  // Explicit N starts without music (human action, never automatic).
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
  const silent = await ev(page, () => ({
    awaiting: window.__gd3d.awaitingStart(),
    failed: window.__gd3d.startGateFailed(),
    z: window.__gd3d.playerPosition().z,
  }));
  log('m91 explicit N starts without music', silent.awaiting === false && silent.failed === false && silent.z > -3, JSON.stringify(silent));
  await page.unroute('**/audio/Gravity_Lessons.mp3');
  await ctx.close();
}

// --- E. ?music=off: explicit silent mode, immediate. ---
{
  const page = await browser.newPage();
  await page.goto(`${URL}?music=off`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  await sleep(page, 2000);
  const off = await ev(page, () => ({
    awaiting: window.__gd3d.awaitingStart(),
    z: window.__gd3d.playerPosition().z,
    music: window.__gd3d.musicState(),
  }));
  log('m91 ?music=off starts immediately and silent', off.awaiting === false && off.z > -3 && off.music === 'none', JSON.stringify(off));
  await page.close();
}

log('m91 zero console errors (live audio page)', mainConsoleErrors.length === 0, mainConsoleErrors.slice(0, 3).join(' | '));
log('m91 zero page errors (live audio page)', mainPageErrors.length === 0, mainPageErrors.slice(0, 3).join(' | '));
const abortOnlyMp3 = abortConsoleErrors.length > 0 &&
  abortConsoleErrors.every((m) => /audio|ERR_FAILED|Failed to load resource/i.test(m));
log('m91 abort page errors are only the blocked mp3', abortOnlyMp3, abortConsoleErrors.slice(0, 3).join(' | '));
log('m91 zero page errors (abort page)', abortPageErrors.length === 0, abortPageErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nM9.1 AUDIO GATE: ${failed.length === 0 ? 'TRANSPORT PASS' : 'FAILED'} (${results.length - failed.length}/${results.length})`);
console.log('NOTE: headless transport pass != HUMAN AUDIBLE MUSIC PASS (needs human with sound on).');
process.exit(failed.length === 0 ? 0 : 1);
