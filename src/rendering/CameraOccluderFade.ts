import type * as THREE from 'three';

/**
 * CameraOccluderFade (M8.6 Bug B, §14) — FINAL safety net, presentation-only.
 *
 * When the pull-in resolver reports `needsOccluderFade` (no usable camera
 * position exists without destroying framing), the actual blocking visual
 * mesh is temporarily faded just enough to reveal the player.
 *
 * Hard requirements, all enforced here:
 * - collision/simulation unchanged (meshes only, never colliders);
 * - only the reported blocking solid body fades — never hazards, lava,
 *   portals, trims, rails, or the environment at large;
 * - smooth fade in/out (opacity envelope on render dt);
 * - no material leaks: at most MAX_FADED concurrent clones, each cloned
 *   ONCE on fade start from its shared library material and disposed on
 *   release; the shared material is reassigned on restore;
 * - bounded work per frame (slot scan only; no scene traversal);
 * - full opacity restored as soon as the mesh stops occluding.
 *
 * Zero per-frame allocation (fixed slot array, in-place opacity writes).
 */
export const MAX_FADED_OCCLUDERS = 4;
/** Revealed-player opacity floor for a faded occluder (still reads solid). */
export const FADED_OCCLUDER_OPACITY = 0.25;
/** Fade envelope rate (1/s) — in and out. */
export const OCCLUDER_FADE_RATE = 6;

interface FadeSlot {
  mesh: THREE.Mesh | null;
  shared: THREE.Material | THREE.Material[] | null;
  clone: THREE.Material | null;
  /** Current envelope 1 (opaque) → FADED_OCCLUDER_OPACITY (faded). */
  level: number;
  /** True while this slot's mesh is still reported occluding. */
  active: boolean;
}

export class CameraOccluderFade {
  private readonly slots: FadeSlot[] = [];

  constructor() {
    for (let i = 0; i < MAX_FADED_OCCLUDERS; i++) {
      this.slots.push({ mesh: null, shared: null, clone: null, level: 1, active: false });
    }
  }

  /**
   * Per rendered frame. `occluder` is the CURRENT blocking mesh (or null
   * when the sight line is clear): the matching slot fades in, all other
   * slots release toward opaque. Meshes outside the registered solid/platform
   * body sets must never reach this call (the host maps ids first).
   */
  public update(occluder: THREE.Mesh | null, renderDtSeconds: number): void {
    const k = Math.min(1, OCCLUDER_FADE_RATE * renderDtSeconds);
    let claimed = false;
    for (const slot of this.slots) {
      if (slot.mesh !== null && (occluder === null || slot.mesh !== occluder)) {
        slot.active = false;
      }
      if (occluder !== null && slot.mesh === occluder) {
        slot.active = true;
        claimed = true;
      }
    }
    if (occluder !== null && !claimed) {
      const slot = this.freestSlot();
      if (slot !== null) this.claim(slot, occluder);
    }
    for (const slot of this.slots) {
      if (slot.mesh === null || slot.clone === null) continue;
      const target = slot.active ? FADED_OCCLUDER_OPACITY : 1;
      slot.level += (target - slot.level) * k;
      if (Math.abs(slot.level - target) < 0.01) slot.level = target;
      (slot.clone as THREE.MeshStandardMaterial).opacity = slot.level;
      if (!slot.active && slot.level >= 1) this.release(slot);
    }
  }

  /** Forced release (level teardown): restores every mesh immediately. */
  public releaseAll(): void {
    for (const slot of this.slots) {
      if (slot.mesh !== null) {
        slot.level = 1;
        this.release(slot);
      }
    }
  }

  /** Number of meshes currently faded or fading (QA bound observability). */
  public get fadedCount(): number {
    let n = 0;
    for (const slot of this.slots) {
      if (slot.mesh !== null) n++;
    }
    return n;
  }

  private freestSlot(): FadeSlot | null {
    // Prefer a fully released slot; otherwise steal the most-opaque one
    // (closest to invisible work — never pops a nearly-faded mesh).
    let best: FadeSlot | null = null;
    for (const slot of this.slots) {
      if (slot.mesh === null) return slot;
      if (best === null || slot.level > best.level) best = slot;
    }
    return best;
  }

  private claim(slot: FadeSlot, mesh: THREE.Mesh): void {
    if (slot.mesh !== null) this.release(slot);
    const shared = mesh.material;
    // Single-material body meshes only (the registered sets always are):
    // multi-material meshes are never faded rather than half-faded.
    if (Array.isArray(shared)) return;
    const clone = shared.clone();
    // Three.js clone/copy omits these callbacks. Preserve authored biome
    // shaders when a body fades, rather than briefly reverting to a plain
    // material and losing its world-space surface identity.
    // Copy the hooks, preserving Three.js's invocation with clone as `this`.
    // Binding to shared would change semantics for this-dependent shaders.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional framework callback copy; never invoked unbound
    clone.onBeforeCompile = shared.onBeforeCompile;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- renderer invokes the copied method on the clone
    clone.customProgramCacheKey = shared.customProgramCacheKey;
    clone.transparent = true;
    clone.depthWrite = false;
    clone.opacity = slot.level = 1;
    slot.mesh = mesh;
    slot.shared = shared;
    slot.clone = clone;
    slot.active = true;
    mesh.material = clone;
  }

  private release(slot: FadeSlot): void {
    if (slot.mesh !== null && slot.shared !== null && !Array.isArray(slot.shared)) {
      slot.mesh.material = slot.shared;
    }
    if (slot.clone !== null) {
      slot.clone.dispose();
      slot.clone = null;
    }
    slot.mesh = null;
    slot.shared = null;
    slot.level = 1;
    slot.active = false;
  }
}
