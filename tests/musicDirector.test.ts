import { describe, expect, it } from 'vitest';
import {
  MUSIC_DRIFT_DEADBAND_SECONDS,
  MUSIC_DRIFT_RESYNC_SECONDS,
  MusicDirector,
  type AudioBufferLike,
  type AudioEngineLike,
  type AudioGainLike,
  type AudioSourceLike,
} from '../src/audio/MusicDirector';
import { GRAVITY_LESSONS_DURATION, MUSIC_DEFAULT_VOLUME } from '../src/audio/musicTrack';

/**
 * M9 music-transport contract (presentation only): the MusicDirector state
 * machine through a fake engine — load/readiness, play/pause/resume/
 * restart/cut, mute, dead-band drift follow, hard resync, and total
 * silence-on-failure. No real AudioContext is ever constructed here.
 */

class FakeSource implements AudioSourceLike {
  public onended: (() => void) | null = null;
  public startedAtOffset: number | null = null;
  public stopped = false;
  public disconnected = false;
  /** Test hook: fired inside start (engine wires the event log here). */
  public onStart: (() => void) | null = null;

  public start(_when: number, offset: number): void {
    this.startedAtOffset = offset;
    this.onStart?.();
  }

  public stop(_when?: number): void {
    this.stopped = true;
  }

  public disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGain implements AudioGainLike {
  public level = -1;
  public ramped = false;
  public connectedTo: unknown = null;
  public disconnected = false;
  /** Test hook: fired inside connect (engine wires the event log here). */
  public onConnect: (() => void) | null = null;

  public setGain(value: number): void {
    this.level = value;
  }

  public rampToZero(_fadeSeconds: number): void {
    this.ramped = true;
    this.level = 0;
  }

  public connect(destination: unknown): void {
    this.connectedTo = destination;
    this.onConnect?.();
  }

  public disconnect(): void {
    this.disconnected = true;
  }
}

class FakeEngine implements AudioEngineLike {
  public now = 0;
  public resumed = false;
  public closed = false;
  public decoded = false;
  public sources: FakeSource[] = [];
  public gains: FakeGain[] = [];
  /**
   * M9.2 structural graph log: every wiring event in call order, so the
   * test can prove create → connect(source→gain) → connect(gain→dest) →
   * start instead of merely asserting `state === 'playing'`.
   */
  public events: string[] = [];
  public connectCalls: { source: AudioSourceLike; gain: AudioGainLike }[] = [];
  public buffer: AudioBufferLike = { duration: 121.574 };
  public bytes: ArrayBuffer | null = new ArrayBuffer(8);
  public failDecode = false;
  /** When true, wiring throws (simulates the disconnected-graph bug). */
  public failConnect = false;
  public readonly destinationObject: unknown = {};

  public get currentTime(): number {
    return this.now;
  }

  public resume(): void {
    this.resumed = true;
  }

  public contextState(): string {
    return this.closed ? 'closed' : 'running';
  }

  public createSource(buffer: AudioBufferLike): AudioSourceLike {
    expect(buffer).toBe(this.buffer);
    const source = new FakeSource();
    this.sources.push(source);
    this.events.push('createSource');
    source.onStart = (): void => {
      this.events.push('start');
    };
    return source;
  }

  public createGain(): AudioGainLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    this.events.push('createGain');
    gain.onConnect = (): void => {
      this.events.push('gainConnect');
    };
    return gain;
  }

  public connectSourceToGain(source: AudioSourceLike, gain: AudioGainLike): void {
    if (this.failConnect) throw new Error('fake wiring failure');
    this.connectCalls.push({ source, gain });
    this.events.push('sourceConnect');
  }

  public get destination(): unknown {
    return this.destinationObject;
  }

  public async decode(_data: ArrayBuffer): Promise<AudioBufferLike> {
    this.decoded = true;
    await Promise.resolve();
    if (this.failDecode) throw new Error('decode boom');
    return this.buffer;
  }

  public async fetchBytes(_url: string): Promise<ArrayBuffer> {
    await Promise.resolve();
    if (this.bytes === null) throw new Error('fetch boom');
    return this.bytes;
  }

  public close(): void {
    this.closed = true;
  }
}

const readyDirector = async (): Promise<{ director: MusicDirector; engine: FakeEngine }> => {
  const engine = new FakeEngine();
  const director = new MusicDirector('/audio/Gravity_Lessons.mp3', engine);
  director.preload();
  // Flush the preload microtask chain (fake fetch resolves immediately).
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(await director.ensure()).toBe(true);
  expect(director.transportState).toBe('ready');
  return { director, engine };
};

