import { GRAVITY_LESSONS_DURATION, MUSIC_DEFAULT_VOLUME } from './musicTrack';

/**
 * MusicDirector (M9) — the ONE presentation owner of music transport.
 *
 * Responsibility: track loading, decode/readiness, play, pause, resume,
 * restart, seek/resync, mute, volume, transport state, track offset
 * bookkeeping. Web Audio buffer-source transport (precise start offsets +
 * pause-as-stop/resume without drift accumulation).
 *
 * AUTHORITY BOUNDARY (hard rule — see ARCHITECTURE.md): audio OUTPUT
 * follows the deterministic simulation clock (`syncToTarget(simTime)` —
 * the caller computes the target from `elapsedSimTime`). The director
 * NEVER feeds time back into gameplay: no sim/replay code reads it, and
 * every method is guarded so audio can never throw into gameplay or QA
 * (headless silence is fine — transport state stays observable).
 *
 * Pause is stop + offset record (buffer sources have no native pause);
 * resume restarts the source at the recorded offset. Drift correction is
 * presentation-only: dead-band ±60 ms (leave alone), resync (restart at
 * the caller-supplied target) beyond 180 ms. Corrections never alter the
 * simulation.
 */

export const MUSIC_DRIFT_DEADBAND_SECONDS = 0.06;
export const MUSIC_DRIFT_RESYNC_SECONDS = 0.18;
/** Death/finish cut fade (short — the respawn restart re-enters on beat). */
export const MUSIC_CUT_FADE_SECONDS = 0.09;

export type MusicTransportState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'failed';

/** Minimal engine surface (real Web Audio in production, fakes in tests). */
export interface AudioBufferLike {
  readonly duration: number;
}
export interface AudioSourceLike {
  onended: (() => void) | null;
  start(when: number, offset: number): void;
  stop(when?: number): void;
  disconnect(): void;
}
export interface AudioGainLike {
  setGain(value: number): void;
  rampToZero(fadeSeconds: number): void;
  connect(destination: unknown): void;
  disconnect(): void;
}
export interface AudioEngineLike {
  readonly currentTime: number;
  resume(): void;
  /** Live AudioContext state ('running' | 'suspended' | 'closed'). */
  contextState(): string;
  createSource(buffer: AudioBufferLike): AudioSourceLike;
  createGain(): AudioGainLike;
  readonly destination: unknown;
  decode(data: ArrayBuffer): Promise<AudioBufferLike>;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  close(): void;
}

/** Real Web Audio engine (constructed lazily on the start gesture). */
export class WebAudioEngine implements AudioEngineLike {
  private readonly ctx: AudioContext;

  constructor() {
    this.ctx = new window.AudioContext();
  }

  public get currentTime(): number {
    return this.ctx.currentTime;
  }

  public resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  public contextState(): string {
    return this.ctx.state;
  }

  public createSource(buffer: AudioBufferLike): AudioSourceLike {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer as AudioBuffer;
    // Bridge the node `onended` (fires on natural end AND manual stop —
    // the director disambiguates via its generation counter) to the
    // director-owned handler property.
    let handler: (() => void) | null = null;
    source.onended = (): void => {
      if (handler !== null) handler();
    };
    return {
      get onended(): (() => void) | null {
        return handler;
      },
      set onended(cb: (() => void) | null) {
        handler = cb;
      },
      start: (when: number, offset: number): void => {
        source.start(when, offset);
      },
      stop: (when?: number): void => {
        try {
          if (when === undefined) source.stop();
          else source.stop(when);
        } catch {
          // Already stopped — harmless.
        }
      },
      disconnect: (): void => {
        try {
          source.disconnect();
        } catch {
          // Already disconnected — harmless.
        }
      },
    };
  }

