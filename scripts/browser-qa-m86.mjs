/**
 * M8.6 browser QA gate (dev tool, not shipped).
 * Focused M8.6-content gate for THE DESCENT: staged environment
 * captures, moving-platform + Chomper probes, a full real-input in-page
 * reference run (real KeyboardEvents through the real InputSystem; CDP
 * only observes), in-page REPLAY VERIFIED, and a resource/console audit.
 *
 * M9.4.2: boots the EXACT M8.6 route at `?level=the-descent` (the-descent
 * now carries the e5b0d86 content; the modern GRAVITY RIFT route has its
 * own gates: browser-qa-m94/m941/m92). Direct entry needs one Space
 * gesture to start the run (press-to-start gate); THE DESCENT declares
 * no music, so the gesture starts it immediately with no audio handoff.
 *
 * M9.5: THE DESCENT carries the surgical density polish (3 new Chompers,
 * LOW weave, maze doors, foundry doors) + Zenith of the Path music. The
 * in-page mirror below ports the M9.5 unit-driver policy (taps/jumps +
 * sorted chomper indices); the gesture now also starts Zenith audio.
 * Full-route proof also exists via tape injection (browser-qa-m95).
 *
 * Usage: node scripts/browser-qa-m86.mjs   (requires dev server on :5173)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import nodeChildProcess from 'node:child_process';

const URL = process.env.QA_URL ?? 'http://localhost:5173/';
// M9.4.2: the EXACT M8.6 route under test (bare URL holds the main menu).
const DESCENT_URL = `${URL}?level=the-descent`;
const OUT_DIR = path.resolve('qa/screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
};

const gitSha = (() => {
  try {
    return nodeChildProcess.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

const browser = await chromium.launch({
  // Headless pages count as occluded/backgrounded: without these the
  // browser throttles timers/rAF into second-scale stalls that skip whole
  // input windows (each stall is a run-ending mistiming at 14 u/s).
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
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
};
await safeGoto(DESCENT_URL);
await waitReady();
await page.waitForTimeout(2000);

const pos = () => page.evaluate(() => window.__gd3d.playerPosition());
const sidecarBase = {
  url: URL,
  capturedAt: new Date().toISOString(),
  git: { sha: gitSha },
  env: { userAgent: await page.evaluate(() => navigator.userAgent) },
};
async function capture(name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  const appState = await page.evaluate(() => ({
    status: window.__gd3d?.status?.() ?? 'n/a',
    attempts: window.__gd3d?.attempts?.() ?? -1,
    playerPosition: window.__gd3d?.playerPosition?.() ?? null,
    playerMode: window.__gd3d?.playerMode?.() ?? 'n/a',
    gravityMode: window.__gd3d?.gravityMode?.() ?? 'n/a',
  }));
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify({
    ...sidecarBase,
    capture: { name, accepted: true, rejectionReasons: [] },
    appState,
    errors: { consoleErrors: [...consoleErrors], pageErrors: [...pageErrors] },
    png: { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
  }, null, 2));
  return appState;
}

const probe = () => page.evaluate(() => ({
  id: window.__gd3d.levelId(),
  name: window.__gd3d.levelDisplayName(),
  status: window.__gd3d.status(),
  z: window.__gd3d.playerPosition().z,
  y: window.__gd3d.playerPosition().y,
  x: window.__gd3d.playerPosition().x,
  pMode: window.__gd3d.playerMode(),
  grav: window.__gd3d.gravityMode(),
  support: window.__gd3d.supportId(),
  chompers: window.__gd3d.chompers(),
  platforms: window.__gd3d.platforms(),
  mats: window.__gd3d.materialCount(),
  geos: window.__gd3d.geometryCount(),
  children: window.__gd3d.sceneChildren(),
  stats: window.__gd3d.rendererStats(),
}));
const fresh = async (url) => {
  await safeGoto(url);
  await waitReady();
  await page.waitForTimeout(2000);
  // Direct entry holds at the press-to-start gate: one Space gesture
  // starts the run (M9.5: the gesture also unlocks Zenith audio; the
  // edge is flushed by the gate and never becomes gameplay input).
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(600);
    if ((await pos()).z < 10) break;
  }
};
const freeze = async (x, y, z) => {
  for (let round = 0; round < 3; round++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);
    await page.evaluate((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x, y, z });
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(250);
    const z1 = (await pos()).z;
    await page.waitForTimeout(250);
    const s = await probe();
    if (s.status === 'running' && Math.abs(s.z - z1) < 0.05) return s;
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(500);
  }
  return probe();
};
const live = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) {
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(500);
    const z1 = (await pos()).z;
    await page.waitForTimeout(800);
    if (Math.abs((await pos()).z - z1) > 0.01) return;
  }
};

// --- A. Boot contract: M8.6 direct entry + override ---
await fresh(DESCENT_URL);
{
  const b = await probe();
  log('m86 M8.6 entry is THE DESCENT at the-descent', b.id === 'the-descent' && b.name === 'THE DESCENT',
    `id=${b.id} name=${b.name}`);
}
await fresh(`${URL}?level=multimode-gauntlet-01`);
{
  const b = await probe();
  log('m86 explicit ?level= override still works', b.id === 'multimode-gauntlet-01', `id=${b.id}`);
}
await fresh(DESCENT_URL);

// --- B. 16 staged evidence captures (one per DoD beat) ---
const stages = [
  ['m86-01-opening', 0, 0.55, 135, 'opening density (river + weave)'],
  ['m86-02-stairs', 0, 1.5, 40, 'staircase ascent'],
  ['m86-03-islands', 0, 5.05, 245, 'multi-level islands (MID traverse)'],
  ['m86-04-ferry', 0, 0.55, 370, 'moving island sequence (ferry void)'],
  ['m86-05-maze', 0, 0.55, 470, 'high-speed maze'],
  ['m86-06-decks', 0, 5.05, 575, 'stacked maze decks (upper)'],
  ['m86-07-gravity', 0, 9.45, 760, 'gravity architecture (ceiling run)'],
  ['m86-08-chomper', 0, 0.55, 945, 'Chomper combo (ferry deck)'],
  ['m86-09-ship-tunnel', 0, 3, 1160, 'normal Ship tunnel'],
  ['m86-10-inverted', 0, 3, 1210, 'inverted Ship ribs'],
  ['m86-11-spider', 0, 0.55, 1350, 'Spider floor/ceiling'],
  ['m86-12-climb', 0, 8.55, 1440, 'Spider wall sequence (runway + dodge wall)'],
  ['m86-13-teleport', 0, 0.55, 1512, 'teleport network (gantry)'],
  ['m86-14-vertical', 0, 0.55, 500, 'vertical environment (towers + lava)'],
  ['m86-15-remix', 0, 0.55, 1680, 'final remix weave'],
  ['m86-16-finish', 0, 0.55, 1782, 'finish gate'],
];
for (const [name, x, y, z, label] of stages) {
  const s = await freeze(x, y, z);
  const ok = s.status === 'running';
  await capture(name);
  await live();
  log(`m86 staged ${label}`, ok, `z=${s.z.toFixed(1)} status=${s.status}`);
}

// --- C. Moving platforms are live simulation-owned poses in-page ---
await freeze(0, 0.55, 370);
{
  const a = await page.evaluate(() => window.__gd3d.platforms());
  await live();
  await page.waitForTimeout(1200);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(250);
  const b = await page.evaluate(() => window.__gd3d.platforms());
  await page.keyboard.press('KeyP');
  await live();
  const moved = a.some((p, i) => Math.abs(p.x - b[i].x) > 0.05 || Math.abs(p.y - b[i].y) > 0.05);
  const ids = b.map((p) => p.id).join(',');
  log('m86 moving platforms advance live in-page', b.length === 5 && moved,
    `count=${b.length} moved=${moved} ids=${ids}`);
}

// --- D. Chomper telegraph on approach ---
await fresh(DESCENT_URL);
await page.evaluate(() => window.__gd3d.debugTeleport(0, 0.55, 945));
await page.keyboard.press('KeyP');
await page.waitForTimeout(250);
await page.keyboard.press('KeyP');
{
  let armed = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const s = await probe();
    if ((s.chompers ?? []).some((c) => c.phase !== 'dormant')) { armed = s; break; }
    await page.waitForTimeout(100);
  }
  log('m86 chomper telegraphs on approach', armed !== null,
    armed ? `phases=${armed.chompers.map((c) => c.phase).join(',')}` : 'stayed dormant');
}

// --- E. Full real-input reference run (primary policy, unit-faithful edges) ---
// Install the driver BEFORE the final reset: jump 18 sits ~1.5 s out and
// driver install (viewport + evaluates) eats that budget, so installing
// on a live run then R-resetting re-arms the plan from the start line
// (the attempts-change guard resets everything). Small run viewport:
// SwiftShader raster cost dominates the main thread and CPU throttling
// stretches frames into run-killing stalls (staged evidence stays 1280),
// so the counted run drops to 320x180: control timing is what is under
// test, not pixels.
await page.setViewportSize({ width: 320, height: 180 });
await fresh(`${URL}?level=the-descent&post=off&fx=off&triggers=off`);
await page.evaluate(() => {
  if (window.__m86driver) clearInterval(window.__m86driver);
  window.__m86done = null;
  window.__m86rode = false;
  const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  // Triangular pingpong mirror of movingPlatformSystem.platformPose.
  const poseX = (base, amp, period, phase, tick) => {
    const raw = (((tick + phase) % period) + period) % period;
    const ph = raw / period;
    const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    return base + (tri * 2 - 1) * amp;
  };
  const MAZE_A = { base: -2.6, amp: 2, period: 300, phase: 74 };
  const MAZE_B = { base: 2.6, amp: 2, period: 300, phase: 224 };
  // Void-ferry pose params (ps-ferry-void: base x=0, amp 4, period 360).
  const VOID_FERRY = { base: 0, amp: 4, period: 360, phase: 0 };
  // Air-follow deck boxes (unit-driver mirror: deck z-range = base ± half
  // with a 5 u approach apron; axis-x ferries only, same as unit).
  const FERRY_BOXES = {
    'platform-ps-ferry-void': { z0: 378, z1: 403 },
    'platform-ps-ferry-maze-a': { z0: 660, z1: 671 },
    'platform-ps-ferry-maze-b': { z0: 672, z1: 683 },
    'platform-ps-ferry-chomp': { z0: 935, z1: 960 },
  };
  const reset = () => ({
    // z-triggered jumps [z, lead, stale]. Stale 2.5 u default (a late
    // spike-hop cascades into the next hazard — skip and re-arm on death);
    // open-road rhythm entries carry stale 8 (a late hop is harmless).
    jumps: [
      [18, 2], [36, 1.5], [43, 0.5], [53, 1.5],
      [89, 0.7, 8], [104, 2], [138, 2], [147, 2], [161, 2],
      [172.5, 1.5], [182.5, 1.5], [192.5, 1.5], [202.5, 2.5], [211.5, 2], [221.5, 1.5], [234, 1.5],
      [245.5, 1.5, 8], [255.5, 1.5, 8],
      [319, 2], [329, 1.5],
      // Ferry exit 401 fires from the moving deck: lead 1.0 (a solo
      // SwiftShader frame stall can eat the whole 0.5 u lead; landing
      // from 400 still reaches the far runway at 408+, same as unit).
      [376, 2], [401, 1.0], [412, 2],
      [427, 2, 8], [439, 2, 8],
      [459.5, 2], [469.5, 2], [489.5, 2], [499.5, 2],
      [520, 1.5, 8], [534, 1.5, 8], [548, 3, 8], [559, 2, 8], [583, 2, 8],
      [597, 3, 8], [609, 2, 8], [623, 0], [640, 1.5, 8],
      [364, 1, 8], [572, 3, 8],
      [728, 2], [756.5, 2], [766.5, 0.5], [769, 1, 8], [786.5, 2],
      [869.5, 2, 8], [879.5, 2, 8],
      // Chomper-ferry exit 957 carries stale 4.5: the lunge-dodge jump
      // lands back on the deck as late as ~959 on coarse polls, and the
      // far slab runs 965..1000 — firing as late as 961.5 still lands it
      // (961.5 + 8.8 jump reach ≈ 970), same margin class as the 401 exit.
      [933, 2], [957, 1, 4.5], [1042.5, 2], [1066, 2], [1077, 2, 8],
      // M9.5 Zone D: the ship-approach hops are replaced by maze doors
      // (taps below) — 1087.5/1097.5 removed, like the unit driver.
      [1318, 1.5, 8],
      [1503.5, 2], [1542, 2], [1558, 2], [1577.5, 1], [1587, 1],
      [1633, 2], [1642, 2], [1651, 2], [1660.5, 0.5], [1767.5, 2],
    ].map(([z, lead, stale]) => ({ z, lead, stale: stale ?? 2.5, done: false }))
      .sort((a, b) => a.z - b.z),
    // Taps: [z, code, lead]. Weave/door taps lead 2.5–4 u (the lane
    // servo needs ~4 u to settle; CDP latency eats ~1 u). Lunge/gate-
    // synced taps keep short leads so they stay in phase.
    taps: [
      [60, 'ArrowRight', 3], [69, 'ArrowLeft', 3], [81, 'ArrowLeft', 3],
      [89.5, 'ArrowRight', 0.5],
      [118, 'ArrowRight', 3], [126, 'ArrowLeft', 3],
      [286, 'ArrowRight', 3], [296, 'ArrowLeft', 3],
      // M9.5 Zone B: upper-deck maze doors (door lane 2 at 599, door
      // lane 1 at 610 — same taps as the unit driver).
      [594, 'ArrowRight', 3], [604, 'ArrowLeft', 3],
      [468, 'ArrowLeft', 3], [476, 'ArrowRight', 3], [498, 'ArrowRight', 3], [520, 'ArrowLeft', 3],
      // The 700 tap is a POST-gate swing (lane 1 through the 700 gate,
      // THEN left for the 708/712 lane-0 line — same as the unit driver,
      // which fires it at exactly 700). Lead 1.0: the swing needs x 0 →
      // 1.85+ by the 708 face (7.5 u later at 2× = 0.27 s ≈ full servo
      // travel). Firing at the first poll ≥699 buys one more poll of
      // travel than lead 0.5 (proven: a 0.27 s render stall pushed a
      // 699.5-lead fire to 702.1 and the swing arrived 0.1 u short of the
      // 708 face); firing any earlier steers INTO the 700 lane-0 block
      // (contact past x 0.75) at 2× speed.
      [700, 'ArrowLeft', 1.0], [714, 'ArrowRight', 4],
      [750, 'ArrowRight', 3], [782, 'ArrowLeft', 3],
      [802, 'ArrowUp', 2], [822, 'ArrowDown', 2], [844, 'ArrowUp', 1.5], [856, 'ArrowDown', 1.5],
      // #2 weave (unit line): HOLD lane 0 past the 975 lane-1 block,
      // double-Right to lane 2 for the 982 door, Left back to lane 1 for
      // the 989 center door. The swing taps are lane-GUARDED (fire only
      // when placed, else skip): every arrival lane then threads
      // correctly — lane 0 runs the full line, lane 1 joins at the second
      // tap, lane 2 holds through 982 and still meets the 984.5 move.
      // The old in-page line recentered to lane 2 straight off the ferry
      // and threaded the 975 block with 0.1 u of margin (proven by the 974
      // hazard-227 face-plant from a +2.6 dismount); holding the unit's
      // lane 0 stages every gate with 0.5 u+ margins. Short leads (the 975
      // swing must not start before the block face, like the 700 tap).
      [975, 'ArrowRight', 1, 0], [977, 'ArrowRight', 1, 1], [984.5, 'ArrowLeft', 2],
      [1018, 'ArrowLeft', 3], [1025, 'ArrowRight', 3], [1048, 'ArrowRight', 0.5], [1056, 'ArrowLeft', 0.5],
      // M9.5 Zone D: foundry-exit maze doors (door lane 2 at 1093, door
      // lane 0 at 1104, recenter for the ship ring by ~1112 — unit line).
      [1082, 'ArrowRight', 2], [1097, 'ArrowLeft', 1.5], [1099, 'ArrowLeft', 1.5], [1108, 'ArrowRight', 2],
      [1172, 'ArrowRight', 2], [1186, 'ArrowLeft', 2], [1274, 'ArrowLeft', 2], [1280, 'ArrowRight', 2],
      [1352, 'ArrowLeft', 3], [1366, 'ArrowRight', 3],
      [1463, 'ArrowUp', 2], [1475, 'ArrowDown', 2],
      [1634.5, 'ArrowLeft', 3], [1645.5, 'ArrowRight', 3], [1646.2, 'ArrowRight', 3],
      [1658, 'ArrowLeft', 3], [1660, 'ArrowLeft', 3], [1684, 'ArrowRight', 3],
      [1698, 'ArrowLeft', 2], [1705, 'ArrowRight', 2],
      [1722, 'ArrowUp', 1.5], [1736, 'ArrowLeft', 1.5],
      [1754, 'ArrowLeft', 0.5], [1772, 'ArrowRight', 3],
    ].map(([z, c, lead, ifLane]) => ({ z, c, lead, ifLane, done: false })),
    // Spider presses: [z] or [z, lead]. Default lead 1.5 (coarse ticks
    // must not slip past narrow snap-validity edges like the 1444..1446
    // dodge-wall ceiling). 1400.1 is REVERSED: the floor target slab only
    // starts at z=1400, so firing early snaps at air (ignored press, then
    // ceiling gravity carries the rider up into the void — proven by the
    // 1407 void death); it fires at/after the slab with a −0.5 lead, and
    // lateness is safe there (slab runs to 1414).
    presses: [1344, 1356, 1364, 1376, 1384, 1396, [1400.1, -0.5], 1414, 1424, 1430, 1435, 1445, 1452, 1472, 1482, 1743, 1749]
      .map((e) => (typeof e === 'number' ? { z: e, lead: 1.5, done: false } : { z: e[0], lead: e[1], done: false })),
    ff: [[359, 364], [1572, 1580], [1613, 1618]],
    jumpedCh: [false, false, false, false, false, false, false, false],
    mazeStage: 0,
    ferryTapWall: 0,
    lastFerry: null,
    flightFollow: null,
    wasRiding: false,
    wasFlying: false,
    orbHold: null,
    recentering: false,
    recenterUntilZ: 0,
    recenterTarget: 1,
    tick: 0,
  });
  let plan = reset();
  let attempts = window.__gd3d.attempts();
  // Unit-faithful edges: every discrete input is a single press edge.
  // REENTRANT per code (up-synchronous + pending-up cancel): back-to-back
  // edges must never overlap — down-while-held is INERT (no new
  // pressedThisStep) and the second press would be silently swallowed. The
  // old down-then-up(120 ms) shape died exactly this way: taps 975/977 sit
  // 1.9 u apart (136 ms at 14 u/s) while headless event-loop slots are
  // ~90 ms, so the first up-timer slipped past the second down and the
  // 977 edge never existed (proven by the 981 hazard-228 clip with intent
  // parked at 1). Now each edge releases synchronously first, cancels any
  // pending release, and holds 80 ms (≈10 ticks — still exactly-once).
  // Timers are PER CODE: a shared timer let an ArrowRight tap cancel
  // Space's pending release, wedging Space DOWN so hold-to-repeat
  // auto-jumped every landing into a spike cascade (proven by the act-1
  // 164 death right after this was introduced).
  // Nothing is held across polls except Ship thrust and fast-fall ranges,
  // so a landing can never auto-repeat into the void. Orbs retry while
  // inside the window, so an overlapped edge never loses the interaction.
  let downHold = null;
  let shipHoldPrev = false;
  const edgeTimers = new Map();
  const edge = (code) => {
    up(code);
    down(code);
    const prev = edgeTimers.get(code);
    if (prev !== undefined) clearTimeout(prev);
    edgeTimers.set(code, setTimeout(() => { up(code); edgeTimers.delete(code); }, 80));
  };
  // Intent-bounded steering: tap at most one lane step TOWARD the lane
  // containing world-x, never past it. Lane intent is quantized (±2.6 u
  // steps) while decks move continuously — unbounded dx-chasing piles up
  // intent across post-stall catch-up polls and slingshots the servo off
  // the deck (proven: intent ran to −1, target +5.2, off deck B into the
  // far-deck face). Holding the lane nearest the deck keeps the footprint
  // overlapped: |deck − laneCenter| ≤ 1.3 < deckHalf(2.5+) − playerHalf.
  // NOTE: takes the lane index as a VALUE — this helper is defined
  // outside the poll closure (no `g` in scope); callers pass g.laneIndex().
  const laneForX = (wx) => (wx > 1.3 ? 0 : wx < -1.3 ? 2 : 1);
  const steerToLane = (li, want) => {
    if (li > want) { edge('ArrowLeft'); return true; }
    if (li < want) { edge('ArrowRight'); return true; }
    return false;
  };
  const shipTarget = (z) => {
    if (z < 1128) return 3.4;
    if (z < 1140) return 4.0;
    if (z < 1146) return 3.5;
    if (z < 1200) return 3.0;
    // Inverted cruise rides lower in-page (5.8 vs unit 6.3): coarse polls
    // overshoot toward the 7.5 ribs, so take the extra margin. The dive to
    // the 3.5 low line starts 3 u early (1229): a 90 ms poll quantum plus
    // a render stall can otherwise deliver the ship 0.3 s late into the
    // rib zone still at cruise altitude (proven by the 1237 solid-116
    // clip at y 5.1); 3 u early still clears the 7.5 ceiling ribs by 2.5 u.
    if (z < 1229) return 5.8;
    if (z < 1243) return 3.5;
    // Revert-gate run-in (gate ring 1.4..4.6): fly it NEARLY LEVEL at 3.2
    // with vy≈0 — the old 4.0 climb arrived hot (gravity-fed to vy≈+10,
    // unbrakeable inside the ring: peaked 6.7, missed over the top and
    // stayed inverted into solid-118). 3.2 centers the ring with ±1.4 u
    // of stall margin on both faces.
    if (z < 1252) return 3.2;
    if (z < 1264) return 2.5;
    if (z < 1286) return 3.5;
    if (z < 1302) return 3.0;
    return 3.0;
  };
  window.__m86driver = setInterval(() => {
    const g = window.__gd3d;
    plan.tick++;
    if (window.__m86trace === undefined) window.__m86trace = [];
    const trace = (msg) => {
      if (window.__m86trace.length < 500) window.__m86trace.push(`z=${g.playerPosition().z.toFixed(1)} ${msg}`);
    };
    if (plan.tick % 40 === 0 && window.__m86trace.length < 500) {
      window.__m86trace.push(`tick#${plan.tick} z=${g.playerPosition().z.toFixed(1)} st=${g.status()}`);
    }
    if (g.attempts() !== attempts) {
      attempts = g.attempts();
      plan = reset();
      if (downHold !== null) { up('ArrowDown'); downHold = null; }
      up('Space');
    }
    if (g.status() !== 'running') {
      if (g.status() === 'finished') window.__m86done = { attempts: g.attempts() };
      else if (g.status() === 'dead') {
        const li = g.lethalInfo ? g.lethalInfo() : { colliderId: 'n/a' };
        const pp = g.playerPosition();
        window.__m86done = { dead: `${g.deathCause()}@${pp.z.toFixed(1)},y${pp.y.toFixed(1)},${li.colliderId}`, attempts: g.attempts() };
      }
      return;
    }
    window.__m86done = null;
    const z = g.playerPosition().z;
    const y = g.playerPosition().y;
    const x = g.playerPosition().x;
    // Weave-zone trace (maze exit → 2× weave, 685..715): arrival-x
    // forensics for the 700/708 gate clips (capped with the rest).
    if (z > 685 && z < 715 && window.__m86trace.length < 2000 && plan.tick % 3 === 0) {
      window.__m86trace.push(`weave z=${z.toFixed(1)} x=${x.toFixed(1)} lane=${g.laneIndex()} sup=${g.supportId()} spd=${g.speedMultiplier()}`);
    }
    // Ship-zone trace (abyss 1100..1310): PD altitude forensics
    // (capped with the rest).
    if (z > 1100 && z < 1310 && window.__m86trace.length < 2000 && plan.tick % 3 === 0) {
      window.__m86trace.push(`ship z=${z.toFixed(1)} y=${y.toFixed(1)} vy=${g.playerVelocity().y.toFixed(1)} g=${g.gravityMode()} hold=${shipHoldPrev}`);
    }
    // Spider-zone trace (temple 1330..1490): snap/landing forensics
    // (capped with the rest).
    if (z > 1330 && z < 1490 && window.__m86trace.length < 2000 && plan.tick % 3 === 0) {
      window.__m86trace.push(`spider z=${z.toFixed(1)} y=${y.toFixed(1)} x=${x.toFixed(1)} g=${g.gravityMode()} sup=${g.supportId()}`);
    }
    // Foundry-weave trace (#2 lunge gates 960..990): transit forensics —
    // x + lane intent + recenter arming every poll (capped with the rest).
    // (Investigating the 981 hazard-228 clip: intent reverted 2→1 with no
    // visible tap source.)
    if (z > 960 && z < 990 && window.__m86trace.length < 2000) {
      window.__m86trace.push(`foundry z=${z.toFixed(1)} x=${x.toFixed(1)} lane=${g.laneIndex()} rc=${plan.recentering} sup=${g.supportId()}`);
    }
    // Ferry-zone trace (chomp ferry 925..970): board/ride/dodge/exit
    // forensics (capped with the rest).
    if (z > 925 && z < 970 && window.__m86trace.length < 480 && plan.tick % 3 === 0) {
      const st = (g.platforms() ?? []).find((p) => p.id === 'ps-ferry-chomp');
      window.__m86trace.push(`ferry z=${z.toFixed(1)} x=${x.toFixed(1)} y=${y.toFixed(1)} sup=${g.supportId()} deck=${st !== undefined ? st.x.toFixed(1) : '?'}`);
    }
    const now = performance.now();
    const flying = g.playerMode() === 'ship';
    // Stale-skip: a tap more than 12 u overdue never fires late into a
    // hazard (death re-arms the whole plan anyway).
    for (const t of plan.taps) if (!t.done && z > t.z + 12) t.done = true;
    if (!flying && plan.wasFlying) { up('Space'); plan.wasFlying = false; }
    if (flying) {
      plan.wasFlying = true;
      const vy = g.playerVelocity().y;
      const inverted = g.gravityMode() === 'ceiling';
      const target = shipTarget(z);
      // Velocity-damped (PD) thrust: the ship plant answers in ~0.25 s
      // (62 thrust vs 30 gravity, terminals 12/14) while loaded in-page
      // polls land every ~0.05–0.2 s — pure hysteresis bang-bang then
      // limit-cycles ±4 u into the lethal faces (proven both ways: 7.3
      // ceiling hit, −1.4 floor exit). Switching on the PREDICTED offset
      // s = (y − target) + K·vy starts the brake ~K·vy early, so even a
      // 0.2 s-late switch lands within ~1 u; hysteresis on s (not y)
      // keeps it from chattering. Hard rails backstop the lethal faces.
      // Normal thrust is UP (hold below target), inverted DOWN (hold
      // above target). vy is world-+Y-up in both modes.
      let wantHold = shipHoldPrev;
      const K = 0.22;
      const B = 0.25;
      const s = (y - target) + K * vy;
      if (inverted) {
        if (y > 6.8) wantHold = true;
        else if (y < 4.0) wantHold = false;
        else if (s > B) wantHold = true;
        else if (s < -B) wantHold = false;
      } else {
        if (y < 1.7) wantHold = true;
        else if (y > 4.3) wantHold = false;
        else if (s < -B) wantHold = true;
        else if (s > B) wantHold = false;
      }
      shipHoldPrev = wantHold;
      if (wantHold) down('Space');
      else up('Space');
      const tap = plan.taps.find((t) => !t.done);
      if (tap !== undefined && z >= tap.z - tap.lead && z < tap.z + 30) {
        tap.done = true;
        edge(tap.c);
      }
      return;
    }
    // Ferry-follow counter-steer while riding a lateral ferry.
    const support = g.supportId();
    const riding = support !== null && support.indexOf('platform-ps-ferry-') === 0 && g.playerMode() === 'cube';
    const plats = g.platforms() ?? [];
    if (riding) {
      plan.lastFerry = support;
      const st = plats.find((p) => `platform-${p.id}` === support);
      // Intent-bounded deck tracking (80 ms): hold the lane nearest the
      // deck center — always footprint-overlapped (see steerToLane), no
      // runaway across post-stall catch-up polls. The 16 u/s servo
      // outruns the 5.3 u/s deck peak, so tracking never lags out. The
      // throttle (not a laneIndex re-read — edges apply next tick) spaces
      // taps; equality inside steerToLane stops them at the deck's lane.
      if (st !== undefined && now - plan.ferryTapWall > 80) {
        if (steerToLane(g.laneIndex(), laneForX(st.x))) {
          plan.ferryTapWall = now;
          return;
        }
      }
    }
    // Flight-follow (latched unit air-follow): while airborne after
    // leaving a lateral ferry, hold the lane of the target deck so the
    // landing is solid, not a corner graze — recentering mid-flight would
    // dump the rider off the edge. SINGLE tap per flight AND intent-
    // bounded (never past the deck's lane): repeated/overshooting intent
    // steps slingshot the servo off the landing (proven both ways: the
    // 683 void miss on oscillation phase, the 687 far-deck face-plant on
    // intent −1). One bounded step tracks the constant-velocity deck
    // with no whipsaw.
    // Maze-transfer exception: stage-2 flights target deck B, so follow B
    // (not the last-ridden A) — deck B drifts ~2 u during the flight and
    // the unit driver's exact fire phase can't be reproduced on wall-time
    // polls without this correction.
    if (!riding && plan.flightFollow !== null && plan.flightFollow !== undefined &&
        plan.flightFollow.taps < 1 &&
        g.playerMode() === 'cube' && g.gravityMode() === 'floor' &&
        z <= plan.flightFollow.untilZ && now - plan.ferryTapWall > 125) {
      const box = FERRY_BOXES[plan.flightFollow.target];
      if (box !== undefined && z >= box.z0 && z <= box.z1) {
        const st = plats.find((p) => `platform-${p.id}` === plan.flightFollow.target);
        if (st !== undefined) {
          const dx = st.x - x;
          if (Math.abs(dx) > 1.0) {
            if (steerToLane(g.laneIndex(), laneForX(st.x))) {
              plan.ferryTapWall = now;
              plan.flightFollow.taps++;
              return;
            }
          }
        }
      }
    }
    if (!riding && plan.wasRiding) {
      plan.recentering = true;
      plan.recenterUntilZ = z + 45;
      // Chomp-ferry dismount holds lane 0 (unit line — stages the #2
      // weave gates with margin; see the taps list). Everywhere else
      // recenters lane 1 (z ≤ 900) or lane 0 (foundry traverse).
      plan.recenterTarget = z > 900 ? 0 : 1;
      // Latch the flight-follow target at the dismount edge (cleared on
      // the next ride or past the landing zone).
      let ft = plan.lastFerry;
      if (plan.mazeStage === 2) ft = 'platform-ps-ferry-maze-b';
      plan.flightFollow = (ft !== null && ft !== undefined) ? { target: ft, untilZ: z + 14, taps: 0 } : null;
    }
    if (riding) plan.flightFollow = null;
    plan.wasRiding = riding;
    if (support !== null && support.indexOf('platform-') === 0) window.__m86rode = true;
    if (plan.recentering && g.playerMode() === 'cube' && g.gravityMode() === 'floor') {
      if (g.laneIndex() === plan.recenterTarget || z > plan.recenterUntilZ) plan.recentering = false;
      // Grounded-gated in-page (the unit driver recenters mid-flight too,
      // but its 8.3 ms polls make that benign; coarse in-page taps would
      // steer landings off narrow decks — air-follow owns flights).
      else if (g.grounded() && now - plan.ferryTapWall > 150) {
        plan.ferryTapWall = now;
        edge(g.laneIndex() < plan.recenterTarget ? 'ArrowRight' : 'ArrowLeft');
        return;
      }
    }
    // Weave-entry centering (maze exit → 2× weave): after the solid-62
    // landing, kill lateral scatter — converge intent to 1 AND x to 0
    // before the 700 gate so the post-gate swing always starts from lane
    // 1. Unit arrival here is tick-deterministic; in-page maze-exit state
    // scatters (deck-B phase + coarse follow/recenter clocks) and the
    // lane-0 block at 700 clips anything right of 0.75. Intent-aware
    // (NOT pure positional): a blind positional tap overshoots intent
    // past 1 on servo lag and the swing then clips the 708 gate instead
    // (proven by the 707 hazard-213 death). Tap only when intent and
    // position agree; the analytic servo then converges monotonically.
    if (g.playerMode() === 'cube' && g.gravityMode() === 'floor' &&
        z > 690 && z < 699 && !riding && g.grounded() && now - plan.ferryTapWall > 100) {
      const li = g.laneIndex();
      if (li > 1 && x < -0.5) { plan.ferryTapWall = now; edge('ArrowLeft'); return; }
      if (li < 1 && x > 0.5) { plan.ferryTapWall = now; edge('ArrowRight'); return; }
    }
    // Maze ferry pair (pose-read boarding/transfer/exit).
    if (g.playerMode() === 'cube' && g.gravityMode() === 'floor' && z > 650 && z < 695) {
      const tick = g.platformTick();
      const plats = g.platforms() ?? [];
      const stA = plats.find((p) => p.id === 'ps-ferry-maze-a');
      const stB = plats.find((p) => p.id === 'ps-ferry-maze-b');
      if (stA !== undefined && stB !== undefined) {
        // Adopt: already riding A (fell on) — skip boarding.
        if (plan.mazeStage === 0 && support === 'platform-ps-ferry-maze-a') plan.mazeStage = 1;
        if (window.__m86trace.length < 2000 && z > 648 && z < 700) {
          window.__m86trace.push(`z=${z.toFixed(1)} st=${plan.mazeStage} sup=${support} Ax=${stA.x.toFixed(1)} Bx=${stB.x.toFixed(1)} ptick=${g.platformTick()}`);
        }
        if (plan.mazeStage === 0 && z > 656.2 && z < 660 && support !== 'platform-ps-ferry-maze-a') {
          // Fire only when the landing is BOTH phase- and laterally-sound:
          // predicted deck-A center within ±2.0 (deck half-width 2.5, so
          // a centered player lands with margin) AND the player already
          // within 1.2 of that center (the pre-board alignment below
          // converges from z≈638, so this gate only holds fire on a bad
          // approach instead of jumping into the void beside the deck —
          // proven by the 683 void death: the board jump fired with the
          // player right of a left-swept deck and never touched A).
          const predA = poseX(MAZE_A.base, MAZE_A.amp, MAZE_A.period, MAZE_A.phase, tick + 75);
          // Landing footprint needs |x − Ax| ≤ ~1.9 (deck half 2.5 minus
          // the 0.55 player half); gate at 1.5 keeps 0.4 of margin.
          if (Math.abs(predA) < 2.0 && Math.abs(x - predA) < 1.5) {
            plan.mazeStage = 1;
            edge('Space');
            return;
          }
        } else if (plan.mazeStage === 0 && z > 645 && z < 656.2 && g.grounded() &&
            support !== 'platform-ps-ferry-maze-a' && now - plan.ferryTapWall > 250) {
          // Pre-board alignment: walk x onto deck A's predicted landing
          // center while running the solid-61 approach after the 640 hop.
          // Slow 250 ms taps (one servo correction completes per tap, so
          // intent never piles up into dither); same pose clock the board
          // jump uses. 6 u of running ≈ 7 u of servo travel — enough for
          // the observed ±2 scatter.
          const predA = poseX(MAZE_A.base, MAZE_A.amp, MAZE_A.period, MAZE_A.phase, tick + 75);
          if (predA - x > 0.6) { plan.ferryTapWall = now; edge('ArrowLeft'); return; }
          if (x - predA > 0.6) { plan.ferryTapWall = now; edge('ArrowRight'); return; }
        } else if (plan.mazeStage === 1 && support === 'platform-ps-ferry-maze-a') {
          // Aligned transfer: fire ONLY where the landing is physical —
          // the jump carries 8.8 u and deck B spans z 677..683, so firing
          // before 667.5 lands in the 671..677 gap (a graze needs ≥676.5).
          // Keep the unit 2.2 alignment window; landing accuracy comes
          // from the single follow tap. Boarding early (first poll of the
          // board window) maximizes the ride so several polls sample this
          // gate even around a render stall.
          if (Math.abs(stA.x - stB.x) < 2.2 && z > 667.5) {
            plan.mazeStage = 2;
            edge('Space');
            return;
          }
          // Forced exit jump (last chance): deck A ends at z=671 — riding
          // past it is certain death in the void, while jumping toward B
          // (with the single follow tap guiding) still lands whenever the
          // decks are within ~3. A 0.4 s SwiftShader stall can straddle
          // the whole 37-tick alignment window between two polls (proven
          // by the 683 void death: the window opened and closed with zero
          // polls inside it); this backstop converts that stall lottery
          // from certain death into a live landing attempt.
          if (z >= 669.5) {
            plan.mazeStage = 2;
            edge('Space');
            return;
          }
        } else if (plan.mazeStage === 2 && support === 'platform-ps-ferry-maze-b' && z > 679) {
          plan.mazeStage = 3;
          edge('Space');
          return;
        }
      }
    }
    // Reactive Chomper jumps (ferry/weave/ceil + the M9.5 deck/lower/
    // shaft — low/final are lane dodges). Runtime chomper order is
    // triggerZ-sorted (M9.5: deck=0, lower=1, shaft=2, ferry=3, weave=4,
    // ceil=5; low/final skipped), NOT definition order.
    const ch = g.chompers();
    const chTrig = [283, 601, 871, 940, 985, 1005, -1, -1];
    for (let i = 0; i < 8; i++) {
      if (chTrig[i] < 0) continue;
      const s = ch[i];
      if (s !== undefined && (s.phase === 'telegraph' || s.phase === 'lunging') && !plan.jumpedCh[i] && z >= chTrig[i] + 2.5) {
        plan.jumpedCh[i] = true;
        edge('Space');
        return;
      }
    }
    // Required orbs: single edges inside the window, retried while inside.
    // Retries start early (coarse ~8 Hz polls can skip a 3 u window
    // entirely): early edges are harmless no-ops, the first edge inside
    // the swept window fires the orb. The ceiling-return orb starts at
    // 912: an earlier edge slams down ONTO the 916 spike instead of past
    // it (the edge doubles as the ceiling-jump takeoff).
    const orbWindows = [
      ['ps-orb-sky', 331.0, 335.0], ['ps-gorb-spire', 902.5, 906.5],
      ['ps-gorb-spire-back', 912.0, 915.0],
      ['ps-orb-terminal-a', 1544.0, 1548.0], ['ps-orb-terminal-b', 1560.0, 1564.0],
    ];
    for (const [id, z0, z1] of orbWindows) {
      if (!g.isInteractionUsed(id) && z >= z0 && z <= z1) {
        // Fresh edge EVERY poll (up-then-down in the same task latches
        // pressed+released for the next tick): a held retry produces no
        // new edge (down while held is inert) and a cleared graze-edge
        // never refires — but the orb needs edge AND swept-overlap in the
        // SAME tick, so each poll must mint a new edge. Safe: orb zones
        // never overlap Ship thrust or spider holds (different keys/modes).
        // The hold is released below once the orb fires or the window
        // passes — otherwise hold-to-repeat bunny-hops the whole level.
        up('Space');
        down('Space');
        plan.orbHold = { id, z1 };
        if (window.__m86trace.length < 500) window.__m86trace.push(`ORBEDGE ${id} z=${z.toFixed(1)} y=${y.toFixed(2)}`);
        return;
      }
    }
    if (plan.orbHold !== null && plan.orbHold !== undefined) {
      const o = plan.orbHold;
      if (g.isInteractionUsed(o.id) || z > o.z1 + 0.5) {
        up('Space');
        plan.orbHold = null;
      }
    }
    const press = plan.presses.find((p) => !p.done);
    // Spider snaps (per-press leads; default 1.5 u so coarse ticks don't
    // slip past narrow snap-validity edges like the 1444..1446 dodge-wall
    // ceiling; snap slabs are 14 u+ so early snaps stay supported —
    // except 1400.1, whose target starts at its z: see the presses list).
    if (press !== undefined && z >= press.z - press.lead && g.playerMode() === 'spider') {
      press.done = true;
      edge('Space');
      return;
    }
    // Void-ferry boarding (funnel into the generic 376 entry): the deck
    // sweeps ±4 u at up to 5.3 u/s, so a blind z-triggered board jump
    // lands BESIDE the deck whenever the phase is extreme (proven by the
    // 407 void death: exit 401 starved because the player never boarded).
    // Same treatment as the maze-A board: chase the deck's predicted
    // landing center down the full-width approach, then fire only when
    // aligned (or blind at the last poll before the runway lip at 378).
    // Sits before the generic jump block and owns the 376 entry outright.
    if (g.playerMode() === 'cube' && g.gravityMode() === 'floor' && !riding) {
      // Owns the entry only once every earlier jump is done (notably the
      // 364 rhythm hop just before — open runway, no hazards, but its
      // known-good timing stays untouched).
      const first = plan.jumps.find((j) => !j.done);
      const board = first !== undefined && first.z === 376 ? first : undefined;
      if (board !== undefined) {
        if (z >= 362 && z < 374 && g.grounded() && now - plan.ferryTapWall > 250) {
          const pred = poseX(VOID_FERRY.base, VOID_FERRY.amp, VOID_FERRY.period, VOID_FERRY.phase, g.platformTick() + 75);
          if (pred - x > 0.6) { plan.ferryTapWall = now; edge('ArrowLeft'); return; }
          if (x - pred > 0.6) { plan.ferryTapWall = now; edge('ArrowRight'); return; }
        }
        if (z >= 374 && z < 377 && g.grounded()) {
          const pred = poseX(VOID_FERRY.base, VOID_FERRY.amp, VOID_FERRY.period, VOID_FERRY.phase, g.platformTick() + 75);
          if (Math.abs(x - pred) < 1.5) {
            board.done = true;
            trace('JUMP fire target=376 (aligned board)');
            edge('Space');
            return;
          }
          return; // hold the entry (generic block must not blind-fire it)
        }
        if (z >= 377 && z < 378.5 && g.grounded()) {
          board.done = true; // last chance before the lip — blind but live
          trace('JUMP fire target=376 (last-chance board)');
          edge('Space');
          return;
        }
        if (z >= 374 && z < 378.5) return; // airborne in the window — wait
      }
    }
    const jump = plan.jumps.find((j) => !j.done);
    if (jump !== undefined && z >= jump.z - jump.lead) {
      // Grounded-gated takeoff (coarse ~8 Hz ticks): a press while
      // airborne is wasted with no buffer, so pending entries wait for
      // landing; entries more than 2.5 u overdue skip (firing late into
      // a hazard kills anyway — death re-arms the plan). Orb-paired
      // entries are serviced by the retry path above.
      if ((jump.z === 333 || jump.z === 1546.5 || jump.z === 1562.5)) { jump.done = true; return; }
      if (z > jump.z + jump.stale) { jump.done = true; trace(`JUMP stale-skip target=${jump.z}`); return; }
      if (!g.grounded()) return;
      jump.done = true;
      trace(`JUMP fire target=${jump.z}`);
      edge('Space');
      return;
    }
    const tapItem = plan.taps.find((t) => !t.done);
    if (tapItem !== undefined && z >= tapItem.z - tapItem.lead) {
      // Wall taps only valid on wall gravity (a physical Up edge elsewhere
      // is a jump) — wait for the gravity the tap belongs to.
      const wallTap = tapItem.c === 'ArrowUp' || tapItem.c === 'ArrowDown';
      const onWall = g.gravityMode() === 'leftWall' || g.gravityMode() === 'rightWall';
      if (wallTap && !onWall) return;
      if (!wallTap && onWall) return;
      // Lane-guarded taps (the 989 door move): skip when already placed.
      if (tapItem.ifLane !== undefined && tapItem.ifLane !== null && g.laneIndex() !== tapItem.ifLane) {
        tapItem.done = true;
        return;
      }
      tapItem.done = true;
      // An explicit route tap takes authoritative ownership of lane intent:
      // cancel any ferry-dismount recentering, which would otherwise fight
      // the swing back toward its own target (proven: recenter-to-1 Right
      // taps undid the 700-Left swing poll-by-poll and fed the 708 block).
      plan.recentering = false;
      trace(`TAP ${tapItem.c} target=${tapItem.z}`);
      edge(tapItem.c);
      return;
    }
    // Fast-fall ranges (held while inside the window).
    for (const [z0, z1] of plan.ff) {
      if (z >= z0 && z <= z1 && g.playerMode() === 'cube') {
        if (downHold === null) { down('ArrowDown'); downHold = true; }
        return;
      }
    }
    if (downHold !== null) { up('ArrowDown'); downHold = null; }
  }, 10);
});
// Shader pre-warm flythrough BEFORE the counted attempt: first-visit
// shader/program compiles stall the main thread for ~1 s, skipping whole
// input windows (a 17 u stall skipped the 913.5 gravity orb). Teleport
// down the route so every act's materials compile, then R-reset and count
// from there — warmup deaths never touch the baseline (each teleport and
// death re-arms the plan via the attempts guard... teleports don't change
// attempts, the final R does).
for (const [wx, wy, wz] of [
  [0, 0.55, 135], [0, 5.05, 245], [0, 0.55, 470],
  [0, 5.05, 575], [0, 9.45, 760], [0, 0.55, 945], [0, 3, 1160],
  [0, 3, 1210], [0, 0.55, 1350], [0, 8.55, 1440], [0, 0.55, 1512],
  [0, 0.55, 1680], [0, 0.55, 1782],
]) {
  await page.evaluate((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x: wx, y: wy, z: wz });
  await page.waitForTimeout(900);
}
// Position-compile grid (~100 u): first-render shader/program compiles
// stall the main thread mid-run and skip whole input windows (a 9 u stall
// at 532-541 cascaded into a hole death). Walk the route so every act's
// materials are resident; warmup deaths/falls are fine (auto-respawn).
for (const [wx, wy, wz] of [
  [0, 0.55, 530], [0, 5.05, 555], [0, 5.05, 600], [0, 0.55, 660],
  [0, 1.5, 800], [0, 0.55, 860], [0, 0.55, 960], [0, 9.45, 1020],
  [0, 0.55, 1060], [0, 3, 1180], [0, 3, 1240], [0, 0.55, 1310],
  [0, 4.5 + 0.55, 1400], [0, 8.55, 1480], [0, 8.55, 1560], [0, 0.55, 1620],
  [0, 8.55, 1700], [0, 0.55, 1745],
]) {
  await page.evaluate((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x: wx, y: wy, z: wz });
  await page.waitForTimeout(700);
}
// First-event dwell stops: pads/orbs/portals/chomper/ship/invert/spider/
// teleport/speed/death-burst VFX and punch envelopes compile on first use
// mid-run (a ~1 s stall there skips whole input windows). Teleport just
// before each gate and let the installed driver play through it.
for (const [wx, wy, wz, ms] of [
  [0, 0.55, 265, 2500], [0, 8.55, 325, 2500], [0, 0.55, 350, 1500],
  [0, 0.55, 370, 2000], [0, 5.05, 300, 2000], [0, 0.55, 525, 2500],
  [0, 0.55, 690, 2000],
  [0, 0.55, 740, 2500], [0, 0.55, 903, 3000],
  // Chomper lunges must actually CROSS in warmup (a stop before the lip
  // dies on the deck side before the trigger — teleport onto the route
  // past it so telegraph + lunge + dodge all compile).
  [0, 0.55, 945, 3000], [0, 0.55, 986, 2500], [0, 9.45, 1006, 2500],
  [0, 0.55, 1040, 2500],
  // Ship-approach play-through: cross ship-on and FLY with the driver
  // (ship mesh/trail + invert/revert pulses compile on first use — a ~1 s
  // stall there blinds the PD through the flip and is unrecoverable).
  // Deaths mid-warmup are fine (auto-respawn; final R resets everything).
  [0, 0.55, 1105, 12000],
  [0, 0.55, 1330, 2500], [0, 0.55, 1505, 2500], [0, 0.55, 1595, 2000],
  [0, 0.55, 1655, 2000], [0, 0.55, 1735, 2500], [0, 0.55, 378.5, 2000],
]) {
  await page.evaluate((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x: wx, y: wy, z: wz });
  await page.waitForTimeout(ms);
}
await page.keyboard.press('KeyR');
await page.waitForTimeout(900);
const baseAttempts = await page.evaluate(() => window.__gd3d.attempts());
{
  const dbg = await page.evaluate(() => ({
    drv: typeof window.__m86driver,
    traceLen: (window.__m86trace ?? []).length,
    z: window.__gd3d.playerPosition().z,
    status: window.__gd3d.status(),
  }));
  console.log(`DBG driver-install ${JSON.stringify(dbg)}`);
}
const shots = { ship: false, inverted: false, spiderWall: false, core: false, rode: false };
const run = await (async () => {
  const t0 = Date.now();
  let lastZ = -1e9;
  let lastMoveT = Date.now();
  for (;;) {
    const s = await page.evaluate(() => ({
      done: window.__m86done,
      status: window.__gd3d.status(),
      paused: window.__gd3d.paused(),
      z: window.__gd3d.playerPosition().z,
      mode: window.__gd3d.playerMode(),
      grav: window.__gd3d.gravityMode(),
      rode: window.__m86rode === true,
    }));
    const snap = async (flag, name) => {
      if (shots[flag]) return;
      shots[flag] = true;
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(400);
      await capture(name);
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(200);
    };
    if (s.mode === 'ship' && s.z > 1150) await snap('ship', 'm86-17-ship-live');
    if (s.mode === 'ship' && s.grav === 'ceiling') await snap('inverted', 'm86-18-inverted-live');
    if (s.mode === 'spider' && (s.grav === 'leftWall' || s.grav === 'rightWall')) await snap('spiderWall', 'm86-19-spider-wall-live');
    if (s.z > 1700) await snap('core', 'm86-20-core-live');
    if (s.rode) shots.rode = true;
    if (s.done !== null) return s.done;
    // Watchdog: the sim must keep advancing (a lost pause-toggle would
    // freeze it with status running and done null forever).
    if (Math.abs(s.z - lastZ) > 0.5) { lastZ = s.z; lastMoveT = Date.now(); }
    else if (Date.now() - lastMoveT > 45000) {
      await page.keyboard.press('KeyP');
      await page.waitForTimeout(2000);
      const s2 = await page.evaluate(() => ({
        z: window.__gd3d.playerPosition().z,
        paused: window.__gd3d.paused(),
        status: window.__gd3d.status(),
      }));
      const trace = await page.evaluate(() => (window.__m86trace ?? []).slice(-25).join(' | '));
      console.log(`WATCHDOG z=${s.z.toFixed(1)} paused=${s.paused} afterP paused=${s2.paused} z2=${s2.z.toFixed(1)} status=${s2.status}`);
      console.log(`TRACE-tail — ${trace}`);
      if (Math.abs(s2.z - lastZ) < 0.5) return `stuck@${s.z.toFixed(1)}`;
      lastZ = s2.z;
      lastMoveT = Date.now();
    }
    if (Date.now() - t0 > 1200000) {
      await page.evaluate(() => {
        if (window.__m86driver) clearInterval(window.__m86driver);
        window.__m86driver = null;
      });
      return 'timeout';
    }
    // Poll every 250 ms (not 1 s): the 78-tick death hold lasts 0.65 s,
    // so 1 s polls can slip a whole death+respawn cycle — the loop then
    // keeps driving a fresh attempt and the reported death belongs to a
    // LATER attempt than the deepest progress (proven: a 707 death slipped
    // while its retry died at 683). 250 ms always samples the hold.
    await page.waitForTimeout(250);
  }
})();
log('m86 full real-input reference run finishes with 0 deaths',
  run !== 'timeout' && run?.attempts === baseAttempts && !run?.dead,
  typeof run === 'string' ? run : `attempts=${run?.attempts} (base ${baseAttempts}) dead=${run?.dead ?? 'no'}`);
{
  // Post-mortem: maze-verbose + ferry-zone lines pin down transfer/ferry
  // failures without re-running the 10-minute gate.
  const mazeLines = await page.evaluate(() => (window.__m86trace ?? []).filter((l) => l.includes(' st=') || l.startsWith('ferry ') || l.startsWith('weave ') || l.startsWith('spider ') || l.startsWith('foundry ') || l.startsWith('ship ')).join(' | '));
  fs.writeFileSync(path.join(OUT_DIR, 'm86-trace.json'), JSON.stringify({ run, mazeLines }, null, 2));
  console.log(`MAZE — ${mazeLines.slice(-3000)}`);
}
{
  const trace = await page.evaluate(() => (window.__m86trace ?? []).slice(-45).join(' | '));
  console.log(`TRACE-tail — ${trace}`);
}
{
  const f = await probe();
  log('m86 reference run covers ship/spider + rode a ferry',
    f.status === 'finished' && shots.ship && shots.inverted && shots.spiderWall && shots.rode,
    `status=${f.status} ship=${shots.ship} inv=${shots.inverted} wall=${shots.spiderWall} rode=${shots.rode}`);
}
await capture('m86-21-finish-live');
await page.keyboard.press('F4');
let verify = { kind: 'running' };
for (let i = 0; i < 100 && verify.kind === 'running'; i++) {
  await page.waitForTimeout(5000);
  verify = await page.evaluate(() => window.__gd3d.replayVerification());
}
log('m86 showcase replay VERIFIED in-page', verify.kind === 'pass', `verify=${verify.kind}`);

// --- F. Resource boundedness + console audit ---
{
  const before = await probe();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(1500);
  }
  const after = await probe();
  const flat = after.children === before.children && after.mats === before.mats && after.geos === before.geos;
  log('m86 resources flat across restarts', flat,
    `children=${before.children}->${after.children} mats=${before.mats}->${after.mats} geos=${before.geos}->${after.geos} stats=${JSON.stringify(after.stats)}`);
}
log('m86 no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
log('m86 no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
