/**
 * M6D real-GPU performance gate (dev tool, not shipped).
 *
 * Measures the CURRENT production workload (advanced-cube-01 primary) with
 * the DEBUG profiler (`?perf=1`, bounded ring buffer, off by default):
 * frame delivery (FPS / p50 / p95 / p99 / over-budget counts), renderer
 * cost (calls / tris), resource boundedness (scene children / materials /
 * geometries / passes), VFX pool peaks, JS heap trend, and death/restart
 * leak stress.
 *
 * CRITICAL: headless Chromium / SwiftShader verdicts are FUNCTIONAL evidence
 * only (leaks, determinism, regression). The final M6D GPU verdict MUST come
 * from a hardware-accelerated browser — this script prints the actual
 * UNMASKED WebGL vendor/renderer and labels software rasterizers as such.
 *
 * Modes (gate rules live in ./perfGateLib.mjs — single owner, unit-tested):
 *   node scripts/perf-gate.mjs
 *     headless software-compatible mode (historical `chromium.launch()`
 *     defaults, byte-identical). Evidence defaults to
 *     qa/perf/m6d-swiftshader.json.
 *   node scripts/perf-gate.mjs --real-gpu [--channel chrome|msedge]
 *     HEADED hardware human-gate mode: installed branded browser via the
 *     OS normal graphics stack (never SwiftShader flags). Evidence
 *     defaults to qa/perf/m6d-real-gpu.json. If the requested channel is
 *     unavailable the script FAILS LOUDLY — it never silently falls back
 *     to bundled headless Chromium and calls that hardware.
 *
 * Human gate workflow:
 *   1. Terminal 1: npm run dev            (local server on :5173)
 *   2. Terminal 2: node scripts/perf-gate.mjs --real-gpu --channel chrome
 *   3. inspect qa/perf/m6d-real-gpu.json (+ verdict line).
 * Leave the headed window VISIBLE/FOCUSED (do NOT minimize), avoid
 * GPU-heavy apps, let the script finish.
 *
 * Usage: node scripts/perf-gate.mjs [--real-gpu] [--channel <name>]
 *        [--url <base>] [--out <json>]
 * Requires the dev server (see QA_URL env for browser-qa parity).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import nodeChildProcess from 'node:child_process';
import {
  buildLaunchOptions,
  classifyGpuRenderer,
  defaultOutPath,
  evaluateRealGpuGate,
  parsePerfGateArgs,
  windowsGateInstructions,
} from './perfGateLib.mjs';

const OPTS = parsePerfGateArgs(process.argv.slice(2));
const BASE = OPTS.url ?? (process.env.QA_URL ?? 'http://localhost:5173/');
const OUT = OPTS.out !== null
  ? path.resolve(OPTS.out)
  : path.resolve(defaultOutPath(OPTS.realGpu));

const WARMUP_MS = 6000;
const SAMPLE_MS = 8000;
const STRESS_DEATHS = 10;
const STRESS_RESTARTS = 10;

// Pool capacities (authoritative: PRODUCTION_THEME.fx + DeathBurstView).
const POOL_CAPACITY = { trail: 96, burst: 384, streak: 24, death: 24 };

const gitSha = (() => {
  try {
    return nodeChildProcess.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

// M6D.1: real-gpu mode launches the installed branded browser headed on
// the OS graphics stack. A missing channel is a LOUD failure (exit 1) —
// never a silent fallback to bundled headless Chromium.
let browser;
try {
  browser = await chromium.launch(buildLaunchOptions(OPTS));
} catch (err) {
  if (OPTS.realGpu) {
    console.error(
      `REAL-GPU LAUNCH FAILED: browser channel "${OPTS.channel}" unavailable.\n`
      + `Install Google Chrome (or pass --channel msedge), then re-run.\n`
      + `Refusing to fall back to bundled headless Chromium as hardware.\n`
      + `Playwright: ${String(err).split('\n')[0]}`,
    );
    process.exit(1);
  }
  throw err;
}
const consoleErrors = [];
const pageErrors = [];
// The gate requires DPR 1: pin it explicitly (headed Windows displays may
// be OS-scaled) and record the read-back values in the evidence JSON.
const PAGE_OPTS = (viewport) => ({ viewport, deviceScaleFactor: 1 });

/** One measured configuration: load, warm up, sample, report. */
const measure = async (name, url, viewport, stress) => {
  const page = await browser.newPage(PAGE_OPTS(viewport));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${name}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => pageErrors.push(`[${name}] ${String(err)}`));
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  } catch {
    await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
  }
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  // Warmup: shaders/resources settle — NOT part of the steady-state sample.
  await page.waitForTimeout(WARMUP_MS);
  const before = await page.evaluate(() => ({
    stats: window.__gd3d.rendererStats(),
    children: window.__gd3d.sceneChildren(),
    materials: window.__gd3d.materialCount(),
    geometries: window.__gd3d.geometryCount(),
    passes: window.__gd3d.postPassCount(),
    heap: (performance.memory !== undefined)
      ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize }
      : null,
  }));
  await page.evaluate(() => window.__gd3d.perfBeginSampling());
  // Live VFX peak watch during the window (poll; cheap, cold path).
  const peaks = { particles: 0, trail: 0, streaks: 0 };
  const t0 = Date.now();
  while (Date.now() - t0 < SAMPLE_MS) {
    await page.waitForTimeout(500);
    const live = await page.evaluate(() => ({
      p: window.__gd3d.activeParticles(),
      t: window.__gd3d.trailSamples(),
      s: window.__gd3d.activeStreaks(),
    }));
    peaks.particles = Math.max(peaks.particles, live.p);
    peaks.trail = Math.max(peaks.trail, live.t);
    peaks.streaks = Math.max(peaks.streaks, live.s);
  }
  const perf = await page.evaluate(() => window.__gd3d.perfSnapshot());
  const gpu = await page.evaluate(() => window.__gd3d.gpuIdentity());
  const ua = await page.evaluate(() => navigator.userAgent);

  let leak = null;
  if (stress) {
    // Death stress: park the cube inside the opening spike, then let the
    // deterministic sim die + respawn; restart stress: verified R-loops.
    const res0 = await page.evaluate(() => ({
      children: window.__gd3d.sceneChildren(),
      materials: window.__gd3d.materialCount(),
      geometries: window.__gd3d.geometryCount(),
      heap: (performance.memory !== undefined) ? performance.memory.usedJSHeapSize : null,
    }));
    for (let i = 0; i < STRESS_DEATHS; i++) {
      await page.evaluate(() => window.__gd3d.debugTeleport(0, 0.55, 21.4));
      await page.waitForTimeout(700);
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(400);
    }
    for (let i = 0; i < STRESS_RESTARTS; i++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1500); // idle/GC opportunity
    const res1 = await page.evaluate(() => ({
      children: window.__gd3d.sceneChildren(),
      materials: window.__gd3d.materialCount(),
      geometries: window.__gd3d.geometryCount(),
      passes: window.__gd3d.postPassCount(),
      heap: (performance.memory !== undefined) ? performance.memory.usedJSHeapSize : null,
    }));
    leak = {
      deaths: STRESS_DEATHS,
      restarts: STRESS_RESTARTS,
      childrenDelta: res1.children - res0.children,
      materialsDelta: res1.materials - res0.materials,
      geometriesDelta: res1.geometries - res0.geometries,
      heapDelta: (res0.heap !== null && res1.heap !== null) ? res1.heap - res0.heap : null,
      after: res1,
    };
  }
  await page.close();
  return { name, url, viewport, warmupMs: WARMUP_MS, sampleMs: SAMPLE_MS, perf, gpu, userAgent: ua, before, peaks, leak };
};

