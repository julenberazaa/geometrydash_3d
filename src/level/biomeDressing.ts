import { mulberry32 } from '../core/math';

/**
 * Biome dressing placement (M9.6.1) — pure, deterministic, THREE-free.
 *
 * Puts route-adjacent midground dressing (the layer between the playable
 * route and the background architecture) where the dressing census proved
 * the void: whole acts with zero setpieces. Seeded PRNG placement over
 * authored act rows — biome identity by rule, never random noise. The
 * renderer builds it once into two static InstancedMeshes (solid + glow);
 * the simulation, collision, replay and fingerprint never see it.
 *
 * Ownership: this module owns placement math + vocabulary; the level file
 * owns the rows (fingerprint-neutral data); EnvironmentView owns the
 * meshes/materials (view-owned, disposed with the view).
 */

export type BiomeId =
  | 'foundry'
  | 'garden'
  | 'ruins'
  | 'cavern'
  | 'crag'
  | 'works'
  | 'temple'
  | 'void'
  | 'core';

export type DressProp =
  | 'pillar'
  | 'archPost'
  | 'lintel'
  | 'rock'
  | 'crystal'
  | 'strand'
  | 'duct'
  | 'cell'
  | 'vent'
  | 'slab'
  | 'fall'
  | 'foliage';

/** One authored dressing act (data lives on the level, never fingerprinted). */
export interface DressingRow {
  z0: number;
  z1: number;
  biome: BiomeId;
  /** 0..1 (instances per 10 u before the biome rate). */
  density: number;
  seed: number;
  /** Authored act accent; prop bodies use stable biome material colors. */
  accent: number;
  /** Anchor height when no terrain exists below (void/sky acts). */
  baseY?: number;
}

export interface DressInstance {
  biome: BiomeId;
  prop: DressProp;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  /** Yaw radians (diamonds/boulders vary, pillars never). */
  ry: number;
  /** Roll radians (crystals read as diamonds at PI/4, else 0). */
  rz: number;
  glow: boolean;
  /** Resolved hex color (solid: biome material; glow: biome signature). */
  color: number;
}

/** Hard cap: dressing is bounded scenery, never sprawl. */
export const MAX_DRESS_INSTANCES = 220;
/** Route corridor half-width: dressing never enters it (readability rule). */
export const DRESS_CLEARANCE_X = 7;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Biome glow signatures (identity — never the section accent). */
export const BIOME_GLOW: Record<BiomeId, number> = {
  foundry: 0xff7a1a,
  garden: 0x2dffc4,
  ruins: 0xb44dff,
  cavern: 0x66ccff,
  crag: 0xff5a00,
  works: 0x7dff9d,
  temple: 0xffe27a,
  void: 0x8a7dff,
  core: 0xff6ad2,
};

/** Material families stay recognizable even when the timeline changes hue. */
export const BIOME_BODY: Record<BiomeId, number> = {
  foundry: 0x493327,
  garden: 0x315a3a,
  ruins: 0x49404e,
  cavern: 0x27485b,
  crag: 0x4d3026,
  works: 0x294744,
  temple: 0x545138,
  void: 0x36364e,
  core: 0x563850,
};

interface PropSpec {
  prop: DressProp;
  weight: number;
  glow: boolean;
  /** Scale ranges (sx, sy, sz min/max pairs). */
  s: [number, number, number, number, number, number];
  /** Hover above ground (floating) or sit (grounded, sy/2 added). */
  float?: [number, number];
}

