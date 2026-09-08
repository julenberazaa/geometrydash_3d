import { describe, expect, it } from 'vitest';
import {
  BLOOM_CONTRACT,
  PRODUCTION_THEME,
  resolveProductionTheme,
} from '../src/visuals/productionTheme';
import {
  evaluateVisualSequence,
  lerpHex,
  makeVisualState,
  prepareVisualSequence,
  resetVisualState,
  type PreparedVisualSequence,
  type VisualState,
} from '../src/visuals/visualTimeline';
import type {
  LevelDefinition,
  VisualSequenceDefinition,
} from '../src/level/levelDefinition';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { VALIDATION_LEVEL_02 } from '../src/content/levels/validationLevel02';
import { VfxSystem } from '../src/rendering/VfxSystem';
import { PostPipeline } from '../src/rendering/PostPipeline';
import { GameSimulation } from '../src/game/GameSimulation';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { makeIdlePhysicalSnapshot } from '../src/input/InputSystem';
import { validateReplayObject } from '../src/replay/replayFormat';
import { makeTestLibrary } from './helpers/visuals';
import * as THREE from 'three';
import fixtureRaw from './fixtures/replays/validation-level-02-v1.json?raw';

/**
 * M6C1 visual-trigger infrastructure tests (structural, never pixel).
 *
 * The timeline is position-driven presentation: deterministic section
 * identity by Z, pure interpolation (no drift), contract-clamped bloom /
 * exposure, stable player + hazard semantics, fingerprint-decoupled data,
 * bounded resources, replay compatibility. The sim is never modified to
 * satisfy these tests.
 */

const TWO_SECTIONS: VisualSequenceDefinition = {
  sections: [
    { id: 'a', startZ: 0, endZ: 10, blendIn: 10, overrides: {} },
    {
      id: 'b',
      startZ: 10,
      endZ: 20,
      blendIn: 10,
      overrides: { background: 0xffffff, exposure: 2, bloomStrength: 0.7 },
    },
  ],
};

const preparedTwo = (): PreparedVisualSequence => prepareVisualSequence(TWO_SECTIONS);

const evalAt = (sections: PreparedVisualSequence, z: number): VisualState => {
  const out = makeVisualState();
  evaluateVisualSequence(PRODUCTION_THEME, sections, z, out);
  return out;
};

describe('timeline lookup is deterministic by Z', () => {
  it('same z always resolves the same section + state', () => {
    const seq = preparedTwo();
    for (const z of [-5, 0, 5, 9.999, 10, 15, 20, 400]) {
      expect(evalAt(seq, z)).toEqual(evalAt(seq, z));
    }
  });

  it('section boundaries are deterministic (last startZ wins)', () => {
    const seq = preparedTwo();
    expect(evalAt(seq, -0.001).sectionId).toBe('base');
    expect(evalAt(seq, 0).sectionId).toBe('a');
    expect(evalAt(seq, 9.999).sectionId).toBe('a');
    expect(evalAt(seq, 10).sectionId).toBe('b');
    expect(evalAt(seq, 1000).sectionId).toBe('b');
  });

  it('interpolation returns correct endpoints (prev at 0, target at 1)', () => {
    const seq = preparedTwo();
    // At the boundary the blend factor is 0 → previous (base) values.
    expect(evalAt(seq, 10).background).toBe(PRODUCTION_THEME.background);
    expect(evalAt(seq, 10).exposure).toBe(PRODUCTION_THEME.exposure);
    // One full blendIn past start → exact section targets.
    expect(evalAt(seq, 20).background).toBe(0xffffff);
    expect(evalAt(seq, 20).exposure).toBe(2);
    // Mid-blend is the smoothstep midpoint: smooth(0.5) = 0.5.
    expect(evalAt(seq, 15).background).toBe(lerpHex(PRODUCTION_THEME.background, 0xffffff, 0.5));
  });
});