  public createGain(): AudioGainLike {
    const gain = this.ctx.createGain();
    return {
      setGain: (value: number): void => {
        gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015);
      },
      rampToZero: (fadeSeconds: number): void => {
        gain.gain.setTargetAtTime(0, this.ctx.currentTime, Math.max(0.01, fadeSeconds / 3));
      },
      connect: (destination: unknown): void => {
        gain.connect(destination as AudioNode);
      },
      disconnect: (): void => {
        try {
          gain.disconnect();
        } catch {
          // Harmless.
        }
      },
    };
  }

  public get destination(): unknown {
    return this.ctx.destination;
  }

  public async decode(data: ArrayBuffer): Promise<AudioBufferLike> {
    // decodeAudioData detaches/neuters some inputs — decode a copy.
    return await this.ctx.decodeAudioData(data.slice(0));
  }

  public async fetchBytes(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`music fetch ${response.status}`);
    return await response.arrayBuffer();
  }

  public close(): void {
    try {
      void this.ctx.close();
    } catch {
      // Harmless.
    }
  }
}

export interface MusicProbe {
  state: MusicTransportState;
  playing: boolean;
  muted: boolean;
  targetTime: number;
  actualTime: number;
  driftMs: number;
  volume: number;
  /** Last gain value applied to the output node (0 when muted). */
  gain: number;
  /** Decoded buffer duration in seconds (-1 when nothing decoded). */
  bufferDuration: number;
  /** Live AudioContext state ('running' | 'suspended' | 'closed' | 'none'). */
  contextState: string;
}

export type MusicSyncAction = 'idle' | 'ok' | 'drift' | 'resynced';

/**
 * Presentation-owned music transport. Construct per Game (composition
 * root); the caller drives lifecycle edges (gesture/pause/death/restart/
 * replay) and per-frame `syncToTarget` from deterministic sim time.
 */
export class MusicDirector {
  private engine: AudioEngineLike | null;
  private readonly createEngine: () => AudioEngineLike | null;
  private state: MusicTransportState = 'idle';
  private audioPath: string | null = null;
  private fetchedBytes: ArrayBuffer | null = null;
  /** In-flight fetch (preload rabbitholes the bytes; ensure awaits it). */
  private fetchPromise: Promise<ArrayBuffer> | null = null;
  private buffer: AudioBufferLike | null = null;
  private source: AudioSourceLike | null = null;
  private gain: AudioGainLike | null = null;
  private generation = 0;
  private startCtxTime = 0;
  private startOffset = 0;
  private pausedOffset = 0;
  private lastTarget = 0;
  private muted = false;
  private volume = MUSIC_DEFAULT_VOLUME;
  /** Last gain applied to a live output node (probe evidence). */
  private appliedGain = 0;
  private disposed = false;

  constructor(
    audioPath: string | null = null,
    engine: AudioEngineLike | null = null,
    createEngine: () => AudioEngineLike | null = () => {
      try {
        return new WebAudioEngine();
      } catch {
        return null;
      }
    },
  ) {
    this.audioPath = audioPath;
    this.engine = engine;
    this.createEngine = createEngine;
  }

  public get transportState(): MusicTransportState {
    return this.state;
  }

  public get isPlaying(): boolean {
    return this.state === 'playing';
  }

  public get isMuted(): boolean {
    return this.muted;
  }

  public get isReady(): boolean {
    return this.buffer !== null;
  }

  /** Eager byte fetch (no gesture needed); decode waits for ensure(). */
  public preload(): void {
    if (this.audioPath === null || this.fetchedBytes !== null || this.fetchPromise !== null) return;
    if (this.state !== 'idle') return;
    this.state = 'loading';
    this.startFetch();
  }

  /**
   * Synchronous gesture edge (M9.1): create/resume the AudioContext INSIDE
   * the user-gesture handler. Autoplay policy ties the running state to
   * user activation — creating/resuming from a promise microtask can leave
   * the context suspended (audible silence with a 'playing' transport).
   * Never throws.
   */
  public beginGesture(): void {
    if (this.disposed) return;
    try {
      if (this.engine === null) {
        this.engine = this.createEngine();
        if (this.engine === null) {
          this.state = 'failed';
          return;
        }
      }
      this.engine.resume();
    } catch {
      this.state = 'failed';
    }
  }

