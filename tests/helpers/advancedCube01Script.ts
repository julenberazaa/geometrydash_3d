import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import { holdFastFall, holdFastFallHeld, holdJump, idleInput, tapLaneLeft, tapLaneRight } from './simulation';

/**
 * Deterministic scripted playthrough driver for Advanced Cube 01 (M7.2).
 *
 * A z-triggered one-shot action list driven by the REAL simulation state —
 * legal physical inputs only (lane taps, jump presses, one fast-fall hold;
 * no debug placement, no state mutation). The teleport, pads, gravity
 * portals and speed portals fire passively from level data.
 *
 * Timing notes (base speed 12 u/s, 2x tier 24 u/s; jump airtime 0.629 s =>
 * 7.55 u at 1x / 15.1 u at 2x; ceiling pad 22 / floor pad 23 / orb 15):
 * see the envelope comments in src/content/levels/advancedCube01.ts.
 *
 * This script is a verification route (it proves the level CAN be completed),
 * not a claim about the ideal human route.
 */
export type AdvancedCube01ActionKind = 'tapRight' | 'tapLeft' | 'jumpPress' | 'fastFall';

export interface AdvancedCube01Action {
  /** First tick whose player z >= atZ triggers the action (once). */
  atZ: number;
  kind: AdvancedCube01ActionKind;
  /** For fastFall: how many ticks to hold ArrowDown (press edge + holds). */
  ticks?: number;
}

