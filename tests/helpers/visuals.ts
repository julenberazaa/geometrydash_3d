import { MaterialLibrary } from '../../src/rendering/MaterialLibrary';
import { PRODUCTION_THEME } from '../../src/visuals/productionTheme';
import * as THREE from 'three';

/**
 * Test-only visual helper (NOT a *.test.ts module — reusable support code
 * per AGENTS.md §9). Builds a production MaterialLibrary for structural
 * rendering tests. Three.js materials/geometries construct fine in the node
 * test environment (no DOM/WebGL needed); only WebGLRenderer/composer paths
 * stay browser-only.
 */
export const makeTestLibrary = (): MaterialLibrary =>
  new MaterialLibrary({ ...PRODUCTION_THEME });

/** Structural assertions inspect the same pieces whether represented by
 * individual meshes or Float32 instance transforms. Test-only expansion;
 * shared geometry/material stay owned by the original library. */
export const meshInstances = (group: THREE.Group): THREE.Mesh[] => {
  const pieces: THREE.Mesh[] = [];
  const matrix = new THREE.Matrix4();
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    if (!(child instanceof THREE.InstancedMesh)) {
      pieces.push(child as THREE.Mesh);
      continue;
    }
    for (let i = 0; i < child.count; i++) {
      child.getMatrixAt(i, matrix);
      const piece = new THREE.Mesh(
        child.geometry as THREE.BufferGeometry,
        child.material as THREE.Material | THREE.Material[],
      );
      matrix.decompose(piece.position, piece.quaternion, piece.scale);
      pieces.push(piece);
    }
  }
  return pieces;
};
