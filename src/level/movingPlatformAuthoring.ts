import type { LevelDefinition, MovingPlatformDef } from './levelDefinition';
import { platformPeakSpeed } from '../game/movingPlatformSystem';

/**
 * Moving-platform authoring contract (M8.6): ferries stay readable, fair
 * and bounded. Returns human-readable violations (empty = clean), same
 * shape as `validateLavaAuthoring` / `validatePortalBounds`.
 *
 * Rules:
 * 1. At most MAX_MOVING_PLATFORMS platforms per level (bounded count).
 * 2. Unique stable ids (support ids derive from them).
 * 3. Axis is lateral ('x') or vertical ('y') — never forward.
 * 4. Positive landable volume (half extents ≥ 1 on X/Y, non-degenerate Z).
 * 5. Sane timing: period ≥ 60 ticks, amplitude ≥ 0.5, phase ≥ 0.
 * 6. Peak travel speed stays below cruise readability (≤ 0.12 u/tick —
 *    a ferry must never outrun the Cube's own forward speed).
 */
export const MAX_MOVING_PLATFORMS = 8;
/** Peak platform travel speed readability cap (world units per tick). */
export const MAX_PLATFORM_PEAK_SPEED = 0.12;

export const validateMovingPlatforms = (def: LevelDefinition): string[] => {
  const errors: string[] = [];
  const platforms = def.movingPlatforms ?? [];
  if (platforms.length === 0) return errors;
  if (platforms.length > MAX_MOVING_PLATFORMS) {
    errors.push(
      `too many moving platforms (${String(platforms.length)} > ${String(MAX_MOVING_PLATFORMS)} — bounded dynamic-solid count)`,
    );
  }
  const seen = new Set<string>();
  for (const p of platforms) {
    if (seen.has(p.id)) errors.push(`moving platform '${p.id}' has a duplicate id`);
    seen.add(p.id);
    // Runtime guard (authored JSON could carry any string): cast out of
    // the narrowed union so the check survives type inspection.
    const axis = p.axis as string;
    if (axis !== 'x' && axis !== 'y') {
      errors.push(`moving platform '${p.id}' axis must be 'x' or 'y' (never forward)`);
    }
    if (!(p.halfExtents.x >= 1) || !(p.halfExtents.y >= 0.25)) {
      errors.push(`moving platform '${p.id}' is too small to land on (half X ≥ 1, half Y ≥ 0.25)`);
    }
    if (!(p.halfExtents.z > 0)) {
      errors.push(`moving platform '${p.id}' has degenerate Z extent`);
    }
    if (!(p.periodTicks >= 60)) {
      errors.push(`moving platform '${p.id}' period must be ≥ 60 ticks (readable ferry)`);
    }
    if (!(p.amplitude >= 0.5)) {
      errors.push(`moving platform '${p.id}' amplitude must be ≥ 0.5 (must visibly travel)`);
    }
    if (!(p.phaseTicks >= 0)) {
      errors.push(`moving platform '${p.id}' phase must be ≥ 0`);
    }
    const peak = platformPeakSpeed(p);
    if (peak > MAX_PLATFORM_PEAK_SPEED) {
      errors.push(
        `moving platform '${p.id}' peak speed ${peak.toFixed(3)} u/tick exceeds ${MAX_PLATFORM_PEAK_SPEED} (slow the ferry)`,
      );
    }
  }
  return errors;
};

/** Type-guard for the platform support-id namespace (`platform-<id>`). */
export const platformSupportId = (def: MovingPlatformDef): string => `platform-${def.id}`;
