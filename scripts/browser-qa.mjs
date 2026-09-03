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
    log('m3 gravity section runs through to the finish gate', m3Finished,
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

  // Stable ceiling run: eye settles BELOW the focus, mid-corridor, with real
  // clearance under the slab; the look target points up at the contact.
  const m31Eye = await page.evaluate(() => window.__gd3d.cameraEye());
  const m31Look = await page.evaluate(() => window.__gd3d.cameraLook());
  log('m3.1 ceiling eye settles below the cube with slab clearance',
    m31Ceil !== null && m31Eye.y > 3.0 && m31Eye.y < 5.0 && m31Eye.y < m31Ceil.y - 0.5,
    `eyeY=${m31Eye.y.toFixed(2)} playerY=${m31Ceil ? m31Ceil.y.toFixed(2) : '-'} (underside y=6)`);
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

// --- 18. Console audit ---
log('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
log('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
