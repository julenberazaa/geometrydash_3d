import * as THREE from 'three';
import type { GameSimulation } from '../game/GameSimulation';
import type { LoadedLevel } from '../level/levelRuntime';
import type { InteractionOrbDef } from '../level/levelDefinition';
import { PALETTE, speedTierColor } from '../visuals/palette';

/**
 * InteractionView (M4): procedural visuals for pads, orbs and speed portals,
 * built from level data — PURE presentation. Activation lives only in the
 * simulation; this view reads `isInteractionUsed` for the dim-after-use
 * state and edge-detects `interactionEventCount` to fire a restrained pooled
 * activation ring. Shared geometries; shared live materials; per-ring VFX
 * materials are created ONCE (pooled, no per-frame allocation).
 */

/** Pooled activation rings: lifetime, max simultaneous effects. */
const RING_LIFETIME = 0.32;
const RING_POOL_SIZE = 8;

interface PooledRing {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  active: boolean;
}

/** Trackable interactive visual for used-state dimming + idle motion. */
interface DimmableEntry {
  id: string;
  meshes: THREE.Mesh[];
  liveMaterial: THREE.MeshBasicMaterial;
  /** Idle-bob base Y (orbs only; pads/portals do not bob). */
  baseY: number | null;
}

export class InteractionView {
  public readonly group: THREE.Group = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];

  private readonly dimmables: DimmableEntry[] = [];
  private readonly dimMaterial: THREE.MeshBasicMaterial;
  private readonly ringPool: PooledRing[] = [];
  /** Last seen simulation interaction counter (VFX edge detect). */
  private lastEventCount = 0;
  /** Presentation clock for idle orb motion (render-side only). */
  private clock = 0;

  constructor(
    level: LoadedLevel,
    private readonly simulation: GameSimulation,
  ) {
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const sphere = new THREE.SphereGeometry(0.42, 18, 14);
    const halo = new THREE.TorusGeometry(0.62, 0.045, 8, 36);
    const chevron = new THREE.ConeGeometry(0.26, 0.55, 4);
    this.disposables.push(unitBox, sphere, halo, chevron);

    const padMat = new THREE.MeshBasicMaterial({ color: PALETTE.padJump });
    const orbJumpMat = new THREE.MeshBasicMaterial({ color: PALETTE.orbJump });
    const orbGravityMat = new THREE.MeshBasicMaterial({ color: PALETTE.orbGravity });
    this.dimMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.interactionDim });
    this.disposables.push(padMat, orbJumpMat, orbGravityMat, this.dimMaterial);

    this.buildPads(level, unitBox, padMat);
    this.buildOrbs(level, sphere, halo, orbJumpMat, orbGravityMat);
    this.buildSpeedPortals(level, unitBox, chevron);
    this.buildRingPool(halo);
  }

  /** Jump pads: a glowing slab filling the trigger volume + a thin base
   *  frame. Floor pads sit on top faces; ceiling pads mirror downward (the
   *  trigger data encodes the mount, the visual just follows it). */
  private buildPads(
    level: LoadedLevel,
    unitBox: THREE.BoxGeometry,
    padMat: THREE.MeshBasicMaterial,
  ): void {
    for (const pad of level.jumpPads) {
      const slab = new THREE.Mesh(unitBox, padMat);
      slab.scale.set(
        pad.halfExtents.x * 2 - 0.1,
        pad.halfExtents.y * 2 - 0.1,
        pad.halfExtents.z * 2 - 0.1,
      );
      slab.position.set(pad.center.x, pad.center.y, pad.center.z);
      this.group.add(slab);

      const frame = new THREE.Mesh(unitBox, this.dimMaterial);
      frame.scale.set(pad.halfExtents.x * 2 + 0.08, 0.05, pad.halfExtents.z * 2 + 0.08);
      frame.position.set(
        pad.center.x,
        pad.surface === 'ceiling'
          ? pad.center.y - pad.halfExtents.y
          : pad.center.y - pad.halfExtents.y + 0.02,
        pad.center.z,
      );
      this.group.add(frame);
      this.dimmables.push({ id: pad.id, meshes: [slab], liveMaterial: padMat, baseY: null });
    }
  }

  /** Orbs: sphere core + facing halo ring; gentle idle bob (presentation). */
  private buildOrbs(
    level: LoadedLevel,
    sphere: THREE.SphereGeometry,
    halo: THREE.TorusGeometry,
    jumpMat: THREE.MeshBasicMaterial,
    gravityMat: THREE.MeshBasicMaterial,
  ): void {
    const build = (
      defs: readonly InteractionOrbDef[],
      material: THREE.MeshBasicMaterial,
    ): void => {
      for (const orb of defs) {
        const core = new THREE.Mesh(sphere, material);
        core.position.set(orb.center.x, orb.center.y, orb.center.z);
        const ring = new THREE.Mesh(halo, material);
        ring.position.copy(core.position);
        this.group.add(core, ring);
        this.dimmables.push({
          id: orb.id,
          meshes: [core, ring],
          liveMaterial: material,
          baseY: orb.center.y,
        });
      }
    };
    build(level.jumpOrbs, jumpMat);
    build(level.gravityOrbs, gravityMat);
  }

  /** Speed portals: a tier-colored gateway + one forward chevron per tier
   *  step — tier reads from color AND chevron count, never tiny text. */
  private buildSpeedPortals(
    level: LoadedLevel,
    unitBox: THREE.BoxGeometry,
    chevron: THREE.ConeGeometry,
  ): void {
    for (const portal of level.speedPortals) {
      // Per-portal material (rare objects, created once, shared by its parts).
      const mat = new THREE.MeshBasicMaterial({ color: speedTierColor(portal.multiplier) });
      this.disposables.push(mat);

      const lateralHalf = 3.2;
      const ringHalf = 1.4;
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(unitBox, mat);
        post.scale.set(0.12, ringHalf * 2, 0.12);
        post.position.set(sx * lateralHalf, 1.4, portal.z);
        this.group.add(post);
      }
      for (const sy of [1.4 - ringHalf, 1.4 + ringHalf]) {
        const bar = new THREE.Mesh(unitBox, mat);
        bar.scale.set(lateralHalf * 2, 0.12, 0.12);
        bar.position.set(0, sy, portal.z);
        this.group.add(bar);
      }
      // Chevron count = rounded tier (min 1), stacked inside the gateway,
      // each pointing +Z (the direction of travel).
      const chevrons = Math.max(1, Math.round(portal.multiplier));
      for (let i = 0; i < chevrons; i++) {
        const c = new THREE.Mesh(chevron, mat);
        c.rotation.x = Math.PI / 2; // cone axis -> +Z
        c.position.set(0, 0.55 + i * 0.85, portal.z);
        this.group.add(c);
      }
    }
  }

  /** Pooled activation rings (fixed allocation at construction). */
  private buildRingPool(halo: THREE.TorusGeometry): void {
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(halo, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.ringPool.push({ mesh, material, age: 0, active: false });
      this.disposables.push(material);
    }
  }

  /** Per rendered frame: idle motion, used-state dimming, VFX rings. */
  public update(renderDt: number): void {
    this.clock += renderDt;

    // Gentle idle bob while unused (presentation only; used orbs rest dim).
    const bob = Math.sin(this.clock * 2.2) * 0.05;
    for (const entry of this.dimmables) {
      if (entry.baseY === null) continue;
      const core = entry.meshes[0];
      if (core === undefined) continue;
      const used = this.simulation.isInteractionUsed(entry.id);
      const y = used ? entry.baseY : entry.baseY + bob;
      core.position.y = y;
      const haloMesh = entry.meshes[1];
      if (haloMesh !== undefined) haloMesh.position.y = y;
      const target = used ? this.dimMaterial : entry.liveMaterial;
      for (const mesh of entry.meshes) {
        if (mesh.material !== target) mesh.material = target;
      }
    }
    // Pads: used-state material swap only (no bob).
    for (const entry of this.dimmables) {
      if (entry.baseY !== null) continue;
      const target = this.simulation.isInteractionUsed(entry.id)
        ? this.dimMaterial
        : entry.liveMaterial;
      for (const mesh of entry.meshes) {
        if (mesh.material !== target) mesh.material = target;
      }
    }

    // VFX: edge-detect the simulation's interaction counter (never drives it).
    const count = this.simulation.interactionEventCount;
    if (count !== this.lastEventCount) {
      const events = count - this.lastEventCount;
      this.lastEventCount = count;
      for (let i = 0; i < Math.min(events, RING_POOL_SIZE); i++) {
        this.playRing();
      }
    }
    this.updateRings(renderDt);
  }

  private playRing(): void {
    const sim = this.simulation;
    const ring = this.ringPool.find((r) => !r.active);
    if (ring === undefined) return; // pool exhausted: drop silently (restrained)
    ring.active = true;
    ring.age = 0;
    ring.mesh.visible = true;
    ring.mesh.position.set(sim.lastInteraction.x, sim.lastInteraction.y, sim.lastInteraction.z);
    ring.mesh.rotation.z = 0;
    const color =
      sim.lastInteraction.kind === 'gravityOrb'
        ? PALETTE.orbGravity
        : sim.lastInteraction.kind === 'speedPortal'
          ? 0xffffff
          : PALETTE.orbJump;
    ring.material.color.setHex(color);
    ring.material.opacity = 0.85;
    ring.mesh.scale.setScalar(0.5);
  }

  private updateRings(renderDt: number): void {
    for (const ring of this.ringPool) {
      if (!ring.active) continue;
      ring.age += renderDt;
      const t = ring.age / RING_LIFETIME;
      if (t >= 1) {
        ring.active = false;
        ring.mesh.visible = false;
        continue;
      }
      ring.mesh.scale.setScalar(0.5 + t * 1.7);
      ring.material.opacity = 0.85 * (1 - t);
    }
  }

  /** Live ring count (QA leak-guard observability). */
  public get activeRingCount(): number {
    return this.ringPool.filter((r) => r.active).length;
  }

  public dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
