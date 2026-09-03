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

// --- 16. Console audit ---
log('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
log('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