export const ADVANCED_CUBE_01_SCRIPT: readonly AdvancedCube01Action[] = [
  // --- PHASE 1: precision ascent ---
  { atZ: 19, kind: 'jumpPress' }, // bridge spike z 22
  { atZ: 28.5, kind: 'jumpPress' }, // gap 30..34 takeoff
  { atZ: 30.5, kind: 'tapRight' }, // ...move right -> LOW right island
  { atZ: 44.5, kind: 'jumpPress' }, // gap 46..50 takeoff
  { atZ: 46.5, kind: 'tapLeft' }, // ...move left -> MID center (rise)
  { atZ: 60.5, kind: 'jumpPress' }, // gap 62..66 takeoff
  { atZ: 62.5, kind: 'tapLeft' }, // ...move left -> MID left island
  { atZ: 76.5, kind: 'jumpPress' }, // gap 78..82 takeoff
  { atZ: 78.5, kind: 'tapRight' }, // ...move right -> HIGH center (rise)
  // (drop 94..98 onto the two-lane at center: no input)
  { atZ: 106, kind: 'tapLeft' }, // spike z 112 covers C -> L
  { atZ: 116, kind: 'tapRight' }, // spike z 122 covers L -> C
  { atZ: 126.5, kind: 'jumpPress' }, // gap 128..132 takeoff (straight)
  { atZ: 146.5, kind: 'jumpPress' }, // gap 148..152
  // --- PHASE 2: hazard garden ---
  { atZ: 174.5, kind: 'jumpPress' }, // gap 176..180 step-up to MID
  { atZ: 198, kind: 'tapRight' }, // spike z 202 covers C -> R
  { atZ: 208.5, kind: 'jumpPress' }, // gap 210..214 takeoff (rise HIGH)
  { atZ: 224.5, kind: 'jumpPress' }, // gap 226..231 takeoff
  { atZ: 226.5, kind: 'tapLeft' }, // ...move left -> HIGH center
  { atZ: 233, kind: 'jumpPress' }, // island spike z 235
  // FAST-FALL GATE: jump off HIGH, hold down to land mid-island (247..253).
  { atZ: 243.5, kind: 'jumpPress' },
  { atZ: 244.5, kind: 'fastFall', ticks: 22 },
  { atZ: 251.5, kind: 'jumpPress' }, // gap 253..257 takeoff
  { atZ: 263.5, kind: 'jumpPress' }, // full-width spike row z 266
  { atZ: 275.5, kind: 'jumpPress' }, // gap 277..281 takeoff
  { atZ: 288, kind: 'jumpPress' }, // bridge spike z 290
  { atZ: 299.5, kind: 'jumpPress' }, // gap 301..305
  // --- PHASE 3: ceiling world (portal up z 322, no input) ---
  { atZ: 338, kind: 'tapRight' }, // ceiling spike z 344 covers C -> R
  { atZ: 354, kind: 'tapLeft' }, // ceiling spike z 360 covers R -> C
  { atZ: 374.5, kind: 'jumpPress' }, // ceiling gap 376..380
  // (ceiling pad z 391 fires passively over the 392..400 gap)
  { atZ: 417.5, kind: 'jumpPress' }, // ceiling setup jump (down off ceiling)
  { atZ: 419.5, kind: 'jumpPress' }, // gravity orb press edge -> MID floor
  // (MID spike z 428 covers R: stay center; floor pad z 437 fires passively)
  { atZ: 465.5, kind: 'jumpPress' }, // gap 467..471
  { atZ: 479, kind: 'jumpPress' }, // bridge spike z 481
  { atZ: 489.5, kind: 'jumpPress' }, // gap 491..495
  { atZ: 503, kind: 'jumpPress' }, // anticipation spike z 505
  // (teleport entry z 514 -> exit z 634: no input)
  // --- PHASE 4: post-teleport furnace + orb ---
  // (exit lands grounded center; spike z 646 covers R: stay center)
  { atZ: 654, kind: 'jumpPress' }, // drop gap 656..660 (hop down to LOW)
  { atZ: 674, kind: 'jumpPress' }, // orb gap takeoff
  { atZ: 678.3, kind: 'jumpPress' }, // jump orb press edge (impulse 15)
  { atZ: 698, kind: 'jumpPress' }, // approach spike z 700
  // (2x portal z 708: no input)
  // --- PHASE 5: 2x storm climax ---
  { atZ: 728, kind: 'jumpPress' }, // 2x gap 732..743 takeoff
  { atZ: 730, kind: 'tapRight' }, // ...move right -> LOW right island
  { atZ: 759, kind: 'jumpPress' }, // 2x island spike z 762
  { atZ: 781, kind: 'jumpPress' }, // 2x gap 783..793 takeoff
  { atZ: 783, kind: 'tapLeft' }, // ...move left -> MID center (rise)
  { atZ: 823.5, kind: 'jumpPress' }, // 2x gap 825..833 takeoff
  { atZ: 825, kind: 'tapLeft' }, // ...move left -> HIGH left (rise)
  // (drop 855..859 onto the two-lane: no input)
  { atZ: 864, kind: 'tapRight' }, // 2x spike z 874 covers L -> C
  { atZ: 878, kind: 'tapLeft' }, // spike z 886 covers C -> L
  // (1x portal z 873 rides along inside the weave)
  { atZ: 894, kind: 'tapRight' }, // epilogue spike z 899 covers L -> C
  { atZ: 913.5, kind: 'jumpPress' }, // gap 915..919 takeoff
  { atZ: 925, kind: 'jumpPress' }, // final island spike z 927
  { atZ: 933.5, kind: 'jumpPress' }, // gap 935..939 -> release/finish
];

/** One-shot z-triggered script runner (reusable; one instance per attempt). */
export class AdvancedCube01Driver {
  private index = 0;
  private releasingJump = false;
  private ffLeft = 0;

  constructor(private readonly actions: readonly AdvancedCube01Action[] = ADVANCED_CUBE_01_SCRIPT) {}

  /** Input for the next tick, given the player's current z. */
  public nextInput(z: number): PhysicalInputSnapshot {
    if (this.releasingJump) {
      this.releasingJump = false;
      return idleInput;
    }
    if (this.ffLeft > 0) {
      this.ffLeft -= 1;
      return holdFastFallHeld;
    }
    const action = this.actions[this.index];
    if (action !== undefined && z >= action.atZ) {
      this.index += 1;
      if (action.kind === 'tapRight') return tapLaneRight;
      if (action.kind === 'tapLeft') return tapLaneLeft;
      if (action.kind === 'fastFall') {
        this.ffLeft = (action.ticks ?? 20) - 1;
        return holdFastFall;
      }
      this.releasingJump = true;
      return holdJump;
    }
    return idleInput;
  }

  public get done(): boolean {
    return this.index >= this.actions.length && !this.releasingJump && this.ffLeft === 0;
  }
}
