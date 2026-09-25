/**
 * M9.4.2 HISTORICAL DRIVER — EXACT M8.6 reference policy from Git revision
 * e5b0d868c37898da906e56f682019d1cb80f77c5 (same boundary as the
 * `the-descent` level content). Byte-exact `git show` of that revision's
 * `tests/helpers/showcaseScript.ts` with ONLY identifier adaptations:
 * `ShowcaseDriver` -> `TheDescentClassicDriver` and `driveShowcaseToFinish`
 * -> `driveTheDescentClassicToFinish` (the modern GRAVITY RIFT route keeps
 * its own `ShowcaseDriver` in `showcaseScript.ts`), plus this header. No
 * policy logic touched: no M8.5 driver, no M9/M9.1 driver, no modern
 * GRAVITY RIFT driver may certify THE DESCENT.
 *
 * M9.4.2 CORRECTION: the previous file content was the M8.5-era driver
 * (30-jump policy) — wrong for the M8.6 level the human asked for.
 */
import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import type { GameSimulation } from '../../src/game/GameSimulation';
import { platformPose } from '../../src/game/movingPlatformSystem';
import { holdJump, idleInput, tapLaneLeft, tapLaneRight } from './simulation';

interface TapAction {
  atZ: number;
  /**
   * Tap direction: 'left'/'right' are physical lane keys (Floor/Ceiling
   * horizontal lanes AND Ship steering); 'up'/'down' are physical
   * Up/Down edges — the ONLY lane keys on wall gravity (sending lane
   * keys on a wall would jump/fast-fall instead — see
   * `interpretPhysicalInput`). Wall taps must be z-gated to wall sections
   * (a physical Up edge elsewhere is a jump).
   */
  dir: 'left' | 'right' | 'up' | 'down';
  /** Combine the tap with a jump press edge (same tick). */
  withJump?: boolean;
}

/** Space held without edges (thrust continuation after the press). */
const holdHeld: PhysicalInputSnapshot = {
  space: { held: true, pressedThisStep: false, releasedThisStep: false },
  up: { held: false, pressedThisStep: false, releasedThisStep: false },
  down: { held: false, pressedThisStep: false, releasedThisStep: false },
  laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
  laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
};

/** Fast-fall held without edges (down/ArrowDown held continuation). */
const holdFastFallHeld: PhysicalInputSnapshot = {
  ...idleInput,
  down: { held: true, pressedThisStep: false, releasedThisStep: false },
};

const combineTapJump = (dir: 'left' | 'right'): PhysicalInputSnapshot => ({
  ...(dir === 'left' ? tapLaneLeft : tapLaneRight),
  space: { held: true, pressedThisStep: true, releasedThisStep: false },
});

/** Single physical ArrowUp press edge (wall-gravity lane UP). */
const tapPhysicalUp: PhysicalInputSnapshot = {
  ...idleInput,
  up: { held: false, pressedThisStep: true, releasedThisStep: true },
};

/** Single physical ArrowDown press edge (wall-gravity lane DOWN). */
const tapPhysicalDown: PhysicalInputSnapshot = {
  ...idleInput,
  down: { held: false, pressedThisStep: true, releasedThisStep: true },
};

/** Resolve a tap direction to its physical snapshot. */
const tapFor = (dir: TapAction['dir']): PhysicalInputSnapshot => {
  if (dir === 'left') return tapLaneLeft;
  if (dir === 'right') return tapLaneRight;
  if (dir === 'up') return tapPhysicalUp;
  return tapPhysicalDown;
};