const BIOME_MIX: Record<BiomeId, PropSpec[]> = {
  foundry: [
    { prop: 'vent', weight: 3, glow: false, s: [1.5, 2.5, 3, 6, 1.5, 2.5] },
    { prop: 'duct', weight: 2, glow: false, s: [0.8, 1.2, 0.8, 1.2, 6, 14] },
    { prop: 'cell', weight: 3, glow: true, s: [0.3, 0.6, 0.3, 0.6, 0.3, 0.6], float: [1, 7] },
    { prop: 'pillar', weight: 1, glow: false, s: [1, 2, 6, 14, 1, 2] },
  ],
  garden: [
    { prop: 'rock', weight: 3, glow: false, s: [1, 3, 1, 3, 1, 3], float: [2, 10] },
    { prop: 'strand', weight: 3, glow: false, s: [0.15, 0.3, 3, 7, 0.15, 0.3] },
    { prop: 'cell', weight: 2, glow: true, s: [0.2, 0.4, 0.2, 0.4, 0.2, 0.4], float: [1, 6] },
    { prop: 'slab', weight: 2, glow: false, s: [2, 4, 0.3, 0.3, 2, 4] },
    { prop: 'foliage', weight: 4, glow: false, s: [2, 4, 2, 5, 1, 2] },
    { prop: 'fall', weight: 2, glow: false, s: [1.5, 3, 5, 10, 0.3, 0.6] },
  ],
  ruins: [
    { prop: 'pillar', weight: 4, glow: false, s: [1.2, 2.2, 6, 13, 1.2, 2.2] },
    { prop: 'archPost', weight: 2, glow: false, s: [1, 1.4, 7, 9, 1, 1.4] },
    { prop: 'slab', weight: 2, glow: false, s: [2, 4, 0.3, 0.5, 2, 4] },
    { prop: 'cell', weight: 1, glow: true, s: [0.25, 0.5, 0.25, 0.5, 0.25, 0.5], float: [1, 5] },
  ],
  cavern: [
    { prop: 'crystal', weight: 4, glow: true, s: [0.4, 0.9, 1.2, 2.5, 0.4, 0.9], float: [0, 6] },
    { prop: 'rock', weight: 2, glow: false, s: [1, 2.5, 1, 2.5, 1, 2.5], float: [1, 7] },
    { prop: 'strand', weight: 2, glow: false, s: [0.12, 0.22, 3, 8, 0.12, 0.22] },
    { prop: 'cell', weight: 2, glow: true, s: [0.2, 0.4, 0.2, 0.4, 0.2, 0.4], float: [1, 6] },
  ],
  crag: [
    { prop: 'pillar', weight: 3, glow: false, s: [1.5, 3, 5, 12, 1.5, 3] },
    { prop: 'slab', weight: 2, glow: false, s: [2, 5, 0.3, 0.5, 2, 5] },
    { prop: 'cell', weight: 3, glow: true, s: [0.3, 0.6, 0.3, 0.6, 0.3, 0.6], float: [0.5, 4] },
    { prop: 'rock', weight: 2, glow: false, s: [1, 3, 1, 3, 1, 3], float: [1, 6] },
    { prop: 'fall', weight: 2, glow: false, s: [1.5, 3, 5, 10, 0.3, 0.6] },
  ],
  works: [
    { prop: 'duct', weight: 3, glow: false, s: [0.8, 1.2, 0.8, 1.2, 6, 14] },
    { prop: 'cell', weight: 2, glow: true, s: [0.25, 0.5, 0.25, 0.5, 0.25, 0.5], float: [1, 6] },
    { prop: 'pillar', weight: 2, glow: false, s: [1, 1.8, 5, 11, 1, 1.8] },
    { prop: 'vent', weight: 1, glow: false, s: [1.2, 2, 2.5, 5, 1.2, 2] },
  ],
  temple: [
    { prop: 'pillar', weight: 3, glow: false, s: [1.2, 2, 6, 12, 1.2, 2] },
    { prop: 'strand', weight: 3, glow: false, s: [0.2, 0.4, 4, 9, 0.2, 0.4] },
    { prop: 'cell', weight: 2, glow: true, s: [0.25, 0.5, 0.25, 0.5, 0.25, 0.5], float: [1, 6] },
    { prop: 'slab', weight: 1, glow: false, s: [2, 4, 0.3, 0.5, 2, 4] },
    { prop: 'foliage', weight: 3, glow: false, s: [2, 4, 2, 5, 1, 2] },
  ],
  void: [
    { prop: 'crystal', weight: 4, glow: true, s: [0.5, 1, 1.5, 3, 0.5, 1], float: [0, 8] },
    { prop: 'rock', weight: 4, glow: false, s: [1, 3, 1, 3, 1, 3], float: [0, 9] },
    { prop: 'cell', weight: 1, glow: true, s: [0.2, 0.4, 0.2, 0.4, 0.2, 0.4], float: [1, 6] },
  ],
  core: [
    { prop: 'crystal', weight: 3, glow: true, s: [0.5, 1, 1.5, 3, 0.5, 1], float: [0, 7] },
    { prop: 'archPost', weight: 1, glow: false, s: [1, 1.4, 7, 9, 1, 1.4] },
    { prop: 'cell', weight: 2, glow: true, s: [0.25, 0.5, 0.25, 0.5, 0.25, 0.5], float: [1, 6] },
    { prop: 'pillar', weight: 1, glow: false, s: [1.2, 2, 6, 12, 1.2, 2] },
  ],
};

