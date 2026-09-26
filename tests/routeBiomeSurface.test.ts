import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { loadLevel } from '../src/level/levelRuntime';
import { LevelView } from '../src/rendering/LevelView';
import { makeTestLibrary } from './helpers/visuals';

describe('authored route surfaces', () => {
  it('gives Descent distinct world-space material structures without altering hazard materials', () => {
    const library = makeTestLibrary();
    const baseMaterials = library.materialCount;
    const view = new LevelView(loadLevel(THE_DESCENT_CLASSIC), library);
    const mats = new Set<THREE.Material>();
    for (const [index, solid] of THE_DESCENT_CLASSIC.solids.entries()) {
      const row = THE_DESCENT_CLASSIC.visualDressing?.find(
        (act) => solid.center.z >= act.z0 && solid.center.z < act.z1,
      );
      const body = view.occluderMeshes.get(`solid-${index}`);
      expect(body).toBeDefined();
      if (row === undefined) continue;
      expect(body?.material).toBe(library.routeBiome(row.biome));
      if (body !== undefined) mats.add(body.material as THREE.Material);
    }
    expect(mats.size).toBeGreaterThanOrEqual(7);
    const garden = library.routeBiome('garden');
    const foundry = library.routeBiome('foundry');
    expect(garden.map).toBeNull();
    expect(foundry.map).toBeNull();
    expect(garden.customProgramCacheKey()).not.toBe(foundry.customProgramCacheKey());
    expect(garden.onBeforeCompile.toString()).toContain('vRouteWorldPos.xz');
    expect(garden.onBeforeCompile.toString()).toContain('routeSurfaceShader');
    expect(library.hazard.map).toBeNull();
    // Nine route shaders + two cached materials per biome spike style.
    expect(library.materialCount - baseMaterials).toBeLessThanOrEqual(27);
    view.dispose();
    library.dispose();
    expect(library.materialCount).toBe(0);
  });

  it('keeps Rift on its original shared route material', () => {
    const library = makeTestLibrary();
    const before = library.materialCount;
    const view = new LevelView(loadLevel(PRODUCTION_SHOWCASE_01), library);
    for (const body of view.occluderMeshes.values()) {
      expect(body.material).toBe(library.routeBody);
    }
    expect(library.materialCount - before).toBeLessThanOrEqual(3);
    view.dispose();
    library.dispose();
  });
});
