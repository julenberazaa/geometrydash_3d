import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { ChomperView, MAX_CHOMPERS } from '../src/rendering/ChomperView';
import { createChomperState } from '../src/game/chomperSystem';
import type { ChomperDef } from '../src/level/levelDefinition';
import { makeTestLibrary } from './helpers/visuals';

/**
 * M8.3 Chomper reference match (human: bright lava-orange voxel
 * chain-chomp — huge mouth, block teeth, square eyes, lava chain + cube):
 * ONE mottled magma head-ball, LARGE dark mouth cavity on the lunge face,
 * 4 chunky upper block-teeth + 3 jaw block-teeth, white-hot SQUARE eyes
 * with dark pupils flanking the mouth, chunky lava-hot chain + weight
 * cube at the anchor. Sim untouched (tests/chomper.test.ts owns it).
 * - same bounded mesh budget (26 per chomper, shared library geo/mats);
 * - chomp cycle preserved (jaw chews telegraph / gapes lunge).
 */

const DEF: ChomperDef = {
  id: 'view-1',
  dormant: { x: 8, y: 0.75, z: 610 },
  triggerZ: 600,
  lungeDirection: -1,
  lungeDistance: 16,
  telegraphTicks: 48,
  lungeTicks: 60,
  halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
};

const meshesOf = (view: ChomperView): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  view.group.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh === true) out.push(o as THREE.Mesh);
  });
  return out;
};

describe('M8.3 chomper reference presentation', () => {
  it('builds the magma-ball / cavity-maw / block-teeth / square-eye anatomy within budget', () => {
    const library = makeTestLibrary();
    const view = new ChomperView([DEF], library);
    // Per chomper: head + 4 mottle + 2 crust + mouth + 4 upper teeth +
    // jaw + 3 lower teeth + 2 eyes (+ 2 pupil children) + 5 links +
    // 1 weight = 26 meshes.
    const meshes = meshesOf(view);
    expect(meshes.length).toBe(26);
    // Two white-hot square eyes, each carrying exactly one dark pupil.
    const eyes = meshes.filter((m) => m.material === library.chomperEyeWhite);
    expect(eyes.length).toBe(2);
    for (const eye of eyes) {
      const pupils = eye.children.filter(
        (c) => (c as { isMesh?: boolean }).isMesh === true,
      );
      expect(pupils.length).toBe(1);
    }
    // The mouth is a LARGE dark cavity (taller than half the hitbox —
    // the front IS the mouth, not a trim slab): the one tall shell box
    // on the lunge-face half that is not an eye pupil.
    const cavities = meshes.filter(
      (m) =>
        m.material === library.chomperShell &&
        m.scale.y > DEF.halfExtents.y * 0.8 &&
        (m.parent as THREE.Mesh | null)?.material !== library.chomperEyeWhite &&
        m.position.x * DEF.lungeDirection > 0,
    );
    expect(cavities.length).toBe(1);
    // Seven chunky block teeth (4 upper + 3 lower), all boxes.
    const teeth = meshes.filter(
      (m) =>
        m.material === library.chomperCore &&
        m.geometry === library.unitBox &&
        m.scale.y < DEF.halfExtents.y * 0.5 &&
        m.scale.y > 0.05,
    );
    expect(teeth.length).toBe(7);
    view.dispose();
    library.dispose();
  });

  it('chews while telegraphing and gapes while lunging', () => {
    const library = makeTestLibrary();
    const view = new ChomperView([DEF], library);
    const st = createChomperState(DEF);
    view.update([st], 0.016);
    const jawYClosed = jawWorldY(view);
    st.phase = 'lunging';
    view.update([st], 0.5);
    const jawYOpen = jawWorldY(view);
    // Lunging drops the jaw (position + rotation move together).
    expect(jawYOpen).toBeLessThan(jawYClosed);
    st.phase = 'dormant';
    view.update([st], 0.5);
    expect(jawWorldY(view)).toBeCloseTo(jawYClosed, 5);
    view.dispose();
    library.dispose();
  });

  it('caps construction at MAX_CHOMPERS (bounded)', () => {
    const library = makeTestLibrary();
    const defs = Array.from({ length: MAX_CHOMPERS + 4 }, (_, i) => ({
      ...DEF,
      id: `view-${i}`,
      dormant: { x: 8, y: 0.75, z: 600 + i * 10 },
      triggerZ: 590 + i * 10,
    }));
    const view = new ChomperView(defs, library);
    expect(meshesOf(view).length / 26).toBe(MAX_CHOMPERS);
    view.dispose();
    library.dispose();
  });
});

/**
 * World Y of the jaw mesh: the jaw is the flattened slab (scale.y ≈
 * h.y * 0.3) — locate the flattest wide box in the first chomper group
 * and take the lowest match (the crust plate rides high).
 */
const jawWorldY = (view: ChomperView): number => {
  let best: number | undefined;
  view.group.traverse((o) => {
    const m = o as unknown as {
      isMesh?: boolean;
      position: { x: number; y: number; z: number };
      scale: { x: number; y: number };
    };
    if (m.isMesh !== true) return;
    if (m.scale.y < 0.2 && m.scale.x > 0.5) {
      if (best === undefined || m.position.y < best) best = m.position.y;
    }
  });
  return best ?? NaN;
};
