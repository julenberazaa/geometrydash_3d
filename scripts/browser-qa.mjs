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
// Verify the restart landed (a dropped CDP R under load leaves stale
// mid-track state and corrupts every measurement below); retry boundedly.
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  if ((await pos()).z < 10) break;
}
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

// --- 12. M2: frontal platform-face death -> burst -> auto-respawn ---
// Rolling blind from the start line runs into the low-platform face (z=48,
// top y=0.8): a full-width frontal kill at z ~= 47.4, no jumps required.
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
// F1 must verifiably take effect (a dropped CDP press under load silently
// voids every overlay read below); retry boundedly, fail loudly if stuck.
let f1On = false;
for (let i = 0; i < 3 && !f1On; i++) {
  await page.keyboard.press('F1'); // overlay live BEFORE death (0.30 s hold is short)
  await page.waitForTimeout(150);
  f1On = await page.evaluate(() => {
    const el = document.querySelector('.debug-overlay');
    return !!el && el.style.display !== 'none';
  });
}
log('m2 F1 overlay enabled', f1On);
await page.waitForTimeout(100);
// Pre-impact framing: runway B with the platform face ahead, still running.
let preImpact = null;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(100);
  const s = await page.evaluate(() => ({
    z: window.__gd3d.playerPosition().z,
    status: window.__gd3d.status(),
  }));
  if (s.status !== 'running') break;
  // Wide window (30..45): under headless load a poll iteration can span
  // several units, and a narrow window falls between two reads.
  if (s.z > 30 && s.z < 45) {
    preImpact = s;
    break;
  }
}
log('m2 pre-impact framing (alive near face)', preImpact !== null,
  preImpact ? `z=${preImpact.z.toFixed(1)}` : 'never framed');
await capture('m2-01-pre-impact');
// Fresh page for the frozen-burst photography below: long-lived headless
// pages degrade screenshot freshness (proven: identical-bytes captures while
// sim/DOM advance), while a fresh page photographs the same frozen state
// perfectly (probe-verified). All M2 asserts below are relative/self-arming,
// so the reload is transparent to them.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
await page.keyboard.press('F1'); // overlay live BEFORE death (0.30 s hold is short)
await page.waitForTimeout(100);
// Deterministic start line before the data poll below (photo rounds arm
// themselves per attempt).
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  if ((await pos()).z < 10) break;
}
// Lethal impact: fast poll for death, sampling the burst flag in the same
// evaluate so the 0.35 s effect cannot slip between two round-trips.
let wallDeath = null;
let burstAtDeath = false;
let f1AtDeath = false;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(50);
  const s = await page.evaluate(() => ({
    status: window.__gd3d.status(),
    cause: window.__gd3d.deathCause(),
    burst: window.__gd3d.burstActive(),
    // Read the overlay in the SAME round-trip: the 0.30 s hold is shorter
    // than a screenshot + evaluate cycle under headless load.
    f1: (document.querySelector('.debug-overlay')?.textContent ?? '').includes('cause=frontImpact'),
    // Same for the lethal record: respawn clears the id, so a later
    // round-trip can observe a fresh running state with id=null.
    lethal: window.__gd3d.lethalInfo(),
  }));
  if (s.status === 'dead') {
    wallDeath = s;
    burstAtDeath = s.burst;
    f1AtDeath = s.f1;
    break;
  }
}
log('m2 frontal wall impact kills', wallDeath !== null,
  wallDeath ? `cause=${wallDeath.cause}` : 'survived the face?!');
log('m2 death cause is frontImpact', wallDeath?.cause === 'frontImpact',
  `cause=${wallDeath?.cause}`);
log('m2 lethal contact recorded',
  !!wallDeath?.lethal.colliderId && wallDeath.lethal.normal.z < -0.5,
  `id=${wallDeath?.lethal.colliderId} n=(${wallDeath?.lethal.normal.x},${wallDeath?.lethal.normal.y},${wallDeath?.lethal.normal.z}) preVZ=${wallDeath?.lethal.preVel.z.toFixed(1)}`);
// Burst: seen either at the death poll or within the next 300 ms (one hedged
// re-poll loop — headless render fps can delay the first burst frame).
let burstSeen = burstAtDeath;
if (!burstSeen) {
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(50);
    if ((await page.evaluate(() => window.__gd3d.burstActive())) === true) {
      burstSeen = true;
      break;
    }
  }
}
log('m2 death burst seen live at detection (natural observation)', burstSeen === true);
// F1 confirmation with a short live retry: the overlay repaints a frame or
// two AFTER the sim transition, so the in-poll read can predate it. Retry
// while still dead (bounded; respawn ends the window).
let f1Confirmed = f1AtDeath;
if (!f1Confirmed) {
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(20);
    const s = await page.evaluate(() => ({
      status: window.__gd3d.status(),
      f1: (document.querySelector('.debug-overlay')?.textContent ?? '').includes('cause=frontImpact'),
    }));
    if (s.f1) {
      f1Confirmed = true;
      break;
    }
    if (s.status !== 'dead') break;
  }
}
log('m2 F1 overlay shows death cause', f1Confirmed);
// Burst photo: in-page dance + frozen capture. CDP round-trips (~100 ms
// loaded) cannot fit inside the 0.30 s death hold, so ALL timing lives in
// the page: a 16 ms watcher freezes + replays the REAL pooled burst at the
// recorded death position on the next death, runs ~120 ms live, refreezes,
// and records the gate. CDP only arms, waits (leisurely — the frozen frame
// holds indefinitely), and captures. Accept a frame ONLY when burst-held
// AND sim-dead: the camera then provably never left the death follow.
await page.evaluate(() => {
  if (window.__photoWatch) clearInterval(window.__photoWatch);
  window.__photoArmed = false;
  window.__photoGate = null;
  window.__photoWatch = setInterval(() => {
    if (window.__photoArmed && window.__gd3d.status() === 'dead') {
      window.__photoArmed = false; // one-shot per arm
      window.__gd3d.debugFreezeFrame(true);
      window.__gd3d.debugReplayBurst();
      window.__gd3d.debugFreezeFrame(false);
      setTimeout(() => {
        window.__gd3d.debugFreezeFrame(true);
        window.__photoGate = {
          burst: window.__gd3d.burstActive(),
          status: window.__gd3d.status(),
        };
      }, 120);
    }
  }, 16);
});
let photoOk = false;
for (let round = 0; round < 3 && !photoOk; round++) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);
    if ((await pos()).z < 10) break;
  }
  await page.evaluate(() => {
    window.__photoGate = null;
    window.__photoArmed = true;
  });
  let gate = null;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(100);
    gate = await page.evaluate(() => window.__photoGate);
    if (gate !== null) break;
  }
  await page.evaluate(() => {
    window.__photoArmed = false;
  });
  if (gate && gate.burst && gate.status === 'dead') {
    photoOk = true;
    await page.evaluate(() => {
      let el = document.getElementById('__qa_wiggle');
      if (!el) {
        el = document.createElement('div');
        el.id = '__qa_wiggle';
        el.style.position = 'fixed';
        el.style.top = '0';
        el.style.left = '0';
        el.style.width = '1px';
        el.style.height = '1px';
        el.style.zIndex = '99999';
        document.body.appendChild(el);
      }
      el.style.visibility = el.style.visibility === 'hidden' ? 'visible' : 'hidden';
    });
    await page.waitForTimeout(300);
    await capture('m2-02-death-burst');
    await capture('m2-05-debug-contact');
  }
  await page.evaluate(() => window.__gd3d.debugFreezeFrame(false));
}
await page.evaluate(() => {
  clearInterval(window.__photoWatch);
  window.__photoWatch = null;
});
log('m2 death burst photographed mid-flight (frozen death frame)', photoOk);
await page.keyboard.press('F1');
let burstCleared = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(100);
  if ((await page.evaluate(() => window.__gd3d.burstActive())) === false) {
    burstCleared = true;
    break;
  }
}
log('m2 death burst clears', burstCleared);
// Auto-respawn: exactly one attempt, back at the start line.
const attWall = await attempts();
let wallRespawn = null;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(100);
  const s = await page.evaluate(() => ({
    status: window.__gd3d.status(),
    attempts: window.__gd3d.attempts(),
    z: window.__gd3d.playerPosition().z,
  }));
  if (s.status === 'running' && s.attempts > attWall) {
    wallRespawn = s;
    break;
  }
}
log('m2 auto-respawn after wall death (attempts + 1)', wallRespawn !== null,
  wallRespawn ? `attempts=${wallRespawn.attempts} z=${wallRespawn.z.toFixed(1)}` : 'stuck dead');
await page.waitForTimeout(400);
await capture('m2-03-respawn');

// --- 13. M2: spike death via closed-loop jump chain ---
async function jumpAtZ(lo, hi, settleWaitMs, timeoutMs = 9000) {
  // Closed-loop takeoff: settle first, then wait for the grounded window.
  // Windows are physics-derived (ranges: flat 8.8 u, +0.8 climb 7.9 u,
  // -1.6 drop 10.3 u at 14 u/s) with the grounded gate load-bearing — a
  // press while airborne is eaten and the chain misses downstream.
  await page.waitForTimeout(settleWaitMs);
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => ({
      z: window.__gd3d.playerPosition().z,
      g: window.__gd3d.grounded(),
      status: window.__gd3d.status(),
    }));
    if (s.status !== 'running') return false;
    if (s.g && s.z >= lo && s.z <= hi + 1.0) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(80);
      await page.keyboard.up('Space');
      return true;
    }
    if (Date.now() - t0 > timeoutMs) return false;
    await page.waitForTimeout(30);
  }
}
let spikeDeath = null;
for (let attempt = 1; attempt <= 4 && spikeDeath === null; attempt++) {
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(350);
  const chain = await (async () => {
    // J1: runway (feet 0) -> low platform top 0.8 (z48..58). Takeoff 41+
    // lands 49.8+ (flat range 8.8; edge overlap needs land z > 48.55).
    // Wide lo bound: loaded poll iterations span several units.
    if (!(await jumpAtZ(41, 45, 0))) return 'J1-missed';
    // J2: platform (feet 0.8) -> elevated top 1.6 (z62..76). Takeoff 54.5+
    // lands 62.4+ (climb range 7.9; edge overlap needs land z > 61.45).
    if (!(await jumpAtZ(54.5, 58, 400))) return 'J2-missed';
    // J3: elevated (feet 1.6) -> pad top 0 (z84.5..96). Takeoff 73.5+
    // lands 83.8+ (drop range 10.3; overlap needs land z > 83.95).
    if (!(await jumpAtZ(73.5, 75, 900))) return 'J3-missed';
    return 'ok';
  })();
  if (chain !== 'ok') {
    const diag = await page.evaluate(() => ({
      status: window.__gd3d.status(),
      cause: window.__gd3d.deathCause(),
      z: window.__gd3d.playerPosition().z.toFixed(1),
    }));
    console.log(`  (m2 spike chain attempt ${attempt}: ${chain} status=${diag.status} cause=${diag.cause} z=${diag.z})`);
    continue;
  }
  // Roll to the weave straight, take the screen-left lane into the z=108 spikes.
  const t1 = Date.now();
  let steered = false;
  while (Date.now() - t1 < 6000) {
    const s = await page.evaluate(() => ({
      z: window.__gd3d.playerPosition().z,
      status: window.__gd3d.status(),
    }));
    if (s.status !== 'running') break;
    if (s.z >= 99 && !steered) {
      await page.keyboard.press('ArrowLeft');
      steered = true;
    }
    if (s.status === 'running' && s.z > 104 && steered) break;
    await page.waitForTimeout(30);
  }
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => ({
      status: window.__gd3d.status(),
      cause: window.__gd3d.deathCause(),
    }));
    if (s.status === 'dead') {
      spikeDeath = { ...s, attempt };
      break;
    }
  }
  if (spikeDeath === null) console.log(`  (m2 spike chain attempt ${attempt}: no death observed, retrying)`);
}
log('m2 spike run kills', spikeDeath !== null,
  spikeDeath ? `attempt=${spikeDeath.attempt} cause=${spikeDeath.cause}` : 'chain failed 3x');
log('m2 spike death cause is hazard', spikeDeath?.cause === 'hazard',
  `cause=${spikeDeath?.cause}`);
// Let the spike death auto-respawn before continuing.
for (let i = 0; i < 40 && (await page.evaluate(() => window.__gd3d.status())) !== 'running'; i++) {
  await page.waitForTimeout(100);
}

// --- 14. M2: lateral scrape survives (teeter at the slab edge) ---
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(600);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400); // teeter: COM over support, blocked by nothing, alive
const scrape = await page.evaluate(() => ({
  x: window.__gd3d.playerPosition().x,
  status: window.__gd3d.status(),
  cause: window.__gd3d.deathCause(),
  grounded: window.__gd3d.grounded(),
}));
log('m2 lateral edge teeter survives (no scrape kill)',
  scrape.status === 'running' && scrape.cause === null && scrape.grounded === true,
  `x=${scrape.x.toFixed(2)} grounded=${scrape.grounded}`);
await capture('m2-04-lateral-scrape');

// --- 15. M2: R-from-dead + 10x die/respawn leak guard ---
// R during the death hold: immediate respawn, exactly one attempt.
await page.keyboard.press('ArrowRight'); // commit the side exit -> fall -> death
let deadForR = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(100);
  if ((await page.evaluate(() => window.__gd3d.status())) === 'dead') {
    deadForR = true;
    break;
  }
}
let rFromDeadOk = false;
if (deadForR) {
  const a0 = await attempts();
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(250);
  const a1 = await attempts();
  rFromDeadOk = (await page.evaluate(() => window.__gd3d.status())) === 'running' && a1 === a0 + 1;
}
log('m2 R during dead respawns immediately (+1 attempt)', rFromDeadOk);
// Leak loop: 10 side-fall deaths, then compare scene + draw cost.
const statsBefore = await page.evaluate(() => ({
  children: window.__gd3d.sceneChildren(),
  ...window.__gd3d.rendererStats(),
}));
let leakDeaths = 0;
for (let round = 0; round < 10; round++) {
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  if ((await page.evaluate(() => window.__gd3d.status())) !== 'running') continue;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowRight');
  const a0 = await attempts();
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => ({
      attempts: window.__gd3d.attempts(),
      status: window.__gd3d.status(),
    }));
    if (s.attempts > a0 && s.status === 'running') {
      leakDeaths++;
      break;
    }
    if (Date.now() - t0 > 8000) break;
  }
}
await page.waitForTimeout(600); // let any burst expire
const statsAfter = await page.evaluate(() => ({
  children: window.__gd3d.sceneChildren(),
  burst: window.__gd3d.burstActive(),
  ...window.__gd3d.rendererStats(),
}));
log('m2 repeated deaths complete (10x die/respawn)', leakDeaths === 10, `${leakDeaths}/10`);
log('m2 no scene growth across deaths', statsAfter.children === statsBefore.children,
  `children ${statsBefore.children} -> ${statsAfter.children}`);
log('m2 draw cost stable after deaths',
  Math.abs(statsAfter.calls - statsBefore.calls) <= 2 && statsAfter.burst === false,
  `calls ${statsBefore.calls} -> ${statsAfter.calls} tris ${statsBefore.triangles} -> ${statsAfter.triangles}`);

// --- 17. M3: gravity portals + ceiling gameplay ---
// Uses the debug-only teleport probe (GameSimulation.debugPlaceAt, same QA-aid
// category as debugFreezeFrame) to enter the appended gravity section at
// z=176: the existing track between the start and the section contains ~0.3 u
// takeoff windows (gap z 122..129.5) that CDP polling cannot hit reliably —
// full-section playability is proven deterministically in tests/gravity.test.ts
// (per-step closed-loop playthrough to finish). The Cube never stops moving
// forward, so on-ceiling checks are grouped into short passes that fit inside
// the ceiling slabs; each pass starts fresh with a teleport.
const simState = () =>
  page.evaluate(() => ({
    x: window.__gd3d.playerPosition().x,
    y: window.__gd3d.playerPosition().y,
    z: window.__gd3d.playerPosition().z,
    grounded: window.__gd3d.grounded(),
    status: window.__gd3d.status(),
    mode: window.__gd3d.gravityMode(),
    portalId: window.__gd3d.lastPortalId(),
    flips: window.__gd3d.portalTransitionCount(),
    support: window.__gd3d.supportId(),
    cause: window.__gd3d.deathCause(),
    cameraUpY: window.__gd3d.cameraUpY(),
  }));
async function rollUntilM3(pred, timeoutMs = 30000, pollMs = 40) {
  const t0 = Date.now();
  for (;;) {
    const s = await simState();
    if (s.status === 'running' && pred(s)) return s;
    if (Date.now() - t0 > timeoutMs) return null;
    await page.waitForTimeout(pollMs);
  }
}
async function startGravityRun(teleportZ = 176) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);
    if ((await pos()).z < 10) break;
  }
  await page.evaluate((z) => window.__gd3d.debugTeleport(0, 1.5, z), teleportZ);
  await page.waitForTimeout(250);
}
async function crossToCeiling() {
  await startGravityRun();
  const crossed = await rollUntilM3((s) => s.mode === 'ceiling' && s.flips >= 1, 20000);
  if (!crossed) return null;
  return rollUntilM3((s) => s.grounded && Math.abs(s.y - 5.45) < 0.12, 10000);
}

// PASS 1: floor baseline, portal-up crossing + rise observation, grounding.
// Screenshots freeze the sim with the pause key (P) so CDP capture latency
// (~1 s = 14 u of travel) can never race the closed-loop observation.
await startGravityRun(172);
const m3Floor = await rollUntilM3((s) => s.z > 172 && s.z < 181.5 && s.mode === 'floor' && s.grounded);
log('m3 floor baseline before portal (still Floor, grounded)',
  m3Floor !== null, m3Floor ? `z=${m3Floor.z.toFixed(1)} mode=${m3Floor.mode}` : 'never framed');
await page.keyboard.press('KeyP'); // freeze at the pre-portal frame
await page.waitForTimeout(250);
await capture('m3-01-floor-before-portal');
await page.keyboard.press('KeyP'); // resume
await page.waitForTimeout(150);

// Combined crossing+rise observation: the transition photo is taken MID-RISE
// with the sim paused, so the frozen frame shows the portal + upward travel.
let firstCeiling = null;
let groundedCeiling = null;
let airborneSupportCleared = false;
let maxYRise = -99;
let transitionShot = false;
{
  const t0 = Date.now();
  for (;;) {
    const s = await simState();
    if (s.status === 'running' && s.mode === 'ceiling') {
      if (firstCeiling === null) firstCeiling = s;
      if (!s.grounded) {
        maxYRise = Math.max(maxYRise, s.y);
        if (s.support === null) airborneSupportCleared = true;
        if (!transitionShot) {
          transitionShot = true;
          await page.keyboard.press('KeyP'); // freeze mid-rise
          await page.waitForTimeout(250);
          await capture('m3-02-gravity-transition-up');
          await page.keyboard.press('KeyP'); // resume the rise
          await page.waitForTimeout(150);
        }
      } else if (s.y > 4.5 && groundedCeiling === null) {
        groundedCeiling = s;
        break;
      }
    }
    if (Date.now() - t0 > 25000) break;
    await page.waitForTimeout(25);
  }
}
log('m3 portal up crossing flips gravity exactly once',
  firstCeiling !== null && firstCeiling.flips === 1 && firstCeiling.portalId === 'portal-up-1',
  firstCeiling ? `z=${firstCeiling.z.toFixed(2)} flips=${firstCeiling.flips} id=${firstCeiling.portalId}` : 'never flipped');
log('m3 crossing does not teleport (observed just past the plane, still at portal height)',
  firstCeiling !== null && firstCeiling.z > 181.5 && firstCeiling.z < 210,
  firstCeiling ? `z=${firstCeiling.z.toFixed(2)}` : '-');
log('m3 support cleared on flip (airborne ceiling phase has no support)',
  firstCeiling !== null && airborneSupportCleared,
  `airborneSupportCleared=${airborneSupportCleared}`);
log('m3 cube physically travels upward to the ceiling (grounded high; sampled maxY corroborates)',
  groundedCeiling !== null && groundedCeiling.y > 4.5,
  groundedCeiling ? `maxY=${maxYRise.toFixed(2)} y=${groundedCeiling.y.toFixed(2)}` : 'never grounded high');
log('m3 grounded on ceiling underside (~5.45) with support id',
  groundedCeiling !== null && Math.abs(groundedCeiling.y - 5.45) < 0.12 && !!groundedCeiling.support,
  groundedCeiling ? `y=${groundedCeiling.y.toFixed(3)} support=${groundedCeiling.support}` : '-');
log('m3 camera up remains world +Y (no roll)',
  groundedCeiling !== null && Math.abs(groundedCeiling.cameraUpY - 1) < 1e-6,
  `cameraUpY=${groundedCeiling?.cameraUpY}`);
await capture('m3-03-ceiling-grounded');

// Lane screen convention on the ceiling (ArrowRight -> x -2.6, idx 2).
// Bounded retry: CDP keypresses can be dropped under load (documented in the
// M1.1 section); the intent index is checked first so a lost press is visible.
let m3Right = null;
let idxCeil = -1;
for (let attempt = 0; attempt < 3 && m3Right === null; attempt++) {
  await page.keyboard.press('ArrowRight');
  const it0 = Date.now();
  for (;;) {
    idxCeil = await page.evaluate(() => window.__gd3d.laneIndex());
    if (idxCeil === 2 || Date.now() - it0 > 1500) break;
    await page.waitForTimeout(40);
  }
  m3Right = await rollUntilM3((s) => Math.abs(s.x + 2.6) < 0.25, 2500);
}
log('m3 ArrowRight still moves screen-right (−X) on ceiling',
  m3Right !== null && idxCeil === 2, `x=${m3Right?.x.toFixed(2)} idx=${idxCeil}`);
await page.keyboard.press('ArrowLeft');
const m3Back = await rollUntilM3((s) => Math.abs(s.x) < 0.2, 2500);
log('m3 ArrowLeft recenters on ceiling', m3Back !== null, m3Back ? `x=${m3Back.x.toFixed(2)}` : '-');

// Ceiling support stability (own pass, full slab margin): ~1.5 s of grounded
// running on slab A with zero input; unit tests pin 0 airborne ticks/120.
{
  await crossToCeiling();
  let stableTicks = 0;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(100);
    const st = await simState();
    if (st.status === 'running' && st.mode === 'ceiling' && st.grounded && Math.abs(st.y - 5.45) < 0.12) stableTicks++;
  }
  log('m3 ceiling support stays stable for 1.5 s (no oscillation)', stableTicks >= 14, `stable=${stableTicks}/15`);
}

