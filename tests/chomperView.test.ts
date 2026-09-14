import { describe, it, expect } from 'vitest';
import { ChomperView, MAX_CHOMPERS } from '../src/rendering/ChomperView';
import { createChomperState } from '../src/game/chomperSystem';
import type { ChomperDef } from '../src/level/levelDefinition';
import { makeTestLibrary } from './helpers/visuals';

/**
 * M8.1 Chomper visual redesign (lava creature read):
 * - armored snout + brow + dorsal heat-spikes + two crack bands + upper
 *   fangs + jaw-riding lower teeth + chomping jaw cycle;
 * - bounded mesh budget (22 per chomper, shared library geo/mats);
 * - gameplay untouched (sim contract lives in tests/chomper.test.ts).
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

describe('M8.1 chomper lava-creature presentation', () => {
  it('builds the full head/mouth/tooth anatomy within budget', () => {
    const library = makeTestLibrary();
    const view = new ChomperView([DEF], library);
    // Per chomper: body + 2 bands + snout + brow + 3 spikes + mouth +
    // 3 fangs + jaw + 2 teeth + 2 eyes (17 in-group) + 5 chain links.
    let meshes = 0;
    view.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh === true) meshes += 1;
    });
    expect(meshes).toBe(22);
    expect(view.group.children.length).toBeLessThanOrEqual(25);
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
    let groups = 0;
    // Chain links live in view space: 5 per built chomper.
    let meshes = 0;
    view.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh === true) meshes += 1;
    });
    groups = meshes / 22;
    expect(groups).toBe(MAX_CHOMPERS);
    view.dispose();
    library.dispose();
  });
});

/**
 * World Y of the jaw mesh: the jaw is the flattened slab (scale.y ≈
 * h.y * 0.28) — locate the flattest box in the first chomper group.
 */
const jawWorldY = (view: ChomperView): number => {
  // Jaw: the wide flattened slab (scale.x ≈ h.x * 0.9, scale.y ≈ 0.126).
  // Chain links share the view space, so match dimensions, not order —
  // and take the lowest match (the brow is flat but rides high).
  let best: number | undefined;
  view.group.traverse((o) => {
    const m = o as unknown as {
      isMesh?: boolean;
      position: { x: number; y: number; z: number };
      scale: { x: number; y: number };
    };
    if (m.isMesh !== true) return;
    if (m.scale.y < 0.2 && m.scale.x > 0.5) {
      // Group-local Y (jaw hangs below the body center).
      if (best === undefined || m.position.y < best) best = m.position.y;
    }
  });
  return best ?? NaN;
};
