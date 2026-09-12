import * as THREE from 'three';
import type { GameSimulation } from '../game/GameSimulation';
import type { LoadedLevel } from '../level/levelRuntime';
import type { InteractionOrbDef } from '../level/levelDefinition';
import type { MaterialLibrary } from './MaterialLibrary';
import type { ProductionTheme } from '../visuals/productionTheme';

/**
 * InteractionView (M4): procedural visuals for pads, orbs and speed portals,
 * built from level data — PURE presentation. Activation lives only in the
 * simulation; this view reads `isInteractionUsed` for the dim-after-use
 * state and edge-detects `interactionEventCount` to fire a restrained pooled
 * activation ring. Library geometries/materials (M6A ownership); pooled ring
 * materials are owned by the library (fixed set, no per-frame allocation).
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
  liveMaterial: THREE.Material;
  /** Idle-bob base Y (orbs only; pads/portals do not bob). */
  baseY: number | null;
}

export class InteractionView {
  public readonly group: THREE.Group = new THREE.Group();

  private readonly dimmables: DimmableEntry[] = [];
  private readonly dimMaterial: THREE.MeshBasicMaterial;
  private readonly ringPool: PooledRing[] = [];
  /** Last seen simulation interaction counter (VFX edge detect). */
  private lastEventCount = 0;
  /** Presentation clock for idle orb motion (render-side only). */
  private clock = 0;
  /** Semantic VFX colors (theme-owned; material color is set per event). */
  private readonly theme: ProductionTheme;
  private readonly library: MaterialLibrary;

  /** Shared per-tier library material (cached; never per-portal). */
  private speedTierMaterial(multiplier: number): THREE.Material {
    return this.library.speedTier(multiplier);
  }

  /** Library-owned fixed ring-material set (reused, never allocated). */
  private ringPoolMaterials(): readonly THREE.MeshBasicMaterial[] {
    return this.library.ringMaterials();
  }

  constructor(
    level: LoadedLevel,
    private readonly simulation: GameSimulation,
    library: MaterialLibrary,
    theme: ProductionTheme,
  ) {
    this.library = library;
    this.theme = theme;
    const unitBox = library.unitBox;
    const sphere = library.orbSphere;
    const halo = library.orbHalo;
    const chevron = library.chevron;

    const padMat = library.padJump;
    const orbJumpMat = library.orbJump;
    const orbGravityMat = library.orbGravity;
    this.dimMaterial = library.interactionDim;

    this.buildPads(level, unitBox, padMat);
    this.buildOrbs(level, sphere, halo, orbJumpMat, orbGravityMat);
    this.buildSpeedPortals(level, unitBox, chevron);
    this.buildRingPool(halo);
  }

  /**
   * Jump pads: a glowing slab filling the trigger volume + a thin base
   * frame. Floor pads sit on top faces; ceiling pads mirror downward (the
   * trigger data encodes the mount, the visual just follows it). `liveMat`
   * is the library accent material for pads.
   */
  private buildPads(
    level: LoadedLevel,
    unitBox: THREE.BoxGeometry,
    padMat: THREE.Material,
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
    jumpMat: THREE.Material,
    gravityMat: THREE.Material,
  ): void {
    const build = (
      defs: readonly InteractionOrbDef[],
      material: THREE.Material,
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
   *  step — tier reads from color AND chevron count, never tiny text.
   *  Tier materials are cached in the library (rare, created once).
   *  M7.3: pulled tighter to the corridor (was 3.2/1.4) — portals mark the
   *  route line instead of towering over it. */
  private buildSpeedPortals(
    level: LoadedLevel,
    unitBox: THREE.BoxGeometry,
    chevron: THREE.ConeGeometry,
  ): void {
    for (const portal of level.speedPortals) {
      // Shared per-tier library material (not per-portal).
      const mat = this.speedTierMaterial(portal.multiplier);

      const lateralHalf = 2.9;
      const ringHalf = 1.2;
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

  /** Pooled activation rings (library-owned fixed material set). */
  private buildRingPool(halo: THREE.TorusGeometry): void {
    for (const material of this.ringPoolMaterials()) {
      const mesh = new THREE.Mesh(halo, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.ringPool.push({ mesh, material, age: 0, active: false });
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
        ? this.theme.orbGravity
        : sim.lastInteraction.kind === 'speedPortal'
          ? 0xffffff
          : this.theme.orbJump;
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
    // Meshes only — geometries/materials belong to the MaterialLibrary.
    this.group.clear();
  }
}
