import { GameSimulation } from '../../src/game/GameSimulation';
import { TEST_LEVEL } from '../../src/content/levels/testLevel01';
import type { InputSnapshot } from '../../src/input/InputSystem';

/**
 * Shared deterministic simulation-driving helpers for test suites.
 *
 * Lives in a NON-TEST support module on purpose: test files must never import
 * another `*.test.ts` module (importing one re-executes its top-level suite
 * under Vitest and inflates the test count). Import helpers from here instead.
 */

/** All inputs idle. */
export const idleInput: InputSnapshot = {
  jump: { held: false, pressedThisStep: false, releasedThisStep: false },
  fastFall: { held: false, pressedThisStep: false, releasedThisStep: false },
  laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
  laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
};

/** Jump held (first step carries the press edge; hold-to-repeat applies). */
export const holdJump: InputSnapshot = {
  ...idleInput,
  jump: { held: true, pressedThisStep: true, releasedThisStep: false },
};

/** Single left-lane press edge. */
export const tapLaneLeft: InputSnapshot = {
  ...idleInput,
  laneLeft: { held: false, pressedThisStep: true, releasedThisStep: true },
};

/** Single right-lane press edge. */
export const tapLaneRight: InputSnapshot = {
  ...idleInput,
  laneRight: { held: false, pressedThisStep: true, releasedThisStep: true },
};

/** Fast-fall held. */
export const holdFastFall: InputSnapshot = {
  ...idleInput,
  fastFall: { held: true, pressedThisStep: true, releasedThisStep: false },
};

/** Fresh simulation on the controller test level (player starts mid-air). */
export const makeSim = (): GameSimulation => new GameSimulation(TEST_LEVEL);

/** Advance n fixed steps with a constant input. */
export const advance = (
  sim: GameSimulation,
  input: InputSnapshot,
  steps: number,
): void => {
  for (let i = 0; i < steps; i++) sim.update(input);
};

/** Spawn puts the player mid-air (y=1.5); settle onto the runway first. */
export const makeGroundedSim = (): { sim: GameSimulation; groundedAtStep: number } => {
  const sim = makeSim();
  let groundedAtStep = 0;
  for (let i = 0; i < 120 && !sim.player.grounded; i++) {
    sim.update(idleInput);
    groundedAtStep = i + 1;
  }
  if (!sim.player.grounded) throw new Error('player never settled at spawn');
  return { sim, groundedAtStep };
};
