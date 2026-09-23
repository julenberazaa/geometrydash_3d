import { GameSimulation } from '../../src/game/GameSimulation';
import type { LevelDefinition } from '../../src/level/levelDefinition';
import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';

/**
 * M9 route-openness audit (test-side only — pure observation, no engine
 * changes). Answers the human complaint directly: "can the player advance
 * safely through many lateral positions without meaningful action?"
 *
 * Method: run the reference route, then at sampled forward positions on
 * Floor/Cube sections test every lane for a SAFE BAND — supported AND
 * hazard-free on the surface AND no frontal block inside the decision
 * window. Bands counted: 1 = precise single flow line, 2 = meaningful
 * alternative, 3+ = the permissive 4–5-line problem (lanes + edges).
 *
 * Static scope (documented limits): Cube/Floor sections only (ship,
 * spider, ceiling, wall samples excluded from the count but reported as
 * coverage); moving platforms excluded (ferry rides are single-line by
 * construction); Chompers excluded (dynamic — their zones carry weave
 * gates that DO constrain statically).
 */

export interface TrajectorySample {
  z: number;
  x: number;
  y: number;
}

export const collectTrajectory = (
  def: LevelDefinition,
  inputFor: (z: number, sim: GameSimulation) => Readonly<PhysicalInputSnapshot>,
  opts: { maxTicks?: number } = {},
): { samples: TrajectorySample[]; ticks: number; status: string; floorCubeSamples: number; totalSamples: number } => {
  const sim = new GameSimulation(def);
  const maxTicks = opts.maxTicks ?? 30000;
  const samples: TrajectorySample[] = [];
  let floorCube = 0;
  let total = 0;
  let tick = 0;
  for (; tick < maxTicks; tick++) {
    if (sim.status !== 'running') break;
    const p = sim.player.position;
    total++;
    if (sim.gravityMode === 'floor' && sim.playerMode === 'cube') {
      floorCube++;
      samples.push({ z: p.z, x: p.x, y: p.y });
    }
    sim.update(inputFor(p.z, sim));
  }
  return { samples, ticks: tick, status: sim.status, floorCubeSamples: floorCube, totalSamples: total };
};

export interface OpennessSample {
  z: number;
  /** Lanes safe simultaneously (of the level lane count). */
  bands: number;
  laneSafe: boolean[];
}

export interface OpennessReport {
  samples: OpennessSample[];
  /** Fraction of samples with 3+ simultaneous safe bands (the problem). */
  openFraction: number;
  oneBandFraction: number;
  twoBandFraction: number;
  /** Merged stretches (z0/z1) of consecutive 3+ band samples. */
  openStretches: Array<{ z0: number; z1: number; length: number }>;
  coverage: number;
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

const solidBox = (c: { x: number; y: number; z: number }, h: { x: number; y: number; z: number }): Box => ({
  minX: c.x - h.x, maxX: c.x + h.x,
  minY: c.y - h.y, maxY: c.y + h.y,
  minZ: c.z - h.z, maxZ: c.z + h.z,
});

export const analyzeRouteOpenness = (
  def: LevelDefinition,
  trajectory: readonly TrajectorySample[],
  opts: { step?: number; zMax?: number } = {},
): OpennessReport => {
  const step = opts.step ?? 2;
  const zMax = opts.zMax ?? def.finishZ;
  const lanes = def.laneCenters;
  const solids = def.solids.map((s) => solidBox(s.center, s.halfExtents));
  const hazards: Box[] = [
    ...def.hazards.map((hz) => solidBox(hz.center, hz.halfExtents)),
    ...(def.lava ?? []).map((l) => solidBox(l.center, l.halfExtents)),
  ];
  // Frontal blockers: killFront hazards + solids alike (both block forward
  // per the frontal-kill rule; side/top contacts on slabs are the safe
  // landings, filtered by height below).
  const blockers = [
    ...def.hazards.filter((hz) => hz.kind === 'killFront').map((hz) => solidBox(hz.center, hz.halfExtents)),
    ...solids,
  ];
  const samples: OpennessSample[] = [];
  let ti = 0;
  for (let z = 0; z <= zMax; z += step) {
    while (ti < trajectory.length - 1 && (trajectory[ti + 1]?.z ?? Infinity) < z) ti++;
    const ref = trajectory[ti];
    if (ref === undefined || Math.abs(ref.z - z) > step) continue;
    const y = ref.y;
    const laneSafe = lanes.map((lx) => {
      // (a) supported: the deck under the run — highest solid top in the
      // band below the rider (stacked decks resolve to the ridden one).
      // The deck top T anchors the surface/frontal tests below (NOT the
      // rider height — an airborne rider still constrains the ground line
      // they just left and will rejoin).
      let deckTop = -Infinity;
      for (const s of solids) {
        if (
          s.maxY >= y - 3.2 && s.maxY <= y - 0.4 &&
          s.minX < lx + 0.55 && s.maxX > lx - 0.55 &&
          s.minZ < z + 1.5 && s.maxZ > z - 1.5
        ) {
          if (s.maxY > deckTop) deckTop = s.maxY;
        }
      }
      if (deckTop === -Infinity) return false;
      // (b) surface hazard-free at deck level: a spike/lava on the lane
      // forces a jump or a lane change — never a free band.
      const hazarded = hazards.some(
        (hb) =>
          hb.minX < lx + 0.6 && hb.maxX > lx - 0.6 &&
          hb.minY < deckTop + 1.2 && hb.maxY > deckTop - 0.1 &&
          hb.minZ < z + 1 && hb.maxZ > z - 1,
      );
      if (hazarded) return false;
      // (c) no frontal block inside the decision window above the deck (a
      // face the lane would meet at body height — jumping/veering would
      // be required; flat continuations never overlap and stay free).
      const blocked = blockers.some(
        (b) =>
          b.minZ > z + 0.5 && b.minZ <= z + 9 &&
          b.minX < lx + 0.6 && b.maxX > lx - 0.6 &&
          b.minY < deckTop + 2.2 && b.maxY > deckTop,
      );
      return !blocked;
    });
    samples.push({ z, bands: laneSafe.filter(Boolean).length, laneSafe });
  }
  let open = 0;
  let one = 0;
  let two = 0;
  const openStretches: Array<{ z0: number; z1: number; length: number }> = [];
  let runStart: number | null = null;
  let runPrev = 0;
  for (const s of samples) {
    // Coverage gaps (ship/spider/ceiling/wall sections carry no Floor/Cube
    // samples) MUST break runs — otherwise fragments on both sides of a
    // gap merge into one phantom stretch.
    if (runStart !== null && s.z - runPrev > step * 1.5) {
      openStretches.push({ z0: runStart, z1: runPrev, length: runPrev - runStart });
      runStart = null;
    }
    if (s.bands >= 3) {
      open++;
      if (runStart === null) runStart = s.z;
      runPrev = s.z;
    } else {
      if (runStart !== null) {
        openStretches.push({ z0: runStart, z1: runPrev, length: runPrev - runStart });
        runStart = null;
      }
      if (s.bands <= 1) one++;
      else two++;
    }
  }
  if (runStart !== null) {
    openStretches.push({ z0: runStart, z1: runPrev, length: runPrev - runStart });
  }
  const n = Math.max(1, samples.length);
  return {
    samples,
    openFraction: open / n,
    oneBandFraction: one / n,
    twoBandFraction: two / n,
    openStretches: openStretches.sort((a, b) => b.length - a.length),
    coverage: n,
  };
};