describe('triggers-off restores the exact base (never an approximation)', () => {
  it('resetVisualState writes every base field exactly', () => {
    const out = makeVisualState();
    resetVisualState(PRODUCTION_THEME, out);
    expect(out.sectionId).toBe('base');
    expect(out.background).toBe(PRODUCTION_THEME.background);
    expect(out.fogColor).toBe(PRODUCTION_THEME.fogColor);
    expect(out.fogNear).toBe(PRODUCTION_THEME.fogNear);
    expect(out.fogFar).toBe(PRODUCTION_THEME.fogFar);
    expect(out.routeBody).toBe(PRODUCTION_THEME.routeBody);
    expect(out.routeSurface).toBe(PRODUCTION_THEME.routeTop);
    expect(out.routeAccent).toBe(PRODUCTION_THEME.routeEdge);
    expect(out.environmentIntensity).toBe(1);
    expect(out.bloomStrength).toBe(PRODUCTION_THEME.bloomStrength);
    expect(out.bloomRadius).toBe(PRODUCTION_THEME.bloomRadius);
    expect(out.bloomThreshold).toBe(PRODUCTION_THEME.bloomThreshold);
    expect(out.exposure).toBe(PRODUCTION_THEME.exposure);
    expect(out.vfxIntensity).toBe(1);
    expect(out.streakIntensity).toBe(1);
  });

  it('evaluating an empty sequence resolves base at any z', () => {
    for (const z of [-100, 0, 200, 1000]) {
      const s = evalAt([], z);
      expect(s.sectionId).toBe('base');
      expect(s.background).toBe(PRODUCTION_THEME.background);
    }
  });

  it('reset after a deep-section evaluation equals the empty evaluation', () => {
    const seq = preparedTwo();
    const deep = evalAt(seq, 18);
    expect(deep.sectionId).toBe('b');
    resetVisualState(PRODUCTION_THEME, deep);
    expect(deep).toEqual(evalAt([], 18));
  });
});

describe('restart/start positions resolve the initial state', () => {
  it('level start positions resolve their opening sections', () => {
    const l1 = prepareVisualSequence(TEST_LEVEL.visualSequence);
    expect(TEST_LEVEL.visualSequence?.sections.length).toBeGreaterThan(0);
    expect(evalAt(l1, TEST_LEVEL.start.z).sectionId).toBe('runway');
    const l2 = prepareVisualSequence(VALIDATION_LEVEL_02.visualSequence);
    expect(evalAt(l2, VALIDATION_LEVEL_02.start.z).sectionId).toBe('v2-weave');
  });
});

describe('timeline state never drifts', () => {
  it('repeated forward/backward sampling is bit-identical', () => {
    const seq = preparedTwo();
    const probes = [0, 5, 9.999, 10, 12.5, 19.999, 25];
    const first = probes.map((z) => ({ ...evalAt(seq, z) }));
    for (let pass = 0; pass < 3; pass++) {
      for (let z = 0; z <= 30; z += 3) evalAt(seq, z); // forward sweep
      for (let z = 30; z >= 0; z -= 3) evalAt(seq, z); // backward sweep
      const again = probes.map((z) => ({ ...evalAt(seq, z) }));
      expect(again).toEqual(first);
    }
  });
});