/**
 * Deterministic scripted driver for PRODUCTION SHOWCASE 01 (M8.6).
 *
 * A z-triggered one-shot policy over REAL physical inputs (no teleports,
 * no state edits): gap jumps, orb presses inside their windows, maze/weave
 * lane taps, fast-fall ranges, Spider snap presses, a banded Ship policy,
 * reactive jumps on Chomper lunge edges (except the low-ceiling lane
 * dodge), ferry-follow counter-steer taps while riding lateral ferries,
 * and pose-read boarding/transfer jumps on the maze ferry pair. The same
 * policy drives the automated completion, the recorded replay, the route
 * metrics and the browser QA harness.
 *
 * `variant: 'primary'` takes the ACT 2 pad→MID→HIGH orb line, the maze
 * upper deck, the ACT 8 HIGH deck elevator drop; `variant: 'alternate'`
 * takes the ACT 2 LOW weave, different maze doors, the lower deck and the
 * ACT 8 LOW deck. Both reconnect deterministically.
 */
export class TheDescentClassicDriver {
  private jumps: number[];
  private taps: TapAction[];
  private spiderPresses: number[];
  private fastFallRanges: Array<[number, number]>;
  private jumpedChompers = new Set<string>();
  private releasingJump = false;
  private holdingShip = false;
  private tick = 0;
  private lastFerryTapTick = -999;
  private mazePairStage = 0;
  private wasRidingFerry = false;
  private lastFerryId: string | null = null;
  private recentering = false;
  private recenterUntilZ = 0;
  private recenterTarget = 1;

