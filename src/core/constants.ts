/** Core simulation constants. Gameplay runs at a fixed rate, independent of rendering. */

/** Fixed simulation frequency in Hz. */
export const SIMULATION_HZ = 120;

/** Nominal simulation step in seconds (1/120). */
export const SIMULATION_DT = 1 / SIMULATION_HZ;

/** Simulation step in milliseconds (accumulator works in ms). */
export const SIMULATION_DT_MS = 1000 / SIMULATION_HZ;

/**
 * Catch-up policy:
 * - Incoming frame deltas are clamped to MAX_FRAME_DELTA_MS (tab was hidden /
 *   stalled => do not simulate seconds of gameplay in one burst).
 * - At most MAX_CATCHUP_STEPS_PER_FRAME fixed steps run per rendered frame.
 * - Any accumulated remainder beyond that is discarded (spiral-of-death guard).
 * At 120 Hz, 8 steps cover a 66.7 ms frame (sustained 15 FPS) without dropping
 * sim time. The nominal 30 FPS case needs exactly 4 steps; the headroom above 4
 * is deliberate: floating-point jitter in frame deltas must never push a full
 * frame's worth of legitimately carried time into the spiral-of-death discard.
 * (With the cap exactly equal to the 30 FPS need, jitter previously discarded
 * whole simulation steps — see the cadence-invariance test history.)
 */
export const MAX_FRAME_DELTA_MS = 250;
export const MAX_CATCHUP_STEPS_PER_FRAME = 8;

/** Milestone coordinate convention: forward = +Z, gravity = -Y, lane axis = +X. */
export const FORWARD_AXIS = { x: 0, y: 0, z: 1 } as const;