/**
 * Route terrain height at z: highest solid top overlapping the corridor.
 * Pure data query (tests inject synthetics; production passes def.solids).
 */
export const routeGroundAt = (
  solids: readonly { center: { x: number; y: number; z: number }; halfExtents: { x: number; y: number; z: number } }[],
  z: number,
): number | null => {
  let top: number | null = null;
  for (const s of solids) {
    if (Math.abs(s.center.x) > 6 + s.halfExtents.x) continue;
    if (z < s.center.z - s.halfExtents.z || z > s.center.z + s.halfExtents.z) continue;
    const t = s.center.y + s.halfExtents.y;
    if (top === null || t > top) top = t;
  }
  return top;
};

const pickSpec = (mix: PropSpec[], rand: () => number): PropSpec => {
  let total = 0;
  for (const m of mix) total += m.weight;
  let roll = rand() * total;
  for (const m of mix) {
    roll -= m.weight;
    if (roll <= 0) return m;
  }
  return mix[mix.length - 1] as PropSpec;
};

/** Deliberate off-route landmarks: water needs visible sources and banks,
 * while the later overgrown temple needs clustered stone and roots. These
 * sit among the seeded scatter, never on a regular ground-tile interval. */
const placeOvergrownLandmarks = (
  row: DressingRow,
  groundAt: (z: number) => number | null,
  rand: () => number,
  out: DressInstance[],
): number => {
  if ((row.biome !== 'garden' && row.biome !== 'temple') || row.density <= 0) return 0;
  const garden = row.biome === 'garden';
  const centers = garden ? [0.16, 0.48, 0.83] : [0.28, 0.73];
  let placed = 0;
  const add = (
    prop: DressProp, x: number, y: number, z: number,
    sx: number, sy: number, sz: number,
  ): void => {
    out.push({
      biome: row.biome, prop, x, y, z, sx, sy, sz,
      ry: 0, rz: 0, glow: false, color: BIOME_BODY[row.biome],
    });
    placed++;
  };
  for (let i = 0; i < centers.length; i++) {
    const center = centers[i];
    if (center === undefined) continue;
    const z = row.z0 + (row.z1 - row.z0) * (center + (rand() - 0.5) * 0.09);
    const ground = groundAt(z) ?? row.baseY;
    if (ground === undefined) continue;
    // Both banks appear in the garden. The third landmark varies by seed;
    // jitter and unequal spacing keep the assembly from reading as a stamp.
    const side = i === 0 ? -1 : i === 1 ? 1 : rand() < 0.5 ? -1 : 1;
    if (garden) {
      const height = 6.5 + rand() * 3;
      add('fall', side * 9.0, ground + height / 2, z,
        2.1 + rand() * 0.9, height, 0.45);
      add('slab', side * 9.0, ground + height + 0.18, z - 0.3,
        3.8, 0.36, 2.5);
      add('rock', side * 8.4, ground + 1.3, z - 2.8,
        2.5, 2.6, 2.1);
    } else {
      add('pillar', side * 12.7, ground + 4.3, z,
        1.7, 8.6, 1.7);
      add('slab', side * 11.1, ground + 0.22, z - 2.4,
        3.3, 0.44, 2.8);
    }
    add('foliage', side * (garden ? 10.5 : 16.2), ground + 2.15, z + 3.3,
      2.6, 4.3, 1.7);
    add('strand', side * (garden ? 9.3 : 15.1), ground + 2.9, z + 3.3,
      0.24, 4.5, 0.24);
  }
  return placed;
};

