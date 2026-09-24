import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ContactPulse,
  MAX_CONTACT_PULSES,
  CONTACT_PULSE_LIFE,
  CONTACT_PULSE_PEAK,
} from '../src/rendering/ContactPulse';
import { makeTestLibrary } from './helpers/visuals';

/**
 * M9.3 island landing response (presentation only):
 * - the touched support pulses (accent emissive clone), siblings sharing
 *   the material stay dark (LOCAL, never global);
 * - the envelope decays and restores the shared material (no leaks);
 * - slots are bounded (steal-oldest), probes observe the pulse.
 */
const ACCENT = 0xb44dff;

const makeIsland = (shared: THREE.Material): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), shared);

describe('M9.3 contact pulse', () => {
  it('pulses the touched mesh with an accent emissive clone', () => {
    const library = makeTestLibrary();
    const pulse = new ContactPulse();
    const island = makeIsland(library.routeBody);
    pulse.noteLanding(island, 'solid-7', ACCENT);
    expect(island.material).not.toBe(library.routeBody);
    const clone = island.material as THREE.MeshStandardMaterial;
    expect(clone.emissive.getHex()).toBe(ACCENT);
    expect(clone.emissiveIntensity).toBeCloseTo(CONTACT_PULSE_PEAK, 5);
    expect(pulse.activeCount).toBe(1);
    expect(pulse.pulseCount).toBe(1);
    expect(pulse.lastPulseId).toBe('solid-7');
    expect(pulse.pulseIntensity).toBeCloseTo(1, 5);
  });

  it('leaves sibling islands sharing the material dark (local only)', () => {
    const library = makeTestLibrary();
    const pulse = new ContactPulse();
    const islandA = makeIsland(library.routeBody);
    const islandB = makeIsland(library.routeBody);
    pulse.noteLanding(islandA, 'solid-7', ACCENT);
    expect(islandB.material).toBe(library.routeBody);
    // The shared material itself is never mutated by the pulse.
    expect(library.routeBody.emissiveIntensity).toBe(1);
    expect(library.routeBody.emissive.getHex()).toBe(0x000000);
  });

  it('decays the envelope and restores the shared material without leaks', () => {
    const library = makeTestLibrary();
    const pulse = new ContactPulse();
    const island = makeIsland(library.routeBody);
    pulse.noteLanding(island, 'solid-7', ACCENT);
    pulse.update(CONTACT_PULSE_LIFE / 2);
    expect(pulse.pulseIntensity).toBeCloseTo(0.5, 5);
    const mid = island.material as THREE.MeshStandardMaterial;
    expect(mid.emissiveIntensity).toBeCloseTo(CONTACT_PULSE_PEAK / 2, 4);
    pulse.update(CONTACT_PULSE_LIFE / 2 + 0.01);
    expect(island.material).toBe(library.routeBody);
    expect(pulse.activeCount).toBe(0);
    expect(pulse.pulseIntensity).toBe(0);
    // The count probe survives expiry (cumulative landings).
    expect(pulse.pulseCount).toBe(1);
    expect(pulse.lastPulseId).toBe('solid-7');
  });

  it('re-landing the same mesh refreshes the pulse without extra clones', () => {
    const library = makeTestLibrary();
    const pulse = new ContactPulse();
    const island = makeIsland(library.routeBody);
    pulse.noteLanding(island, 'solid-7', ACCENT);
    pulse.update(CONTACT_PULSE_LIFE / 2);
    pulse.noteLanding(island, 'solid-7', ACCENT);
    expect(pulse.activeCount).toBe(1);
    expect(pulse.pulseIntensity).toBeCloseTo(1, 5);
    expect(pulse.pulseCount).toBe(2);
    pulse.update(CONTACT_PULSE_LIFE + 0.01);
    expect(island.material).toBe(library.routeBody);
    expect(pulse.activeCount).toBe(0);
  });

  it('bounds concurrent pulses (steal-oldest) and releases all cleanly', () => {
    const library = makeTestLibrary();
    const pulse = new ContactPulse();
    const islands: THREE.Mesh[] = [];
    for (let i = 0; i < MAX_CONTACT_PULSES + 2; i++) {
      const island = makeIsland(library.routeBody);
      islands.push(island);
      pulse.noteLanding(island, `solid-${String(i)}`, ACCENT);
    }
    expect(pulse.activeCount).toBe(MAX_CONTACT_PULSES);
    expect(pulse.pulseCount).toBe(MAX_CONTACT_PULSES + 2);
    pulse.releaseAll();
    expect(pulse.activeCount).toBe(0);
    for (const island of islands) {
      expect(island.material).toBe(library.routeBody);
    }
  });

  it('ignores multi-material meshes instead of half-pulsing them', () => {
    const library = makeTestLibrary();
    const pulse = new ContactPulse();
    const island = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
      library.routeBody,
      library.routeBody,
    ]);
    pulse.noteLanding(island, 'solid-9', ACCENT);
    expect(pulse.activeCount).toBe(0);
    expect(Array.isArray(island.material)).toBe(true);
  });

  it('stays silent when disabled (?fx=off parity)', () => {
    const library = makeTestLibrary();
    const pulse = new ContactPulse();
    pulse.setEnabled(false);
    const island = makeIsland(library.routeBody);
    pulse.noteLanding(island, 'solid-7', ACCENT);
    expect(island.material).toBe(library.routeBody);
    expect(pulse.activeCount).toBe(0);
    expect(pulse.pulseCount).toBe(0);
  });
});