  constructor(variant: 'primary' | 'alternate' = 'primary') {
    // Shared trunk jumps (acts 1/4/5/6-exit/7-run/9).
    const trunkJumps = [
      18, // A1 entry gap
      36, 43, 53, // A1 stairs + step-to-deck (early takeoffs: land mid-tread
      // with room for the next 1.5 riser — the frozen jump envelope needs
      // ~3 u of run-up per riser)
      104, // A1 catcher hop (spike 108)
      138, // A1 river
      147, 153, 161, // A1 spikes
      728, // A4 floor spike
      756.5, 766.5, // A4 ceiling spikes
      769, // A4 ceiling gap
      786.5, // A4 ceiling spike
      904, 913.5, // A4 gravity-orb presses (pad flight + ceiling return)
      913.5, // A4 shaft-exit spike
      933, // A5 ferry board
      957, // A5 ferry exit
      1042.5, // A5 lava strip
      1066, // A5 post spike
      1077, // foundry-exit rhythm hop (open center lane)
      1087.5, 1097.5, // ship-approach rhythm hops
      869.5, 879.5, // spire-entry rhythm hops
      427, 439, // maze-approach rhythm hops
      520, 534, 548, // lower-deck rhythm hops (open road / upper flight)
      346, 354, 364, // HIGH-drop rhythm (open slabs, lane-neutral)
      572, // upper-deck hole rhythm hop
      640, // maze-exit slab rhythm hop
      1318, // ship-exit rhythm hop (open runway)
    ];
    const primaryJumps = [
      ...trunkJumps,
      // ACT 2 islands + stairs + HIGH orb line.
      172.5, 182.5, 192.5, 202.5, 211.5, 221.5, 234,
      319, // HIGH spike
      329, // HIGH gap takeoff (orb 333.5 fires mid-flight)
      333, // orb press edge inside the window
      376, // ferry board jump
      401, // ferry exit jump
      412, // far-runway spike
      // ACT 3 maze rhythm hops + upper deck holes + exit gap.
      459.5, 469.5, 489.5, 499.5, 559, 583, 623,
      // ACT 3 upper rhythm hops.
      597, 609,
      // ACT 2 traverse rhythm hops.
      245.5, 255.5,
      // ACT 8 HIGH deck (approach hop + two orb gaps + lift exit).
      1503.5, 1542, 1546.5, 1558, 1562.5, 1577.5, 1587,
      // ACT 9 finale (island hops + boosted void-gap jump + river).
      1633, 1642, 1651, 1660.5, 1767.5,
    ];
    const alternateJumps = [
      ...trunkJumps.filter((z) => z !== 1550.5),
      172.5, 182.5, 192.5, 202.5, 212.5, 227.5, 270, // islands + gap hop + LOW road
      242, 256, // LOW road rhythm hops (open slabs)
      313, 326, 338.5, // LOW ground-route spike rhythm (lane-neutral hops)
      376, // ferry board jump
      401, // ferry exit jump
      412, // far-runway spike
      460, 485, // maze spike rhythm (lane-neutral, preserves weave lanes)
      559, 583, 594, 604.5, 621, // lower-deck spike + exit gap (take off!)
      1507, // gantry approach spike (lane 2)
      1543, 1553, 1565, // LOW deck holes + spike
      1587, // reconnect hop spike (shared runway)
      1633, 1642, 1651, 1660.5, 1767.5,
    ];
    const trunkTaps: TapAction[] = [
      // A1 weave doors (alternating 2/1/0 — one change per door).
      { atZ: 60, dir: 'right' },
      { atZ: 69, dir: 'left' },
      { atZ: 81, dir: 'left' },
      // Deck-end drop: combined jump + recenter — the catcher island is
      // center-only (x ±1.3), so the flight carries the lane back to 1.
      { atZ: 89, dir: 'right', withJump: true },
      // A1 catcher-road weave (open road; 1 → 2 → 1, islands run center).
      { atZ: 118, dir: 'right' },
      { atZ: 126, dir: 'left' },
      // A4 ceiling spike weaves (lane 2, then lane 1 for the last).
      { atZ: 750, dir: 'right' },
      { atZ: 782, dir: 'left' },
      // A4 left-wall rhythm (vertical lane taps on the open wall).
      { atZ: 802, dir: 'up' },
      { atZ: 822, dir: 'down' },
      // A4 wall staircase (UP around y-3, DOWN before y-5.6).
      { atZ: 844, dir: 'up' },
      { atZ: 856, dir: 'down' },
      // A5 weave (recentered to lane 0): double-right to lane 2, left back.
      { atZ: 975, dir: 'right' },
      { atZ: 977, dir: 'right' },
      { atZ: 984.5, dir: 'left' },
      { atZ: 1018, dir: 'left' },
      { atZ: 1025, dir: 'right' },
      { atZ: 1048, dir: 'right' },
      { atZ: 1056, dir: 'left' },
      // A6 pillar slalom + S-weave pillar + recenter for the gates.
      { atZ: 1172, dir: 'right' },
      { atZ: 1186, dir: 'left' },
      { atZ: 1274, dir: 'left' },
      { atZ: 1280, dir: 'right' },
      // A7 temple ceiling spike.
      { atZ: 1352, dir: 'left' },
      { atZ: 1366, dir: 'right' },
      // A7 wall staircase (UP on the left wall, DOWN on the right).
      { atZ: 1463, dir: 'up' },
      { atZ: 1475, dir: 'down' },
      // A9 weave (lane 0 through the 2× gates, then lane 1).
      { atZ: 1658, dir: 'left' },
      { atZ: 1660, dir: 'left' },
      { atZ: 1684, dir: 'right' },
      // A9 ceiling-rise spike dodge (lane 0) + recenter for the gates.
      { atZ: 1698, dir: 'left' },
      { atZ: 1705, dir: 'right' },
      // A9 wall burst (UP past the y-1 spike, hold lane 2 to the high gate).
      { atZ: 1722, dir: 'up' },
      // Wall-exit recenter (lane 2 → lane 1 for the spider ring).
      { atZ: 1736, dir: 'left' },
      // Finale Chomper lane dodge (lane 1 → lane 0, short lunge).
      { atZ: 1754, dir: 'left' },
      // Post-river recenter (lane 0 → lane 1 for the calm gate).
      { atZ: 1772, dir: 'right' },
    ];
    const primaryTaps: TapAction[] = [
      ...trunkTaps,
      // A2 MID deck spikes.
      { atZ: 286, dir: 'right' },
      { atZ: 296, dir: 'left' },
      // A3 maze doors + rhythm spikes (lane 1, lane 1, lane 0, lane 2).
      { atZ: 468, dir: 'left' },
      { atZ: 476, dir: 'right' },
      { atZ: 498, dir: 'right' },
      { atZ: 520, dir: 'left' },
      // A3 2× weave (lane 1 through 700, lane 0 through 708 + 712),
      // then recenter for the speed/gravity gates.
      { atZ: 700, dir: 'left' },
      { atZ: 714, dir: 'right' },
      // A9 islands lane changes.
      { atZ: 1634.5, dir: 'left' },
      { atZ: 1645.5, dir: 'right' },
      { atZ: 1646.2, dir: 'right' },
    ];
    const alternateTaps: TapAction[] = [
      ...trunkTaps,
      // A2 LOW split (land the LOW road, then slide clear of the pad).
      { atZ: 215, dir: 'left' },
      // A2 LOW road weave (open road, lane-neutral pair).
      { atZ: 285, dir: 'left' },
      { atZ: 297, dir: 'right' },
      // A3 maze doors (lane 2, lane 0, lane 2).
      { atZ: 445, dir: 'right' },
      { atZ: 475, dir: 'left' },
      { atZ: 477, dir: 'left' },
      { atZ: 502, dir: 'right' },
      { atZ: 504, dir: 'right' },
      // A3 2× weave (lane 1 through 700, lane 0 through 708 + 712),
      // then recenter for the speed/gravity gates.
      { atZ: 700, dir: 'left' },
      { atZ: 714, dir: 'right' },
      // A8 LOW entry (early, before the lane-1 approach spike) +
      // reconnect recenter for the shared maw.
      { atZ: 1501, dir: 'right' },
      { atZ: 1585, dir: 'left' },
      // A9 islands lane changes.
      { atZ: 1634.5, dir: 'left' },
      { atZ: 1645.5, dir: 'right' },
      { atZ: 1646.2, dir: 'right' },
    ];
    // Shared Spider snap presses: dodge walls, ceiling returns, climb
    // shaft, wall↔wall snaps, remix pair.
    const presses = [
      1344, 1356, 1364, 1376, 1384, 1396,
      1400.1, 1414, 1424, 1430, 1435,
      1445, 1452, // runway dodge-wall snap pair (up under the slab, down past)
      1472, 1482,
      1743, 1749,
    ];
    this.jumps = [...(variant === 'primary' ? primaryJumps : alternateJumps)].sort((a, b) => a - b);
    const taps = variant === 'primary' ? primaryTaps : alternateTaps;
    this.taps = taps.map((t) => ({ ...t })).sort((a, b) => a.atZ - b.atZ);
    this.spiderPresses = [...presses];
    // Fast-fall ranges (z windows where ArrowDown stays held airborne).
    // NOTE: the A1 drop chamber needs NO fast-fall (the natural fall
    // lands the catcher; holding down drives into its face).
    // The maw-exit dive is shared trunk (both variants fall 1614 → slab).
    const trunkFF: Array<[number, number]> = [[1613, 1618]];
    this.fastFallRanges = variant === 'primary'
      ? [...trunkFF, [359, 364], [1572, 1580]]
      : [...trunkFF];
  }

