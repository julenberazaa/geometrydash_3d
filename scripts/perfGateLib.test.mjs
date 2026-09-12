/**
 * M6D.1 gate-logic tests (no GPU required — pure functions only).
 *
 * Covers: CLI parsing / launch-mode selection, software-renderer
 * classification, hardware-renderer classification, verdict
 * calculation. Lives beside the lib because vitest only includes
 * `tests/**` + this file (see vite.config.ts); `tsc` and eslint both
 * ignore `scripts/`.
 */
import { describe, expect, it } from 'vitest';
import {
  buildLaunchOptions,
  classifyGpuRenderer,
  defaultOutPath,
  evaluateRealGpuGate,
  parsePerfGateArgs,
  REAL_GPU_THRESHOLDS,
  windowsGateInstructions,
} from './perfGateLib.mjs';

describe('perf-gate CLI parsing', () => {
  it('defaults to headless software mode with no flags', () => {
    expect(parsePerfGateArgs([])).toEqual({ realGpu: false, channel: 'chrome', out: null, url: null });
  });

  it('enables the hardware gate with --real-gpu', () => {
    const o = parsePerfGateArgs(['--real-gpu']);
    expect(o.realGpu).toBe(true);
    expect(o.channel).toBe('chrome');
  });

  it('--channel implies --real-gpu and is never silently ignored', () => {
    expect(parsePerfGateArgs(['--channel', 'msedge'])).toMatchObject({ realGpu: true, channel: 'msedge' });
    expect(parsePerfGateArgs(['--channel=msedge'])).toMatchObject({ realGpu: true, channel: 'msedge' });
  });

  it('passes through --out and --url overrides', () => {
    expect(parsePerfGateArgs(['--out', 'x.json', '--url', 'http://a/'])).toMatchObject({
      out: 'x.json',
      url: 'http://a/',
    });
    expect(parsePerfGateArgs(['--out=x.json'])).toMatchObject({ out: 'x.json' });
  });
});

describe('launch-mode selection', () => {
  it('default mode passes no launch options (historical chromium.launch())', () => {
    expect(buildLaunchOptions({ realGpu: false, channel: 'chrome' })).toEqual({});
  });

  it('real-gpu mode launches the branded browser headed, never SwiftShader', () => {
    expect(buildLaunchOptions({ realGpu: true, channel: 'chrome' })).toEqual({
      channel: 'chrome',
      headless: false,
    });
    expect(buildLaunchOptions({ realGpu: true, channel: 'msedge' }).channel).toBe('msedge');
  });
});

describe('evidence output paths', () => {
  it('defaults software evidence to m6d-swiftshader.json', () => {
    expect(defaultOutPath(false)).toBe('qa/perf/m6d-swiftshader.json');
  });

  it('defaults hardware evidence to m6d-real-gpu.json', () => {
    expect(defaultOutPath(true)).toBe('qa/perf/m6d-real-gpu.json');
  });
});

describe('GPU renderer classification', () => {
  it('flags software rasterizers', () => {
    expect(classifyGpuRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('software');
    expect(classifyGpuRenderer('llvmpipe (LLVM 15, 256 bits)')).toBe('software');
    expect(classifyGpuRenderer('WebKit WebGL Software Rasterizer')).toBe('software');
    expect(classifyGpuRenderer('ANGLE (Microsoft Basic Render Driver Direct3D 11)')).toBe('software');
  });

  it('is fail-closed on unknown / empty renderer strings', () => {
    expect(classifyGpuRenderer('')).toBe('software');
    expect(classifyGpuRenderer(null)).toBe('software');
    expect(classifyGpuRenderer(undefined)).toBe('software');
  });

  it('accepts real hardware renderers', () => {
    expect(classifyGpuRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x0000286A) Direct3D 11 vs_5_0 ps_5_0, D3D11)')).toBe('hardware');
    expect(classifyGpuRenderer('ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D 11, D3D11)')).toBe('hardware');
    expect(classifyGpuRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)')).toBe('hardware');
  });
});

describe('real-GPU verdict calculation', () => {
  const goodPrimary = { p50: 16.7, p95: 17.1, p99: 19.8, over33: 0 };

  it('passes hardware inside the envelope', () => {
    const v = evaluateRealGpuGate({ gpuClass: 'hardware', renderer: 'ANGLE (NVIDIA)', primary: goodPrimary });
    expect(v.verdict).toBe('REAL-GPU PASS');
  });

  it('reports isolated spikes without failing', () => {
    const v = evaluateRealGpuGate({
      gpuClass: 'hardware',
      renderer: 'ANGLE (NVIDIA)',
      primary: { ...goodPrimary, over33: 2 },
    });
    expect(v.verdict).toBe('REAL-GPU PASS');
    expect(v.reasons.some((r) => r.includes('isolated'))).toBe(true);
  });

  it('fails repeated hitch patterns and threshold breaches', () => {
    const hitches = evaluateRealGpuGate({
      gpuClass: 'hardware',
      renderer: 'ANGLE (NVIDIA)',
      primary: { ...goodPrimary, over33: REAL_GPU_THRESHOLDS.maxIsolatedHitches + 1 },
    });
    expect(hitches.verdict).toBe('REAL-GPU PERFORMANCE FAIL');
    const slow = evaluateRealGpuGate({
      gpuClass: 'hardware',
      renderer: 'ANGLE (NVIDIA)',
      primary: { ...goodPrimary, p95: 24.5 },
    });
    expect(slow.verdict).toBe('REAL-GPU PERFORMANCE FAIL');
    expect(slow.reasons.some((r) => r.includes('p95'))).toBe(true);
  });

  it('leaves the gate open on software renderers', () => {
    const v = evaluateRealGpuGate({ gpuClass: 'software', renderer: 'SwiftShader', primary: goodPrimary });
    expect(v.verdict).toBe('REAL-GPU GATE STILL OPEN');
  });
});

describe('windows instructions', () => {
  it('prints the exact two-terminal workflow', () => {
    const s = windowsGateInstructions('chrome');
    expect(s).toContain('npm run dev');
    expect(s).toContain('node scripts/perf-gate.mjs --real-gpu --channel chrome');
    expect(s).toContain('do NOT minimize');
  });
});
