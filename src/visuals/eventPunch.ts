/**
 * Event punch controller (M6C2) — short-lived, event-reactive visual energy
 * for high-salience interactions (pads, gravity flips, speed portals, orbs).
 *
 * Problem: M6B bursts answer events with small local particles only — pads
 * and gravity changes never "hit" in the environment. This module computes
 * the punch ENVELOPE (0..1 per kind, decaying with render dt); the
 * RendererHost maps it onto the existing in-place hooks (bloom retune
 * in-contract, exposure nudge, environment flash) on top of the M6C1
 * section base look. Zero new draws, zero new materials.
 *
 * THREE-free by construction (pure numbers, hex colors as integers): the
 * simulation could never import this for gameplay, and the module stays
 * unit-testable without a GL context. Caller-owned state, zero allocation,
 * no accumulation (absolute writes every evaluation — pause-safe and
 * drift-free, same discipline as visualTimeline.ts).
 *
 * Color coding (matches the M6A semantic language):
 * - pad / jumpOrb: warm yellow (jump-impulse family)
 * - gravity: blue (gravity family — portals AND gravity orbs share it)
 * - speed: the portal's tier color (passed at trigger time)
 */

/** Event families that carry a visual punch. */
export type EventPunchKind = 'pad' | 'jumpOrb' | 'gravity' | 'speed';

interface PunchSlot {
  energy: number;
  color: number;
}

/** Caller-owned punch state (one per RendererHost, reused every frame). */
export interface EventPunchState {
  pad: PunchSlot;
  jumpOrb: PunchSlot;
  gravity: PunchSlot;
  speed: PunchSlot;
}

/** Per-kind punch tuning: peak energy + exponential decay rate (per second).
 *  Gravity is the weightiest (longest tail); jump orbs the snappiest. */
const PUNCH_TUNING: Record<EventPunchKind, { peak: number; decay: number; color: number }> = {
  pad: { peak: 1.0, decay: 3.2, color: 0xffd23f },
  jumpOrb: { peak: 0.8, decay: 4.0, color: 0xffd23f },
  gravity: { peak: 1.0, decay: 2.0, color: 0x4fc3ff },
  speed: { peak: 0.9, decay: 2.6, color: 0xffffff },
};

/** Fixed dominance order for ties (gravity wins — the rarest event). */
const DOMINANCE: readonly EventPunchKind[] = ['gravity', 'speed', 'pad', 'jumpOrb'];

/** Frozen per-kind iteration order (hot-loop: no key-array allocation). */
const PUNCH_KINDS = ['pad', 'jumpOrb', 'gravity', 'speed'] as const;

/** Fresh punch state (cold paths + tests only; the host reuses one). */
export const makeEventPunchState = (): EventPunchState => ({
  pad: { energy: 0, color: PUNCH_TUNING.pad.color },
  jumpOrb: { energy: 0, color: PUNCH_TUNING.jumpOrb.color },
  gravity: { energy: 0, color: PUNCH_TUNING.gravity.color },
  speed: { energy: 0, color: PUNCH_TUNING.speed.color },
});

/**
 * Fire (or re-fire) a punch: retrigger restarts the envelope at peak —
 * rapid same-family events stay punchy instead of stacking without bound.
 * `colorOverride` lets speed punches carry their tier color.
 */
export const triggerPunch = (
  state: EventPunchState,
  kind: EventPunchKind,
  colorOverride?: number,
): void => {
  const slot = state[kind];
  slot.energy = PUNCH_TUNING[kind].peak;
  slot.color = colorOverride ?? PUNCH_TUNING[kind].color;
};

/**
 * Decay every slot with render dt (pass 0 while paused to freeze the
 * envelope with presentation pause — same discipline as VfxSystem).
 */
export const updatePunch = (state: EventPunchState, dtSeconds: number): void => {
  const dt = Math.max(0, dtSeconds);
  if (dt === 0) return;
  for (const kind of PUNCH_KINDS) {
    const slot = state[kind];
    if (slot.energy <= 0) continue;
    slot.energy *= Math.exp(-PUNCH_TUNING[kind].decay * dt);
    if (slot.energy < 0.003) slot.energy = 0; // snap: exact rest, no shimmer
  }
};

/** Combined punch energy 0..1 (max over kinds — composable, never stacked). */
export const combinedPunchEnergy = (state: EventPunchState): number => {
  let peak = 0;
  for (const kind of PUNCH_KINDS) {
    const e = state[kind].energy;
    if (e > peak) peak = e;
  }
  return Math.min(1, peak);
};
/** Color of the dominant (highest-energy) slot — the environment flash tint. */
export const dominantPunchColor = (state: EventPunchState): number => {
  let best: EventPunchKind = DOMINANCE[DOMINANCE.length - 1] as EventPunchKind;
  let bestEnergy = -1;
  for (const kind of DOMINANCE) {
    const e = state[kind].energy;
    if (e > bestEnergy) {
      bestEnergy = e;
      best = kind;
    }
  }
  return state[best].color;
};

/** Zero every slot (triggers-off edge, dispose paths — exact rest). */
export const clearPunch = (state: EventPunchState): void => {
  for (const kind of PUNCH_KINDS) {
    state[kind].energy = 0;
  }
}
