import * as THREE from 'three';
import type { LoadedLevel } from '../level/levelRuntime';
import type { MaterialLibrary } from './MaterialLibrary';

/** Solids shorter than this carry no face trims (markers, thin inlays). */
const FACE_TRIM_MIN_HEIGHT = 0.8;
/** Faces narrower than this get no center seam (small faces read via frame). */
const FACE_SEAM_MIN_WIDTH = 6.0;
/**
 * Bottom-face trims (underside rails) apply only to undersides exposed in
 * open air well above the void reference (world-space heuristic — the same
 * axis the gameplay frame uses). Ground-resting or buried bottoms are skipped:
 * their rails would either poke through a host solid's top face or never be
 * seen, and the M3.2 audit measured that only elevated undersides (ceiling run
 * surfaces) need them — see specs/milestones/M3_2_CEILING_VIEW_PARITY.md.
 */
const UNDER_RAIL_MIN_BOTTOM_Y = 2.0;
// NOTE: every face trim below rides ~0.04 proud of its host face (applique).
// Fully embedded trims are invisible inside the opaque solid (M1.2 lesson).

/**
 * Level view: builds Three.js representations from level data.
 * Shared library geometries + shared library materials (M6A material
 * ownership: this view creates Meshes only — never materials/geometries).
 * Colliders remain the gameplay truth; these meshes are visuals only.
 */
export class LevelView {
  public readonly group: THREE.Group;