/**
 * Deterministic placement for all rows. Same input → same instances
 * (seeded per row). Never inside the corridor, never unanchored floats
 * without a base (grounded props skip void spans without baseY).
 */
export const placeBiomeDressing = (
  rows: readonly DressingRow[],
  groundAt: (z: number) => number | null,
): DressInstance[] => {
  const out: DressInstance[] = [];
  for (const row of rows) {
    const rand = mulberry32(row.seed);
    const mix = BIOME_MIX[row.biome];
    const landmarks = placeOvergrownLandmarks(row, groundAt, rand, out);
    const count = Math.max(0, Math.min(
      40,
      Math.round(((row.z1 - row.z0) / 10) * clamp01(row.density) * 1.6),
    ) - landmarks);
    for (let i = 0; i < count; i++) {
      const spec = pickSpec(mix, rand);
      const side = rand() < 0.5 ? -1 : 1;
      // Leave room for the prop's full width and its small voxel details.
      const x = side * (DRESS_CLEARANCE_X + 3 + rand() * 9);
      const z = row.z0 + rand() * (row.z1 - row.z0);
      // Every prop anchors to terrain (or the row baseY) — never
      // unanchored floats, never inside the corridor.
      const ground = groundAt(z) ?? row.baseY ?? null;
      if (ground === null) continue;
      const sx = spec.s[0] + rand() * (spec.s[1] - spec.s[0]);
      const sy = spec.s[2] + rand() * (spec.s[3] - spec.s[2]);
      const sz = spec.s[4] + rand() * (spec.s[5] - spec.s[4]);
      // Arch posts come in mirrored pairs joined by a lintel (one
      // overhead moment, three instances, emitted together).
      if (spec.prop === 'archPost') {
        const lx = Math.abs(x);
        for (const px of [-lx, lx]) {
          out.push({
            biome: row.biome, prop: 'archPost', x: px, y: ground + sy / 2, z,
            sx, sy, sz, ry: 0, rz: 0, glow: false,
            color: BIOME_BODY[row.biome],
          });
        }
        out.push({
          biome: row.biome, prop: 'lintel', x: 0, y: ground + sy + 0.5, z,
          sx: lx * 2 + 1, sy: 1, sz, ry: 0, rz: 0, glow: false,
          color: BIOME_BODY[row.biome],
        });
        continue;
      }
      let y: number;
      if (spec.float !== undefined) {
        y = ground + spec.float[0] + rand() * (spec.float[1] - spec.float[0]);
      } else {
        y = ground + sy / 2;
      }
      // Crystals/rocks vary yaw (diamonds/boulders); pillars, ducts and
      // vents stay axis-aligned (built structures read orthogonal).
      // Crystals roll a quarter-turn (diamond read); nothing else rolls.
      const ry = spec.prop === 'pillar' || spec.prop === 'duct' || spec.prop === 'vent'
        ? 0
        : rand() * Math.PI * 2;
      out.push({
        biome: row.biome, prop: spec.prop, x, y, z, sx, sy, sz, ry,
        rz: spec.prop === 'crystal' ? Math.PI / 4 : 0,
        glow: spec.glow,
        color: spec.glow ? BIOME_GLOW[row.biome] : BIOME_BODY[row.biome],
      });
    }
  }
  // Global bound (uniform stride — deterministic, keeps coverage even).
  if (out.length <= MAX_DRESS_INSTANCES) return out;
  const keep: DressInstance[] = [];
  const step = out.length / MAX_DRESS_INSTANCES;
  for (let i = 0; i < MAX_DRESS_INSTANCES; i++) {
    const inst = out[Math.floor(i * step)];
    if (inst !== undefined) keep.push(inst);
  }
  return keep;
};
