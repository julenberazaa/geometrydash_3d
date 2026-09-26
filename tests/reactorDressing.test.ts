import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { THE_DESCENT_CLASSIC } from '../src/content/levels/theDescentClassic';
import { EnvironmentView } from '../src/rendering/EnvironmentView';
import { PRODUCTION_THEME } from '../src/visuals/productionTheme';

describe('reactor interior dressing', () => {
  it('puts visible 3D conduits inside both thin tunnel walls, outside the playable footprint', () => {
    const view = new EnvironmentView(1800, PRODUCTION_THEME, THE_DESCENT_CLASSIC);
    const surfaces = (view as unknown as { surfaceMeshes: THREE.InstancedMesh[] }).surfaceMeshes;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const sides = new Set<number>();
    let conduits = 0;
    for (const mesh of surfaces) {
      for (let instance = 0; instance < mesh.count; instance++) {
        mesh.getMatrixAt(instance, matrix);
        position.setFromMatrixPosition(matrix);
        scale.setFromMatrixScale(matrix);
        if (Math.abs(scale.z - 8.3) > 0.0001 || Math.abs(scale.y - 0.26) > 0.0001) continue;
        conduits++;
        sides.add(Math.sign(position.x));
        expect(position.z).toBeGreaterThan(1110);
        expect(position.z).toBeLessThan(1330);
        expect(Math.abs(position.x) - scale.x / 2).toBeGreaterThan(5.4);
        expect(Math.abs(position.x) + scale.x / 2).toBeLessThan(6);
      }
    }
    expect(sides).toEqual(new Set([-1, 1]));
    expect(conduits).toBeGreaterThan(40);
    view.dispose();
  });
});
