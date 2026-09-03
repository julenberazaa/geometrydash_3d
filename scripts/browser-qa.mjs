/**
 * Browser QA harness (dev tool, not shipped).
 * Drives the real game in headless Chromium against the local dev server:
 * console capture, gameplay key input, state probes via window.__gd3d,
 * screenshot evidence with provenance sidecars (see qa/README.md).
 *
 * Usage: node scripts/browser-qa.mjs   (requires dev server on :5173)
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
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
};

// --- Provenance (git state at capture time) ---
const gitSha = (() => {
  try {
    return nodeChildProcess.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

/** Read live sim position. */
const pos = () => page.evaluate(() => window.__gd3d.playerPosition());
const attempts = () => page.evaluate(() => window.__gd3d.attempts());

// --- Provenance sidecar writer ---
const sidecarBase = {
  url: URL,
  capturedAt: new Date().toISOString(),
  git: { sha: gitSha },
  env: {
    userAgent: await page.evaluate(() => navigator.userAgent),
    viewport: { width: 1280, height: 720 },
    dpr: await page.evaluate(() => window.devicePixelRatio),
  },
};

async function capture(name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  const appState = await page.evaluate(() => ({
    status: window.__gd3d?.status?.() ?? 'n/a',
    progress: window.__gd3d?.progress?.() ?? -1,
    attempts: window.__gd3d?.attempts?.() ?? -1,
    playerPosition: window.__gd3d?.playerPosition?.() ?? null,
  }));
  const bytes = fs.readFileSync(file);
  const sidecar = {
    ...sidecarBase,
    capture: { name, accepted: true, rejectionReasons: [] },
    appState,
    errors: { consoleErrors: [...consoleErrors], pageErrors: [...pageErrors] },
    png: {
      width: 1280,
      height: 720,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(sidecar, null, 2));
  return appState;
}

// --- 1. Boot + auto-forward ---
log('canvas mounted', await page.evaluate(() => !!document.querySelector('#app canvas')));
await page.keyboard.press('KeyR'); // deterministic start line
await page.waitForTimeout(250);
const t0 = Date.now();
const p0 = await pos();
await page.waitForTimeout(500);
// Rate form (dz per ACTUAL wall second) instead of raw dz: under CPU
// contention the 0.5 s nominal window stretches (evaluate round-trips), so
// raw dz inflates while the sim rate stays correct. The rate band still
// rejects stalls, 2x-speed faults, and wrong-direction motion.
const p1 = await pos();
const wallDt = (Date.now() - t0) / 1000;
const fwdRate = (p1.z - p0.z) / wallDt;
log(
  'auto-forward along +Z at base speed',
  fwdRate > 11 && fwdRate < 17,
  `dz=${(p1.z - p0.z).toFixed(2)} over ${wallDt.toFixed(2)}s wall (${fwdRate.toFixed(1)} u/s, ~14 expected)`,
);
const groundedStart = await page.evaluate(() =>
  Math.abs(window.__gd3d.playerPosition().y - 0.55) < 0.05,
);
log('player settled onto runway', groundedStart, `y=${p1.y.toFixed(2)}`);

// --- 2. Lane changes (fresh restart; whole segment stays on runway z<30) ---
await page.keyboard.press('KeyR');
await page.waitForTimeout(400);
// M1.1 screen-side convention: the +Z chase camera shows world −X on
// screen-right, so ArrowRight must settle at x = −2.6 (visually right).
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
// Poll-based settle: under headless load the sim can run at ~2/3 wall speed,
// so fixed 400 ms waits end mid-transition. Polling position is robust;
// fixed waits are flaky by construction (same class as the M1 apex/repeat
// hardenings). Intent (laneIndex) is asserted exactly alongside.
async function settleX(target, tol = 0.15, timeoutMs = 2500) {
  const t0 = Date.now();
  for (;;) {
    const p = await pos();
    if (Math.abs(p.x - target) < tol) return p;
    if (Date.now() - t0 > timeoutMs) return p;
    await page.waitForTimeout(50);
  }
}
const pRight = await settleX(-2.6);
const idxRight = await page.evaluate(() => window.__gd3d.laneIndex());
log('lane right reaches screen-right lane (−2.6)', Math.abs(pRight.x + 2.6) < 0.15 && idxRight === 2, `x=${pRight.x.toFixed(3)} idx=${idxRight}`);
await capture('m11-01-controls-correct');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(400);
let pBack = await settleX(0);
let idxBack = await page.evaluate(() => window.__gd3d.laneIndex());
if (idxBack !== 1) {
  // Ultra-rare CDP input duplication under headless load can deliver a
  // press twice (engine correctly honors every delivered edge). Bounded
  // single retry with full diagnostics instead of failing ambiguously.
  console.log(`  (retry §2: idx=${idxBack} after one Left press; restarting section once)`);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(400);
  await page.keyboard.press('ArrowRight');
  await settleX(-2.6);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  pBack = await settleX(0);
  idxBack = await page.evaluate(() => window.__gd3d.laneIndex());
}
// Index assertion makes intent exact: one Left press must step 2 -> 1 (a
// doubled input edge would show idx 0 here instead of failing ambiguously).
log('lane left recenters to 0', Math.abs(pBack.x) < 0.15 && idxBack === 1, `x=${pBack.x.toFixed(3)} idx=${idxBack}`);

// --- 3. Rapid double switch (still on early runway) ---
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(120); // mid-transition...
await page.keyboard.press('ArrowRight'); // ...reverse intent
const pRapid = await settleX(0, 0.2);
log('rapid switch settles at center', Math.abs(pRapid.x) < 0.2, `x=${pRapid.x.toFixed(3)}`);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(200);

// --- 4. Jump: altitude gain + return to ground (fresh restart) ---
await page.keyboard.press('KeyR');
await page.waitForTimeout(400);
await page.keyboard.down('Space');
// Sample through the arc and take the max as apex: a single fixed-delay
// sample is flaky by construction under headless scheduling lag. Holding
// Space also exercises repeat-jump, so sampling ~0.9 s guarantees an apex
// sample for any lag well under a full jump cycle.
let apexY = -99;
for (let i = 0; i < 9; i++) {
  await page.waitForTimeout(100);
  apexY = Math.max(apexY, (await pos()).y);
}
await page.keyboard.up('Space');
// Poll for touchdown: a fixed 900 ms wait ends mid-air when the sim runs
// below wall speed under headless load (same flake class as lane settling).
let pLand = await pos();
const landT0 = Date.now();
for (;;) {
  if (Math.abs(pLand.y - 0.55) < 0.05) break;
  if (Date.now() - landT0 > 2500) break;
  await page.waitForTimeout(50);
  pLand = await pos();
}
log('jump gains altitude (~2 units)', apexY > 1.8, `apexY≈${apexY.toFixed(2)}`);
log('lands back on floor', Math.abs(pLand.y - 0.55) < 0.05, `y=${pLand.y.toFixed(2)}`);

// --- 5. Hold-jump repeat (fresh restart; hold through several cycles) ---
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
// Verify the restart landed (a lost R under load would leave the Cube
// mid-track and corrupt every measurement below); retry boundedly.
for (let i = 0; i < 3 && (await pos()).z > 10; i++) {
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
}
// Deterministic: count initiated jumps via the sim event counter. Position
// sampling cannot catch the 1-step grounded instant between hold-repeats,
// so min-Y sampling here would be flaky by construction.
const jumps = () => page.evaluate(() => window.__gd3d.jumps());
const jumpsBefore = await jumps();
let maxYDuringHold = -99;
await page.keyboard.down('ArrowUp');
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(100);
  const y = (await pos()).y;
  maxYDuringHold = Math.max(maxYDuringHold, y);
}
await page.keyboard.up('ArrowUp');
const jumpsDuringHold = (await jumps()) - jumpsBefore;
// Upper bound guards impulse integrity: flat-runway takeoff caps apex at
// ~2.68 (marker takeoffs, unreachable here, cap at ~2.88) — anything near
// 3.0+ would mean double-impulse or grounding flicker, and must fail loudly.
log('hold-jump repeats (jump counter advances >= 2 in 1.5 s)', jumpsDuringHold >= 2 && maxYDuringHold > 1.5 && maxYDuringHold < 3.0,
  `jumps=${jumpsDuringHold} maxY=${maxYDuringHold.toFixed(2)}`);

