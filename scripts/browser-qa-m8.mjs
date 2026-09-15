/**
 * Browser QA gate, M8 slice (dev tool, not shipped).
 * Focused subset of scripts/browser-qa.mjs: boots ONLY
 * ?level=multimode-gauntlet-01 (+ two portal portraits on other levels)
 * and runs the full M8 evidence set with navigation-race-safe probes.
 * MANUAL MIRROR of the canonical M8 block in browser-qa.mjs — keep the
 * two in sync when the M8 checks change (the slice exists so the M8 gate
 * can run standalone without the 40-minute full suite).
 *
 * Usage: node scripts/browser-qa-m8.mjs   (requires dev server on :5173)
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
// m8stagedOk is owned by m8stage below (declared before any log CALL).
// When a stage never confirms, every later roll short-circuits and the
// affected logs carry the [STAGE-FAIL] tag instead of a misleading state.
const log = (name, ok, detail) => {
  const tag = !m8stagedOk ? ' [STAGE-FAIL]' : '';
  results.push({ name, ok, detail: `${detail ?? ''}${tag}` });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}${tag}`);
};
let m8stagedOk = true;

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

const waitReady = async () => {
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
};

// Race-safe evaluate: navigations can destroy the execution context
// mid-poll; retry through the readiness signal instead of crashing.
const safeEval = async (fn, arg) => {
  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    try {
      return arg === undefined ? await page.evaluate(fn) : await page.evaluate(fn, arg);
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(600);
      try {
        await waitReady();
      } catch {}
    }
  }
  throw lastErr;
};

const safeGoto = async (url) => {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
  } catch {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    } catch {
      await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
    }
    await waitReady();
  }
  await waitReady();
};

const sidecarBase = {
  url: URL,
  capturedAt: new Date().toISOString(),
  git: { sha: gitSha },
  env: {
    userAgent: 'm8-slice',
    viewport: { width: 1280, height: 720 },
    dpr: 1,
  },
};

async function capture(name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  const appState = await safeEval(() => ({
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

/** Read live sim position. */
const pos = () => safeEval(() => window.__gd3d.playerPosition());
const simState = () =>
  safeEval(() => ({
    x: window.__gd3d.playerPosition().x,
    y: window.__gd3d.playerPosition().y,
    z: window.__gd3d.playerPosition().z,
    grounded: window.__gd3d.grounded(),
    status: window.__gd3d.status(),
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

await safeGoto(`${URL}?level=multimode-gauntlet-01`);
await page.waitForTimeout(2000);

  const m8probe = () => safeEval(() => ({
    id: window.__gd3d.levelId(),
    name: window.__gd3d.levelDisplayName(),
    status: window.__gd3d.status(),
    cause: window.__gd3d.deathCause(),
    lethal: window.__gd3d.lethalInfo().colliderId,
    lane: window.__gd3d.laneIndex(),
    grav: window.__gd3d.gravityMode(),
    pMode: window.__gd3d.playerMode(),
    support: window.__gd3d.supportId(),
    burst: window.__gd3d.burstActive(),
    chompers: window.__gd3d.chompers(),
    badge: window.__gd3d.replayBadge(),
    verify: window.__gd3d.replayVerification(),
    mats: window.__gd3d.materialCount(),
    geos: window.__gd3d.geometryCount(),
    children: window.__gd3d.sceneChildren(),
    cameraUpY: window.__gd3d.cameraUpY(),
    z: window.__gd3d.playerPosition().z,
    y: window.__gd3d.playerPosition().y,
    x: window.__gd3d.playerPosition().x,
    grounded: window.__gd3d.grounded(),
  }));
  const m8roll = async (pred, timeoutMs = 60000, pollMs = 40) => {
    // Fail fast when the preceding stage never confirmed (see m8stage).
    if (!m8stagedOk) return null;
    const t0 = Date.now();
    for (;;) {
      const s = await m8probe();
      if (pred(s)) return s;
      if (Date.now() - t0 > timeoutMs) return null;
      await page.waitForTimeout(pollMs);
    }
  };
  const m8fresh = async (url) => {
    await safeGoto(url);
    await waitReady();
    await page.waitForTimeout(2000);
    m8stagedOk = true; // fresh page: clear any earlier stage failure
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(600);
      const p = await pos();
      if (p.z < 10) break;
    }
  };
  // M8.1 hardened staging: under load CDP keypresses can be lost, so the
  // old fire-and-forget sequence (R-loop + blind teleport) sometimes left
  // the sim running from a garbage state and the check timed out far from
  // the staged section. Now every round read-backs the position and only
  // returns on a confirmed stage; m8roll short-circuits when the last
  // stage failed, so checks FAIL FAST instead of running from garbage.
  // Explicit pause-sync: KeyP toggles, and under load presses get lost —
  // so sync on the polled pause FLAG instead of assuming toggle parity.
  const m8setPaused = async (want) => {
    for (let i = 0; i < 6; i++) {
      const p = await safeEval(() => window.__gd3d.paused());
      if (p === want) return true;
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(250);
    }
    return false;
  };
  const m8stage = async (x, y, z) => {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(700);
      await safeEval((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x, y, z });
      // Pause for the read-back: a running sim drifts ~6 u in the settle
      // window, which a tight tolerance would misread as a missed stage.
      if (!(await m8setPaused(true))) continue;
      const p = await pos();
      await m8setPaused(false);
      if (Math.abs(p.x - x) < 1.2 && Math.abs(p.y - y) < 2.5 && Math.abs(p.z - z) < 4) {
        m8stagedOk = true;
        return true;
      }
    }
    m8stagedOk = false;
    return false;
  };
  const m8freeze = async (x, y, z) => {
    for (let round = 0; round < 5; round++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(400);
      await safeEval((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x, y, z });
      if (!(await m8setPaused(true))) continue;
      const p = await pos();
      await page.waitForTimeout(250);
      const s = await m8probe();
      // Frozen AND near the requested anchor: a confirmed portrait stage.
      if (
        s.status === 'running' &&
        Math.abs(s.z - p.z) < 0.05 &&
        Math.abs(p.x - x) < 2 &&
        Math.abs(p.z - z) < 6
      ) {
        m8stagedOk = true;
        return s;
      }
      await m8setPaused(false);
      await page.waitForTimeout(500);
    }
    m8stagedOk = false;
    return m8probe();
  };
  // M8.1 re-staging crossing: stage → roll; on timeout re-stage and
  // retry. A death respawns at START, so without re-staging a single
  // mistimed attempt would idle-die in S1 until the timeout. Bounded.
  const m8cross = async (x, y, z, pred, roundMs = 20000, rounds = 4) => {
    for (let r = 0; r < rounds; r++) {
      if (!(await m8stage(x, y, z))) return null;
      const s = await m8roll(pred, roundMs);
      if (s !== null) return s;
    }
    return null;
  };
  const m8live = async (rounds = 4) => {
    await m8setPaused(false);
    for (let i = 0; i < rounds; i++) {
      const z1 = (await pos()).z;
      await page.waitForTimeout(800);
      const z2 = (await pos()).z;
      if (Math.abs(z2 - z1) > 0.01) return;
      await m8setPaused(false);
    }
  };

  await m8fresh(`${URL}?level=multimode-gauntlet-01`);
  const m8boot = await m8probe();
  log('m8 gauntlet resolves', m8boot.id === 'multimode-gauntlet-01' && m8boot.name === 'MULTIMODE GAUNTLET 01',
    `id=${m8boot.id}`);

  // Lava basin: frozen portrait over gap 1 + in-frame projection proof.
  await m8freeze(0, 0.55, 33);
  const m8poolFrame = await safeEval(() => window.__gd3d.screenPoint(0, -2.4, 43));
  log('m8 lava basin visible below the gap', !m8poolFrame.behind && Math.abs(m8poolFrame.ndcX) < 1 && Math.abs(m8poolFrame.ndcY) < 1,
    `ndc=(${m8poolFrame.ndcX.toFixed(2)},${m8poolFrame.ndcY.toFixed(2)})`);
  await capture('m8-01-lava-basin');
  await m8live();

  // Lava source + fall: frozen portrait from runway B + projection proofs.
  await m8freeze(0, 0.55, 60);
  const m8srcFrame = await safeEval(() => window.__gd3d.screenPoint(10.6, 2.6, 68));
  const m8fallFrame = await safeEval(() => window.__gd3d.screenPoint(9.4, -0.3, 68));
  log('m8 lava source vent reads in-frame', !m8srcFrame.behind && Math.abs(m8srcFrame.ndcX) < 1.2,
    `ndc=(${m8srcFrame.ndcX.toFixed(2)},${m8srcFrame.ndcY.toFixed(2)})`);
  log('m8 lava fall reads in-frame', !m8fallFrame.behind && Math.abs(m8fallFrame.ndcX) < 1.2,
    `ndc=(${m8fallFrame.ndcX.toFixed(2)},${m8fallFrame.ndcY.toFixed(2)})`);
  await capture('m8-02-lava-source');
  await m8live();

  // Lava contact = instant death with the lava cause; burst fires; the
  // dead state lingers long enough to read before auto-respawn. Staged
  // just above the pool surface: the fall is short, so the swept path
  // enters the pool (not the far rim) and tags the lava cause.
  // M8.1: the burst read is latched IN-PAGE (a 16 ms watcher arms before
  // staging and records burstActive() while dead) — CDP poll latency
  // alone cannot reliably land inside the 0.65 s window under load.
  // Sightings are tagged with the attempt number, so deaths during the
  // staging rounds can never satisfy the check (no wipe race possible).
  await safeEval(() => {
    if (window.__m8burstWatch) clearInterval(window.__m8burstWatch);
    window.__m8burstSeen = -1;
    // Global death/hold recorder (per-attempt max dead-hold ms + last
    // deaths with cause/lethal/z) — CDP polls only see post-respawn
    // state, so all death forensics live in-page at 16 ms granularity.
    window.__m8holds = {};
    window.__m8deadSince = 0;
    window.__m8allDeaths = [];
    window.__m8recAtt = -1;
    window.__m8burstWatch = setInterval(() => {
      const g = window.__gd3d;
      const att = g.attempts();
      if (g.status() === 'dead') {
        if (g.burstActive()) window.__m8burstSeen = att;
        if (!window.__m8deadSince) window.__m8deadSince = performance.now();
        const ms = performance.now() - window.__m8deadSince;
        window.__m8holds[att] = Math.max(window.__m8holds[att] ?? 0, ms);
        if (window.__m8recAtt !== att) {
          window.__m8recAtt = att;
          window.__m8allDeaths.push(`${g.deathCause()}@${g.playerPosition().z.toFixed(0)}/${(g.lethalInfo().colliderId ?? '')}`);
          if (window.__m8allDeaths.length > 20) window.__m8allDeaths.shift();
        }
      } else {
        window.__m8deadSince = 0;
      }
    }, 16);
  });
  await m8stage(0, -1.9, 43);
  const m8lavaDead = await m8roll((s) => s.status === 'dead', 15000);
  log('m8 lava contact kills instantly', m8lavaDead !== null && m8lavaDead.cause === 'lava',
    m8lavaDead ? `cause=${m8lavaDead.cause}` : 'survived');
  const m8burstSeen = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const snap = await safeEval(() => ({
        seen: window.__m8burstSeen,
        attempts: window.__gd3d.attempts(),
      }));
      // The sighting must belong to the CURRENT attempt (post-staging).
      if (snap.seen !== -1 && snap.seen === snap.attempts) return true;
      if (Date.now() - t0 > 10000) return false;
      await page.waitForTimeout(100);
    }
  })();
  await safeEval(() => { if (window.__m8burstWatch) clearInterval(window.__m8burstWatch); window.__m8burstWatch = null; });
  log('m8 death explosion fires', m8burstSeen === true, `burst=${m8burstSeen}`);
  // Death-attempt number while the death is still observed (respawn bumps
  // it — the read lands inside the 650 ms hold at any poll latency).
  const m8deadAtt = m8lavaDead !== null ? await safeEval(() => window.__gd3d.attempts()) : -1;
  const m8respawned = await m8roll((s) => s.status === 'running', 8000);
  log('m8 auto-respawn follows the readable window', m8respawned !== null,
    m8respawned ? `z=${m8respawned.z.toFixed(1)}` : 'never respawned');
  // Linger proof from the in-page hold measurement keyed by the staged
  // death's attempt (≥ 400 ms wall — the 78-tick sim hold lasts 650 ms at
  // any sim/wall ratio ≤ 1, so 400 ms is conservative). Replaces the old
  // 250 ms CDP probe, whose fixed delay raced observation latency.
  const m8lingerMs = await safeEval((att) => window.__m8holds[att] ?? 0, m8deadAtt);
  log('m8 dead state lingers readably before auto-respawn', m8lingerMs >= 400,
    `hold=${m8lingerMs.toFixed(0)}ms wall on attempt ${m8deadAtt}`);

  // Compact gravity portal ring at the S3 entry (frozen portrait).
  await m8freeze(0, 0.55, 303);
  await capture('m8-04-compact-portals');
  await m8live();

  // Four-way gravity: cross 310 live → leftWall with a level camera.
  await m8stage(0, 0.55, 300);
  const m8left = await m8roll((s) => s.grav === 'leftWall', 20000);
  log('m8 left-wall gravity transition', m8left !== null, m8left ? `z=${m8left.z.toFixed(1)}` : 'never flipped');
  const m8attached = await m8roll((s) => s.grav === 'leftWall' && s.support !== null && Math.abs(s.x - 4.85) < 0.3, 20000);
  log('m8 player attached to the left wall', m8attached !== null, m8attached ? `x=${m8attached.x.toFixed(2)}` : 'never attached');
  const m8cam = await m8probe();
  log('m8 wall camera never rolls', m8cam.cameraUpY === 1, `upY=${m8cam.cameraUpY}`);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(250);
  await capture('m8-05-left-wall-gravity');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);
  // Wall jump: space pushes away from the +X support (x decreases).
  const m8wallX = (await m8probe()).x;
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  const m8wallX2 = (await m8probe()).x;
  log('m8 wall jump pushes away from the support', m8wallX2 < m8wallX - 0.2,
    `x=${m8wallX.toFixed(2)}->${m8wallX2.toFixed(2)}`);
  // Wall-lane movement: ArrowUp climbs the vertical lanes on the wall.
  const m8wallY = (await m8probe()).y;
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(600);
  const m8wallY2 = (await m8probe()).y;
  log('m8 wall-lane movement climbs', m8wallY2 > m8wallY + 0.3,
    `y=${m8wallY.toFixed(2)}->${m8wallY2.toFixed(2)}`);

  // Right wall: stage onto the ceiling run just before portal 455.
  await m8stage(0, 5.45, 448);
  const m8right = await m8roll((s) => s.grav === 'rightWall', 20000);
  log('m8 right-wall gravity transition', m8right !== null, m8right ? `z=${m8right.z.toFixed(1)}` : 'never flipped');
  const m8rightAttached = await m8roll((s) => s.grav === 'rightWall' && s.support !== null && Math.abs(s.x + 4.85) < 0.4, 20000);
  log('m8 player attached to the right wall', m8rightAttached !== null, m8rightAttached ? `x=${m8rightAttached.x.toFixed(2)}` : 'never attached');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(250);
  await capture('m8-06-right-wall-gravity');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);

  // Ship: cross 715 live → ship mode + visible craft + thrust authority.
  await m8stage(0, 0.55, 708);
  const m8ship = await m8roll((s) => s.pMode === 'ship', 20000);
  log('m8 ship portal switches mode', m8ship !== null, m8ship ? `z=${m8ship.z.toFixed(1)}` : 'never switched');
  await capture('m8-07-ship');
  const m8shipY = (await m8probe()).y;
  await page.keyboard.down('Space');
  await page.waitForTimeout(800);
  await page.keyboard.up('Space');
  const m8shipY2 = (await m8probe()).y;
  log('m8 ship thrust rises while held', m8shipY2 > m8shipY + 0.8,
    `y=${m8shipY.toFixed(2)}->${m8shipY2.toFixed(2)}`);
  const m8shipY3 = (await m8probe()).y;
  await page.waitForTimeout(1500);
  const m8shipY4 = (await m8probe()).y;
  log('m8 ship release descends under gravity', m8shipY4 < m8shipY3 - 0.3,
    `y=${m8shipY3.toFixed(2)}->${m8shipY4.toFixed(2)}`);
  // Ship corridor drive: hold (rise over the z 744 wall), release from
  // z 776 (CDP poll lag eats ~1 u, so the release leads the 784 design
  // edge — the deterministic suite releases exactly at 784), hold again
  // at 800 to the 845 exit.
  await m8stage(0, 0.55, 708);
  await m8roll((s) => s.pMode === 'ship', 20000);
  await page.keyboard.down('Space');
  const m8corridor = await (async () => {
    const t0 = Date.now();
    let released = false;
    let held = true;
    for (;;) {
      const s = await m8probe();
      if (s.status !== 'running' || s.pMode !== 'ship') return s;
      if (s.z > 846) return s;
      if (!released && s.z >= 776) { await page.keyboard.up('Space'); released = true; held = false; }
      if (released && !held && s.z >= 800) { await page.keyboard.down('Space'); held = true; }
      if (Date.now() - t0 > 60000) return null;
      await page.waitForTimeout(40);
    }
  })();
  await page.keyboard.up('Space');
  log('m8 ship corridor completable', m8corridor !== null && m8corridor.status === 'running' && m8corridor.z > 840,
    m8corridor ? `z=${m8corridor.z.toFixed(1)} status=${m8corridor.status}` : 'stalled/died');

  // Spider: cross 865 live → spider mode; press snaps floor → ceiling.
  await m8stage(0, 0.55, 858);
  const m8spider = await m8roll((s) => s.pMode === 'spider', 20000);
  log('m8 spider portal switches mode', m8spider !== null, m8spider ? `z=${m8spider.z.toFixed(1)}` : 'never switched');
  await capture('m8-08-spider');
  await pressSpaceWhen((s) => s.z >= 890, 15000);
  const m8snap = await m8roll((s) => s.grav === 'ceiling' && Math.abs(s.y - 5.45) < 0.3, 15000);
  log('m8 spider snaps to the opposite surface', m8snap !== null, m8snap ? `y=${m8snap.y.toFixed(2)} grav=${m8snap.grav}` : 'never snapped');
  // Staying low is lethal: stage BEFORE the spider portal so the run
  // enters spider mode, then rides the floor into the z 905 dodge wall.
  await m8stage(0, 0.55, 858);
  const m8spiderLow = await m8roll((s) => s.pMode === 'spider', 20000);
  const m8spiderWall = await m8roll((s) => s.status === 'dead', 30000);
  log('m8 spider floor wall kills (dodge is mandatory)',
    m8spiderLow !== null && m8spiderWall !== null && m8spiderWall.cause === 'frontImpact',
    m8spiderWall ? `cause=${m8spiderWall.cause}` : 'survived');

  // Chomper: stage before trigger 600 → dormant portrait, then the
  // telegraph → lunge arc, a jumped crossing, and a lethal contact.
  await m8freeze(0, 0.55, 585);
  await capture('m8-09-chomper-dormant');
  await m8live();
  await m8stage(0, 0.55, 585);
  const m8telegraph = await m8roll((s) => (s.chompers[0]?.phase) === 'telegraph', 20000);
  log('m8 chomper telegraphs on approach', m8telegraph !== null, m8telegraph ? `phase=${m8telegraph.chompers[0]?.phase}` : 'never armed');
  const m8lunge = await m8roll((s) => (s.chompers[0]?.phase) === 'lunging', 20000);
  log('m8 chomper lunges horizontally', m8lunge !== null, m8lunge ? `x=${m8lunge.chompers[0]?.x.toFixed(2)}` : 'never lunged');
  await capture('m8-10-chomper-lunge');
  // Both lunges get jumped. The edge watcher runs IN-PAGE (10 ms) and
  // dispatches real Space keys through the real InputSystem — CDP poll
  // latency (~1-2 u) cannot hit the ±1.5 u jump window fairly, while the
  // in-page edge fires ~1 tick after the lunge starts (the exact timing
  // the deterministic suite pins). CDP only observes the outcome.
  // Lunge-edge taps: the jump fires ~1 tick after the lunge starts — the
  // exact timing the deterministic suite pins (a telegraph-edge jump meets
  // the body on the way down and clips it; verified by probe forensics).
  // Load-mistimed attempts die and RE-STAGE via m8cross below (a death
  // respawns at START, so bare retries would idle-die in S1).
  await safeEval(() => {
    if (window.__m8chompWatch) clearInterval(window.__m8chompWatch);
    window.__m8chompJumped = [false, false];
    window.__m8chompAttempts = window.__gd3d.attempts();
    window.__m8chompWatch = setInterval(() => {
      const g = window.__gd3d;
      if (g.attempts() !== window.__m8chompAttempts) {
        window.__m8chompAttempts = g.attempts();
        window.__m8chompJumped = [false, false];
      }
      if (g.status() !== 'running') return;
      const ch = g.chompers();
      for (let i = 0; i < ch.length; i++) {
        if (ch[i]?.phase === 'lunging' && !window.__m8chompJumped[i]) {
          window.__m8chompJumped[i] = true;
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
          setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })), 70);
        }
      }
    }, 10);
  });
  // Smaller viewport for the timing-critical crossing: SwiftShader frame
  // cost scales with pixels, and lunge-edge taps need <150 ms of
  // main-thread latency (1280×720 → 960×540 nearly halves it). Portraits
  // above already captured at full size; restored right after.
  await page.setViewportSize({ width: 960, height: 540 });
  // Generous budget: a long post-on session degrades sim/wall ratio and
  // 585 → 675 needs ~7 s sim (≈15-30 s wall here); re-staging rounds
  // absorb mistimed attempts under load (see m8cross).
  const m8jumped = await m8cross(0, 0.55, 585, (s) => s.z > 675, 25000, 4);
  await page.setViewportSize({ width: 1280, height: 720 });
  await safeEval(() => {
    if (window.__m8chompWatch) clearInterval(window.__m8chompWatch);
    window.__m8chompWatch = null;
  });
  const m8chompDeaths = await safeEval(() => (window.__m8allDeaths ?? []).slice(-4).join(' '));
  log('m8 player jumps over the chomper', m8jumped !== null && m8jumped.status === 'running',
    m8jumped ? `z=${m8jumped.z.toFixed(1)} status=${m8jumped.status}` : `no crossing (timeout) deaths=[${m8chompDeaths}]`);
  await m8stage(0, 0.55, 585);
  const m8chompDead = await m8roll((s) => s.status === 'dead', 30000);
  log('m8 chomper contact kills', m8chompDead !== null && (m8chompDead.lethal ?? '').startsWith('chomper-'),
    m8chompDead ? `lethal=${m8chompDead.lethal}` : 'survived');

  // Maze: frozen portrait of the decision walls + correct/wrong routing.
  await m8freeze(2.6, 0.55, 168);
  await capture('m8-11-maze');
  await m8live();
  // Staging preserves lane intent (center): tap into lane 0 first, exactly
  // as the scripted route arrives, then ride the door at x 1.3..3.9.
  await m8stage(2.6, 0.55, 160);
  await page.keyboard.press('ArrowLeft');
  const m8mazeOk = await m8roll((s) => s.z > 183 && s.status === 'running', 20000);
  log('m8 correct maze passage survives', m8mazeOk !== null, m8mazeOk ? `z=${m8mazeOk.z.toFixed(1)}` : 'died in the door');
  await m8stage(0, 0.55, 160);
  const m8mazeDead = await m8roll((s) => s.status === 'dead', 20000);
  log('m8 wrong maze wall kills frontally', m8mazeDead !== null && m8mazeDead.cause === 'frontImpact',
    m8mazeDead ? `cause=${m8mazeDead.cause}` : 'survived');

  // Trap islands: portrait + decoy spike lethality.
  await m8freeze(0, 0.55, 986);
  await capture('m8-12-trap-islands');
  await m8live();
  await m8stage(3.9, 0.55, 1010);
  const m8trapDead = await m8roll((s) => s.status === 'dead', 15000);
  log('m8 trap-island spikes kill', m8trapDead !== null && m8trapDead.cause === 'hazard',
    m8trapDead ? `cause=${m8trapDead.cause}` : 'survived');

  // Compact speed portal (test-level tier ring) + compact teleport ring.
  await m8fresh(`${URL}?level=controller-test-01`);
  await safeEval(() => window.__gd3d.debugTeleport(0, 0.55, 360));
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(250);
  await capture('m8-13-speed-portal');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);
  await m8fresh(`${URL}?level=advanced-cube-01`);
  await safeEval(() => window.__gd3d.debugTeleport(0, 0.55, 484));
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(250);
  await capture('m8-14-teleport-ring');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);

  // Full real-input finish: in-page driver (real KeyboardEvents through
  // the real InputSystem; CDP only observes), mirroring the automated
  // MultimodeDriver policy. Deaths re-arm the one-shot plan from respawn.
  await m8fresh(`${URL}?level=multimode-gauntlet-01&post=off&fx=off&triggers=off`);
  await page.setViewportSize({ width: 960, height: 540 });
  await safeEval(() => {
    if (window.__m8driver) clearInterval(window.__m8driver);
    window.__m8done = null;
    const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    const tap = (code) => { down(code); setTimeout(() => up(code), 70); };
    let jumps = [37.5, 87.5, 125.5, 997.5, 1012.5];
    let taps = [{ z: 160, c: 'ArrowLeft' }, { z: 196, c: 'ArrowRight' }, { z: 199, c: 'ArrowRight' }, { z: 232, c: 'ArrowLeft' }];
    let presses = [890, 935];
    let jumpedCh = [false, false];
    let release = false;
    let attempts = window.__gd3d.attempts();
    let shipHeld = false;
    // M8.1 in-page death recorder: captures cause/lethal/z AT the death
    // edge (CDP polls only ever see the cleared post-respawn state).
    window.__m8deaths = [];
    window.__m8recAtt = -1;
    window.__m8driver = setInterval(() => {
      const g = window.__gd3d;
      if (g.status() === 'dead' && window.__m8recAtt !== g.attempts()) {
        window.__m8recAtt = g.attempts();
        window.__m8deaths.push(`${g.deathCause()}@${g.playerPosition().z.toFixed(0)}/${(g.lethalInfo().colliderId ?? '')}`);
        if (window.__m8deaths.length > 14) window.__m8deaths.shift();
      }
      if (g.attempts() !== attempts) {
        attempts = g.attempts();
        jumps = [37.5, 87.5, 125.5, 997.5, 1012.5];
        taps = [{ z: 160, c: 'ArrowLeft' }, { z: 196, c: 'ArrowRight' }, { z: 199, c: 'ArrowRight' }, { z: 232, c: 'ArrowLeft' }];
        presses = [890, 935];
        jumpedCh = [false, false];
        release = false;
        if (shipHeld) { up('Space'); shipHeld = false; }
      }
      if (g.status() !== 'running') {
        if (g.status() === 'finished') window.__m8done = { attempts: g.attempts() };
        return;
      }
      const z = g.playerPosition().z;
      const mode = g.playerMode();
      if (mode === 'ship') {
        // M8.1: mirror MultimodeDriver — recover after the dive, then
        // track the bounded exit-gate altitude instead of ceiling-riding.
        // Dive starts at 780 (latency margin before the z 790 block).
        let wantHold;
        if (z < 780) wantHold = true;
        else if (z < 800) wantHold = false;
        else if (z < 815) wantHold = true;
        else wantHold = g.playerPosition().y < 2.6;
        if (wantHold && !shipHeld) { down('Space'); shipHeld = true; }
        if (!wantHold && shipHeld) { up('Space'); shipHeld = false; }
        return;
      }
      if (shipHeld) { up('Space'); shipHeld = false; }
      const ch = g.chompers();
      for (let i = 0; i < ch.length; i++) {
        if (ch[i]?.phase === 'lunging' && !jumpedCh[i]) { jumpedCh[i] = true; tap('Space'); release = true; return; }
      }
      if (release) { release = false; return; }
      if (presses.length > 0 && z >= (presses[0] ?? 1e9)) { presses.shift(); tap('Space'); release = true; return; }
      if (jumps.length > 0 && z >= (jumps[0] ?? 1e9)) { jumps.shift(); tap('Space'); release = true; return; }
      if (taps.length > 0 && z >= ((taps[0]?.z) ?? 1e9)) { const t = taps.shift(); if (t) tap(t.c); }
    }, 25);
  });
  const m8finish = await (async () => {
    const t0 = Date.now();
    let maxZ = 0;
    for (;;) {
      const s = await safeEval(() => ({
        done: window.__m8done,
        status: window.__gd3d.status(),
        z: window.__gd3d.playerPosition().z,
        attempts: window.__gd3d.attempts(),
        deaths: window.__m8deaths ?? [],
      }));
      if (s.status === 'running') maxZ = Math.max(maxZ, s.z);
      if (s.done !== null || s.status === 'finished') return { ...s, maxZ };
      // M8.1: 420 s (was 300 s) — software-rendering lag deaths eat the
      // budget; the deterministic unit route (tick 10321, 0 deaths) is the
      // validity proof, this run is the in-page existence proof.
      if (Date.now() - t0 > 420000) return { ...s, maxZ };
      await page.waitForTimeout(500);
    }
  })();
  await safeEval(() => { if (window.__m8driver) clearInterval(window.__m8driver); window.__m8driver = null; });
  log('m8 full multimode run finishes', m8finish.status === 'finished',
    `status=${m8finish.status} z=${m8finish.z.toFixed(1)} maxZ=${m8finish.maxZ.toFixed(0)} attempts=${m8finish.attempts} deaths=[${m8finish.deaths.join(' ')}]`);
  await capture('m8-15-gauntlet-finish');
  await safeEval(() => window.__gd3d.startReplay());
  const m8verify = await (async () => {
    const t0 = Date.now();
    for (;;) {
      const snap = await safeEval(() => ({
        verify: window.__gd3d.replayVerification(),
        status: window.__gd3d.status(),
      }));
      if (snap.verify.kind === 'pass' || snap.verify.kind === 'diverged') return snap;
      if (Date.now() - t0 > 300000) return snap;
      await page.waitForTimeout(500);
    }
  })();
  log('m8 replay VERIFIED', m8verify.verify.kind === 'pass',
    `verify=${m8verify.verify.kind} status=${m8verify.status}`);
  await capture('m8-16-replay-verified');
  await page.setViewportSize({ width: 1280, height: 720 });

  // Restart hygiene + resource guards on the gauntlet workload.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(600);
  const m8res0 = await m8probe();
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(800);
  const m8res1 = await m8probe();
  log('m8 restart clean', m8res1.z < 10 && m8res1.status === 'running', `z=${m8res1.z.toFixed(1)} status=${m8res1.status}`);
  log('m8 no material/geometry/scene growth',
    m8res1.mats === m8res0.mats && m8res1.geos === m8res0.geos && m8res1.children === m8res0.children,
    `mats=${m8res0.mats}->${m8res1.mats} geos=${m8res0.geos}->${m8res1.geos} children=${m8res0.children}->${m8res1.children}`);

  // --- M8.1 POLISH / PORTAL-BOUNDS / LAVA-RIVER / DEATH-READABILITY GATE ---
  // Lava river crossing (z 128..131): the at-grade curb + a vent mouth
  // read in-frame from the approach.
  await m8freeze(0, 0.55, 118);
  const m81riverFrame = await safeEval(() => window.__gd3d.screenPoint(0, 0.7, 129.5));
  const m81riverSrc = await safeEval(() => window.__gd3d.screenPoint(-4.9, 2.7, 129.5));
  log('m81 lava river curb reads in-frame', !m81riverFrame.behind && Math.abs(m81riverFrame.ndcX) < 1 && Math.abs(m81riverFrame.ndcY) < 1,
    `ndc=(${m81riverFrame.ndcX.toFixed(2)},${m81riverFrame.ndcY.toFixed(2)})`);
  log('m81 river vent reads in-frame', !m81riverSrc.behind && Math.abs(m81riverSrc.ndcX) < 1.2,
    `ndc=(${m81riverSrc.ndcX.toFixed(2)},${m81riverSrc.ndcY.toFixed(2)})`);
  await capture('m81-01-lava-river');
  await m8live();

  // River curb kills as lava when the hop is missed (staged run, no input).
  await m8stage(0, 0.55, 118);
  const m81riverDead = await m8roll((s) => s.status === 'dead', 15000);
  log('m81 missed river hop kills as lava', m81riverDead !== null && m81riverDead.cause === 'lava' && m81riverDead.z > 125 && m81riverDead.z < 136,
    m81riverDead ? `cause=${m81riverDead.cause} z=${m81riverDead.z.toFixed(1)}` : 'survived');

  // Bounded gate + routing consequence: a floor-runner placed past the
  // wall-left gate meets the first S3 routing gap and voids OUT — gravity
  // stays floor (no gate fired after the miss; death is by geometry).
  await m8stage(0, 1.5, 315);
  const m81gapDead = await m8roll((s) => s.status === 'dead', 15000);
  log('m81 missed-gate routing gap kills by geometry', m81gapDead !== null && m81gapDead.cause === 'void' && m81gapDead.grav === 'floor' && m81gapDead.z > 318 && m81gapDead.z < 345,
    m81gapDead ? `cause=${m81gapDead.cause} grav=${m81gapDead.grav} z=${m81gapDead.z.toFixed(1)}` : 'survived');

  // Compact portal gate portrait: ring + flanking pylons on the approach.
  await m8freeze(0, 0.55, 300);
  const m81gateFrame = await safeEval(() => window.__gd3d.screenPoint(0, 1.7, 310));
  log('m81 portal gate reads in-frame', !m81gateFrame.behind && Math.abs(m81gateFrame.ndcX) < 1 && Math.abs(m81gateFrame.ndcY) < 1,
    `ndc=(${m81gateFrame.ndcX.toFixed(2)},${m81gateFrame.ndcY.toFixed(2)})`);
  await capture('m81-02-portal-gate');
  await m8live();

  // Ship tunnel: both side walls project in-frame from inside the corridor.
  await m8freeze(0, 2, 745);
  const m81wallL = await safeEval(() => window.__gd3d.screenPoint(-6, 3, 758));
  const m81wallR = await safeEval(() => window.__gd3d.screenPoint(6, 3, 758));
  log('m81 ship tunnel walls read both sides', !m81wallL.behind && !m81wallR.behind && Math.abs(m81wallL.ndcX) < 1.2 && Math.abs(m81wallR.ndcX) < 1.2,
    `L=(${m81wallL.ndcX.toFixed(2)},${m81wallL.ndcY.toFixed(2)}) R=(${m81wallR.ndcX.toFixed(2)},${m81wallR.ndcY.toFixed(2)})`);
  await capture('m81-03-ship-tunnel');
  await m8live();

  // Chomper lava-creature portraits: dormant phase proof just before the
  // trigger, then a close side-on telegraph portrait (ignited eyes +
  // chewing jaw + fangs + heat-spikes read best mid-telegraph).
  await m8freeze(3, 1.5, 586);
  const m81chomp = await m8probe();
  log('m81 chomper waits dormant before its trigger', m81chomp.chompers[0]?.phase === 'dormant',
    `phase=${m81chomp.chompers[0]?.phase}`);
  await capture('m81-04-chomper');
  await m8live();
  await m8freeze(5, 1.2, 598);
  await capture('m81-04b-chomper-telegraph');
  await m8live();

  // Death readability: staged lava death photographed mid-burst. CDP
  // round-trips cannot fit inside the 0.65 s hold, so ALL timing lives in
  // the page (the canonical freeze-dance): a 16 ms watcher freezes +
  // replays the REAL pooled burst (+ghost shell) at the recorded death
  // position on the staged death, holds the frozen frame, and records the
  // gate — CDP only arms, waits, and captures. The watcher arms AFTER the
  // confirmed stage: arming earlier lets a stale staging-round death
  // consume the one shot (proven by forensics — empty photos with a
  // passing gate). Past this point the sim runs from above the pool, so
  // the next death is provably the staged one.
  // M8.2: up to 3 photo tries (same thresholds — a try that records a
  // live pooled burst on a dead sim passes). Under SwiftShader load the
  // single-shot freeze-dance flakes ~50% (stale pause parity across the
  // KeyP toggle under load); retries re-stage cleanly instead of faking it.
  let m81burstDead = null;
  let m81gate = null;
  for (let attempt = 0; attempt < 3 && !(m81burstDead !== null && m81gate !== null && m81gate.burst === true && m81gate.status === 'dead'); attempt++) {
    await m8stage(0, -1.9, 43);
    await safeEval(() => {
      if (window.__m81watch) clearInterval(window.__m81watch);
      window.__m81gate = null;
      window.__m81watch = setInterval(() => {
        if (window.__gd3d.status() === 'dead' && window.__m81gate === null) {
          window.__m81gate = { pending: true }; // one-shot: disarm synchronously
          window.__gd3d.debugFreezeFrame(true);
          window.__gd3d.debugReplayBurst();
          window.__gd3d.debugFreezeFrame(false);
          // M8.1: run 120 ms live (spread voxels + bright ghost), then PAUSE
          // the sim (KeyP) so the 78-tick auto-respawn cannot clear the burst
          // before CDP captures, and freeze the frame for the photo.
          setTimeout(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyP' }));
            window.__gd3d.debugFreezeFrame(true);
            window.__m81gate = {
              burst: window.__gd3d.burstActive(),
              status: window.__gd3d.status(),
            };
          }, 120);
        }
      }, 16);
    });
    m81burstDead = await m8roll((s) => s.status === 'dead', 15000);
    m81gate = null;
    for (let i = 0; i < 60 && (m81gate === null || m81gate.pending === true); i++) {
      await page.waitForTimeout(100);
      m81gate = await safeEval(() => window.__m81gate);
    }
  }
  log('m81 death explosion + ghost read', m81burstDead !== null && m81gate !== null && m81gate.burst === true && m81gate.status === 'dead',
    m81gate ? `burst=${m81gate.burst} status=${m81gate.status}` : 'no frozen frame');
  await capture('m81-05-death-burst');
  await safeEval(() => {
    clearInterval(window.__m81watch);
    window.__m81watch = null;
    window.__gd3d.debugFreezeFrame(false);
    // Resume the sim (the photo sequence paused it to hold the burst).
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyP' }));
  });
  await m8live();
