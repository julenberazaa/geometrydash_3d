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
const log = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
};

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
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(600);
      const p = await pos();
      if (p.z < 10) break;
    }
  };
  const m8stage = async (x, y, z) => {
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(600);
      const p = await pos();
      if (p.z < 10) break;
    }
    await safeEval((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x, y, z });
    await page.waitForTimeout(300);
  };
  const m8freeze = async (x, y, z) => {
    for (let round = 0; round < 3; round++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(300);
      await safeEval((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x, y, z });
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(250);
      const z1 = (await pos()).z;
      await page.waitForTimeout(250);
      const s = await m8probe();
      if (s.status === 'running' && Math.abs(s.z - z1) < 0.05) return s;
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(500);
    }
    return m8probe();
  };
  const m8live = async (rounds = 4) => {
    for (let i = 0; i < rounds; i++) {
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(500);
      const z1 = (await pos()).z;
      await page.waitForTimeout(800);
      const z2 = (await pos()).z;
      if (Math.abs(z2 - z1) > 0.01) return;
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
  await m8stage(0, -1.9, 43);
  const m8lavaDead = await m8roll((s) => s.status === 'dead', 15000);
  log('m8 lava contact kills instantly', m8lavaDead !== null && m8lavaDead.cause === 'lava',
    m8lavaDead ? `cause=${m8lavaDead.cause}` : 'survived');
  // Burst edge first (fresh, ~ms old), then a tight linger proof: still
  // dead 250 ms wall after the edge (holds at any sim/wall ratio given
  // sub-150 ms poll latency; the authoritative 78-tick hold is pinned
  // headlessly), then the evidence photo and the respawn wait.
  const m8burst = await m8probe();
  log('m8 death explosion fires', m8burst.burst === true, `burst=${m8burst.burst}`);
  await page.waitForTimeout(250);
  const m8stillDead = await m8probe();
  log('m8 dead state lingers readably before auto-respawn', m8stillDead.status === 'dead',
    `status=${m8stillDead.status} 250ms after the edge`);
  const m8respawned = await m8roll((s) => s.status === 'running', 8000);
  log('m8 auto-respawn follows the readable window', m8respawned !== null,
    m8respawned ? `z=${m8respawned.z.toFixed(1)}` : 'never respawned');

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
  await safeEval(() => {
    if (window.__m8chompWatch) clearInterval(window.__m8chompWatch);
    window.__m8chompJumped = [false, false];
    window.__m8chompWatch = setInterval(() => {
      const g = window.__gd3d;
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
  await m8stage(0, 0.55, 585);
  // Generous timeout: a long post-on session degrades sim/wall ratio and
  // 585 → 675 needs ~7 s sim (≈15-30 s wall here). Detail distinguishes
  // timeout-alive from real death.
  const m8jumped = await m8roll((s) => s.z > 675, 90000);
  await safeEval(() => { if (window.__m8chompWatch) clearInterval(window.__m8chompWatch); window.__m8chompWatch = null; });
  log('m8 player jumps over the chomper', m8jumped !== null && m8jumped.status === 'running',
    m8jumped ? `z=${m8jumped.z.toFixed(1)} status=${m8jumped.status}` : 'no crossing (timeout)');
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
    let jumps = [37.5, 87.5, 997.5, 1012.5];
    let taps = [{ z: 160, c: 'ArrowLeft' }, { z: 196, c: 'ArrowRight' }, { z: 199, c: 'ArrowRight' }, { z: 232, c: 'ArrowLeft' }];
    let presses = [890, 935];
    let jumpedCh = [false, false];
    let release = false;
    let attempts = window.__gd3d.attempts();
    let shipHeld = false;
    window.__m8driver = setInterval(() => {
      const g = window.__gd3d;
      if (g.attempts() !== attempts) {
        attempts = g.attempts();
        jumps = [37.5, 87.5, 997.5, 1012.5];
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
        const wantHold = z < 784 || z >= 800;
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
    for (;;) {
      const s = await safeEval(() => ({
        done: window.__m8done,
        status: window.__gd3d.status(),
        z: window.__gd3d.playerPosition().z,
        attempts: window.__gd3d.attempts(),
      }));
      if (s.done !== null || s.status === 'finished') return s;
      if (Date.now() - t0 > 300000) return s;
      await page.waitForTimeout(500);
    }
  })();
  await safeEval(() => { if (window.__m8driver) clearInterval(window.__m8driver); window.__m8driver = null; });
  log('m8 full multimode run finishes', m8finish.status === 'finished',
    `status=${m8finish.status} z=${m8finish.z.toFixed(1)} attempts=${m8finish.attempts}`);
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
// --- Console audit (M8 slice) ---
log('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
log('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
