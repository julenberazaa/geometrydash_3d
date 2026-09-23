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
export class ShowcaseDriver {
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
  /**
   * M9 lane-lazy probe: drops every authored lane tap AND the reactive
   * ferry-follow/recenter steering (jump edges from combined tap+jumps are
   * preserved as plain jumps). If this variant still finishes, the route
   * does not force lane discipline there — the openness audit uses it to
   * prove funnels work (lazy must die where routing is precise).
   */
  private readonly laneLazy: boolean;

  constructor(variant: 'primary' | 'alternate' = 'primary', opts: { laneLazy?: boolean } = {}) {
    // Shared trunk jumps (acts 1/4/5/6-exit/7-run/9).
    // M9.1 ACT 1: island chain + offset stairs + pier hop + shaft
    // double-transfer + slalom weave + river + kept double + exit drop.
    // (withJump transfers live in trunkTaps, not here — one edge each.
    // Pop-over takeoffs keep ≥ 2 u lead before the spike face — the rise
    // needs ~0.6 u to clear a 0.5 top.)
    const trunkJumps = [
      2.5, 76, 86.3, 127.5, 138.5,
      // M9 post-river double (lane-1 spikes 160 + 164 — two takeoffs).
      147, 157.5, 172.3,
      // M9.1 ACT 2 shared: island chain (takeoffs ≥ 0.7 u post-landing)
      // + far-runway second hop. (The pad hop is primary-only — the
      // alternate would waste it mid-air over its own later hop.)
      186, 224, 424,
      728, // A4 floor spike
      756.5, 766.5, // A4 ceiling spikes
      769, // A4 ceiling gap
      786.5, // A4 ceiling spike
      // M9 beat-127/129 orb windows (track the shifted orbs).
      901.5, 915, // A4 gravity-orb presses (pad flight + ceiling return)
      913.5, // A4 shaft-exit spike
      933, // A5 ferry board
      957, // A5 ferry exit
      1042.5, // A5 lava strip (2× flight clears the strip + lunge head)
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
      // M9.1 ACT 2 HIGH orb line (entry chain + stairs are trunk-shared).
      263, // pad hop (lands on the pad → MID deck)
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
      // ACT 8 HIGH deck (approach hop + two orb gaps + lift exit — orb
      // presses track their windows: A mid-window, B mid-window).
      1503.5, 1542, 1545.8, 1558, 1560.5, 1577.5, 1587,
      // ACT 9 finale (island hops + boosted void-gap jump + river).
      1633, 1642, 1651, 1660.5, 1767.5,
    ];
    const alternateJumps = [
      ...trunkJumps.filter((z) => z !== 1550.5),
      244, // drop-jump off stair 1 (lands LOW road)
      254.5, // lane-0 hop (spike 257)
      269.5, // side-strip hop (lane-0 spike 272)
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
      // M9.1 A1 island/stair/pier/shaft transfers (jump + steer combined —
      // the plain-jump list above carries no lateral edge for these).
      { atZ: 13.5, dir: 'right', withJump: true }, // B → C (lane 2)
      { atZ: 24.5, dir: 'left', withJump: true }, // C → D (lane 0, first)
      { atZ: 25.5, dir: 'left' }, // C → D (second edge)
      { atZ: 35.5, dir: 'right', withJump: true }, // D → funnel (center)
      { atZ: 49.5, dir: 'left', withJump: true }, // funnel → tread 1 (apex on the face)
      { atZ: 63.5, dir: 'right', withJump: true }, // tread 1 → tread 2
      { atZ: 64.5, dir: 'right' }, // tread 2 (second edge, mid-flight)
      { atZ: 70, dir: 'left' }, // bridge prep (mid-flight recenter)
      { atZ: 95.5, dir: 'right' }, // pier tooth → drop-side lane (no jump)
      { atZ: 107.5, dir: 'left', withJump: true }, // catcher A → B
      { atZ: 108.5, dir: 'left' }, // catcher B (second edge)
      { atZ: 116.8, dir: 'right', withJump: true }, // catcher B → road (rhythm: rise before the face)
      { atZ: 126, dir: 'right' }, // jog out (offset span)
      { atZ: 130.5, dir: 'left' }, // jog back mid-flight (lands centered)
      // M9.1 ACT 2 shared island transfers (both variants climb the chain
      // identically; the split comes at the stairs).
      { atZ: 195.5, dir: 'right', withJump: true }, // i1 → i2 (lane 2)
      { atZ: 205, dir: 'left', withJump: true }, // i2 → i3 (first)
      { atZ: 206, dir: 'left' }, // i2 → i3 (second edge, mid-flight)
      { atZ: 214.5, dir: 'right', withJump: true }, // i3 → i4 (center)
      // M9.1 shared stair-1 climb (both variants ascend; primary continues
      // to stair 2, alternate drops off the end to the LOW weave).
      { atZ: 234.5, dir: 'left', withJump: true }, // landing → stair 1
      // A4 ceiling spike weaves (lane 2, then lane 1 for the last).
      { atZ: 750, dir: 'right' },
      { atZ: 782, dir: 'left' },
      // A4 left-wall rhythm (vertical lane taps on the open wall — the
      // UP tap follows the beat-112 wall landing).
      { atZ: 806, dir: 'up' },
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
      // M9 slalom returns: dodge through the lengthened lunge, back to
      // center after it, then the two single-door weaves (10 u leads).
      { atZ: 1063, dir: 'left' },
      { atZ: 1070, dir: 'right' },
      { atZ: 1086, dir: 'left' },
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
      // M9.1 A2 stair-2 climb (primary only — alternate drops off stair 1
      // to the LOW weave). Then recenter for the center-strip drop.
      { atZ: 245, dir: 'right', withJump: true }, // stair 1 → stair 2
      { atZ: 246, dir: 'right' }, // stair 2 (second edge, mid-flight steer)
      { atZ: 256, dir: 'left' }, // drop recenter (lands center strip)
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
      // M9.1 A2 stair-drop combo: teeth dodge + forced lane-0 return for
      // the side-strip hop (the shared center hop spike threatens lane 1).
      { atZ: 255.5, dir: 'right' }, // dodge teeth 260 (lane 1)
      { atZ: 262, dir: 'left' }, // return lane 0 (spike 266 threatens center)
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
    this.laneLazy = opts.laneLazy ?? false;
    if (this.laneLazy) {
      // Preserve jump edges hidden inside combined tap+jumps as plain
      // jumps; drop every pure lane-steering tap.
      for (const t of taps) {
        if (t.withJump === true) this.jumps.push(t.atZ);
      }
      this.jumps.sort((a, b) => a - b);
      this.taps = [];
    } else {
      this.taps = taps.map((t) => ({ ...t })).sort((a, b) => a.atZ - b.atZ);
    }
    this.spiderPresses = [...presses];
    // Fast-fall ranges (z windows where ArrowDown stays held airborne).
    // NOTE: the A1 drop chamber needs NO fast-fall (the natural fall
    // lands the catcher; holding down drives into its face).
    // The maw-exit dive is shared trunk (both variants fall 1614 → slab).
    // M9.1 A1: pier-end shaft drop + exit-strip drop (deliberate falling).
    const trunkFF: Array<[number, number]> = [[102, 105], [168, 170.5], [257.5, 260], [1613, 1618]];
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
    // M9 lane-lazy: no reactive steering either (ride wherever the deck
    // takes the Cube — the openness audit wants the unsteered outcome).
    // Air-follow: while airborne over a lateral ferry just ridden (e.g.
    // a Chomper-dodge jump off the deck), keep steering toward the deck
    // so the landing is solid, not a corner graze. The lane servo would
    // otherwise recenter mid-flight and dump the rider off the edge.
    if (
      !this.laneLazy &&
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
    if (!this.laneLazy && this.recentering && sim.playerMode === 'cube' && sim.gravityMode === 'floor') {
      const t = sim.player.targetLaneIndex;
      if (t === this.recenterTarget || z > this.recenterUntilZ) {
        this.recentering = false;
      } else if (this.tick - this.lastFerryTapTick > 10) {
        this.lastFerryTapTick = this.tick;
        return t < this.recenterTarget ? tapLaneRight : tapLaneLeft;
      }
    }
    if (!this.laneLazy && ridingFerry) {
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