// --- M8.2 LAVA / PORTAL-BOUNDS / SPIDER-CAMERA / CHOMPER GATE ---
  // Lava rework: stepped falls + vent lips over the gap-basin pour read
  // in-frame from the S1 approach (new M8.2 vent line x −4.2).
  await m8freeze(0, 0.55, 30);
  const m82ventFrame = await safeEval(() => window.__gd3d.screenPoint(-4.2, 0.5, 43));
  const m82fallFrame = await safeEval(() => window.__gd3d.screenPoint(-4, -1.2, 43));
  log('m82 vent lip + stepped fall read in-frame', !m82ventFrame.behind && !m82fallFrame.behind && Math.abs(m82ventFrame.ndcX) < 1.2 && Math.abs(m82fallFrame.ndcX) < 1.2,
    `vent=(${m82ventFrame.ndcX.toFixed(2)},${m82ventFrame.ndcY.toFixed(2)}) fall=(${m82fallFrame.ndcX.toFixed(2)},${m82fallFrame.ndcY.toFixed(2)})`);
  await capture('m82-01-lava-source-fall');
  await m8live();

  // At-grade river curb with visible (protruding) side vents.
  await m8freeze(0, 0.55, 118);
  const m82riverFrame = await safeEval(() => window.__gd3d.screenPoint(0, 0.7, 129.5));
  const m82riverSrc = await safeEval(() => window.__gd3d.screenPoint(-4.2, 2.9, 129.5));
  log('m82 river curb + protruding vent read in-frame', !m82riverFrame.behind && !m82riverSrc.behind && Math.abs(m82riverFrame.ndcX) < 1 && Math.abs(m82riverSrc.ndcX) < 1.2,
    `curb=(${m82riverFrame.ndcX.toFixed(2)},${m82riverFrame.ndcY.toFixed(2)}) vent=(${m82riverSrc.ndcX.toFixed(2)},${m82riverSrc.ndcY.toFixed(2)})`);
  await capture('m82-02-lava-river');
  await m8live();

  // Opening-sized gate portrait: the small ring sits on the rider line.
  await m8freeze(0, 0.55, 300);
  const m82gateFrame = await safeEval(() => window.__gd3d.screenPoint(0, 1.5, 310));
  log('m82 opening-sized gate reads in-frame', !m82gateFrame.behind && Math.abs(m82gateFrame.ndcX) < 1 && Math.abs(m82gateFrame.ndcY) < 1,
    `ndc=(${m82gateFrame.ndcX.toFixed(2)},${m82gateFrame.ndcY.toFixed(2)})`);
  await capture('m82-03-gate');
  await m8live();

  // Through the opening fires: staged on the line, the small gate flips.
  await m8stage(0, 0.55, 300);
  const m82inside = await m8roll((s) => s.z > 312, 15000);
  log('m82 through-opening pass fires the gate', m82inside !== null && m82inside.grav === 'leftWall',
    m82inside ? `grav=${m82inside.grav} z=${m82inside.z.toFixed(1)}` : 'no crossing');

  // Beside the ring does NOT fire: staged outside at x 4.5 with lane
  // intent pinned to lane 0 (one ArrowLeft edge — the x 2.6 line clears
  // the 1.6-half opening; the unit suite pins this line exactly). Lane
  // pull during staging travel is the failure mode (proven by forensics:
  // bare staging drifts into the gate and fires). Crossing z 310 then
  // leaves gravity on floor — and the S3 routing gap ends the run by
  // geometry (void, floor).
  // Beside-the-ring miss, deterministic by construction. The race the
  // forensics proved: teleport-then-tap burns travel time while lane-1
  // pull (12–16 u/s) carries the cube into the gate, and tap edges get
  // lost under load. Fix: pin lane-0 intent BEFORE the teleport (R +
  // live run + ArrowLeft edge, verified via targetLaneIndex), THEN place
  // outside at x 4.85. Lane-0 intent can only pull the cube AWAY from
  // the gate (asymptote x 2.6, box clears the 1.6-half opening) — firing
  // becomes impossible, so any recorded fire is a REAL bug, not harness.
  let m82lane = -1;
  for (let i = 0; i < 3 && m82lane !== 0; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(500);
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowLeft');
    await page.waitForTimeout(200);
    m82lane = (await m8probe()).lane;
    if (m82lane !== 0) continue;
    await safeEval(() => window.__gd3d.debugTeleport(4.85, 0.55, 305));
    await page.waitForTimeout(100);
    if ((await m8probe()).lane !== 0) m82lane = -1;
  }
  log('m82 outside intent pinned before the crossing', m82lane === 0, `lane=${m82lane}`);
  const m82miss = await m8roll((s) => s.z > 312, 15000);
  log('m82 beside-the-ring pass does NOT fire', m82miss !== null && m82lane === 0 && m82miss.grav === 'floor',
    m82miss ? `lane=${m82lane} grav=${m82miss.grav} z=${m82miss.z.toFixed(1)}` : 'no crossing');
  const m82geoDead = await m8roll((s) => s.status === 'dead', 15000);
  log('m82 missed gate fails later by geometry', m82geoDead !== null && m82geoDead.cause === 'void' && m82geoDead.grav === 'floor',
    m82geoDead ? `cause=${m82geoDead.cause} grav=${m82geoDead.grav} z=${m82geoDead.z.toFixed(1)}` : 'survived');

  // Spider swap glide: stage before spider-on, roll into spider mode,
  // press to snap up, and prove the glide envelope armed (unit tests pin
  // the glide math; the counter proves the path engaged in-page).
  await m8stage(0, 0.55, 850);
  const m82spider = await m8roll((s) => s.pMode === 'spider', 15000);
  log('m82 staged spider mode engages', m82spider !== null && m82spider.pMode === 'spider',
    m82spider ? `mode=${m82spider.pMode} z=${m82spider.z.toFixed(1)}` : 'no spider');
  // Wait for the ceiling slab (z 875+) before pressing: a press over
  // open sky is correctly ignored (no support in range), which consumed
  // the first attempt (proven by forensics — press at z ~868, no snap).
  await m8roll((s) => s.z > 882, 15000);
  const m82glidesBefore = await safeEval(() => window.__gd3d.swapGlideCount());
  await page.keyboard.down('Space');
  await page.waitForTimeout(150);
  await page.keyboard.up('Space');
  const m82swapped = await m8roll((s) => s.grav === 'ceiling', 8000);
  const m82glidesAfter = await safeEval(() => window.__gd3d.swapGlideCount());
  log('m82 spider swap arms the camera glide', m82swapped !== null && m82glidesAfter > m82glidesBefore,
    m82swapped ? `grav=${m82swapped.grav} glides=${m82glidesBefore}->${m82glidesAfter}` : 'no swap');
  await capture('m82-05a-spider-glide');
  await page.waitForTimeout(800);
  await capture('m82-05b-spider-settled');
  await m8live();

  // Chomper lava-chomper portraits: dormant bulk + mid-telegraph gape
  // (blocky head, fangs, hooded eyes, crust bands).
  await m8freeze(3, 1.5, 586);
  const m82chomp = await m8probe();
  log('m82 chomper waits dormant before its trigger', m82chomp.chompers[0]?.phase === 'dormant',
    `phase=${m82chomp.chompers[0]?.phase}`);
  await capture('m82-06-chomper');
  await m8live();
  await m8freeze(5, 1.2, 598);
  await capture('m82-06b-chomper-telegraph');
  await m8live();

  // Replay still verifies after the M8.2 content changes (references the
  // full-run M8 section result above — same page session).
  const m82replayOk = results.some((r) => r.name === 'm8 replay VERIFIED' && r.ok === true);
  log('m82 replay still VERIFIED after content changes', m82replayOk === true,
    m82replayOk ? 'full-run tape verified' : 'M8 full-run replay did not verify');

