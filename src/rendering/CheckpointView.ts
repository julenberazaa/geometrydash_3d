import * as THREE from 'three';
import type { GameSimulation } from '../game/GameSimulation';
import type { LoadedLevel } from '../level/levelRuntime';
import type { MaterialLibrary } from './MaterialLibrary';

/**
 * CheckpointView (M9.2): floating gem/crystal gates for practice
 * checkpoints — PURE presentation. Activation lives only in the
 * simulation; this view polls `isCheckpointActivated` for the
 * idle→active state and edge-detects `checkpointEventCount` to fire a
 * pooled burst ring (tinted with the live section accent at the
 * checkpoint z, so the burst inherits biome identity).
 *
 * Resource contract (library ownership): shared gem geometry, two shared
 * crystal materials (idle/active), one shared halo material, one fixed
 * 4-material burst pool — zero per-frame allocation, meshes only.
 *
 * Inactive: translucent crystal, gentle emissive, floating bob + slow
 * rotation. Activated: bright core swap, halo brightens, scale pop +
 * expanding burst ring. The CHECKPOINT SAVED read is instant.
 */

const BURST_LIFETIME = 0.5;

interface CrystalEntry {
  id: string;
  group: THREE.Group;
  core: THREE.Mesh;
  halo: THREE.Mesh;
  baseY: number;
  /** Activation pop envelope (0 idle, 1 just fired — decays to 0). */
  pop: number;
  phase: number;
}

interface PooledBurst {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  active: boolean;
}

export class CheckpointView {
  public readonly group: THREE.Group = new THREE.Group();

  private readonly crystals: CrystalEntry[] = [];
  private readonly burstPool: PooledBurst[] = [];
  /** Last seen simulation checkpoint counter (VFX edge detect). */
  private lastEventCount = 0;
  /** Presentation clock for idle float/rotation (render-side only). */
  private clock = 0;
  private readonly idleMaterial: THREE.Material;
  private readonly activeMaterial: THREE.Material;
  /** Live section accent at a world z (RendererHost timeline read, cold). */
  private readonly accentAtZ: (z: number) => number;

  constructor(
    level: LoadedLevel,
    private readonly simulation: GameSimulation,
    library: MaterialLibrary,
    accentAtZ: (z: number) => number,
  ) {
    this.accentAtZ = accentAtZ;
    this.idleMaterial = library.checkpointIdle;
    this.activeMaterial = library.checkpointActive;
    const gem = library.checkpointGem;
    const haloGeo = library.orbHalo;
    const haloMat = library.checkpointHalo;
    const plinthGeo = library.unitBox;
    const plinthMat = library.interactionDim;

    level.checkpoints.forEach((cp, index) => {
      const group = new THREE.Group();
      // The gem floats above the route line (never inside the hitbox lane:
      // the trigger volume is what matters, the visual hovers readable).
      const baseY = cp.center.y + 1.6;
      const core = new THREE.Mesh(gem, this.idleMaterial);
      core.position.set(cp.center.x, baseY, cp.center.z);
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.scale.setScalar(1.15);
      halo.position.copy(core.position);
      // Small ground marker so the gate reads even at a glance.
      const plinth = new THREE.Mesh(plinthGeo, plinthMat);
      plinth.scale.set(0.5, 0.08, 0.5);
      plinth.position.set(cp.center.x, cp.center.y - cp.halfExtents.y - 0.1, cp.center.z);
      group.add(core, halo, plinth);
      this.group.add(group);
      this.crystals.push({ id: cp.id, group, core, halo, baseY, pop: 0, phase: index * 0.9 });
    });

    for (const material of library.checkpointBurstMaterials()) {
      const mesh = new THREE.Mesh(haloGeo, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.burstPool.push({ mesh, material, age: 0, active: false });
    }
    this.lastEventCount = simulation.checkpointEventCount;
  }

  /** Per rendered frame: idle motion, state swaps, burst envelopes. */
  public update(renderDt: number): void {
    this.clock += renderDt;
    const sim = this.simulation;

    for (const crystal of this.crystals) {
      const activated = sim.isCheckpointActivated(crystal.id);
      const target = activated ? this.activeMaterial : this.idleMaterial;
      if (crystal.core.material !== target) crystal.core.material = target;
      // Idle: gentle bob + slow spin. Activated: faster spin, brighter
      // halo (material is shared — opacity stays constant; the pop
      // envelope carries the flash via scale).
      const speed = activated ? 2.4 : 0.9;
      crystal.core.rotation.y += renderDt * speed;
      crystal.core.position.y =
        crystal.baseY + Math.sin(this.clock * 1.7 + crystal.phase) * 0.14;
      crystal.halo.position.y = crystal.core.position.y;
      crystal.halo.rotation.z -= renderDt * (activated ? 1.8 : 0.6);
      if (crystal.pop > 0) {
        crystal.pop = Math.max(0, crystal.pop - renderDt / BURST_LIFETIME);
        const s = 1 + crystal.pop * 0.9;
        crystal.core.scale.setScalar(s);
      } else {
        crystal.core.scale.setScalar(activated ? 1.12 : 1);
      }
    }

    // Activation edge: burst ring + crystal pop at the saved gate.
    const count = sim.checkpointEventCount;
    if (count !== this.lastEventCount) {
      this.lastEventCount = count;
      this.playBurst();
    }
    this.updateBursts(renderDt);
  }

  private playBurst(): void {
    const sim = this.simulation;
    const id = sim.lastCheckpointId;
    if (id === null) return;
    const crystal = this.crystals.find((c) => c.id === id);
    if (crystal === undefined) return;
    crystal.pop = 1;
    const burst = this.burstPool.find((b) => !b.active);
    if (burst === undefined) return;
    burst.active = true;
    burst.age = 0;
    burst.mesh.visible = true;
    burst.mesh.position.copy(crystal.core.position);
    burst.material.color.setHex(this.accentAtZ(crystal.core.position.z));
    burst.material.opacity = 0.9;
    burst.mesh.scale.setScalar(0.6);
  }

  private updateBursts(renderDt: number): void {
    for (const burst of this.burstPool) {
      if (!burst.active) continue;
      burst.age += renderDt;
      const t = burst.age / BURST_LIFETIME;
      if (t >= 1) {
        burst.active = false;
        burst.mesh.visible = false;
        continue;
      }
      burst.mesh.scale.setScalar(0.6 + t * 3.2);
      burst.material.opacity = 0.9 * (1 - t);
    }
  }

  /** Live burst count (QA leak-guard observability). */
  public get activeBurstCount(): number {
    return this.burstPool.filter((b) => b.active).length;
  }

  public dispose(): void {
    // Meshes only — geometries/materials belong to the MaterialLibrary.
    this.group.clear();
    this.crystals.length = 0;
    this.burstPool.length = 0;
  }
}