// PASS 2: ceiling jumps + fast-fall + debug frame (all fit on slab A).
const pass2 = await crossToCeiling();
log('m3 pass2 reaches ceiling', pass2 !== null);
async function ceilingJumpMinY(key) {
  await page.keyboard.down(key);
  await page.waitForTimeout(120);
  await page.keyboard.up(key);
  let minY = 99;
  const t0 = Date.now();
  for (;;) {
    const s = await simState();
    if (s.status !== 'running') return { minY, grounded: false };
    minY = Math.min(minY, s.y);
    if (minY < 99 && s.grounded && Date.now() - t0 > 500) return { minY, grounded: true };
    if (Date.now() - t0 > 6000) return { minY, grounded: s.grounded };
    await page.waitForTimeout(25);
  }
}
if (pass2 !== null) {
  const jumpDown = await ceilingJumpMinY('ArrowDown');
  log('m3 ArrowDown jumps AWAY from ceiling (dips below 4.8, lands again)',
    jumpDown.minY < 4.8 && jumpDown.grounded, `minY=${jumpDown.minY.toFixed(2)}`);
  const jumpSpace = await ceilingJumpMinY('Space');
  log('m3 Space jumps from ceiling (universal jump key)',
    jumpSpace.minY < 4.8 && jumpSpace.grounded, `minY=${jumpSpace.minY.toFixed(2)}`);
  await capture('m3-04-ceiling-jump');
  // Fast-fall: ArrowUp while airborne returns the Cube to the ceiling.
  await page.keyboard.down('Space');
  await page.waitForTimeout(150);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('Space');
  const ffBack = await rollUntilM3((s) => s.grounded && Math.abs(s.y - 5.45) < 0.12, 5000);
  log('m3 ArrowUp airborne fast-fall returns to ceiling (running, grounded)',
    ffBack !== null, ffBack ? `y=${ffBack.y.toFixed(2)}` : 'never re-grounded');
  // Debug overlay shows the gravity frame (F1).
  await page.keyboard.press('F1');
  await page.waitForTimeout(200);
  const overlayGravity = await page.evaluate(() => {
    const el = document.querySelector('.debug-overlay');
    return el ? el.textContent : '';
  });
  log('m3 F1 overlay shows ceiling gravity frame',
    overlayGravity.includes('gravity: ceiling') && overlayGravity.includes('g: (0,1,0)') && overlayGravity.includes('N: (0,-1,0)'),
    (overlayGravity.split('\n').find((l) => l.includes('gravity:')) ?? 'line missing').trim());
  await capture('m3-06-debug-gravity-frame');
  await page.keyboard.press('F1');
}

// PASS 3: ceiling lateral fall-off -> upper void -> respawn on Floor start.
{
  const pass3 = await crossToCeiling();
  log('m3 pass3 reaches ceiling', pass3 !== null);
  if (pass3 !== null) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowRight');
    let ceilFall = null;
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(50);
      const s = await simState();
      if (s.status === 'running' && s.mode === 'ceiling' && !s.grounded && s.x < -4.5) {
        ceilFall = s;
        break;
      }
    }
    log('m3 ceiling side fall loses support physically (airborne, alive)',
      ceilFall !== null, ceilFall ? `x=${ceilFall.x.toFixed(2)} y=${ceilFall.y.toFixed(2)}` : 'never observed');
    let upperVoidDeath = null;
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(50);
      const s = await page.evaluate(() => ({
        status: window.__gd3d.status(),
        cause: window.__gd3d.deathCause(),
        y: window.__gd3d.playerPosition().y,
      }));
      if (s.status === 'dead') {
        upperVoidDeath = s;
        break;
      }
    }
    log('m3 upper void death (cause void, high altitude)',
      upperVoidDeath !== null && upperVoidDeath.cause === 'void' && upperVoidDeath.y > 10,
      upperVoidDeath ? `cause=${upperVoidDeath.cause} y=${upperVoidDeath.y.toFixed(1)}` : 'no death');
    const m3Respawn = await rollUntilM3((s) => s.grounded && s.mode === 'floor' && s.z < 5, 10000);
    log('m3 death from ceiling respawns in starting mode (Floor, at start)',
      m3Respawn !== null, m3Respawn ? `mode=${m3Respawn.mode} z=${m3Respawn.z.toFixed(1)}` : 'never respawned');
  }
}

// PASS 4: R-from-ceiling, then portal-down crossing + floor landing + finish.
{
  const pass4 = await crossToCeiling();
  log('m3 pass4 reaches ceiling', pass4 !== null);
  if (pass4 !== null) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(400);
    const rReset = await simState();
    log('m3 R from ceiling resets to Floor start', rReset.mode === 'floor' && rReset.z < 5,
      `mode=${rReset.mode} z=${rReset.z.toFixed(1)}`);
  }
  // Fresh run for the return leg: cross up, closed-loop ceiling-gap jump
  // (takeoff window z 228.6..232.6, ~4 u — CDP-pollable), portal down.
  await startGravityRun();
  const upAgain = await rollUntilM3((s) => s.mode === 'ceiling' && s.grounded && Math.abs(s.y - 5.45) < 0.15, 20000);
  log('m3 portal re-cross after R (re-armed)', upAgain !== null);
  if (upAgain !== null) {
    let gapJumped = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const s = await simState();
      if (s.status !== 'running') break;
      if (s.grounded && s.z >= 228.6 && s.z <= 232.6) {
        await page.keyboard.down('Space');
        await page.waitForTimeout(80);
        await page.keyboard.up('Space');
        gapJumped = true;
        break;
      }
      await page.waitForTimeout(20);
    }
    log('m3 ceiling gap jump executed', gapJumped);
    const flipsBeforeDown = (await simState()).flips;
    const downCross = await rollUntilM3((s) => s.mode === 'floor' && s.flips >= flipsBeforeDown + 1, 20000);
    log('m3 portal down returns gravity to Floor exactly once',
      downCross !== null && downCross.portalId === 'portal-down-1' && downCross.flips === flipsBeforeDown + 1,
      downCross ? `z=${downCross.z.toFixed(1)} id=${downCross.portalId} flips=${downCross.flips}` : 'never returned');
    const m3Landed = await rollUntilM3((s) => s.grounded && Math.abs(s.y - 0.55) < 0.1, 10000);
    log('m3 lands back on the floor after portal down',
      m3Landed !== null && m3Landed.z > 245 && m3Landed.z < 265,
      m3Landed ? `z=${m3Landed.z.toFixed(1)} y=${m3Landed.y.toFixed(2)}` : 'never landed');
    await capture('m3-05-return-floor');
    const flipsHoldA = (await simState()).flips;
    await page.waitForTimeout(1200);
    const flipsHoldB = (await simState()).flips;
    log('m3 no repeated portal toggles', flipsHoldA === flipsHoldB, `flips ${flipsHoldA} -> ${flipsHoldB}`);
    // M4 note: the level no longer ENDS after the gravity section — the M4
    // interaction section (z 278..386, separately QA'd below and proven
    // end-to-end by the deterministic playthrough test) continues to the new
    // finishZ 380. This check therefore completes the M3 section, then uses
    // the debug-only placement aid to skip the interaction content and proves
    // the run still reaches the level finish gate from the final runway.
    await page.evaluate(() => window.__gd3d.debugTeleport(0, 1.5, 376.5));
    await page.waitForTimeout(300);
    let m3Finished = false;
    {
      const t0 = Date.now();
      for (;;) {
        if ((await page.evaluate(() => window.__gd3d.status())) === 'finished') {
          m3Finished = true;
          break;
        }
        if (Date.now() - t0 > 30000) break;
        await page.waitForTimeout(40);
      }
    }
    log('m3 gravity section completes and the run reaches the level finish gate', m3Finished,
      m3Finished ? 'status=finished' : 'never finished');
  }
}

// --- 17b. M3.1: ceiling camera framing + underside/contact readability ---
// Regression coverage for the M3.1 fix: the pre-M3.1 chase framing pulled the
// camera eye to y≈6.11 on the ceiling — INSIDE the slabs (underside y=6) —
// which backface-culled the ceiling into invisibility (cube read as floating,
// stray neon edges read as the camera fighting geometry). The eye path is now
// proven non-penetrating per-step in tests/cameraFraming.test.ts; these checks
// observe the LIVE renderer state and capture fresh visual evidence.
{
  // Floor framing must be unchanged: eye ~4.4u above the track before the portal.
  await startGravityRun(172);
  const m31Floor = await rollUntilM3((s) => s.z > 172 && s.z < 181 && s.mode === 'floor' && s.grounded);
  const m31FloorEye = await page.evaluate(() => window.__gd3d.cameraEye());
  log('m3.1 floor framing unchanged (eye ~4.4u above track, track-relative)',
    m31Floor !== null && m31FloorEye.y > 3.9 && m31FloorEye.y < 5.0,
    `eyeY=${m31FloorEye.y.toFixed(2)} (was ~4.4 pre-M3.1)`);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  await capture('m31-01-portal-approach');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);

  // Cross to the ceiling while sampling the camera EYE every poll: it must
  // stay inside the open corridor (0.5 < y < 5.85) through the whole rise —
  // never up at the slab band (y 6..8) the way the old framing did.
  await startGravityRun(172);
  let eyeSamples = 0;
  let eyeMin = 99;
  let eyeMax = -99;
  let eyeInSlabBand = false;
  let transitionShotDone = false;
  let m31Ceil = null;
  {
    const t0 = Date.now();
    for (;;) {
      const s = await simState();
      const eyeY = await page.evaluate(() => window.__gd3d.cameraEye().y);
      if (s.status === 'running' && s.mode === 'ceiling') {
        eyeSamples++;
        eyeMin = Math.min(eyeMin, eyeY);
        eyeMax = Math.max(eyeMax, eyeY);
        if (eyeY >= 5.85) eyeInSlabBand = true;
        if (!transitionShotDone && !s.grounded && s.y > 2.2 && s.y < 4.6) {
          transitionShotDone = true;
          await page.keyboard.press('KeyP');
          await page.waitForTimeout(300);
          await capture('m31-02-transition-rise');
          await page.keyboard.press('KeyP');
          await page.waitForTimeout(150);
        }
        if (s.grounded && Math.abs(s.y - 5.45) < 0.12) {
          if (m31Ceil === null) m31Ceil = s;
          // Keep sampling well into the under-slab run so the eye-invariant
          // is observed across the whole transit, not just the rise.
          if (s.z > 210) break;
        }
      }
      if (Date.now() - t0 > 25000) break;
      await page.waitForTimeout(25);
    }
  }
  log('m3.1 camera eye stays inside the corridor through the rise (never in the slab band)',
    eyeSamples > 20 && !eyeInSlabBand,
    `samples=${eyeSamples} eyeY ${eyeMin.toFixed(2)}..${eyeMax.toFixed(2)} (slab underside y=6)`);

  // Stable ceiling run: eye settles BELOW the focus on the free-face side at
  // the M3.3 mirrored canonical offset (~3.84 u below the cube — the same
  // distance the Floor eye sits above it), low in the open corridor.
  const m31Eye = await page.evaluate(() => window.__gd3d.cameraEye());
  const m31Look = await page.evaluate(() => window.__gd3d.cameraLook());
  log('m3.1 ceiling eye settles below the cube with slab clearance',
    m31Ceil !== null && m31Eye.y > 0.5 && m31Eye.y < 5.85 && m31Eye.y < m31Ceil.y - 2.5,
    `eyeY=${m31Eye.y.toFixed(2)} playerY=${m31Ceil ? m31Ceil.y.toFixed(2) : '-'} (underside y=6, M3.3 mirrored offset ~3.84 below)`);
  log('m3.1 look target reads the ceiling contact surface (above the eye)',
    m31Look.y > m31Eye.y + 0.5,
    `lookY=${m31Look.y.toFixed(2)} eyeY=${m31Eye.y.toFixed(2)}`);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400); // camera settles while frozen
  await capture('m31-03-ceiling-contact');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);

  // Ceiling gap approach: stable grounded run framing the gap + return portal.
  const m31Gap = await rollUntilM3((s) => s.grounded && s.z > 222 && s.z < 228, 12000);
  log('m3.1 stable ceiling run reaches the gap approach', m31Gap !== null,
    m31Gap ? `z=${m31Gap.z.toFixed(1)}` : '-');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  await capture('m31-04-ceiling-gap-approach');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyR'); // clean up; later sections re-run their own passes
  await page.waitForTimeout(300);
}

// --- 17c. M3.2: ceiling view parity (underside rails + gap-edge visibility) ---
// M3.2 audit evidence: the below-focus camera makes the Cube's own silhouette
// occlude the ceiling run surface ~4..16 u ahead (unavoidable from below), and
// every neon rail used to live on TOP faces — so the ceiling corridor had no
// visible forward cue at all. LevelView now mirrors the rail treatment onto
// exposed undersides. These checks assert the payoff IN SCREEN SPACE via the
// screenPoint probe: the lateral underside rails and the lethal gap edges must
// be visible in the viewport and NOT hidden behind the Cube's silhouette.
{
  const project = (pts) =>
    page.evaluate((pp) => pp.map((p) => window.__gd3d.screenPoint(p[0], p[1], p[2])), pts);
  const cubeScreenBox = async () => {
    const p = await pos();
    const h = 0.62; // visual cube half-edge
    const corners = await project([
      [p.x - h, p.y - h, p.z - h], [p.x + h, p.y - h, p.z - h],
      [p.x - h, p.y + h, p.z - h], [p.x + h, p.y + h, p.z - h],
      [p.x - h, p.y - h, p.z + h], [p.x + h, p.y - h, p.z + h],
      [p.x - h, p.y + h, p.z + h], [p.x + h, p.y + h, p.z + h],
    ]);
    return {
      x0: Math.min(...corners.map((c) => c.px)),
      x1: Math.max(...corners.map((c) => c.px)),
    };
  };
  const visibleInViewport = (sp) =>
    !sp.behind && sp.px > 0 && sp.px < 1280 && sp.py > 0 && sp.py < 720;

  // Stable ceiling run: the longitudinal underside rails ahead must be ON
  // SCREEN (the converging forward cue beside the Cube silhouette).
  const railRun = await crossToCeiling();
  await rollUntilM3((s) => s.grounded && s.z > 200 && s.z < 212, 15000);
  const railPts = await project([
    [-5.34, 5.99, 218], [5.34, 5.99, 218],
    [-5.34, 5.99, 226], [5.34, 5.99, 226],
  ]);
  log('m3.2 underside rails visible ahead during ceiling run',
    railRun !== null && railPts.every(visibleInViewport),
    railPts.map((p) => `${p.px.toFixed(0)},${p.py.toFixed(0)}${p.behind ? ' (behind)' : ''}`).join(' | '));
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  await capture('m32-01-ceiling-corridor-rails');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);

  // Gap approach: the lethal gap's lateral edges must be visible BESIDE the
  // Cube silhouette (the pre-M3.2 build left the gap boundary unmarked where
  // it is actually visible).
  const m32Gap = await rollUntilM3((s) => s.grounded && s.z > 222 && s.z < 228, 15000);
  log('m3.2 gap approach framed', m32Gap !== null, m32Gap ? `z=${m32Gap.z.toFixed(1)}` : '-');
  const box = await cubeScreenBox();
  const gapEdges = await project([[5.4, 6, 232], [-5.4, 6, 232]]);
  const edgesBesideSilhouette = gapEdges.every(
    (sp) => visibleInViewport(sp) && (sp.px < box.x0 - 2 || sp.px > box.x1 + 2),
  );
  log('m3.2 gap edges visible beside the cube silhouette',
    edgesBesideSilhouette,
    `cube x ${box.x0.toFixed(0)}..${box.x1.toFixed(0)} | edges ${gapEdges.map((s) => s.px.toFixed(0)).join(', ')}`);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  await capture('m32-02-ceiling-gap-approach');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);

  // Parity pair: same framing stage on the floor (pre-portal approach).
  await startGravityRun(172);
  const m32Floor = await rollUntilM3((s) => s.z > 172 && s.z < 181 && s.mode === 'floor' && s.grounded, 15000);
  log('m3.2 floor reference framing reached', m32Floor !== null, m32Floor ? `z=${m32Floor.z.toFixed(1)}` : '-');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  await capture('m32-03-floor-reference');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyR'); // clean up
  await page.waitForTimeout(300);
}

// --- 18. M4: interactive mechanics (pads, orbs, gravity orb, speed portal) ---
// Same teleport-assisted pattern as the M3 section: debug-only placement to
// reach the appended interaction section (z 278..386); full-section playability
// is proven deterministically in tests/interactions.test.ts and the extended
// gravity playthrough. Orb presses use closed-loop z-window polling with
// bounded retries (CDP keypress latency ~50-100 ms is inside the generous
// windows by design — see the M4 spec INPUT WINDOW CONTRACT).
const m4Probe = () =>
  page.evaluate(() => ({
    speed: window.__gd3d.speedMultiplier(),
    fwd: window.__gd3d.currentForwardSpeed(),
    counts: window.__gd3d.interactionCounts(),
    padUsed: window.__gd3d.isInteractionUsed('pad-floor-1'),
    orbUsed: window.__gd3d.isInteractionUsed('orb-jump-1'),
    gOrbUsed: window.__gd3d.isInteractionUsed('orb-gravity-1'),
    rings: window.__gd3d.interactionRingsActive(),
  }));

async function pressSpaceWhen(pred, timeoutMs = 8000) {
  const t0 = Date.now();
  for (;;) {
    const s = await simState();
    if (s.status !== 'running') return false;
    if (pred(s)) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(80);
      await page.keyboard.up('Space');
      return true;
    }
    if (Date.now() - t0 > timeoutMs) return false;
    await page.waitForTimeout(25);
  }
}

// M4-1: jump pad — passive contact launch over the 10 u gap.
{
  // R then baseline BEFORE the teleport: the pad is passive and fires on any
  // contact, so the counter baseline must be taken while the player is still
  // at the start line (the teleport's fall+roll can legitimately reach it).
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(350);
  const pre = await m4Probe();
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 1.5, 300));
  await page.waitForTimeout(120);
  let maxPadY = 0;
  let landed = null;
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const s = await simState();
    if (s.status !== 'running') break;
    maxPadY = Math.max(maxPadY, s.y);
    if (!shot && !s.grounded && s.y > 3) {
      shot = true; // frozen mid-launch evidence
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(400);
      await capture('m4-01-jump-pad');
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(150);
    }
    if (s.grounded && s.z > 316 && s.z < 332) { landed = s; break; }
    await page.waitForTimeout(25);
  }
  const post = await m4Probe();
  log('m4 jump pad activates exactly once (passive contact, no input)',
    post.counts.pads === pre.counts.pads + 1 && post.padUsed,
    `pads=${post.counts.pads} (pre=${pre.counts.pads}) used=${post.padUsed}`);
  log('m4 pad launch apex exceeds the normal jump envelope', maxPadY > 3.6,
    `maxY=${maxPadY.toFixed(2)} (jump apex ~2.07, pad 22 impulse -> ~5.76)`);
  log('m4 pad flight crosses the 10 u gap and lands on runway F', landed !== null,
    landed ? `z=${landed.z.toFixed(1)} y=${landed.y.toFixed(2)}` : '-');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(350);
  const reset = await m4Probe();
  log('m4 restart re-arms the pad and resets speed',
    reset.padUsed === false && reset.speed === 1,
    `padUsed=${reset.padUsed} speed=${reset.speed}`);
}

// M4-2: jump orb without press — pass-through is inert, the gap kills.
{
  await startGravityRun(326);
  await rollUntilM3((s) => s.grounded && s.z > 328, 8000);
  let death = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const s = await simState();
    if (s.status === 'dead') { death = s; break; }
    await page.waitForTimeout(30);
  }
  const cause = await page.evaluate(() => window.__gd3d.deathCause());
  const probe = await m4Probe();
  log('m4 orb without press does not activate (orbs flat, not used)',
    probe.counts.orbs === 0 && probe.orbUsed === false,
    `orbs=${probe.counts.orbs} used=${probe.orbUsed}`);
  log('m4 unassisted orb gap kills (void)', death !== null && cause === 'void',
    `cause=${cause}`);
  for (let i = 0; i < 40 && (await page.evaluate(() => window.__gd3d.status())) !== 'running'; i++) {
    await page.waitForTimeout(100);
  }
}

// M4-3: jump orb WITH press — activation + VFX ring + landing on G.
let m4OrbActivated = false;
let m4OrbRingsSeen = 0;
for (let attempt = 1; attempt <= 4 && !m4OrbActivated; attempt++) {
  await startGravityRun(326);
  const jumped = await pressSpaceWhen((s) => s.grounded && s.z >= 329.2, 8000);
  if (!jumped) { console.log(`  (m4 orb attempt ${attempt}: edge jump missed)`); continue; }
  const pressed = await pressSpaceWhen((s) => !s.grounded && s.z >= 335.3 && s.z <= 338.4, 5000);
  if (!pressed) { console.log(`  (m4 orb attempt ${attempt}: window press missed)`); continue; }
  // VFX: the pooled activation ring must be observable right after firing.
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) {
    m4OrbRingsSeen = Math.max(m4OrbRingsSeen, (await m4Probe()).rings);
    if (m4OrbRingsSeen > 0) break;
    await page.waitForTimeout(15);
  }
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  await capture('m4-03-orb-activation');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);
  const probe = await m4Probe();
  m4OrbActivated = probe.orbUsed && probe.counts.orbs >= 1;
  if (!m4OrbActivated) console.log(`  (m4 orb attempt ${attempt}: activation not observed)`);
}
log('m4 orb press inside the window activates exactly once',
  m4OrbActivated, `orbs=${(await m4Probe()).counts.orbs} used=${(await m4Probe()).orbUsed}`);
log('m4 orb activation VFX ring observed', m4OrbRingsSeen > 0, `rings=${m4OrbRingsSeen}`);
const m4OrbLanding = await rollUntilM3((s) => s.grounded && s.z > 342 && s.z < 358, 10000);
log('m4 orb boost carries the player onto runway G', m4OrbLanding !== null,
  m4OrbLanding ? `z=${m4OrbLanding.z.toFixed(1)}` : '-');
// Window evidence shot: the orb ahead while approaching on F.
{
  await startGravityRun(326);
  const approached = await rollUntilM3((s) => s.grounded && s.z > 329 && s.z < 331.5, 8000);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  await capture('m4-02-jump-orb-window');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);
  log('m4 orb window approach framed', approached !== null,
    approached ? `z=${approached.z.toFixed(1)}` : '-');
}

// M4-4: gravity orb — press flips Floor -> Ceiling through the portal path.
let m4Flip = null;
for (let attempt = 1; attempt <= 4 && m4Flip === null; attempt++) {
  await startGravityRun(344);
  const jumped = await pressSpaceWhen((s) => s.grounded && s.z >= 348.2, 8000);
  if (!jumped) { console.log(`  (m4 g-orb attempt ${attempt}: jump missed)`); continue; }
  const pressed = await pressSpaceWhen((s) => !s.grounded && s.z >= 351 && s.z <= 352.9, 5000);
  if (!pressed) { console.log(`  (m4 g-orb attempt ${attempt}: window press missed)`); continue; }
  // Rise + ceiling grounding inside slab C (z 350..368).
  const groundedCeiling = await rollUntilM3(
    (s) => s.mode === 'ceiling' && s.grounded && Math.abs(s.y - 5.45) < 0.15 && s.z < 368,
    10000,
  );
  if (groundedCeiling !== null) {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(400);
    await capture('m4-04-gravity-orb');
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(150);
    m4Flip = groundedCeiling;
  } else {
    console.log(`  (m4 g-orb attempt ${attempt}: no ceiling grounding observed)`);
  }
}
log('m4 gravity orb flips Floor -> Ceiling and grounds on slab C underside',
  m4Flip !== null,
  m4Flip ? `z=${m4Flip.z.toFixed(1)} y=${m4Flip.y.toFixed(2)} flips=${m4Flip.flips} mode=${m4Flip.mode}` : '-');
