import { GameSimulation } from '../../src/game/GameSimulation';
import { TEST_LEVEL } from '../../src/content/levels/testLevel01';
import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';

/**
 * Shared deterministic simulation-driving helpers for test suites.
 *
 * Lives in a NON-TEST support module on purpose: test files must never import
 * another `*.test.ts` module (importing one re-executes its top-level suite
 * under Vitest and inflates the test count). Import helpers from here instead.
 *
 * Inputs are PHYSICAL snapshots (M3): raw keys, no gravity meaning. The
 * simulation interprets them against its authoritative gravity mode.
 */

const edge = (held: boolean, pressed: boolean) => ({
  held,
  pressedThisStep: pressed,
  releasedThisStep: false,
});

/** All physical keys idle. */
export const idleInput: PhysicalInputSnapshot = {
  space: edge(false, false),
  up: edge(false, false),
  down: edge(false, false),
  laneLeft: edge(false, false),
  laneRight: edge(false, false),
};

/** Space held (universal jump key; first step carries the press edge). */
export const holdJump: PhysicalInputSnapshot = {
  ...idleInput,
  space: edge(true, true),
};

/** ArrowDown held — fast-fall on Floor (ArrowUp is fast-fall on Ceiling). */
export const holdFastFall: PhysicalInputSnapshot = {
  ...idleInput,
  down: edge(true, true),
};

/** Single left-lane press edge. */
export const tapLaneLeft: PhysicalInputSnapshot = {
  ...idleInput,
  laneLeft: { held: false, pressedThisStep: true, releasedThisStep: true },
};

/** Single right-lane press edge. */
export const tapLaneRight: PhysicalInputSnapshot = {
  ...idleInput,
  laneRight: { held: false, pressedThisStep: true, releasedThisStep: true },
};

/** Fresh simulation on the controller test level (player starts mid-air). */
export const makeSim = (): GameSimulation => new GameSimulation(TEST_LEVEL);

/** Advance n fixed steps with a constant input. */
export const advance = (
  sim: GameSimulation,
  input: PhysicalInputSnapshot,
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