describe('music transport (M9 MusicDirector)', () => {
  it('loads then plays from the attempt origin', async () => {
    const { director, engine } = await readyDirector();
    expect(engine.resumed).toBe(true);
    expect(director.startAt(0)).toBe(true);
    expect(director.isPlaying).toBe(true);
    engine.now += 1.5;
    const probe = director.probe();
    expect(probe.playing).toBe(true);
    expect(probe.actualTime).toBeCloseTo(1.5, 9);
  });

  it('pauses with offset record and resumes from it', async () => {
    const { director, engine } = await readyDirector();
    director.startAt(0);
    engine.now += 10;
    director.pause();
    expect(director.transportState).toBe('paused');
    engine.now += 5;
    expect(director.probe().actualTime).toBeCloseTo(10, 9);
    expect(director.resume()).toBe(true);
    expect(engine.sources[1]?.startedAtOffset).toBeCloseTo(10, 9);
    engine.now += 2;
    expect(director.probe().actualTime).toBeCloseTo(12, 9);
  });

  it('restarts at the origin and cuts on death', async () => {
    const { director, engine } = await readyDirector();
    director.startAt(0);
    engine.now += 40;
    expect(director.restart()).toBe(true);
    expect(engine.sources[1]?.startedAtOffset).toBe(0);
    engine.now += 1;
    director.cut();
    expect(director.isPlaying).toBe(false);
    expect(director.probe().actualTime).toBe(0);
    expect(director.restart()).toBe(true);
    expect(director.isPlaying).toBe(true);
  });

  it('follows deterministic targets with a dead-band (no micro-seek jitter)', async () => {
    const { director, engine } = await readyDirector();
    director.startAt(0);
    const sourcesBefore = engine.sources.length;
    // Small drift: leave alone.
    engine.now = 10 + MUSIC_DRIFT_DEADBAND_SECONDS / 2;
    expect(director.syncToTarget(10)).toBe('ok');
    expect(engine.sources.length).toBe(sourcesBefore);
    // Moderate drift: report, but do not seek.
    engine.now = 10 + (MUSIC_DRIFT_DEADBAND_SECONDS + MUSIC_DRIFT_RESYNC_SECONDS) / 2;
    expect(director.syncToTarget(10)).toBe('drift');
    expect(engine.sources.length).toBe(sourcesBefore);
    // Meaningful drift: hard resync at the deterministic target.
    engine.now = 10 + MUSIC_DRIFT_RESYNC_SECONDS + 0.05;
    expect(director.syncToTarget(10)).toBe('resynced');
    expect(engine.sources.length).toBe(sourcesBefore + 1);
    expect(engine.sources[engine.sources.length - 1]?.startedAtOffset).toBeCloseTo(10, 9);
  });

  it('stays idle off the playing state (pause/death hold never seeks)', async () => {
    const { director } = await readyDirector();
    expect(director.syncToTarget(30)).toBe('idle');
    director.startAt(0);
    director.pause();
    expect(director.syncToTarget(30)).toBe('idle');
  });

  it('mutes presentation-only (transport keeps running)', async () => {
    const { director, engine } = await readyDirector();
    director.startAt(0);
    director.setMuted(true);
    expect(director.isMuted).toBe(true);
    engine.now += 3;
    expect(director.probe().actualTime).toBeCloseTo(3, 9);
    director.setMuted(false);
    expect(director.isMuted).toBe(false);
  });

  it('never throws without an engine (headless silence is fine)', async () => {
    const director = new MusicDirector('audio/x.mp3', null, () => null);
    expect(await director.ensure()).toBe(false);
    expect(director.transportState).toBe('failed');
    expect(director.startAt(0)).toBe(false);
    expect(director.restart()).toBe(false);
    expect(director.resume()).toBe(false);
    expect(director.syncToTarget(5)).toBe('idle');
    const probe = director.probe();
    expect(probe.playing).toBe(false);
    director.pause();
    director.cut();
    director.setMuted(true);
    director.dispose();
  });

  it('fails silently on decode errors (gameplay never blocks)', async () => {
    const engine = new FakeEngine();
    engine.failDecode = true;
    const director = new MusicDirector('audio/x.mp3', engine);
    director.preload();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(await director.ensure()).toBe(false);
    expect(director.transportState).toBe('failed');
    expect(director.startAt(0)).toBe(false);
  });

  it('M9.1: ensure() retries a failed preload fetch instead of staying dead', async () => {
    const engine = new FakeEngine();
    engine.bytes = null; // first fetch fails
    const director = new MusicDirector('/audio/Gravity_Lessons.mp3', engine);
    director.preload();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(await director.ensure()).toBe(false);
    expect(director.transportState).toBe('failed');
    // Bytes arrive later (retry path): the same director recovers.
    engine.bytes = new ArrayBuffer(8);
    expect(await director.ensure()).toBe(true);
    expect(director.transportState).toBe('ready');
    expect(director.bufferDuration()).toBeCloseTo(GRAVITY_LESSONS_DURATION, 3);
  });

  it('M9.1: ensure() retries a failed decode (bytes survive for the retry)', async () => {
    const engine = new FakeEngine();
    engine.failDecode = true;
    const director = new MusicDirector('/audio/x.mp3', engine);
    expect(await director.ensure()).toBe(false);
    engine.failDecode = false;
    expect(await director.ensure()).toBe(true);
    expect(director.transportState).toBe('ready');
  });

  it('M9.1: beginGesture creates + resumes the engine synchronously', () => {
    const engine = new FakeEngine();
    const director = new MusicDirector('/audio/x.mp3', null, () => engine);
    director.beginGesture();
    expect(engine.resumed).toBe(true);
    expect(director.audioContextState()).toBe('running');
  });

  it('M9.2: startAt wires source→gain→destination in order before start', async () => {
    const { director, engine } = await readyDirector();
    expect(director.startAt(0)).toBe(true);
    // The exact audible output path: source into gain, gain into the
    // destination, and only then start. Order matters — starting an
    // unwired source is the M9/M9.1 silence signature.
    expect(engine.events).toEqual([
      'createSource',
      'createGain',
      'sourceConnect',
      'gainConnect',
      'start',
    ]);
    expect(engine.connectCalls).toHaveLength(1);
    expect(engine.connectCalls[0]?.source).toBe(engine.sources[0]);
    expect(engine.connectCalls[0]?.gain).toBe(engine.gains[0]);
    expect(engine.gains[0]?.connectedTo).toBe(engine.destinationObject);
    const probe = director.probe();
    expect(probe.sourceCreated).toBe(true);
    expect(probe.sourceConnected).toBe(true);
    expect(probe.gainConnected).toBe(true);
    expect(probe.effectiveGain).toBe(MUSIC_DEFAULT_VOLUME);
    expect(probe.graphReady).toBe(true);
    expect(director.graphReady()).toBe(true);
  });

  it('M9.2: a wiring failure never leaves a silent `playing` transport', async () => {
    const engine = new FakeEngine();
    const director = new MusicDirector('/audio/Gravity_Lessons.mp3', engine);
    director.preload();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(await director.ensure()).toBe(true);
    engine.failConnect = true;
    // The old code returned true here with `playing` while nothing was
    // connected — the new contract fails loud instead.
    expect(director.startAt(0)).toBe(false);
    expect(director.transportState).toBe('failed');
    expect(director.isPlaying).toBe(false);
    expect(director.graphReady()).toBe(false);
    const probe = director.probe();
    expect(probe.sourceConnected).toBe(false);
    expect(probe.gainConnected).toBe(false);
    expect(probe.graphReady).toBe(false);
  });

  it('M9.2: graphReady drops when the voice is torn down or muted', async () => {
    const { director } = await readyDirector();
    director.startAt(0);
    expect(director.graphReady()).toBe(true);
    director.setMuted(true);
    expect(director.graphReady()).toBe(false);
    director.setMuted(false);
    expect(director.graphReady()).toBe(true);
    director.pause();
    expect(director.graphReady()).toBe(false);
    expect(director.probe().sourceConnected).toBe(false);
    director.resume();
    expect(director.graphReady()).toBe(true);
    director.cut();
    expect(director.graphReady()).toBe(false);
    expect(director.probe().gainConnected).toBe(false);
  });

  it('M9.1: one central music volume + real-state probes', async () => {
    const { director, engine } = await readyDirector();
    expect(director.probe().volume).toBe(MUSIC_DEFAULT_VOLUME);
    expect(director.probe().volume).toBeGreaterThan(0.5);
    expect(director.bufferDuration()).toBeCloseTo(GRAVITY_LESSONS_DURATION, 3);
    expect(director.audioContextState()).toBe('running');
    expect(director.startAt(0)).toBe(true);
    expect(engine.gains[0]?.level).toBe(MUSIC_DEFAULT_VOLUME);
    expect(director.probe().gain).toBe(MUSIC_DEFAULT_VOLUME);
    director.setMuted(true);
    expect(director.probe().gain).toBe(0);
    expect(engine.gains[0]?.level).toBe(0);
    director.setMuted(false);
    expect(director.probe().gain).toBe(MUSIC_DEFAULT_VOLUME);
  });
});
