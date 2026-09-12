import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LevelView } from '../src/rendering/LevelView';
import { loadLevel } from '../src/level/levelRuntime';
import { makeTestLibrary } from './helpers/visuals';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { VALIDATION_LEVEL_02 } from '../src/content/levels/validationLevel02';
import { VERTICAL_SLICE_01 } from '../src/content/levels/verticalSlice01';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import type { LevelDefinition, LevelHazard } from '../src/level/levelDefinition';

/**
 * M7.1 ceiling-spike orientation regression (presentation only).
 *
 * Defect: LevelView rendered every spike tip-up, so ceiling-mounted spikes
 * showed their flat base toward the player while the lethal side (the tip,
 * pointing down toward the corridor) was hidden inside the slab.
 *
 * General rule (no level-id branches, no coordinate heuristics): a spike's
 * presentation orients relative to its declared `mount` surface — the base
 * attaches to the support and the tip points AWAY from it (floor: +Y,
 * ceiling: −Y). Colliders are untouched and `mount` is fingerprint-excluded.
 */

const spikeMeshes = (group: THREE.Group): THREE.Mesh[] =>
  group.children.filter(
    (o): o is THREE.Mesh => o instanceof THREE.Mesh && !Array.isArray(o.material),
  );

/** Tip world offset of a spike mesh: local +Y/2 through scale + rotation. */
const tipWorldY = (mesh: THREE.Mesh, def: LevelHazard): number => {
  const visualHeight = def.halfExtents.y * 3.4;
  const tipLocal = visualHeight / 2;
  const flipped = Math.abs(mesh.rotation.x - Math.PI) < 1e-9;
  return mesh.position.y + (flipped ? -tipLocal : tipLocal);
};

const baseWorldY = (mesh: THREE.Mesh, def: LevelHazard): number => {
  const visualHeight = def.halfExtents.y * 3.4;
  const baseLocal = visualHeight / 2;
  const flipped = Math.abs(mesh.rotation.x - Math.PI) < 1e-9;
  return mesh.position.y + (flipped ? baseLocal : -baseLocal);
};

const meshForHazard = (
  view: LevelView,
  def: LevelHazard,
  spikeCone: THREE.BufferGeometry,
): THREE.Mesh => {
  // M7.3: match the shared spike-cone geometry exactly — edge strips,
  // sills, glow frames and wall faces now also sit near hazards, so
  // position alone no longer isolates the spike mesh (intent unchanged:
  // this helper returns THE spike presentation for the hazard).
  const found = spikeMeshes(view.group).find(
    (m) =>
      m.geometry === spikeCone &&
      Math.abs(m.position.x - def.center.x) < 0.05 &&
      Math.abs(m.position.z - def.center.z) < 0.05,
  );
  if (!found) throw new Error(`no spike mesh near z=${def.center.z}`);
  return found;
};

describe('ceiling spike orientation (M7.1)', () => {
  it('points floor spikes away from the floor (tip +Y, base at the collider bottom)', () => {
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(TEST_LEVEL), library);
    for (const hz of TEST_LEVEL.hazards) {
      const mesh = meshForHazard(view, hz, library.spikeCone);
      expect(mesh.rotation.x).toBe(0);
      expect(tipWorldY(mesh, hz)).toBeGreaterThan(hz.center.y);
      // Base sits exactly at the collider bottom (support surface below).
      expect(baseWorldY(mesh, hz)).toBeCloseTo(hz.center.y - hz.halfExtents.y, 6);
    }
  });

  it('points ceiling spikes away from the ceiling (tip −Y, base flush with the run surface)', () => {
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(VERTICAL_SLICE_01), library);
    const ceiling = VERTICAL_SLICE_01.hazards.filter((h) => h.mount === 'ceiling');
    expect(ceiling.length).toBeGreaterThanOrEqual(1);
    for (const hz of ceiling) {
      const mesh = meshForHazard(view, hz, library.spikeCone);
      expect(mesh.rotation.x).toBeCloseTo(Math.PI, 6);
      // Tip hangs BELOW the collider center (lethal side faces the corridor).
      expect(tipWorldY(mesh, hz)).toBeLessThan(hz.center.y);
      // Base sits exactly at the collider top (attached to the ceiling slab).
      expect(baseWorldY(mesh, hz)).toBeCloseTo(hz.center.y + hz.halfExtents.y, 6);
    }
  });

  it('keeps gameplay colliders identical regardless of mount', () => {
    // The collision world registers the authored boxes verbatim (mount is
    // never read by levelRuntime or the simulation): same count, same
    // centers and half-extents as the definition.
    const loaded = loadLevel(VERTICAL_SLICE_01);
    const registered = loaded.world.colliders().filter((c) => c.kind === 'hazard');
    expect(registered.length).toBe(VERTICAL_SLICE_01.hazards.length);
    for (let i = 0; i < VERTICAL_SLICE_01.hazards.length; i++) {
      const hz = VERTICAL_SLICE_01.hazards[i];
      const collider = registered[i];
      if (!hz || !collider) throw new Error('hazard/collider mismatch');
      expect(collider.center.x).toBe(hz.center.x);
      expect(collider.center.y).toBe(hz.center.y);
      expect(collider.center.z).toBe(hz.center.z);
    }
    // The ceiling spike lethal boxes still span y 5.5..6.0 (unchanged hitbox).
    for (const hz of VERTICAL_SLICE_01.hazards.filter((h) => h.mount === 'ceiling')) {
      expect(hz.center.y - hz.halfExtents.y).toBeCloseTo(5.5, 6);
      expect(hz.center.y + hz.halfExtents.y).toBeCloseTo(6.0, 6);
    }
  });

  it('renders pre-M7.1 levels unchanged (omitted mount defaults to floor)', () => {
    for (const def of [TEST_LEVEL, VALIDATION_LEVEL_02]) {
      for (const hz of def.hazards) expect(hz.mount).toBeUndefined();
      const view = new LevelView(loadLevel(def), makeTestLibrary());
      const meshes = spikeMeshes(view.group).filter((m) => Math.abs(m.rotation.x) < 1e-9);
      // Every spike on levels without mount metadata renders tip-up.
      expect(meshes.length).toBeGreaterThan(0);
    }
  });

  it('excludes mount from the gameplay fingerprint (restyling keeps replays compatible)', () => {
    const base = computeLevelFingerprint(VERTICAL_SLICE_01);
    const stripped: LevelDefinition = {
      ...VERTICAL_SLICE_01,
      hazards: VERTICAL_SLICE_01.hazards.map(({ mount: _mount, ...rest }) => rest),
    };
    expect(computeLevelFingerprint(stripped)).toBe(base);
    const flipped: LevelDefinition = {
      ...VERTICAL_SLICE_01,
      hazards: VERTICAL_SLICE_01.hazards.map((h) => ({ ...h, mount: 'floor' as const })),
    };
    expect(computeLevelFingerprint(flipped)).toBe(base);
  });

  it('contains no level-specific branch in the hazard renderer', () => {
    const modules = import.meta.glob('../src/rendering/LevelView.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    });
    const sources = Object.values(modules).filter((s): s is string => typeof s === 'string');
    expect(sources.length).toBe(1);
    const source = sources[0] ?? '';
    expect(source).not.toContain('vertical-slice-01');
    expect(source).not.toContain('verticalSlice');
    expect(source).not.toContain('VERTICAL_SLICE');
  });
});
