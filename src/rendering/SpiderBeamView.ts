import * as THREE from 'three';
import type { Vec3 } from '../core/math';

/**
 * SpiderBeamView (M9.6): the spider surface-swap transition language.
 *
 * A snap is an instant sanctioned displacement (up to 14 u), not a cut —
 * but with only the shared gravity pulse + camera glide it read as a
 * broken teleport. This view fires a fast vertical energy move on every
 * snap: an additive mint beam connecting the exact travel anchors plus a
 * short particle spray and endpoint flashes, decaying in ~0.32 s. The
 * camera is untouched (the M8.3 glide still owns continuity).
 *
 * Rendering-only: the renderer triggers it by observing
 * `GameSimulation.spiderSnapEventCount` and plays it at the recorded
 * `lastSpiderSnapFrom/To` anchors. Two pooled slots (mashed double-snaps
 * inside one lifetime overlap cleanly), zero allocation after
 * construction, hidden at rest, silenced by `?fx=off` (the host simply
 * never fires). Mint spider accent — never hazard-orange.
 */

export const SPIDER_BEAM_LIFETIME = 0.32;
const SLOT_COUNT = 2;
const PARTICLES_PER_SLOT = 24;
const BEAM_COLOR = 0x5dff9d;
const FLASH_COLOR = 0xeafff2;

interface BeamSlot {
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  headFlash: THREE.Mesh;
  tailFlash: THREE.Mesh;
  flashMat: THREE.MeshBasicMaterial;
  spray: THREE.Points;
  sprayMat: THREE.PointsMaterial;
  sprayPos: Float32Array;
  sprayVel: Float32Array;
  age: number;
  active: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

export class SpiderBeamView {
  public readonly group: THREE.Group = new THREE.Group();
  private readonly slots: BeamSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private nextSlot = 0;
  /** Cumulative plays (QA observability; never reset — evidence). */
  public playCount = 0;
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchMid = new THREE.Vector3();

