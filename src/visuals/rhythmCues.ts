import type { LevelDefinition } from '../level/levelDefinition';

/**
 * Beat-ready rhythm cues (M7.1) — deterministic presentation-only metadata
 * for FUTURE music synchronization. No audio ships in M7.1: no playback, no
 * BPM clock, no beat detector, no latency calibration.
 *
 * A cue binds a semantic musical role to an authored forward position `z`
 * (world units, same axis as `VisualSection.startZ`). Because the game
 * auto-forwards deterministically and speed portals are level data, future
 * tooling can map (cue.z → simulation time → music beat/bar/drop) once a
 * song's BPM/offset/structure is known — without redesigning levels.
 *
 * Rules (pinned by test):
 * - Deterministic and presentation-only: same z → same cue, every machine.
 * - Position-driven only: no wall-clock timers, no Date.now(), no
 *   performance.now() anywhere in cue identity.
 * - Never stored in ReplayV1; never read by GameSimulation, collision, or
 *   the level fingerprint (like `theme`/`visualSequence`/`visual`/`mount`).
 * - The visual timeline does NOT consume cues at runtime (no competing
 *   trigger system): sections and cues are authored to coincide (e.g. a
 *   `drop` cue at the 2x portal inside the sprint section), but each system
 *   resolves independently from z.
 */

/** Semantic musical role a future song can map to a beat/bar/drop. */
export type RhythmCueRole =
  | 'intro'
  | 'accent'
  | 'build'
  | 'sectionChange'
  | 'gravityHit'
  | 'padHit'
  | 'orbHit'
  | 'speedHit'
  | 'drop'
  | 'climax'
  | 'release'
  | 'finish';

/** ONE authored beat-ready marker: a role at a forward position. */
export interface RhythmCue {
  /** Stable identifier (debug/QA). */
  id: string;
  /** World Z where the cue becomes active (last cue with z <= playerZ wins). */
  z: number;
  /** Semantic role for future music mapping. */
  role: RhythmCueRole;
}

/** Cold-path sorted copy of a level's cues (evaluation assumes z order). */
export type PreparedRhythmCues = readonly RhythmCue[];

/** Prepare a level's optional cues for evaluation: sorted copy by z. */
export const prepareRhythmCues = (
  def: Pick<LevelDefinition, 'rhythmCues'>,
): PreparedRhythmCues => {
  const cues = def.rhythmCues ?? [];
  return [...cues].sort((a, b) => a.z - b.z);
};

/** Active cue at forward position `z` (null before the first cue). */
export const cueAtZ = (
  cues: PreparedRhythmCues,
  z: number,
): RhythmCue | null => {
  let active: RhythmCue | null = null;
  for (const cue of cues) {
    if (cue.z <= z) active = cue;
    else break;
  }
  return active;
};

/** Active cue id at `z` (`null` before the first cue — probe-friendly). */
export const cueIdAtZ = (
  cues: PreparedRhythmCues,
  z: number,
): string | null => cueAtZ(cues, z)?.id ?? null;
