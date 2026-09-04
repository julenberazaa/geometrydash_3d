import type { GameSimulation } from '../../src/game/GameSimulation';
import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import { makeIdlePhysicalSnapshot } from '../../src/input/InputSystem';
import type { ReplayCoordinator, ReplayStartResult, ReplayVerification } from '../../src/replay/ReplayCoordinator';

/**
 * Replay test helpers (M5): drive the REAL ReplayCoordinator orchestration
 * (the same per-tick protocol Game uses) against a headless simulation.
 * Lives in a NON-TEST support module (tests never import *.test.ts files).
 */

/**
 * Record ONE attempt: feeds `inputFor(tick)` through the coordinator each
 * fixed tick until the attempt first becomes dead or finished (the recording
 * finalizes on that exact tick). The sim must be freshly constructed.
 */
export const recordAttempt = (
  sim: GameSimulation,
  coordinator: ReplayCoordinator,
  inputFor: (tick: number) => Readonly<PhysicalInputSnapshot>,
  maxTicks = 60000,
): number => {
  let tick = 0;
  for (; tick < maxTicks; tick++) {
    if (coordinator.lastReplay !== null) break;
    coordinator.beforeSimTick();
    const input = coordinator.getInputForTick(inputFor(tick));
    sim.update(input);
    coordinator.afterSimTick();
  }
  if (coordinator.lastReplay === null) {
    throw new Error(`attempt did not terminate within ${String(maxTicks)} ticks`);
  }
  return tick;
};

/**
 * Play a replay back through the coordinator: validates + restarts the sim
 * to the tape's deterministic initial state, feeds exactly one recorded
 * frame per fixed tick, and returns when verification completes.
 */
export const playReplay = (
  sim: GameSimulation,
  coordinator: ReplayCoordinator,
  replay: unknown,
  maxTicks = 60000,
): ReplayVerification => {
  const start: ReplayStartResult = coordinator.startReplay(replay);
  if (!start.ok) return coordinator.verification;
  let tick = 0;
  while (coordinator.isPlaying && tick < maxTicks) {
    coordinator.beforeSimTick();
    const input = coordinator.getInputForTick(makeIdlePhysicalSnapshot());
    sim.update(input);
    coordinator.afterSimTick();
    tick += 1;
  }
  if (coordinator.isPlaying) {
    throw new Error(`replay playback did not terminate within ${String(maxTicks)} ticks`);
  }
  return coordinator.verification;
};
