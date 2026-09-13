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
 *   - playerMode (M8C, authoritative — ONLY when the level has mode
 *     portals, else zero bytes so old levels hash identically)
 *   - elapsedSimTime, deathHoldTicksLeft (integer-tick timing authority)
 *   - usedInteractions: one-shot lifecycle bits per pad/orb id (level order)
 *   - usedTeleports: one-shot lifecycle bits per teleport id (level order)
 *   - usedModePortals: one-shot lifecycle bits per mode portal (level order)
 *   - chomperStates (M8D — ONLY when the level has chompers, else zero
 *     bytes): phase + ticks + position + aim per Chomper
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
  // Death cause: 0 none / 1 hazard / 2 frontImpact / 3 void / 4 lava (M8A,
  // appended — pre-M8A causes keep their codes, so old tapes hash identically).
  const cause = sim.deathCause;
  h.writeInt32(
    cause === null ? 0 : cause === 'hazard' ? 1 : cause === 'frontImpact' ? 2 : cause === 'void' ? 3 : 4,
  );

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

  // Authoritative simulation-owned states. Gravity codes (M8B): floor 0 /
  // ceiling 1 (unchanged) + leftWall 2 / rightWall 3 (appended) — pre-M8B
  // state hashes are byte-identical.
  const mode = sim.gravityMode;
  h.writeInt32(mode === 'ceiling' ? 1 : mode === 'leftWall' ? 2 : mode === 'rightWall' ? 3 : 0);
  h.writeFloat64(sim.speedMultiplier);
  h.writeFloat64(sim.elapsedSimTime);
  h.writeInt32(sim.deathHoldTicksLeft);

  // M8C authoritative player mode — conditional (levels without mode
  // portals write zero bytes; pre-M8C state hashes are unchanged).
  if (sim.level.modePortals.length > 0) {
    const mode = sim.playerMode;
    h.writeInt32(mode === 'cube' ? 0 : mode === 'ship' ? 1 : 2);
  }

  // One-shot interaction lifecycle bits, in deterministic level order.
  for (const pad of sim.level.jumpPads) h.writeBoolean(sim.isInteractionUsed(pad.id));
  for (const orb of sim.level.jumpOrbs) h.writeBoolean(sim.isInteractionUsed(orb.id));
  for (const orb of sim.level.gravityOrbs) h.writeBoolean(sim.isInteractionUsed(orb.id));
  // M7.2 one-shot teleport lifecycle bits, in level order. Levels without
  // teleports write zero bytes here — pre-M7.2 state hashes are unchanged.
  for (const t of sim.level.teleportPortals) h.writeBoolean(sim.isTeleportUsed(t.id));
  // M8C one-shot mode-portal lifecycle bits, in level order (conditional).
  for (const m of sim.level.modePortals) h.writeBoolean(sim.isModePortalUsed(m.id));
  // M8D Chomper dynamic state — conditional (levels without chompers
  // write zero bytes; pre-M8D state hashes are unchanged). Phase +
  // deterministic progress + position + committed aim per Chomper.
  if (sim.level.chompers.length > 0) {
    for (const st of sim.chomperStates) {
      h.writeInt32(
        st.phase === 'telegraph' ? 1 : st.phase === 'lunging' ? 2 : st.phase === 'spent' ? 3 : 0,
      );
      h.writeInt32(st.ticksInPhase);
      h.writeFloat64(st.x);
      h.writeFloat64(st.y);
      h.writeFloat64(st.z);
      h.writeFloat64(st.aimX);
    }
  }

  return h.digest();
};