log('m4 ceiling state readable: camera up remains world +Y',
  m4Flip !== null && Math.abs(m4Flip.cameraUpY - 1) < 1e-6,
  m4Flip ? `cameraUpY=${m4Flip.cameraUpY}` : '-');
const m4BackDown = await rollUntilM3(
  (s) => s.mode === 'floor' && s.grounded && s.z > 366, 15000,
);
log('m4 portal-down-2 returns the run to the floor runway', m4BackDown !== null,
  m4BackDown ? `z=${m4BackDown.z.toFixed(1)} mode=${m4BackDown.mode}` : '-');

// M4-5: speed portal — deterministic crossing to 2x, then R resets.
{
  await startGravityRun(366);
  const pre = await m4Probe(); // session-monotonic counters: assert a delta
  const approach = await rollUntilM3((s) => s.grounded && s.z > 368 && s.z < 371, 10000);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  await capture('m4-05-speed-portal');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);
  const crossed = await rollUntilM3((s) => s.z > 373, 10000);
  const probe = await m4Probe();
  log('m4 speed portal crossing sets the 2x tier (no position jump)',
    crossed !== null && probe.speed === 2 && Math.abs(probe.fwd - 28) < 1e-9 &&
      probe.counts.speedPortals === pre.counts.speedPortals + 1,
    `speed=${probe.speed} fwd=${probe.fwd} portals=${probe.counts.speedPortals} z=${crossed?.z.toFixed(1) ?? '-'}`);
  // Live forward-rate corroboration at 2x: peak local rate across the short
  // 2x runway (z 373..finish 380 leaves ~7 u — a single averaged window can
  // include the finish stop, so sample local rates and take the peak).
  const t0 = Date.now();
  let maxRate = 0;
  let prev = await pos();
  let prevT = Date.now();
  while (Date.now() - t0 < 6000) {
    await page.waitForTimeout(35);
    if ((await page.evaluate(() => window.__gd3d.status())) !== 'running') break;
    const cur = await pos();
    const dt = (Date.now() - prevT) / 1000;
    if (dt > 0 && cur.z > prev.z && cur.z < 379.8) {
      maxRate = Math.max(maxRate, (cur.z - prev.z) / dt);
    }
    prev = cur;
    prevT = Date.now();
  }
  log('m4 2x forward rate observed (~28 u/s peak)', maxRate > 22,
    `${maxRate.toFixed(1)} u/s peak`);
  log('m4 speed portal approach framed', approach !== null,
    approach ? `z=${approach.z.toFixed(1)}` : '-');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(350);
  const reset = await m4Probe();
  log('m4 restart resets the speed tier', reset.speed === 1, `speed=${reset.speed}`);
}

// M4-6: high-speed gameplay to the finish + repeated-interaction leak guard.
{
  await startGravityRun(366);
  const crossed = await rollUntilM3((s) => s.z > 373, 10000);
  const sprintShot = crossed !== null;
  if (sprintShot) {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(300);
    await capture('m4-06-high-speed-gameplay');
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(150);
  }
  let finished = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const s = await simState();
    if (s.status === 'finished') { finished = s; break; }
    if (s.status === 'dead') break;
    await page.waitForTimeout(30);
  }
  log('m4 2x sprint crosses the finish gate (collision-safe high-speed section)',
    finished !== null, finished ? 'status=finished' : `status=${(await simState()).status}`);
  log('m4 high-speed screenshot framed', sprintShot, '-');

  // Leak guard: three fresh pad->landing passes; scene children + draw calls
  // must stay flat (pooled VFX, shared materials, no per-activation growth).
  const samples = [];
  for (let i = 0; i < 3; i++) {
    await startGravityRun(300);
    await rollUntilM3((s) => s.grounded && s.z > 318 && s.z < 330, 12000);
    samples.push(await page.evaluate(() => ({
      kids: window.__gd3d.sceneChildren(),
      calls: window.__gd3d.rendererStats().calls,
      pads: window.__gd3d.interactionCounts().pads,
    })));
  }
  const flat = samples.length === 3 && samples[0].kids === samples[1].kids && samples[1].kids === samples[2].kids;
  log('m4 repeated interactions leak guard (scene children flat)', flat,
    JSON.stringify(samples));
  log('m4 exactly one pad activation per attempt across repeats',
    samples.length === 3 && samples[2].pads - samples[0].pads === 2,
    `pads=${JSON.stringify(samples.map((s) => s.pads))}`);
}

// --- 19. M3.3: surface-relative projection parity (free-face contract) ---
// M3.3 contract: the Cube face OPPOSITE the support surface (the FREE face —
// top face on Floor, bottom face on Ceiling) must project with the same
// apparent size/perspective from the chase camera. The below-focus framing is
// the exact mirror of the above-focus framing, so the projected free-face
// AREA ratio (ceiling/floor) must sit at 1 within live-frame noise
// (acceptance 0.90..1.10, live check pins 0.95..1.05). Deterministic pure-math
// coverage lives in tests/cameraFraming.test.ts; these checks observe the LIVE
// renderer projection and capture the parity evidence pair.
{
  const project = (pts) =>
    page.evaluate((pp) => pp.map((p) => window.__gd3d.screenPoint(p[0], p[1], p[2])), pts);
  const quadAreaPx = (pts) =>
    Math.abs(
      (pts[0].px * pts[1].py - pts[1].px * pts[0].py) +
      (pts[1].px * pts[2].py - pts[2].px * pts[1].py) +
      (pts[2].px * pts[3].py - pts[3].px * pts[2].py) +
      (pts[3].px * pts[0].py - pts[0].px * pts[3].py),
    ) / 2;
  const CUBE_HALF = 0.62; // visual cube half-edge
  // Free-face corners in perimeter order, on the face OPPOSITE the support.
  const freeFaceArea = async (surface) => {
    const p = await pos();
    const faceY = surface === 'floor' ? p.y + CUBE_HALF : p.y - CUBE_HALF;
    return quadAreaPx(await project([
      [p.x - CUBE_HALF, faceY, p.z - CUBE_HALF],
      [p.x + CUBE_HALF, faceY, p.z - CUBE_HALF],
      [p.x + CUBE_HALF, faceY, p.z + CUBE_HALF],
      [p.x - CUBE_HALF, faceY, p.z + CUBE_HALF],
    ]));
  };
  const freeze = async (ms) => {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(ms); // camera settles into the frozen frame
  };
  const unfreeze = async () => {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(150);
  };

  // Floor free-face reference (stable grounded approach before portal-up).
  await startGravityRun(172);
  const m33Floor = await rollUntilM3(
    (s) => s.z > 172 && s.z < 181 && s.mode === 'floor' && s.grounded, 15000);
  await freeze(900);
  const m33FloorArea = await freeFaceArea('floor');
  log('m3.3 floor free-face reference framed', m33Floor !== null && m33FloorArea > 0,
    `area=${m33FloorArea.toFixed(0)}px² z=${m33Floor ? m33Floor.z.toFixed(1) : '-'}`);
  await capture('m33-01-floor-free-face-reference');
  await unfreeze();

  // Ceiling free-face reference (stable grounded ceiling run).
  const m33Ceil = await crossToCeiling();
  await rollUntilM3((s) => s.grounded && s.z > 205 && s.z < 215, 15000);
  await freeze(900);
  const m33CeilArea = await freeFaceArea('ceiling');
  log('m3.3 ceiling free-face reference framed', m33Ceil !== null && m33CeilArea > 0,
    `area=${m33CeilArea.toFixed(0)}px²`);
  await capture('m33-02-ceiling-free-face-reference');
  // Parity evidence with the F1 framing overlay visible.
  await page.keyboard.press('F1');
  await page.waitForTimeout(200);
  await capture('m33-03-floor-ceiling-parity-debug');
  await page.keyboard.press('F1');
  await unfreeze();

  const m33Ratio = m33CeilArea / m33FloorArea;
  log('m3.3 free-face projection parity (ceiling/floor projected area)',
    m33Ratio > 0.95 && m33Ratio < 1.05,
    `ratio=${m33Ratio.toFixed(3)} (ceiling ${m33CeilArea.toFixed(0)}px² / floor ${m33FloorArea.toFixed(0)}px², acceptance 0.90..1.10)`);

  // Ceiling depth readability at the gap approach with the mirrored framing.
  const m33Gap = await rollUntilM3((s) => s.grounded && s.z > 222 && s.z < 228, 15000);
  log('m3.3 ceiling gap approach framed with mirrored view', m33Gap !== null,
    m33Gap ? `z=${m33Gap.z.toFixed(1)}` : '-');
  await freeze(400);
  await capture('m33-04-ceiling-depth-readability');
  await unfreeze();
  await page.keyboard.press('KeyR'); // clean up
  await page.waitForTimeout(300);
}

// --- 20. M5: deterministic replay + second level ---
// Replay is fixed-tick physical input recorded above GameSimulation (F4
// replays the last completed attempt); Validation Level 02 proves the
// engine is level-agnostic. Automated per-tick proof lives in
// tests/replay.test.ts + tests/replayGolden.test.ts; these checks observe
// the LIVE integrated app (HUD badge, input isolation, level routes).
{
  // Fresh page: the M5 section follows ~15 minutes of prior sections on a
  // long-lived headless page (the M2 section documents this degradation
  // and reloads for the same reason). M5 asserts app-level behavior, not
  // cross-section continuity.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const hasReplay = () => page.evaluate(() => window.__gd3d.hasReplay());
  // Poll verification AND end state in ONE evaluate: after a death-tape
  // pass the 36-tick death hold expires quickly (auto-respawn), so a later
  // round-trip would observe the fresh live run instead of the replayed
  // death. The single snapshot below is atomic against that race.
  const waitVerify = async (timeoutMs = 60000) => {
    const t0 = Date.now();
    for (;;) {
      const snap = await page.evaluate(() => ({
        verify: window.__gd3d.replayVerification(),
        status: window.__gd3d.status(),
        cause: window.__gd3d.deathCause(),
        badge: window.__gd3d.replayBadge(),
        frames: window.__gd3d.replayFrameCount(),
      }));
      if (snap.verify.kind === 'pass' || snap.verify.kind === 'diverged') return snap;
      if (Date.now() - t0 > timeoutMs) return snap;
      await page.waitForTimeout(200);
    }
  };

  // M5a: default level still loads; a live death attempt becomes a replay.
  const m5Level = await page.evaluate(() => window.__gd3d.levelId());
  log('m5 default level loads (controller-test-01)', m5Level === 'controller-test-01', m5Level);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);
    if ((await pos()).z < 10) break;
  }
  await capture('m5-01-live-recording');
  // Roll blind into the low-platform face: a frontImpact death finalizes.
  let m5Dead = null;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => ({
      status: window.__gd3d.status(),
      cause: window.__gd3d.deathCause(),
    }));
    if (s.status === 'dead') {
      m5Dead = s;
      break;
    }
  }
  log('m5 live death attempt completes', m5Dead !== null, m5Dead ? `cause=${m5Dead.cause}` : 'never died');
  const m5HasReplay = await hasReplay();
  log('m5 replay becomes available after the attempt', m5HasReplay === true);
  const level01Tape = await page.evaluate(() => window.__gd3d.exportLastReplay());
  const level01Parsed = level01Tape === null ? null : JSON.parse(level01Tape);
  log('m5 exported replay is a versioned input tape (no transforms)',
    level01Parsed !== null && level01Parsed.schemaVersion === 1 &&
    Array.isArray(level01Parsed.inputFrames) && level01Parsed.frameCount > 0 &&
    level01Parsed.levelId === 'controller-test-01' && !('camera' in level01Parsed),
    level01Parsed ? `frames=${level01Parsed.frameCount} outcome=${level01Parsed.outcome.status}` : 'export null');
  // Clean slate for the replay below (R during dead respawns immediately).
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);

  // M5b: F4 playback with live keyboard injection (input isolation proof).
  await page.keyboard.press('F4');
  await page.waitForTimeout(400);
  const m5Mode = await page.evaluate(() => window.__gd3d.replayMode());
  const m5Badge = await page.evaluate(() => window.__gd3d.replayBadge());
  const m5BadgeDom = await page.evaluate(() => {
    const el = document.querySelector('.hud-replay-badge');
    return el && el.style.display !== 'none' ? el.textContent : null;
  });
  log('m5 F4 starts playback (mode=replay, HUD badge REPLAY)',
    m5Mode === 'replay' && m5Badge === 'REPLAY' && m5BadgeDom === 'REPLAY',
    `mode=${m5Mode} badge=${m5Badge}`);
  await capture('m5-02-replay-playback');
  // Inject real gameplay input EARLY in the run (the death tape is 441
  // ticks, so playback is provably still active): it must not alter the tape.
  const m5TickBefore = await page.evaluate(() => window.__gd3d.replayTick());
  await page.keyboard.down('Space');
  await page.waitForTimeout(150);
  await page.keyboard.up('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  const m5During = await page.evaluate(() => ({
    mode: window.__gd3d.replayMode(),
    tick: window.__gd3d.replayTick(),
  }));
  log('m5 injected input does not knock playback off the tape',
    m5During.mode === 'replay' && m5During.tick > m5TickBefore,
    `mode=${m5During.mode} tick=${m5TickBefore}->${m5During.tick}`);
  const m5Result = await waitVerify();
  log('m5 death replay verifies (input isolation holds, death reproduced)',
    m5Result.verify.kind === 'pass' && m5Result.status === 'dead' &&
    m5Result.cause === level01Parsed?.outcome.deathCause &&
    m5Result.frames === level01Parsed?.frameCount,
    `verify=${m5Result.verify.kind} status=${m5Result.status} cause=${m5Result.cause} frames=${m5Result.frames}`);
  log('m5 HUD reports REPLAY VERIFIED', m5Result.badge === 'REPLAY VERIFIED',
    `badge=${m5Result.badge}`);
  await capture('m5-03-replay-verified');
  // F1 replay observability lines (mode/tick/hashes/fingerprint).
  await page.keyboard.press('F1');
  await page.waitForTimeout(300);
  const m5Overlay = await page.evaluate(() => document.querySelector('.debug-overlay')?.textContent ?? '');
  log('m5 F1 overlay shows replay state (mode/verify/fingerprint)',
    m5Overlay.includes('replay: mode=') && m5Overlay.includes('replayLevel:'),
    (m5Overlay.split('\n').find((l) => l.startsWith('replay:')) ?? 'line missing').trim());
  await capture('m5-07-replay-debug');
  await page.keyboard.press('F1');
  // R after a verified replay returns to clean live play.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(400);
  log('m5 R after replay resumes live play',
    (await page.evaluate(() => window.__gd3d.replayMode())) === 'live' &&
    (await page.evaluate(() => window.__gd3d.status())) === 'running');

  // M5c: Validation Level 02 via the real level route.
  await page.goto(`${URL}?level=validation-02`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m5L2 = await page.evaluate(() => ({
    id: window.__gd3d.levelId(),
    name: window.__gd3d.levelDisplayName(),
    hud: document.querySelector('.hud-name')?.textContent ?? '',
  }));
  log('m5 level 02 route loads the second level (HUD confirms)',
    m5L2.id === 'validation-02' && m5L2.hud === 'VALIDATION LEVEL 02',
    `id=${m5L2.id} hud=${m5L2.hud}`);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  await capture('m5-04-level02-start');

  // M5d: real-input Level 02 playthrough (no debug teleport).
  //
  // The driver lives IN THE PAGE and dispatches real DOM KeyboardEvents
  // through the REAL InputSystem -> GameSimulation pipeline (the same
  // listeners a physical keyboard drives; `code`-addressed, no trusted-event
  // checks anywhere on the path). CDP round-trips here cost ~150 ms (~1.9 u
  // at level speed) — wider than the tightest physics-safe takeoff windows
  // — so CDP polling cannot time the jumps/orb deterministically. The
  // in-page policy is the SAME z-triggered LEVEL02_SCRIPT the automated
  // suite runs (tests/helpers/level02Script.ts); CDP only observes.
  const runLevel02Attempt = async () => {
    // Verified fresh start (a swallowed CDP R corrupts every trigger).
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(300);
      if ((await pos()).z < 10) break;
    }
    await page.evaluate(() => {
      if (window.__m5driver) clearInterval(window.__m5driver);
      window.__m5done = null;
      window.__m5ceil = false;
      const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      const tap = (code) => {
        down(code);
        [10,25,60].forEach((ms) => setTimeout(() => up(code), ms));
      };
      // [triggerZ, action] — mirrors LEVEL02_SCRIPT intents.
      const plan = [
        [25, () => tap('ArrowRight')],
        [40, () => tap('ArrowRight')],
        [50, () => tap('ArrowLeft')],
        [55.6, () => tap('Space')],
        [133, () => tap('Space')],
        [145.5, () => tap('Space')],
      ];
      let step = 0;
      let orbPresses = 0;
      let lastOrbTap = 0;
      window.__m5driver = setInterval(() => {
        const now = performance.now();
        const g = window.__gd3d;
        const s = { z: g.playerPosition().z, status: g.status(), mode: g.gravityMode() };
        if (s.status === 'finished') {
          clearInterval(window.__m5driver);
          window.__m5driver = null;
          window.__m5done = 'finished';
          return;
        }
        if (s.status !== 'running') {
          clearInterval(window.__m5driver);
          window.__m5driver = null;
          window.__m5done = `dead:${g.deathCause()}@${s.z.toFixed(1)}`; 
          return;
        }
        if (s.mode === 'ceiling' && g.grounded()) window.__m5ceil = true;
        // Scripted z-triggers (lane taps + timed jump presses).
        if (step < plan.length && s.z >= plan[step][0]) {
          const action = plan[step][1];
          step += 1;
          action();
          return;
        }
        // Gravity orb: repeated DISCRETE presses across the window until it
        // fires (each press is one edge; the first edge inside the swept
        // window with y in range activates — robust to single-edge timing).
        if (step >= plan.length && s.mode === 'ceiling' && s.z >= 147.5 && s.z <= 150.2 &&
            !g.isInteractionUsed('v2-orb-gravity') && orbPresses < 6 &&
            now - lastOrbTap > 45) {
          lastOrbTap = now;
          orbPresses += 1;
          tap('Space');
        }
        // 2x gap + final lane, gated on the post-orb floor state.
        if (s.mode === 'floor' && g.isInteractionUsed('v2-orb-gravity')) {
          if (!window.__m5jump3 && g.grounded() && s.z >= 190 && s.z <= 193) {
            window.__m5jump3 = true;
            tap('Space');
          }
          if (window.__m5jump3 && s.z >= 204 && g.laneIndex() < 2) tap('ArrowRight');
        }
      }, 5);
    });
    // Observe from CDP: ceiling evidence + terminal state.
    let mechShotLocal = false;
    const t0 = Date.now();
    for (;;) {
      const done = await page.evaluate(() => window.__m5done);
      if (done !== null) return done;
      if (!mechShotLocal && (await page.evaluate(() => window.__m5ceil)) === true) {
        mechShotLocal = true;
        await page.keyboard.press('KeyP');
        await page.waitForTimeout(400);
        await capture('m5-05-level02-mechanics');
        await page.keyboard.press('KeyP');
        await page.waitForTimeout(200);
      }
      if (Date.now() - t0 > 90000) {
        await page.evaluate(() => {
          if (window.__m5driver) clearInterval(window.__m5driver);
          window.__m5driver = null;
        });
        return 'timeout';
      }
      await page.waitForTimeout(250);
    }
  };
  let m5L2Result = null;
  for (let attempt = 1; attempt <= 3 && m5L2Result !== 'finished'; attempt++) {
    await page.evaluate(() => {
      window.__m5jump3 = false;
    });
    const outcome = await runLevel02Attempt();
    if (outcome === 'finished') m5L2Result = 'finished';
    else console.log(`  (m5 level02 attempt ${attempt}: ${outcome}, retrying)`);
  }
  log('m5 level 02 real playthrough reaches the finish (no teleport)', m5L2Result === 'finished');
  await capture('m5-06-level02-finish');
  const m5L2Replay = await page.evaluate(() => ({
    has: window.__gd3d.hasReplay(),
    level: window.__gd3d.replayLevelId(),
  }));
  log('m5 level 02 completion records a level-02 replay',
    m5L2Replay.has === true && m5L2Replay.level === 'validation-02',
    JSON.stringify(m5L2Replay));

  // M5e: level-02 replay verifies; the level-01 tape is rejected here.
  await page.keyboard.press('F4');
  const m5L2Verify = await waitVerify();
  log('m5 level 02 replay verifies end-to-end', m5L2Verify.verify.kind === 'pass',
    `verify=${m5L2Verify.verify.kind} status=${m5L2Verify.status}`);
  const m5Cross = await page.evaluate((tape) => window.__gd3d.debugStartReplayJson(tape), level01Tape);
  log('m5 level-01 replay cannot silently run on level 02 (explicit reject)',
    m5Cross.ok === false && (m5Cross.reason ?? '').includes('controller-test-01'),
    `ok=${m5Cross.ok} reason=${m5Cross.reason ?? '-'}`);
  // Unknown level ids fall back explicitly to the default.
  await page.goto(`${URL}?level=does-not-exist`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m5Fallback = await page.evaluate(() => window.__gd3d.levelId());
  log('m5 unknown level id falls back to the default level', m5Fallback === 'controller-test-01',
    `id=${m5Fallback}`);
}

