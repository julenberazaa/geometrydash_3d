/**
 * Deterministic fingerprint of the AUTHORITATIVE simulation state (M5).
 *
 * This is the per-tick verification hash: replaying a tape must reproduce it
 * EXACTLY at every fixed step. It includes every mutable state element that
 * can affect future gameplay; it excludes debug/observability-only records.
 *
 * INCLUDED (audited against GameSimulation + PlayerState):
 *   - status, deathCause (current-death tag)
 *   - player position, velocity, grounded, supportColliderId
 *   - targetLaneIndex, laneCount (lane intent + policy input)
 *   - gravityMode (authoritative), speedMultiplier (authoritative)
 *   - elapsedSimTime, deathHoldTicksLeft (integer-tick timing authority)
 *   - usedInteractions: one-shot lifecycle bits per pad/orb id (level order)
 *
 * EXCLUDED (with reason):
 *   - attempts: session counter, never read by gameplay
 *   - prevPosition: overwritten at the top of every step; never affects
 *     future steps (crossing detection only reads it WITHIN a step)
 *   - lastPortalId / lastSpeedPortalId / lastInteractionId / lastInteraction /
 *     hasInteractionEvent / interactionEventCount / padActivationCount /
 *     orbActivationCount / speedPortalCount: debug/QA/VFX observability only
 *   - deathId, lastDeathCause, lastDeathLethalId, lastLethalColliderId,
 *     deathPosition, lastContactNormal, lastPreImpactVelocity: stable death
 *     records + VFX anchors; no future gameplay effect
 *   - progress: derived from position
 */

import { DeterministicHasher } from './hash';
import type { GameSimulation } from '../game/GameSimulation';

const hasher = new DeterministicHasher();

const writeNullableString = (h: DeterministicHasher, value: string | null): void => {
  if (value === null) {
    h.writeBoolean(false);
  } else {
    h.writeBoolean(true);
    h.writeString(value);
  }
};

/**
 * Canonical 16-hex-char fingerprint of the authoritative simulation state.
 * Pure and allocation-light (module-level scratch; one small digest string).
 */
export const computeStateFingerprint = (sim: GameSimulation): string => {
  const h = hasher;
  h.reset();

  // Status: 0 running / 1 dead / 2 finished.
  h.writeInt32(sim.status === 'running' ? 0 : sim.status === 'dead' ? 1 : 2);
  // Death cause: 0 none / 1 hazard / 2 frontImpact / 3 void.
  const cause = sim.deathCause;
  h.writeInt32(cause === null ? 0 : cause === 'hazard' ? 1 : cause === 'frontImpact' ? 2 : 3);

  const p = sim.player;
  h.writeFloat64(p.position.x);
  h.writeFloat64(p.position.y);
  h.writeFloat64(p.position.z);
  h.writeFloat64(p.velocity.x);
  h.writeFloat64(p.velocity.y);
  h.writeFloat64(p.velocity.z);
  h.writeBoolean(p.grounded);
  h.writeInt32(p.targetLaneIndex);
  h.writeInt32(p.laneCount);
  writeNullableString(h, p.supportColliderId);

  // Authoritative simulation-owned states.
  h.writeInt32(sim.gravityMode === 'ceiling' ? 1 : 0);
  h.writeFloat64(sim.speedMultiplier);
  h.writeFloat64(sim.elapsedSimTime);
  h.writeInt32(sim.deathHoldTicksLeft);

  // One-shot interaction lifecycle bits, in deterministic level order.
  for (const pad of sim.level.jumpPads) h.writeBoolean(sim.isInteractionUsed(pad.id));
  for (const orb of sim.level.jumpOrbs) h.writeBoolean(sim.isInteractionUsed(orb.id));
  for (const orb of sim.level.gravityOrbs) h.writeBoolean(sim.isInteractionUsed(orb.id));

  return h.digest();
};
