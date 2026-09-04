/**
 * Level registry (M5): id -> LevelDefinition catalog. The application selects
 * content through this registry — no engine or bootstrap file hardcodes a
 * level. Adding a level = adding a data file + one registry entry + zero
 * engine changes.
 */

import type { LevelDefinition } from '../level/levelDefinition';
import { TEST_LEVEL } from './levels/testLevel01';
import { VALIDATION_LEVEL_02 } from './levels/validationLevel02';

export const DEFAULT_LEVEL_ID = TEST_LEVEL.id;

const LEVELS: readonly LevelDefinition[] = [TEST_LEVEL, VALIDATION_LEVEL_02];

const REGISTRY: ReadonlyMap<string, LevelDefinition> = new Map(
  LEVELS.map((level) => [level.id, level]),
);

/** All registered level ids (QA/debug). */
export const registeredLevelIds = (): string[] => LEVELS.map((l) => l.id);

export const getLevel = (id: string): LevelDefinition | undefined => REGISTRY.get(id);

export interface LevelResolution {
  level: LevelDefinition;
  /** Whether the requested id resolved; false = explicit fallback to default. */
  ok: boolean;
  requestedId: string | null;
  /** Visible/logged fallback reason when ok is false. */
  reason: string | null;
}

/**
 * Resolve a requested level id (e.g. the `?level=` query parameter).
 * A missing id selects the default. An UNKNOWN id falls back EXPLICITLY to
 * the default with a returned reason (the caller must surface it) — content
 * is never silently substituted.
 */
export const resolveLevel = (requestedId: string | null | undefined): LevelResolution => {
  if (requestedId === null || requestedId === undefined || requestedId === '') {
    return { level: REGISTRY.get(DEFAULT_LEVEL_ID) ?? TEST_LEVEL, ok: true, requestedId: null, reason: null };
  }
  const found = REGISTRY.get(requestedId);
  if (found) {
    return { level: found, ok: true, requestedId, reason: null };
  }
  return {
    level: REGISTRY.get(DEFAULT_LEVEL_ID) ?? TEST_LEVEL,
    ok: false,
    requestedId,
    reason: `unknown level id "${requestedId}" — falling back to default level "${DEFAULT_LEVEL_ID}"`,
  };
};