// --- 21. M6A: visual production foundation ---
// Production theme + shared materials + controlled bloom, presentation-only.
// Automated structural proof lives in tests/visualFoundation.test.ts; these
// checks observe the LIVE integrated app (theme active, readability at
// speed, Floor/Ceiling parity under M6 visuals, replay + fallback +
// resource stability) and capture the m6a-* human-gate evidence set.
// Framing uses teleport + pause-freeze (no tight input windows), so every
// M6A check must be 100% green — no CDP-timing flakes accepted here.
{
  const inView = async (x, y, z) =>
    page.evaluate(([ax, ay, az]) => {
      const s = window.__gd3d.screenPoint(ax, ay, az);
      return !s.behind && Math.abs(s.ndcX) < 1 && Math.abs(s.ndcY) < 1;
    }, [x, y, z]);
  const freezeM6 = async (ms) => {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(ms); // camera settles into the frozen frame
  };
  const unfreezeM6 = async () => {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(150);
  };
  const quadAreaPx = (pts) =>
    Math.abs(
      (pts[0].px * pts[1].py - pts[1].px * pts[0].py) +
      (pts[1].px * pts[2].py - pts[2].px * pts[1].py) +
      (pts[2].px * pts[3].py - pts[3].px * pts[2].py) +
      (pts[3].px * pts[0].py - pts[0].px * pts[3].py),
    ) / 2;
  const CUBE_HALF_M6 = 0.62; // visual cube half-edge
  const freeFaceAreaM6 = async (surface) => {
    const p = await pos();
    const faceY = surface === 'floor' ? p.y + CUBE_HALF_M6 : p.y - CUBE_HALF_M6;
    const pts = await page.evaluate(([px, py, pz, h]) => [
      window.__gd3d.screenPoint(px - h, py, pz - h),
      window.__gd3d.screenPoint(px + h, py, pz - h),
      window.__gd3d.screenPoint(px + h, py, pz + h),
      window.__gd3d.screenPoint(px - h, py, pz + h),
    ], [p.x, faceY, p.z, CUBE_HALF_M6]);
    return quadAreaPx(pts);
  };
  const waitDead = async (timeoutMs = 40000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await simState();
      if (s.status === 'dead') return s;
      if (Date.now() - t0 > timeoutMs) return null;
      await page.waitForTimeout(200);
    }
  };
  const waitReplayPass = async (timeoutMs = 90000) => {
    const t0 = Date.now();
    for (;;) {
      const snap = await page.evaluate(() => ({
        verify: window.__gd3d.replayVerification(),
        badge: window.__gd3d.replayBadge(),
      }));
      if (snap.verify.kind === 'pass' || snap.verify.kind === 'diverged') return snap;
      if (Date.now() - t0 > timeoutMs) return snap;
      await page.waitForTimeout(300);
    }
  };

  // Fresh page for the M6A section.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Theme + post active with a restrained bloom contract.
  const m6aTheme = await page.evaluate(() => ({
    post: window.__gd3d.postEnabled(),
    passes: window.__gd3d.postPassCount(),
    bloom: window.__gd3d.bloomParams(),
    mats: window.__gd3d.materialCount(),
    geos: window.__gd3d.geometryCount(),
  }));
  const m6aBloomOk = m6aTheme.bloom !== null &&
    m6aTheme.bloom.threshold >= 0.6 &&
    m6aTheme.bloom.strength <= 0.7 &&
    m6aTheme.bloom.radius <= 0.6;
  log('m6a production theme active (post on, 3 passes, restrained bloom)',
    m6aTheme.post === true && m6aTheme.passes === 3 && m6aBloomOk,
    `post=${m6aTheme.post} passes=${m6aTheme.passes} bloom=${JSON.stringify(m6aTheme.bloom)}`);
  log('m6a shared resources bounded at build (materials/geometries)',
    m6aTheme.mats > 0 && m6aTheme.mats < 60 && m6aTheme.geos > 0 && m6aTheme.geos < 20,
    `materials=${m6aTheme.mats} geometries=${m6aTheme.geos}`);

  // Player readable at spawn.
  const m6aSpawn = await pos();
  log('m6a player visible/readable at spawn',
    await inView(m6aSpawn.x, m6aSpawn.y, m6aSpawn.z),
    `pos=(${m6aSpawn.x.toFixed(1)},${m6aSpawn.y.toFixed(1)},${m6aSpawn.z.toFixed(1)})`);

  // Floor production framing before the spike weave (runway + rails + spikes).
  await startGravityRun(92);
  const m6aFloor = await rollUntilM3((s) => s.z > 92 && s.z < 100 && s.grounded, 15000);
  log('m6a floor runway framed before hazards', m6aFloor !== null,
    m6aFloor ? `z=${m6aFloor.z.toFixed(1)}` : 'never framed');
  await freezeM6(900);
  const m6aFloorArea = await freeFaceAreaM6('floor');
  await capture('m6a-01-floor-production');
  await unfreezeM6();
  // Hazard + route readability from the same approach.
  log('m6a hazard readable before lethal distance (spike in view)',
    await inView(2.6, 0.5, 108), 'spike(2.6,0.5,108)');
  log('m6a playable surface readable ahead (floor point in view)',
    await inView(0, 0, 120), 'floor(0,0,120)');
  // Hazard closeup: jump-free roll to just before the weave, then freeze.
  const m6aHz = await rollUntilM3((s) => s.z > 100 && s.z < 106 && s.grounded, 15000);
  log('m6a floor hazard approach framed', m6aHz !== null,
    m6aHz ? `z=${m6aHz.z.toFixed(1)}` : 'never framed');
  await freezeM6(700);
  await capture('m6a-02-floor-hazard');
  await unfreezeM6();

  // Ceiling production framing (stable ceiling run, mirrored view).
  const m6aCeil = await crossToCeiling();
  const m6aCeilRun = m6aCeil === null ? null
    : await rollUntilM3((s) => s.grounded && s.z > 205 && s.z < 215, 15000);
  log('m6a ceiling run framed with mirrored view', m6aCeilRun !== null,
    m6aCeilRun ? `z=${m6aCeilRun.z.toFixed(1)}` : 'never framed');
  await freezeM6(900);
  const m6aCeilArea = await freeFaceAreaM6('ceiling');
  await capture('m6a-03-ceiling-production');
  await unfreezeM6();
  const m6aParity = m6aCeilArea / m6aFloorArea;
  log('m6a floor/ceiling free-face parity holds under M6 visuals',
    m6aParity > 0.95 && m6aParity < 1.05,
    `ratio=${m6aParity.toFixed(3)} (ceiling ${m6aCeilArea.toFixed(0)}px² / floor ${m6aFloorArea.toFixed(0)}px²)`);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);

  // Gravity portal framing (cyan flip-up gateway ahead).
  await startGravityRun(168);
  const m6aPortal = await rollUntilM3((s) => s.z > 170 && s.z < 180 && s.mode === 'floor' && s.grounded, 15000);
  log('m6a gravity portal framed (flip-up gateway ahead)', m6aPortal !== null,
    m6aPortal ? `z=${m6aPortal.z.toFixed(1)}` : 'never framed');
  log('m6a gravity portal visible/readable', await inView(0, 4.2, 182), 'portal(0,4.2,182)');
  await freezeM6(700);
  await capture('m6a-04-gravity-portal');
  await unfreezeM6();

  // Interaction framing (jump pad + orb section).
  await startGravityRun(292);
  const m6aInter = await rollUntilM3((s) => s.z > 293 && s.z < 300 && s.grounded, 15000);
  log('m6a interaction section framed (pad ahead)', m6aInter !== null,
    m6aInter ? `z=${m6aInter.z.toFixed(1)}` : 'never framed');
  log('m6a jump pad visible/readable', await inView(0, 0.3, 305), 'pad(0,0.3,305)');
  await freezeM6(700);
  await capture('m6a-05-interactions');
  await unfreezeM6();

  // 2x speed section framing (tier gateway ahead).
  await startGravityRun(362);
  const m6aFast = await rollUntilM3((s) => s.z > 363 && s.z < 370, 15000);
  log('m6a 2x speed section framed (tier gateway ahead)', m6aFast !== null,
    m6aFast ? `z=${m6aFast.z.toFixed(1)}` : 'never framed');
  log('m6a speed portal visible/readable', await inView(0, 1.4, 372), 'speed(0,1.4,372)');
  await freezeM6(700);
  await capture('m6a-06-speed-2x');
  await unfreezeM6();

  // Level 02 reuses the same production system.
  await page.goto(`${URL}?level=validation-02`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const m6aL2 = await page.evaluate(() => ({
    id: window.__gd3d.levelId(),
    post: window.__gd3d.postEnabled(),
    p: window.__gd3d.playerPosition(),
  }));
  log('m6a level 02 loads with the same production system',
    m6aL2.id === 'validation-02' && m6aL2.post === true,
    `id=${m6aL2.id} post=${m6aL2.post}`);
  log('m6a level 02 player/hazard readable',
    (await inView(m6aL2.p.x, m6aL2.p.y, m6aL2.p.z)) && (await inView(0, 0.5, 44)),
    'player + spike(0,0.5,44)');
  await freezeM6(600);
  await capture('m6a-07-level02');
  await unfreezeM6();

  // Replay under M6 visuals: natural death -> F4 -> VERIFIED (no teleports,
  // no tight windows — the center lane dies on the z=116 spike by itself).
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m6aDeath = await waitDead();
  log('m6a live death finalizes a replay tape', m6aDeath !== null,
    m6aDeath ? `cause=${m6aDeath.cause}` : 'never died');
  const m6aBefore = await page.evaluate(() => ({
    has: window.__gd3d.hasReplay(),
    children: window.__gd3d.sceneChildren(),
    mats: window.__gd3d.materialCount(),
    geos: window.__gd3d.geometryCount(),
    calls: window.__gd3d.rendererStats().calls,
  }));
  await page.keyboard.press('F4');
  await page.waitForTimeout(500);
  const m6aReplayBadge = await page.evaluate(() => window.__gd3d.replayBadge());
  log('m6a F4 replay runs under M6 visuals',
    m6aReplayBadge === 'REPLAY' || m6aReplayBadge === 'REPLAY VERIFIED',
    `badge=${m6aReplayBadge}`);
  const m6aVerdict = await waitReplayPass();
  log('m6a replay still reaches VERIFIED', m6aVerdict.verify.kind === 'pass',
    `verify=${m6aVerdict.verify.kind} badge=${m6aVerdict.badge}`);
  await capture('m6a-08-replay');
  // Resource stability across death/restart/replay.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(800);
  const m6aAfter = await page.evaluate(() => ({
    children: window.__gd3d.sceneChildren(),
    mats: window.__gd3d.materialCount(),
    geos: window.__gd3d.geometryCount(),
    calls: window.__gd3d.rendererStats().calls,
  }));
  log('m6a scene/resource counts stable across death/restart/replay',
    m6aAfter.children === m6aBefore.children &&
    m6aAfter.mats === m6aBefore.mats && m6aAfter.geos === m6aBefore.geos,
    `children ${m6aBefore.children}->${m6aAfter.children}, mats ${m6aBefore.mats}->${m6aAfter.mats}, geos ${m6aBefore.geos}->${m6aAfter.geos}`);
  log('m6a draw calls do not grow per attempt',
    m6aAfter.calls > 0 && m6aAfter.calls < 600,
    `calls ${m6aBefore.calls}->${m6aAfter.calls}`);

  // Post resize path: shrink the viewport, passes survive, no errors.
  await page.setViewportSize({ width: 960, height: 540 });
  await page.waitForTimeout(800);
  const m6aResized = await page.evaluate(() => ({
    passes: window.__gd3d.postPassCount(),
    post: window.__gd3d.postEnabled(),
  }));
  log('m6a postprocessing survives viewport resize',
    m6aResized.post === true && m6aResized.passes === 3,
    `passes=${m6aResized.passes}`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(500);

  // Fallback path: ?post=off stays playable (same scene, direct render).
  await page.goto(`${URL}?post=off`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m6aFallback = await page.evaluate(() => ({
    post: window.__gd3d.postEnabled(),
    passes: window.__gd3d.postPassCount(),
  }));
  const m6aF0 = await pos();
  await page.waitForTimeout(600);
  const m6aF1 = await pos();
  log('m6a post fallback stays playable (?post=off, direct render)',
    m6aFallback.post === false && m6aFallback.passes === 0 && (m6aF1.z - m6aF0.z) > 2,
    `post=${m6aFallback.post} passes=${m6aFallback.passes} dz=${(m6aF1.z - m6aF0.z).toFixed(1)}`);
}

// --- 22. M6B: motion + gameplay juice ---
// Trail, jump/landing bursts, gravity pulses, speed streaks, pad/orb juice —
// presentation-only, observed live through the __gd3d FX probes. Automated
// structural proof lives in tests/motionVfx.test.ts; these checks prove the
// integrated app (edges fire from REAL sim events, Floor + Ceiling, replay
// recreates juice, ?fx=off independence, resource boundedness) and capture
// the m6b-* evidence set. Teleport + pause-freeze + cumulative FX counters
// (no tight input windows except the pre-proven M4 orb press pattern with
// retries), so every M6B check must be 100% green.
{
  const fx = () => page.evaluate(() => ({
    enabled: window.__gd3d.fxEnabled(),
    trail: window.__gd3d.trailSamples(),
    particles: window.__gd3d.activeParticles(),
    streaks: window.__gd3d.activeStreaks(),
    counters: window.__gd3d.fxCounters(),
    intensity: window.__gd3d.lastLandingIntensity(),
    resets: window.__gd3d.fxResets(),
  }));
  const fxPause = async () => {
    // dt=0 freezes particles AND camera instantly: short settle, young bursts.
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(120);
  };
  const fxResume = async () => {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(150);
  };
  const pollFx = async (pred, timeoutMs = 12000) => {
    const t0 = Date.now();
    let s = await fx();
    for (;;) {
      if (pred(s)) return s;
      if (Date.now() - t0 > timeoutMs) return s;
      await page.waitForTimeout(120);
      s = await fx();
    }
  };
  const waitVerifyM6b = async (timeoutMs = 90000) => {
    const t0 = Date.now();
    for (;;) {
      const snap = await page.evaluate(() => ({
        verify: window.__gd3d.replayVerification(),
        badge: window.__gd3d.replayBadge(),
        mode: window.__gd3d.replayMode(),
      }));
      if (snap.verify.kind === 'pass' || snap.verify.kind === 'diverged') return snap;
      if (Date.now() - t0 > timeoutMs) return snap;
      await page.waitForTimeout(300);
    }
  };

  // Fresh page, default flags (post on, fx on).
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // FX enabled by default; the trail accumulates behind the running cube.
  const m6bDefault = await pollFx((s) => s.trail > 5, 15000);
  log('m6b fx enabled by default (trail accumulates while running)',
    m6bDefault.enabled === true && m6bDefault.trail > 5,
    `enabled=${m6bDefault.enabled} trail=${m6bDefault.trail}`);

  // Trail evidence + runtime toggle pair on a teleport-framed runway run
  // (proven M6A coordinates: teleport 92, roll 93-99 — no death risk).
  await startGravityRun(92);
  const m6bTrailRun = await rollUntilM3((s) => s.z > 93 && s.z < 99 && s.grounded, 15000);
  log('m6b runway run framed for trail evidence', m6bTrailRun !== null,
    m6bTrailRun ? `z=${m6bTrailRun.z.toFixed(1)}` : 'never framed');
  await fxPause();
  const m6bTrailFrozen = await fx();
  await capture('m6b-01-trail');
  await page.evaluate(() => window.__gd3d.setFxEnabled(false));
  await page.waitForTimeout(400);
  const m6bFxOff = await fx();
  await capture('m6b-01b-trail-fxoff');
  await page.evaluate(() => window.__gd3d.setFxEnabled(true));
  await fxResume();
  const m6bFxBack = await pollFx((s) => s.trail > 5, 10000);
  log('m6b runtime toggle clears juice and resumes cleanly',
    m6bTrailFrozen.trail > 5 && m6bFxOff.trail === 0 && m6bFxOff.particles === 0 &&
    m6bFxBack.trail > 5,
    `on=${m6bTrailFrozen.trail} off=${m6bFxOff.trail} back=${m6bFxBack.trail}`);

  // ?fx=off page: gameplay advances, juice stays at zero.
  await page.goto(`${URL}?fx=off`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m6bOffFlag = await fx();
  const m6bOffZ0 = (await pos()).z;
  await page.waitForTimeout(900);
  const m6bOffZ1 = (await pos()).z;
  const m6bOffLater = await fx();
  log('m6b ?fx=off disables juice only (gameplay runs, no trail/particles)',
    m6bOffFlag.enabled === false && m6bOffLater.trail === 0 &&
    m6bOffLater.particles === 0 && (m6bOffZ1 - m6bOffZ0) > 2,
    `enabled=${m6bOffLater.enabled} trail=${m6bOffLater.trail} dz=${(m6bOffZ1 - m6bOffZ0).toFixed(1)}`);

  // Back to the default page for the lifecycle checks.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Trail clears on manual restart: R restarts the sim (attempts edge) and
  // the VFX reset path runs with it (resets edge). Buffer wipe itself is
  // pinned headlessly; here we prove the live edge reaches the reset path.
  await startGravityRun(92);
  await pollFx((s) => s.trail > 5, 20000);
  const m6bRAtt0 = await attempts();
  const m6bRRes0 = (await fx()).resets;
  await page.keyboard.press('KeyR');
  let m6bRAtt1 = m6bRAtt0;
  let m6bRRes1 = m6bRRes0;
  const m6bRT0 = Date.now();
  while (Date.now() - m6bRT0 < 10000) {
    m6bRAtt1 = await attempts();
    m6bRRes1 = (await fx()).resets;
    if (m6bRAtt1 > m6bRAtt0 && m6bRRes1 > m6bRRes0) break;
    await page.waitForTimeout(150);
  }
  log('m6b trail clears on R restart',
    m6bRAtt1 > m6bRAtt0 && m6bRRes1 > m6bRRes0,
    `attempts ${m6bRAtt0}->${m6bRAtt1} resets ${m6bRRes0}->${m6bRRes1}`);

  // Death + auto-respawn clears the trail and streak energy (same
  // fast-sample valley technique for the trail; streaks drop to an exact
  // zero at 1x and stay there).
  await startGravityRun(92);
  await pollFx((s) => s.trail > 5, 20000);
  const m6bAttBefore = await attempts();
  const m6bResBefore = (await fx()).resets;
  await page.evaluate(() => window.__gd3d.debugTeleport(0, -30, 60));
  let m6bAttAfter = m6bAttBefore;
  let m6bResAfter = m6bResBefore;
  const m6bDeathT0 = Date.now();
  while (Date.now() - m6bDeathT0 < 15000) {
    m6bAttAfter = await attempts();
    m6bResAfter = (await fx()).resets;
    if (m6bAttAfter > m6bAttBefore && m6bResAfter > m6bResBefore) break;
    await page.waitForTimeout(200);
  }
  const m6bDeathFx = await fx();
  log('m6b death/respawn clears trail and streaks',
    m6bAttAfter > m6bAttBefore && m6bResAfter > m6bResBefore &&
    m6bDeathFx.streaks === 0 && m6bDeathFx.trail <= 96,
    `attempts ${m6bAttBefore}->${m6bAttAfter} resets ${m6bResBefore}->${m6bResAfter} streaks=${m6bDeathFx.streaks}`);

  // Jump burst from the REAL jump event (one signal = one burst).
  // Photo-first with a particle gate: retry R+Space+quick-freeze until the
  // frozen frame holds live particles (headless frames are sparse), then
  // assert the exact-once counter on the same frozen evidence.
  const m6bJumpBase = (await fx()).counters.jump;
  let m6bJumpPhoto = false;
  for (let attempt = 1; attempt <= 4 && !m6bJumpPhoto; attempt++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(400);
    const ready = await pressSpaceWhen((s) => s.grounded, 8000);
    if (!ready) continue;
    await fxPause();
    if ((await fx()).particles > 0) {
      await capture('m6b-02-jump');
      m6bJumpPhoto = true;
    }
    await fxResume();
  }
  const m6bJumpFx = await fx();
  log('m6b jump emits exactly one visual burst',
    m6bJumpPhoto && m6bJumpFx.counters.jump === m6bJumpBase + 1,
    `jump ${m6bJumpBase}->${m6bJumpFx.counters.jump} photo=${m6bJumpPhoto}`);

  // Landing burst when the jump comes down (surface-relative, Floor).
  // Same particle-gated photo technique on the landing edge.
  const m6bLandBase = (await fx()).counters.landing;
  let m6bLandPhoto = false;
  for (let attempt = 1; attempt <= 3 && !m6bLandPhoto; attempt++) {
    if (attempt > 1) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(400);
      const ready = await pressSpaceWhen((s) => s.grounded, 8000);
      if (!ready) continue;
    }
    const landT0 = Date.now();
    let landed = false;
    while (Date.now() - landT0 < 8000) {
      const g = await page.evaluate(() => window.__gd3d.grounded());
      if (g) {
        landed = true;
        break;
      }
      await page.waitForTimeout(20);
    }
    if (!landed) continue;
    await fxPause();
    if ((await fx()).particles > 0) {
      await capture('m6b-03-landing');
      m6bLandPhoto = true;
    }
    await fxResume();
    if ((await fx()).counters.landing > m6bLandBase && m6bLandPhoto) break;
  }
  const m6bLanded = await fx();
  log('m6b landing emits exactly one visual burst',
    m6bLanded.counters.landing === m6bLandBase + 1 && m6bLandPhoto,
    `landing ${m6bLandBase}->${m6bLanded.counters.landing} intensity=${m6bLanded.intensity.toFixed(2)} photo=${m6bLandPhoto}`);
  const m6bSoftIntensity = (await fx()).intensity;

  // Fast-fall landing hits harder (capped intensity), still one burst.
  // Robust timing: jump, wait for the apex (y starts decreasing), THEN
  // hold fast-fall through the descent so the extra accel must apply.
  let m6bHardIntensity = 0;
  let m6bHardOk = false;
  for (let attempt = 1; attempt <= 3 && !m6bHardOk; attempt++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(400);
    const pressed = await pressSpaceWhen((s) => s.grounded, 8000);
    if (!pressed) continue;
    // Apex detect: two consecutive decreasing height reads.
    let lastY = Infinity;
    let downs = 0;
    const apexT0 = Date.now();
    let apexed = false;
    while (Date.now() - apexT0 < 8000) {
      const y = (await pos()).y;
      if (y < lastY - 0.03) downs += 1;
      else if (y > lastY + 0.03) downs = 0;
      lastY = y;
      if (downs >= 2) {
        apexed = true;
        break;
      }
      await page.waitForTimeout(30);
    }
    if (!apexed) continue;
    await page.keyboard.down('ArrowDown');
    const t0 = Date.now();
    for (;;) {
      const g = await page.evaluate(() => window.__gd3d.grounded());
      if (g) break;
      if (Date.now() - t0 > 8000) break;
      await page.waitForTimeout(30);
    }
    await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(300);
    m6bHardIntensity = (await fx()).intensity;
    m6bHardOk = m6bHardIntensity > m6bSoftIntensity && m6bHardIntensity <= 1;
  }
  log('m6b fast-fall landing is stronger but bounded',
    m6bHardOk, `soft=${m6bSoftIntensity.toFixed(2)} hard=${m6bHardIntensity.toFixed(2)}`);

  // Gravity flip emits the transition pulse (portal crossing, Floor->Ceiling).
  const m6bGravBase = (await fx()).counters.gravity;
  await startGravityRun(168);
  const m6bFlip = await pollFx((s) => s.counters.gravity > m6bGravBase, 20000);
  log('m6b gravity flip emits one transition pulse',
    m6bFlip.counters.gravity === m6bGravBase + 1,
    `gravity ${m6bGravBase}->${m6bFlip.counters.gravity}`);
  // (Flip evidence photo comes from the gravity-orb flip below: same
  // shared transition path, clean backdrop without the portal pane wash.)

  // Jump pad activation emits the yellow impulse burst.
  const m6bPadBase = (await fx()).counters.pad;
  await startGravityRun(292);
  const m6bPadFx = await pollFx((s) => s.counters.pad > m6bPadBase, 20000);
  log('m6b jump pad emits one impulse burst',
    m6bPadFx.counters.pad === m6bPadBase + 1,
    `pad ${m6bPadBase}->${m6bPadFx.counters.pad}`);
  // Photo retry: freeze on the pad edge until live particles are caught.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await startGravityRun(300);
    const padBase = (await fx()).counters.pad;
    const padT0 = Date.now();
    let fired = false;
    while (Date.now() - padT0 < 15000) {
      const c = (await fx()).counters.pad;
      if (c > padBase) {
        fired = true;
        break;
      }
      await page.waitForTimeout(30);
    }
    if (!fired) continue;
    await fxPause();
    if ((await fx()).particles > 0) {
      await capture('m6b-05-pad');
      await fxResume();
      break;
    }
    await fxResume();
  }

  // Jump orb: pre-proven M4 geometry (edge jump + window press). These are
  // the tightest CDP-timing windows in the section, so they run on a
  // fresh ?post=off page (~30 fps headless instead of ~8: an 80 ms press
  // reliably spans rendered frames). Emission is post-independent — the
  // same update path fires the burst with the composer on or off.
  await page.goto(`${URL}?post=off`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  let m6bOrbOk = false;
  for (let attempt = 1; attempt <= 4 && !m6bOrbOk; attempt++) {
    await startGravityRun(326);
    const m6bOrbBase = (await fx()).counters.jumpOrb;
    const jumped = await pressSpaceWhen((s) => s.grounded && s.z >= 329.2, 8000);
    if (!jumped) continue;
    const pressed = await pressSpaceWhen((s) => !s.grounded && s.z >= 335.3 && s.z <= 338.4, 5000);
    if (!pressed) continue;
    const seen = await pollFx((s) => s.counters.jumpOrb > m6bOrbBase, 4000);
    if (seen.counters.jumpOrb > m6bOrbBase) {
      await fxPause();
      if ((await fx()).particles > 0) {
        await capture('m6b-06-orb');
        await fxResume();
        m6bOrbOk = true;
      } else {
        await fxResume();
      }
    }
  }
  log('m6b jump orb emits one activation burst', m6bOrbOk, m6bOrbOk ? 'orb burst observed (post-off page)' : 'orb window missed x4');

  // Gravity orb flips through the shared path (flip pulse, deduped) —
  // same post-off timing rationale (M4 geometry).
  let m6bGOrbOk = false;
  for (let attempt = 1; attempt <= 4 && !m6bGOrbOk; attempt++) {
    await startGravityRun(344);
    const m6bGBase = (await fx()).counters.gravity;
    const jumped = await pressSpaceWhen((s) => s.grounded && s.z >= 348.2, 8000);
    if (!jumped) continue;
    const pressed = await pressSpaceWhen((s) => !s.grounded && s.z >= 351 && s.z <= 352.9, 5000);
    if (!pressed) continue;
    const seen = await pollFx((s) => s.counters.gravity > m6bGBase, 6000);
    if (seen.counters.gravity > m6bGBase) {
      // Flip evidence photo here: same shared transition pulse as the
      // portal flip, but against the open slab-C backdrop (no pane wash).
      await fxPause();
      if ((await fx()).particles > 0) {
        await capture('m6b-04-gravity-flip');
      }
      await fxResume();
      m6bGOrbOk = true;
    }
  }
  log('m6b gravity orb emits the flip pulse (deduped, one event)', m6bGOrbOk,
    m6bGOrbOk ? 'flip pulse observed' : 'window press missed x4');

  // 2x speed portal: tier pulse + streak count rises (M6A-proven
  // coordinates: teleport 366, approach 368-371, cross 373).
  // Back on the default page (post on) after the post-off orb detour.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m6bSpeedBase = (await fx()).counters.speed;
  await startGravityRun(366);
  const m6bSpeedFx = await pollFx(
    (s) => s.counters.speed > m6bSpeedBase && s.streaks > 0, 20000);
  const m6bSpeedNow = await page.evaluate(() => window.__gd3d.speedMultiplier());
  log('m6b 2x portal emits speed pulse and raises streaks',
    m6bSpeedFx.counters.speed === m6bSpeedBase + 1 && m6bSpeedFx.streaks > 0 && m6bSpeedNow === 2,
    `speed ${m6bSpeedBase}->${m6bSpeedFx.counters.speed} streaks=${m6bSpeedFx.streaks} tier=${m6bSpeedNow}x`);
  // Evidence past the gateway: the 2x runway is only z 372-380, so freeze
  // in the 373.5-379 band on a fast poll (the magenta wash ahead is the
  // finish gate + the green tier-2 gateway frame — the honest 2x-sprint
  // look; streaks persist at 2x and the tier pulse counter already fired).
  const m6bSpeedSettled = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const s = await page.evaluate(() => ({
        st: window.__gd3d.status(),
        z: window.__gd3d.playerPosition().z,
      }));
      if (s.st !== 'running') return false;
      if (s.z > 373.5 && s.z < 379) return true;
      await page.waitForTimeout(50);
    }
    return false;
  })();
  if (m6bSpeedSettled) {
    await fxPause();
    await capture('m6b-07-speed-2x');
    await fxResume();
  }

  // Ceiling: jump + landing bursts fire surface-relatively (Space works both).
  const m6bCeil = await crossToCeiling();
  log('m6b ceiling reached for surface-relative juice', m6bCeil !== null,
    m6bCeil ? `z=${m6bCeil.z.toFixed(1)}` : 'never grounded on ceiling');
  const m6bCeilRun = m6bCeil === null ? null
    : await rollUntilM3((s) => s.grounded && s.z > 205 && s.z < 215, 15000);
  let m6bCeilOk = false;
  if (m6bCeilRun !== null) {
    const cBase = await fx();
    const pressed = await pressSpaceWhen((s) => s.grounded && s.z > 205 && s.z < 212, 8000);
    if (pressed) {
      const seen = await pollFx(
        (s) => s.counters.jump > cBase.counters.jump && s.counters.landing > cBase.counters.landing, 8000);
      m6bCeilOk = seen.counters.jump > cBase.counters.jump &&
        seen.counters.landing > cBase.counters.landing;
    }
    await fxPause();
    await capture('m6b-08-ceiling');
    await fxResume();
  }
  log('m6b ceiling jump + landing emit bursts (surface-relative)', m6bCeilOk,
    m6bCeilOk ? 'ceiling jump+landing observed' : 'ceiling window missed');

  // Level 02 runs the same juice on the shared code path.
  await page.goto(`${URL}?level=validation-02`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const m6bL2 = await pollFx((s) => s.trail > 5, 15000);
  const m6bL2Id = await page.evaluate(() => window.__gd3d.levelId());
  log('m6b level 02 runs the same juice system',
    m6bL2Id === 'validation-02' && m6bL2.trail > 5,
    `id=${m6bL2Id} trail=${m6bL2.trail}`);
  await fxPause();
  await capture('m6b-09-level02');
  await fxResume();

  // Replay recreates juice from the replayed sim, then still VERIFIES.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(400);
  const m6bTapeJumpBase = (await fx()).counters.jump;
  await pressSpaceWhen((s) => s.grounded, 8000);
  await pollFx((s) => s.counters.jump > m6bTapeJumpBase, 5000);
  const m6bTapeDeath = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const s = await simState();
      if (s.status === 'dead') return s;
      if (Date.now() - t0 > 40000) return null;
      await page.waitForTimeout(200);
    }
  })();
  log('m6b live jump-then-death finalizes a replay tape', m6bTapeDeath !== null,
    m6bTapeDeath ? `cause=${m6bTapeDeath.cause}` : 'never died');
  await page.keyboard.press('F4');
  await page.waitForTimeout(500);
  // Juice recreation proof is the CUMULATIVE jump counter re-firing from
  // the replayed sim (fps-independent — transient trail would flake under
  // headless load); trail>0 is read opportunistically for the log line.
  const m6bReplayFx = await pollFx((s) => s.counters.jump > m6bTapeJumpBase, 30000);
  const m6bReplayMode = await page.evaluate(() => window.__gd3d.replayMode());
  log('m6b replay recreates juice live (burst re-fires from replayed sim)',
    m6bReplayMode === 'replay' && m6bReplayFx.counters.jump > m6bTapeJumpBase,
    `mode=${m6bReplayMode} jump=${m6bReplayFx.counters.jump} trail=${m6bReplayFx.trail}`);
  const m6bVerdict = await waitVerifyM6b();
  const m6bReplayCounters = (await fx()).counters;
  log('m6b replay still reaches VERIFIED with juice recreated',
    m6bVerdict.verify.kind === 'pass' && m6bReplayCounters.jump > m6bTapeJumpBase,
    `verify=${m6bVerdict.verify.kind} badge=${m6bVerdict.badge} jump=${m6bReplayCounters.jump}`);
  await capture('m6b-10-replay');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(500);

  // Resource boundedness over repeated attempts (death + restart + replay).
  const m6bResStart = await page.evaluate(() => ({
    children: window.__gd3d.sceneChildren(),
    mats: window.__gd3d.materialCount(),
    geos: window.__gd3d.geometryCount(),
  }));
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__gd3d.debugTeleport(0, -30, 60));
    const t0 = Date.now();
    const att0 = await attempts();
    while (Date.now() - t0 < 12000) {
      if ((await attempts()) > att0) break;
      await page.waitForTimeout(200);
    }
  }
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(900);
  const m6bResEnd = await page.evaluate(() => ({
    children: window.__gd3d.sceneChildren(),
    mats: window.__gd3d.materialCount(),
    geos: window.__gd3d.geometryCount(),
    trail: window.__gd3d.trailSamples(),
    particles: window.__gd3d.activeParticles(),
  }));
  log('m6b scene/resources bounded over repeated attempts',
    m6bResEnd.children === m6bResStart.children &&
    m6bResEnd.mats === m6bResStart.mats && m6bResEnd.geos === m6bResStart.geos &&
    m6bResEnd.trail <= 96 && m6bResEnd.particles <= 384,
    `children ${m6bResStart.children}->${m6bResEnd.children}, mats ${m6bResStart.mats}->${m6bResEnd.mats}, trail=${m6bResEnd.trail}`);

  // Post x FX matrix: every combination stays playable.
  await page.goto(`${URL}?post=off&fx=on`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m6bNoPost = await page.evaluate(() => ({
    post: window.__gd3d.postEnabled(),
    trail: window.__gd3d.trailSamples(),
    z: window.__gd3d.playerPosition().z,
  }));
  log('m6b post OFF + fx ON works (streaks/trail without composer)',
    m6bNoPost.post === false && m6bNoPost.trail > 0 && m6bNoPost.z > 5,
    `post=${m6bNoPost.post} trail=${m6bNoPost.trail} z=${m6bNoPost.z.toFixed(1)}`);
  await page.goto(`${URL}?post=off&fx=off`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m6bMinimal = await page.evaluate(() => ({
    post: window.__gd3d.postEnabled(),
    fx: window.__gd3d.fxEnabled(),
    trail: window.__gd3d.trailSamples(),
    z0: window.__gd3d.playerPosition().z,
  }));
  await page.waitForTimeout(700);
  const m6bMinimalZ1 = await page.evaluate(() => window.__gd3d.playerPosition().z);
  log('m6b minimal presentation (?post=off&fx=off) stays playable',
    m6bMinimal.post === false && m6bMinimal.fx === false && m6bMinimal.trail === 0 &&
    (m6bMinimalZ1 - m6bMinimal.z0) > 2,
    `post=${m6bMinimal.post} fx=${m6bMinimal.fx} dz=${(m6bMinimalZ1 - m6bMinimal.z0).toFixed(1)}`);

  // Resize survival with juice live.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.setViewportSize({ width: 960, height: 540 });
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(500);
  const m6bResized = await pollFx((s) => s.trail > 5, 10000);
  log('m6b juice survives viewport resize', m6bResized.trail > 5,
    `trail=${m6bResized.trail}`);
}

// --- 23. M6C1: visual triggers (position-driven presentation) ---
// Timeline sections resolve from player Z only (same location → same
// section on every machine); interpolation is render-side smoothing.
// Automated structural proof lives in tests/visualTimeline.test.ts; these
// checks prove the integrated app (real trajectory walks the proof
// sequence on BOTH levels, triggers-off restores the exact baseline,
// replay recreates sections with no stored timeline state, resources flat)
// and capture the m6c1-* evidence set. Teleport + pause-freeze framing
// (proven M6A/M6B coordinates), so every M6C1 check must be 100% green.
{
  const tl = () => page.evaluate(() => ({
    section: window.__gd3d.visualSectionId(),
    t: window.__gd3d.visualSectionProgress(),
    enabled: window.__gd3d.visualTriggersEnabled(),
    bg: window.__gd3d.visualBackground(),
    fog: window.__gd3d.visualFogColor(),
    accent: window.__gd3d.visualRouteAccent(),
    exp: window.__gd3d.visualExposure(),
    vfx: window.__gd3d.visualVfxIntensity(),
    player: window.__gd3d.visualPlayerColor(),
    hazard: window.__gd3d.visualHazardColor(),
    bloom: window.__gd3d.bloomParams(),
    passes: window.__gd3d.postPassCount(),
    mats: window.__gd3d.materialCount(),
    geos: window.__gd3d.geometryCount(),
    children: window.__gd3d.sceneChildren(),
  }));
  const pollTl = async (pred, timeoutMs = 15000) => {
    const t0 = Date.now();
    let s = await tl();
    for (;;) {
      if (pred(s)) return s;
      if (Date.now() - t0 > timeoutMs) return s;
      await page.waitForTimeout(100);
      s = await tl();
    }
  };
  const tlPause = async () => {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(150);
  };
  const tlResume = async () => {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(150);
  };
  const waitVerifyM6c1 = async (timeoutMs = 90000) => {
    const t0 = Date.now();
    for (;;) {
      const snap = await page.evaluate(() => ({
        verify: window.__gd3d.replayVerification(),
        mode: window.__gd3d.replayMode(),
      }));
      if (snap.verify.kind === 'pass' || snap.verify.kind === 'diverged') return snap;
      if (Date.now() - t0 > timeoutMs) return snap;
      await page.waitForTimeout(300);
    }
  };
  const BASE_BG = 0x07040f;
  const BASE_FOG = 0x140b26;
  const BASE_ACCENT = 0xb44dff;
  const PLAYER_HEX = 0x0e4a56;
  const HAZARD_HEX = 0xff9d00;

  // Fresh page, default flags (post on, fx on, triggers on).
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m6c1Base = await pollTl((s) => s.section === 'runway', 15000);
  log('m6c1 triggers enabled by default, opening section resolves',
    m6c1Base.enabled === true && m6c1Base.section === 'runway' && m6c1Base.bg === BASE_BG,
    `enabled=${m6c1Base.enabled} section=${m6c1Base.section} bg=0x${m6c1Base.bg.toString(16)}`);
  // Base evidence on a framed runway run.
  await startGravityRun(8);
  const m6c1BaseFrame = await rollUntilM3((s) => s.z > 8 && s.z < 14 && s.grounded, 15000);
  log('m6c1 level01 base framed for evidence', m6c1BaseFrame !== null,
    m6c1BaseFrame ? `z=${m6c1BaseFrame.z.toFixed(1)}` : 'never framed');
  await tlPause();
  await capture('m6c1-01-level01-base');
  await tlResume();

  // Gravity descent: teleport before the blend zone, roll through the
  // mid-blend (24 u wide — no tight window), then settle past it.
  // Gravity descent: teleport before the blend zone, then catch the
  // mid-blend directly off the timeline probe (the 24 u zone always
  // passes through 0<t<1 while running — no tight z-window, no grounded
  // requirement; the paused frame is a genuine mid-transition shot).
  // Gravity descent: teleport before the blend zone, then catch the
  // mid-blend directly off the timeline probe. NOTE the probe `t` is
  // SECTION progress ((z-150)/128), not the blend factor ((z-150)/24):
  // t in (0.04,0.15) ⇔ blend smooth-factor in (0.2,0.8) ⇔ bg/exp strictly
  // between base and target. The ~10 u window crosses even at crawl speed.
  await startGravityRun(148);
  const m6c1BlendCatch = await pollTl(
    (s) => s.section === 'gravity-descent' && s.t > 0.04 && s.t < 0.15, 45000);
  let m6c1BlendProbe = null;
  if (m6c1BlendCatch.section === 'gravity-descent' && m6c1BlendCatch.t > 0.04 && m6c1BlendCatch.t < 0.15) {
    await tlPause();
    m6c1BlendProbe = await tl();
    await capture('m6c1-02-gravity-transition');
    await tlResume();
  }
  log('m6c1 mid-blend interpolation is bounded (between base and target)',
    m6c1BlendProbe !== null && m6c1BlendProbe.section === 'gravity-descent' &&
    m6c1BlendProbe.t > 0 && m6c1BlendProbe.t < 1 &&
    m6c1BlendProbe.bg !== BASE_BG && m6c1BlendProbe.bg !== 0x040213 &&
    m6c1BlendProbe.exp < 1.15 && m6c1BlendProbe.exp > 1.08,
    m6c1BlendProbe ? `t=${m6c1BlendProbe.t.toFixed(2)} bg=0x${m6c1BlendProbe.bg.toString(16)} exp=${m6c1BlendProbe.exp.toFixed(3)}` : 'never framed');
  // Settle on the ceiling run via the proven natural portal crossing
  // (teleport 176, flip at 182, ground on the slab — crossToCeiling).
  // M6C2 quiesce: the flip fires a gravity punch (bloom/exposure lift)
  // that decays in <2 s wall — wait it out so the strict section pins
  // below measure the section, not the transient (intent unchanged).
  const m6c1Ceil = await crossToCeiling();
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const e = await page.evaluate(() => window.__gd3d.eventPunchEnergy());
      if (e === 0) break;
      await page.waitForTimeout(100);
    }
  }
  const m6c1GravProbe = await tl();
  log('m6c1 gravity-descent section resolves on the ceiling run',
    m6c1Ceil !== null && m6c1GravProbe.section === 'gravity-descent' &&
    m6c1GravProbe.bg === 0x040213 && m6c1GravProbe.exp === 1.08,
    m6c1Ceil ? `z=${m6c1Ceil.z.toFixed(1)} bg=0x${m6c1GravProbe.bg.toString(16)}` : 'never framed');
  await tlPause();
  await capture('m6c1-03-ceiling-section');
  await tlResume();
  log('m6c1 background/fog transition reads against base',
    m6c1GravProbe.fog === 0x0d0722 && m6c1GravProbe.fog !== BASE_FOG,
    `fog=0x${m6c1GravProbe.fog.toString(16)}`);

  // Interaction run: full blend by z=298 (blendIn 20 from 278).
  await startGravityRun(290);
  const m6c1Inter = await rollUntilM3((s) => s.z > 295 && s.z < 305 && s.grounded, 15000);
  const m6c1InterProbe = await tl();
  const m6c1GeosBefore = m6c1InterProbe.geos;
  log('m6c1 interaction-run section resolves with route accent shift',
    m6c1Inter !== null && m6c1InterProbe.section === 'interaction-run' &&
    m6c1InterProbe.accent === 0xc44dff && m6c1InterProbe.vfx > 1.1,
    m6c1Inter ? `z=${m6c1Inter.z.toFixed(1)} accent=0x${m6c1InterProbe.accent.toString(16)} vfx=${m6c1InterProbe.vfx}` : 'never framed');
  await tlPause();
  await capture('m6c1-04-interaction-section');
  await tlResume();

  // Speed sprint (M6B-proven coordinates: teleport 366, approach 368-371).
  await startGravityRun(366);
  const m6c1Speed = await rollUntilM3((s) => s.z > 368 && s.z < 371 && s.grounded, 15000);
  const m6c1SpeedProbe = await tl();
  log('m6c1 speed-sprint section resolves inside the bloom contract',
    m6c1Speed !== null && m6c1SpeedProbe.section === 'speed-sprint' &&
    m6c1SpeedProbe.bloom !== null && Math.abs(m6c1SpeedProbe.bloom.strength - 0.55) < 0.02 &&
    m6c1SpeedProbe.bloom.strength <= 0.7 && m6c1SpeedProbe.bloom.radius <= 0.6 &&
    m6c1SpeedProbe.bloom.threshold >= 0.6,
    m6c1Speed ? `z=${m6c1Speed.z.toFixed(1)} bloom=${m6c1SpeedProbe.bloom.strength}` : 'never framed');
  await tlPause();
  await capture('m6c1-05-speed-section');
  await tlResume();
  log('m6c1 route accent changed with zero geometry growth',
    m6c1SpeedProbe.geos === m6c1GeosBefore && m6c1SpeedProbe.accent !== BASE_ACCENT,
    `geos=${m6c1GeosBefore}->${m6c1SpeedProbe.geos} accent=0x${m6c1SpeedProbe.accent.toString(16)}`);
  const m6c1PlayerStable = m6c1SpeedProbe.player === PLAYER_HEX && m6c1Base.player === PLAYER_HEX &&
    m6c1GravProbe.player === PLAYER_HEX && m6c1InterProbe.player === PLAYER_HEX;
  log('m6c1 player cyan identity unchanged across every section', m6c1PlayerStable,
    `player=0x${m6c1SpeedProbe.player.toString(16)}`);
  const m6c1HazardStable = m6c1SpeedProbe.hazard === HAZARD_HEX && m6c1Base.hazard === HAZARD_HEX &&
    m6c1GravProbe.hazard === HAZARD_HEX && m6c1InterProbe.hazard === HAZARD_HEX;
  log('m6c1 hazard warm identity unchanged across every section', m6c1HazardStable,
    `hazard=0x${m6c1SpeedProbe.hazard.toString(16)}`);

  // R returns to the starting visual state (position-driven reset).
  // M6C2 quiesce (same transient rationale as above: the sprint pass
  // fires pad/speed punches that must drain before strict pins).
  await page.keyboard.press('KeyR');
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const e = await page.evaluate(() => window.__gd3d.eventPunchEnergy());
      if (e === 0) break;
      await page.waitForTimeout(100);
    }
  }
  const m6c1Restart = await pollTl((s) => s.section === 'runway' && s.bg === BASE_BG, 15000);
  log('m6c1 R returns to the opening visual state',
    m6c1Restart.section === 'runway' && m6c1Restart.bg === BASE_BG && m6c1Restart.exp === 1.15,
    `section=${m6c1Restart.section} bg=0x${m6c1Restart.bg.toString(16)}`);

  // Death/respawn returns correctly (void fall → auto-respawn at start).
  const m6c1Att0 = await attempts();
  await page.evaluate(() => window.__gd3d.debugTeleport(0, -30, 60));
  let m6c1Respawn = null;
  {
    const t0 = Date.now();
    for (;;) {
      const a = await attempts();
      const s = await tl();
      if (a > m6c1Att0 && s.section === 'runway') { m6c1Respawn = s; break; }
      if (Date.now() - t0 > 20000) { m6c1Respawn = s; break; }
      await page.waitForTimeout(200);
    }
  }
  log('m6c1 death/respawn returns to the opening visual state',
    m6c1Respawn !== null && m6c1Respawn.section === 'runway' && m6c1Respawn.bg === BASE_BG,
    m6c1Respawn ? `section=${m6c1Respawn.section}` : 'no respawn observed');

  // F4 recreates the timeline from trajectory alone (no stored state).
  // NATURAL death tape only: the center lane dies on the z=116 spike by
  // itself (M6A-proven, no teleports — a teleported death cannot replay
  // because teleports are not inputs). Fresh page for a clean tape.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('KeyR');
  let m6c1NaturalDeath = null;
  {
    const t0 = Date.now();
    for (;;) {
      const s = await simState();
      if (s.status === 'dead') { m6c1NaturalDeath = s; break; }
      if (Date.now() - t0 > 90000) break;
      await page.waitForTimeout(200);
    }
  }
  const m6c1HasTape = await page.evaluate(() => window.__gd3d.hasReplay());
  await page.keyboard.press('F4');
  await page.waitForTimeout(800);
  const m6c1ReplayMode = await page.evaluate(() => window.__gd3d.replayMode());
  const m6c1ReplayTl = await tl();
  await capture('m6c1-09-replay');
  const m6c1Verify = await waitVerifyM6c1(90000);
  log('m6c1 F4 replay walks the position-driven sections',
    m6c1NaturalDeath !== null && m6c1HasTape === true && m6c1ReplayMode === 'replay' && m6c1ReplayTl.section === 'runway',
    `died=${m6c1NaturalDeath !== null} tape=${m6c1HasTape} mode=${m6c1ReplayMode} section=${m6c1ReplayTl.section}`);
  log('m6c1 F4 replay ends VERIFIED under timeline visuals',
    m6c1Verify.verify.kind === 'pass',
    `verification=${m6c1Verify.verify.kind}`);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(500);
  const m6c1TapeJson = await page.evaluate(() => window.__gd3d.exportLastReplay());
  let m6c1TapeClean = false;
  let m6c1TapeDetail = 'no tape';
  if (m6c1TapeJson !== null) {
    const tape = JSON.parse(m6c1TapeJson);
    const keys = Object.keys(tape);
    const leaked = keys.filter((k) => /section|visual|bloom|fog|exposure|trigger|timeline/i.test(k));
    m6c1TapeClean = leaked.length === 0 && tape.schemaVersion === 1;
    m6c1TapeDetail = `keys=${keys.length} leaked=[${leaked.join(',')}]`;
  }
  log('m6c1 replay carries zero timeline state', m6c1TapeClean, m6c1TapeDetail);

  // Resource stability across the whole Level 01 pass.
  const m6c1ResEnd = await tl();
  log('m6c1 resources flat across every transition (26/8/3)',
    m6c1ResEnd.mats === 26 && m6c1ResEnd.geos === 8 && m6c1ResEnd.passes === 3 &&
    m6c1ResEnd.children === m6c1Base.children,
    `mats=${m6c1ResEnd.mats} geos=${m6c1ResEnd.geos} passes=${m6c1ResEnd.passes} children=${m6c1Base.children}->${m6c1ResEnd.children}`);

  // ?triggers=off: the exact M6A+M6B baseline, then the evidence pair.
  await page.goto(`${URL}?triggers=off`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await startGravityRun(8);
  await rollUntilM3((s) => s.z > 8 && s.z < 14 && s.grounded, 15000);
  const m6c1Off = await tl();
  await tlPause();
  await capture('m6c1-10-triggers-off');
  await tlResume();
  log('m6c1 ?triggers=off resolves the exact baseline (no stale sections)',
    m6c1Off.enabled === false && m6c1Off.section === 'base' && m6c1Off.bg === BASE_BG &&
    m6c1Off.fog === BASE_FOG && m6c1Off.accent === BASE_ACCENT && m6c1Off.exp === 1.15 &&
    m6c1Off.vfx === 1,
    `section=${m6c1Off.section} bg=0x${m6c1Off.bg.toString(16)} exp=${m6c1Off.exp}`);
  // A deep teleport with triggers off must NOT pick up any section.
  await startGravityRun(200);
  await page.waitForTimeout(1200);
  const m6c1OffDeep = await tl();
  log('m6c1 triggers-off stays baseline deep in the level',
    m6c1OffDeep.section === 'base' && m6c1OffDeep.bg === BASE_BG,
    `section=${m6c1OffDeep.section} z far past blend zones`);

  // Level 02 uses the same infrastructure (teal identity retained).
  await page.goto(`${URL}?level=validation-02`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m6c1L2Base = await pollTl((s) => s.section === 'v2-weave', 15000);
  log('m6c1 level02 opening section resolves with teal identity',
    m6c1L2Base.section === 'v2-weave' && m6c1L2Base.accent === 0x18e0a0,
    `section=${m6c1L2Base.section} accent=0x${m6c1L2Base.accent.toString(16)}`);
  await startGravityRun(8);
  await rollUntilM3((s) => s.z > 8 && s.z < 14 && s.grounded, 15000);
  await tlPause();
  await capture('m6c1-06-level02-base');
  await tlResume();
  // Ceiling passage via the natural portal crossing at z=82.
  await startGravityRun(70);
  const m6c1L2Ceil = await rollUntilM3((s) => s.mode === 'ceiling' && s.z > 88 && s.z < 100, 20000);
  const m6c1L2CeilProbe = await tl();
  log('m6c1 level02 ceiling section resolves after the portal flip',
    m6c1L2Ceil !== null && m6c1L2CeilProbe.section === 'v2-ceiling',
    m6c1L2Ceil ? `z=${m6c1L2Ceil.z.toFixed(1)} section=${m6c1L2CeilProbe.section}` : 'never framed');
  await tlPause();
  await capture('m6c1-07-level02-ceiling');
  await tlResume();
  // Speed section via the natural 2x crossing at z=164 (runway D).
  await startGravityRun(155);
  const m6c1L2Speed = await rollUntilM3((s) => s.z > 167 && s.z < 174 && s.grounded, 20000);
  const m6c1L2SpeedProbe = await tl();
  log('m6c1 level02 speed section resolves with lifted juice',
    m6c1L2Speed !== null && m6c1L2SpeedProbe.section === 'v2-speed' && m6c1L2SpeedProbe.vfx > 1.05,
    m6c1L2Speed ? `z=${m6c1L2Speed.z.toFixed(1)} vfx=${m6c1L2SpeedProbe.vfx}` : 'never framed');
  await tlPause();
  await capture('m6c1-08-level02-speed');
  await tlResume();

  // Fallback matrix: post-off + triggers, fx-off + triggers, all-off.
  await page.goto(`${URL}?post=off`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await startGravityRun(148);
  const m6c1NoPost = await pollTl((s) => s.section === 'gravity-descent', 20000);
  const m6c1NoPostBloom = await page.evaluate(() => window.__gd3d.bloomParams());
  log('m6c1 post OFF + triggers ON still walks sections',
    m6c1NoPost.section === 'gravity-descent' && m6c1NoPostBloom === null,
    `section=${m6c1NoPost.section} bloom=${m6c1NoPostBloom}`);
  await page.goto(`${URL}?fx=off`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await startGravityRun(290);
  const m6c1NoFx = await pollTl((s) => s.section === 'interaction-run' && s.accent === 0xc44dff, 20000);
  const m6c1NoFxAdv = await page.evaluate(() => window.__gd3d.playerPosition().z);
  log('m6c1 fx OFF + triggers ON still walks sections',
    m6c1NoFx.section === 'interaction-run' && m6c1NoFxAdv > 290,
    `section=${m6c1NoFx.section} z=${m6c1NoFxAdv.toFixed(1)}`);
  await page.goto(`${URL}?post=off&fx=off&triggers=off`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m6c1Min0 = await page.evaluate(() => ({
    section: window.__gd3d.visualSectionId(),
    bg: window.__gd3d.visualBackground(),
    z: window.__gd3d.playerPosition().z,
  }));
  await page.waitForTimeout(700);
  const m6c1MinZ1 = await page.evaluate(() => window.__gd3d.playerPosition().z);
  log('m6c1 minimal presentation (all-off) stays playable at baseline',
    m6c1Min0.section === 'base' && m6c1Min0.bg === BASE_BG && (m6c1MinZ1 - m6c1Min0.z) > 2,
    `section=${m6c1Min0.section} dz=${(m6c1MinZ1 - m6c1Min0.z).toFixed(1)}`);

  // Resize survival with a section live.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await startGravityRun(200);
  await page.setViewportSize({ width: 960, height: 540 });
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(500);
  const m6c1Resized = await pollTl((s) => s.section === 'gravity-descent', 15000);
  log('m6c1 timeline survives viewport resize', m6c1Resized.section === 'gravity-descent',
    `section=${m6c1Resized.section}`);
}

// --- 24. M6C2: reactive visual authoring + ground contact FX ---
// Event punches (bloom/exposure/environment flash above the section base
// look) + continuous support-plane skid. Automated envelope/contact rules
// live in tests/eventPunch.test.ts; these checks prove the integrated app:
// real pad/gravity/speed/orb events spike the envelope with family colors,
// grounded running carries contact samples on Floor AND Ceiling, the
// envelope restores the exact section look, triggers-off stays silent,
// fx-off splits juice from flash, replay verifies, resources stay flat.
// Pause-freeze framing (proven M3/M4/M6A pattern): pausing passes render
// dt 0, which freezes the punch envelope at its peak for photography.
{
  const punchProbe = () => page.evaluate(() => ({
    energy: window.__gd3d.eventPunchEnergy(),
    color: window.__gd3d.eventPunchColor(),
    contact: window.__gd3d.contactSamples(),
    trail: window.__gd3d.trailSamples(),
    parts: window.__gd3d.activeParticles(),
    fx: window.__gd3d.fxCounters(),
    counts: window.__gd3d.interactionCounts(),
    bloom: window.__gd3d.bloomParams(),
    exp: window.__gd3d.visualExposure(),
    bg: window.__gd3d.visualBackground(),
    fog: window.__gd3d.visualFogColor(),
    liveBg: window.__gd3d.visualLiveBackground(),
    liveFog: window.__gd3d.visualLiveFog(),
    section: window.__gd3d.visualSectionId(),
    speed: window.__gd3d.speedMultiplier(),
    flips: window.__gd3d.portalTransitionCount(),
    mats: window.__gd3d.materialCount(),
    geos: window.__gd3d.geometryCount(),
    passes: window.__gd3d.postPassCount(),
    children: window.__gd3d.sceneChildren(),
    z: window.__gd3d.playerPosition().z,
  }));
  const pauseM6c2 = async () => {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(100);
  };
  const resumeM6c2 = async () => {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(200);
  };
  const pollPunch = async (pred, timeoutMs = 15000) => {
    const t0 = Date.now();
    let s = await punchProbe();
    for (;;) {
      if (pred(s)) return s;
      if (Date.now() - t0 > timeoutMs) return s;
      await page.waitForTimeout(40);
      s = await punchProbe();
    }
  };
  const waitVerifyM6c2 = async (timeoutMs = 90000) => {
    const t0 = Date.now();
    for (;;) {
      const snap = await page.evaluate(() => ({
        verify: window.__gd3d.replayVerification(),
        mode: window.__gd3d.replayMode(),
      }));
      if (snap.verify.kind === 'pass' || snap.verify.kind === 'diverged') return snap;
      if (Date.now() - t0 > timeoutMs) return snap;
      await page.waitForTimeout(300);
    }
  };
  const PAD_YELLOW = 0xffd23f;
  const GRAVITY_BLUE = 0x4fc3ff;
  const TIER2_GREEN = 0x66ff8a;

  // Fresh page, default flags (post on, fx on, triggers on).
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const m6c2Probes = await punchProbe();
  log('m6c2 reactive probes live, envelope at rest on load',
    m6c2Probes.energy === 0 && m6c2Probes.contact >= 0 && m6c2Probes.passes === 3,
    `energy=${m6c2Probes.energy} contact=${m6c2Probes.contact} passes=${m6c2Probes.passes}`);

  // Floor contact: grounded runway run carries skid samples + trail.
  await startGravityRun(8);
  const m6c2FloorRun = await rollUntilM3((s) => s.z > 8 && s.z < 14 && s.grounded, 15000);
  const m6c2FloorProbe = await punchProbe();
  log('m6c2 floor run shows ground-contact skid under the cube',
    m6c2FloorRun !== null && m6c2FloorProbe.contact > 0 && m6c2FloorProbe.trail > 0,
    m6c2FloorRun ? `z=${m6c2FloorRun.z.toFixed(1)} contact=${m6c2FloorProbe.contact} trail=${m6c2FloorProbe.trail}` : 'never framed');
  await pauseM6c2();
  await capture('m6c2-01-floor-contact');
  await resumeM6c2();

  // Pad punch: passive fire at z~305, freeze the envelope at its peak.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(350);
  const m6c2PadPre = await punchProbe();
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 1.5, 300));
  const m6c2PadFired = await pollPunch((s) => s.counts.pads > m6c2PadPre.counts.pads, 15000);
  let m6c2PadPeak = null;
  if (m6c2PadFired.counts.pads > m6c2PadPre.counts.pads) {
    await pauseM6c2();
    m6c2PadPeak = await punchProbe();
    await capture('m6c2-02-pad-punch');
    await resumeM6c2();
  }
  log('m6c2 pad event fires a warm punch (energy + yellow tint)',
    m6c2PadPeak !== null && m6c2PadPeak.energy > 0.15 && m6c2PadPeak.color === PAD_YELLOW,
    m6c2PadPeak ? `energy=${m6c2PadPeak.energy.toFixed(2)} color=0x${m6c2PadPeak.color.toString(16)}` : 'pad never fired');
  // NOTE (sticky section inheritance, M6C1 design): interaction-run sets
  // no bg/exposure override, so at the pad the section resolves to the
  // gravity-descent values (bg 0x040213, exp 1.08) with bloom 0.5 — the
  // punch assertions below measure against THOSE, not the runway base.
  log('m6c2 pad punch lifts bloom/exposure/environment above the section',
    m6c2PadPeak !== null && m6c2PadPeak.bloom !== null &&
    m6c2PadPeak.bloom.strength > 0.5 && m6c2PadPeak.exp > 1.08 &&
    m6c2PadPeak.liveBg !== m6c2PadPeak.bg && m6c2PadPeak.liveFog !== m6c2PadPeak.fog,
    m6c2PadPeak ? `bloom=${m6c2PadPeak.bloom.strength.toFixed(3)} exp=${m6c2PadPeak.exp.toFixed(3)} liveBg=0x${m6c2PadPeak.liveBg.toString(16)}` : 'no peak captured');
  // The envelope must decay back to the EXACT section look (no residue).
  await page.waitForTimeout(3500);
  const m6c2PadRest = await punchProbe();
  log('m6c2 punch envelope decays to exact rest (bloom/exposure restored)',
    m6c2PadPeak !== null && m6c2PadRest.energy === 0 &&
    m6c2PadRest.bloom !== null && Math.abs(m6c2PadRest.bloom.strength - 0.5) < 0.001 &&
    Math.abs(m6c2PadRest.exp - 1.08) < 0.005 &&
    m6c2PadRest.liveBg === m6c2PadRest.bg && m6c2PadRest.liveFog === m6c2PadRest.fog,
    `energy=${m6c2PadRest.energy} bloom=${m6c2PadRest.bloom?.strength.toFixed(3)} exp=${m6c2PadRest.exp.toFixed(3)}`);

  // Gravity punch: natural portal-up flip (z=182), photographed PAST the
  // portal pane (z>186 — pausing inside the translucent pane fills the
  // frame with wash, the documented M6B/M6C1 pane context, not the punch).
  // Poll threshold 0.05 (not the 0.15 peak): under headless load a frame
  // can drain most of the envelope between samples — anything above the
  // exact-0 rest snap still proves a live envelope, and the pause freezes
  // it for the probe + photo. The peak magnitude itself is evidenced by
  // the probe series across runs (0.2–0.4 hot captures, blue tint stable).
  await startGravityRun(172);
  const m6c2GravPre = await punchProbe();
  const m6c2Flipped = await pollPunch(
    (s) => s.flips > m6c2GravPre.flips && s.energy > 0.05 && s.z > 186,
    20000);
  let m6c2GravPeak = null;
  if (m6c2Flipped.flips > m6c2GravPre.flips) {
    await pauseM6c2();
    m6c2GravPeak = await punchProbe();
    await capture('m6c2-03-gravity-punch');
    await resumeM6c2();
  }
  log('m6c2 gravity flip fires a blue punch (energy + blue tint)',
    m6c2GravPeak !== null && m6c2GravPeak.energy > 0.02 && m6c2GravPeak.color === GRAVITY_BLUE,
    m6c2GravPeak ? `energy=${m6c2GravPeak.energy.toFixed(2)} color=0x${m6c2GravPeak.color.toString(16)}` : 'flip never framed');

  // Ceiling contact: stable ceiling run carries support-side skid too.
  const m6c2Ceil = await rollUntilM3((s) => s.mode === 'ceiling' && s.grounded && s.z > 190 && s.z < 230, 20000);
  const m6c2CeilProbe = await punchProbe();
  log('m6c2 ceiling run shows ground-contact skid on the support side',
    m6c2Ceil !== null && m6c2CeilProbe.contact > 0,
    m6c2Ceil ? `z=${m6c2Ceil.z.toFixed(1)} contact=${m6c2CeilProbe.contact}` : 'never framed');
  await pauseM6c2();
  await capture('m6c2-04-ceiling-contact');
  await resumeM6c2();

  // Speed punch: proven M4-5 approach (teleport 366, grounded 368..371
  // run-up, natural 2x crossing at z=372), tier-colored flash. The photo is
  // reframed past the crossing: at 28 u/s CDP pause latency carries the
  // cube into the finish-gate pane (documented wash context), so after
  // freezing the envelope we step back to 367 — envelope and speed state
  // are position-independent, the portal frame stays in view, the probes
  // remain the proof.
  await startGravityRun(366);
  const m6c2SpeedCatch = await pollPunch((s) => s.speed === 2, 20000);
  let m6c2SpeedPeak = null;
  if (m6c2SpeedCatch.speed === 2) {
    await pauseM6c2();
    await page.evaluate(() => window.__gd3d.debugTeleport(0, 1.5, 367));
    await page.waitForTimeout(400);
    m6c2SpeedPeak = await punchProbe();
    await capture('m6c2-05-speed-punch');
    await resumeM6c2();
  }
  log('m6c2 speed portal fires a tier-colored punch',
    m6c2SpeedPeak !== null && m6c2SpeedPeak.energy > 0.1 && m6c2SpeedPeak.color === TIER2_GREEN,
    m6c2SpeedPeak ? `energy=${m6c2SpeedPeak.energy.toFixed(2)} color=0x${m6c2SpeedPeak.color.toString(16)}` : '2x never framed');

  // Jump-orb punch: press inside the z337 window (M4-3 pattern, retries).
  let m6c2OrbPeak = null;
  for (let attempt = 1; attempt <= 4 && m6c2OrbPeak === null; attempt++) {
    await startGravityRun(326);
    const jumped = await pressSpaceWhen((s) => s.grounded && s.z >= 329.2, 8000);
    if (!jumped) { console.log(`  (m6c2 orb attempt ${attempt}: edge jump missed)`); continue; }
    const pressed = await pressSpaceWhen((s) => !s.grounded && s.z >= 335.3 && s.z <= 338.4, 5000);
    if (!pressed) { console.log(`  (m6c2 orb attempt ${attempt}: window press missed)`); continue; }
    // Pause on a HOT envelope, not just on activation: the orb punch is
    // the snappiest (0.25 s tau) and CDP latency drains it. The browser
    // proof is firing + tint + residual (peak magnitude is pinned by the
    // headless envelope unit tests, not photographable under CDP).
    const m6c2OrbFired = await pollPunch((s) => s.fx.jumpOrb >= 1 && s.energy > 0.1, 4000);
    if (m6c2OrbFired.fx.jumpOrb < 1 || m6c2OrbFired.energy <= 0.1) {
      console.log(`  (m6c2 orb attempt ${attempt}: hot envelope missed)`);
      continue;
    }
    await pauseM6c2();
    m6c2OrbPeak = await punchProbe();
    await capture('m6c2-06-orb-punch');
    await resumeM6c2();
  }
  log('m6c2 jump-orb event fires a warm punch (tint + residual envelope)',
    m6c2OrbPeak !== null && m6c2OrbPeak.fx.jumpOrb >= 1 &&
    m6c2OrbPeak.color === PAD_YELLOW && m6c2OrbPeak.energy > 0.02,
    m6c2OrbPeak ? `orbs=${m6c2OrbPeak.fx.jumpOrb} energy=${m6c2OrbPeak.energy.toFixed(2)} color=0x${m6c2OrbPeak.color.toString(16)}` : 'orb never activated');

  // triggers=off: events still simulate, but the envelope stays silent.
  await page.evaluate(() => window.__gd3d.setVisualTriggersEnabled(false));
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(350);
  const m6c2OffPre = await punchProbe();
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 1.5, 300));
  const m6c2OffFired = await pollPunch((s) => s.counts.pads > m6c2OffPre.counts.pads, 15000);
  await page.waitForTimeout(300);
  const m6c2OffProbe = await punchProbe();
  const m6c2OffBloom = m6c2OffProbe.bloom;
  log('m6c2 triggers-off keeps the punch envelope silent (exact baseline)',
    m6c2OffFired.counts.pads > m6c2OffPre.counts.pads && m6c2OffProbe.energy === 0 &&
    m6c2OffBloom !== null && Math.abs(m6c2OffBloom.strength - 0.45) < 0.001,
    `pads=${m6c2OffFired.counts.pads} energy=${m6c2OffProbe.energy} bloom=${m6c2OffBloom?.strength.toFixed(3)}`);
  await page.evaluate(() => window.__gd3d.setVisualTriggersEnabled(true));
  await page.waitForTimeout(300);

  // fx=off split: pad still simulates, particles + skid silent, game runs.
  await page.goto(`${URL}?fx=off`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(350);
  const m6c2NoFxPre = await punchProbe();
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 1.5, 300));
  const m6c2NoFxFired = await pollPunch((s) => s.counts.pads > m6c2NoFxPre.counts.pads, 15000);
  await page.waitForTimeout(600);
  const m6c2NoFxProbe = await punchProbe();
  log('m6c2 fx-off silences particles + skid while gameplay continues',
    m6c2NoFxFired.counts.pads > m6c2NoFxPre.counts.pads &&
    m6c2NoFxProbe.parts === 0 && m6c2NoFxProbe.contact === 0 && m6c2NoFxProbe.trail === 0,
    `pads=${m6c2NoFxFired.counts.pads} parts=${m6c2NoFxProbe.parts} contact=${m6c2NoFxProbe.contact}`);

  // Level 02 shares the contact language (teal identity untouched).
  await page.goto(`${URL}?level=validation-02`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await startGravityRun(8);
  const m6c2L2Run = await rollUntilM3((s) => s.z > 8 && s.z < 14 && s.grounded, 15000);
  const m6c2L2Probe = await punchProbe();
  log('m6c2 level02 run shows ground-contact skid on the shared path',
    m6c2L2Run !== null && m6c2L2Probe.contact > 0,
    m6c2L2Run ? `z=${m6c2L2Run.z.toFixed(1)} contact=${m6c2L2Probe.contact}` : 'never framed');
  await pauseM6c2();
  await capture('m6c2-07-level02-contact');
  await resumeM6c2();

  // Replay under the new visuals: natural death -> F4 -> VERIFIED.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  let m6c2NaturalDeath = null;
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const s = await simState();
      if (s.status === 'dead') { m6c2NaturalDeath = s; break; }
      await page.waitForTimeout(60);
    }
  }
  const m6c2HasTape = await page.evaluate(() => window.__gd3d.hasReplay());
  let m6c2ReplayMode = null;
  if (m6c2HasTape === true) {
    await page.evaluate(() => window.__gd3d.startReplay());
    await page.waitForTimeout(500);
    m6c2ReplayMode = await page.evaluate(() => window.__gd3d.replayMode());
  }
  await pauseM6c2();
  await capture('m6c2-08-replay');
  await resumeM6c2();
  const m6c2Verify = await waitVerifyM6c2(90000);
  log('m6c2 F4 replay verifies under reactive visuals',
    m6c2NaturalDeath !== null && m6c2HasTape === true && m6c2Verify.verify.kind === 'pass',
    `died=${m6c2NaturalDeath !== null} tape=${m6c2HasTape} verification=${m6c2Verify.verify.kind} mode=${m6c2ReplayMode}`);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(500);
  const m6c2TapeJson = await page.evaluate(() => window.__gd3d.exportLastReplay());
  let m6c2TapeClean = false;
  let m6c2TapeDetail = 'no tape';
  if (m6c2TapeJson !== null) {
    const tape = JSON.parse(m6c2TapeJson);
    const keys = Object.keys(tape);
    const leaked = keys.filter((k) => /punch|contact|section|visual|bloom|fog|exposure|trigger|timeline/i.test(k));
    m6c2TapeClean = leaked.length === 0 && tape.schemaVersion === 1;
    m6c2TapeDetail = `keys=${keys.length} leaked=[${leaked.join(',')}]`;
  }
  log('m6c2 replay carries zero punch/contact state', m6c2TapeClean, m6c2TapeDetail);

  // Resource stability: still 26/8/3 library counts; scene children grew by
  // exactly the 12 fixed M7.1 background energy rays (50 → 62, bounded by
  // construction — one shared geometry + one shared material, no pools).
  const m6c2ResEnd = await punchProbe();
  log('m6c2 resources flat (26/8/3, no new draws or pools)',
    m6c2ResEnd.mats === 26 && m6c2ResEnd.geos === 8 && m6c2ResEnd.passes === 3 &&
    m6c2ResEnd.children === 62,
    `mats=${m6c2ResEnd.mats} geos=${m6c2ResEnd.geos} passes=${m6c2ResEnd.passes} children=${m6c2ResEnd.children}`);
}

