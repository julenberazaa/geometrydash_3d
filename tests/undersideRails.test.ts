import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LevelView } from '../src/rendering/LevelView';
import { loadLevel } from '../src/level/levelRuntime';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { LevelDefinition } from '../src/level/levelDefinition';

/**
 * M3.2 ceiling-view parity regression (presentation geometry only — no
 * gameplay surface).
 *
 * Evidence that motivated the contract (M3.2 audit): every neon rail used to
 * live on the TOP faces of solids, so the ceiling run surface (the underside)
 * had zero edge structure exactly where the below-focus camera makes the
 * Cube's own silhouette occlude the surface ~4..16 u ahead — the lateral
 * underside edges are the only viable forward cue, and they were unmarked
 * while the floor track glowed with rails. LevelView now mirrors the top-edge
 * rail treatment onto EXPOSED undersides (bottom face at y >= 2, the ceiling
 * run surfaces); ground-resting or buried bottoms must stay rail-free (rails
 * there would poke through host solids or never be seen).
 */

const RAIL_THICKNESS = 0.055;

interface Box {
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
}

const findSolid = (def: LevelDefinition, centerZ: number, centerY: number): Box => {
  const solid = def.solids.find(
    (s) => s.center.z === centerZ && s.center.y === centerY,
  );
  if (!solid) throw new Error(`expected solid at z=${centerZ} y=${centerY}`);
  return solid;
};

const isMesh = (o: THREE.Object3D): o is THREE.Mesh =>
  o instanceof THREE.Mesh && !Array.isArray(o.material);

/** Meshes with the rail cross-section (scale.y = 0.055) at an exact y,
 *  horizontally inside the given solid's footprint (both ceiling slabs share
 *  the same underside height, so y alone cannot discriminate). */
const railMeshesAtY = (group: THREE.Group, y: number, box: Box): THREE.Mesh[] =>
  group.children.filter(
    (o): o is THREE.Mesh =>
      isMesh(o) &&
      Math.abs(o.scale.y - RAIL_THICKNESS) < 1e-6 &&
      Math.abs(o.position.y - y) < 1e-6 &&
      Math.abs(o.position.x - box.center.x) <= box.halfExtents.x &&
      Math.abs(o.position.z - box.center.z) <= box.halfExtents.z,
  );

const anyRailAtY = (group: THREE.Group, y: number): number =>
  group.children.filter(
    (o): o is THREE.Mesh =>
      isMesh(o) &&
      Math.abs(o.scale.y - RAIL_THICKNESS) < 1e-6 &&
      Math.abs(o.position.y - y) < 1e-6,
  ).length;

const slabA = findSolid(TEST_LEVEL, 209, 7);
const slabB = findSolid(TEST_LEVEL, 246, 7);
const runwayA = findSolid(TEST_LEVEL, 10, -0.5);

describe('underside rail parity (M3.2)', () => {
  it('gives every elevated ceiling run surface 4 underside rails (2 longitudinal)', () => {
    const view = new LevelView(loadLevel(TEST_LEVEL));
    for (const slab of [slabA, slabB]) {
      const bottomY = slab.center.y - slab.halfExtents.y;
      expect(bottomY).toBeGreaterThanOrEqual(2);
      const rails = railMeshesAtY(view.group, bottomY - 0.01, slab);
      expect(rails.length, `slab at z=${slab.center.z}`).toBe(4);
      // Two rails must run LONGITUDINALLY (along Z) — the converging forward
      // cue visible beside the Cube's silhouette. Two run across (along X).
      const longitudinal = rails.filter(
        (m) => Math.abs(m.scale.z - slab.halfExtents.z * 2) < 1e-6,
      );
      const across = rails.filter(
        (m) => Math.abs(m.scale.x - slab.halfExtents.x * 2) < 1e-6,
      );
      expect(longitudinal.length, `slab at z=${slab.center.z}`).toBe(2);
      expect(across.length, `slab at z=${slab.center.z}`).toBe(2);
      // The longitudinal rails sit at the run-surface lateral edges (±X),
      // exactly where the floor track carries its own rails.
      for (const rail of longitudinal) {
        expect(Math.abs(rail.position.x - slab.center.x)).toBeCloseTo(
          slab.halfExtents.x - 0.06,
          5,
        );
      }
    }
  });

  it('keeps ground-resting and buried bottoms rail-free (no poke-through)', () => {
    const view = new LevelView(loadLevel(TEST_LEVEL));
    // Runway A: bottom y = -1 (buried).
    expect(
      anyRailAtY(view.group, runwayA.center.y - runwayA.halfExtents.y - 0.01),
    ).toBe(0);
    // Low platform (top 0.8) and elevated platform rest on y = 0 — rails there
    // would protrude through the runway top face. No solid in the level may
    // carry rails at that height.
    expect(anyRailAtY(view.group, -0.01)).toBe(0);
  });

  it('keeps the M3.1 underside inset on the ceiling run surfaces', () => {
    const view = new LevelView(loadLevel(TEST_LEVEL));
    for (const slab of [slabA, slabB]) {
      const bottomY = slab.center.y - slab.halfExtents.y;
      const insets = view.group.children.filter(
        (o): o is THREE.Mesh =>
          isMesh(o) &&
          Math.abs(o.scale.y - 0.02) < 1e-6 &&
          Math.abs(o.position.y - (bottomY - 0.011)) < 1e-6 &&
          Math.abs(o.position.x - slab.center.x) <= slab.halfExtents.x &&
          Math.abs(o.position.z - slab.center.z) <= slab.halfExtents.z,
      );
      expect(insets.length, `slab at z=${slab.center.z}`).toBe(1);
    }
  });
});
