import * as THREE from 'three';
import type { LoadedLevel } from '../level/levelRuntime';
import { PALETTE } from '../visuals/palette';

/**
 * Level view: builds Three.js representations from level data.
 * Shared geometries + shared materials; colliders remain the gameplay truth,
 * these meshes are visuals only.
 */
export class LevelView {
  public readonly group: THREE.Group;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(level: LoadedLevel) {
    this.group = new THREE.Group();

    const box = new THREE.BoxGeometry(1, 1, 1);
    const spike = new THREE.ConeGeometry(0.5, 1, 4);
    this.disposables.push(box, spike);

    const bodyMat = new THREE.MeshLambertMaterial({
      color: PALETTE.platformBody,
    });
    const topMat = new THREE.MeshLambertMaterial({ color: PALETTE.platformTop });
    const edgeMat = new THREE.MeshBasicMaterial({ color: PALETTE.platformEdge });
    const hazardMat = new THREE.MeshBasicMaterial({ color: PALETTE.hazardGlow });
    this.disposables.push(bodyMat, topMat, edgeMat, hazardMat);

    for (const solid of level.def.solids) {
      const mesh = new THREE.Mesh(box, bodyMat);
      mesh.scale.set(
        solid.halfExtents.x * 2,
        solid.halfExtents.y * 2,
        solid.halfExtents.z * 2,
      );
      mesh.position.set(solid.center.x, solid.center.y, solid.center.z);
      this.group.add(mesh);

      // Emissive top surface inset slightly (readable walkable area).
      const top = new THREE.Mesh(box, topMat);
      top.scale.set(
        solid.halfExtents.x * 2 - 0.12,
        0.02,
        solid.halfExtents.z * 2 - 0.12,
      );
      top.position.set(
        solid.center.x,
        solid.center.y + solid.halfExtents.y + 0.011,
        solid.center.z,
      );
      this.group.add(top);

      // Neon edge strips along the two long top edges (X direction edges).
      for (const side of [-1, 1]) {
        const strip = new THREE.Mesh(box, edgeMat);
        strip.scale.set(solid.halfExtents.x * 2, 0.055, 0.09);
        strip.position.set(
          solid.center.x,
          solid.center.y + solid.halfExtents.y + 0.01,
          solid.center.z + side * (solid.halfExtents.z - 0.06),
        );
        this.group.add(strip);
        const stripSide = new THREE.Mesh(box, edgeMat);
        stripSide.scale.set(0.09, 0.055, solid.halfExtents.z * 2);
        stripSide.position.set(
          solid.center.x + side * (solid.halfExtents.x - 0.06),
          solid.center.y + solid.halfExtents.y + 0.01,
          solid.center.z,
        );
        this.group.add(stripSide);
      }
    }

    for (const hazard of level.def.hazards) {
      const mesh = new THREE.Mesh(spike, hazardMat);
      mesh.scale.set(hazard.halfExtents.x * 2.2, hazard.halfExtents.y * 3.4, hazard.halfExtents.z * 2.2);
      mesh.position.set(
        hazard.center.x,
        hazard.center.y - hazard.halfExtents.y + (hazard.halfExtents.y * 3.4) / 2,
        hazard.center.z,
      );
      mesh.rotation.y = Math.PI / 4;
      this.group.add(mesh);
    }
  }

  public dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
