import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LevelView } from '../src/rendering/LevelView';
import { loadLevel } from '../src/level/levelRuntime';
import { makeTestLibrary } from './helpers/visuals';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';

/**
 * M8.5 neon edge-line pass (presentation geometry only — no gameplay):
 * LevelView builds ONE merged LineSegments outlining every solid and
 * killFront box (12 edges) plus every spike pyramid (base square + 4 apex
 * lines) on a single shared vertex-colored line material. Solid/wall
 * vertices follow the section accent through setEdgeAccent; spike
 * vertices stay hazard-warm forever (GAME_DESIGN §9 hierarchy).
 */

const lineSegments = (view: LevelView): THREE.LineSegments[] =>
  view.group.children.filter(
    (o): o is THREE.LineSegments => o instanceof THREE.LineSegments,
  );

const expectedVerts = (solids: number, walls: number, spikes: number): number =>
  (solids + walls) * 24 + spikes * 16;

describe('M8.5 edge lines', () => {
  it('builds exactly one merged LineSegments with the expected vertex count', () => {
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(TEST_LEVEL), library);
    try {
      const lines = lineSegments(view);
      expect(lines.length).toBe(1);
      const geo = lines[0]?.geometry as THREE.BufferGeometry;
      const walls = TEST_LEVEL.hazards.filter(
        (h) => h.kind === 'killFront' || h.visual === 'block',
      ).length;
      const spikes = TEST_LEVEL.hazards.length - walls;
      expect(geo.getAttribute('position').count).toBe(
        expectedVerts(TEST_LEVEL.solids.length, walls, spikes),
      );
      expect(geo.getAttribute('color').count).toBe(geo.getAttribute('position').count);
    } finally {
      view.dispose();
    }
  });

  it('shares one line material and owns its buffer (no library geometry)', () => {
    const library = makeTestLibrary();
    const geosBefore = library.geometryCount;
    const matsBefore = library.materialCount;
    const view = new LevelView(loadLevel(TEST_LEVEL), library);
    try {
      const lines = lineSegments(view);
      expect(lines[0]?.material).toBe(library.routeEdgeLine);
      expect(library.geometryCount).toBe(geosBefore);
      expect(library.materialCount).toBe(matsBefore);
    } finally {
      view.dispose();
    }
  });

  it('re-tints only the solid range on section accent changes', () => {
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(TEST_LEVEL), library);
    try {
      const geo = lineSegments(view)[0]?.geometry as THREE.BufferGeometry;
      const colors = geo.getAttribute('color').array as Float32Array;
      const solidVerts = (TEST_LEVEL.solids.length +
        TEST_LEVEL.hazards.filter((h) => h.kind === 'killFront' || h.visual === 'block').length) * 24;
      // Baseline: dynamic range matches the theme accent.
      const accent = new THREE.Color(library.routeEdge.color.getHex());
      expect(colors[0]).toBeCloseTo(accent.r, 5);
      // Spike range matches the global hazard warm identity.
      const warm = library.hazard.color;
      const spikeStart = solidVerts * 3;
      if (spikeStart < colors.length) {
        expect(colors[spikeStart]).toBeCloseTo(warm.r, 5);
        expect(colors[spikeStart + 1]).toBeCloseTo(warm.g, 5);
        expect(colors[spikeStart + 2]).toBeCloseTo(warm.b, 5);
      }
      // Re-tint: solid range follows, spike range never moves.
      view.setEdgeAccent(0x12ff34);
      const painted = new THREE.Color(0x12ff34);
      expect(colors[0]).toBeCloseTo(painted.r, 5);
      expect(colors[1]).toBeCloseTo(painted.g, 5);
      if (spikeStart < colors.length) {
        expect(colors[spikeStart]).toBeCloseTo(warm.r, 5);
        expect(colors[spikeStart + 1]).toBeCloseTo(warm.g, 5);
        expect(colors[spikeStart + 2]).toBeCloseTo(warm.b, 5);
      }
      // Change-guarded: a repeat call leaves the buffer version untouched.
      const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute;
      const version = colorAttr.version;
      view.setEdgeAccent(0x12ff34);
      expect((geo.getAttribute('color') as THREE.BufferAttribute).version).toBe(version);
    } finally {
      view.dispose();
    }
  });

  it('builds the showcase level and disposes its buffer with the view', () => {
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(PRODUCTION_SHOWCASE_01), library);
    try {
      const lines = lineSegments(view);
      expect(lines.length).toBe(1);
      const walls = PRODUCTION_SHOWCASE_01.hazards.filter(
        (h) => h.kind === 'killFront' || h.visual === 'block',
      ).length;
      const spikes = PRODUCTION_SHOWCASE_01.hazards.length - walls;
      expect((lines[0]?.geometry as THREE.BufferGeometry).getAttribute('position').count).toBe(
        expectedVerts(PRODUCTION_SHOWCASE_01.solids.length, walls, spikes),
      );
      expect(library.geometryCount).toBeGreaterThan(0);
    } finally {
      view.dispose();
    }
    expect(lineSegments(view).length).toBe(0);
  });
});
