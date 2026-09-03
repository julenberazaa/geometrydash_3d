import * as THREE from 'three';
import type { LoadedLevel } from '../level/levelRuntime';
import { PALETTE } from '../visuals/palette';

/** Solids shorter than this carry no face trims (markers, thin inlays). */
const FACE_TRIM_MIN_HEIGHT = 0.8;
/** Faces narrower than this get no center seam (small faces read via frame). */
const FACE_SEAM_MIN_WIDTH = 6.0;
// NOTE: every face trim below rides ~0.04 proud of its host face (applique).
// Fully embedded trims are invisible inside the opaque solid (M1.2 lesson).

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

      // Exposed-face edge treatment (M1.1 corners + M1.2 faces): thin unlit
      // boxes in the shared edge material framing each solid so slabs read
      // as volumes and gap/drop faces glow instead of vanishing into holes.
      //
      // Hard lesson (M1.2 root cause): trims fully INSIDE the solid footprint
      // are invisible — an opaque box hides anything behind its faces. Every
      // face trim therefore rides PROUD of its host face (applique): each
      // piece protrudes ~0.04 beyond the face plane while staying embedded
      // enough to anchor. Intersecting trims use staggered depths
      // (5 mm plane separations) so no two faces are ever coplanar.
      // Restrained: markers/inlays (< 0.8 tall) stay quiet; orange spike
      // hazards are never trimmed and remain visually distinct.
      const solidHeight = solid.halfExtents.y * 2;
      const solidWidth = solid.halfExtents.x * 2;
      const bottomY = solid.center.y - solid.halfExtents.y;
      const frontZ = solid.center.z - solid.halfExtents.z; // faces the camera
      if (solidHeight >= FACE_TRIM_MIN_HEIGHT) {
        // Four corner posts, outboard of the solid so each shows on BOTH
        // adjacent faces (front/back + sides share the corners).
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const post = new THREE.Mesh(box, edgeMat);
            post.scale.set(0.09, solidHeight, 0.09);
            post.position.set(
              solid.center.x + sx * (solid.halfExtents.x + 0.005),
              solid.center.y - 0.02,
              solid.center.z + sz * (solid.halfExtents.z + 0.005),
            );
            this.group.add(post);
          }
        }
        // Front-face bottom strip: completes the glowing rectangle with the
        // existing top strip + corner posts. Gap landing faces read as
        // framed portals instead of dark holes.
        const sill = new THREE.Mesh(box, edgeMat);
        sill.scale.set(solidWidth, 0.055, 0.09);
        sill.position.set(solid.center.x, bottomY + 0.03, frontZ);
        this.group.add(sill);
        // Front-face center seam on wide solids: breaks up the dark face
        // center where the player actually looks when crossing gaps.
        if (solidWidth >= FACE_SEAM_MIN_WIDTH) {
          const seam = new THREE.Mesh(box, edgeMat);
          seam.scale.set(0.09, solidHeight, 0.09);
          seam.position.set(solid.center.x, solid.center.y - 0.02, frontZ + 0.005);
          this.group.add(seam);
        }
      }

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
