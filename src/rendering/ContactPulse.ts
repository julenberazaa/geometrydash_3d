import type * as THREE from 'three';

/**
 * ContactPulse (M9.3) — renderer-owned island landing response,
 * presentation-only.
 *
 * When the player lands on a playable support, THAT support briefly
 * surges (accent emissive + local glow) so the frame reads PLAYER ↔
 * WORLD CONTACT. Landing detection lives in `RendererHost` (grounded
 * edge + support id); this class owns only the pulse slots.
 *
 * Hard requirements, mirroring the `CameraOccluderFade` no-leak
 * precedent:
 * - only the touched support body mesh pulses — never the biome, never
 *   hazards/portals/trims (the host maps ids to registered body meshes
 *   first; multi-material meshes are never pulsed);
 * - no material leaks: at most MAX_CONTACT_PULSES concurrent clones,
 *   each cloned ONCE on landing from its shared library material and
 *   disposed on expiry; the shared material is reassigned on restore;
 * - shared materials are never mutated (a pulse writes the clone only,
 *   so sibling islands sharing the material stay dark);
 * - bounded work per frame (slot scan only, zero allocation);
 * - render-dt evolution (pause freezes via dt 0, like every other
 *   presentation clock); silenced by `?fx=off` through `setEnabled`
 *   (same flag as all other contact language).
 *
 * Moving islands are supported structurally: the clone rides the
 * platform body mesh, so the pulse follows the authoritative pose with
 * zero gameplay coupling.
 */
export const MAX_CONTACT_PULSES = 4;
/** Pulse lifetime in seconds (M9.3 §22: short and punchy, 0.15–0.40). */
export const CONTACT_PULSE_LIFE = 0.3;
/** Clone emissive peak at the landing instant (reads clearly, no wash). */
export const CONTACT_PULSE_PEAK = 2.5;

interface PulseSlot {
  mesh: THREE.Mesh | null;
  id: string | null;
  shared: THREE.Material | THREE.Material[] | null;
  clone: THREE.MeshStandardMaterial | null;
  /** Seconds since the landing that claimed this slot. */
  age: number;
}

export class ContactPulse {
  private readonly slots: PulseSlot[] = [];
  private enabled = true;
  private claimCount = 0;
  private lastId: string | null = null;

  constructor() {
    for (let i = 0; i < MAX_CONTACT_PULSES; i++) {
      this.slots.push({ mesh: null, id: null, shared: null, clone: null, age: 0 });
    }
  }

  /** Landing on a registered body mesh: (re)claim its pulse. */
  public noteLanding(mesh: THREE.Mesh, id: string, accentHex: number): void {
    if (!this.enabled) return;
    let slot: PulseSlot | null = null;
    for (const s of this.slots) {
      if (s.mesh === mesh) {
        slot = s;
        break;
      }
    }
    if (slot === null) {
      slot = this.oldestSlot();
      if (slot === null) return;
      this.claim(slot, mesh, id);
    } else {
      slot.id = id;
      slot.age = 0;
    }
    if (slot.clone !== null) {
      slot.clone.emissive.setHex(accentHex);
      slot.clone.emissiveIntensity = CONTACT_PULSE_PEAK;
    }
    this.claimCount += 1;
    this.lastId = id;
  }

  /** Per rendered frame: advance envelopes, expire spent pulses. */
  public update(renderDtSeconds: number): void {
    for (const slot of this.slots) {
      if (slot.mesh === null || slot.clone === null) continue;
      slot.age += renderDtSeconds;
      const k = 1 - slot.age / CONTACT_PULSE_LIFE;
      if (k <= 0) {
        this.release(slot);
        continue;
      }
      slot.clone.emissiveIntensity = CONTACT_PULSE_PEAK * k;
    }
  }

  /** Silence new pulses (`?fx=off` parity with all contact language). */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Forced release (level teardown): restores every mesh immediately. */
  public releaseAll(): void {
    for (const slot of this.slots) {
      if (slot.mesh !== null) this.release(slot);
    }
  }

  /** Cumulative landing claims (QA probe). */
  public get pulseCount(): number {
    return this.claimCount;
  }

  /** Support id of the most recent landing (QA probe). */
  public get lastPulseId(): string | null {
    return this.lastId;
  }

  /** Strongest live envelope 0..1, 0 when no pulse is active (QA probe). */
  public get pulseIntensity(): number {
    let peak = 0;
    for (const slot of this.slots) {
      if (slot.mesh === null) continue;
      const k = 1 - slot.age / CONTACT_PULSE_LIFE;
      if (k > peak) peak = k;
    }
    return peak > 0 ? Math.min(1, peak) : 0;
  }

  /** Meshes currently pulsed (QA bound observability). */
  public get activeCount(): number {
    let n = 0;
    for (const slot of this.slots) {
      if (slot.mesh !== null) n++;
    }
    return n;
  }

  private oldestSlot(): PulseSlot | null {
    let best: PulseSlot | null = null;
    for (const slot of this.slots) {
      if (slot.mesh === null) return slot;
      if (best === null || slot.age > best.age) best = slot;
    }
    return best;
  }

  private claim(slot: PulseSlot, mesh: THREE.Mesh, id: string): void {
    if (slot.mesh !== null) this.release(slot);
    const shared = mesh.material;
    // Single-material body meshes only (the registered sets always are):
    // multi-material meshes are never pulsed rather than half-pulsed.
    if (Array.isArray(shared)) return;
    const clone = shared.clone() as THREE.MeshStandardMaterial;
    slot.mesh = mesh;
    slot.id = id;
    slot.shared = shared;
    slot.clone = clone;
    slot.age = 0;
    mesh.material = clone;
  }

  private release(slot: PulseSlot): void {
    if (slot.mesh !== null && slot.shared !== null && !Array.isArray(slot.shared)) {
      slot.mesh.material = slot.shared;
    }
    if (slot.clone !== null) {
      slot.clone.dispose();
      slot.clone = null;
    }
    slot.mesh = null;
    slot.id = null;
    slot.shared = null;
    slot.age = 0;
  }
}