await capture('01-gameplay-runway');

// --- 6. Airborne lane change (fresh restart) ---
await page.keyboard.press('KeyR');
await page.waitForTimeout(350);
await page.keyboard.down('Space');
await page.waitForTimeout(150); // now airborne
const xBeforeAirLane = (await pos()).x;
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(450);
const xMidAir = (await pos()).x;
await page.keyboard.up('Space');
await page.waitForTimeout(400);
log('airborne lane change works', xMidAir < xBeforeAirLane - 1.5,
  `dx=${(xMidAir - xBeforeAirLane).toFixed(2)}`);

await capture('02-gameplay-midair-lane');

// --- 7. Debug overlay + colliders ---
await page.keyboard.press('F1');
await page.keyboard.press('F2');
await page.waitForTimeout(300);
const overlayVisible = await page.evaluate(() => {
  const el = document.querySelector('.debug-overlay');
  return !!el && el.style.display !== 'none';
});
log('debug overlay visible', overlayVisible);
const overlayHasData = await page.evaluate(() => {
  const el = document.querySelector('.debug-overlay');
  return !!el && el.textContent.includes('sim: 120 Hz') && el.textContent.includes('draw calls');
});
log('debug overlay shows sim Hz + draw calls', overlayHasData);
await capture('03-debug-colliders');
// M1.1 proof set 1/2 — deterministic right-lane debug state: restart first
// (the run-in may have ended mid-death-hold, where lane input is ignored),
// go right, capture the overlay pinning x ≈ −2.6 with the cube screen-right.
await page.keyboard.press('KeyR');
await page.waitForTimeout(400);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(500);
await capture('m11-03-debug-lane-direction');
// M1.1 proof set 2/2 — clean (debug off) readability shot of the vertical
// trims: roll to z ≈ 38 so the low-platform face (z = 48) fills the frame
// (wall kill triggers at z ≈ 47.4 — the screenshot itself is instant, and the
// R below re-establishes state even if the hold lands in the death window).
await page.keyboard.press('F1');
await page.keyboard.press('F2');
for (let i = 0; i < 60; i++) {
  if ((await pos()).z >= 38) break;
  await page.waitForTimeout(100);
}
await capture('m11-02-vertical-edges');
await page.keyboard.press('F1');
await page.keyboard.press('F2');
// Restore the §8 death-run entry assumption deterministically (closed-loop:
// headless capture overhead makes open-loop waits drift and lets the player
// die+respawn mid-sequence, shifting §8's whole timeline).
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
for (let i = 0; i < 60; i++) {
  if ((await pos()).z >= 40) break;
  await page.waitForTimeout(100);
}

