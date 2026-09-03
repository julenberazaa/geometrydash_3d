import * as THREE from 'three';
import { PALETTE } from '../visuals/palette';

/**
 * Player view: original procedural cube (no reference assets).
 * Dark body + emissive cyan edges + bright face marking; slight visual oversize
 * vs the gameplay collider for fairness/readability.
 * Visual rotation during airtime is RENDER-ONLY; the gameplay hitbox is a
 * stable AABB and never rotates (spec §16/§25).
 */
export class PlayerView {
  public readonly group: THREE.Group;
  private readonly cube: THREE.Mesh;
  private readonly innerFace: THREE.Mesh;
  private readonly edgeLines: THREE.LineSegments;
  private readonly spinState: { angle: number; airborne: boolean };

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.spinState = { angle: 0, airborne: false };

    const size = 1.24; // visual cube edge; gameplay collider is 1.1
    const body = new THREE.BoxGeometry(size, size, size);
    const face = new THREE.PlaneGeometry(size * 0.52, size * 0.52);
    this.geometries.push(body, face);

    const bodyMat = new THREE.MeshLambertMaterial({ color: PALETTE.playerBody });
    const faceMat = new THREE.MeshBasicMaterial({
      color: PALETTE.playerFace,
      transparent: true,
      opacity: 0.95,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: PALETTE.playerEdge });
    this.materials.push(bodyMat, faceMat, edgeMat);

    this.cube = new THREE.Mesh(body, bodyMat);
    this.innerFace = new THREE.Mesh(face, faceMat);
    this.innerFace.position.z = size / 2 + 0.002;

    const edges = new THREE.EdgesGeometry(body);
    this.geometries.push(edges);
    this.edgeLines = new THREE.LineSegments(edges, edgeMat);

    this.group.add(this.cube, this.edgeLines, this.innerFace);
  }

  /**
   * Update the view from SIMULATION state (current + previous position) and
   * interpolation alpha. Never writes back to simulation.
   */
  public updateFromSimulation(
    interpolatedPosition: Readonly<{ x: number; y: number; z: number }>,
    grounded: boolean,
    renderDtSeconds: number,
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
    this.cube.rotation.set(this.spinState.angle, 0, 0);
    this.edgeLines.rotation.copy(this.cube.rotation);
    this.innerFace.rotation.set(0, 0, 0);
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
