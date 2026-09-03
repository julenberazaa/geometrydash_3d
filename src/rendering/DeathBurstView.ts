import * as THREE from 'three';
import type { Vec3 } from '../core/math';

/**
 * DeathBurstView: short procedural death effect, rendering-only.
 *
 * - Fixed pool of 14 fragments (shared geometry, 2 shared materials).
 * - Deterministic radial burst from a fixed direction table (no RNG).
 * - 0.35 s lifetime, shrink-out; hidden when expired.
 * - Zero allocation after construction; scene child count never grows.
 * - Never touches gameplay state: the renderer triggers it by observing
 *   GameSimulation.deathId and plays it at the frozen death position.
 */

export const DEATH_BURST_LIFETIME = 0.35;
const FRAGMENT_COUNT = 14;
const FRAGMENT_SIZE = 0.16;
const BURST_GRAVITY = 12;

export class DeathBurstView {
  public readonly group: THREE.Group;
  private readonly fragments: THREE.Mesh[] = [];
  private readonly velocities: THREE.Vector3[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private age = Infinity;
  private active = false;

  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    const geometry = new THREE.BoxGeometry(FRAGMENT_SIZE, FRAGMENT_SIZE, FRAGMENT_SIZE);
    this.geometries.push(geometry);
    const cyan = new THREE.MeshBasicMaterial({ color: 0x66ffff });
    const white = new THREE.MeshBasicMaterial({ color: 0xeaffff });
    this.materials.push(cyan, white);

    // Deterministic burst directions: golden-angle spiral over the sphere,
    // biased upward so the burst reads as an explosion, not a collapse.
    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      const t = (i + 0.5) / FRAGMENT_COUNT;
      const phi = Math.acos(1 - 2 * t);
      const theta = i * 2.399963; // golden angle
      const speed = 4 + (i % 4) * 1.1;
      const dir = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.abs(Math.cos(phi)) * 0.9 + 0.35,
        Math.sin(phi) * Math.sin(theta),
      ).normalize();
      this.velocities.push(dir.multiplyScalar(speed));
      const mesh = new THREE.Mesh(geometry, i % 2 === 0 ? cyan : white);
      mesh.visible = false;
      this.fragments.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Start the burst at a world position (reads sim state, never writes it). */
  public play(origin: Readonly<Vec3>): void {
    this.age = 0;
    this.active = true;
    this.group.visible = true;
    for (const f of this.fragments) {
      f.position.set(origin.x, origin.y, origin.z);
      f.scale.setScalar(1);
      f.visible = true;
    }
  }

  /** Advance with RENDER dt (visual only). Hides everything at expiry. */
  public update(renderDtSeconds: number): void {
    if (!this.active) return;
    this.age += renderDtSeconds;
    const t = Math.min(1, this.age / DEATH_BURST_LIFETIME);
    for (let i = 0; i < this.fragments.length; i++) {
      const f = this.fragments[i];
      const vel = this.velocities[i];
      if (f === undefined || vel === undefined) continue;
      vel.y -= BURST_GRAVITY * renderDtSeconds;
      f.position.x += vel.x * renderDtSeconds;
      f.position.y += vel.y * renderDtSeconds;
      f.position.z += vel.z * renderDtSeconds;
      f.scale.setScalar(Math.max(0.001, 1 - t));
    }
    if (this.age >= DEATH_BURST_LIFETIME) this.clear();
  }

  /** Hide immediately (respawn safety / dispose). Idempotent. */
  public clear(): void {
    this.active = false;
    this.age = Infinity;
    this.group.visible = false;
    for (const f of this.fragments) f.visible = false;
  }

  public get isActive(): boolean {
    return this.active;
  }

  public dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.clear();
  }
}