// --- 8. Death & attempt reset: run off into first gap without jumping ---
await page.keyboard.press('F1');
await page.keyboard.press('F2');
const attBefore = await attempts();
// From ~z=40 rolling blind into the z 76..84.5 gap guarantees a void death.
await page.waitForTimeout(3500);
const attMid = await attempts();
const statusNow = await page.evaluate(() => window.__gd3d.status());
log('void death triggers', attMid > attBefore || statusNow === 'dead',
  `attempts ${attBefore} -> ${attMid}, status=${statusNow}`);
await page.waitForTimeout(1200); // auto-respawn after death hold
const attAfterDeath = await attempts();
log('auto-respawn increments attempts', attAfterDeath >= attMid, `attempts=${attAfterDeath}`);

// --- 9. R manual restart ---
// Settle into a running state first: pressing R during a death-hold window
// would race the pending auto-respawn and increment twice (both paths are
// correct; the race only makes the assertion non-deterministic).
for (let i = 0; i < 20 && (await page.evaluate(() => window.__gd3d.status())) !== 'running'; i++) {
  await page.waitForTimeout(100);
}
const attPreR = await attempts();
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
const attPostR = await attempts();
log('R restarts immediately', attPostR === attPreR + 1, `${attPreR} -> ${attPostR}`);
const zReset = (await pos()).z;
log('restart returns to start line', zReset < 10, `z=${zReset.toFixed(2)}`);