const q = (params) => `${BASE}${params}${params.includes('?') ? '&' : '?'}perf=1`;
const results = [];
// Primary production workload (M7.3 advanced level, default flags).
results.push(await measure(
  'advanced-default-720p',
  q('?level=advanced-cube-01'),
  { width: 1280, height: 720 },
  true, // leak stress on the primary workload
));
// Diagnostic fallbacks (same workload — cost attribution, not a pass path).
results.push(await measure('advanced-postoff-720p', q('?level=advanced-cube-01&post=off'), { width: 1280, height: 720 }, false));
results.push(await measure('advanced-fxoff-720p', q('?level=advanced-cube-01&fx=off'), { width: 1280, height: 720 }, false));
results.push(await measure('advanced-triggersoff-720p', q('?level=advanced-cube-01&triggers=off'), { width: 1280, height: 720 }, false));
// M7.1 opening reference + resolution matrix.
results.push(await measure('slice-default-720p', q('?level=vertical-slice-01'), { width: 1280, height: 720 }, false));
results.push(await measure('advanced-default-1080p', q('?level=advanced-cube-01'), { width: 1920, height: 1080 }, false));

// --- M6D scenario pass: heaviest production sections on one 1280x720 page.
// Staging coordinates reuse the proven M7.3 browser-QA values (same file
// family: scripts/browser-qa.mjs m73 section).
const SHOT_DIR = path.resolve('qa/screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const scenarios = [];
{
  const page = await browser.newPage(PAGE_OPTS({ width: 1280, height: 720 }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[scenario] ${msg.text()}`);
  });
  page.on('pageerror', (err) => pageErrors.push(`[scenario] ${String(err)}`));
  try {
    await page.goto(q('?level=advanced-cube-01'), { waitUntil: 'load', timeout: 60000 });
  } catch {
    await page.goto(q('?level=advanced-cube-01'), { waitUntil: 'commit', timeout: 60000 });
  }
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  const snap = () => page.evaluate(() => ({
    status: window.__gd3d.status(),
    z: window.__gd3d.playerPosition().z,
    section: window.__gd3d.visualSectionId(),
    stats: window.__gd3d.rendererStats(),
    children: window.__gd3d.sceneChildren(),
    materials: window.__gd3d.materialCount(),
    geometries: window.__gd3d.geometryCount(),
    particles: window.__gd3d.activeParticles(),
    trail: window.__gd3d.trailSamples(),
    streaks: window.__gd3d.activeStreaks(),
    punch: window.__gd3d.eventPunchEnergy(),
    teleports: window.__gd3d.teleportEventCount(),
  }));
  const shot = async (name) => {
    const p = path.join(SHOT_DIR, `${name}.png`);
    await page.screenshot({ path: p });
    return `${name}.png`;
  };
  const stage = async (x, y, z, settleMs = 1200) => {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(600);
    await page.evaluate((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x, y, z });
    await page.waitForTimeout(settleMs);
  };
  // Pause-photo: the uncommanded cube dies quickly in these sections, so
  // freeze the sim (P) right after the probes and photograph the frozen
  // section frame (M7.3 m73freeze pattern) — then resume.
  const photoStage = async (name, x, y, z, file, settleMs = 1200) => {
    await stage(x, y, z, settleMs);
    const s = await snap();
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(300);
    const z1 = (await pos()).z;
    await page.waitForTimeout(300);
    if (Math.abs((await pos()).z - z1) > 0.05) {
      await page.keyboard.press('KeyP'); // pause missed under load: retry
      await page.waitForTimeout(300);
    }
    const file2 = await shot(file);
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(400);
    scenarios.push({ name, ...s, shot: file2 });
  };
  const pos = () => page.evaluate(() => window.__gd3d.playerPosition());
  scenarios.push({ name: 'opening', ...(await snap()), shot: await shot('m6d-01-opening') });
  await photoStage('islands', 2.6, 0.55, 100, 'm6d-02-islands');
  // Ceiling: staging PAST the up-portal skips the crossing (mode stays
  // floor, cube falls). Stage before portal 322 and ride it: poll for a
  // settled ceiling run, then pause-photo.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 0.55, 310));
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const c = await page.evaluate(() => ({
      st: window.__gd3d.status(),
      z: window.__gd3d.playerPosition().z,
      g: window.__gd3d.grounded(),
      m: window.__gd3d.gravityMode(),
    }));
    if (c.m === 'ceiling' && c.g && c.st === 'running' && c.z > 338) break;
  }
  {
    const s = await snap();
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(500);
    const file = await shot('m6d-03-ceiling');
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(400);
    scenarios.push({ name: 'ceiling', ...s, shot: file });
  }
  // Teleport short-hop: stage before the mid-air ring, poll the edge.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(600);
  const tpBase = await page.evaluate(() => window.__gd3d.teleportEventCount());
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 0.55, 484));
  let tpFired = null;
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => ({
      tp: window.__gd3d.teleportEventCount(),
      id: window.__gd3d.lastTeleportId(),
      z: window.__gd3d.playerPosition().z,
    }));
    if (s.tp > tpBase) { tpFired = s; break; }
  }
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  scenarios.push({ name: 'teleport-hop', ...(await snap()), fired: tpFired, shot: await shot('m6d-04-teleport') });
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  await photoStage('lava-chomp', 0, 0.55, 521, 'm6d-05-lava-chomp');
  await photoStage('storm', 0, 1.75, 795, 'm6d-06-storm', 900);
  // Death burst: catch it LIVE in the death hold (M7.3 pattern) — fast
  // polls, then P + presentation freeze in immediate succession so the
  // 0.5 s burst is still mid-flight when the screenshot lands.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 0.55, 14));
  let burstSeen = false;
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => ({
      dead: window.__gd3d.status() === 'dead',
      burst: window.__gd3d.burstActive(),
    }));
    if (s.dead && s.burst) { burstSeen = true; break; }
  }
  // Re-fire the REAL pooled burst at the latched death position with the
  // live cube parked just behind it (z=13, ~8 u from the z~21 anchor),
  // run it briefly, freeze mid-flight and photograph. NOTE: the burst
  // probe is burstActive() (DeathBurstView) — activeParticles() is the
  // VFX pool and never reflects the death burst.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__gd3d.debugTeleport(0, 0.55, 13));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__gd3d.debugReplayBurst());
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__gd3d.debugFreezeFrame(true));
  scenarios.push({ name: 'death-burst', ...(await snap()), burstSeen, shot: await shot('m6d-07-death-burst') });
  await page.evaluate(() => window.__gd3d.debugFreezeFrame(false));
  await page.waitForTimeout(400);
  // Replay degradation: take a NATURAL death (uncommanded cube runs into
  // the opening spike — no debug placement, which lives outside the input
  // tape and would invalidate it by design), replay the finalized tape,
  // and prove resources stay flat across repeated replays + teleports.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(600);
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(250);
    const dead = await page.evaluate(() => window.__gd3d.status() === 'dead');
    if (dead) break;
  }
  const hasTape = await page.evaluate(() => window.__gd3d.hasReplay());
  const resBefore = await page.evaluate(() => ({
    children: window.__gd3d.sceneChildren(),
    materials: window.__gd3d.materialCount(),
    geometries: window.__gd3d.geometryCount(),
  }));
  let replay = { hasTape, started: false };
  if (hasTape) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(500);
    replay.started = await page.evaluate(() => window.__gd3d.startReplay());
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(250);
      const v = await page.evaluate(() => window.__gd3d.replayVerification());
      if (v.kind === 'pass' || v.kind === 'diverged') { replay.verification = v; break; }
    }
    replay.shot = await shot('m6d-08-replay');
    await page.keyboard.press('KeyR'); // back to live
    await page.waitForTimeout(500);
    // Repeated-teleport stress: 3 hop loops, resources must stay flat.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('KeyR');
      await page.waitForTimeout(500);
      const b = await page.evaluate(() => window.__gd3d.teleportEventCount());
      await page.evaluate(() => window.__gd3d.debugTeleport(0, 0.55, 484));
      for (let j = 0; j < 200; j++) {
        await page.waitForTimeout(200);
        const c = await page.evaluate(() => window.__gd3d.teleportEventCount());
        if (c > b) break;
      }
    }
  }
  const resAfter = await page.evaluate(() => ({
    children: window.__gd3d.sceneChildren(),
    materials: window.__gd3d.materialCount(),
    geometries: window.__gd3d.geometryCount(),
  }));
  scenarios.push({
    name: 'replay-stress',
    ...(await snap()),
    replay,
    childrenDelta: resAfter.children - resBefore.children,
    materialsDelta: resAfter.materials - resBefore.materials,
    geometriesDelta: resAfter.geometries - resBefore.geometries,
  });
  await page.close();
}
for (const s of scenarios) {
  console.log(
    `scenario ${s.name}: status=${s.status} z=${Number(s.z).toFixed(1)} section=${s.section} `
    + `calls=${s.stats.calls} tris=${s.stats.triangles} children=${s.children} `
    + `fx=${s.particles}/${s.trail}/${s.streaks}${s.burstSeen !== undefined ? ` burst=${s.burstSeen}` : ''}`
    + `${s.fired ? ` tp=${s.fired.id}@${Number(s.fired.z).toFixed(1)}` : ''}`,
  );
}

await browser.close();

// Hardware-vs-software verdict from the ACTUAL renderer string
// (WEBGL_debug_renderer_info is authoritative for the gate).
const primaryGpu = results[0]?.gpu?.renderer ?? 'unknown';
const gpuClass = classifyGpuRenderer(primaryGpu);
const isSoftware = gpuClass === 'software';
let verdict;
let gateReasons = [];
if (OPTS.realGpu) {
  // Primary acceptance workload: advanced-cube-01, 1920x1080, DPR 1,
  // production defaults ON. Frame DELIVERY (rAF cadence) — a headed
  // browser may be vsync-limited, so this is smooth-delivery evidence,
  // never a GPU-execution-time claim.
  const primary1080 = results.find((r) => r.name === 'advanced-default-1080p');
  const gate = evaluateRealGpuGate({
    gpuClass,
    renderer: primaryGpu,
    primary: {
      p50: primary1080?.perf.p50 ?? Number.POSITIVE_INFINITY,
      p95: primary1080?.perf.p95 ?? Number.POSITIVE_INFINITY,
      p99: primary1080?.perf.p99 ?? Number.POSITIVE_INFINITY,
      over33: primary1080?.perf.over33 ?? Number.POSITIVE_INFINITY,
    },
  });
  verdict = gate.verdict;
  gateReasons = gate.reasons;
} else {
  verdict = isSoftware
    ? 'SOFTWARE RASTERIZER — functional/leak evidence only; REAL-GPU HUMAN PERF GATE OPEN'
    : 'HARDWARE GPU IDENTIFIED — evaluate against the 60 FPS envelope';
}

const report = {
  milestone: 'M6D',
  timestamp: new Date().toISOString(),
  commit: gitSha,
  mode: OPTS.realGpu ? 'real-gpu-headed' : 'headless-software',
  browserChannel: OPTS.realGpu ? OPTS.channel : 'bundled-chromium',
  headed: OPTS.realGpu,
  verdict,
  gateReasons,
  gpuSoftware: isSoftware,
  poolCapacity: POOL_CAPACITY,
  consoleErrors,
  pageErrors,
  results,
  scenarios,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

for (const r of results) {
  const p = r.perf;
  console.log(
    `${r.name}: fps=${p.fps.toFixed(1)} p50=${p.p50.toFixed(2)}ms p95=${p.p95.toFixed(2)}ms `
    + `p99=${p.p99.toFixed(2)}ms max=${p.max.toFixed(1)}ms >25=${p.over25} >33=${p.over33} >50=${p.over50} `
    + `calls=${r.before.stats.calls} tris=${r.before.stats.triangles} children=${r.before.children} `
    + `mat=${r.before.materials} geo=${r.before.geometries} passes=${r.before.passes}`,
  );
}
console.log(`mode: ${report.mode} (channel=${report.browserChannel} headed=${report.headed})`);
console.log(`GPU: ${results[0]?.gpu?.vendor} | ${primaryGpu} | ${results[0]?.gpu?.version} | DPR ${results[0]?.gpu?.devicePixelRatio} (render ${results[0]?.gpu?.renderPixelRatio})`);
console.log(isSoftware ? 'SOFTWARE RENDERER — REAL GPU GATE NOT VALID' : 'HARDWARE GPU DETECTED');
console.log(`VERDICT: ${verdict}`);
for (const reason of gateReasons) console.log(`  - ${reason}`);
console.log(`console errors: ${consoleErrors.length}, page errors: ${pageErrors.length}`);
console.log(`wrote ${OUT}`);
if (OPTS.realGpu) console.log(windowsGateInstructions(OPTS.channel));
if (consoleErrors.length > 0 || pageErrors.length > 0) process.exitCode = 1;
// Exit-code contract: headless mode keeps the historical signal (errors
// only). Real-gpu mode fails LOUDLY on anything but REAL-GPU PASS — an
// invalid (software) or unmet gate must never look green to a caller.
if (OPTS.realGpu && verdict !== 'REAL-GPU PASS') process.exitCode = 1;
