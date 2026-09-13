import type { ChomperDef } from '../level/levelDefinition';

/**
 * Deterministic dynamic-chomper kinematics (M8D) — the ONE owner of the
 * Chomper phase machine. Pure fixed-tick math (no THREE, no DOM, no world
 * queries): `GameSimulation` owns the state array, the activation read
 * (player Z), the swept lethal test and the reset; this module owns phase
 * transitions and positions so tests and the sim share one implementation.
 *
 * Phase machine (per chomper, per attempt):
 *   dormant → (player.z >= triggerZ) → telegraph → (ticks) → lunging →
 *   (ticks) → spent. Forward-only, never reverses, never re-arms.
 * At activation the player's lateral X is captured as `aimX` and NEVER
 * updated (committed readable attack — no re-homing). The lunge line is
 * the authored dormant Y/Z; aimX is recorded deterministically for the
 * fingerprint and future aim contracts.
 */
export type ChomperPhase = 'dormant' | 'telegraph' | 'lunging' | 'spent';

export interface ChomperState {
  phase: ChomperPhase;
  /** Ticks spent in the current phase (deterministic progress). */
  ticksInPhase: number;
  /** Current hitbox center (world). */
  x: number;
  y: number;
  z: number;
  /** Player lateral X captured at activation (committed aim, never re-homed). */
  aimX: number;
}

export const createChomperState = (def: ChomperDef): ChomperState => ({
  phase: 'dormant',
  ticksInPhase: 0,
  x: def.dormant.x,
  y: def.dormant.y,
  z: def.dormant.z,
  aimX: 0,
});

export const resetChomperState = (state: ChomperState, def: ChomperDef): void => {
  state.phase = 'dormant';
  state.ticksInPhase = 0;
  state.x = def.dormant.x;
  state.y = def.dormant.y;
  state.z = def.dormant.z;
  state.aimX = 0;
};

/**
 * Advance one fixed step. Returns true when this step ARMED the telegraph
 * (activation edge — currently informational; the sim reads phase).
 */
export const stepChomper = (
  state: ChomperState,
  def: ChomperDef,
  playerZ: number,
  playerX: number,
): void => {
  switch (state.phase) {
    case 'dormant':
      if (playerZ >= def.triggerZ) {
        state.phase = 'telegraph';
        state.ticksInPhase = 0;
        state.aimX = playerX;
      }
      break;
    case 'telegraph':
      state.ticksInPhase += 1;
      if (state.ticksInPhase >= def.telegraphTicks) {
        state.phase = 'lunging';
        state.ticksInPhase = 0;
      }
      break;
    case 'lunging': {
      state.ticksInPhase += 1;
      const t = Math.min(1, state.ticksInPhase / Math.max(1, def.lungeTicks));
      state.x = def.dormant.x + def.lungeDirection * def.lungeDistance * t;
      if (state.ticksInPhase >= def.lungeTicks) state.phase = 'spent';
      break;
    }
    case 'spent':
      break;
  }
};

/** Lunge end position (spent rest pose) along world X. */
export const chomperEndX = (def: ChomperDef): number =>
  def.dormant.x + def.lungeDirection * def.lungeDistance;
