import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EnvironmentView } from '../src/rendering/EnvironmentView';
import { PRODUCTION_THEME } from '../src/visuals/productionTheme';

/**
 * M7.1 background energy rays (presentation only).
 *
 * A fixed set of additive beams behind the corridor, driven by the existing
 * visual state (section energy) and the event-punch envelope (ray bursts on
 * gravity/pad/speed moments). Bounded by construction: fixed mesh count,
 * one shared geometry, one shared material, zero per-frame allocation.
 */
describe('background energy rays (M7.1)', () => {
  it('builds a fixed bounded ray set sharing one geometry and one material', () => {
    const view = new EnvironmentView(700, PRODUCTION_THEME);
    const meshes = view.scene.children.filter(
      (o): o is THREE.Mesh => o instanceof THREE.Mesh,
    );
    // Rays are the only additive-blended meshes in the environment; all 12
    // share ONE material instance (retint + opacity drive every beam at once).
    const rays = meshes.filter(
      (m) => (m.material as THREE.Material).blending === THREE.AdditiveBlending,
    );
    expect(rays.length).toBe(12);
    const materials = new Set(rays.map((m) => m.material));
    expect(materials.size).toBe(1);
    const geometries = new Set(rays.map((m) => m.geometry));
    expect(geometries.size).toBe(1); // shared box geometry, no new buffers
    // Far outside the corridor (|x| >= 14): dressing only, never route.
    for (const ray of rays) expect(Math.abs(ray.position.x)).toBeGreaterThanOrEqual(14);
    view.dispose();
  });

  it('starts invisible and drives opacity absolutely from 0..1 level', () => {
    const view = new EnvironmentView(700, PRODUCTION_THEME);
    expect(view.liveRayOpacity()).toBe(0);
    view.setEnergyRays(0.5, 0xff0000);
    expect(view.liveRayOpacity()).toBeCloseTo(0.14, 6);
    view.setEnergyRays(1, 0xff0000);
    expect(view.liveRayOpacity()).toBeCloseTo(0.28, 6);
    // Peak stays subordinate (never a wash): hard cap 0.28.
    view.setEnergyRays(5, 0xff0000);
    expect(view.liveRayOpacity()).toBeCloseTo(0.28, 6);
    view.setEnergyRays(-1, 0xff0000);
    expect(view.liveRayOpacity()).toBe(0);
    view.dispose();
  });

  it('restores silence through the theme reset path', () => {
    const view = new EnvironmentView(700, PRODUCTION_THEME);
    view.setEnergyRays(1, 0xffffff);
    expect(view.liveRayOpacity()).toBeGreaterThan(0);
    view.resetToTheme();
    expect(view.liveRayOpacity()).toBe(0);
    view.dispose();
  });
});
