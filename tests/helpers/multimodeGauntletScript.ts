import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import type { GameSimulation } from '../../src/game/GameSimulation';
import { holdJump, idleInput, tapLaneLeft, tapLaneRight } from './simulation';

/**
 * Deterministic scripted playthrough driver for MULTIMODE GAUNTLET 01 (M8E).
 *
 * A z-triggered one-shot policy over REAL physical inputs (no teleports, no
 * state edits): lane taps for the maze, press-edges for gaps and Spider
 * snaps, hold windows for the Ship corridor, and reactive jumps on each
 * Chomper's lunge edge. The same policy drives the automated completion,
 * the recorded replay and the browser QA harness.
 *
 * Section timing (base speed 14 u/s unless noted):
 * - S1 gaps 40..46 / 90..96 (6 u): press ≈2.5 u before the edge
 * - S1 lava river curb z 128..131 (3 u hop): press ≈2.5 u before (M8.1)
 * - S2 maze doors z 180 (lane 0) / 215 (lane 2) / 250 (lane 1)
 * - S3 gravity portals ride on continuous runways (no input)
 * - S4 chompers: jump on the lunge-start edge (reactive, per Chomper)
 * - S5 ship: hold 715..~780 (rise over the z 744 wall), release ~780..800
 *   (dive under the z 790 block), hold 800..845 (recover before exit)
 * - S6 spider: press z 890 (snap up over the z 905 wall), press z 935 (down)
 * - S7 island gaps 1000..1005 / 1015..1020 (5 u): press ≈2.5 u before
 */
interface TapAction {
  atZ: number;
  dir: 'left' | 'right';
}

/** Space held without edges (Ship thrust continuation after the press). */
const holdShipHeld: PhysicalInputSnapshot = {
  space: { held: true, pressedThisStep: false, releasedThisStep: false },
  up: { held: false, pressedThisStep: false, releasedThisStep: false },
  down: { held: false, pressedThisStep: false, releasedThisStep: false },
  laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
  laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
};

export class MultimodeDriver {
  private jumps: number[];
  private taps: TapAction[];
  private spiderPresses: number[];
  private jumpedChompers = new Set<number>();
  private releasingJump = false;
  private holdingShip = false;

  constructor(
    jumps: readonly number[] = [37.5, 87.5, 125.5, 997.5, 1012.5],
    taps: readonly TapAction[] = [
      { atZ: 160, dir: 'left' }, // wall 1 (z 180): door lane 0
      { atZ: 196, dir: 'right' }, // wall 2 (z 215): lane 0 → 1
      { atZ: 199, dir: 'right' }, // wall 2: lane 1 → 2
      { atZ: 232, dir: 'left' }, // wall 3 (z 250): lane 2 → 1
    ],
    spiderPresses: readonly number[] = [890, 935],
  ) {
    this.jumps = [...jumps];
    this.taps = taps.map((t) => ({ ...t }));
    this.spiderPresses = [...spiderPresses];
  }

  public nextInput(z: number, sim: GameSimulation): PhysicalInputSnapshot {
    if (this.releasingJump) {
      this.releasingJump = false;
      return idleInput;
    }
    // Ship corridor (mode-observed: only while flying). M8.1: the exit
    // gate is bounded (y −2..6 at z 845), so the driver must FLY the
    // corridor — rise over the z 744 wall, dive under the z 790 block,
    // then track the exit-gate altitude (≈2.75) instead of ceiling-riding
    // past the ring. Closed-loop on sim Y: deterministic, still real
    // physical inputs (held/released Space, no state edits). The dive
    // starts at 780 (4 u of latency margin before the z 790 block).
    if (sim.playerMode === 'ship') {
      let hold: boolean;
      if (z < 780) hold = true;
      else if (z < 800) hold = false;
      else if (z < 815) hold = true;
      else hold = sim.player.position.y < 2.6;
      if (hold) {
        const first = !this.holdingShip;
        this.holdingShip = true;
        return first ? holdJump : holdShipHeld;
      }
      this.holdingShip = false;
      return idleInput;
    }
    this.holdingShip = false;
    // Reactive Chomper jumps: press on the lunge-start edge (once each).
    for (let i = 0; i < sim.chomperStates.length; i++) {
      const st = sim.chomperStates[i];
      if (st !== undefined && st.phase === 'lunging' && !this.jumpedChompers.has(i)) {
        this.jumpedChompers.add(i);
        this.releasingJump = true;
        return holdJump;
      }
    }
    // One-shot Spider presses.
    const press = this.spiderPresses[0];
    if (press !== undefined && z >= press) {
      this.spiderPresses.shift();
      this.releasingJump = true;
      return holdJump;
    }
    // One-shot gap jumps.
    const jump = this.jumps[0];
    if (jump !== undefined && z >= jump) {
      this.jumps.shift();
      this.releasingJump = true;
      return holdJump;
    }
    // One-shot maze lane taps.
    const tap = this.taps[0];
    if (tap !== undefined && z >= tap.atZ) {
      this.taps.shift();
      return tap.dir === 'left' ? tapLaneLeft : tapLaneRight;
    }
    return idleInput;
  }
}

export const driveMultimodeToFinish = (
  sim: GameSimulation,
  driver: MultimodeDriver = new MultimodeDriver(),
  maxTicks = 20000,
): { ticks: number; modes: Set<string>; gravities: Set<string> } => {
  const modes = new Set<string>();
  const gravities = new Set<string>();
  let tick = 0;
  for (; tick < maxTicks; tick++) {
    if (sim.status !== 'running') break;
    modes.add(sim.playerMode);
    gravities.add(sim.gravityMode);
    sim.update(driver.nextInput(sim.player.position.z, sim));
  }
  return { ticks: tick, modes, gravities };
};