// --- M8.3 LAVA MOTION / CHOMPER STYLE / SPIDER CONTINUITY GATE ---
  // Lava flows in-page: frozen checksum stable, live checksum advances.
  await m8freeze(0, 0.55, 118);
  const m83lavaA = await safeEval(() => window.__gd3d.lavaMotion());
  await m8setPaused(false);
  await page.waitForTimeout(800);
  await m8freeze(0, 0.55, 118);
  const m83lavaB = await safeEval(() => window.__gd3d.lavaMotion());
  log('m83 lava flow advances live in-page', m83lavaA !== '' && m83lavaB !== '' && m83lavaA !== m83lavaB,
    `a=${m83lavaA} b=${m83lavaB}`);
  const m83lavaC = await safeEval(() => window.__gd3d.lavaMotion());
  await page.waitForTimeout(300);
  const m83lavaD = await safeEval(() => window.__gd3d.lavaMotion());
  log('m83 lava freezes exactly on pause', m83lavaC !== '' && m83lavaC === m83lavaD,
    `c=${m83lavaC} d=${m83lavaD}`);
  await m8live();

  // Two-phase flow portrait: same anchor, ~0.45 s of flow apart.
  await m8freeze(0, 0.55, 30);
  await capture('m83-01a-lava-flow');
  await m8setPaused(false);
  await page.waitForTimeout(450);
  await m8freeze(0, 0.55, 30);
  await capture('m83-01b-lava-flow');
  await m8live();

  // Chomper reference portraits: dormant magma-ball + telegraph maw.
  // Dormant sits close (z 598, still short of triggerZ 600) so the
  // voxel anatomy fills the frame; telegraph crosses 600 to latch.
  await m8freeze(5, 1.8, 598);
  await capture('m83-02-chomper');
  await m8live();
  await m8freeze(5, 1.5, 602);
  await capture('m83-02b-chomper-maw');
  await m8live();

  // Spider continuity: sample the camera eye across the swap — a cut
  // would move several units in one poll; the glide peaks ~0.25 u.
  // The section is dangerous (dodge wall), so retry the stage on death
  // and gate the max-step on player-Z continuity (respawn/teleport
  // snaps are sanctioned cuts — the swap itself barely moves Z).
  let m83swapped = null;
  let m83maxStep = Infinity;
  let m83polls = 0;
  let m83glideDelta = false;
  for (let attempt = 0; attempt < 3 && m83swapped === null; attempt++) {
    await m8stage(0, 0.55, 850);
    const spider = await m8roll((s) => s.pMode === 'spider', 15000);
    if (spider === null) continue;
    const glidesBefore = await safeEval(() => window.__gd3d.swapGlideCount());
    let pressed = false;
    let track = [];
    const t0 = Date.now();
    for (;;) {
      const s = await safeEval(() => ({
        eye: window.__gd3d.cameraEye(),
        z: window.__gd3d.playerPosition().z,
        grav: window.__gd3d.gravityMode(),
        status: window.__gd3d.status(),
      }));
      s.t = Date.now();
      track.push(s);
      if (s.status !== 'running') break;
      if (s.grav === 'ceiling') { m83swapped = s; break; }
      if (!pressed && s.z > 882) {
        await page.keyboard.down('Space');
        await page.waitForTimeout(150);
        await page.keyboard.up('Space');
        pressed = true;
      }
      if (Date.now() - t0 > 12000) break;
      await page.waitForTimeout(25);
    }
    if (m83swapped !== null) {
      const glidesAfter = await safeEval(() => window.__gd3d.swapGlideCount());
      m83glideDelta = glidesAfter > glidesBefore;
      m83polls = track.length;
      // Stall-proof cut metric: lateral/vertical eye VELOCITY between
      // polls (the cut is a Y transition — forward Z tracking is
      // excluded). A snap covers ~2.8 u in one frame (>100 u/s); the
      // glide peaks ~9.5 u/s mid-travel; poll stalls can't fake a cut.
      let peakV = 0;
      for (let i = 1; i < track.length; i++) {
        const a = track[i - 1];
        const b = track[i];
        if (Math.abs(b.z - a.z) > 5) continue; // sanctioned snap, not the swap
        const dt = Math.max(1, b.t - a.t) / 1000;
        peakV = Math.max(peakV,
          Math.hypot(b.eye.x - a.eye.x, b.eye.y - a.eye.y) / dt);
      }
      m83maxStep = peakV;
    }
  }
  log('m83 staged spider mode engages', m83polls > 0, `polls=${m83polls}`);
  log('m83 spider swap arms the glide (no snap cut)', m83swapped !== null && m83glideDelta,
    m83swapped ? `grav=${m83swapped.grav} glideArmed=${m83glideDelta}` : 'no swap');
  log('m83 spider swap has no camera cut (peak eye velocity < 25 u/s)', m83swapped !== null && m83maxStep < 25,
    `peakV=${m83maxStep.toFixed(1)}u/s over ${m83polls} polls`);
  await capture('m83-03-spider-continuity');
  await m8live();

  // Replay still verifies after the M8.3 changes (same page session).
  const m83replayOk = results.some((r) => r.name === 'm8 replay VERIFIED' && r.ok === true);
  log('m83 replay still VERIFIED after M8.3 changes', m83replayOk === true,
    m83replayOk ? 'full-run tape verified' : 'M8 full-run replay did not verify');

