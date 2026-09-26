import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { BiomeId } from '../src/level/biomeDressing';
import type { LevelDefinition, LevelHazard } from '../src/level/levelDefinition';
import { loadLevel } from '../src/level/levelRuntime';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { LevelView } from '../src/rendering/LevelView';
import { makeTestLibrary } from './helpers/visuals';

const biomes: BiomeId[] = ['foundry', 'garden', 'ruins', 'cavern', 'crag', 'works', 'temple', 'void', 'core'];
const luma = (c: THREE.Color): number => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const fixture = (hazards: LevelHazard[]): LevelDefinition => ({
  id: 'biome-spike-fixture', displayName: 'Biome spike fixture',
  start: { x: 0, y: 1, z: -4 }, startLaneIndex: 1, laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 14, finishZ: 200, deathY: -14, theme: TEST_LEVEL.theme,
  solids: [{ center: { x: 0, y: -1, z: -10 }, halfExtents: { x: 5, y: 0.5, z: 100 } }],
  hazards,
  visualDressing: biomes.map((biome, i) => ({ biome, z0: i * 20, z1: (i + 1) * 20,
    density: 0, seed: i, accent: 0xff0000 })),
});
const spike = (z: number, mount: LevelHazard['mount'] = 'floor'): LevelHazard => ({
  kind: 'hazard', visual: 'spike', mount,
  center: { x: 1, y: 2, z }, halfExtents: { x: 0.4, y: 0.6, z: 0.5 },
});
const lines = (view: LevelView): THREE.LineSegments => {
  const node = view.group.children.find((child) => child instanceof THREE.LineSegments);
  if (!(node instanceof THREE.LineSegments)) throw new Error('Missing merged hazard outlines');
  return node as THREE.LineSegments;
};

