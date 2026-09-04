import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import { holdJump, idleInput, tapLaneLeft, tapLaneRight } from './simulation';

/**
 * Deterministic scripted playthrough driver for Validation Level 02 (M5).
 *
 * A z-triggered one-shot action list driven by the REAL simulation state —
 * the same policy the browser QA harness uses live — so the automated
 * playthrough, the recorded replay and the golden fixture all use legal
 * inputs (no debug teleport) and stay reproducible tick-for-tick.
 *
 * Timing notes (level speed 11 u/s, 2x tier 22 u/s; jump airtime 0.629 s =>
 * 6.9 u at 1x / 13.8 u at 2x; ceiling pad impulse 20 => 10.5 u forward):
 * see the geometry comments in src/content/levels/validationLevel02.ts.
 */
export type Level02ActionKind = 'tapRight' | 'tapLeft' | 'jumpPress';

export interface Level02Action {
  /** First tick whose player z >= atZ triggers the action (once). */
  atZ: number;
  kind: Level02ActionKind;
}

export const LEVEL02_SCRIPT: readonly Level02Action[] = [
  { atZ: 25, kind: 'tapRight' }, // spike row z 30: safe center (from start lane)
  { atZ: 40, kind: 'tapRight' }, // spike row z 44: safe screen-right (x -2.6)
  { atZ: 50, kind: 'tapLeft' }, // back to center for the ceiling pad (x 0)
  { atZ: 55.6, kind: 'jumpPress' }, // gap z 56..61.5
  { atZ: 133, kind: 'jumpPress' }, // ceiling gap z 135..140
  // (stay center: the gravity orb at z 149 is at x 0)
  { atZ: 147.2, kind: 'jumpPress' }, // ceiling jump under the orb window
  { atZ: 148.6, kind: 'jumpPress' }, // orb press edge (window z 148.2..149.8)
  { atZ: 192, kind: 'jumpPress' }, // 2x gap z 193..204 (13.8 u jump)
  { atZ: 207.5, kind: 'tapRight' }, // spike row z 212: safe screen-right (at 2x)
];

/** One-shot z-triggered script runner (reusable; one instance per attempt). */
export class Level02Driver {
  private index = 0;
  private releasingJump = false;

  constructor(private readonly actions: readonly Level02Action[] = LEVEL02_SCRIPT) {}

  /** Input for the next tick, given the player's current z. */
  public nextInput(z: number): PhysicalInputSnapshot {
    if (this.releasingJump) {
      this.releasingJump = false;
      return idleInput;
    }
    const action = this.actions[this.index];
    if (action !== undefined && z >= action.atZ) {
      this.index += 1;
      if (action.kind === 'tapRight') return tapLaneRight;
      if (action.kind === 'tapLeft') return tapLaneLeft;
      this.releasingJump = true;
      return holdJump;
    }
    return idleInput;
  }

  public get done(): boolean {
    return this.index >= this.actions.length && !this.releasingJump;
  }
}
