import * as THREE from 'three';
import type { Vec3 } from '../core/math';

/**
 * DeathBurstView: short procedural death effect, rendering-only.
 *
 * - Fixed pool of 32 fragments (shared geometry, 3 shared materials).
 * - Deterministic radial burst from a fixed direction table (no RNG).
 * - 0.65 s lifetime (matches the M8A 78-tick death hold), shrink-out;
 *   hidden when expired.
 * - M8A: much stronger — more fragments, larger chunks, faster spray, a
 *   bright core flash plus an expanding shock ring — so deaths land with
 *   real weight and stay readable through the longer hold. Still bounded
 *   (one pool + one ring, shared resources) and still subordinate to the
 *   readability hierarchy (cyan/white player colors, never hazard-orange).
 * - Zero allocation after construction; scene child count never grows.
 * - Never touches gameplay state: the renderer triggers it by observing
 *   GameSimulation.deathId and plays it at the frozen death position.
 */

export const DEATH_BURST_LIFETIME = 0.65;
const FRAGMENT_COUNT = 32;
const FRAGMENT_SIZE = 0.26;
const BURST_GRAVITY = 10;

export class DeathBurstView {
  public readonly group: THREE.Group;
  private readonly fragments: THREE.Mesh[] = [];
  private readonly velocities: THREE.Vector3[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly coreFlash: THREE.Mesh;
  private readonly shockRing: THREE.Mesh;
  private age = Infinity;
  private active = false;

  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    const geometry = new THREE.BoxGeometry(FRAGMENT_SIZE, FRAGMENT_SIZE, FRAGMENT_SIZE);
    this.geometries.push(geometry);
    const cyan = new THREE.MeshBasicMaterial({ color: 0x66ffff });
    const white = new THREE.MeshBasicMaterial({ color: 0xeaffff });
    const deep = new THREE.MeshBasicMaterial({ color: 0x0e4a5a });
    this.materials.push(cyan, white, deep);

    // Deterministic burst directions: golden-angle spiral over the sphere,
    // biased upward so the burst reads as an explosion, not a collapse.
    // M8A: harder spray (7.5 base + wider variance) for a heavier hit.
    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      const t = (i + 0.5) / FRAGMENT_COUNT;
      const phi = Math.acos(1 - 2 * t);
      const theta = i * 2.399963; // golden angle
      const speed = 7.5 + (i % 5) * 1.6;
      const dir = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.abs(Math.cos(phi)) * 0.9 + 0.35,
        Math.sin(phi) * Math.sin(theta),
      ).normalize();
      this.velocities.push(dir.multiplyScalar(speed));
      const mesh = new THREE.Mesh(geometry, [cyan, white, deep][i % 3] ?? cyan);
      mesh.visible = false;
      this.fragments.push(mesh);
      this.group.add(mesh);
    }

    // Core flash: a bright sphere that pops and decays in the first ~0.2 s.
    const coreGeo = new THREE.SphereGeometry(0.85, 14, 10);
    this.geometries.push(coreGeo);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xd8ffff,
      transparent: true,
      opacity: 0,
    });
    this.materials.push(coreMat);
    this.coreFlash = new THREE.Mesh(coreGeo, coreMat);
    this.coreFlash.visible = false;
    this.group.add(this.coreFlash);

    // Shock ring: a flat cyan ring expanding outward in the XZ plane.
    const ringGeo = new THREE.TorusGeometry(1, 0.07, 8, 40);
    this.geometries.push(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x66ffff,
      transparent: true,
      opacity: 0,
    });
    this.materials.push(ringMat);
    this.shockRing = new THREE.Mesh(ringGeo, ringMat);
    this.shockRing.rotation.x = -Math.PI / 2;
    this.shockRing.visible = false;
    this.group.add(this.shockRing);
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
    this.coreFlash.position.set(origin.x, origin.y, origin.z);
    this.coreFlash.scale.setScalar(0.4);
    this.coreFlash.visible = true;
    this.shockRing.position.set(origin.x, origin.y, origin.z);
    this.shockRing.scale.setScalar(0.3);
    this.shockRing.visible = true;
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
    // Core flash: fast pop then fade inside the first third of the burst.
    const coreT = Math.min(1, this.age / 0.22);
    this.coreFlash.scale.setScalar(0.4 + coreT * 1.5);
    (this.coreFlash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.95 * (1 - coreT));
    // Shock ring: expands to ~4.2 u and fades across the full lifetime.
    this.shockRing.scale.setScalar(0.3 + t * 3.9);
    (this.shockRing.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - t));
    if (this.age >= DEATH_BURST_LIFETIME) this.clear();
  }

  /** Hide immediately (respawn safety / dispose). Idempotent. */
  public clear(): void {
    this.active = false;
    this.age = Infinity;
    this.group.visible = false;
    for (const f of this.fragments) f.visible = false;
    this.coreFlash.visible = false;
    this.shockRing.visible = false;
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
