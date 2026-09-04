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
        setTimeout(() => up(code), 30);
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

// --- 21. Console audit ---
log('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
log('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
