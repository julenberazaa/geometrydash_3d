import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import type { GameSimulation } from '../../src/game/GameSimulation';
import { holdJump, idleInput, tapLaneLeft, tapLaneRight } from './simulation';

interface TapAction {
  atZ: number;
  dir: 'left' | 'right';
}

/** Space held without edges (thrust continuation after the press). */
const holdHeld: PhysicalInputSnapshot = {
  space: { held: true, pressedThisStep: false, releasedThisStep: false },
  up: { held: false, pressedThisStep: false, releasedThisStep: false },
  down: { held: false, pressedThisStep: false, releasedThisStep: false },
  laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
  laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
};

/**
 * Deterministic scripted driver for PRODUCTION SHOWCASE 01 (M8.5).
 *
 * A z-triggered one-shot policy over REAL physical inputs (no teleports,
 * no state edits): gap jumps, orb presses inside their windows, maze lane
 * taps, Spider snap presses, a gravity-aware closed-loop Ship policy, and
 * reactive jumps on each Chomper's lunge edge. The same policy drives the
 * automated completion, the recorded replay and the browser QA harness.
 *
 * `variant: 'primary'` takes the ACT 2 center chain (route A), the maze
 * lane-0 line and the ACT 8 high orb line; `variant: 'alternate'` takes
 * the ACT 2 side chain (route B), the maze lane-2 line and the ACT 8 low
 * pad line. Both reconnect deterministically.
 */
export class ShowcaseDriver {
  private jumps: number[];
  private taps: TapAction[];
  private spiderPresses: number[];
  private jumpedChompers = new Set<number>();
  private releasingJump = false;
  private holdingShip = false;

  constructor(variant: 'primary' | 'alternate' = 'primary') {
    const primaryJumps = [
      37.5, 93.5, 172.5, 192.0,
      // ACT 2 route A (center chain).
      235.5, 251.5, 267.5, 291.5,
      // ACT 2 orb gap (window 351.6..353.4 — edge must land inside).
      352.0,
      // ACT 5 canyon spike.
      909.5,
      // ACT 8 route A orb (window 1417.6..1419.4).
      1418.0,
      // ACT 9 homage river.
      1712.5,
    ];
    const alternateJumps = [
      37.5, 93.5, 172.5, 192.0,
      // ACT 2 route B (side chain).
      235.5, 251.5, 271.5, 293.5,
      352.0,
      909.5,
      // Route B crosses its pad passively — no orb press here.
      1712.5,
    ];
    const primaryTaps: TapAction[] = [
      { atZ: 150, dir: 'left' }, // ACT 1 split: center → lane 0
      { atZ: 162, dir: 'right' }, // back to center
      // Maze primary (lane 0 → lane 1 at wall 2).
      { atZ: 395, dir: 'left' },
      { atZ: 430, dir: 'right' },
      // Ceiling spike garden.
      { atZ: 630, dir: 'left' },
      { atZ: 648, dir: 'right' },
      // Temple ceiling spike.
      { atZ: 1202, dir: 'left' },
      { atZ: 1225, dir: 'right' },
      // ACT 8 route A entry (lane 1 → lane 0) + maw recenter.
      { atZ: 1350, dir: 'left' },
      { atZ: 1466, dir: 'right' },
      // Finale 2× weave.
      { atZ: 1530, dir: 'left' },
      { atZ: 1562, dir: 'right' },
    ];
    const alternateTaps: TapAction[] = [
      { atZ: 150, dir: 'left' },
      { atZ: 162, dir: 'right' },
      { atZ: 222, dir: 'right' }, // ACT 2 route B (lane 1 → lane 2)
      { atZ: 302, dir: 'left' }, // reconnect (lane 2 → lane 1)
      // Maze alternate (lane 2 line, join lane 1 at wall 3).
      { atZ: 395, dir: 'right' },
      { atZ: 465, dir: 'left' },
      { atZ: 630, dir: 'left' },
      { atZ: 648, dir: 'right' },
      { atZ: 1202, dir: 'left' },
      { atZ: 1225, dir: 'right' },
      // ACT 8 route B entry (lane 1 → lane 2) + maw recenter.
      { atZ: 1350, dir: 'right' },
      { atZ: 1466, dir: 'left' },
      { atZ: 1530, dir: 'left' },
      { atZ: 1562, dir: 'right' },
    ];
    // Shared Spider snap presses: dodge walls, ceiling return, wall snaps.
    const presses = [1180, 1215, 1222, 1245, 1273, 1291];
    this.jumps = [...(variant === 'primary' ? primaryJumps : alternateJumps)];
    this.taps = (variant === 'primary' ? primaryTaps : alternateTaps).map((t) => ({ ...t }));
    this.spiderPresses = [...presses];
  }

  public nextInput(z: number, sim: GameSimulation): PhysicalInputSnapshot {
    if (this.releasingJump) {
      this.releasingJump = false;
      return idleInput;
    }
    // Ship reactor (mode-observed, gravity-aware closed loop).
    if (sim.playerMode === 'ship') {
      let hold: boolean;
      const inverted = sim.gravityMode === 'ceiling';
      if (inverted) {
        // Inverted flight (ceiling gravity): thrust pushes DOWN, so the
        // regulation inverts — hold while ABOVE the target line.
        hold = sim.player.position.y > 3.5;
      } else if (z < 984) hold = true; // rise over the z 964 wall
      else if (z < 1000) hold = false; // dive under the z 1010 block
      else if (z < 1015) hold = sim.player.position.y < 2.6;
      // Final approach threads the invert-gate center (y 3.0); past the
      // gate on floor gravity the 2.6 line still clears every obstacle,
      // so a missed gate degrades to safe flight, never a blind crash.
      else if (z < 1030) hold = sim.player.position.y < 3.0;
      else hold = sim.player.position.y < 2.6;
      if (hold) {
        const first = !this.holdingShip;
        this.holdingShip = true;
        return first ? holdJump : holdHeld;
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
    // One-shot gap/orb jumps.
    const jump = this.jumps[0];
    if (jump !== undefined && z >= jump) {
      this.jumps.shift();
      this.releasingJump = true;
      return holdJump;
    }
    // One-shot lane taps.
    const tap = this.taps[0];
    if (tap !== undefined && z >= tap.atZ) {
      this.taps.shift();
      return tap.dir === 'left' ? tapLaneLeft : tapLaneRight;
    }
    return idleInput;
  }
}

export const driveShowcaseToFinish = (
  sim: GameSimulation,
  driver: ShowcaseDriver = new ShowcaseDriver(),
  maxTicks = 30000,
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
