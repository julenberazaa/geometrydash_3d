/**
 * M6D.1 real-GPU gate shared logic (dev harness, not shipped).
 *
 * SINGLE OWNER for the gate's classification + verdict rules: pure
 * functions only (no Playwright, no DOM, no side effects), so the rules
 * are unit-tested without requiring a GPU. `scripts/perf-gate.mjs`
 * imports these — never copy them.
 */

/** Renderer-string fragments that prove a SOFTWARE rasterizer. */
export const SOFTWARE_RENDERER_MARKERS = [
  'swiftshader',
  'llvmpipe',
  'software',
  'basic render',
  'softpipe',
  'swrast',
];

/**
 * Classify an UNMASKED WebGL renderer string (`WEBGL_debug_renderer_info`
 * is authoritative for the gate). Fail-closed: anything that is not a
 * string, is empty, or matches a software marker counts as software —
 * an unknown renderer must NEVER pass as hardware.
 */
export function classifyGpuRenderer(renderer) {
  if (typeof renderer !== 'string' || renderer.trim().length === 0) return 'software';
  const lower = renderer.toLowerCase();
  return SOFTWARE_RENDERER_MARKERS.some((m) => lower.includes(m)) ? 'software' : 'hardware';
}

export const DEFAULT_BROWSER_CHANNEL = 'chrome';

/**
 * Parse perf-gate CLI args (space-separated repo style; `--key=value`
 * also accepted for --channel/--out/--url).
 *
 * - no flags: existing headless/software-compatible mode.
 * - `--real-gpu`: headed hardware human-gate mode (installed branded
 *   browser via its normal graphics stack — never SwiftShader).
 * - `--channel <name>`: Playwright browser channel (e.g. `msedge`);
 *   implies `--real-gpu` — a requested channel is never silently
 *   ignored in favour of bundled headless Chromium.
 */
export function parsePerfGateArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const valueOf = (key) => {
    const eq = args.find((a) => a.startsWith(`${key}=`));
    if (eq !== undefined) return eq.slice(key.length + 1);
    const i = args.indexOf(key);
    if (i >= 0 && i + 1 < args.length) return args[i + 1];
    return null;
  };
  const channel = valueOf('--channel');
  const realGpu = args.includes('--real-gpu') || channel !== null;
  return {
    realGpu,
    channel: channel ?? DEFAULT_BROWSER_CHANNEL,
    out: valueOf('--out'),
    url: valueOf('--url'),
  };
}

/** Evidence filename per mode (--out overrides either). */
export function defaultOutPath(realGpu) {
  return realGpu ? 'qa/perf/m6d-real-gpu.json' : 'qa/perf/m6d-swiftshader.json';
}

/**
 * Playwright launch descriptor per mode. Default mode passes NO launch
 * options (byte-identical to the historical `chromium.launch()`).
 * Real-GPU mode launches the installed branded browser headed with the
 * OS normal graphics stack: no SwiftShader flags, ever.
 */
export function buildLaunchOptions({ realGpu, channel }) {
  if (!realGpu) return {};
  return { channel: channel ?? DEFAULT_BROWSER_CHANNEL, headless: false };
}

/**
 * M6D acceptance envelope (primary workload: advanced-cube-01,
 * 1920x1080, DPR 1, production defaults ON). Frame DELIVERY percentiles
 * over the 8 s steady-state sample — a headed browser may be
 * vsync-limited, so ~16.67 ms rAF cadence is smooth delivery, NOT GPU
 * execution time; no GPU-timer claim is made.
 */
export const REAL_GPU_THRESHOLDS = {
  p50: 17.5,
  p95: 20,
  p99: 25,
  /** Frame slower than this counts as a missed-frame hitch. */
  hitchMs: 33.3,
  /** Up to this many isolated hitches are reported, not failed. */
  maxIsolatedHitches: 3,
};

/**
 * Gate verdict from the classified renderer + the primary-config sample.
 * Returns the verdict string plus human-readable reasons (also stored
 * in the evidence JSON).
 */
export function evaluateRealGpuGate({ gpuClass, renderer, primary }) {
  if (gpuClass !== 'hardware') {
    return {
      verdict: 'REAL-GPU GATE STILL OPEN',
      reasons: [
        `software renderer (${renderer || 'unknown'}) — REAL GPU GATE NOT VALID`,
      ],
    };
  }
  const t = REAL_GPU_THRESHOLDS;
  const reasons = [];
  if (!(primary.p50 <= t.p50)) reasons.push(`p50 ${primary.p50.toFixed(2)} ms > ${t.p50} ms`);
  if (!(primary.p95 <= t.p95)) reasons.push(`p95 ${primary.p95.toFixed(2)} ms > ${t.p95} ms`);
  if (!(primary.p99 <= t.p99)) reasons.push(`p99 ${primary.p99.toFixed(2)} ms > ${t.p99} ms`);
  if (primary.over33 > t.maxIsolatedHitches) {
    reasons.push(
      `repeated >${t.hitchMs} ms hitch pattern (${primary.over33} missed frames in the sample)`,
    );
  } else if (primary.over33 > 0) {
    reasons.push(
      `note: ${primary.over33} isolated scheduling spike(s) — reported, not failed`,
    );
  }
  const failed = reasons.some((r) => !r.startsWith('note:'));
  return {
    verdict: failed ? 'REAL-GPU PERFORMANCE FAIL' : 'REAL-GPU PASS',
    reasons: failed ? reasons : ['1080p production-default envelope met on hardware', ...reasons],
  };
}

/** Exact Windows workflow printed at the end of a --real-gpu run. */
export function windowsGateInstructions(channel) {
  return [
    'REAL-GPU HUMAN GATE — Windows instructions:',
    '  Terminal 1:  cd C:\\Users\\Julen\\Desktop\\geometrydash_3d',
    '               npm run dev',
    '  Terminal 2:  cd C:\\Users\\Julen\\Desktop\\geometrydash_3d',
    `               node scripts/perf-gate.mjs --real-gpu --channel ${channel}`,
    '  - Leave the headed browser window VISIBLE and FOCUSED; do NOT minimize it.',
    '  - Avoid gaming / video / GPU-heavy apps during the test.',
    '  - Let the script finish; read qa/perf/m6d-real-gpu.json + the verdict line.',
  ].join('\n');
}
