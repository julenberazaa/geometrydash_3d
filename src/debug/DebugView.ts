import * as THREE from 'three';
import type { CollisionWorld } from '../collision/CollisionWorld';
import type { Vec3 } from '../core/math';

/**
 * Debug layer: collider visualization + on-canvas state readouts.
 * Everything here is toggleable (F1 overlay text, F2 colliders) and clearly
 * non-art: wireframe boxes, flat colors, no lighting.
 */
export class DebugView {
  public readonly group: THREE.Group;
  private readonly playerBox: THREE.LineSegments;
  private readonly solidMat: THREE.LineBasicMaterial;
  private readonly hazardMat: THREE.LineBasicMaterial;
  private readonly playerMat: THREE.LineBasicMaterial;
  private readonly disposables: Array<{ dispose(): void }> = [];

  public collidersVisible = false;
  public playerBoxVisible = false;

  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    this.solidMat = new THREE.LineBasicMaterial({ color: 0x00ff88 });
    this.hazardMat = new THREE.LineBasicMaterial({ color: 0xff3300 });
    this.playerMat = new THREE.LineBasicMaterial({ color: 0xffff00 });

    const unit = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(unit);
    this.disposables.push(unit, edges);

    this.boxTemplate = edges;

    // Player hitbox outline (scaled at update time).
    this.playerBox = new THREE.LineSegments(edges, this.playerMat);
    this.group.add(this.playerBox);
  }

  private boxTemplate: THREE.BufferGeometry;

  /** Rebuild static collider outlines (call once per level load). */
  public buildColliders(world: CollisionWorld): void {
    // Remove previous outlines.
    for (const child of [...this.group.children]) {
      if (child !== this.playerBox) {
        this.group.remove(child);
      }
    }
    for (const c of world.colliders()) {
      const line = new THREE.LineSegments(
        this.boxTemplate,
        c.kind === 'solid' ? this.solidMat : this.hazardMat,
      );
      line.scale.set(c.halfExtents.x * 2, c.halfExtents.y * 2, c.halfExtents.z * 2);
      line.position.set(c.center.x, c.center.y, c.center.z);
      this.group.add(line);
    }
  }

  public setCollidersVisible(visible: boolean): void {
    this.collidersVisible = visible;
    for (const child of this.group.children) {
      if (child !== this.playerBox) child.visible = visible;
    }
    this.group.visible = true;
  }

  public setPlayerBoxVisible(visible: boolean): void {
    this.playerBoxVisible = visible;
    this.playerBox.visible = visible;
    this.group.visible = true;
  }

  public updatePlayerBox(position: Readonly<Vec3>, halfExtents: Readonly<Vec3>): void {
    this.playerBox.scale.set(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
    this.playerBox.position.set(position.x, position.y, position.z);
  }

  public dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.solidMat.dispose();
    this.hazardMat.dispose();
    this.playerMat.dispose();
    this.group.clear();
  }
}
