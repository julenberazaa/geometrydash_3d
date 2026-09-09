import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import { holdJump, idleInput, tapLaneLeft, tapLaneRight } from './simulation';

/**
 * Deterministic scripted playthrough driver for Vertical Slice 01 (M7).
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
  // --- ACT I: establish / flow ---
  { atZ: 24, kind: 'tapRight' }, // spike row z 30: safe screen-right
  { atZ: 44.5, kind: 'jumpPress' }, // hop onto platform B (top 0.8)
  { atZ: 57, kind: 'jumpPress' }, // hop onto platform C (top 1.6)
  { atZ: 75.3, kind: 'jumpPress' }, // gap 76..81.5
  { atZ: 86, kind: 'tapLeft' }, // wall z 92 blocks screen-right
  { atZ: 106, kind: 'tapLeft' }, // spike row z 112: safe screen-left
  { atZ: 120, kind: 'tapRight' }, // spike row z 126: safe center
  { atZ: 148.5, kind: 'jumpPress' }, // gap 150..155
  // --- ACT II: transform / build (portal up at z 170, no input) ---
  { atZ: 193, kind: 'tapLeft' }, // ceiling block z 200 covers center
  // (row z 216 covers center + screen-right: screen-left already safe)
  { atZ: 228.5, kind: 'jumpPress' }, // ceiling gap 230..235
  { atZ: 237, kind: 'tapRight' }, // ceiling pad lane (x 0)
  // (ceiling pad z 243 fires passively over the 244..252 gap)
  { atZ: 281.5, kind: 'jumpPress' }, // ceiling setup jump (wide window: any takeoff 279..283.5 overlaps the orb window)
  { atZ: 284.5, kind: 'jumpPress' }, // gravity orb press edge -> floor
  // (floor pad z 314 fires passively over the 316..324 gap)
  { atZ: 348, kind: 'jumpPress' }, // orb gap takeoff (wide zone; orb re-launches)
  { atZ: 353.2, kind: 'jumpPress' }, // jump orb press edge (impulse 15)
  { atZ: 396, kind: 'tapLeft' }, // callback ceiling block z 402 covers center
  // --- ACT III: climax / release ---
  { atZ: 474, kind: 'tapRight' }, // spike row z 480: safe center
  { atZ: 488, kind: 'tapRight' }, // spike row z 494: safe screen-right
  { atZ: 538.5, kind: 'jumpPress' }, // 2x gap 540..551
  // (row z 580: screen-right already safe)
  { atZ: 600, kind: 'tapLeft' }, // spike row z 610: safe screen-left, first tap
  { atZ: 603, kind: 'tapLeft' }, // ...second tap
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
