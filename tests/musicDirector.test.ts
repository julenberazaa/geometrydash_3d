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

  public start(_when: number, offset: number): void {
    this.startedAtOffset = offset;
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

  public setGain(value: number): void {
    this.level = value;
  }

  public rampToZero(_fadeSeconds: number): void {
    this.ramped = true;
    this.level = 0;
  }

  public connect(_destination: unknown): void {}
  public disconnect(): void {}
}

class FakeEngine implements AudioEngineLike {
  public now = 0;
  public resumed = false;
  public closed = false;
  public decoded = false;
  public sources: FakeSource[] = [];
  public gains: FakeGain[] = [];
  public buffer: AudioBufferLike = { duration: 121.574 };
  public bytes: ArrayBuffer | null = new ArrayBuffer(8);
  public failDecode = false;

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
    return source;
  }

  public createGain(): AudioGainLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  public get destination(): unknown {
    return {};
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
