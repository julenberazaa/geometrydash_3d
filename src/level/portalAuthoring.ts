import type { LevelDefinition } from './levelDefinition';

/**
 * Portal authoring validation (M8.2): bounded trigger volumes must match
 * the visible gate opening — SIZE as well as center.
 *
 * Root cause it pins (human playtest, M8.1 follow-up): the trigger
 * mechanism is exact, but corridor-sized volumes (up to 10 u wide) fired
 * when the player passed several units BESIDE the ~2.9 u visible ring.
 * A gate volume bigger than its ring is a visual/sim mismatch and reads
 * as "the portal fired outside the portal".
 *
 * Rules (pure function of level data — no sim, no THREE):
 *  1. A bounded volume is centered on its gate plane
 *     (|center.z − portal.z| ≈ 0 — the ring the player sees).
 *  2. Its lateral/vertical half extents fit the visual opening:
 *     half ≤ gate ring radius + GATE_VOLUME_MARGIN. (The swept test adds
 *     the player half extents, so the path still fires when the avatar's
 *     edge enters the ring — forgiving without firing from outside it.)
 *  3. Volumes are non-degenerate (every half extent ≥ 0.5 — a gate the
 *     avatar cannot physically enter is an authoring error).
 *
 * Production levels must validate cleanly. Volume-less definitions keep
 * the legacy plane crossing and are exempt (compatibility).
 */

/** Visual gate-opening radii — the SINGLE owner of the ring sizes that
 *  LevelView renders (import them there; never hardcode a second copy). */
export const GRAVITY_GATE_RADIUS = 1.45;
export const MODE_GATE_RADIUS = 1.35;
export const TELEPORT_GATE_RADIUS = 1.5;
export const TELEPORT_MAW_GATE_RADIUS = 1.85;

/** How far a trigger box may exceed its ring (residual swept-path skin). */
export const GATE_VOLUME_MARGIN = 0.35;
/** Minimum half extent: a gate must admit the 1.1-wide avatar. */
const MIN_GATE_HALF = 0.5;
const PLANE_EPSILON = 0.001;

interface GateDesc {
  id: string;
  z: number;
  radius: number;
  center: { x: number; y: number; z: number } | undefined;
  half: { x: number; y: number; z: number } | undefined;
}

export const validatePortalBounds = (def: LevelDefinition): string[] => {
  const errors: string[] = [];
  const gates: GateDesc[] = [];
  for (const p of def.gravityPortals ?? []) {
    gates.push({ id: p.id, z: p.z, radius: GRAVITY_GATE_RADIUS, center: p.triggerCenter, half: p.triggerHalfExtents });
  }
  for (const p of def.speedPortals ?? []) {
    gates.push({ id: p.id, z: p.z, radius: GRAVITY_GATE_RADIUS, center: p.triggerCenter, half: p.triggerHalfExtents });
  }
  for (const p of def.modePortals ?? []) {
    gates.push({ id: p.id, z: p.z, radius: MODE_GATE_RADIUS, center: p.triggerCenter, half: p.triggerHalfExtents });
  }
  for (const p of def.teleportPortals ?? []) {
    gates.push({
      id: p.id,
      z: p.entryZ,
      radius: p.style === 'maw' ? TELEPORT_MAW_GATE_RADIUS : TELEPORT_GATE_RADIUS,
      center: p.entryCenter,
      half: p.entryHalfExtents,
    });
  }
  for (const g of gates) {
    // Volume-less gates keep the legacy plane crossing (exempt).
    if (g.center === undefined || g.half === undefined) continue;
    if (Math.abs(g.center.z - g.z) > PLANE_EPSILON) {
      errors.push(
        `portal '${g.id}' trigger volume is off its gate plane (center.z ${g.center.z} ≠ z ${g.z})`,
      );
    }
    const maxHalf = g.radius + GATE_VOLUME_MARGIN;
    if (g.half.x > maxHalf || g.half.y > maxHalf) {
      errors.push(
        `portal '${g.id}' trigger volume exceeds its visible opening ` +
          `(half x/y ${g.half.x}/${g.half.y} > ring ${g.radius} + margin ${GATE_VOLUME_MARGIN})`,
      );
    }
    if (g.half.x < MIN_GATE_HALF || g.half.y < MIN_GATE_HALF || g.half.z < MIN_GATE_HALF) {
      errors.push(`portal '${g.id}' trigger volume is degenerate (half extents ${g.half.x}/${g.half.y}/${g.half.z})`);
    }
  }
  return errors;
};