describe('authored biome hazard styles', () => {
  it.each(biomes)('%s caches a dark faceted core with bright texture-free neon edges', (biome) => {
    const library = makeTestLibrary();
    const before = library.materialCount;
    const style = library.spikeBiome(biome);
    expect(library.spikeBiome(biome)).toBe(style);
    expect(library.materialCount).toBe(before + 2);
    expect(style.material).not.toBe(library.hazard);
    expect(style.material.flatShading).toBe(true);
    expect(style.material.map).toBeNull();
    expect(style.material.emissiveMap).toBeNull();
    expect(luma(style.material.color)).toBeLessThan(0.03);
    expect(luma(style.edge)).toBeGreaterThan(0.8);
    expect(luma(style.edge) / (luma(style.material.color) + 0.001)).toBeGreaterThan(30);
    const originalColor = style.material.color.clone();
    const originalEdge = style.edge.clone();
    library.applyRouteState(0xffffff, 0xff0000, 0x0000ff);
    library.resetRouteToTheme();
    expect(style.material.color).toEqual(originalColor);
    expect(style.edge).toEqual(originalEdge);
    library.dispose();
  });

  it('uses lime vegetation, orange lava, ice violet, mint tech and pink/violet cosmic palettes', () => {
    const library = makeTestLibrary();
    for (const biome of ['garden', 'ruins', 'temple'] as const) {
      const edge = library.spikeBiome(biome).edge;
      expect(edge.g).toBeGreaterThan(edge.r);
      expect(edge.g).toBeGreaterThan(edge.b * 2);
    }
    for (const biome of ['foundry', 'crag'] as const) {
      const edge = library.spikeBiome(biome).edge;
      expect(edge.r).toBeGreaterThan(edge.g);
      expect(edge.g).toBeGreaterThan(edge.b * 2);
    }
    expect(library.spikeBiome('cavern').edge.r).toBeGreaterThan(library.spikeBiome('cavern').edge.g);
    expect(library.spikeBiome('works').edge.g).toBeGreaterThan(library.spikeBiome('works').edge.r);
    expect(library.spikeBiome('void').edge.b).toBeGreaterThan(library.spikeBiome('void').edge.g);
    expect(library.spikeBiome('core').edge.r).toBeGreaterThan(library.spikeBiome('core').edge.g);
    expect(library.spikeBiome('works').material.metalness).toBeGreaterThan(0.6);
    expect(library.spikeBiome('garden').material.roughness).toBeGreaterThan(0.9);
    expect(library.spikeBiome('crag').material.roughness).toBeGreaterThan(0.9);
    library.dispose();
  });

  it('paints every spike from its Z band and preserves those colors through timeline/reset updates', () => {
    const library = makeTestLibrary();
    const def = fixture(biomes.map((_, i) => spike(i * 20)));
    const view = new LevelView(loadLevel(def), library);
    const meshes = view.group.children.filter((child): child is THREE.Mesh =>
      child instanceof THREE.Mesh && child.geometry === library.spikeCone);
    const attr = lines(view).geometry.getAttribute('color');
    const spikeStart = attr.count - biomes.length * 16;
    biomes.forEach((biome, index) => {
      const style = library.spikeBiome(biome);
      expect(meshes[index]?.material).toBe(style.material);
      for (let k = 0; k < 16; k++) {
        const i = spikeStart + index * 16 + k;
        expect(attr.getX(i)).toBeCloseTo(style.edge.r, 6);
        expect(attr.getY(i)).toBeCloseTo(style.edge.g, 6);
        expect(attr.getZ(i)).toBeCloseTo(style.edge.b, 6);
      }
    });
    const before = Array.from(attr.array).slice(spikeStart * 3);
    const materialCount = library.materialCount;
    for (const accent of [0xff0000, 0x00ff00, 0x0000ff, library.routeEdge.color.getHex()]) {
      library.applyRouteState(0xffffff, 0xffffff, accent);
      view.setEdgeAccent(accent);
      expect(Array.from(attr.array).slice(spikeStart * 3)).toEqual(before);
    }
    expect(library.materialCount).toBe(materialCount);
    view.dispose(); library.dispose();
  });

  it('preserves all mount transforms, collider data and outlines with one batched socket draw', () => {
    const library = makeTestLibrary();
    const def = fixture(['floor', 'ceiling', 'leftWall', 'rightWall'].map(
      (mount, i) => spike(20 + i, mount as LevelHazard['mount']),
    ));
    const loaded = loadLevel(def);
    const colliderBefore = structuredClone(loaded.colliders);
    const hazardBefore = structuredClone(def.hazards);
    const base = new LevelView(loadLevel({ ...def, visualDressing: undefined }), library);
    const authored = new LevelView(loaded, library);
    expect(loaded.colliders).toEqual(colliderBefore);
    expect(def.hazards).toEqual(hazardBefore);
    expect(authored.group.children.length).toBe(base.group.children.length + 1);
    const sockets = authored.group.children.filter((child) => child.userData.biomeSpikeSocket === true);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]).toBeInstanceOf(THREE.InstancedMesh);
    const meshes = (view: LevelView): THREE.Mesh[] => view.group.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry === library.spikeCone,
    );
    meshes(authored).forEach((mesh, i) => {
      const original = meshes(base)[i];
      expect(mesh.position).toEqual(original?.position);
      expect(mesh.scale).toEqual(original?.scale);
      expect(mesh.quaternion.toArray()).toEqual(original?.quaternion.toArray());
    });
    expect(Array.from(lines(authored).geometry.getAttribute('position').array)).toEqual(
      Array.from(lines(base).geometry.getAttribute('position').array),
    );
    authored.dispose(); base.dispose(); library.dispose();
  });

  it('retains warm materials/colors outside authored rows and for blocks/killFront', () => {
    const library = makeTestLibrary();
    const def = fixture([spike(-1), spike(180),
      { ...spike(25), visual: 'block' }, { ...spike(27), kind: 'killFront' }]);
    const before = library.materialCount;
    const view = new LevelView(loadLevel(def), library);
    const hazardBodies = view.group.children.filter((child) =>
      child instanceof THREE.Mesh && child.material === library.hazard);
    expect(hazardBodies).toHaveLength(4);
    const attr = lines(view).geometry.getAttribute('color');
    for (let i = attr.count - 32; i < attr.count; i++) {
      expect(attr.getX(i)).toBeCloseTo(library.hazard.color.r, 6);
      expect(attr.getY(i)).toBeCloseTo(library.hazard.color.g, 6);
      expect(attr.getZ(i)).toBeCloseTo(library.hazard.color.b, 6);
    }
    expect(library.materialCount).toBe(before);
    view.dispose(); library.dispose();
  });

  it('builds nine distinct 3D sockets, bounded to the base footprint on every mount', () => {
    const library = makeTestLibrary();
    const signatures = new Set<string>();
    for (const biome of biomes) {
      for (const mount of ['floor', 'ceiling', 'leftWall', 'rightWall'] as const) {
        const def = fixture([spike(96, mount)]);
        def.visualDressing = [{ biome, z0: 0, z1: 200, density: 0, seed: 0, accent: 0xff0000 }];
        const view = new LevelView(loadLevel(def), library);
        const cone = view.group.children.find((child) => child instanceof THREE.Mesh && child.geometry === library.spikeCone);
        if (!(cone instanceof THREE.Mesh)) throw new Error('Missing lethal pyramid');
        cone.updateMatrix();
        const inverse = cone.matrix.clone().invert();
        const batches = view.group.children.filter((child) => child.userData.biomeSpikeSocket === true);
        expect(batches).toHaveLength(1); // Even at a 96-unit boundary, no split/unbatched pieces.
        const batch = batches[0];
        if (!(batch instanceof THREE.InstancedMesh)) throw new Error('Socket must be instanced');
        expect(batch.count).toBeGreaterThanOrEqual(4);
        expect(batch.count).toBeLessThanOrEqual(6);
        expect(batch.geometry).toBe(library.unitBox);
        expect(batch.material).toBe(library.spikeBiome(biome).socket);
        expect(batch.instanceMatrix.usage).toBe(THREE.StaticDrawUsage);
        const localTransforms: number[][] = [];
        const matrix = new THREE.Matrix4();
        const point = new THREE.Vector3();
        let exposedCorners = 0;
        for (let i = 0; i < batch.count; i++) {
          batch.getMatrixAt(i, matrix);
          matrix.premultiply(inverse);
          localTransforms.push(matrix.elements.map((value) => Number(value.toFixed(5))));
          for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
            point.set(x, y, z).applyMatrix4(matrix);
            // ConeGeometry's diamond base: |x|+|z| <= radius 0.5.
            expect(Math.abs(point.x) + Math.abs(point.z)).toBeLessThanOrEqual(0.500001);
            // World-space Float32 instances translated at z=96 round by
            // a few millionths when transformed back into cone space.
            expect(point.y).toBeGreaterThanOrEqual(-0.50001);
            expect(point.y).toBeLessThanOrEqual(-0.279999);
            if (Math.abs(point.x) + Math.abs(point.z) > 0.5 * (0.5 - point.y)) exposedCorners++;
          }
        }
        // Relief must actually project beyond the low cone faces to be visible.
        expect(exposedCorners).toBeGreaterThan(0);
        if (mount === 'floor') signatures.add(JSON.stringify(localTransforms));
        const before = Array.from(batch.instanceMatrix.array);
        view.setEdgeAccent(0xff0000);
        expect(Array.from(batch.instanceMatrix.array)).toEqual(before);
        view.dispose();
      }
    }
    expect(signatures.size).toBe(9);
    library.dispose();
  });

  it('batches repeated socket detail by chunk/material rather than adding a draw per spike', () => {
    const library = makeTestLibrary();
    const def = fixture(Array.from({ length: 20 }, (_, i) => spike(21 + i)));
    def.visualDressing = [{ biome: 'works', z0: 0, z1: 200, density: 0, seed: 0, accent: 0xff0000 }];
    const view = new LevelView(loadLevel(def), library);
    const batches = view.group.children.filter((child) => child.userData.biomeSpikeSocket === true);
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    if (!(batch instanceof THREE.InstancedMesh)) throw new Error('Missing mechanical collars');
    expect(batch.count).toBe(120);
    expect(view.group.children.filter((child) => child.name === 'biome-spike-socket')).toHaveLength(0);
    view.dispose(); library.dispose();
  });

  it.each([THE_DESCENT_CLASSIC, PRODUCTION_SHOWCASE_01])('resolves actual level spike styles: $id', (def) => {
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(def), library);
    const meshes = view.group.children.filter((child): child is THREE.Mesh =>
      child instanceof THREE.Mesh && child.geometry === library.spikeCone);
    const hazards = def.hazards.filter((h) => h.kind !== 'killFront' && h.visual !== 'block');
    expect(meshes).toHaveLength(hazards.length);
    hazards.forEach((hazard, i) => {
      const row = def.visualDressing?.find((act) => hazard.center.z >= act.z0 && hazard.center.z < act.z1);
      expect(meshes[i]?.material).toBe(row === undefined ? library.hazard : library.spikeBiome(row.biome).material);
    });
    view.dispose(); library.dispose();
  });

  it('disposes every cached style once and clears the cache', () => {
    const library = makeTestLibrary();
    const styles = biomes.map((biome) => library.spikeBiome(biome));
    const disposers = styles.map((style) => vi.spyOn(style.material, 'dispose'));
    const socketDisposers = styles.map((style) => vi.spyOn(style.socket, 'dispose'));
    library.dispose();
    disposers.forEach((dispose) => { expect(dispose).toHaveBeenCalledTimes(1); });
    socketDisposers.forEach((dispose) => { expect(dispose).toHaveBeenCalledTimes(1); });
    expect(library.materialCount).toBe(0);
    const replacement = library.spikeBiome('garden');
    expect(replacement).not.toBe(styles[1]);
    expect(library.materialCount).toBe(2);
    library.dispose();
    expect(library.materialCount).toBe(0);
  });
});