describe('color interpolation is deterministic', () => {
  it('lerpHex pins endpoints + midpoint', () => {
    expect(lerpHex(0x123456, 0xabcdef, 0)).toBe(0x123456);
    expect(lerpHex(0x123456, 0xabcdef, 1)).toBe(0xabcdef);
    expect(lerpHex(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(lerpHex(0x000000, 0xffffff, 0.5)).toBe(lerpHex(0x000000, 0xffffff, 0.5));
  });
});

describe('timeline bloom + exposure obey the safety contracts', () => {
  const wild: VisualSequenceDefinition = {
    sections: [
      {
        id: 'wild',
        startZ: 0,
        endZ: 10,
        blendIn: 0,
        overrides: {
          bloomStrength: 5,
          bloomRadius: 9,
          bloomThreshold: 0,
          exposure: 9,
          environmentIntensity: 7,
          vfxIntensity: -2,
          streakIntensity: 42,
        },
      },
    ],
  };

  it('bloom overrides clamp through BLOOM_CONTRACT', () => {
    const s = evalAt(prepareVisualSequence(wild), 5);
    expect(s.bloomStrength).toBeLessThanOrEqual(BLOOM_CONTRACT.maxStrength);
    expect(s.bloomRadius).toBeLessThanOrEqual(BLOOM_CONTRACT.maxRadius);
    expect(s.bloomThreshold).toBeGreaterThanOrEqual(BLOOM_CONTRACT.minThreshold);
    expect(s.bloomStrength).toBe(BLOOM_CONTRACT.maxStrength);
    expect(s.bloomRadius).toBe(BLOOM_CONTRACT.maxRadius);
    expect(s.bloomThreshold).toBe(BLOOM_CONTRACT.minThreshold);
  });

  it('exposure + intensities clamp to their sane ranges', () => {
    const s = evalAt(prepareVisualSequence(wild), 5);
    expect(s.exposure).toBe(2);
    expect(s.environmentIntensity).toBe(2);
    expect(s.vfxIntensity).toBe(0);
    expect(s.streakIntensity).toBe(2);
  });
});

describe('player + hazard semantic identities stay stable', () => {
  it('sweeping every proof section never moves player/hazard colors', () => {
    const lib = makeTestLibrary();
    const playerBody = lib.playerBody.color.getHex();
    const playerFace = lib.playerFace.color.getHex();
    const hazard = lib.hazard.color.getHex();
    const matsBefore = lib.materialCount;
    const geosBefore = lib.geometryCount;
    for (const seq of [
      prepareVisualSequence(TEST_LEVEL.visualSequence),
      prepareVisualSequence(VALIDATION_LEVEL_02.visualSequence),
    ]) {
      for (let z = -10; z <= 400; z += 5) {
        const s = evalAt(seq, z);
        lib.applyRouteState(s.routeBody, s.routeSurface, s.routeAccent);
      }
    }
    expect(lib.playerBody.color.getHex()).toBe(playerBody);
    expect(lib.playerFace.color.getHex()).toBe(playerFace);
    expect(lib.hazard.color.getHex()).toBe(hazard);
    // No material/geometry growth from section switches (tests 15/16).
    expect(lib.materialCount).toBe(matsBefore);
    expect(lib.geometryCount).toBe(geosBefore);
    lib.resetRouteToTheme();
    expect(lib.routeBody.color.getHex()).toBe(PRODUCTION_THEME.routeBody);
    expect(lib.routeTop.color.getHex()).toBe(PRODUCTION_THEME.routeTop);
    expect(lib.routeEdge.color.getHex()).toBe(PRODUCTION_THEME.routeEdge);
    lib.dispose();
  });
});

describe('timeline data does not affect the gameplay fingerprint', () => {
  it('adding/removing/mutating a sequence keeps the fingerprint identical', () => {
    const withSeq = computeLevelFingerprint(TEST_LEVEL);
    const stripped: LevelDefinition = { ...TEST_LEVEL, visualSequence: undefined };
    expect(computeLevelFingerprint(stripped)).toBe(withSeq);
    const mutated: LevelDefinition = {
      ...TEST_LEVEL,
      visualSequence: {
        sections: [
          { id: 'x', startZ: 0, endZ: 1, overrides: { background: 0x000000, exposure: 2 } },
        ],
      },
    };
    expect(computeLevelFingerprint(mutated)).toBe(withSeq);
    const l2 = computeLevelFingerprint(VALIDATION_LEVEL_02);
    expect(computeLevelFingerprint({ ...VALIDATION_LEVEL_02, visualSequence: undefined })).toBe(l2);
  });
});

describe('simulation stays trigger-free (architecture boundary)', () => {
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

  it('GameSimulation has no trigger/timeline/render import', () => {
    const files: Record<string, string> = {};
    for (const [file, src] of Object.entries({ ...simSources, ...simEntry })) {
      if (typeof src === 'string') files[file] = src;
    }
    expect(Object.keys(files).length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(files)) {
      if (/visualTimeline|visualTriggers|rendering\/|from\s+['"]three['"]/.test(src)) {
        // levelDefinition.ts carries the presentation-only timeline TYPES
        // (same precedent as LevelTheme) — type-only, erased at compile.
        if (file.endsWith('src/level/levelDefinition.ts') && !/from\s+['"]\.\.\/visuals\/visualTimeline['"]/.test(src)) {
          continue;
        }
        if (file.endsWith('src/level/levelDefinition.ts') && /import\s+type\s+.*visualTimeline/.test(src)) {
          continue;
        }
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('level data value-imports no visuals module (types only)', () => {
    const levelSources = import.meta.glob('../src/level/*.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    });
    for (const [file, src] of Object.entries(levelSources)) {
      if (typeof src !== 'string') continue;
      // Every visuals import in level data must be type-only (erased at
      // compile — zero runtime coupling to rendering). A side-effect or
      // value import would couple level data to the presentation layer.
      const imports = src.match(/import\s+(?!type\b)[^;]*?from\s+'\.\.\/visuals\/[^']+'/g) ?? [];
      expect(imports, file).toEqual([]);
    }
  });

  it('the timeline controller imports no three.js (sim-safe by construction)', () => {
    const timelineSources = import.meta.glob('../src/visuals/visualTimeline.ts', {
      eager: true,
      query: '?raw',
      import: 'default',
    });
    for (const src of Object.values(timelineSources)) {
      if (typeof src !== 'string') continue;
      expect(src.includes("from 'three'")).toBe(false);
    }
  });
});

describe('post pipeline never rebuilds for timeline changes', () => {
  const fakeRenderer = (): THREE.WebGLRenderer =>
    ({
      render: (): void => undefined,
      getSize: (v: THREE.Vector2): THREE.Vector2 => v.set(1280, 720),
      getPixelRatio: (): number => 1,
    }) as unknown as THREE.WebGLRenderer;

  it('bloom retunes keep the composer pass count constant', () => {
    const pipe = new PostPipeline(fakeRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera(), {
      ...PRODUCTION_THEME,
    }, false);
    expect(pipe.passCount).toBe(0);
    for (let i = 0; i < 10; i++) {
      pipe.setBloomParams(0.5 + i * 0.1, 0.4, 0.75);
      expect(pipe.passCount).toBe(0);
    }
    pipe.resetBloomToTheme();
    expect(pipe.passCount).toBe(0);
    pipe.dispose();
    pipe.dispose(); // idempotent
  });
});

describe('VFX pool capacities stay constant under timeline intensity', () => {
  it('setIntensity never reallocates or resizes pools', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const burstCap = vfx.burstCapacity;
    const trailCap = vfx.trailCapacity;
    vfx.setIntensity(0, 0);
    vfx.setIntensity(2, 2);
    vfx.setIntensity(99, -99);
    vfx.setIntensity(1, 1);
    expect(vfx.burstCapacity).toBe(burstCap);
    expect(vfx.trailCapacity).toBe(trailCap);
    vfx.dispose();
    vfx.dispose(); // idempotent
  });
});

describe('trigger-off behavior is structurally valid', () => {
  it('controller disposal/reset is idempotent (cold double-reset)', () => {
    const out = makeVisualState();
    evaluateVisualSequence(PRODUCTION_THEME, preparedTwo(), 18, out);
    resetVisualState(PRODUCTION_THEME, out);
    const once = { ...out };
    resetVisualState(PRODUCTION_THEME, out);
    expect({ ...out }).toEqual(once);
  });

  it('prepare does not mutate input order and sorts by startZ', () => {
    const seq: VisualSequenceDefinition = {
      sections: [
        { id: 'late', startZ: 100, endZ: 200, overrides: {} },
        { id: 'early', startZ: 0, endZ: 50, overrides: {} },
      ],
    };
    const prepared = prepareVisualSequence(seq);
    expect(prepared[0]?.id).toBe('early');
    expect(prepared[1]?.id).toBe('late');
    expect(seq.sections[0]?.id).toBe('late'); // input untouched
    expect(prepareVisualSequence(seq)).toEqual(prepared);
    expect(prepareVisualSequence(undefined)).toEqual([]);
  });
});

interface GoldenFixtureFile {
  _provenance: unknown;
  replay: unknown;
}

describe('golden replay recreates the timeline naturally (headless integration)', () => {
  it('the committed tape still verifies while the timeline observes every tick', () => {
    const file = JSON.parse(fixtureRaw) as GoldenFixtureFile;
    const validated = validateReplayObject(file.replay);
    if (!validated.ok) throw new Error(`golden replay invalid: ${validated.reason}`);
    const replay = validated.replay;
    expect(replay.frameCount).toBe(2346);

    const sections = prepareVisualSequence(VALIDATION_LEVEL_02.visualSequence);
    expect(sections.length).toBeGreaterThan(0);
    const state = makeVisualState();
    const base = resolveProductionTheme(VALIDATION_LEVEL_02);
    const seen = new Set<string>();
    const sim = new GameSimulation(VALIDATION_LEVEL_02, {});
    const coordinator = new ReplayCoordinator(sim);
    const start = coordinator.startReplay(replay);
    expect(start.ok).toBe(true);
    let tick = 0;
    while (coordinator.isPlaying && tick < 60000) {
      coordinator.beforeSimTick();
      const input = coordinator.getInputForTick(makeIdlePhysicalSnapshot());
      sim.update(input);
      coordinator.afterSimTick();
      // Presentation observes the replayed trajectory exactly like live play.
      evaluateVisualSequence(base, sections, sim.player.position.z, state);
      seen.add(state.sectionId);
      // Safety contracts hold on every replayed frame.
      expect(state.bloomStrength).toBeLessThanOrEqual(BLOOM_CONTRACT.maxStrength);
      expect(state.exposure).toBeLessThanOrEqual(2);
      tick += 1;
    }
    expect(coordinator.isPlaying).toBe(false);
    expect(coordinator.verification.kind).toBe('pass');
    // The replayed trajectory walks the whole proof sequence.
    expect(seen.has('v2-weave')).toBe(true);
    expect(seen.has('v2-ceiling')).toBe(true);
    expect(seen.has('v2-speed')).toBe(true);
  });
});