  /**
   * Gesture path: resume the context, (re)fetch the bytes when missing,
   * and decode. Never throws; returns true when the track is ready. A
   * failed preload is NOT terminal — this retries the fetch AND the decode
   * (fetched bytes survive a decode failure; decode reads a copy).
   */
  public async ensure(): Promise<boolean> {
    if (this.disposed) return false;
    try {
      if (this.engine === null) {
        this.engine = this.createEngine();
        if (this.engine === null) {
          this.state = 'failed';
          return false;
        }
      }
      this.engine.resume();
      if (this.fetchedBytes === null) {
        // The gesture may arrive before preload finished — await it; when
        // preload failed (or never ran), start a fresh fetch instead of
        // giving up silently.
        if (this.fetchPromise === null && this.audioPath !== null) this.startFetch();
        if (this.fetchPromise !== null) {
          try {
            this.fetchedBytes = await this.fetchPromise;
          } catch {
            this.state = 'failed';
            return false;
          }
        } else {
          this.state = 'failed';
          return false;
        }
      }
      // (fetchedBytes is non-null here — every still-null path above
      // returned false; decode resolves a buffer or throws into the catch
      // below, so reaching the end means the track is ready.)
      if (this.buffer === null) {
        if (this.state === 'idle' || this.state === 'failed') this.state = 'loading';
        this.buffer = await this.engine.decode(this.fetchedBytes);
        this.state = 'ready';
      } else if (this.state !== 'playing' && this.state !== 'paused') {
        this.state = 'ready';
      }
      return true;
    } catch {
      this.state = 'failed';
      return false;
    }
  }

  /** Start (or restart) the byte fetch; resolves into fetchedBytes. */
  private startFetch(): void {
    if (this.audioPath === null) return;
    const path = this.audioPath;
    const engine = this.engine;
    let pending: Promise<ArrayBuffer>;
    try {
      pending =
        engine !== null
          ? engine.fetchBytes(path)
          : fetch(path).then(async (r) => {
              if (!r.ok) throw new Error(`music fetch ${r.status}`);
              return await r.arrayBuffer();
            });
    } catch {
      this.fetchPromise = null;
      this.state = 'failed';
      return;
    }
    this.fetchPromise = pending;
    void pending.then(
      (bytes) => {
        if (this.disposed) return;
        this.fetchedBytes = bytes;
        this.fetchPromise = null;
        if (this.buffer !== null) this.state = 'ready';
      },
      () => {
        if (this.disposed) return;
        this.fetchPromise = null;
        if (this.buffer === null) this.state = 'failed';
      },
    );
  }

  /** Start (or restart) the track at a buffer offset in seconds. */
  public startAt(offsetSeconds: number): boolean {
    if (this.disposed || this.buffer === null || this.engine === null) return false;
    try {
      this.stopSource();
      const engine = this.engine;
      const buffer = this.buffer;
      const source = engine.createSource(buffer);
      const gain = engine.createGain();
      gain.connect(engine.destination);
      this.appliedGain = this.muted ? 0 : this.volume;
      gain.setGain(this.appliedGain);
      const offset = Math.min(Math.max(0, offsetSeconds), Math.max(0, buffer.duration - 0.05));
      const gen = this.generation + 1;
      this.generation = gen;
      source.onended = (): void => {
        // Manual stops fire onended too — only honor the natural track end.
        if (this.generation === gen && this.state === 'playing' && this.actualTime() >= buffer.duration - 0.3) {
          this.state = 'ready';
          this.source = null;
        }
      };
      source.start(0, offset);
      this.source = source;
      this.gain = gain;
      this.startCtxTime = engine.currentTime;
      this.startOffset = offset;
      this.lastTarget = offset;
      this.state = 'playing';
      return true;
    } catch {
      this.state = 'failed';
      return false;
    }
  }

  /** Pause: stop the source, keep the offset for resume. */
  public pause(): void {
    if (this.state !== 'playing') return;
    try {
      this.pausedOffset = this.actualTime();
      this.stopSource();
      this.state = 'paused';
    } catch {
      this.state = 'failed';
    }
  }

  /** Resume from the pause offset. */
  public resume(): boolean {
    if (this.state !== 'paused') return false;
    return this.startAt(this.pausedOffset);
  }

  /** Deterministic attempt origin (death respawn / R / F4 replay). */
  public restart(): boolean {
    this.pausedOffset = 0;
    return this.startAt(0);
  }

