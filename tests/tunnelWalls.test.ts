import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LevelView } from '../src/rendering/LevelView';
import { loadLevel } from '../src/level/levelRuntime';
import { makeTestLibrary } from './helpers/visuals';
import { MULTIMODE_GAUNTLET_01 } from '../src/content/levels/multimodeGauntlet01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';

/**
 * M8.1 tunnel-wall mid-band (presentation geometry only — no gameplay).
 *
 * Tall thin freestanding walls (height ≥ 5, narrow horizontal half ≤ 0.6 —
 * the Ship tunnel sides) render as unlit black masses without edge
 * structure. LevelView gives them one neon bead at mid-height along both
 * narrow faces (0.07 section — deliberately NOT the 0.055 rail stock, so
 * rail-parity probes keep measuring exactly what they pinned). Short or
 * thick solids stay quiet.
 */

const THEME = TEST_LEVEL.theme;

const wallFixture = (overrides: Partial<LevelDefinition> = {}): LevelDefinition => ({
  id: 'm81-wall-band-fixture',
  displayName: 'M8.1 WALL BAND FIXTURE',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: 14,
  finishZ: 200,
  deathY: -14,
  solids: [{ center: { x: 0, y: -0.5, z: 90 }, halfExtents: { x: 5.4, y: 0.5, z: 100 } }],
  hazards: [],
  theme: THEME,
  ...overrides,
});

const isMesh = (o: THREE.Object3D): o is THREE.Mesh =>
  o instanceof THREE.Mesh && !Array.isArray(o.material);

const beadsIn = (view: LevelView): THREE.Mesh[] =>
  view.group.children.filter(
    (o): o is THREE.Mesh =>
      isMesh(o) &&
      Math.abs(o.scale.y - 0.07) < 1e-6 &&
      Math.abs(o.scale.x - 0.07) < 1e-6,
  );

describe('M8.1 tunnel-wall mid-band', () => {
  it('bands tall thin walls on both narrow faces at mid-height', () => {
    const library = makeTestLibrary();
    const view = new LevelView(
      loadLevel(
        wallFixture({
          solids: [
            { center: { x: 0, y: -0.5, z: 90 }, halfExtents: { x: 5.4, y: 0.5, z: 100 } },
            { center: { x: -6.5, y: 3, z: 90 }, halfExtents: { x: 0.5, y: 6, z: 75 } },
          ],
        }),
      ),
      library,
    );
    const beads = beadsIn(view);
    expect(beads.length).toBe(2);
    // One bead proud of each narrow face (wall at x −6.5, half 0.5).
    const xs = beads.map((b) => b.position.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-7.005, 5);
    expect(xs[1]).toBeCloseTo(-5.995, 5);
    for (const b of beads) {
      expect(b.position.y).toBeCloseTo(3, 5);
      // Bead runs the wall's full length.
      expect(b.scale.z).toBeCloseTo(150.1, 5);
    }
    view.dispose();
    library.dispose();
  });

  it('leaves short pillars and thick slabs quiet', () => {
    const library = makeTestLibrary();
    const view = new LevelView(
      loadLevel(
        wallFixture({
          solids: [
            { center: { x: 0, y: -0.5, z: 90 }, halfExtents: { x: 5.4, y: 0.5, z: 100 } },
            // Short pillar (3.5 tall) + thick block (half 1.2): no bands.
            { center: { x: -4.9, y: 1.75, z: 40 }, halfExtents: { x: 0.5, y: 1.75, z: 1 } },
            { center: { x: 6, y: 3, z: 60 }, halfExtents: { x: 1.2, y: 5, z: 10 } },
          ],
        }),
      ),
      library,
    );
    expect(beadsIn(view).length).toBe(0);
    view.dispose();
    library.dispose();
  });

  it('bands the real gauntlet ship-tunnel walls', () => {
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(MULTIMODE_GAUNTLET_01), library);
    const beads = beadsIn(view).filter((b) => Math.abs(b.position.z - 785) < 1);
    // Two tunnel walls × both faces, running the corridor length.
    expect(beads.length).toBe(4);
    for (const b of beads) {
      expect(b.scale.z).toBeCloseTo(150.1, 5);
    }
    view.dispose();
    library.dispose();
  });
});
