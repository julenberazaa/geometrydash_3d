import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import { holdJump, idleInput, tapLaneLeft, tapLaneRight } from './simulation';

/**
 * Deterministic scripted playthrough driver for Vertical Slice 01 (M7.1).
 *
 * A z-triggered one-shot action list driven by the REAL simulation state —
 * the same policy the browser QA harness mirrors in-page — so the automated
 * playthrough and the recorded replay use legal inputs only (no debug
 * teleport, no state mutation) and stay reproducible tick-for-tick.
 *
 * Timing notes (base speed 12 u/s, 2x tier 24 u/s; jump airtime 0.629 s =>
 * 7.55 u at 1x / 15.1 u at 2x; floor pad impulse 23 => ~13.1 u forward;
 * ceiling pad impulse 22 => ~12.6 u; jump orb impulse 15 => ~8.6 u):
 * see the envelope comments in src/content/levels/verticalSlice01.ts.
 *
 * This script is a verification route (it proves the level CAN be completed),
 * not a claim about the ideal human route.
 */
export type VerticalSlice01ActionKind = 'tapRight' | 'tapLeft' | 'jumpPress';

export interface VerticalSlice01Action {
  /** First tick whose player z >= atZ triggers the action (once). */
  atZ: number;
  kind: VerticalSlice01ActionKind;
}

export const VERTICAL_SLICE_01_SCRIPT: readonly VerticalSlice01Action[] = [
  // --- ACT I: precision introduction (island chain, 3 airborne transfers) ---
  { atZ: 19, kind: 'jumpPress' }, // bridge spike z 22: jump over
  { atZ: 32.5, kind: 'jumpPress' }, // gap 34..38 takeoff (center)
  { atZ: 34.5, kind: 'tapRight' }, // ...move right mid-air -> right island
  { atZ: 48.5, kind: 'jumpPress' }, // gap 50..54 takeoff (right)
  { atZ: 50.5, kind: 'tapLeft' }, // ...move left mid-air -> center island
  { atZ: 57, kind: 'jumpPress' }, // island spike z 60: jump over
  { atZ: 65.5, kind: 'jumpPress' }, // gap 66..70.5 takeoff (center; after the spike landing ~64.5)
  { atZ: 66.5, kind: 'tapLeft' }, // ...move left mid-air -> left island
  { atZ: 80.5, kind: 'jumpPress' }, // step-up gap 82..84 onto the elevated platform
  { atZ: 94.5, kind: 'jumpPress' }, // drop gap 96..100 onto the two-lane
  { atZ: 106, kind: 'tapRight' }, // spike row z 112 covers screen-left -> center
  { atZ: 116, kind: 'tapLeft' }, // spike row z 122 covers center -> screen-left
  { atZ: 129, kind: 'jumpPress' }, // gap 130..134.5 takeoff (screen-left)
  { atZ: 130.5, kind: 'tapRight' }, // ...move right mid-air -> center bridge
  { atZ: 148.5, kind: 'jumpPress' }, // gap 150..155
  // --- ACT II: gravity / technical build (portal up at z 170, no input) ---
  { atZ: 193, kind: 'tapLeft' }, // ceiling spike z 200 covers center -> screen-left
  { atZ: 205, kind: 'tapRight' }, // ceiling spike z 216 covers screen-left -> center
  { atZ: 228.5, kind: 'jumpPress' }, // ceiling gap 230..235
  { atZ: 236, kind: 'tapRight' }, // ceiling-pad lane (x -2.6)
  // (ceiling pad z 243 fires passively over the 244..252 gap)
  { atZ: 260, kind: 'tapLeft' }, // back to center for the narrow ceiling bridge
  { atZ: 271.5, kind: 'jumpPress' }, // hop gap 274..276
  { atZ: 282.5, kind: 'jumpPress' }, // ceiling setup jump (down off the ceiling)
  { atZ: 284.5, kind: 'jumpPress' }, // gravity orb press edge -> floor
  // (orb landing stays center: F1 covers C+R and the floor pad is at x 0)
  // (floor pad z 311 fires passively over the 313..321 gap)
  { atZ: 346, kind: 'jumpPress' }, // orb gap takeoff
  { atZ: 352.5, kind: 'jumpPress' }, // jump orb press edge (impulse 15)
  { atZ: 369, kind: 'jumpPress' }, // bridge spike z 372: jump over
  { atZ: 399, kind: 'jumpPress' }, // callback ceiling spike z 402: dip under
  // (callback portals up z 385 / down z 415 need no input)
  // --- ACT III: climax / release ---
  { atZ: 466, kind: 'tapLeft' }, // spike row z 472 covers center -> screen-left
  { atZ: 479, kind: 'jumpPress' }, // gap 480..484 takeoff (screen-left)
  { atZ: 480.5, kind: 'tapRight' }, // ...move right mid-air -> center bridge
  { atZ: 536.5, kind: 'jumpPress' }, // 2x gap 538..549 takeoff (center)
  { atZ: 540, kind: 'tapRight' }, // ...move right mid-air -> right island
  { atZ: 577, kind: 'jumpPress' }, // 2x island spike z 580: jump over
  { atZ: 593.5, kind: 'jumpPress' }, // 2x gap 596..606 takeoff (screen-right)
  { atZ: 595, kind: 'tapLeft' }, // ...move left mid-air -> two-lane
  { atZ: 615, kind: 'tapLeft' }, // spike row z 626 covers center -> screen-left
];

/** One-shot z-triggered script runner (reusable; one instance per attempt). */
export class VerticalSlice01Driver {
  private index = 0;
  private releasingJump = false;

  constructor(private readonly actions: readonly VerticalSlice01Action[] = VERTICAL_SLICE_01_SCRIPT) {}

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
