import { describe, it, expect } from 'vitest';
import {
  placeBiomeDressing,
  routeGroundAt,
  BIOME_GLOW,
  BIOME_BODY,
  MAX_DRESS_INSTANCES,
  DRESS_CLEARANCE_X,
  type DressingRow,
  type BiomeId,
} from '../src/level/biomeDressing';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import * as THREE from 'three';
import { EnvironmentView } from '../src/rendering/EnvironmentView';
import { PRODUCTION_THEME } from '../src/visuals/productionTheme';

/**
 * M9.6.1 biome dressing placement contract (pure, deterministic —
 * the renderer builds it once, the sim never sees it).
 */

const ROW: DressingRow = {
  z0: 600, z1: 800, biome: 'ruins', density: 0.8, seed: 42, accent: 0xb44dff,
};

const groundAt = (z: number): number | null => (z >= 600 && z <= 800 ? 4.5 : null);

describe('biome dressing placement', () => {
  it('is deterministic per seed (same input, byte-identical output)', () => {
    const a = placeBiomeDressing([ROW], groundAt);
    const b = placeBiomeDressing([ROW], groundAt);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it('varies layout with the seed (no frozen accidental layout)', () => {
    const a = placeBiomeDressing([ROW], groundAt);
    const b = placeBiomeDressing([{ ...ROW, seed: 43 }], groundAt);
    // Arch posts emit triples, so counts may differ by seed — compare the
    // shared prefix instead of asserting equal length.
    const n = Math.min(a.length, b.length);
    expect(n).toBeGreaterThan(10);
    let identical = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i];
      const y = b[i];
      if (x !== undefined && y !== undefined && x.x === y.x && x.z === y.z) identical++;
    }
    expect(identical / n).toBeLessThan(0.5);
  });

  it('never enters the route corridor (readability rule)', () => {
    for (const biome of Object.keys(BIOME_GLOW) as BiomeId[]) {
      const instances = placeBiomeDressing(
        [{ ...ROW, biome, z0: 0, z1: 400 }],
        () => 0,
      );
      for (const inst of instances) {
        // Arch lintels legitimately span overhead (high above the route).
        if (inst.prop === 'lintel') {
          expect(inst.y).toBeGreaterThanOrEqual(7);
          continue;
        }
        expect(
          Math.abs(inst.x),
          `${biome}/${inst.prop} inside corridor`,
        ).toBeGreaterThanOrEqual(DRESS_CLEARANCE_X);
      }
    }
  });

  it('anchors grounded props to terrain, floats the rest above it', () => {
    const instances = placeBiomeDressing([ROW], groundAt);
    for (const inst of instances) {
      if (inst.prop === 'lintel') continue;
      // Nothing may sink below its anchor or tower absurdly.
      expect(inst.y).toBeGreaterThanOrEqual(4.5 - 0.001);
      expect(inst.y).toBeLessThanOrEqual(4.5 + 14);
      expect(Number.isFinite(inst.x + inst.y + inst.z)).toBe(true);
    }
    // Grounded kinds sit exactly on the terrain.
    for (const inst of instances.filter((v) => v.prop === 'pillar' || v.prop === 'vent')) {
      expect(inst.y).toBeCloseTo(4.5 + inst.sy / 2, 9);
    }
  });

  it('skips unanchored spans instead of floating grounded props', () => {
    const instances = placeBiomeDressing(
      [{ ...ROW, z0: 0, z1: 100 }],
      () => null,
    );
    expect(instances.length).toBe(0);
  });

  it('caps total instances (bounded scenery)', () => {
    const rows: DressingRow[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push({ z0: i * 200, z1: i * 200 + 200, biome: 'void', density: 1, seed: i + 1, accent: 0x6a5cff, baseY: 0 });
    }
    const instances = placeBiomeDressing(rows, () => null);
    expect(instances.length).toBeLessThanOrEqual(MAX_DRESS_INSTANCES);
    expect(instances.length).toBeGreaterThan(50);
  });

  it('emits each biome vocabulary with the right glow flags', () => {
    const kinds = (biome: BiomeId): Set<string> => new Set(
      placeBiomeDressing([{ ...ROW, biome }], groundAt).map((inst) => inst.prop),
    );
    expect([...kinds('ruins')].some((k) => k === 'pillar' || k === 'archPost')).toBe(true);
    expect(kinds('garden').has('strand')).toBe(true);
    expect(kinds('works').has('duct')).toBe(true);
    expect(kinds('foundry').has('vent')).toBe(true);
    const cavern = placeBiomeDressing([{ ...ROW, biome: 'cavern' }], groundAt);
    expect(cavern.some((inst) => inst.prop === 'crystal')).toBe(true);
    for (const inst of cavern.filter((v) => v.prop === 'crystal' || v.prop === 'cell')) {
      expect(inst.glow).toBe(true);
    }
    for (const inst of cavern.filter((v) => v.prop === 'pillar' || v.prop === 'rock')) {
      expect(inst.glow).toBe(false);
    }
  });

  it('keeps glow and material families per biome instead of recoloring one surface', () => {
    const instances = placeBiomeDressing([ROW], groundAt);
    for (const inst of instances.filter((v) => v.glow)) {
      expect(inst.color).toBe(BIOME_GLOW.ruins);
    }
    for (const inst of instances.filter((v) => !v.glow)) {
      expect(inst.color).toBe(BIOME_BODY.ruins);
    }
  });

  it('chunks voxel assemblies for view culling without changing the Rift', () => {
    const descent = new EnvironmentView(1800, PRODUCTION_THEME, THE_DESCENT_CLASSIC);
    const batches = descent.scene.children.filter(
      (object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh,
    );
    const dressed = batches.filter((mesh) =>
      mesh.material instanceof THREE.MeshStandardMaterial ||
      (mesh.material instanceof THREE.MeshBasicMaterial && mesh.material.transparent));
    expect(descent.dressInstances).toBeGreaterThan(100);
    expect(descent.dressInstances).toBeLessThanOrEqual(MAX_DRESS_INSTANCES);
    expect(dressed.length).toBeGreaterThan(20);
    // Solid scenery uses 48-unit chunks, glow/flow 96; more bounded draws
    // trade for fewer invisible submitted pieces. Browser budget stays 450.
    expect(dressed.length).toBeLessThan(75);
    expect(dressed.reduce((sum, mesh) => sum + mesh.count, 0)).toBeGreaterThan(500);
    expect(new Set(dressed.map((mesh) => mesh.material)).size).toBe(3);
    expect(new Set(batches.map((mesh) => mesh.geometry)).size).toBe(2);
    expect(Math.max(...batches.map((mesh) => mesh.count))).toBeLessThan(500);
    expect(batches.every((mesh) => mesh.frustumCulled && mesh.boundingSphere !== null)).toBe(true);
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 130);
    camera.position.set(0, 3, 280);
    camera.lookAt(0, 2, 330);
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const visible = dressed.filter((mesh) => frustum.intersectsObject(mesh));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(dressed.length / 2);
    descent.dispose();

    const plain = new EnvironmentView(1800, PRODUCTION_THEME);
    expect(plain.dressInstances).toBe(0);
    expect(plain.scene.children.filter((object) => object instanceof THREE.InstancedMesh).length).toBe(1);
    plain.dispose();
  });

  it('routeGroundAt returns the highest corridor top, null in voids', () => {
    const solids = [
      { center: { x: 0, y: -0.5, z: 100 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
      { center: { x: 0, y: 4, z: 100 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
      { center: { x: 30, y: 50, z: 100 }, halfExtents: { x: 5, y: 5, z: 10 } },
    ];
    expect(routeGroundAt(solids, 100)).toBe(4.5);
    expect(routeGroundAt(solids, 500)).toBeNull();
    expect(routeGroundAt([], 100)).toBeNull();
  });

  it('dressing + new setpiece kinds never touch the gameplay fingerprint', () => {
    const before = computeLevelFingerprint(THE_DESCENT_CLASSIC);
    const dressed = {
      ...THE_DESCENT_CLASSIC,
      visualDressing: [ROW],
      visualSetpieces: [
        ...(THE_DESCENT_CLASSIC.visualSetpieces ?? []),
        { id: 'test-snap', kind: 'snapmark' as const, center: { x: 0, y: 2, z: 1341 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } },
        { id: 'test-fall', kind: 'fall' as const, center: { x: 9, y: 4, z: 295 }, halfExtents: { x: 1, y: 4, z: 1 } },
      ],
    };
    expect(computeLevelFingerprint(dressed)).toBe(before);
  });
});