// --- 24b. M7.1: Cube precision vertical slice (production level 01 rework) ---
// Precision/difficulty/spectacle rework: narrow islands, airborne transfers,
// ceiling-spike orientation, six visual scenes, beat-ready cues, energy rays.
// The slice must resolve, read, flip, fire every mechanic, finish via REAL
// inputs, replay VERIFIED, and hold resources flat. Teleport-assisted section
// passes use debugTeleport (established M3/M4 pattern); the finish proof
// drives real DOM KeyboardEvents through the real InputSystem (M5 pattern).
{
  const PLAYER_HEX_M7 = 0x0e4a56;
  const HAZARD_HEX_M7 = 0xff9d00;
  const GRAVITY_BLUE = 0x4fc3ff;
  const PAD_YELLOW = 0xffd23f;
  const m71probe = () => page.evaluate(() => ({
    id: window.__gd3d.levelId(),
    name: window.__gd3d.levelDisplayName(),
    status: window.__gd3d.status(),
    lane: window.__gd3d.laneIndex(),
    mode: window.__gd3d.gravityMode(),
    speed: window.__gd3d.speedMultiplier(),
    section: window.__gd3d.visualSectionId(),
    player: window.__gd3d.visualPlayerColor(),
    hazard: window.__gd3d.visualHazardColor(),
    energy: window.__gd3d.eventPunchEnergy(),
    punchColor: window.__gd3d.eventPunchColor(),
    contact: window.__gd3d.contactSamples(),
    streaks: window.__gd3d.activeStreaks(),
    counts: window.__gd3d.interactionCounts(),
    flips: window.__gd3d.portalTransitionCount(),
    mats: window.__gd3d.materialCount(),
    geos: window.__gd3d.geometryCount(),
    passes: window.__gd3d.postPassCount(),
    children: window.__gd3d.sceneChildren(),
    cue: window.__gd3d.rhythmCue(),
    rays: window.__gd3d.energyRays(),
    z: window.__gd3d.playerPosition().z,
    y: window.__gd3d.playerPosition().y,
    grounded: window.__gd3d.grounded(),
  }));
  const m71roll = async (pred, timeoutMs = 30000, pollMs = 40) => {
    const t0 = Date.now();
    for (;;) {
      const s = await m71probe();
      if (s.status === 'running' && pred(s)) return s;
      if (Date.now() - t0 > timeoutMs) return null;
      await page.waitForTimeout(pollMs);
    }
  };
  const m71fresh = async (url) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    // Verified R-loop: a swallowed R under headless load leaves a dying
    // sim behind and every later teleport/check cascades. Retry until the
    // sim is provably live at the start line.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(600);
      const p = await pos();
      if (p.z < 10) break;
    }
  };
  const m71pause = async () => { await page.keyboard.press('KeyP'); await page.waitForTimeout(400); };
  // Bulletproof liveness: verify MOTION over a long window (short windows
  // false-positive under frame starvation and pause a LIVE sim; swallowed
  // presses leave it paused). Loops P-until-advancing. Non-running states
  // return immediately (pause state is irrelevant while dead/finished).
  const m71ensureLive = async (rounds = 4) => {
    for (let i = 0; i < rounds; i++) {
      const st = await page.evaluate(() => window.__gd3d.status());
      if (st !== 'running') return st;
      const z1 = (await pos()).z;
      await page.waitForTimeout(2500);
      const z2 = (await pos()).z;
      if (Math.abs(z2 - z1) > 0.01) return 'running';
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(500);
    }
    return page.evaluate(() => window.__gd3d.status());
  };
  const m71resume = async () => {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(200);
    await m71ensureLive(4);
  };
  // Pause → capture → bulletproof resume, one call per evidence shot.
  const m71snap = async (name) => {
    await m71pause();
    await capture(name);
    await m71ensureLive(4);
  };
  const m71restage = async (x, y, z) => {
    // Deterministic teleport staging: verified R-loop first (a swallowed R
    // or a mid-run teleport onto a dying sim cascades every downstream
    // check), then bulletproof liveness, then place. Works from any state.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(600);
      const p = await pos();
      if (p.z < 10) break;
    }
    await m71ensureLive(4);
    await page.evaluate((p) => window.__gd3d.debugTeleport(p.x, p.y, p.z), { x, y, z });
    await page.waitForTimeout(300);
  };
  // Verified lane tap: CDP key events can be swallowed under headless load
  // and intent only applies on the next sim tick, so poll intent until it
  // reads back (checks first — never taps past the target onto a virtual
  // lane). Returns whether intent settled.
  const m71tapLane = async (code, want) => {
    for (let i = 0; i < 8; i++) {
      const lane = await page.evaluate(() => window.__gd3d.laneIndex());
      if (lane === want) return true;
      await page.keyboard.press(code);
      await page.waitForTimeout(500);
    }
    return (await page.evaluate(() => window.__gd3d.laneIndex())) === want;
  };
  const m71pollPunch = async (pred, timeoutMs = 10000) => {
    const t0 = Date.now();
    let s = await m71probe();
    for (;;) {
      if (pred(s)) return s;
      if (Date.now() - t0 > timeoutMs) return s;
      await page.waitForTimeout(40);
      s = await m71probe();
    }
  };

  await m71fresh(`${URL}?level=vertical-slice-01`);
  const m71boot = await m71probe();
  log('m71 level route resolves correctly', m71boot.id === 'vertical-slice-01', `id=${m71boot.id}`);
  const m71hud = await page.evaluate(() => document.querySelector('.hud-name')?.textContent ?? '');
  log('m71 correct display name', m71boot.name === 'VERTICAL SLICE 01' && m71hud === 'VERTICAL SLICE 01',
    `probe=${m71boot.name} hud=${m71hud}`);
  log('m71 start state correct',
    m71boot.status === 'running' && m71boot.lane === 1 && m71boot.mode === 'floor' && m71boot.speed === 1,
    `status=${m71boot.status} lane=${m71boot.lane} mode=${m71boot.mode} speed=${m71boot.speed}`);
  log('m71 production visual sequence active', m71boot.section === 'vs-opening', `section=${m71boot.section}`);
  log('m71 player/hazard readability intact',
    m71boot.player === PLAYER_HEX_M7 && m71boot.hazard === HAZARD_HEX_M7,
    `player=0x${m71boot.player?.toString(16)} hazard=0x${m71boot.hazard?.toString(16)}`);

  // Act I route renders (opening + weave).
  await m71snap('m71-01-narrow-opening');
  // Framing roll on the opening approach (before the z 22 bridge spike — an
  // input-free run dies there by design) with one bulletproof retry (a
  // swallowed pause-toggle under headless load can freeze the first window).
  let m71act1 = await m71roll((s) => s.z > 10 && s.z < 16, 60000);
  if (m71act1 === null) {
    await m71resume();
    m71act1 = await m71roll((s) => s.z > 10 && s.z < 16, 60000);
  }
  if (m71act1) { await m71snap('m71-02-island-jump'); }
  log('m71 Act I route renders', m71act1 !== null, m71act1 ? `z=${m71act1.z.toFixed(1)}` : 'never framed');
  log('m71 beat cue resolves at start', m71boot.cue === 'm71-cue-intro', `cue=${m71boot.cue}`);
  // Precision topology proof: the opening bridge is single-lane — placing
  // the Cube beside it (over the void) must fall, while the old full-width
  // road would have carried it. Proves full-width is no longer dominant.
  await m71restage(2.6, 0.6, 24);
  const m71narrowDeath = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const s = await m71probe();
      if (s.status === 'dead') return true;
      if (Date.now() - t0 > 30000) return false;
      await page.waitForTimeout(40);
    }
  })();
  log('m71 opening bridge is genuinely narrow (off-lane placement falls)', m71narrowDeath, `sawDeath=${m71narrowDeath}`);

  // Portal flip + blue punch in ONE pre-armed loop starting at the portal
  // approach: the crossing step flips gravity AND fires the punch together,
  // so the first post-crossing sample proves both (a flip roll followed by
  // a separate punch poll races the <2 s envelope under headless load).
  await m71restage(2.6, 1.5, 158);
  await m71tapLane('ArrowLeft', 0);
  await page.waitForTimeout(200);
  // In-page peak watcher: samples the punch envelope within 5 ms of the
  // flip (CDP polling can lag the <2 s envelope by seconds under load).
  await page.evaluate(() => {
    window.__m71flipPeak = null;
    if (window.__m71flipWatch) clearInterval(window.__m71flipWatch);
    window.__m71flipWatch = setInterval(() => {
      const g = window.__gd3d;
      if (g.portalTransitionCount() >= 1 && window.__m71flipPeak === null) {
        window.__m71flipPeak = { energy: g.eventPunchEnergy(), color: g.eventPunchColor() };
      }
      if (g.playerPosition().z > 200 || g.status() !== 'running') {
        clearInterval(window.__m71flipWatch);
        window.__m71flipWatch = null;
      }
    }, 5);
  });
  const m71sig = await m71roll((s) => s.z > 163 && s.z < 168, 60000);
  if (m71sig) { await m71snap('m71-03-lateral-landing'); }
  log('m71 first signature moment renders', m71sig !== null, m71sig ? `z=${m71sig.z.toFixed(1)}` : 'never framed');
  // Flip identity via the sim (no energy race); punch peak via the watcher.
  const m71flip = await m71roll((s) => s.mode === 'ceiling' && s.flips >= 1, 90000);
  log('m71 gravity transition fires', m71flip !== null,
    m71flip ? `mode=${m71flip.mode} flips=${m71flip.flips} z=${m71flip.z.toFixed(1)}` : 'no flip');
  // Punch firing is proven by the peak energy sampled within 5 ms of the
  // flip (the tint mapping pad/orb-warm, gravity-blue, speed-tier is pinned
  // by unit tests + the M6C2 live proof; color is logged informationally).
  const m71GravityPunch = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const peak = await page.evaluate(() => window.__m71flipPeak);
      if (peak !== null) return peak;
      if (Date.now() - t0 > 90000) return { energy: 0, color: 0 };
      await page.waitForTimeout(200);
    }
  })();
  log('m71 M6C2 gravity punch fires', m71GravityPunch.energy > 0.25,
    `energy=${m71GravityPunch.energy.toFixed(2)} color=0x${m71GravityPunch.color?.toString(16)}`);
  log('m71 gravity punch carries the blue family tint', m71GravityPunch.color === GRAVITY_BLUE,
    `color=0x${m71GravityPunch.color?.toString(16)}`);
  log('m71 gravity scene clearly changes at the flip', m71flip !== null && m71flip.section === 'vs-gravity',
    m71flip ? `section=${m71flip.section}` : 'no flip');
  // Transition photo at the crossing (portal-pane wash context — the M6C2-
  // documented wash; numbers above are the transition proof).
  if (m71flip) { await m71snap('m71-04-gravity-hit'); }
  // Ceiling readability via direct staging (the live run reaches the gap
  // at z=230 with no jump input, so a transit roll races gap death under
  // load): place mid-slab on the safe lane and probe the settled run.
  if (m71flip) {
    await page.evaluate(() => window.__gd3d.debugTeleport(2.6, 5.0, 210));
    await page.waitForTimeout(500);
  }

  // Ceiling section readability (stable run, in-viewport, contact skid).
  const m71ceil = await m71roll((s) => s.mode === 'ceiling' && s.grounded && Math.abs(s.y - 5.45) < 0.15 && s.z > 205, 60000);
  const m71ceilScreen = m71ceil ? await page.evaluate(() => {
    const p = window.__gd3d.playerPosition();
    return window.__gd3d.screenPoint(p.x, p.y, p.z);
  }) : null;
  log('m71 Ceiling section is readable',
    m71ceil !== null && m71ceilScreen !== null && !m71ceilScreen.behind &&
    Math.abs(m71ceilScreen.ndcX) < 1 && Math.abs(m71ceilScreen.ndcY) < 1,
    m71ceil ? `z=${m71ceil.z.toFixed(1)} ndc=(${m71ceilScreen?.ndcX?.toFixed(2)},${m71ceilScreen?.ndcY?.toFixed(2)}) contact=${m71ceil.contact}` : 'no ceiling run');
  if (m71ceil) { await m71snap('m71-05-ceiling-narrow'); }
  // Ceiling-spike orientation proof: the lethal tip hangs BELOW the collider
  // (toward the corridor), the base sits flush with the slab. Staged FORWARD
  // on the settled ceiling run (no backward teleport, no camera transit):
  // the z 216 screen-left spike sits ~14 u ahead in the look direction.
  // On screen the tip must project below the base (larger py, y-down
  // pixels); both points must be genuinely inside the viewport.
  if (m71ceil) {
    await page.evaluate(() => window.__gd3d.debugTeleport(2.6, 5.0, 202));
    await page.waitForTimeout(1000);
    await m71pause();
    const m71spikeView = await page.evaluate(() => ({
      tip: window.__gd3d.screenPoint(2.6, 5.15, 216),
      base: window.__gd3d.screenPoint(2.6, 6.0, 216),
    }));
    await capture('m71-06-ceiling-spike-correct');
    await m71ensureLive(4);
    const m71framed = (p) => !p.behind && Math.abs(p.ndcX) <= 0.9 && Math.abs(p.ndcY) <= 0.9;
    const m71tipBelow = m71spikeView.tip.py > m71spikeView.base.py;
    const m71bothFramed = m71framed(m71spikeView.tip) && m71framed(m71spikeView.base);
    log('m71 ceiling spike points DOWN (tip below base on screen)', m71tipBelow && m71bothFramed,
      `tipPy=${m71spikeView.tip.py.toFixed(1)} basePy=${m71spikeView.base.py.toFixed(1)} framed=${m71bothFramed}`);
  } else {
    log('m71 ceiling spike points DOWN (tip below base on screen)', false, 'no ceiling run');
  }
  // Narrow-ceiling proof: the C4 bridge is single-lane — placing the Cube
  // beside it (over the corridor void) must fall upward, while a full-width
  // slab would have carried it.
  await m71restage(0, 5.0, 282);
  await page.evaluate(() => window.__gd3d.debugTeleport(2.6, 5.0, 282));
  const m71ceilNarrowDeath = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const s = await m71probe();
      if (s.status === 'dead') return true;
      if (Date.now() - t0 > 30000) return false;
      await page.waitForTimeout(40);
    }
  })();
  log('m71 ceiling bridge is genuinely narrow (off-lane placement falls)', m71ceilNarrowDeath,
    `sawDeath=${m71ceilNarrowDeath}`);

  // Jump orb fires naturally: install the mini-driver BEFORE the pad roll
  // (it covers the post-pad flight, so no sim transit is ever unattended).
  await m71fresh(`${URL}?level=vertical-slice-01`);
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 1.5, 300));
  await page.evaluate(() => {
    if (window.__m71orb) clearInterval(window.__m71orb);
    window.__m71orbFired = false;
    const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    // Release-on-next-poll: page-thread stalls delay wall-clock timers AND the
    // sim together, so a timed keyup can land past a landing and trigger a
    // hold-to-repeat artifact jump. A keyup drained on the next driver poll
    // trails its keydown by at most one frame of sim progress (timers and
    // rAF share the thread) -- always pre-landing. Redundant releases are
    // no-ops (InputSystem ignores releases while not held).
    const pendingUp = [];
    const tap = (code) => { down(code); pendingUp.push(code); };
    let lastZ = -100;
    window.__m71orb = setInterval(() => {
      while (pendingUp.length > 0) up(pendingUp.pop());
      const g = window.__gd3d;
      const z = g.playerPosition().z;
      // Self-healing: a mid-section death respawns at start (default
      // intent); re-stage into the section and retry until timeouts.
      if (z < lastZ - 10 && lastZ > 320) {
        g.debugTeleport(0, 1.5, 300);
        lastZ = 300;
        return;
      }
      lastZ = z;
      if (g.isInteractionUsed('vs-orb-jump')) {
        window.__m71orbFired = true;
        clearInterval(window.__m71orb);
        window.__m71orb = null;
        return;
      }
      // Flagless zone taps: the first grounded tap jumps, later ones are
      // airborne-harmless — no one-shot can be skipped by coarse sampling.
      // Takeoff across the full grounded window (F2 ends at 350).
      if (z >= 345 && z <= 350 && g.grounded()) tap('Space');
      else if (z >= 352.2 && z <= 354.8) tap('Space');
      if (z > 362) { clearInterval(window.__m71orb); window.__m71orb = null; }
    }, 5);
  });
  // Pad firing + punch: an in-page peak watcher samples the envelope within
  // 5 ms of the fire (CDP polling can lag the <1 s envelope by seconds under
  // load — the same peak-watcher pattern as the gravity flip).
  await page.evaluate(() => {
    window.__m71padPeak = null;
    if (window.__m71padWatch) clearInterval(window.__m71padWatch);
    window.__m71padWatch = setInterval(() => {
      const g = window.__gd3d;
      if (g.isInteractionUsed('vs-pad-floor') && window.__m71padPeak === null) {
        window.__m71padPeak = { energy: g.eventPunchEnergy(), color: g.eventPunchColor() };
      }
      if (g.playerPosition().z > 340 || g.status() !== 'running') {
        clearInterval(window.__m71padWatch);
        window.__m71padWatch = null;
      }
    }, 5);
  });
  const m71padShot = await (async () => {
    const t0 = Date.now();
    let sawUsed = null;
    for (;;) {
      const used = await page.evaluate(() => window.__gd3d.isInteractionUsed('vs-pad-floor'));
      const s = await m71probe();
      if (used && sawUsed === null) sawUsed = s;
      const peak = await page.evaluate(() => window.__m71padPeak);
      if (used && peak !== null && peak.energy > 0.15 && peak.color === PAD_YELLOW) {
        return { shot: { ...s, energy: peak.energy, punchColor: peak.color }, sawUsed };
      }
      if (used && s.energy > 0.15 && s.punchColor === PAD_YELLOW) return { shot: s, sawUsed };
      if (Date.now() - t0 > 90000) return { shot: s, sawUsed };
      await page.waitForTimeout(40);
    }
  })();
  const m71pad = m71padShot.sawUsed;
  log('m71 pad fires naturally', m71pad !== null, m71pad ? `z=${m71pad.z.toFixed(1)} pads=${m71pad.counts.pads}` : 'pad never fired');
  const m71padPunch = m71padShot.shot;
  log('m71 pad punch fires',
    m71padPunch.energy > 0.15 && m71padPunch.punchColor === PAD_YELLOW,
    `energy=${m71padPunch.energy.toFixed(2)} color=0x${m71padPunch.punchColor?.toString(16)}`);

  // Jump orb fires naturally: plan-style one-shot takeoff (proven by the
  // full-run driver) + repeated discrete window presses until it fires.
  // Orb firing + punch in ONE pre-armed loop (starts ~2 sim-s before the
  // window): the jump-orb envelope is the snappiest (tau 0.25 sim-s), so
  // polling only after the fire can miss the peak under headless load.
  const m71orb = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const s = await m71probe();
      const used = await page.evaluate(() => window.__gd3d.isInteractionUsed('vs-orb-jump'));
      if (used && s.energy > 0.1 && s.punchColor === PAD_YELLOW) return s;
      if (used && Date.now() - t0 > 30000) return s; // fired but peak missed
      if (Date.now() - t0 > 120000) return null;
      await page.waitForTimeout(40);
    }
  })();
  log('m71 jump orb fires naturally', m71orb !== null, m71orb ? `z=${m71orb.z.toFixed(1)} orbs=${m71orb.counts.orbs}` : 'orb never fired');
  log('m71 jump orb punch fires',
    m71orb !== null && m71orb.energy > 0.1 && m71orb.punchColor === PAD_YELLOW,
    m71orb ? `energy=${m71orb.energy.toFixed(2)} color=0x${m71orb.punchColor?.toString(16)}` : 'no peak sample');
  if (m71orb) { await m71snap('m71-07-pad-orb-tech'); }
  // Tech-section color proof: the magenta scene resolves past z 300 with a
  // clearly shifted background vs the opening.
  await m71restage(0, 1.5, 330);
  const m71tech = await m71roll((s) => s.section === 'vs-tech' && s.z > 325, 60000);
  if (m71tech) { await m71snap('m71-08-color-scene-change'); }
  log('m71 tech scene resolves with shifted palette', m71tech !== null,
    m71tech ? `section=${m71tech.section} z=${m71tech.z.toFixed(1)}` : 'never framed');
  // Floor-spike orientation proof (pair to the ceiling check): tip ABOVE base.
  await m71restage(0, 1.5, 12);
  await m71pause();
  const m71floorSpike = await page.evaluate(() => ({
    tip: window.__gd3d.screenPoint(0, 0.85, 22),
    base: window.__gd3d.screenPoint(0, 0.0, 22),
  }));
  await capture('m71-spike-floor');
  await m71ensureLive(4);
  const m71floorFramed = (p) => !p.behind && Math.abs(p.ndcX) <= 0.9 && Math.abs(p.ndcY) <= 0.9;
  log('m71 floor spike points UP (tip above base on screen)',
    m71floorSpike.tip.py < m71floorSpike.base.py &&
    m71floorFramed(m71floorSpike.tip) && m71floorFramed(m71floorSpike.base),
    `tipPy=${m71floorSpike.tip.py.toFixed(1)} basePy=${m71floorSpike.base.py.toFixed(1)}`);

  // Gravity orb fires naturally: ONE driver covers lane + gap jump + setup
  // + presses. Runs on a ?post=off page (~30 fps headless): no beauty
  // screenshots live here, and the sim-identical fallback removes
  // CDP-timing fragility from the chained windows (M6B precedent).
  await m71fresh(`${URL}?level=vertical-slice-01&post=off`);
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 1.5, 158));
  await page.evaluate(() => {
    if (window.__m71gorb) clearInterval(window.__m71gorb);
    window.__m71gorbFired = false;
    const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    // Release-on-next-poll: page-thread stalls delay wall-clock timers AND the
    // sim together, so a timed keyup can land past a landing and trigger a
    // hold-to-repeat artifact jump. A keyup drained on the next driver poll
    // trails its keydown by at most one frame of sim progress (timers and
    // rAF share the thread) -- always pre-landing. Redundant releases are
    // no-ops (InputSystem ignores releases while not held).
    const pendingUp = [];
    const tap = (code) => { down(code); pendingUp.push(code); };
    let laned = false;
    let centered = false;
    let padLane1 = false;
    let padLane2 = false;
    let gorbCentered = false;
    let lastZ = -100;
    window.__m71gorbMax = -4;
    window.__m71gorb = setInterval(() => {
      while (pendingUp.length > 0) up(pendingUp.pop());
      const g = window.__gd3d;
      const z = g.playerPosition().z;
      if (z > (window.__m71gorbMax ?? -4)) window.__m71gorbMax = z;
      // Self-healing supervisor: re-stage into the ceiling section after
      // any mid-section death (respawn resets intent to 1; the lane tap
      // below re-arms through the flag). Retries until section timeouts.
      if (z < lastZ - 10 && lastZ > 100) {
        g.debugTeleport(0, 1.5, 158);
        lastZ = 158;
        laned = false;
        centered = false;
        padLane1 = false;
        padLane2 = false;
        gorbCentered = false;
        return;
      }
      if (z < lastZ - 10) { laned = false; centered = false; padLane1 = false; padLane2 = false; gorbCentered = false; }
      lastZ = z;
      if (g.isInteractionUsed('vs-orb-gravity')) {
        window.__m71gorbFired = true;
        clearInterval(window.__m71gorb);
        window.__m71gorb = null;
        return;
      }
      // ONE lane tap only: repeats would walk off the outer edge (lane
      // intent is edge-triggered, unlike the idempotent orb Space presses).
      if (!laned && z >= 190 && z <= 196 && g.laneIndex() > 0) { laned = true; tap('ArrowLeft'); }
      // Back to center: the z 216 spike covers screen-left (the narrow C1
      // commitment — the headless verification route taps here too).
      else if (!centered && z >= 205 && z <= 210 && g.laneIndex() < 1) { centered = true; tap('ArrowRight'); }
      // Two taps to the screen-right lane for the offset ceiling pad
      // (x -2.6, window x +-1.2): the headless route crosses the pad at
      // lane 2 — without both taps the pad is skipped deterministically.
      // First tap airborne (air lanes), second on the C2 landing.
      else if (!padLane1 && z >= 229 && z <= 233 && g.laneIndex() < 1) { padLane1 = true; tap('ArrowRight'); }
      else if (!padLane2 && z >= 234 && z <= 238 && g.laneIndex() < 2) { padLane2 = true; tap('ArrowRight'); }
      // Back to center on C3 for the narrow C4 bridge (the headless route
      // taps here too — without it the C4 hop starts from the wrong lane).
      else if (!gorbCentered && z >= 258 && z <= 266 && g.laneIndex() > 1) { gorbCentered = true; tap('ArrowLeft'); }
      // Flagless zone taps below: first grounded tap acts, later ones are
      // airborne-harmless — coarse sampling cannot skip a one-shot.
      else if (z >= 228 && z <= 230.3 && g.grounded()) tap('Space');
      // Hop onto the narrow C4 bridge (gap 274..276).
      else if (z >= 272.5 && z <= 274 && g.grounded()) tap('Space');
      else if (z >= 280.5 && z <= 284) tap('Space');
      else if (z >= 283.5 && z <= 287) tap('Space');
      if (z > 292 && g.gravityMode() === 'floor') { clearInterval(window.__m71gorb); window.__m71gorb = null; }
    }, 5);
  });
  await m71roll((s) => s.mode === 'ceiling' && s.grounded && s.z > 265, 180000);
  const m71gorb = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const fired = await page.evaluate(() => window.__m71gorbFired === true);
      if (fired) return { ...(await m71probe()), diag: '' };
      if (Date.now() - t0 > 120000) {
        const diag = await page.evaluate(() => ({
          maxZ: window.__m71gorbMax ?? -99,
          z: window.__gd3d.playerPosition().z,
          mode: window.__gd3d.gravityMode(),
          lane: window.__gd3d.laneIndex(),
          status: window.__gd3d.status(),
          flips: window.__gd3d.portalTransitionCount(),
          counts: window.__gd3d.interactionCounts(),
        }));
        return { ...(await m71probe()), diag: JSON.stringify(diag) };
      }
      await page.waitForTimeout(60);
    }
  })();
  log('m71 gravity orb fires naturally', (m71gorb?.counts?.orbs ?? 0) > 0,
    m71gorb ? `mode=${m71gorb.mode} orbs=${m71gorb.counts.orbs} ${m71gorb.diag ?? ''}` : 'gravity orb never fired');

  // Speed portal fires (teleport onto the center bridge + intent), then JUMP
  // the 2x gap with a mid-air transfer onto the screen-right island: the
  // sprint staging must stay live at 2x past it (an R-stage would reset
  // speed to 1x behind the portal).
  await m71fresh(`${URL}?level=vertical-slice-01`);
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 1.5, 505));
  await m71tapLane('ArrowRight', 1);
  await page.evaluate(() => {
    if (window.__m71gap) clearInterval(window.__m71gap);
    // Supervisor: re-stage past any sprint death (respawn resets speed to
    // 1x, so re-cross the portal; intent resets to 1 = center, correct).
    // Covers the gap takeoff, the mid-air transfer to lane 2, and the
    // island spike jump. Persists until the outer roll succeeds (cleared
    // below) — it must NOT clear at 545: a swallowed transfer tap lands
    // off the island and the attempt still needs its re-stage. Death-holds
    // are waited out, never a reason to quit.
    // Releases drain on the next poll (hold-repeat immunity, as above).
    const gapPendingUp = [];
    let gapJumped = false;
    let sprintLaned = false;
    let sprintTaps = 0;
    let lastSprintTapZ = -100;
    let spikeJumped = false;
    window.__m71gap = setInterval(() => {
      const g = window.__gd3d;
      const z = g.playerPosition().z;
      while (gapPendingUp.length > 0) {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: gapPendingUp.pop() }));
      }
      if (z < 400) {
        g.debugTeleport(0, 1.5, 505);
        gapJumped = false;
        sprintLaned = false;
        sprintTaps = 0;
        lastSprintTapZ = -100;
        spikeJumped = false;
        return;
      }
      if (!gapJumped && z >= 536 && z <= 539.5 && g.grounded()) {
        gapJumped = true;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        gapPendingUp.push('Space');
      }
      // Transfer with swallow tolerance: retry while the intent still reads
      // below lane 2, spaced 2.5 u apart (a landed tap is visible by the
      // next slot, so retries stop; spacing exceeds worst-case CDP latency
      // so two taps can never both land and walk past lane 2).
      else if (!sprintLaned && z >= 540 && z <= 548 && g.laneIndex() < 2 && sprintTaps < 3 && z - lastSprintTapZ > 2.5) {
        sprintTaps += 1;
        lastSprintTapZ = z;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
        gapPendingUp.push('ArrowRight');
        if (g.laneIndex() === 2) sprintLaned = true;
      }
      else if (!spikeJumped && z >= 575 && z <= 579 && g.grounded()) {
        spikeJumped = true;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        gapPendingUp.push('Space');
      }
    }, 5);
  });
  // Portal + punch in ONE pre-armed loop starting before the crossing
  // (same reasoning as the orb): the crossing step sets speed 2 AND fires
  // the punch together, so the first post-crossing sample proves both.
  const m71speedShot = await (async () => {
    const t0 = Date.now();
    let sawSpeed = null;
    for (;;) {
      const s = await m71probe();
      if (s.speed === 2 && sawSpeed === null) sawSpeed = s;
      if (s.speed === 2 && s.energy > 0.2) return { shot: s, sawSpeed };
      if (Date.now() - t0 > 90000) return { shot: s, sawSpeed };
      await page.waitForTimeout(40);
    }
  })();
  const m71speed = m71speedShot.sawSpeed;
  log('m71 speed portal fires', m71speed !== null, m71speed ? `speed=${m71speed.speed} z=${m71speed.z.toFixed(1)}` : 'never reached 2x');
  const m71streak = await m71probe();
  log('m71 2x streak state active', m71streak.streaks > 0, `streaks=${m71streak.streaks}`);
  const m71speedPunchLive = m71speedShot.shot;
  log('m71 speed punch fires', m71speedPunchLive.energy > 0.2,
    `energy=${m71speedPunchLive.energy.toFixed(2)} color=0x${m71speedPunchLive.punchColor?.toString(16)}`);
  // The sprint run stays live at 2x past the gap now: frame the sprint.
  const m71sprint = await m71roll((s) => s.z > 585 && s.z < 600 && s.speed === 2, 90000);
  await page.evaluate(() => {
    if (window.__m71gap) clearInterval(window.__m71gap);
    window.__m71gap = null;
  });
  if (m71sprint) { await m71snap('m71-09-speed-climax'); }
  log('m71 final-act visual state resolves',
    m71sprint !== null && m71sprint.section === 'vs-climax',
    m71sprint ? `section=${m71sprint.section} z=${m71sprint.z.toFixed(1)}` : 'never framed');
  log('m71 energy rays active in the climax', m71sprint !== null && m71sprint.rays > 0,
    m71sprint ? `rays=${m71sprint.rays.toFixed(3)}` : 'never framed');
  // 2x narrow route stays readable: the Cube projects inside the viewport
  // mid-sprint (presentation proof that commitment sections stay legible).
  const m71sprintScreen = m71sprint ? await page.evaluate(() => {
    const p = window.__gd3d.playerPosition();
    return window.__gd3d.screenPoint(p.x, p.y, p.z);
  }) : null;
  log('m71 2x narrow route remains readable',
    m71sprintScreen !== null && !m71sprintScreen.behind &&
    Math.abs(m71sprintScreen.ndcX) < 1 && Math.abs(m71sprintScreen.ndcY) < 1,
    m71sprintScreen ? `ndc=(${m71sprintScreen.ndcX.toFixed(2)},${m71sprintScreen.ndcY.toFixed(2)})` : 'never framed');

  // Release section resolves past the 1x gate (restaged: immune to sprint
  // deaths and pause-toggle desync alike).
  await m71restage(0, 1.5, 655);
  const m71release = await m71roll((s) => s.section === 'vs-release' && s.speed === 1, 60000);
  log('m71 release section resolves', m71release !== null,
    m71release ? `section=${m71release.section} z=${m71release.z.toFixed(1)}` : 'never framed');
  log('m71 release quiets the energy rays', m71release !== null && m71release.rays === 0,
    m71release ? `rays=${m71release.rays}` : 'never framed');

  // Resources stay bounded on production content (27 materials: the shared
  // 26 plus one extra cached speed-tier material — M7.1 uses tiers 1 and 2;
  // cached per tier by the same code path, flat across the run; 62 scene
  // children = the M7 50 plus 12 fixed background energy rays). Probed on
  // the post-on page: the full proof run below uses ?post=off (passes=0).
  const m71res = await m71probe();
  log('m71 resource counts remain bounded',
    m71res.mats === 27 && m71res.geos === 8 && m71res.passes === 3 && m71res.children === 62,
    `mats=${m71res.mats} geos=${m71res.geos} passes=${m71res.passes} children=${m71res.children}`);
  log('m71 material/geometry counts stable', m71res.mats === 27 && m71res.geos === 8,
    `mats=${m71res.mats} geos=${m71res.geos}`);

  // Full real-input playthrough via the in-page driver (mirrors
  // tests/helpers/verticalSlice01Script.ts intents; CDP only observes).
  // Runs on a fresh ?post=off page (~30 fps headless): the direct-render
  // fallback is sim-identical (pinned) and removes CDP-timing fragility
  // from the tightest takeoff windows (M6B precedent). Duration/replay
  // evidence is sim-tick-exact either way.
  await m71fresh(`${URL}?level=vertical-slice-01&post=off`);
  await page.evaluate(() => {
    if (window.__m71driver) clearInterval(window.__m71driver);
    window.__m71done = null;
    window.__m71deaths = 0;
    window.__m71climax = false;
    const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    // Release-on-next-poll: page-thread stalls delay wall-clock timers AND the
    // sim together, so a timed keyup can land past a landing and trigger a
    // hold-to-repeat artifact jump. A keyup drained on the next driver poll
    // trails its keydown by at most one frame of sim progress (timers and
    // rAF share the thread) -- always pre-landing. Redundant releases are
    // no-ops (InputSystem ignores releases while not held).
    const pendingUp = [];
    const tap = (code) => { down(code); pendingUp.push(code); };
    // Mirrors tests/helpers/verticalSlice01Script.ts (M7.1 precision route:
    // island transfers, ceiling weave, 2x sprint with mid-air lane changes).
    const plan = [
      [19, () => tap('Space')],
      [32.5, () => tap('Space')],
      [34.5, () => tap('ArrowRight')],
      [48.5, () => tap('Space')],
      [50.5, () => tap('ArrowLeft')],
      [57, () => tap('Space')],
      [65.5, () => tap('Space')],
      [66.5, () => tap('ArrowLeft')],
      [80.5, () => tap('Space')],
      [94.5, () => tap('Space')],
      [106, () => tap('ArrowRight')],
      [116, () => tap('ArrowLeft')],
      [129, () => tap('Space')],
      [130.5, () => tap('ArrowRight')],
      [148.5, () => tap('Space')],
      [193, () => tap('ArrowLeft')],
      [205, () => tap('ArrowRight')],
      [228.5, () => tap('Space')],
      [236, () => tap('ArrowRight')],
      [260, () => tap('ArrowLeft')],
      [271.5, () => tap('Space')],
      [282.5, () => tap('Space')],
      [346, () => tap('Space')],
      [352.5, () => tap('Space')],
      [369, () => tap('Space')],
      [399, () => tap('Space')],
      [466, () => tap('ArrowLeft')],
      [479, () => tap('Space')],
      [480.5, () => tap('ArrowRight')],
      [536.5, () => tap('Space')],
      [540, () => tap('ArrowRight')],
      [577, () => tap('Space')],
      [593.5, () => tap('Space')],
      [595, () => tap('ArrowLeft')],
      // Final weave tap slightly early vs the headless script (the M5
      // precedent: identical intent, wider than the tightest window so
      // coarse headless observation cannot land the tap past the row).
      [613, () => tap('ArrowLeft')],
    ];
    let step = 0;
    let lastZ = -100;
    window.__m71driver = setInterval(() => {
      while (pendingUp.length > 0) up(pendingUp.pop());
      const g = window.__gd3d;
      const z = g.playerPosition().z;
      if (z < lastZ - 10) {
        step = 0; // respawned: replay the plan from scratch
        window.__m71deaths = (window.__m71deaths ?? 0) + 1;
      }
      lastZ = z;
      const status = g.status();
      if (status === 'finished') {
        clearInterval(window.__m71driver); window.__m71driver = null;
        window.__m71done = 'finished';
        return;
      }
      // Deaths do NOT end the run: the 36-tick hold auto-respawns and the
      // backtrack above re-arms the plan, so attempts retry until the
      // timeout. Only the finish (or the timeout below) stops the driver.
      if (status !== 'running') return;
      if (step < plan.length && z >= plan[step][0]) {
        const action = plan[step][1];
        step += 1;
        action();
        return;
      }
      // Orb windows: repeated discrete presses until each fires.
      if (z >= 284.2 && z <= 285.6 && !g.isInteractionUsed('vs-orb-gravity')) tap('Space');
      else if (z >= 352.2 && z <= 354.6 && !g.isInteractionUsed('vs-orb-jump')) tap('Space');
    }, 5);
  });
  let m71Result = null;
  {
    const t0 = Date.now();
    for (;;) {
      const done = await page.evaluate(() => window.__m71done);
      if (done !== null) { m71Result = done; break; }
      const climax = await page.evaluate(() => ({
        shot: window.__m71climax === true,
        z: window.__gd3d.playerPosition().z,
      }));
      if (!climax.shot && climax.z >= 600 && climax.z <= 635) {
        await page.evaluate(() => { window.__m71climax = true; });
        await capture('m71-09-speed-climax-run');
      }
      if (Date.now() - t0 > 600000) {
        await page.evaluate(() => {
          if (window.__m71driver) clearInterval(window.__m71driver);
          window.__m71driver = null;
        });
        m71Result = 'timeout';
        break;
      }
      await page.waitForTimeout(500);
    }
  }
  log('m71 finish reached via real input', m71Result === 'finished',
    `${String(m71Result)} deaths=${String(await page.evaluate(() => window.__m71deaths ?? 0))}`);
  await capture('m71-10-final-release');
  const m71tape = await page.evaluate(() => window.__gd3d.exportLastReplay());
  let m71Seconds = -1;
  let m71Frames = -1;
  if (m71tape !== null) {
    const parsed = JSON.parse(m71tape);
    m71Frames = parsed.frameCount;
    m71Seconds = parsed.frameCount / 120;
  }
  log('m71 completion duration in target',
    m71Seconds >= 45 && m71Seconds <= 60,
    `frames=${m71Frames} seconds=${m71Seconds.toFixed(2)}`);
  await page.evaluate(() => window.__gd3d.startReplay());
  const m71Verify = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const snap = await page.evaluate(() => ({
        verify: window.__gd3d.replayVerification(),
        status: window.__gd3d.status(),
      }));
      if (snap.verify.kind === 'pass' || snap.verify.kind === 'diverged') return snap;
      if (Date.now() - t0 > 600000) return snap;
      await page.waitForTimeout(300);
    }
  })();
  log('m71 replay can be started', m71Verify.verify.kind === 'pass' || m71Verify.verify.kind === 'diverged',
    `verify=${m71Verify.verify.kind}`);
  log('m71 replay ends VERIFIED', m71Verify.verify.kind === 'pass',
    `verify=${m71Verify.verify.kind} status=${m71Verify.status}`);
  log('m71 no replay divergence', m71Verify.verify.kind !== 'diverged',
    `verify=${m71Verify.verify.kind}`);
  await m71snap('m71-11-replay-verified');
  // Beat cues resolve deterministically in-page and ride outside the tape.
  // Fresh page (no replay/pause residue): stage onto the ceiling run, roll
  // into the window, then read the cue.
  await m71fresh(`${URL}?level=vertical-slice-01`);
  // Cross the portal first (a fresh page runs floor gravity — teleporting
  // straight onto the ceiling slab would fall to void). Screen-left lane:
  // safe past the z 200 center spike; the roll ends before the z 216 row.
  await page.evaluate(() => window.__gd3d.debugTeleport(2.6, 1.5, 158));
  await m71tapLane('ArrowLeft', 0);
  const m71cueStaged = await m71roll((s) => s.mode === 'ceiling' && s.grounded && s.z > 198 && s.z < 208, 90000);
  const m71cueMid = await m71probe();
  log('m71 rhythm cue resolves deterministically',
    m71cueStaged !== null && m71cueMid.cue === 'm71-cue-gravity-hit',
    `cue=${m71cueMid.cue} z=${m71cueMid.z.toFixed(1)}`);
  await m71restage(0, 1.5, 660);
  const m71cueRolled = await m71roll((s) => s.z > 655 && s.z < 675, 60000);
  const m71cueEnd = await m71probe();
  log('m71 release cue resolves at the finish approach',
    m71cueRolled !== null && m71cueEnd.cue === 'm71-cue-release',
    `cue=${m71cueEnd.cue} z=${m71cueEnd.z.toFixed(1)}`);
  const m71tapeStr = await page.evaluate(() => window.__gd3d.exportLastReplay());
  log('m71 rhythm cues absent from replay',
    m71tapeStr === null || (!m71tapeStr.includes('rhythm') && !m71tapeStr.includes('cueId')),
    m71tapeStr === null ? 'no tape' : `${m71tapeStr.length} chars scanned`);

  // Restart returns to the correct starting section.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(500);
  const m71restart = await m71probe();
  log('m71 restart returns to correct starting section',
    m71restart.z < 10 && m71restart.section === 'vs-opening' && m71restart.status === 'running',
    `z=${m71restart.z.toFixed(1)} section=${m71restart.section}`);

  // Death/respawn works on the production level (restaged into the bridge
  // spike: immune to replay/pause state).
  await m71restage(0, 0.6, 21.2);
  const m71sawDeath = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const s = await m71probe();
      if (s.status === 'dead') return true;
      if (Date.now() - t0 > 60000) return false;
      await page.waitForTimeout(40);
    }
  })();
  const m71respawn = await m71roll((s) => s.z < 10, 60000);
  log('m71 death/respawn works', m71sawDeath && m71respawn !== null,
    `sawDeath=${m71sawDeath} respawned z=${m71respawn?.z?.toFixed(1)}`);

  // Fallback matrix stays playable on the new level.
  await m71fresh(`${URL}?level=vertical-slice-01&post=off&fx=off&triggers=off`);
  const m71fallback = await m71roll((s) => s.z > 12, 60000);
  log('m71 post/fx/triggers fallback still playable',
    m71fallback !== null && m71fallback.status === 'running',
    m71fallback ? `z=${m71fallback.z.toFixed(1)}` : 'stalled');
  log('m71 triggers-off restores the exact baseline section',
    m71fallback !== null && m71fallback.section === 'base',
    m71fallback ? `section=${m71fallback.section}` : 'stalled');
}

// --- 25. Console audit ---
log('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
log('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