  constructor() {
    this.group.visible = true;
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    const flashGeo = new THREE.SphereGeometry(1, 10, 8);
    this.geometries.push(beamGeo, flashGeo);
    for (let s = 0; s < SLOT_COUNT; s++) {
      const beamMat = new THREE.MeshBasicMaterial({
        color: BEAM_COLOR,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const flashMat = new THREE.MeshBasicMaterial({
        color: FLASH_COLOR,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprayMat = new THREE.PointsMaterial({
        color: BEAM_COLOR,
        size: 0.16,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      this.materials.push(beamMat, flashMat, sprayMat);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      const headFlash = new THREE.Mesh(flashGeo, flashMat);
      const tailFlash = new THREE.Mesh(flashGeo, flashMat);
      beam.visible = false;
      headFlash.visible = false;
      tailFlash.visible = false;
      // Per-slot spray buffer (positions rewritten on fire, drifted in
      // update — preallocated, never reallocated).
      const sprayPos = new Float32Array(PARTICLES_PER_SLOT * 3);
      const sprayVel = new Float32Array(PARTICLES_PER_SLOT * 3);
      const sprayGeo = new THREE.BufferGeometry();
      sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
      this.geometries.push(sprayGeo);
      const spray = new THREE.Points(sprayGeo, sprayMat);
      spray.visible = false;
      spray.frustumCulled = false;
      this.group.add(beam, headFlash, tailFlash, spray);
      this.slots.push({
        beam, beamMat, headFlash, tailFlash, flashMat,
        spray, sprayMat, sprayPos, sprayVel, age: Infinity, active: false,
      });
    }
  }

  /**
   * Play the energy move between two world anchors (reads, never writes).
   * Zero-length anchors degrade to endpoint flashes (never NaN orientation).
   */
  public fire(from: Readonly<Vec3>, to: Readonly<Vec3>): void {
    const slot = this.slots[this.nextSlot];
    if (slot === undefined) return;
    this.nextSlot = (this.nextSlot + 1) % SLOT_COUNT;
    this.playCount += 1;
    slot.age = 0;
    slot.active = true;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.scratchMid.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    slot.beam.position.copy(this.scratchMid);
    slot.headFlash.position.set(to.x, to.y, to.z);
    slot.tailFlash.position.set(from.x, from.y, from.z);
    slot.headFlash.visible = true;
    slot.tailFlash.visible = true;
    if (length > 0.01) {
      this.scratchDir.set(dx / length, dy / length, dz / length);
      slot.beam.quaternion.setFromUnitVectors(UP, this.scratchDir);
      slot.beam.scale.set(0.5, length, 0.5);
      slot.beam.visible = true;
    } else {
      slot.beam.visible = false;
    }
    // Deterministic spray: particles seeded along the segment with a
    // golden-angle radial spray (no RNG — identical every snap).
    for (let i = 0; i < PARTICLES_PER_SLOT; i++) {
      const t = i / (PARTICLES_PER_SLOT - 1);
      const px = from.x + dx * t;
      const py = from.y + dy * t;
      const pz = from.z + dz * t;
      const a = i * 2.399963;
      const speed = 2.2 + (i % 4) * 0.9;
      slot.sprayPos[i * 3] = px;
      slot.sprayPos[i * 3 + 1] = py;
      slot.sprayPos[i * 3 + 2] = pz;
      slot.sprayVel[i * 3] = Math.cos(a) * speed;
      slot.sprayVel[i * 3 + 1] = Math.sin(a * 1.3) * speed * 0.6;
      slot.sprayVel[i * 3 + 2] = Math.sin(a) * speed;
    }
    const attr = slot.spray.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    slot.spray.visible = true;
  }

  /** Advance with RENDER dt (visual only). Hides slots at expiry. */
  public update(renderDtSeconds: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += renderDtSeconds;
      const t = Math.min(1, slot.age / SPIDER_BEAM_LIFETIME);
      const fade = 1 - t;
      // Beam: bright thick flash collapsing to a thin streak, then gone.
      slot.beamMat.opacity = 0.9 * fade;
      const width = 0.08 + 0.42 * fade;
      slot.beam.scale.x = width;
      slot.beam.scale.z = width;
      // Endpoint flashes: pop then fade across the full lifetime.
      slot.flashMat.opacity = 0.95 * fade;
      const flashScale = 0.25 + t * 0.9;
      slot.headFlash.scale.setScalar(flashScale);
      slot.tailFlash.scale.setScalar(flashScale);
      // Spray: drift outward with light damping, fade out.
      const damp = Math.max(0, 1 - 2.2 * renderDtSeconds);
      for (let i = 0; i < PARTICLES_PER_SLOT; i++) {
        const ix = i * 3;
        const iy = ix + 1;
        const iz = ix + 2;
        const vx = slot.sprayVel[ix] ?? 0;
        const vy = slot.sprayVel[iy] ?? 0;
        const vz = slot.sprayVel[iz] ?? 0;
        slot.sprayVel[ix] = vx * damp;
        slot.sprayVel[iy] = vy * damp;
        slot.sprayVel[iz] = vz * damp;
        slot.sprayPos[ix] = (slot.sprayPos[ix] ?? 0) + vx * renderDtSeconds;
        slot.sprayPos[iy] = (slot.sprayPos[iy] ?? 0) + vy * renderDtSeconds;
        slot.sprayPos[iz] = (slot.sprayPos[iz] ?? 0) + vz * renderDtSeconds;
      }
      const attr = slot.spray.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.needsUpdate = true;
      slot.sprayMat.opacity = Math.max(0, 0.9 * fade);
      if (t >= 1) {
        slot.active = false;
        slot.age = Infinity;
        slot.beam.visible = false;
        slot.headFlash.visible = false;
        slot.tailFlash.visible = false;
        slot.spray.visible = false;
      }
    }
  }

  /** Hide immediately (respawn safety / fx toggle / dispose). Idempotent. */
  public clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.age = Infinity;
      slot.beam.visible = false;
      slot.headFlash.visible = false;
      slot.tailFlash.visible = false;
      slot.spray.visible = false;
    }
  }

  public get activeCount(): number {
    let n = 0;
    for (const slot of this.slots) if (slot.active) n += 1;
    return n;
  }

  public dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.clear();
  }
}
