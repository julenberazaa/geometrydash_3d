import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { loadLevel } from '../src/level/levelRuntime';
import { LevelView } from '../src/rendering/LevelView';
import { makeTestLibrary } from './helpers/visuals';

// Capture the exact pre-batching meshes without retaining them in production.
type ColdBatchOwner = { buildStaticTrimChunks(trims: readonly THREE.Mesh[]): void };
const prototype = LevelView.prototype as unknown as ColdBatchOwner;
const batches = (view: LevelView): THREE.InstancedMesh[] =>
  view.group.children.filter((mesh): mesh is THREE.InstancedMesh =>
    mesh instanceof THREE.InstancedMesh && mesh.name === 'static-route-trims');
const draws = (view: LevelView): number => view.group.children.filter(
  (mesh) => mesh instanceof THREE.Mesh || mesh instanceof THREE.LineSegments,
).length;

describe('LevelView cold static trim batching', () => {
  for (const def of [THE_DESCENT_CLASSIC, PRODUCTION_SHOWCASE_01]) {
    it(`preserves every trim transform/material and reduces modeled draws: ${def.id}`, () => {
      const library = makeTestLibrary();
      let originalTrims: readonly THREE.Mesh[] = [];
      const capture = vi.spyOn(prototype, 'buildStaticTrimChunks').mockImplementation(function (
        this: LevelView, trims: readonly THREE.Mesh[],
      ) {
        originalTrims = trims;
        for (const mesh of trims) this.group.add(mesh);
      });
      let before: LevelView;
      try {
        before = new LevelView(loadLevel(def), library);
      } finally {
        capture.mockRestore();
      }
      const after = new LevelView(loadLevel(def), library);
      const grouped = new Map<string, THREE.Mesh[]>();
      for (const mesh of originalTrims) {
        if (mesh.matrixAutoUpdate) mesh.updateMatrix();
        if (Array.isArray(mesh.material) || mesh.matrix.determinant() <= 0) continue;
        const chunk = typeof mesh.userData.spikeChunk === 'number'
          ? mesh.userData.spikeChunk : Math.floor(mesh.position.z / 96);
        const key = `${chunk}:${mesh.geometry.uuid}:${mesh.material.uuid}`;
        const list = grouped.get(key);
        if (list === undefined) grouped.set(key, [mesh]);
        else list.push(mesh);
      }
      const matrix = new THREE.Matrix4();
      for (const batch of batches(after)) {
        batch.getMatrixAt(0, matrix);
        const material = batch.material as THREE.Material;
        const chunk: unknown = batch.userData.chunkIndex;
        expect(typeof chunk).toBe('number');
        const key = `${String(chunk)}:${batch.geometry.uuid}:${material.uuid}`;
        const originals = grouped.get(key);
        if (originals === undefined) throw new Error(`No original trims for batch ${key}`);
        expect(batch.count).toBe(originals.length);
        expect(batch.frustumCulled).toBe(true);
        expect(batch.instanceMatrix.usage).toBe(THREE.StaticDrawUsage);
        expect(batch.boundingBox).not.toBeNull();
        expect(batch.boundingSphere).not.toBeNull();
        const boundingBox = batch.boundingBox;
        if (boundingBox === null) throw new Error('Batch has no bounding box');
        for (let i = 0; i < batch.count; i++) {
          batch.getMatrixAt(i, matrix);
          const original = originals[i];
          if (original === undefined) throw new Error(`Missing original trim ${i}`);
          for (let k = 0; k < 16; k++) {
            const expectedElement = original.matrix.elements[k];
            if (expectedElement === undefined) throw new Error(`Missing matrix element ${k}`);
            expect(matrix.elements[k]).toBeCloseTo(expectedElement, 3);
          }
          const bounds = new THREE.Box3().setFromBufferAttribute(
            batch.geometry.getAttribute('position') as THREE.BufferAttribute,
          ).applyMatrix4(matrix);
          expect(boundingBox.containsBox(bounds)).toBe(true);
        }
        grouped.delete(key);
      }
      // All multi-mesh groups were consumed exactly once.
      expect([...grouped.values()].every((list) => list.length === 1)).toBe(true);
      expect(draws(after)).toBeLessThan(draws(before) * 0.5);
      expect(after.occluderMeshes.size).toBe(def.solids.length);
      for (const body of after.occluderMeshes.values()) {
        expect(body).not.toBeInstanceOf(THREE.InstancedMesh);
        expect(body.parent).toBe(after.group);
      }
      console.info(`${def.id}: modeled LevelView draws ${draws(before)} -> ${draws(after)}; trims ${originalTrims.length}, chunks ${batches(after).length}`);
      before.dispose();
      after.dispose();
      library.dispose();
    });
  }

  it('leaves animated objects separate and instance buffers unchanged on update', () => {
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(THE_DESCENT_CLASSIC), library);
    const chunks = batches(view);
    const versions = chunks.map((chunk) => chunk.instanceMatrix.version);
    const dynamic = view as unknown as {
      lavaAnim: { mesh: THREE.Mesh }[];
      fallNodes: { mesh: THREE.Mesh }[];
      portalPulse: { mesh: THREE.Mesh }[];
    };
    for (const registry of [dynamic.lavaAnim, dynamic.fallNodes, dynamic.portalPulse]) {
      expect(registry.length).toBeGreaterThan(0);
      for (const { mesh } of registry) {
        expect(mesh).not.toBeInstanceOf(THREE.InstancedMesh);
        expect(mesh.parent).toBe(view.group);
      }
      const firstNode = registry[0];
      if (firstNode === undefined) throw new Error('Animation registry is empty');
      const first = firstNode.mesh;
      first.updateMatrix();
      const initial = first.matrix.clone();
      view.updateLava(0.5);
      view.updateWaterfall(0.5);
      view.updatePortals(0.5);
      first.updateMatrix();
      expect(first.matrix.equals(initial)).toBe(false);
    }
    expect(chunks.map((chunk) => chunk.instanceMatrix.version)).toEqual(versions);
    view.dispose();
    library.dispose();
  });

  it('disposes instance buffers once without disposing shared geometry/material', () => {
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(THE_DESCENT_CLASSIC), library);
    const disposal = batches(view).map((chunk) => vi.spyOn(chunk, 'dispose'));
    const geometryDisposal = vi.spyOn(library.unitBox, 'dispose');
    const materialDisposal = vi.spyOn(library.routeEdge, 'dispose');
    view.dispose();
    view.dispose();
    for (const spy of disposal) expect(spy).toHaveBeenCalledTimes(1);
    expect(geometryDisposal).not.toHaveBeenCalled();
    expect(materialDisposal).not.toHaveBeenCalled();
    expect(view.group.children).toHaveLength(0);
    library.dispose();
  });
});
