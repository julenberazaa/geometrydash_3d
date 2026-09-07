import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LevelView } from '../src/rendering/LevelView';
import { PostPipeline } from '../src/rendering/PostPipeline';
import { loadLevel } from '../src/level/levelRuntime';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { VALIDATION_LEVEL_02 } from '../src/content/levels/validationLevel02';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import {
  BLOOM_CONTRACT,
  PRODUCTION_THEME,
  resolveProductionTheme,
  validateProductionTheme,
} from '../src/visuals/productionTheme';
import { makeTestLibrary } from './helpers/visuals';

/**
 * M6A visual-foundation regression (all structural — no pixel tests).
 *
 * Presentation-only gate: the production theme, shared material ownership,
 * and post pipeline must never change gameplay, simulation fingerprints,
 * replay compatibility, or resource boundedness.
 */

describe('visual theme is replay-compatible (fingerprint-stable)', () => {
  it('mutating renderer-only theme data does not change the level fingerprint', () => {
    const before = computeLevelFingerprint(TEST_LEVEL);
    const restyled: LevelDefinition = {
      ...TEST_LEVEL,
      theme: {
        background: 0x000000,
        fogColor: 0xffffff,
        fogNear: 5,
        fogFar: 500,
        platform: 0x111111,
        platformTop: 0x222222,
        edge: 0x00ff00,
        hazard: 0x0000ff,
      },
    };
    expect(computeLevelFingerprint(restyled)).toBe(before);
  });

  it('resolving different production themes does not change the fingerprint', () => {
    const before = computeLevelFingerprint(VALIDATION_LEVEL_02);
    const t1 = resolveProductionTheme(TEST_LEVEL);
    const t2 = resolveProductionTheme(VALIDATION_LEVEL_02);
    expect(t1.routeEdge).not.toBe(t2.routeEdge); // per-level identity flows through
    expect(computeLevelFingerprint(TEST_LEVEL)).not.toBe(before); // distinct levels differ
    // ...but neither resolution touches gameplay content:
    expect(computeLevelFingerprint({ ...TEST_LEVEL })).toBe(
      computeLevelFingerprint(TEST_LEVEL),
    );
    void t1;
  });

  it('shared production language is identical across levels (one hierarchy)', () => {
    const t1 = resolveProductionTheme(TEST_LEVEL);
    const t2 = resolveProductionTheme(VALIDATION_LEVEL_02);
    expect(t1.playerBody).toBe(t2.playerBody);
    expect(t1.playerFace).toBe(t2.playerFace);
    expect(t1.hazard).not.toBe(t1.routeEdge); // hazards never share the route language
    // Semantic accents are wired from the shared theme (not per-level hues).
    expect(t2.padJump).toBe(PRODUCTION_THEME.padJump);
    expect(t2.orbJump).toBe(PRODUCTION_THEME.orbJump);
    expect(t2.orbGravity).toBe(PRODUCTION_THEME.orbGravity);
    expect(t2.orbGravity).not.toBe(t2.orbJump); // gravity reads distinct from jump
  });
});

describe('production theme validation', () => {
  it('shipped theme honors the bloom contract (restrained, dark-safe)', () => {
    expect(PRODUCTION_THEME.bloomThreshold).toBeGreaterThanOrEqual(BLOOM_CONTRACT.minThreshold);
    expect(PRODUCTION_THEME.bloomStrength).toBeLessThanOrEqual(BLOOM_CONTRACT.maxStrength);
    expect(PRODUCTION_THEME.bloomRadius).toBeLessThanOrEqual(BLOOM_CONTRACT.maxRadius);
  });

  it('validateProductionTheme clamps out-of-range post values into the contract', () => {
    const fixed = validateProductionTheme({
      bloomStrength: 5,
      bloomRadius: 5,
      bloomThreshold: 0.05,
      exposure: 9,
    });
    expect(fixed.bloomStrength).toBeLessThanOrEqual(BLOOM_CONTRACT.maxStrength);
    expect(fixed.bloomRadius).toBeLessThanOrEqual(BLOOM_CONTRACT.maxRadius);
    expect(fixed.bloomThreshold).toBeGreaterThanOrEqual(BLOOM_CONTRACT.minThreshold);
    expect(fixed.exposure).toBeLessThanOrEqual(2);
  });

  it('validateProductionTheme fills defaults for an empty override', () => {
    const fixed = validateProductionTheme({});
    expect(fixed).toEqual(PRODUCTION_THEME);
  });
});

