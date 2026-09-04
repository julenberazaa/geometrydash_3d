/**
 * Replay format V1 (M5): explicit VERSIONED container for one completed
 * attempt — the per-tick PHYSICAL input tape plus the evidence needed to
 * verify a replayed run (per-tick authoritative state hashes, final state
 * hash, terminal outcome).
 *
 * JSON is the serialization; the input tape itself is compact numeric
 * bitfields (see replayInputCodec). Serialization round-trips EXACTLY and
 * malformed input is REJECTED, never trusted.
 *
 * Ruleset version discipline: any intentional change to deterministic
 * gameplay semantics that invalidates old tapes must deliberately bump
 * REPLAY_RULESET_VERSION so old replays are rejected cleanly instead of
 * silently diverging. Never auto-derived from git data. Build timestamps or
 * any other nondeterministic metadata must NOT enter this format.
 */

import { SIMULATION_HZ } from '../core/constants';
import { isValidReplayFrame } from './replayInputCodec';

export const REPLAY_SCHEMA_VERSION = 1;
export const REPLAY_RULESET_VERSION = 1;

const HASH_PATTERN = /^[0-9a-f]{16}$/;

export type ReplayTerminalStatus = 'finished' | 'dead';

export interface ReplayOutcome {
  status: ReplayTerminalStatus;
  /** Death cause when status is 'dead' (diagnostics; null when finished). */
  deathCause: 'hazard' | 'frontImpact' | 'void' | null;
}

/** One recorded attempt: input tape + verification evidence. */
export interface ReplayV1 {
  schemaVersion: number;
  rulesetVersion: number;
  /** Fixed simulation frequency the tape was recorded at. */
  simulationHz: number;
  /** Level the tape was recorded against (playback must resolve THE level). */
  levelId: string;
  /** Canonical gameplay-content fingerprint of that level (see levelFingerprint). */
  levelFingerprint: string;
  /** Number of recorded fixed ticks (= inputFrames.length = stateHashes.length). */
  frameCount: number;
  /** Per-tick physical input bitfields. */
  inputFrames: number[];
  /** Per-tick authoritative state hashes (verification evidence). */
  stateHashes: string[];
  /** Terminal outcome of the recorded attempt. */
  outcome: ReplayOutcome;
  /** Final authoritative state hash (=== stateHashes[frameCount - 1]). */
  finalStateHash: string;
}

export type ReplayParseResult =
  | { ok: true; replay: ReplayV1 }
  | { ok: false; reason: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Structural validation of an already-parsed replay-shaped object. */
export const validateReplayObject = (value: unknown): ReplayParseResult => {
  if (!isPlainObject(value)) return { ok: false, reason: 'replay is not an object' };
  const r = value;

  if (r.schemaVersion !== REPLAY_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unsupported replay schemaVersion ${JSON.stringify(r.schemaVersion)} (expected ${String(REPLAY_SCHEMA_VERSION)})`,
    };
  }
  if (r.rulesetVersion !== REPLAY_RULESET_VERSION) {
    return {
      ok: false,
      reason: `replay rulesetVersion ${JSON.stringify(r.rulesetVersion)} does not match ruleset ${String(REPLAY_RULESET_VERSION)}`,
    };
  }
  if (r.simulationHz !== SIMULATION_HZ) {
    return {
      ok: false,
      reason: `replay simulationHz ${JSON.stringify(r.simulationHz)} does not match simulation ${String(SIMULATION_HZ)} Hz`,
    };
  }
  if (typeof r.levelId !== 'string' || r.levelId.length === 0) {
    return { ok: false, reason: 'replay levelId missing' };
  }
  if (typeof r.levelFingerprint !== 'string' || !HASH_PATTERN.test(r.levelFingerprint)) {
    return { ok: false, reason: 'replay levelFingerprint missing or malformed' };
  }
  if (!Array.isArray(r.inputFrames) || r.inputFrames.length === 0) {
    return { ok: false, reason: 'replay inputFrames missing or empty' };
  }
  // Validated locals: every element is proven a compact frame below, so the
  // rest of this function never needs type assertions on the tape arrays.
  const rawFrames: unknown[] = r.inputFrames;
  const inputFrames: number[] = rawFrames.filter(isValidReplayFrame);
  if (inputFrames.length !== rawFrames.length) {
    const badFrame = rawFrames.find((f) => !isValidReplayFrame(f));
    return { ok: false, reason: `replay input frame invalid: ${JSON.stringify(badFrame)}` };
  }
  if (!Array.isArray(r.stateHashes) || r.stateHashes.length !== inputFrames.length) {
    return { ok: false, reason: 'replay stateHashes missing or length mismatch' };
  }
  const rawHashes: unknown[] = r.stateHashes;
  const stateHashes: string[] = rawHashes.filter(
    (h): h is string => typeof h === 'string' && HASH_PATTERN.test(h),
  );
  if (stateHashes.length !== rawHashes.length) {
    return { ok: false, reason: 'replay state hash malformed' };
  }
  const frameCount = r.frameCount;
  if (typeof frameCount !== 'number' || !Number.isInteger(frameCount) || frameCount !== inputFrames.length) {
    return { ok: false, reason: 'replay frameCount missing or mismatched' };
  }
  const outcome = r.outcome;
  if (!isPlainObject(outcome)) return { ok: false, reason: 'replay outcome missing' };
  if (outcome.status !== 'finished' && outcome.status !== 'dead') {
    return { ok: false, reason: 'replay outcome status invalid' };
  }
  const deathCause = outcome.deathCause;
  const validCause =
    deathCause === null || deathCause === 'hazard' || deathCause === 'frontImpact' || deathCause === 'void';
  if (!validCause) return { ok: false, reason: 'replay outcome deathCause invalid' };
  if (outcome.status === 'dead' && typeof deathCause !== 'string') {
    return { ok: false, reason: 'dead replay outcome requires a deathCause' };
  }
  if (outcome.status === 'finished' && deathCause !== null) {
    return { ok: false, reason: 'finished replay outcome must not carry a deathCause' };
  }
  const finalStateHash = r.finalStateHash;
  if (typeof finalStateHash !== 'string' || !HASH_PATTERN.test(finalStateHash)) {
    return { ok: false, reason: 'replay finalStateHash missing or malformed' };
  }
  const lastHash: string | undefined = stateHashes[stateHashes.length - 1];
  if (finalStateHash !== lastHash) {
    return { ok: false, reason: 'replay finalStateHash does not match the last per-tick hash' };
  }

  return {
    ok: true,
    replay: {
      schemaVersion: r.schemaVersion,
      rulesetVersion: r.rulesetVersion,
      simulationHz: r.simulationHz,
      levelId: r.levelId,
      levelFingerprint: r.levelFingerprint,
      frameCount,
      inputFrames,
      stateHashes,
      outcome: {
        status: outcome.status,
        deathCause: deathCause,
      },
      finalStateHash,
    },
  };
};

/** Serialize a replay to its JSON form. */
export const serializeReplay = (replay: ReplayV1): string => JSON.stringify(replay, null, 2);

/** Parse + validate a serialized replay. Malformed input is rejected. */
export const parseReplay = (json: string): ReplayParseResult => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return { ok: false, reason: 'replay JSON is not parseable' };
  }
  return validateReplayObject(value);
};