// --- M8.4 DIRECTED LAVA FLOW GATE ---
  // Conveyor checksum still advances live / freezes on pause (now covers
  // traveling cores, current-riding crust, pour pulses).
  await m8freeze(0, 0.55, 118);
  const m84lavaA = await safeEval(() => window.__gd3d.lavaMotion());
  await m8setPaused(false);
  await page.waitForTimeout(800);
  await m8freeze(0, 0.55, 118);
  const m84lavaB = await safeEval(() => window.__gd3d.lavaMotion());
  log('m84 lava conveyors advance live in-page', m84lavaA !== '' && m84lavaB !== '' && m84lavaA !== m84lavaB,
    `a=${m84lavaA} b=${m84lavaB}`);
  const m84lavaC = await safeEval(() => window.__gd3d.lavaMotion());
  await page.waitForTimeout(300);
  const m84lavaD = await safeEval(() => window.__gd3d.lavaMotion());
  log('m84 lava conveyors freeze exactly on pause', m84lavaC !== '' && m84lavaC === m84lavaD,
    `c=${m84lavaC} d=${m84lavaD}`);
  await m8live();

  // River coherence: east vent + crossing + channel + cliff drop all
  // project in-frame from one pre-river anchor — one continuous
  // source-to-fall composition, not scattered blobs.
  await m8freeze(0, 1.5, 118);
  const m84src = await safeEval(() => window.__gd3d.screenPoint(4.2, 2.9, 129.5));
  const m84cross = await safeEval(() => window.__gd3d.screenPoint(0, 0.7, 129.5));
  const m84chan = await safeEval(() => window.__gd3d.screenPoint(-6.4, 0, 129.5));
  const m84drop = await safeEval(() => window.__gd3d.screenPoint(-8.6, -2, 129.5));
  const m84in = (p) => !p.behind && Math.abs(p.ndcX) < 1.2 && Math.abs(p.ndcY) < 1.2;
  log('m84 river reads as one source-to-fall composition',
    m84in(m84src) && m84in(m84cross) && m84in(m84chan) && m84in(m84drop),
    `src=(${m84src.ndcX.toFixed(2)},${m84src.ndcY.toFixed(2)}) cross=(${m84cross.ndcX.toFixed(2)},${m84cross.ndcY.toFixed(2)}) chan=(${m84chan.ndcX.toFixed(2)},${m84chan.ndcY.toFixed(2)}) drop=(${m84drop.ndcX.toFixed(2)},${m84drop.ndcY.toFixed(2)})`);
  await m8live();

  // Evidence portraits: source gate, crossing, cliff drop, close-up.
  await m8freeze(2.5, 2.2, 121);
  await capture('m84-01-source');
  await m8live();
  await m8freeze(0, 1.2, 121);
  await capture('m84-02-crossing');
  await m8live();
  await m8freeze(-2.5, 1.6, 119);
  await capture('m84-03-drop');
  await m8live();
  await m8freeze(-3, 1.4, 123);
  await capture('m84-04-closeup');
  await m8live();

  // The redirected river still kills: stage before it, roll in swinging.
  await m8stage(0, 0.55, 118);
  const m84kill = await m8roll((s) => s.status === 'dead', 15000);
  log('m84 missed hop still kills as lava', m84kill !== null && m84kill.cause === 'lava',
    m84kill ? `cause=${m84kill.cause} z=${m84kill.z.toFixed(1)}` : 'survived');

  // Replay still verifies after the M8.4 content changes (same session).
  const m84replayOk = results.some((r) => r.name === 'm8 replay VERIFIED' && r.ok === true);
  log('m84 replay still VERIFIED after M8.4 changes', m84replayOk === true,
    m84replayOk ? 'full-run tape verified' : 'M8 full-run replay did not verify');

// --- Console audit (M8 slice) ---
log('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
log('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
