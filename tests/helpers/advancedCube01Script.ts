import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import { holdFastFall, holdFastFallHeld, holdJump, idleInput, tapLaneLeft, tapLaneRight } from './simulation';

/**
 * Deterministic scripted playthrough driver for Advanced Cube 01 (M7.3).
 *
 * A z-triggered one-shot action list driven by the REAL simulation state —
 * legal physical inputs only (lane taps, jump presses, one fast-fall hold;
 * no debug placement, no state mutation). Teleports, pads, gravity
 * portals and speed portals fire passively from level data.
 *
 * Timing notes (base speed 12 u/s, 2x tier 24 u/s; jump airtime 0.629 s =>
 * 7.55 u at 1x / 15.1 u at 2x; ceiling pad 22 / floor pad 23 / orb 15):
 * see the envelope comments in src/content/levels/advancedCube01.ts.
 *
 * M7.3 route deltas vs M7.2: Phase-1 offset island pair (drop-drift L,
 * two island spikes, mid-air transfer R), Phase-2 maze wall (hold C) +
 * offset island pair (transfer R), third ceiling spike, short-hop teleport
 * (mid-air ring 489 → exit 513), maw entry 524, Phase-4 commit pair
 * (wall-hold C, spike-commit R, drop-transfer C), HIGH island spike 845,
 * release hop (finish 960).
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
  { atZ: 19, kind: 'jumpPress' }, // tall bridge spike z 22
  { atZ: 28.5, kind: 'jumpPress' }, // gap 30..34 takeoff
  { atZ: 30.5, kind: 'tapRight' }, // ...move right -> LOW right island
  { atZ: 44.5, kind: 'jumpPress' }, // gap 46..50 takeoff
  { atZ: 46.5, kind: 'tapLeft' }, // ...move left -> MID center (rise)
  { atZ: 60.5, kind: 'jumpPress' }, // gap 62..66 takeoff
  { atZ: 62.5, kind: 'tapLeft' }, // ...move left -> MID left island
  { atZ: 76.5, kind: 'jumpPress' }, // gap 78..82 takeoff
  { atZ: 78.5, kind: 'tapRight' }, // ...move right -> HIGH center (rise)
  { atZ: 92, kind: 'tapLeft' }, // drop-drift left -> L island 98..112
  { atZ: 102, kind: 'jumpPress' }, // L island spike z 106
  { atZ: 110, kind: 'jumpPress' }, // gap 112..116 takeoff (lands C island)
  { atZ: 112.5, kind: 'tapRight' }, // ...move right -> C island 116..136
  { atZ: 124, kind: 'jumpPress' }, // C island spike z 127
  { atZ: 134, kind: 'jumpPress' }, // gap 136..138 takeoff
  { atZ: 146.5, kind: 'jumpPress' }, // gap 148..152
  // --- PHASE 2: hazard garden (maze wall: hold center) ---
  { atZ: 174.5, kind: 'jumpPress' }, // gap 176..180 step-up to MID
  { atZ: 191.5, kind: 'jumpPress' }, // maze wall z 194..196 (jump it)
  { atZ: 198, kind: 'tapRight' }, // spike z 202 covers C -> R
  { atZ: 208.5, kind: 'jumpPress' }, // gap 210..214 takeoff (rise HIGH)
  { atZ: 224.5, kind: 'jumpPress' }, // gap 226..231 takeoff
  { atZ: 226.5, kind: 'tapLeft' }, // ...move left -> HIGH center
  { atZ: 233, kind: 'jumpPress' }, // island spike z 235
  // FAST-FALL GATE: jump off HIGH, hold down to land mid-island (247..253).
  { atZ: 243.5, kind: 'jumpPress' },
  { atZ: 244.5, kind: 'fastFall', ticks: 22 },
  { atZ: 251, kind: 'jumpPress' }, // gap 253..257 takeoff
  { atZ: 261, kind: 'jumpPress' }, // C island spike z 264
  { atZ: 269, kind: 'tapRight' }, // ...move right during the gap arc -> R island 274..286
  { atZ: 269.5, kind: 'jumpPress' }, // gap 272..274 takeoff (lands centered first, transfers mid-air)
  { atZ: 283, kind: 'tapLeft' }, // ...drift back to center bridge
  { atZ: 284.5, kind: 'jumpPress' }, // gap 286..290 takeoff
  { atZ: 292.5, kind: 'jumpPress' }, // bridge spike z 295
  { atZ: 300.5, kind: 'jumpPress' }, // step-up gap 303..307
  // --- PHASE 3: ceiling world (portal up z 322, no input) ---
  { atZ: 338, kind: 'tapRight' }, // ceiling spike z 344 covers C -> R
  { atZ: 354, kind: 'tapLeft' }, // ceiling spike z 360 covers R -> C
  { atZ: 362, kind: 'jumpPress' }, // ceiling spike z 364
  { atZ: 374.5, kind: 'jumpPress' }, // ceiling gap 376..380
  // (ceiling pad z 391 fires passively over the 392..400 gap)
  { atZ: 417.5, kind: 'jumpPress' }, // ceiling setup jump (down off ceiling)
  { atZ: 419.5, kind: 'jumpPress' }, // gravity orb press edge -> MID floor
  // (MID spike z 428 + wall z 432 cover L: hold center; floor pad z 437)
  { atZ: 465.5, kind: 'jumpPress' }, // gap 467..471
  { atZ: 478, kind: 'jumpPress' }, // bridge spike z 481 (flies the hop ring)
  // (short-hop teleport 489 -> exit 513 over the lava lake: no input)
  { atZ: 515, kind: 'jumpPress' }, // runway spike z 518
  // (maw teleport 524 -> exit 634: no input)
  // --- PHASE 4: post-teleport furnace + orb ---
  // (exit lands grounded center; wall z 640 covers R: hold center)
  { atZ: 648, kind: 'tapRight' }, // spike z 654 covers C -> R
  { atZ: 653.5, kind: 'jumpPress' }, // drop gap 656..660 (hop down to LOW)
  { atZ: 656, kind: 'tapLeft' }, // ...drift back to center island
  { atZ: 674, kind: 'jumpPress' }, // orb gap takeoff
  { atZ: 678.3, kind: 'jumpPress' }, // jump orb press edge (impulse 15)
  { atZ: 697, kind: 'jumpPress' }, // approach spike z 700
  // (2x portal z 708: no input)
  // --- PHASE 5: 2x storm climax ---
  { atZ: 728, kind: 'jumpPress' }, // 2x gap 732..743 takeoff
  { atZ: 730, kind: 'tapRight' }, // ...move right -> LOW right island
  { atZ: 755.5, kind: 'jumpPress' }, // 2x tall spike pair z 760/764
  { atZ: 781, kind: 'jumpPress' }, // 2x gap 783..793 takeoff
  { atZ: 783, kind: 'tapLeft' }, // ...move left -> MID center (rise)
  { atZ: 822.5, kind: 'jumpPress' }, // 2x gap 825..833 takeoff
  { atZ: 825, kind: 'tapLeft' }, // ...move left -> HIGH left (rise)
  { atZ: 842, kind: 'jumpPress' }, // HIGH island spike z 846
  // (drop 855..859 onto the two-lane: no input; wall z 908 covers L)
  { atZ: 864, kind: 'tapRight' }, // 2x spike z 874 covers L -> C
  { atZ: 878, kind: 'tapLeft' }, // spike z 886 covers C -> L
  // (1x portal z 873 rides along inside the weave)
  { atZ: 894, kind: 'tapRight' }, // epilogue spike z 899 covers L -> C
  { atZ: 913.5, kind: 'jumpPress' }, // gap 915..919 takeoff
  { atZ: 924, kind: 'jumpPress' }, // tall final island spike z 927
  { atZ: 933.5, kind: 'jumpPress' }, // gap 935..939 -> release runway
  { atZ: 949.5, kind: 'jumpPress' }, // release gap 951..955 -> finish island
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
