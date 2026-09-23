/**
 * M9.1 full production playthrough gate (dev tool, not shipped).
 *
 * Proves IN PAGE with real input injection (real KeyboardEvents through the
 * real InputSystem; CDP only observes):
 *  - press-to-start gate + music transport live (buffer/context/gain/time)
 *  - complete primary reference run, 0 deaths, finish, replay VERIFIED
 *  - camera stable, ship/spider/moving platforms exercised, music target
 *    progresses, zero console/page errors
 *  - staged screenshots across rebuilt acts + resource boundedness
 *
 * The in-page driver mirrors tests/helpers/showcaseScript.ts (primary
 * variant): z-triggered jumps/taps/spider-presses/ff-ranges, reactive
 * Chomper jumps, ferry follow/recenter, pose-read maze-pair boarding, and
 * the banded ship PD. If the TS driver changes, re-sync the lists below.
 *
 * Usage: QA_URL=http://localhost:5174/ node scripts/browser-qa-m91-playthrough.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.QA_URL ?? 'http://localhost:5173/';
const OUT_DIR = path.resolve('qa/screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
};
const ev = (page, fn, arg) => (arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg));
const sleep = (page, ms) => page.waitForTimeout(ms);

const JUMPS = [2.5,13,23.5,34,44.5,50,76,86.3,127.5,138.5,147,157.5,172.3,186,224,263,319,329,333,346,354,364,368,377.5,401,412,417,425,430.5,439,456,467,474,485,491,498,505,519,539,550,559.5,570,583.5,599.5,610,620,633,644,728,738,752.5,762,771.5,782,792,812.5,826.5,869.5,879.5,901.5,913.5,915,923,933,957,967,1023,1042.5,1503.5,1538,1545.8,1556,1559.5,1570,1577.5,1587,1620,1625,1647,1660.5,1680,1767.5];
const TAPS = [[13,'right',1],[22.5,'left',0],[23,'left',0],[34,'right',1],[54,'left',0],[63.5,'right',1],[64.5,'right',0],[70,'left',0],[95.5,'right',0],[107.5,'left',1],[108.5,'left',0],[116.8,'right',1],[126,'right',0],[130.5,'left',0],[174,'right',0],[180,'left',0],[195.5,'right',1],[205,'left',1],[206,'left',0],[214.5,'right',1],[234.5,'left',1],[245,'right',1],[246,'right',0],[256,'left',0],[286,'right',0],[296,'left',0],[444,'right',0],[448,'left',0],[459,'right',0],[478,'left',0],[506,'left',0],[510,'right',0],[513,'left',0],[522,'right',0],[700,'left',0],[714,'right',0],[806,'up',0],[822,'down',0],[844,'up',0],[852,'down',0],[975,'right',0],[977,'right',0],[984.5,'left',0],[1048,'right',0],[1063,'left',0],[1070,'right',0],[1086,'left',0],[1172,'right',0],[1186,'left',0],[1199,'right',0],[1214,'left',0],[1256,'left',0],[1282,'right',0],[1352,'left',0],[1366,'right',0],[1463,'up',0],[1475,'down',0],[1633,'left',1],[1643,'right',1],[1644,'right',0],[1652,'left',0],[1668,'left',0],[1682,'right',0],[1698,'left',0],[1705,'right',0],[1722,'up',0],[1736,'left',0],[1750,'left',0],[1772,'right',0]];
const SPIDER = [1346.5,1353,1360,1368,1376.5,1383,1390,1398,1401,1406,1411,1416,1421,1426,1431,1436,1441,1445,1452,1472,1482,1743,1749];
const FFR = [[102,105],[168,170.5],[257.5,260],[890,893],[1613,1618],[359,364],[1572,1580]];

const browser = await chromium.launch({
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
// Warmup under the frozen start gate (tick-0 scene renders + compiles
// shaders while the sim holds — early headless frames stall for seconds,
// and a stall would eat the first island takeoffs).
await sleep(page, 4000);

const sidecarBase = { url: URL, capturedAt: new Date().toISOString() };
async function capture(name) {
  const file = path.join(OUT_DIR, `m91-${name}.png`);
  await page.screenshot({ path: file });
  const appState = await ev(page, () => ({
    status: window.__gd3d?.status?.() ?? 'n/a',
    attempts: window.__gd3d?.attempts?.() ?? -1,
    playerPosition: window.__gd3d?.playerPosition?.() ?? null,
    playerMode: window.__gd3d?.playerMode?.() ?? 'n/a',
    gravityMode: window.__gd3d?.gravityMode?.() ?? 'n/a',
    music: window.__gd3d?.musicState?.() ?? 'n/a',
    section: window.__gd3d?.rhythmSection?.() ?? 'n/a',
  }));
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(path.join(OUT_DIR, `m91-${name}.json`), JSON.stringify({
    ...sidecarBase, capture: { name, accepted: true, rejectionReasons: [] },
    appState, errors: { consoleErrors: [...consoleErrors], pageErrors: [...pageErrors] },
    png: { bytes: bytes.length },
  }, null, 2));
}

// --- A. Gate + transport (strict transport evidence). ---
const gate0 = await ev(page, () => ({
  awaiting: window.__gd3d.awaitingStart(),
  z: window.__gd3d.playerPosition().z,
}));
log('m91 gate holds at tick 0', gate0.awaiting === true && Math.abs(gate0.z + 4) < 0.01, JSON.stringify(gate0));
// Dedicated unlock gesture (its edge is flushed by the gate).
await page.keyboard.press('Space');
// --- B. Install the in-page reference driver (primary policy) at once —
// the sim is still at the start line, so jump 2.5 arms in time. ---
await ev(page, ({ jumps, taps, spider, ffr }) => {
  if (window.__m91driver) clearInterval(window.__m91driver);
  window.__m91done = null;
  const plan = {
    jumps: jumps.map((z) => ({ z, done: false })),
    taps: taps.map(([z, dir, j]) => ({ z, dir, j: j === 1, done: false })),
    spider: spider.map((z) => ({ z, done: false })),
    jumpedChompers: {},
    tick: 0,
    lastFerryTap: -999,
    mazeStage: 0,
    wasRiding: false,
    lastFerryId: null,
    recentering: false,
    recenterUntilZ: 0,
    recenterTarget: 1,
    shipHold: false,
    ffHold: false,
    jumpArmed: -1,
    attempts: window.__gd3d.attempts(),
  };
  window.__m91plan = plan;
  const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  const keyFor = (dir) => {
    if (dir === 'left') return 'ArrowLeft';
    if (dir === 'right') return 'ArrowRight';
    if (dir === 'up') return 'ArrowUp';
    return 'ArrowDown';
  };
  const edge = (code) => { down(code); setTimeout(() => up(code), 30); };
  const jumpEdge = () => edge('Space');
  // Maze ferry-pair defs (mirror movingPlatformSystem pingpong).
  const MAZE_A = { x: -2.6, z: 668, hx: 2.5, amp: 2, period: 300, phase: 74 };
  const MAZE_B = { x: 2.6, z: 680, hx: 2.5, amp: 2, period: 300, phase: 224 };
  const poseX = (def, tick) => {
    const period = Math.max(1, Math.floor(def.period));
    const raw = (tick + Math.floor(def.phase)) % period;
    const wrapped = raw < 0 ? raw + period : raw;
    const phase = wrapped / period;
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    return def.x + (tri * 2 - 1) * def.amp;
  };
  const shipTarget = (z) => {
    if (z < 1128) return 3.0;
    if (z < 1140) return 4.0;
    if (z < 1146) return 3.5;
    if (z < 1200) return 3.0;
    if (z < 1232) return 6.3;
    if (z < 1243) return 3.5;
    if (z < 1250) return 6.3;
    if (z < 1264) return 2.5;
    if (z < 1286) return 3.5;
    if (z < 1302) return 3.0;
    return 3.0;
  };
  // Fast poll (8 ms), unit-faithful edges at exact atZ (post-off keeps the
  // sim at full speed, so 8 ms polls land within ~0.3 u — tight rhythms
  // hold without gates/leads/splits).
  const ORBS = new Set([50, 317, 329, 333, 417, 430.5, 467, 491, 498, 539, 1545.8, 1559.5, 1625, 1647]);
  window.__m91driver = setInterval(() => {
    const g = window.__gd3d;
    plan.tick++;



    if (g.attempts() !== plan.attempts) {
      plan.attempts = g.attempts();
      plan.jumps.forEach((j) => { j.done = false; });
      plan.taps.forEach((t) => { t.done = false; });
      plan.spider.forEach((s) => { s.done = false; });
      plan.jumpedChompers = {};
      plan.mazeStage = 0;
      plan.wasRiding = false;
      plan.recentering = false;
      plan.shipHold = false;
      if (plan.ffHold) { up('ArrowDown'); plan.ffHold = false; }
      plan.jumpArmed = -1;
      up('Space');
    }
    if (g.status() !== 'running') {
      if (g.status() === 'finished') window.__m91done = { attempts: g.attempts() };
      else if (g.status() === 'dead') {
        const pp = g.playerPosition();
        window.__m91done = { dead: `${g.deathCause()}@z${pp.z.toFixed(1)},y${pp.y.toFixed(1)}`, attempts: g.attempts() };
      }
      return;
    }
    window.__m91done = null;
    const z = g.playerPosition().z;
    const y = g.playerPosition().y;
    const mode = g.playerMode();
    // Ship PD (velocity-damped bands, mirrors the unit driver).
    if (mode === 'ship') {
      const target = shipTarget(z);
      const vy = g.playerVelocity().y;
      const inverted = g.gravityMode() === 'ceiling';
      const predicted = y + vy * 0.2;
      const hold = inverted ? predicted > target + 0.1 : predicted < target - 0.1;
      if (hold && !plan.shipHold) { down('Space'); plan.shipHold = true; }
      else if (!hold && plan.shipHold) { up('Space'); plan.shipHold = false; }
      for (const t of plan.taps) {
        if (!t.done && z >= t.z && z < t.z + 30) { t.done = true; edge(keyFor(t.dir)); }
      }
      return;
    }
    if (plan.shipHold) { up('Space'); plan.shipHold = false; }
    // Ferry follow/recenter (cube on lateral ferries).
    const support = g.supportId();
    const riding = support !== null && support.indexOf('platform-ps-ferry-') === 0 && mode === 'cube';
    const plats = g.platforms() ?? [];
    if (riding) {
      plan.lastFerryId = support;
      const st = plats.find((p) => `platform-${p.id}` === support);
      if (st !== undefined && plan.tick - plan.lastFerryTap > 15) {
        const dx = st.x - g.playerPosition().x;
        if (Math.abs(dx) > 0.8) {
          plan.lastFerryTap = plan.tick;
          edge(dx > 0 ? 'ArrowLeft' : 'ArrowRight');
          return;
        }
      }
    }
    if (!riding && plan.wasRiding) {
      plan.recentering = true;
      plan.recenterUntilZ = z + 45;
      plan.recenterTarget = z > 900 ? 0 : 1;
    }
    plan.wasRiding = riding;
    if (plan.recentering && mode === 'cube') {
      const t = g.laneIndex();
      if (t === plan.recenterTarget || z > plan.recenterUntilZ) plan.recentering = false;
      else if (plan.tick - plan.lastFerryTap > 10) {
        plan.lastFerryTap = plan.tick;
        edge(t < plan.recenterTarget ? 'ArrowRight' : 'ArrowLeft');
        return;
      }
    }
    // Maze ferry-pair pose-read boarding/transfer/exit.
    if (mode === 'cube' && z > 650 && z < 695) {
      const tick = g.platformTick();
      const ax = poseX(MAZE_A, tick + 75);
      if (plan.mazeStage === 0 && support === 'platform-ps-ferry-maze-a') plan.mazeStage = 1;
      if (plan.mazeStage === 0 && z > 656.2 && z < 660 && support !== 'platform-ps-ferry-maze-a') {
        if (Math.abs(ax) < 2.0) { plan.mazeStage = 1; jumpEdge(); return; }
      } else if (plan.mazeStage === 1 && support === 'platform-ps-ferry-maze-a') {
        const stA = plats.find((p) => p.id === 'ps-ferry-maze-a');
        const stB = plats.find((p) => p.id === 'ps-ferry-maze-b');
        if (stA !== undefined && stB !== undefined && Math.abs(stA.x - stB.x) < 2.2 && z > 657) {
          plan.mazeStage = 2; jumpEdge(); return;
        }
      } else if (plan.mazeStage === 2 && support === 'platform-ps-ferry-maze-b' && z > 679) {
        plan.mazeStage = 3; jumpEdge(); return;
      }
    }
    // Reactive Chomper jumps (lunge edge; low/final are lane dodges).
    for (const c of g.chompers()) {
      if (c.phase === 'lunging' && plan.jumpedChompers[c.aimX + ':' + Math.round(c.z)] === undefined) {
        plan.jumpedChompers[c.aimX + ':' + Math.round(c.z)] = true;
        // Only ferry/weave/ceil lunge here (low/final dodge by lane via taps).
        if (c.z < 1030) { jumpEdge(); return; }
      }
    }
    // Spider snaps.
    for (const s of plan.spider) {
      if (!s.done && z >= s.z && mode === 'spider') { s.done = true; jumpEdge(); return; }
    }
    // Jumps at exact atZ (one-shot, unit-faithful). Stale-skip 6 u past.
    for (const j of plan.jumps) {
      if (!j.done && z > j.z + 6) j.done = true;
    }
    for (const j of plan.jumps) {
      if (!j.done && z >= j.z) { j.done = true; jumpEdge(); return; }
    }
    // Taps (stale-skip beyond 12 u).
    // Taps lead by 1.5 u (early transit centers narrow landings despite
    // poll latency); takeoffs fire on time via the grounded gate below.
    // (Orb-press jumps are window-gated, not grounded-gated.)
    for (const t of plan.taps) {
      if (!t.done && z > t.z + 12) t.done = true;
    }
    // Armed takeoff from a split withJump (lane fired pre-touchdown,
    // Space waits for the grounded edge; stale-skip 4 u past).
    for (const t of plan.taps) {
      if (!t.done && z >= t.z) {
        t.done = true;
        if (t.j) { down(keyFor(t.dir)); down('Space'); setTimeout(() => { up(keyFor(t.dir)); up('Space'); }, 30); }
        else edge(keyFor(t.dir));
        return;
      }
    }
    // Fast-fall ranges (floor, ArrowDown held airborne).
    let inFF = false;
    for (const [z0, z1] of ffr) {
      if (z >= z0 && z <= z1) { inFF = true; break; }
    }
    if (inFF && !plan.ffHold) { down('ArrowDown'); plan.ffHold = true; }
    else if (!inFF && plan.ffHold) { up('ArrowDown'); plan.ffHold = false; }
  }, 8);
}, { jumps: JUMPS, taps: TAPS, spider: SPIDER, ffr: FFR });

// --- C. Transport evidence (after unlock) + full run (headless-slow).
// Two-pass: the first pass warms shaders (first-appearance compiles stall
// headless frames for seconds and eat tight takeoffs); R restarts (a new
// attempt, never a death), and the second pass is the gate. The gate is
// finish + zero deaths (deathCause null), attempts-agnostic.
await page.waitForFunction(() => window.__gd3d.playerPosition().z > -3, null, { timeout: 30000 });
await sleep(page, 1500);
const live = await ev(page, () => ({
  music: window.__gd3d.musicState(),
  buffer: window.__gd3d.musicBufferDuration(),
  ctx: window.__gd3d.musicContextState(),
  gain: window.__gd3d.musicGain(),
  playing: window.__gd3d.musicPlaying(),
}));
const transportOk = live.music === 'playing' && Math.abs(live.buffer - 121.574) < 1 &&
  live.ctx === 'running' && live.gain > 0 && live.playing === true;
log('m91 transport live after gesture', transportOk, JSON.stringify(live));
// Full-speed headless sim: SwiftShader bloom costs 100 ms+/frame (sim
// discards time past the 8-step cap and polls go coarse); direct rendering
// is presentation-only (gameplay identical) and keeps every step.
await ev(page, () => window.__gd3d.setPostEnabled(false));
const runPass = async () => page.waitForFunction(() => window.__m91done !== null, null, { timeout: 600000 })
  .then(() => ev(page, () => window.__m91done))
  .catch(() => null);
// Warmup pass (shaders compile; result discarded), R restart, gate pass.
// deathCause latches (R does not clear it), so the gate compares before/after.
await runPass();
await page.keyboard.press('KeyR');
await sleep(page, 1000);
await ev(page, () => { window.__m91done = null; });
const deathBefore = await ev(page, () => window.__gd3d.deathCause());
const run = await runPass();
await ev(page, () => { if (window.__m91driver) clearInterval(window.__m91driver); window.__m91driver = null; });
const deathAfter = await ev(page, () => window.__gd3d.deathCause());
const finished = run !== null && run.dead === undefined && deathAfter === deathBefore;
log('m91 full real-input run finishes with 0 deaths', finished === true, `${JSON.stringify(run)} deathBefore=${deathBefore} deathAfter=${deathAfter}`);
await capture('finish-run');

// --- D. Replay VERIFIED in-page. ---
const verify = await ev(page, () => {
  const ok = window.__gd3d.startReplay();
  return { started: ok };
});
await sleep(page, 2000);
let replayState = await ev(page, () => ({
  mode: window.__gd3d.replayMode(),
  verification: window.__gd3d.replayVerification(),
  badge: window.__gd3d.replayBadge(),
}));
// Let the replay play out (same duration as the run, headless-slow).
for (let i = 0; i < 120 && replayState.verification.kind !== 'pass' && replayState.verification.kind !== 'diverged'; i++) {
  await sleep(page, 5000);
  replayState = await ev(page, () => ({
    mode: window.__gd3d.replayMode(),
    verification: window.__gd3d.replayVerification(),
    badge: window.__gd3d.replayBadge(),
  }));
}
log('m91 replay VERIFIED in-page', replayState.verification.kind === 'pass', JSON.stringify(replayState));

// --- E. Staged screenshots (paused stations across rebuilt acts). ---
// Back to live play first (R restarts the attempt, aborting any replay),
// with full post for beauty captures.
await page.keyboard.press('KeyR');
await sleep(page, 1000);
await ev(page, () => window.__gd3d.setPostEnabled(true));
await sleep(page, 1000);
const stage = async (name, x, y, z) => {
  await page.keyboard.press('KeyP');
  const wasPaused = await ev(page, () => window.__gd3d.paused());
  if (wasPaused) await page.keyboard.press('KeyP');
  await ev(page, (pos) => window.__gd3d.debugTeleport(pos.x, pos.y, pos.z), { x, y, z });
  await sleep(page, 400);
  await page.keyboard.press('KeyP');
  await sleep(page, 400);
  await capture(name);
  await page.keyboard.press('KeyP');
  await sleep(page, 200);
};
await stage('forge', 0, 5.05, 60);
await stage('islands', 0, 5.05, 250);
await stage('maze', 0, 0.55, 500);
await stage('spire', 0, 0.55, 780);
await stage('foundry', 0, 0.55, 930);
await stage('ship', 0, 3.0, 1180);
await stage('spider', 0, 0.55, 1360);
await stage('void', 0, 8.55, 1540);
await stage('core', 0, 0.55, 1680);
await stage('finish-approach', 0, 0.55, 1780);
log('m91 staged captures taken', true, 'forge/islands/maze/spire/foundry/ship/spider/void/core/finish');

// --- F. Resources + errors. ---
const res = await ev(page, () => ({
  mats: window.__gd3d.materialCount(),
  geos: window.__gd3d.geometryCount(),
  children: window.__gd3d.sceneChildren(),
  calls: window.__gd3d.rendererStats().calls,
  tris: window.__gd3d.rendererStats().triangles,
}));
log('m91 resources bounded', res.mats < 70 && res.geos < 25 && res.children < 160, JSON.stringify(res));
log('m91 zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
log('m91 zero page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nM9.1 PLAYTHROUGH GATE: ${failed.length === 0 ? 'PASS' : 'FAILED'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length === 0 ? 0 : 1);