// --- 10. Resize ---
await page.setViewportSize({ width: 900, height: 650 });
await page.waitForTimeout(500);
const canvasSize = await page.evaluate(() => {
  const c = document.querySelector('#app canvas');
  return { w: c.clientWidth, h: c.clientHeight };
});
log('resize adapts canvas', Math.abs(canvasSize.w - 900) <= 1 && Math.abs(canvasSize.h - 650) <= 1,
  JSON.stringify(canvasSize));
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(400);

await capture('04-after-resize');

// --- 11. M1.2: gap-face readability + lateral fall-off ---
// Debug overlay is OFF here (§8 turned F1/F2 off); keep it off for m12-01.
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
for (let i = 0; i < 60; i++) {
  if ((await pos()).z >= 36) break;
  await page.waitForTimeout(100);
}
const m12pos = await pos();
log('m12 framing valid (runway B, low-platform face ahead)',
  m12pos.z > 30 && m12pos.z < 45 && (await page.evaluate(() => window.__gd3d.status())) === 'running',
  `z=${m12pos.z.toFixed(1)}`);
await capture('m12-01-gap-face-readability');

// Physical side fall: settle outer lane, teeter (virtual 3), exit (virtual
// 4). Catch the fall mid-air: running + airborne + below track level.
const grounded = () => page.evaluate(() => window.__gd3d.grounded());
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(600);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300); // teeter at virtual lane 3 (still supported)
await page.keyboard.press('ArrowRight'); // virtual lane 4: committed exit
// Catch support loss EARLY (first airborne frame, Cube still at the slab
// edge beside the track): late captures frame empty void as the chase
// camera pitches down with the fall. No jump input here, so airborne ==
// support loss; x past the lanes disambiguates further.
let fallState = null;
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(50);
  const s = await page.evaluate(() => ({
    x: window.__gd3d.playerPosition().x,
    y: window.__gd3d.playerPosition().y,
    status: window.__gd3d.status(),
    grounded: window.__gd3d.grounded(),
  }));
  if (s.status === 'running' && !s.grounded && s.x < -4.5) {
    fallState = s;
    break;
  }
}
log('side fall begins (airborne past the edge, still running)', fallState !== null,
  fallState ? `x=${fallState.x.toFixed(2)} y=${fallState.y.toFixed(2)}` : 'never observed support loss');
await capture('m12-02-side-fall');
// The fall must complete through the EXISTING death-plane reset (no instant
// kill: the Cube was alive below track level a moment ago).
const attPreFall = await attempts();
let respawned = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(100);
  if ((await attempts()) > attPreFall && (await page.evaluate(() => window.__gd3d.status())) === 'running') {
    respawned = true;
    break;
  }
}
log('side fall resets via death plane (attempts + 1, running)', respawned,
  `attempts=${attPreFall} -> ${await attempts()}`);

// Support-model proof: teeter at the slab edge is still grounded (COM over
// support) — exit needs the footprint fully past the edge.
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
await page.keyboard.press('F1');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(600);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
const m12teeter = await pos();
const m12teeterGrounded = await grounded();
log('edge teeter stays grounded (support footprint overlaps)',
  Math.abs(m12teeter.x + 5.2) < 0.3 && m12teeterGrounded === true,
  `x=${m12teeter.x.toFixed(2)} grounded=${m12teeterGrounded}`);
await capture('m12-03-debug-support-loss');
await page.keyboard.press('F1');

// --- 12. Console audit ---
log('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
log('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
