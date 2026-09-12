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
 * A human runs the SAME script on a real GPU and commits the JSON:
 *   1. npm run dev            (local server on :5173)
 *   2. node scripts/perf-gate.mjs [--url http://localhost:5173/]
 *   3. inspect qa/perf/m6d-real-gpu.json (+ gpuIdentity.renderer)
 *
 * Usage: node scripts/perf-gate.mjs [--url <base>] [--out <json>]
 * Requires the dev server (see QA_URL env for browser-qa parity).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import nodeChildProcess from 'node:child_process';

const BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : (process.env.QA_URL ?? 'http://localhost:5173/');
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.resolve('qa/perf/m6d-real-gpu.json');

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

const browser = await chromium.launch();
const consoleErrors = [];
const pageErrors = [];

/** One measured configuration: load, warm up, sample, report. */
const measure = async (name, url, viewport, stress) => {
  const page = await browser.newPage({ viewport });
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

const q = (params) => `${BASE}${params.includes('?') ? '&' : '?'}perf=1`;
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

await browser.close();

// Hardware-vs-software verdict from the ACTUAL renderer string.
const primaryGpu = results[0]?.gpu?.renderer ?? 'unknown';
const softwareMarkers = ['swiftshader', 'llvmpipe', 'software', 'basic render', 'softpipe', 'swrast'];
const isSoftware = softwareMarkers.some((m) => primaryGpu.toLowerCase().includes(m));
const verdict = isSoftware
  ? 'SOFTWARE RASTERIZER — functional/leak evidence only; REAL-GPU HUMAN PERF GATE OPEN'
  : 'HARDWARE GPU IDENTIFIED — evaluate against the 60 FPS envelope';

const report = {
  milestone: 'M6D',
  timestamp: new Date().toISOString(),
  commit: gitSha,
  verdict,
  gpuSoftware: isSoftware,
  poolCapacity: POOL_CAPACITY,
  consoleErrors,
  pageErrors,
  results,
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
console.log(`GPU: ${results[0]?.gpu?.vendor} | ${primaryGpu} | ${results[0]?.gpu?.version} | DPR ${results[0]?.gpu?.devicePixelRatio} (render ${results[0]?.gpu?.renderPixelRatio})`);
console.log(`VERDICT: ${verdict}`);
console.log(`console errors: ${consoleErrors.length}, page errors: ${pageErrors.length}`);
console.log(`wrote ${OUT}`);
if (consoleErrors.length > 0 || pageErrors.length > 0) process.exitCode = 1;
