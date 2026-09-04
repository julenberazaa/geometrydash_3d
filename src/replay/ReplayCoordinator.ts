/**
 * ReplayCoordinator (M5): recording + playback orchestration, living ENTIRELY
 * ABOVE GameSimulation.
 *
 *   LIVE:    InputSystem → coordinator → GameSimulation.update(input)
 *   PLAYBACK: ReplayV1 tape → coordinator → GameSimulation.update(input)
 *
 * The simulation never knows whether its input came from the keyboard, a
 * test, or a replay tape — there is no `if (replayMode)` inside
 * GameSimulation. The coordinator feeds exactly one recorded physical input
 * frame per fixed tick, computes the authoritative state fingerprint after
 * every tick, and compares it against the tape's expected hash — diverging
 * immediately (never silently continuing, never correcting/snapping the
 * simulation toward recorded states; no recorded transforms even exist).
 *
 * Recording lifecycle (one replay = one attempt):
 *   - recording begins at the first running tick of a live attempt
 *     (fresh start or post-respawn);
 *   - one input frame is captured before every simulation update and one
 *     authoritative state hash after it;
 *   - the attempt finalizes when it first becomes dead or finished;
 *   - a manual R during a live UNFINISHED attempt discards the partial tape;
 *   - death-hold/auto-respawn frames are not part of the completed tape.
 */

import type { PhysicalInputSnapshot } from '../input/InputSystem';
import { decodeReplayFrame, encodeReplayFrame } from './replayInputCodec';
import { computeStateFingerprint } from './stateFingerprint';
import {
  REPLAY_RULESET_VERSION,
  REPLAY_SCHEMA_VERSION,
  validateReplayObject,
  serializeReplay,
  type ReplayV1,
} from './replayFormat';
import { computeLevelFingerprint } from './levelFingerprint';
import type { GameSimulation } from '../game/GameSimulation';
import { makeIdlePhysicalSnapshot } from '../input/InputSystem';
import { SIMULATION_HZ } from '../core/constants';

export type ReplayMode = 'live' | 'replay';

export type ReplayVerification =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'pass' }
  | { kind: 'diverged'; tick: number; expectedHash: string; actualHash: string }
  | { kind: 'rejected'; reason: string };

export type ReplayStartResult = { ok: true } | { ok: false; reason: string };

export class ReplayCoordinator {
  private readonly sim: GameSimulation;
  /** Canonical gameplay fingerprint of the loaded level (set once). */
  public readonly levelFingerprint: string;

  public mode: ReplayMode = 'live';
  /** Most recent COMPLETED live attempt tape (never written by playback). */
  public lastReplay: ReplayV1 | null = null;
  public verification: ReplayVerification = { kind: 'idle' };

  /** Tape currently being recorded (undefined = not recording). */
  private recording: {
    levelId: string;
    levelFingerprint: string;
    inputFrames: number[];
    stateHashes: string[];
  } | null = null;

  /** Active playback tape + playhead (ticks consumed). */
  private playback: ReplayV1 | null = null;
  private playhead = 0;
  /** Last computed authoritative state hash (debug observability). */
  public lastStateHash: string | null = null;

  constructor(sim: GameSimulation) {
    this.sim = sim;
    this.levelFingerprint = computeLevelFingerprint(sim.level.def);
  }

  // ------------------------------------------------------------------ live

  /** Per fixed tick, BEFORE the simulation update: arm a fresh recording at
   *  the start of a live attempt (fresh start or post-respawn). */
  public beforeSimTick(): void {
    if (this.mode !== 'live') return;
    if (this.recording !== null) return;
    if (this.sim.status !== 'running') return;
    this.recording = {
      levelId: this.sim.level.def.id,
      levelFingerprint: this.levelFingerprint,
      inputFrames: [],
      stateHashes: [],
    };
  }

  /**
   * Per fixed tick: choose the input the simulation will consume.
   * LIVE: records the live snapshot (one frame per tick) and passes it
   * through untouched. REPLAY: returns the recorded frame for this tick —
   * live keyboard input is consumed as simulation input NOWHERE.
   */
  public getInputForTick(liveInput: Readonly<PhysicalInputSnapshot>): Readonly<PhysicalInputSnapshot> {
    if (this.mode === 'replay' && this.playback !== null) {
      if (this.playhead >= this.playback.frameCount) return makeIdlePhysicalSnapshot();
      const frame = this.playback.inputFrames[this.playhead] ?? 0;
      return decodeReplayFrame(frame);
    }
    if (this.recording !== null) {
      this.recording.inputFrames.push(encodeReplayFrame(liveInput));
    }
    return liveInput;
  }

  /** Per fixed tick, AFTER the simulation update. */
  public afterSimTick(): void {
    if (this.mode === 'replay' && this.playback !== null) {
      this.verifyPlaybackTick();
      return;
    }
    if (this.recording === null) return;
    const hash = computeStateFingerprint(this.sim);
    this.lastStateHash = hash;
    this.recording.stateHashes.push(hash);
    if (this.sim.status !== 'running') {
      this.finalizeRecording();
    }
  }