  public nextInput(z: number, sim: GameSimulation): PhysicalInputSnapshot {
    this.tick++;
    if (this.releasingJump) {
      this.releasingJump = false;
      return idleInput;
    }
    // Ship abyss (mode-observed, banded PD altitude policy per z —
    // velocity-damped: pure banded control limit-cycles into the teeth).
    if (sim.playerMode === 'ship') {
      const target = this.shipTarget(z);
      const y = sim.player.position.y;
      const vy = sim.player.velocity.y;
      const inverted = sim.gravityMode === 'ceiling';
      const predicted = y + vy * 0.2;
      const hold = inverted ? predicted > target + 0.1 : predicted < target - 0.1;
      if (hold) {
        const first = !this.holdingShip;
        this.holdingShip = true;
        return first ? holdJump : holdHeld;
      }
      this.holdingShip = false;
      // Lane steering still available inside the bands (one-shot taps).
      const tap = this.taps[0];
      if (tap !== undefined && z >= tap.atZ && z < tap.atZ + 30) {
        this.taps.shift();
        return tapFor(tap.dir);
      }
      return idleInput;
    }
    this.holdingShip = false;
    // Ferry-follow counter-steer: while riding a lateral ferry, tap
    // toward the deck center (throttled — the deck crawls). Follow taps
    // drift lane intent, so the run recenters to lane 1 after dismount
    // (readable intent — converges exactly before the maze / spire).
    const support = sim.player.supportColliderId;
    const ridingFerry =
      support !== null && support.startsWith('platform-ps-ferry-') && sim.playerMode === 'cube';
    // Air-follow: while airborne over a lateral ferry just ridden (e.g.
    // a Chomper-dodge jump off the deck), keep steering toward the deck
    // so the landing is solid, not a corner graze. The lane servo would
    // otherwise recenter mid-flight and dump the rider off the edge.
    if (
      !ridingFerry && this.wasRidingFerry && sim.playerMode === 'cube' &&
      sim.gravityMode === 'floor' && this.tick - this.lastFerryTapTick > 15
    ) {
      const idx = sim.platformIndexForSupportId(this.lastFerryId);
      const st = sim.platformStates[idx];
      const def = sim.level.movingPlatforms[idx];
      if (idx >= 0 && st !== undefined && def !== undefined && def.axis === 'x') {
        const dz = sim.player.position.z;
        const deckZ0 = def.base.z - def.halfExtents.z - 5;
        const deckZ1 = def.base.z + def.halfExtents.z;
        if (dz >= deckZ0 && dz <= deckZ1) {
          const dx = st.x - sim.player.position.x;
          if (Math.abs(dx) > 0.5) {
            this.lastFerryTapTick = this.tick;
            return dx > 0 ? tapLaneLeft : tapLaneRight;
          }
        }
      }
    }
    if (!ridingFerry && this.wasRidingFerry) {
      this.recentering = true;
      this.recenterUntilZ = z + 45;
      // The chomp-ferry exit feeds the lane-0 weave gate directly.
      this.recenterTarget = z > 900 ? 0 : 1;
    }
    this.wasRidingFerry = ridingFerry;
    if (this.recentering && sim.playerMode === 'cube' && sim.gravityMode === 'floor') {
      const t = sim.player.targetLaneIndex;
      if (t === this.recenterTarget || z > this.recenterUntilZ) {
        this.recentering = false;
      } else if (this.tick - this.lastFerryTapTick > 10) {
        this.lastFerryTapTick = this.tick;
        return t < this.recenterTarget ? tapLaneRight : tapLaneLeft;
      }
    }
    if (ridingFerry) {
      this.lastFerryId = support;
      const idx = sim.platformIndexForSupportId(support);
      const st = sim.platformStates[idx];
      if (idx >= 0 && st !== undefined) {
        const dx = st.x - sim.player.position.x;
        if (Math.abs(dx) > 0.8 && this.tick - this.lastFerryTapTick > 15) {
          this.lastFerryTapTick = this.tick;
          return dx > 0 ? tapLaneLeft : tapLaneRight;
        }
      }
    }
    // Maze ferry pair (pose-read boarding/transfer/exit jumps).
    if (sim.playerMode === 'cube' && sim.gravityMode === 'floor' && z > 650 && z < 695) {
      const jump = this.mazePairJump(z, sim);
      if (jump !== null) {
        this.releasingJump = true;
        return holdJump;
      }
    }
    // Reactive Chomper jumps: press on the lunge-start edge (once each).
    // The low-ceiling and finale Chompers are lane dodges, never jumps.
    for (let i = 0; i < sim.chomperStates.length; i++) {
      const st = sim.chomperStates[i];
      const def = sim.level.chompers[i];
      if (
        st !== undefined && def !== undefined && st.phase === 'lunging' &&
        def.id !== 'ps-chomp-low' && def.id !== 'ps-chomp-final' &&
        !this.jumpedChompers.has(def.id)
      ) {
        this.jumpedChompers.add(def.id);
        this.releasingJump = true;
        return holdJump;
      }
    }
    // One-shot Spider presses.
    const press = this.spiderPresses[0];
    if (press !== undefined && z >= press && sim.playerMode === 'spider') {
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
    // One-shot lane taps (optionally combined with a jump edge).
    const tap = this.taps[0];
    if (tap !== undefined && z >= tap.atZ) {
      this.taps.shift();
      if (tap.withJump === true) {
        this.releasingJump = true;
        return combineTapJump(tap.dir === 'left' ? 'left' : 'right');
      }
      return tapFor(tap.dir);
    }
    // Fast-fall ranges (held while airborne inside the window).
    for (const [z0, z1] of this.fastFallRanges) {
      if (z >= z0 && z <= z1) return holdFastFallHeld;
    }
    return idleInput;
  }

  /** Banded Ship altitude targets (tuned ride lines — see ACT 6 notes). */
  private shipTarget(z: number): number {
    if (z < 1128) return 3.4; // rise over the top-2 wall
    if (z < 1140) return 4.0; // settle for the dive block
    if (z < 1146) return 3.5; // dive under (bottom 6)
    if (z < 1200) return 3.0; // teeth slalom cruise
    if (z < 1232) return 6.3; // inverted cruise (ribs at 7.5)
    if (z < 1243) return 3.5; // mid slot dive (slot 2..5, lead the drop)
    if (z < 1250) return 6.3; // back up before the revert
    if (z < 1264) return 2.5; // S-weave under the high block
    if (z < 1286) return 3.5; // over the low block, around the pillar
    if (z < 1302) return 3.0; // inverted burst cruise
    return 3.0;
  }

  /**
   * Maze ferry-pair transfers (deterministic pose reads — the phases are
   * authored so deck A is boardable on arrival and deck B meets it at the
   * far end of A's traverse).
   */
  private mazePairJump(z: number, sim: GameSimulation): boolean | null {
    const idxA = sim.level.movingPlatforms.findIndex((p) => p.id === 'ps-ferry-maze-a');
    const idxB = sim.level.movingPlatforms.findIndex((p) => p.id === 'ps-ferry-maze-b');
    const stA = sim.platformStates[idxA];
    const stB = sim.platformStates[idxB];
    if (stA === undefined || stB === undefined) return null;
    const support = sim.player.supportColliderId;
    // Adopt: if already riding deck A (e.g. fell onto it when the board
    // window was missed), skip boarding and go straight to transfer.
    if (this.mazePairStage === 0 && support === 'platform-ps-ferry-maze-a') {
      this.mazePairStage = 1;
    }
    // Stage 0: board deck A — fire when the deck WILL cover the lane
    // line at landing (pose 75 ticks out: one full jump flight). Phase-
    // robust: adapts to any arrival tick or authored phase.
    // Takeoff must land ON deck A (665..671): z + 8.8 flight ⇒ z > 656.2.
    if (this.mazePairStage === 0 && z > 656.2 && z < 660 && support !== 'platform-ps-ferry-maze-a') {
      const defA = sim.level.movingPlatforms[idxA];
      if (defA !== undefined) {
        const future = { x: 0, y: 0, z: 0 };
        platformPose(defA, sim.platformTick + 75, future);
        if (Math.abs(future.x) < 2.0) {
          this.mazePairStage = 1;
          return true;
        }
      }
      return null;
    }
    // Stage 1: transfer A → B when the decks align (opposite phases meet
    // periodically — fire on X-proximity, never on an absolute threshold
    // that can sit outside the ride window).
    if (this.mazePairStage === 1 && support === 'platform-ps-ferry-maze-a') {
      if (Math.abs(stA.x - stB.x) < 2.2 && z > 657) {
        this.mazePairStage = 2;
        return true;
      }
      return null;
    }
    // Stage 2: exit B onto the far slab.
    if (this.mazePairStage === 2 && support === 'platform-ps-ferry-maze-b' && z > 679) {
      this.mazePairStage = 3;
      return true;
    }
    return null;
  }
}

export const driveTheDescentClassicToFinish = (
  sim: GameSimulation,
  driver: TheDescentClassicDriver = new TheDescentClassicDriver(),
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
