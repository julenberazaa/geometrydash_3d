import {
  MAX_CATCHUP_STEPS_PER_FRAME,
  MAX_FRAME_DELTA_MS,
  SIMULATION_DT,
} from './constants';

export interface FixedStepLoopCallbacks {
  /** One fixed simulation step. Called 0..N times per frame. */
  update: (stepDt: number) => void;
  /** Render once per browser frame. alpha in [0,1) interpolates prev->current sim transforms. */
  render: (alpha: number, renderDtSeconds: number) => void;
}

export type FixedStepLoopOptions = FixedStepLoopOptionsData;

export interface FixedStepLoopOptionsData {
  stepDt?: number;
  maxFrameDeltaMs?: number;
  maxCatchUpSteps?: number;
  /**
   * Frame source. Defaults to requestAnimationFrame; tests inject a manual pump.
   * Receives a callback to invoke with the current timestamp (ms).
   */
  frameRequester?: (cb: (nowMs: number) => void) => void;
  /**
   * Wall-clock source for delta measurement. Defaults to performance.now();
   * tests inject a synthetic clock so timing is fully deterministic.
   */
  now?: () => number;
}

interface FixedStepLoopOptionsInternal {
  stepDt: number;
  maxFrameDeltaMs: number;
  maxCatchUpSteps: number;
  frameRequester: (cb: (nowMs: number) => void) => void;
  now: () => number;
}

/**
 * Accumulator-based fixed timestep loop.
 *
 * Policy (see src/core/constants.ts):
 * - clamp incoming delta (backgrounded tab),
 * - run at most maxCatchUpSteps fixed updates per frame,
 * - discard leftover accumulation beyond the catch-up budget (never spiral),
 * - render exactly once per frame with interpolation alpha = accumulator / stepDt.
 *
 * Gameplay correctness never depends on the render rate; this class is unit-tested
 * with synthetic frame pumps at 60/120/144 FPS.
 */
export class FixedStepLoop {
  private readonly opts: FixedStepLoopOptionsInternal;
  private readonly cb: FixedStepLoopCallbacks;

  private running = false;
  private paused = false;
  private lastTimeMs = 0;
  private accumulatorMs = 0;

  /** Diagnostics. */
  public stepsLastFrame = 0;
  public discardedMsLastFrame = 0;
  public totalSteps = 0;

  constructor(cb: FixedStepLoopCallbacks, options: FixedStepLoopOptions = {}) {
    this.cb = cb;
    this.opts = {
      stepDt: options.stepDt ?? SIMULATION_DT,
      maxFrameDeltaMs: options.maxFrameDeltaMs ?? MAX_FRAME_DELTA_MS,
      maxCatchUpSteps: options.maxCatchUpSteps ?? MAX_CATCHUP_STEPS_PER_FRAME,
      frameRequester:
        options.frameRequester ??
        ((request: (nowMs: number) => void) => {
          requestAnimationFrame(request);
        }),
      now: options.now ?? (() => performance.now()),
    };
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  public get interpolationAlpha(): number {
    return this.accumulatorMs / (this.opts.stepDt * 1000);
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = this.opts.now();
    this.accumulatorMs = 0;
    const tick = (nowMs: number): void => {
      if (!this.running) return;
      this.frame(nowMs);
      this.opts.frameRequester(tick);
    };
    this.opts.frameRequester(tick);
  }

  public stop(): void {
    this.running = false;
  }

  public setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    // Do not let pause duration become simulated gameplay time.
    this.lastTimeMs = this.opts.now();
    this.accumulatorMs = 0;
  }

  /** Process one frame of wall-clock time. Exposed for tests. */
  public frame(nowMs: number): void {
    if (!this.running) return;
    const rawDeltaMs = nowMs - this.lastTimeMs;
    this.lastTimeMs = nowMs;
    const deltaMs =
      Number.isFinite(rawDeltaMs) && rawDeltaMs > 0
        ? Math.min(rawDeltaMs, this.opts.maxFrameDeltaMs)
        : 0;

    if (!this.paused) {
      this.accumulatorMs += deltaMs;
      let steps = 0;
      const stepDtMs = this.opts.stepDt * 1000;
      while (this.accumulatorMs >= stepDtMs && steps < this.opts.maxCatchUpSteps) {
        this.cb.update(this.opts.stepDt);
        this.accumulatorMs -= stepDtMs;
        steps++;
      }
      // Spiral-of-death guard: drop time beyond the per-frame catch-up budget.
      // The remainder must also NEVER feed interpolation (alpha would exceed 1
      // and visually extrapolate past the newest simulation state).
      if (steps === this.opts.maxCatchUpSteps && this.accumulatorMs >= stepDtMs) {
        this.discardedMsLastFrame = this.accumulatorMs;
        this.accumulatorMs = 0;
      } else {
        this.discardedMsLastFrame = 0;
      }
      this.stepsLastFrame = steps;
      this.totalSteps += steps;
    } else {
      this.stepsLastFrame = 0;
      this.discardedMsLastFrame = 0;
    }

    this.cb.render(this.interpolationAlpha, deltaMs / 1000);
  }
}