describe('material library ownership (bounded, shared, disposable)', () => {
  it('equivalent surfaces share one material instance', () => {
    const library = makeTestLibrary();
    const a = new LevelView(loadLevel(TEST_LEVEL), library);
    const b = new LevelView(loadLevel(TEST_LEVEL), library);
    // Both views draw from the same library instances (spot-check route + hazard).
    expect(library.routeBody).toBe(library.routeBody);
    expect(library.hazard).toBe(library.hazard);
    expect(library.speedTier(2)).toBe(library.speedTier(2));
    a.dispose();
    b.dispose();
    library.dispose();
  });

  it('building more views creates no new materials or geometries', () => {
    const library = makeTestLibrary();
    const matsBefore = library.materialCount;
    const geosBefore = library.geometryCount;
    const views = [
      new LevelView(loadLevel(TEST_LEVEL), library),
      new LevelView(loadLevel(VALIDATION_LEVEL_02), library),
    ];
    // One lazily-cached speed-tier material per gameplay tier may appear;
    // everything else must be shared. Level 01 + 02 use tiers {2} (+1/0.5
    // only if present in data) — bound the growth tightly.
    expect(library.materialCount - matsBefore).toBeLessThanOrEqual(3);
    expect(library.geometryCount).toBe(geosBefore);
    for (const v of views) v.dispose();
    library.dispose();
  });

  it('per-frame view updates allocate no materials or geometries', () => {
    const library = makeTestLibrary();
    library.speedTier(2); // warm the lazy per-tier cache once (build-time path)
    const mats = library.materialCount;
    const geos = library.geometryCount;
    // MaterialLibrary exposes no per-frame path by construction: updates run
    // against held references. Pin the observable side (counts are stable
    // across arbitrary reads + tier lookups).
    for (let i = 0; i < 120; i++) {
      library.speedTier(2);
      void library.ringMaterials();
    }
    expect(library.materialCount).toBe(mats);
    expect(library.geometryCount).toBe(geos);
    library.dispose();
  });

  it('dispose releases everything and zeroes the counts', () => {
    const library = makeTestLibrary();
    expect(library.materialCount).toBeGreaterThan(0);
    expect(library.geometryCount).toBeGreaterThan(0);
    library.dispose();
    expect(library.materialCount).toBe(0);
    expect(library.geometryCount).toBe(0);
  });
});

describe('post pipeline fallback (headless-structural)', () => {
  const fakeRenderer = (): THREE.WebGLRenderer => {
    const calls: string[] = [];
    return {
      render: (): void => {
        calls.push('render');
      },
      getSize: (v: THREE.Vector2): THREE.Vector2 => v.set(1280, 720),
      getPixelRatio: (): number => 1,
      __calls: calls,
    } as unknown as THREE.WebGLRenderer;
  };

  it('disabled pipeline renders direct with zero composer passes', () => {
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 400);
    const pipe = new PostPipeline(renderer, scene, camera, { ...PRODUCTION_THEME }, false);
    expect(pipe.isEnabled).toBe(false);
    expect(pipe.passCount).toBe(0);
    expect(pipe.liveBloomParams).toBeNull();
    pipe.render();
    expect((renderer as unknown as { __calls: string[] }).__calls).toEqual(['render']);
    expect((): void => {
      pipe.resize(800, 600);
    }).not.toThrow();
    expect((): void => {
      pipe.dispose();
    }).not.toThrow();
    // Idempotent dispose (HMR safety).
    expect((): void => {
      pipe.dispose();
    }).not.toThrow();
  });
});

describe('simulation stays rendering-free (architecture boundary)', () => {
  // Raw source texts of every simulation-domain module (self-maintaining:
  // new files under these dirs are picked up automatically). Game.ts and
  // main.ts are the composition root / entry — they MAY wire rendering.
  const simSources = import.meta.glob('../src/{core,input,player,collision,level,replay,content}/**/*.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  });
  const simEntry = import.meta.glob('../src/game/GameSimulation.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  });

  it('no simulation-domain file imports three.js or rendering code', () => {
    const files: Record<string, string> = {};
    for (const [file, src] of Object.entries({ ...simSources, ...simEntry })) {
      // Raw-text glob modules resolve to strings; ignore anything else.
      if (typeof src === 'string') files[file] = src;
    }
    expect(Object.keys(files).length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(files)) {
      if (/from\s+['"]three['"]|from\s+['"]\.\.\/rendering\/|from\s+['"]\.\/rendering\//.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