  /** Death/finish cut: short fade + stop; respawn restarts at the origin. */
  public cut(): void {
    if (this.state !== 'playing') return;
    try {
      this.pausedOffset = 0;
      if (this.gain !== null) this.gain.rampToZero(MUSIC_CUT_FADE_SECONDS);
      const source = this.source;
      const engine = this.engine;
      if (source !== null && engine !== null) {
        const t = engine.currentTime;
        try {
          source.stop(t + MUSIC_CUT_FADE_SECONDS * 2);
        } catch {
          // Already stopped.
        }
      }
      this.generation += 1;
      this.state = 'ready';
      this.source = null;
    } catch {
      this.state = 'failed';
    }
  }

  /**
   * Per-frame drift follow (presentation-only): compare audible transport
   * time against the caller-supplied deterministic target. Dead-band
   * ±60 ms: leave alone. Beyond 180 ms: restart at the target (hard
   * resync). Between: report drift, do not seek (no micro-jitter).
   * NEVER alters the simulation — it only restarts audio output.
   */
  public syncToTarget(targetSeconds: number): MusicSyncAction {
    this.lastTarget = targetSeconds;
    if (this.state !== 'playing' || this.engine === null) return 'idle';
    const actual = this.actualTime();
    const drift = actual - targetSeconds;
    if (Math.abs(drift) <= MUSIC_DRIFT_DEADBAND_SECONDS) return 'ok';
    if (Math.abs(drift) >= MUSIC_DRIFT_RESYNC_SECONDS) {
      const resumed = this.startAt(targetSeconds);
      return resumed ? 'resynced' : 'idle';
    }
    return 'drift';
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      if (this.gain !== null) {
        this.appliedGain = muted ? 0 : this.volume;
        this.gain.setGain(this.appliedGain);
      }
    } catch {
      // Presentation-only — ignore.
    }
  }

  public setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    try {
      if (this.gain !== null && !this.muted) {
        this.appliedGain = this.volume;
        this.gain.setGain(this.appliedGain);
      }
    } catch {
      // Presentation-only — ignore.
    }
  }

  /** Decoded buffer duration in seconds (-1 when nothing decoded). */
  public bufferDuration(): number {
    return this.buffer !== null ? this.buffer.duration : -1;
  }

  /** Live AudioContext state ('none' when no engine exists). */
  public audioContextState(): string {
    if (this.engine === null) return 'none';
    try {
      return this.engine.contextState();
    } catch {
      return 'unknown';
    }
  }

  /** Debug/QA probe (cold path): target vs actual vs drift. */
  public probe(): MusicProbe {
    const actual = this.state === 'playing' ? this.actualTime() : this.pausedOffset;
    return {
      state: this.state,
      playing: this.state === 'playing',
      muted: this.muted,
      targetTime: this.lastTarget,
      actualTime: actual,
      driftMs: (actual - this.lastTarget) * 1000,
      volume: this.volume,
      gain: this.state === 'playing' ? this.appliedGain : 0,
      bufferDuration: this.bufferDuration(),
      contextState: this.audioContextState(),
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.stopSource();
      this.engine?.close();
    } catch {
      // Harmless.
    }
    this.engine = null;
    this.buffer = null;
    this.state = 'idle';
  }

  private actualTime(): number {
    if (this.engine === null || this.buffer === null) return this.startOffset;
    const t = this.startOffset + (this.engine.currentTime - this.startCtxTime);
    return Math.min(Math.max(0, t), Math.max(0, this.buffer.duration));
  }

  private stopSource(): void {
    this.generation += 1;
    const source = this.source;
    this.source = null;
    if (source !== null) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // Already stopped — harmless.
      }
    }
    const gain = this.gain;
    this.gain = null;
    if (gain !== null) {
      try {
        gain.disconnect();
      } catch {
        // Harmless.
      }
    }
  }
}

/** Clamp helper shared by callers restarting at deterministic targets. */
export const clampMusicTarget = (targetSeconds: number): number =>
  Math.min(Math.max(0, targetSeconds), GRAVITY_LESSONS_DURATION);