  private finalizeRecording(): void {
    const tape = this.recording;
    this.recording = null;
    if (tape === null || tape.inputFrames.length === 0) return;
    const status = this.sim.status;
    const validated = validateReplayObject({
      schemaVersion: REPLAY_SCHEMA_VERSION,
      rulesetVersion: REPLAY_RULESET_VERSION,
      simulationHz: SIMULATION_HZ,
      levelId: tape.levelId,
      levelFingerprint: tape.levelFingerprint,
      frameCount: tape.inputFrames.length,
      inputFrames: tape.inputFrames,
      stateHashes: tape.stateHashes,
      outcome: {
        status,
        deathCause: status === 'dead' ? this.sim.deathCause : null,
      },
      finalStateHash: tape.stateHashes[tape.stateHashes.length - 1] ?? '',
    });
    if (!validated.ok) return; // defensive: a well-formed recording always validates
    this.lastReplay = validated.replay;
  }

  /** Manual restart during a live UNFINISHED attempt: discard the partial tape. */
  public discardRecording(): void {
    this.recording = null;
    this.verification = { kind: 'idle' };
  }

  // --------------------------------------------------------------- playback

  /**
   * Begin playback of a replay (parsed or raw). Validates schema, ruleset
   * version, level id and level fingerprint BEFORE any playback happens,
   * then returns the simulation to the tape's deterministic initial state
   * (one respawn: every fingerprinted field resets to the level start).
   *
   * Any partial LIVE recording is discarded: a playback is a new attempt
   * context, and the stale pre-playback inputs must never leak into a later
   * finalized tape (they would otherwise overwrite lastReplay with a hybrid
   * of pre-playback live frames and post-playback ticks).
   */
  public startReplay(candidate: unknown): ReplayStartResult {
    if (this.mode === 'replay') {
      return { ok: false, reason: 'a replay is already active' };
    }
    const parsed = validateReplayObject(candidate);
    if (!parsed.ok) {
      this.verification = { kind: 'rejected', reason: parsed.reason };
      return { ok: false, reason: parsed.reason };
    }
    const replay = parsed.replay;
    if (replay.levelId !== this.sim.level.def.id) {
      const reason = `replay was recorded on level "${replay.levelId}" but the loaded level is "${this.sim.level.def.id}"`;
      this.verification = { kind: 'rejected', reason };
      return { ok: false, reason };
    }
    if (replay.levelFingerprint !== this.levelFingerprint) {
      const reason = `replay level fingerprint ${replay.levelFingerprint} does not match the loaded level (${this.levelFingerprint})`;
      this.verification = { kind: 'rejected', reason };
      return { ok: false, reason };
    }
    this.recording = null;
    this.sim.restart();
    this.playback = replay;
    this.playhead = 0;
    this.mode = 'replay';
    this.verification = { kind: 'running' };
    return { ok: true };
  }

  private verifyPlaybackTick(): void {
    const replay = this.playback;
    if (replay === null) return;
    const hash = computeStateFingerprint(this.sim);
    this.lastStateHash = hash;
    const expected = replay.stateHashes[this.playhead];
    if (expected !== undefined && hash !== expected) {
      this.verification = {
        kind: 'diverged',
        tick: this.playhead,
        expectedHash: expected,
        actualHash: hash,
      };
      this.endPlayback();
      return;
    }
    this.playhead += 1;
    if (this.playhead >= replay.frameCount) {
      // Every per-tick hash matched (status + death cause are INSIDE the
      // state fingerprint), so the terminal outcome is already proven; the
      // explicit outcome check below is defensive belt-and-braces.
      const outcomeMatches =
        (replay.outcome.status === 'finished' && this.sim.status === 'finished') ||
        (replay.outcome.status === 'dead' && this.sim.status === 'dead');
      this.verification = outcomeMatches
        ? { kind: 'pass' }
        : {
            kind: 'diverged',
            tick: replay.frameCount - 1,
            expectedHash: replay.finalStateHash,
            actualHash: hash,
          };
      this.endPlayback();
    }
  }

  private endPlayback(): void {
    this.playback = null;
    this.playhead = 0;
    this.mode = 'live';
  }

  /**
   * Abort an active playback (debug key / R). The simulation stays where it
   * is, and any partial live recording is discarded so the NEXT live tick
   * arms a fresh tape (a stale pre-playback partial must never resume).
   */
  public abortReplay(): void {
    if (this.mode !== 'replay') return;
    this.endPlayback();
    this.recording = null;
    this.verification = { kind: 'idle' };
  }

  // ----------------------------------------------------------- observability

  public get isRecording(): boolean {
    return this.recording !== null;
  }

  public get isPlaying(): boolean {
    return this.mode === 'replay';
  }

  /** Ticks consumed of the active (or most recent) playback. */
  public get replayTick(): number {
    return this.playhead;
  }

  public get replayFrameCount(): number | null {
    return this.playback?.frameCount ?? null;
  }

  /** HUD badge text for the current replay state (null = no badge). */
  public get hudBadge(): string | null {
    switch (this.verification.kind) {
      case 'running':
        return 'REPLAY';
      case 'pass':
        return 'REPLAY VERIFIED';
      case 'diverged':
        return 'REPLAY DIVERGED';
      case 'rejected':
        return 'REPLAY REJECTED';
      default:
        return null;
    }
  }

  /** Serialized most-recent completed attempt (QA export), or null. */
  public exportLastReplay(): string | null {
    return this.lastReplay === null ? null : serializeReplay(this.lastReplay);
  }
}
