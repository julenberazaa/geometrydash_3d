/**
 * Frame profiler (M6D) — DEBUG/PERF-only render instrumentation.
 *
 * Lives ABOVE gameplay: it observes wall-clock frame delivery and never
 * touches GameSimulation, inputs, or replay state. Off by default
 * (`?perf=1` enables it); when disabled it records nothing and costs one
 * branch per rendered frame.
 *
 * Design:
 * - bounded ring buffer (fixed Float64Array, default 600 samples ≈ 10 s @
 *   60 fps) — no history growth, no per-frame allocation;
 * - streaming counters (frames, over-budget counts) updated in O(1);
 * - percentiles computed on the COLD snapshot path (sorted copy) — never
 *   in the hot loop.
 */
export interface PerfSnapshot {
  /** Wall-clock frames recorded since sampling began. */
  frames: number;
  /** Mean frames per second over the sampled window. */
  fps: number;
  /** Frame-interval percentiles in milliseconds. */
  p50: number;
  p95: number;
  p99: number;
  /** Slowest sampled interval in milliseconds. */
  max: number;
  /** Frames slower than 25 / 33.3 / 50 ms. */
  over25: number;
  over33: number;
  over50: number;
  /** Ring capacity (proves boundedness). */
  capacity: number;
}

const DEFAULT_CAPACITY = 600;

export class PerfProfiler {
  private readonly ring: Float64Array;
  private head = 0;
  private count = 0;
  private lastMs = -1;
  private over25 = 0;
  private over33 = 0;
  private over50 = 0;
  /** Monotonic session frames (never reset — proves the ring is bounded). */
  private totalFrames = 0;

  public constructor(capacity: number = DEFAULT_CAPACITY) {
    const cap = Math.max(16, Math.floor(capacity));
    this.ring = new Float64Array(cap);
  }

  /** Ring capacity (bounded-history contract observability). */
  public get capacity(): number {
    return this.ring.length;
  }

  /** Total frames ever recorded (grows; the ring does not). */
  public get framesTotal(): number {
    return this.totalFrames;
  }

  /** Samples currently held (<= capacity, always). */
  public get samples(): number {
    return this.count;
  }

  /**
   * Record one presented frame at wall-clock `nowMs`. O(1), zero
   * allocation. The first call after construction/reset only arms the
   * clock (no interval yet).
   */
  public recordFrame(nowMs: number): void {
    this.totalFrames += 1;
    if (this.lastMs < 0) {
      this.lastMs = nowMs;
      return;
    }
    const dt = nowMs - this.lastMs;
    this.lastMs = nowMs;
    if (!(dt >= 0) || dt > 1000) return; // clock jump / tab stall: skip the sample
    this.ring[this.head] = dt;
    this.head = (this.head + 1) % this.ring.length;
    if (this.count < this.ring.length) this.count += 1;
    if (dt > 25) this.over25 += 1;
    if (dt > 33.3) this.over33 += 1;
    if (dt > 50) this.over50 += 1;
  }

  /**
   * Discard warmup: clears the sampled window (and budget counters) while
   * keeping the monotonic frame total. Cold path — the harness calls this
   * after load/shader warmup, before the measured window.
   */
  public beginSampling(): void {
    this.head = 0;
    this.count = 0;
    this.over25 = 0;
    this.over33 = 0;
    this.over50 = 0;
    this.lastMs = -1;
  }

  /**
   * Rolling statistics over the sampled window. Cold path (allocates one
   * sorted copy) — the harness reads this rarely, never per frame.
   */
  public snapshot(): PerfSnapshot {
    const n = this.count;
    const capacity = this.ring.length;
    if (n === 0) {
      return { frames: 0, fps: 0, p50: 0, p95: 0, p99: 0, max: 0, over25: 0, over33: 0, over50: 0, capacity };
    }
    const sorted = Array.from(this.ring.subarray(0, n)).sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.min(n - 1, Math.floor(q * n))] ?? 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i] ?? 0;
    const mean = sum / n;
    return {
      frames: n,
      fps: mean > 0 ? 1000 / mean : 0,
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      max: sorted[n - 1] ?? 0,
      over25: this.over25,
      over33: this.over33,
      over50: this.over50,
      capacity,
    };
  }
}
