import * as THREE from 'three';
import type { Vec3 } from '../core/math';

/**
 * SpiderBeamView (M9.6): the spider surface-swap transition language.
 *
 * A snap is an instant sanctioned displacement (up to 14 u), not a cut —
 * but with only the shared gravity pulse + camera glide it read as a
 * broken teleport. This view fires a fast vertical energy move on every
 * snap: a bright core, soft halo, jagged strands and fast energy packet
 * connecting the exact travel anchors, with a short spray and blocky
 * endpoint flashes. The full effect decays in ~0.32 s. The
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
const PARTICLES_PER_SLOT = 36;
const ARC_SEGMENTS = 8;
const ARC_STRANDS = 2;
const PACKET_TRAVEL = 0.09;
const BEAM_COLOR = 0x5dff9d;
const FLASH_COLOR = 0xeafff2;

interface BeamSlot {
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  arcs: THREE.InstancedMesh;
  arcMat: THREE.MeshBasicMaterial;
  packet: THREE.Mesh;
  packetMat: THREE.MeshBasicMaterial;
  from: THREE.Vector3;
  to: THREE.Vector3;
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
  private readonly radialA = new THREE.Vector3();
  private readonly radialB = new THREE.Vector3();
  private readonly arcStart = new THREE.Vector3();
  private readonly arcEnd = new THREE.Vector3();
  private readonly arcDelta = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchMatrix = new THREE.Matrix4();

  constructor() {
    this.group.visible = true;
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    const flashGeo = new THREE.BoxGeometry(1, 1, 1);
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
      const haloMat = beamMat.clone();
      const arcMat = flashMat.clone();
      const packetMat = flashMat.clone();
      this.materials.push(beamMat, haloMat, arcMat, packetMat, flashMat, sprayMat);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      const halo = new THREE.Mesh(beamGeo, haloMat);
      const arcs = new THREE.InstancedMesh(beamGeo, arcMat, ARC_SEGMENTS * ARC_STRANDS);
      arcs.count = 0;
      arcs.frustumCulled = false;
      const packet = new THREE.Mesh(flashGeo, packetMat);
      const headFlash = new THREE.Mesh(flashGeo, flashMat);
      const tailFlash = new THREE.Mesh(flashGeo, flashMat);
      beam.visible = false;
      halo.visible = false;
      arcs.visible = false;
      packet.visible = false;
      headFlash.visible = false;
      tailFlash.visible = false;
      // Per-slot spray buffer (positions rewritten on fire, drifted in
      // update — preallocated, never reallocated).
      const sprayPos = new Float32Array(PARTICLES_PER_SLOT * 3);
      const sprayVel = new Float32Array(PARTICLES_PER_SLOT * 3);
      const sprayGeo = new THREE.BufferGeometry();
      sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3).setUsage(THREE.DynamicDrawUsage));
      this.geometries.push(sprayGeo);
      const spray = new THREE.Points(sprayGeo, sprayMat);
      spray.visible = false;
      spray.frustumCulled = false;
      this.group.add(halo, beam, arcs, packet, headFlash, tailFlash, spray);
      this.slots.push({
        beam, beamMat, halo, haloMat, arcs, arcMat, packet, packetMat,
        from: new THREE.Vector3(), to: new THREE.Vector3(),
        headFlash, tailFlash, flashMat, spray, sprayMat, sprayPos, sprayVel,
        age: Infinity, active: false,
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
    slot.from.set(from.x, from.y, from.z);
    slot.to.set(to.x, to.y, to.z);
    this.scratchMid.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    slot.beam.position.copy(this.scratchMid);
    slot.halo.position.copy(this.scratchMid);
    slot.packet.position.copy(slot.from);
    slot.packet.visible = length > 0.01;
    slot.headFlash.position.set(to.x, to.y, to.z);
    slot.tailFlash.position.set(from.x, from.y, from.z);
    slot.headFlash.visible = true;
    slot.tailFlash.visible = true;
    if (length > 0.01) {
      this.scratchDir.set(dx / length, dy / length, dz / length);
      slot.beam.quaternion.setFromUnitVectors(UP, this.scratchDir);
      slot.halo.quaternion.copy(slot.beam.quaternion);
      slot.beam.scale.set(0.13, length, 0.13);
      slot.halo.scale.set(0.46, length, 0.46);
      slot.beam.visible = true;
      slot.halo.visible = true;
      this.writeArcs(slot, length);
    } else {
      slot.beam.visible = false;
      slot.halo.visible = false;
      slot.arcs.visible = false;
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

  /** Two fixed jagged strands. Endpoints are exact; only interior knots wander. */
  private writeArcs(slot: BeamSlot, length: number): void {
    const nearVertical = Math.abs(this.scratchDir.y) >= 0.9;
    this.radialA.set(nearVertical ? 1 : 0, nearVertical ? 0 : 1, 0);
    this.radialA.cross(this.scratchDir).normalize();
    this.radialB.crossVectors(this.scratchDir, this.radialA).normalize();
    let instance = 0;
    for (let strand = 0; strand < ARC_STRANDS; strand++) {
      this.arcStart.copy(slot.from);
      for (let segment = 0; segment < ARC_SEGMENTS; segment++) {
        const t = (segment + 1) / ARC_SEGMENTS;
        const envelope = segment === ARC_SEGMENTS - 1 ? 0 : Math.sin(Math.PI * t);
        const zig = ((segment + strand) % 2 === 0 ? 1 : -1) * 0.29 * envelope;
        const side = Math.sin((segment + 1) * 2.8 + strand * 1.9) * 0.17 * envelope;
        this.arcEnd.copy(slot.from).addScaledVector(this.scratchDir, length * t)
          .addScaledVector(this.radialA, zig)
          .addScaledVector(this.radialB, side);
        this.arcDelta.subVectors(this.arcEnd, this.arcStart);
        const segmentLength = this.arcDelta.length();
        this.scratchQuat.setFromUnitVectors(UP, this.arcDelta.multiplyScalar(1 / segmentLength));
        this.scratchMid.copy(this.arcStart).add(this.arcEnd).multiplyScalar(0.5);
        this.scratchScale.set(0.055, segmentLength, 0.055);
        this.scratchMatrix.compose(this.scratchMid, this.scratchQuat, this.scratchScale);
        slot.arcs.setMatrixAt(instance++, this.scratchMatrix);
        this.arcStart.copy(this.arcEnd);
      }
    }
    slot.arcs.count = instance;
    slot.arcs.instanceMatrix.needsUpdate = true;
    slot.arcs.visible = true;
  }

  /** Advance with RENDER dt (visual only). Hides slots at expiry. */
  public update(renderDtSeconds: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += renderDtSeconds;
      const t = Math.min(1, slot.age / SPIDER_BEAM_LIFETIME);
      const fade = 1 - t;
      // The narrow core outlives the jagged strike; the halo stays subdued.
      slot.beamMat.opacity = 0.9 * fade;
      slot.haloMat.opacity = 0.24 * fade;
      slot.arcMat.opacity = 0.9 * Math.max(0, 1 - t * 1.8);
      const width = 0.055 + 0.075 * fade;
      slot.beam.scale.x = width;
      slot.beam.scale.z = width;
      const haloWidth = 0.15 + 0.31 * fade;
      slot.halo.scale.x = haloWidth;
      slot.halo.scale.z = haloWidth;
      const travel = Math.min(1, slot.age / PACKET_TRAVEL);
      slot.packet.position.lerpVectors(slot.from, slot.to, travel);
      slot.packet.scale.setScalar(0.15 + 0.23 * (1 - travel));
      slot.packetMat.opacity = 0.95 * (1 - travel);
      slot.packet.visible = travel < 1 && slot.beam.visible;
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
        slot.halo.visible = false;
        slot.arcs.visible = false;
        slot.packet.visible = false;
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
      slot.halo.visible = false;
      slot.arcs.visible = false;
      slot.packet.visible = false;
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