  constructor(
    level: LoadedLevel,
    private readonly library: MaterialLibrary,
  ) {
    this.group = new THREE.Group();

    const box = library.unitBox;
    const spike = library.spikeCone;

    const bodyMat = library.routeBody;
    const topMat = library.routeTop;
    const underMat = library.routeUnder;
    const edgeMat = library.routeEdge;
    const hazardMat = library.hazard;

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

      // M3.1: underside inset, same visual language as the top inset — this
      // is the RUN SURFACE of ceiling-gravity sections. A down-facing face
      // receives only the near-black hemisphere ground light, so the ceiling
      // underside used to render as a void and the attached Cube read as
      // floating. A dim UNLIT panel (rides 0.011 proud below the face) keeps
      // the surface readable from the corridor below. On floor content the
      // bottom faces are buried or void-facing, so this changes nothing there.
      if (solidHeight >= FACE_TRIM_MIN_HEIGHT) {
        const under = new THREE.Mesh(box, underMat);
        under.scale.set(
          solid.halfExtents.x * 2 - 0.12,
          0.02,
          solid.halfExtents.z * 2 - 0.12,
        );
        under.position.set(solid.center.x, bottomY - 0.011, solid.center.z);
        this.group.add(under);

        // M3.2: underside edge rails — the mirror of the top-edge strips
        // below, for exposed undersides only (see UNDER_RAIL_MIN_BOTTOM_Y).
        // Evidence (M3.2 audit): every neon rail previously lived on top
        // faces, so the ceiling run surface had zero edge structure while the
        // floor track glowed with it; and the below-focus camera makes the
        // Cube's own silhouette occlude the ceiling surface ~4..16 u ahead —
        // the LATERAL edges beside that silhouette are the only viable
        // forward cue. Rails mark the corridor boundaries and the lethal gap
        // edges with the same visual language the floor already has.
        if (bottomY >= UNDER_RAIL_MIN_BOTTOM_Y) {
          for (const side of [-1, 1]) {
            const strip = new THREE.Mesh(box, edgeMat);
            strip.scale.set(solidWidth, 0.055, 0.09);
            strip.position.set(
              solid.center.x,
              bottomY - 0.01,
              solid.center.z + side * (solid.halfExtents.z - 0.06),
            );
            this.group.add(strip);
            const stripSide = new THREE.Mesh(box, edgeMat);
            stripSide.scale.set(0.09, 0.055, solid.halfExtents.z * 2);
            stripSide.position.set(
              solid.center.x + side * (solid.halfExtents.x - 0.06),
              bottomY - 0.01,
              solid.center.z,
            );
            this.group.add(stripSide);
          }
        }

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

    // Hazard spikes orient relative to their declared support surface (M7.1
    // general rule — no level-id branches, no coordinate heuristics): the
    // base attaches to the support and the tip points AWAY from it (floor:
    // tip +Y; ceiling: tip −Y). Gameplay colliders are untouched — only the
    // presentation mesh flips and re-seats. Omitted `mount` = 'floor', so
    // every pre-M7.1 level renders byte-identically.
    for (const hazard of level.def.hazards) {
      const mesh = new THREE.Mesh(spike, hazardMat);
      const ceilingMount = hazard.mount === 'ceiling';
      const visualHeight = hazard.halfExtents.y * 3.4;
      mesh.scale.set(hazard.halfExtents.x * 2.2, visualHeight, hazard.halfExtents.z * 2.2);
      // Floor: base at the collider bottom (tip up). Ceiling: base at the
      // collider top, flush with the run surface above (tip down). The cone
      // geometry carries its tip at +height/2, so the ceiling mount flips it
      // with rotation.x = PI (applied before the diamond yaw — tip −Y either
      // way for the symmetric cross-section).
      mesh.position.set(
        hazard.center.x,
        ceilingMount
          ? hazard.center.y + hazard.halfExtents.y - visualHeight / 2
          : hazard.center.y - hazard.halfExtents.y + visualHeight / 2,
        hazard.center.z,
      );
      mesh.rotation.x = ceilingMount ? Math.PI : 0;
      mesh.rotation.y = Math.PI / 4;
      this.group.add(mesh);
    }

    this.buildGravityPortals(level);
  }

  /**
   * M3 gravity portal visuals: a vertical neon gateway spanning the route at
   * each portal's crossing Z. Purely presentational — triggering lives in the
   * simulation (forward-crossing plane), never here. Shared unit-box geometry
   * and ONE shared material per direction (up = cyan, down = warm); zero
   * per-frame work.
   */
  private buildGravityPortals(level: LoadedLevel): void {
    if (level.gravityPortals.length === 0) return;
    const frameMatUp = this.library.portalUp;
    const frameMatDown = this.library.portalDown;
    const paneMatUp = this.library.portalPaneUp;
    const paneMatDown = this.library.portalPaneDown;
    const unitBox = this.library.unitBox;

    // Span the route: lateral extent from the lane layout, vertical extent
    // from the floor up past the ceiling band. Presentation values only.
    const lanes = level.laneCenters;
    const lateralHalf = Math.max(Math.abs(lanes[0] ?? 0), Math.abs(lanes[lanes.length - 1] ?? 0)) + 1.6;
    const portalBottom = -0.6;
    const portalTop = 9;
    const height = portalTop - portalBottom;
    const centerY = portalBottom + height / 2;

    for (const portal of level.gravityPortals) {
      const up = portal.target === 'ceiling';
      const frameMat = up ? frameMatUp : frameMatDown;
      const paneMat = up ? paneMatUp : paneMatDown;
      // Two side posts + top/bottom bars in a plane facing the camera...
      const postGeomScale = { x: 0.14, y: height, z: 0.14 };
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(unitBox, frameMat);
        post.scale.set(postGeomScale.x, postGeomScale.y, postGeomScale.z);
        post.position.set(sx * lateralHalf, centerY, portal.z);
        this.group.add(post);
      }
      for (const sy of [portalBottom, portalTop]) {
        const bar = new THREE.Mesh(unitBox, frameMat);
        bar.scale.set(lateralHalf * 2, 0.14, 0.14);
        bar.position.set(0, sy, portal.z);
        this.group.add(bar);
      }
      // ...plus a faint translucent pane so the gateway reads as a threshold.
      const pane = new THREE.Mesh(unitBox, paneMat);
      pane.scale.set(lateralHalf * 2, height, 0.02);
      pane.position.set(0, centerY, portal.z);
      this.group.add(pane);
    }
  }

  public dispose(): void {
    // Meshes only — materials/geometries belong to the MaterialLibrary.
    this.group.clear();
  }
}
