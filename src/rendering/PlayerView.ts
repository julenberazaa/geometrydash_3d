import * as THREE from 'three';
import type { MaterialLibrary } from './MaterialLibrary';

/**
 * Player view: production Cube treatment (M6A).
 *
 * Layered, cyan-dominant, readable at all speeds:
 * - dark cyan metal body (depth + surface response under the key light),
 * - bright emissive accents on BOTH free-face candidates (top panel = the
 *   Floor free face, bottom panel = the Ceiling free face) so the Cube
 *   reads identically on either gravity surface (M3.3 parity, visual side),
 * - cyan edge lines (controlled bloom contributor, never white),
 * - camera-facing marker quad (identity detail, rest orientation).
 *
 * Visual size (1.24 edge) and pose rules are UNCHANGED: the gameplay
 * collider (1.1³, never rotates) is untouched; airtime tumble is
 * render-only and snaps to rest on landing; rest orientation aligns to the
 * surface normal (180° Z roll presentation on Ceiling; the CAMERA never
 * rolls). No reference assets — all procedural.
 *
 * Materials/geometries come from the shared MaterialLibrary (M6A
 * ownership): this view creates Meshes only, allocates nothing per-frame,
 * and disposes nothing (the library owns its resources).
 */
export class PlayerView {
  public readonly group: THREE.Group;
  private readonly cube: THREE.Mesh;
  private readonly edgeLines: THREE.LineSegments;
  private readonly spinState: { angle: number; airborne: boolean };

  constructor(library: MaterialLibrary) {
    this.group = new THREE.Group();
    this.spinState = { angle: 0, airborne: false };

    const size = 1.24; // visual cube edge; gameplay collider is 1.1
    this.cube = new THREE.Mesh(library.playerBox, library.playerBody);
    this.edgeLines = new THREE.LineSegments(library.playerEdges, library.playerEdge);

    // Free-face accents ride WITH the cube (children inherit the tumble and
    // the ceiling rest roll, so they always mark the true surface faces).
    const panelOffset = size / 2 + 0.002;
    const topFace = new THREE.Mesh(library.playerFacePlane, library.playerFace);
    topFace.position.y = panelOffset;
    topFace.rotation.x = -Math.PI / 2;
    const bottomFace = new THREE.Mesh(library.playerFacePlane, library.playerFace);
    bottomFace.position.y = -panelOffset;
    bottomFace.rotation.x = Math.PI / 2;
    // Camera-side identity marker (faces the chase camera at rest on Floor).
    const rearFace = new THREE.Mesh(library.playerFacePlane, library.playerFace);
    rearFace.position.z = -panelOffset;
    rearFace.rotation.y = Math.PI;
    this.cube.add(topFace, bottomFace, rearFace);

    this.group.add(this.cube, this.edgeLines);
  }

  /**
   * Update the view from SIMULATION state (interpolated position) and
   * render dt. Never writes back to simulation.
   *
   * `upsideDown` is render-only presentation of the authoritative gravity
   * mode: on Ceiling the rest orientation flips 180° around Z (world up stays
   * world up — the CAMERA never rolls) so the cube reads as hanging under the
   * ceiling. Air tumble continues to be a forward roll on either surface.
   */
  public updateFromSimulation(
    interpolatedPosition: Readonly<{ x: number; y: number; z: number }>,
    grounded: boolean,
    renderDtSeconds: number,
    upsideDown: boolean,
  ): void {
    this.group.position.set(interpolatedPosition.x, interpolatedPosition.y, interpolatedPosition.z);

    // Render-only forward tumble while airborne; ease back to rest when grounded.
    if (!grounded) {
      this.spinState.angle += renderDtSeconds * Math.PI * 1.15;
      this.spinState.airborne = true;
    } else if (this.spinState.airborne) {
      // Snap cleanly to rest on landing (render-only; hitbox never rotates).
      this.spinState.airborne = false;
      this.spinState.angle = 0;
    }
    const restRoll = upsideDown ? Math.PI : 0;
    this.cube.rotation.set(this.spinState.angle, 0, restRoll);
    this.edgeLines.rotation.copy(this.cube.rotation);
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public dispose(): void {
    // Meshes only — materials/geometries belong to the MaterialLibrary.
    this.group.clear();
  }
}
