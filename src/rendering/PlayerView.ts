import * as THREE from 'three';
import type { GravityMode, PlayerMode } from '../player/playerState';
import type { MaterialLibrary } from './MaterialLibrary';

/**
 * Player view: production Cube treatment (M6A).
 *
 * Layered, cyan-dominant, readable at all speeds:
 * - dark cyan metal body (depth + surface response under the key light),
 * - bright emissive accents on ALL FOUR free-face candidates (top = Floor
 *   free face, bottom = Ceiling free face, left/right = wall free faces)
 *   so the Cube reads identically on every gravity surface (M3.3 parity +
 *   M8B walls, visual side),
 * - cyan edge lines (controlled bloom contributor, never white),
 * - camera-facing marker quad (identity detail, rest orientation).
 *
 * Visual size (1.24 edge) and pose rules are UNCHANGED: the gameplay
 * collider (1.1³, never rotates) is untouched; airtime tumble is
 * render-only and snaps to rest on landing; rest orientation aligns to the
 * surface normal (180° Z roll on Ceiling, ±90° Z roll on walls — the
 * CAMERA never rolls). No reference assets — all procedural.
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
  /** M8C mode models: only one group is visible at a time (sim mode). */
  private readonly cubeGroup: THREE.Group;
  private readonly shipGroup: THREE.Group;
  private readonly spiderGroup: THREE.Group;
  private readonly shipFlame: THREE.Mesh;
  private flameClock = 0;

  constructor(library: MaterialLibrary) {
    this.group = new THREE.Group();
    this.spinState = { angle: 0, airborne: false };

    const size = 1.24; // visual cube edge; gameplay collider is 1.1
    this.cube = new THREE.Mesh(library.playerBox, library.playerBody);
    this.edgeLines = new THREE.LineSegments(library.playerEdges, library.playerEdge);

    // Free-face accents ride WITH the cube (children inherit the tumble
    // and the rest roll, so they always mark the true surface faces).
    const panelOffset = size / 2 + 0.002;
    const topFace = new THREE.Mesh(library.playerFacePlane, library.playerFace);
    topFace.position.y = panelOffset;
    topFace.rotation.x = -Math.PI / 2;
    const bottomFace = new THREE.Mesh(library.playerFacePlane, library.playerFace);
    bottomFace.position.y = -panelOffset;
    bottomFace.rotation.x = Math.PI / 2;
    // M8B wall free faces: left/right accents so the side free face reads
    // on wall gravity (same material, same readability contract).
    const leftFace = new THREE.Mesh(library.playerFacePlane, library.playerFace);
    leftFace.position.x = panelOffset;
    leftFace.rotation.y = Math.PI / 2;
    const rightFace = new THREE.Mesh(library.playerFacePlane, library.playerFace);
    rightFace.position.x = -panelOffset;
    rightFace.rotation.y = -Math.PI / 2;
    // Camera-side identity marker (faces the chase camera at rest on Floor).
    const rearFace = new THREE.Mesh(library.playerFacePlane, library.playerFace);
    rearFace.position.z = -panelOffset;
    rearFace.rotation.y = Math.PI;
    this.cube.add(topFace, bottomFace, leftFace, rightFace, rearFace);

    // Cube assembly (tumble + rest roll apply to the whole group).
    this.cubeGroup = new THREE.Group();
    this.cubeGroup.add(this.cube, this.edgeLines);

    // M8C Ship: procedural neon craft (cyan identity, dark metal body,
    // emissive canopy + nose, bounded rear thrust flame). Nose faces +Z
    // (travel); all shared library geometries/materials, zero new pools.
    this.shipGroup = new THREE.Group();
    const hull = new THREE.Mesh(library.playerBox, library.playerBody);
    hull.scale.set(0.55, 0.42, 1.25);
    const canopy = new THREE.Mesh(library.orbSphere, library.playerFace);
    canopy.scale.setScalar(0.55);
    canopy.position.set(0, 0.28, 0.1);
    const nose = new THREE.Mesh(library.chevron, library.playerFace);
    nose.scale.setScalar(0.7);
    nose.rotation.x = Math.PI / 2; // cone axis -> +Z
    nose.position.set(0, 0, 0.95);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(library.playerFacePlane, library.playerBody);
      wing.scale.set(0.85, 0.5, 1);
      wing.rotation.x = -Math.PI / 2;
      wing.rotation.z = sx * 0.35;
      wing.position.set(sx * 0.62, -0.05, -0.25);
      this.shipGroup.add(wing);
    }
    this.shipFlame = new THREE.Mesh(library.chevron, library.playerFace);
    this.shipFlame.rotation.x = -Math.PI / 2; // cone axis -> −Z (exhaust)
    this.shipFlame.position.set(0, 0, -0.95);
    this.shipFlame.scale.setScalar(0.55);
    this.shipGroup.add(hull, canopy, nose, this.shipFlame);

    // M8C Spider: compact mechanical crawler (dark core + neon accents +
    // static articulated leg read — pose only, no skeletal framework).
    this.spiderGroup = new THREE.Group();
    const core = new THREE.Mesh(library.playerBox, library.playerBody);
    core.scale.set(0.72, 0.4, 0.72);
    const eye = new THREE.Mesh(library.orbSphere, library.playerFace);
    eye.scale.setScalar(0.4);
    eye.position.set(0, 0.18, 0.35);
    this.spiderGroup.add(core, eye);
    for (let i = 0; i < 6; i++) {
      const leg = new THREE.Mesh(library.unitBox, library.playerBody);
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2) - 1; // -1 (rear) .. 0 .. 1 (front)
      leg.scale.set(0.55, 0.09, 0.09);
      leg.position.set(side * 0.55, -0.12, row * 0.32);
      leg.rotation.z = side * -0.5;
      const tip = new THREE.Mesh(library.unitBox, library.playerFace);
      tip.scale.set(0.1, 0.22, 0.1);
      tip.position.set(side * 0.82, -0.26, row * 0.32);
      this.spiderGroup.add(leg, tip);
    }

    this.shipGroup.visible = false;
    this.spiderGroup.visible = false;
    this.group.add(this.cubeGroup, this.shipGroup, this.spiderGroup);
  }

  /**
   * Update the view from SIMULATION state (interpolated position) and
   * render dt. Never writes back to simulation.
   *
   * `gravityMode` is render-only presentation of the authoritative mode:
   * the rest orientation aligns the cube's top face with the surface
   * normal (0° Floor, 180° Z Ceiling, ±90° Z walls — world up stays world
   * up, the CAMERA never rolls) so the cube reads as attached to the
   * support. Air tumble continues to be a forward roll on every surface.
   */
  public updateFromSimulation(
    interpolatedPosition: Readonly<{ x: number; y: number; z: number }>,
    grounded: boolean,
    renderDtSeconds: number,
    gravityMode: GravityMode,
    playerMode: PlayerMode = 'cube',
    thrusting = false,
  ): void {
    this.group.position.set(interpolatedPosition.x, interpolatedPosition.y, interpolatedPosition.z);

    // Mode visibility: exactly one model reads at a time.
    this.cubeGroup.visible = playerMode === 'cube';
    this.shipGroup.visible = playerMode === 'ship';
    this.spiderGroup.visible = playerMode === 'spider';

    const restRoll =
      gravityMode === 'ceiling'
        ? Math.PI
        : gravityMode === 'leftWall'
          ? Math.PI / 2
          : gravityMode === 'rightWall'
            ? -Math.PI / 2
            : 0;
    if (playerMode === 'ship') {
      // Ship: level flight with a bank into the support + thrust flame.
      this.flameClock += renderDtSeconds;
      this.shipGroup.rotation.set(0, 0, restRoll * 0.6);
      const flicker = thrusting ? 1 + 0.25 * Math.sin(this.flameClock * 42) : 0.001;
      this.shipFlame.scale.set(0.55, 0.55, Math.max(0.001, 0.9 * flicker));
      this.shipFlame.visible = thrusting;
      return;
    }
    if (playerMode === 'spider') {
      // Spider: surface-aligned crawler stance (pose only).
      this.spiderGroup.rotation.set(0, 0, restRoll);
      return;
    }

    // Render-only forward tumble while airborne; ease back to rest when grounded.
    if (!grounded) {
      this.spinState.angle += renderDtSeconds * Math.PI * 1.15;
      this.spinState.airborne = true;
    } else if (this.spinState.airborne) {
      // Snap cleanly to rest on landing (render-only; hitbox never rotates).
      this.spinState.airborne = false;
      this.spinState.angle = 0;
    }
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
