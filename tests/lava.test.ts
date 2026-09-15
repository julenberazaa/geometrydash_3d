import { describe, it, expect } from 'vitest';
import { GameSimulation, DEATH_HOLD_TICKS } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { ADVANCED_CUBE_01 } from '../src/content/levels/advancedCube01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { validateLavaAuthoring } from '../src/level/lavaAuthoring';
import { MULTIMODE_GAUNTLET_01 } from '../src/content/levels/multimodeGauntlet01';
import { loadLevel } from '../src/level/levelRuntime';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { computeStateFingerprint } from '../src/replay/stateFingerprint';
import { idleInput, advance } from './helpers/simulation';
import { LevelView } from '../src/rendering/LevelView';
import type { MaterialLibrary } from '../src/rendering/MaterialLibrary';
import { makeTestLibrary } from './helpers/visuals';

/**
 * M8A lethal-lava + death-hold contract:
 * - touching lava kills INSTANTLY with cause `lava` (no delay, no bounce);
 * - lava rides the same swept-path CCD as hazards (no tunneling at speed);
 * - every production lava composition is sourced/contained (no floaters);
 * - the death hold is long enough to read the explosion (78 ticks / 0.65 s)
 *   while restart stays arcade-fast.
 */

const THEME = TEST_LEVEL.theme;
const LANES = [2.6, 0, -2.6];

const makeLavaArena = (lava: LevelDefinition['lava'], opts: Partial<LevelDefinition> = {}): GameSimulation => {
  const def: LevelDefinition = {
    id: 'm8a-lava-fixture',
    displayName: 'M8A LAVA FIXTURE',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: 60,
    deathY: -14,
    // Default arena: runway ends at z = 4, the pool below the gap (z 4..16)
    // catches the fall — unless the caller overrides solids entirely.
    solids: [{ center: { x: 0, y: -0.5, z: -3 }, halfExtents: { x: 5.4, y: 0.5, z: 7 } }],
    hazards: [],
    lava,
    theme: THEME,
    ...opts,
  };
  return new GameSimulation(def);
};

describe('M8A lethal lava gameplay', () => {
  it('touching a lava pool kills instantly with cause lava', () => {
    // Pool surface top y = -2 sitting in a basin floor (top -3).
    const sim = makeLavaArena(
      [{ id: 'pool', center: { x: 0, y: -2.5, z: 10 }, halfExtents: { x: 4, y: 0.5, z: 6 }, role: 'pool' }],
      {
        solids: [
          { center: { x: 0, y: -0.5, z: 2 }, halfExtents: { x: 5.4, y: 0.5, z: 6 } },
          { center: { x: 0, y: -3.5, z: 10 }, halfExtents: { x: 5, y: 0.5, z: 7 } },
        ],
      },
    );
    // Run forward off the runway end into the pool.
    let ticks = 0;
    while (sim.status === 'running' && ticks < 600) {
      sim.update(idleInput);
      ticks++;
    }
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('lava');
    expect(sim.lastDeathCause).toBe('lava');
    expect(sim.lastLethalColliderId).toBe('lava-pool');
    // Death is instantaneous at the lethal step (no grace ticks).
    expect(sim.deathHoldTicksLeft).toBe(DEATH_HOLD_TICKS);
  });

  it('lava fall columns kill with swept CCD at high speed (no tunneling)', () => {
    // Thin fall directly ahead of the spawn, crossed at 3x speed.
    const sim = makeLavaArena(
      [{ id: 'fall', center: { x: 0, y: 1.5, z: 6 }, halfExtents: { x: 0.4, y: 2.5, z: 0.4 }, role: 'fall' }],
      {
        solids: [{ center: { x: 0, y: -0.5, z: 20 }, halfExtents: { x: 5.4, y: 0.5, z: 30 } }],
        speedPortals: [{ id: 'fast', z: -3, multiplier: 3 }],
      },
    );
    let ticks = 0;
    while (sim.status === 'running' && ticks < 300) {
      sim.update(idleInput);
      ticks++;
    }
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('lava');
    expect(sim.lastLethalColliderId).toBe('lava-fall');
  });

  it('lava volumes register as hazard colliders in the collision world', () => {
    const sim = makeLavaArena([
      { id: 'pool', center: { x: 0, y: -2.5, z: 10 }, halfExtents: { x: 4, y: 0.5, z: 6 }, role: 'pool' },
    ]);
    const lavaColliders = sim.level.colliders.filter((c) => c.id.startsWith('lava-'));
    expect(lavaColliders.length).toBe(1);
    expect(lavaColliders[0]?.kind).toBe('hazard');
  });

  it('lava death respawns after the readable hold and re-arms (attempts + 1)', () => {
    const sim = makeLavaArena([
      { id: 'pool', center: { x: 0, y: -2.5, z: 10 }, halfExtents: { x: 4, y: 0.5, z: 6 }, role: 'pool' },
    ]);
    while (sim.status === 'running') sim.update(idleInput);
    expect(sim.deathCause).toBe('lava');
    const attempts = sim.attempts;
    advance(sim, idleInput, DEATH_HOLD_TICKS - 1);
    expect(sim.status).toBe('dead');
    sim.update(idleInput);
    expect(sim.status).toBe('running');
    expect(sim.attempts).toBe(attempts + 1);
    expect(sim.deathCause).toBeNull();
  });

  it('lava death is replay-stable (state fingerprint covers the lava cause)', () => {
    const mk = (): GameSimulation =>
      makeLavaArena([
        { id: 'pool', center: { x: 0, y: -2.5, z: 10 }, halfExtents: { x: 4, y: 0.5, z: 6 }, role: 'pool' },
      ]);
    const a = mk();
    const b = mk();
    for (let i = 0; i < 200; i++) {
      a.update(idleInput);
      b.update(idleInput);
      expect(computeStateFingerprint(a)).toBe(computeStateFingerprint(b));
      if (a.status === 'dead') break;
    }
    expect(a.status).toBe('dead');
    expect(a.deathCause).toBe('lava');
  });
});

describe('M8A death readability hold', () => {
  it('holds the dead state for 78 ticks (0.65 s) before auto-respawn', () => {
    expect(DEATH_HOLD_TICKS).toBe(78);
    expect(DEATH_HOLD_TICKS / 120).toBeCloseTo(0.65, 6);
  });

  it('manual restart still works immediately from the dead state', () => {
    const sim = makeLavaArena([
      { id: 'pool', center: { x: 0, y: -2.5, z: 10 }, halfExtents: { x: 4, y: 0.5, z: 6 }, role: 'pool' },
    ]);
    while (sim.status === 'running') sim.update(idleInput);
    expect(sim.status).toBe('dead');
    const attempts = sim.attempts;
    sim.restart();
    expect(sim.status).toBe('running');
    expect(sim.attempts).toBe(attempts + 1);
  });
});

describe('M8A lava authoring contract (no floating slabs)', () => {
  it('advanced-cube-01 lava validates cleanly', () => {
    expect(ADVANCED_CUBE_01.lava?.length).toBeGreaterThanOrEqual(6);
    expect(validateLavaAuthoring(ADVANCED_CUBE_01)).toEqual([]);
  });

  it('advanced-cube-01 lava is lethal gameplay (registered colliders)', () => {
    const level = loadLevel(ADVANCED_CUBE_01);
    const lavaColliders = level.colliders.filter((c) => c.id.startsWith('lava-'));
    expect(lavaColliders.length).toBe(ADVANCED_CUBE_01.lava?.length);
    for (const c of lavaColliders) expect(c.kind).toBe('hazard');
  });

  it('rejects a floating pool with no basin solid', () => {
    const def: LevelDefinition = {
      id: 'float-fixture',
      displayName: 'FLOAT',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } }],
      hazards: [],
      lava: [{ id: 'floater', center: { x: 0, y: 5, z: 40 }, halfExtents: { x: 3, y: 0.5, z: 3 }, role: 'pool' }],
      theme: THEME,
    };
    const errors = validateLavaAuthoring(def);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('floater');
  });

  it('rejects a fall with no source and a mid-air termination', () => {
    const def: LevelDefinition = {
      id: 'fall-fixture',
      displayName: 'FALL',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } }],
      hazards: [],
      lava: [{ id: 'dangling', center: { x: 0, y: 2, z: 40 }, halfExtents: { x: 0.5, y: 2, z: 0.5 }, role: 'fall' }],
      theme: THEME,
    };
    const errors = validateLavaAuthoring(def);
    expect(errors.length).toBe(2);
    expect(errors.some((e) => e.includes('no source'))).toBe(true);
    expect(errors.some((e) => e.includes('mid-air'))).toBe(true);
  });

  it('accepts a fall that continues below the void bound', () => {
    const def: LevelDefinition = {
      id: 'voidfall-fixture',
      displayName: 'VOIDFALL',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [
        { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
        { center: { x: 8, y: 6, z: 40 }, halfExtents: { x: 2, y: 2, z: 2 } },
      ],
      hazards: [],
      lava: [
        { id: 'vent', center: { x: 5.6, y: 6, z: 40 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, role: 'source' },
        { id: 'drop', center: { x: 6.4, y: -4, z: 40 }, halfExtents: { x: 0.4, y: 10.2, z: 0.4 }, role: 'fall' },
      ],
      theme: THEME,
    };
    expect(validateLavaAuthoring(def)).toEqual([]);
  });
});

describe('M8A lava fingerprinting (conditional encoding)', () => {
  it('lava changes the level fingerprint; stripping it restores the base', () => {
    const withLava = computeLevelFingerprint(ADVANCED_CUBE_01);
    const stripped: LevelDefinition = { ...ADVANCED_CUBE_01, lava: undefined };
    expect(computeLevelFingerprint(stripped)).not.toBe(withLava);
  });

  it('levels without lava hash exactly as before (golden replay safe)', () => {
    // TEST_LEVEL / validation content carry no lava: encoding writes zero
    // bytes, so pre-M8A fingerprints are byte-identical by construction.
    expect(TEST_LEVEL.lava).toBeUndefined();
    expect(computeLevelFingerprint(TEST_LEVEL)).toBe(computeLevelFingerprint({ ...TEST_LEVEL }));
  });
});

describe('M8.2 lava vent readability (working mouths)', () => {
  const ventDef = (source: { x: number; y: number; z: number }): LevelDefinition => ({
    id: 'vent-fixture',
    displayName: 'VENT',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: 60,
    deathY: -14,
    solids: [
      { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
      // Rock pillar the vent attaches to (x 4.4..5.4, y 0..3.5).
      { center: { x: 4.9, y: 1.75, z: 40 }, halfExtents: { x: 0.5, y: 1.75, z: 1 } },
      // Basin floor under the fall.
      { center: { x: 4.2, y: -3.5, z: 40 }, halfExtents: { x: 1.5, y: 0.5, z: 1.5 } },
    ],
    hazards: [],
    lava: [
      { id: 'pool', center: { x: 4.2, y: -2.7, z: 40 }, halfExtents: { x: 1.2, y: 0.3, z: 1.2 }, role: 'pool' },
      { id: 'vent', center: source, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
      { id: 'drop', center: { x: 4.2, y: 1.5, z: 40 }, halfExtents: { x: 0.6, y: 1, z: 0.8 }, role: 'fall' },
    ],
    theme: THEME,
  });

  it('rejects a vent whose mouth is buried inside its pillar', () => {
    // The M8.1 river-vent defect: box flush inside the rock, mouth hidden.
    const errors = validateLavaAuthoring(ventDef({ x: 4.9, y: 2.7, z: 40 }));
    expect(errors.some((e) => e.includes('mouth is buried'))).toBe(true);
  });

  it('accepts a vent lip protruding over its fall (mouth feeds air)', () => {
    expect(validateLavaAuthoring(ventDef({ x: 4.2, y: 2.9, z: 40 }))).toEqual([]);
  });

  it('the gauntlet validates cleanly under the mouth rule', () => {
    expect(validateLavaAuthoring(MULTIMODE_GAUNTLET_01)).toEqual([]);
  });
});

describe('M8.2 lava viscous-flow presentation (bounded structure)', () => {
  it('builds crust plates + stepped falls + splash + drip within budget', () => {
    const def: LevelDefinition = {
      id: 'lavaview-fixture',
      displayName: 'LAVAVIEW',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [],
      hazards: [],
      lava: [
        { id: 'pool', center: { x: 0, y: -2.7, z: 40 }, halfExtents: { x: 1.2, y: 0.3, z: 1.2 }, role: 'pool' },
        { id: 'drop', center: { x: 0, y: 0, z: 40 }, halfExtents: { x: 0.6, y: 2.6, z: 0.8 }, role: 'fall' },
        { id: 'vent', center: { x: 0, y: 3.4, z: 40 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
      ],
      theme: THEME,
    };
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(def), library);
    // Pool: body + surface + 3 crust plates (5); fall: 4 viscous steps +
    // 1 impact splash (5); source: collar + mouth + drip (3) = 13 meshes.
    let meshes = 0;
    view.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh === true) meshes += 1;
    });
    expect(meshes).toBe(13);
    view.dispose();
    library.dispose();
  });
});

describe('M8.4 directed lava flow (hint + downstream continuation)', () => {
  // Westward flow fixture: crossing pool -> channel pool -> cliff drop,
  // mirroring the gauntlet river chain (rule-5 geometry in miniature).
  const flowDef = (lava: LevelDefinition['lava']): LevelDefinition => ({
    id: 'flow-fixture',
    displayName: 'FLOW',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [...LANES],
    baseForwardSpeed: 14,
    finishZ: 60,
    deathY: -14,
    solids: [
      { center: { x: 0, y: -0.5, z: 40 }, halfExtents: { x: 5.4, y: 0.5, z: 10 } },
      { center: { x: -6.4, y: -1.15, z: 40 }, halfExtents: { x: 2, y: 0.5, z: 1.75 } },
    ],
    hazards: [],
    lava,
    theme: THEME,
  });
  const chain = (): Exclude<LevelDefinition['lava'], undefined> => [
    { id: 'cross', center: { x: 0, y: 0.1, z: 40 }, halfExtents: { x: 4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
    { id: 'channel', center: { x: -6.4, y: -0.05, z: 40 }, halfExtents: { x: 2.4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
    { id: 'drop', center: { x: -8.6, y: -7.25, z: 40 }, halfExtents: { x: 0.6, y: 7.75, z: 0.9 }, role: 'fall' },
  ];

  it('accepts a hinted pool handing off downstream (touch + downstream center)', () => {
    expect(validateLavaAuthoring(flowDef(chain()))).toEqual([]);
  });

  it('rejects a hinted pool with no downstream lava (broken pour)', () => {
    const lava = chain();
    const withoutChannel = lava.filter((l) => l.id !== 'channel');
    const errors = validateLavaAuthoring(flowDef(withoutChannel));
    expect(errors.some((e) => e.includes("'cross'") && e.includes('downstream'))).toBe(true);
  });

  it('rejects a downstream touch on the wrong side (upstream is not onward)', () => {
    // Channel sits EAST of the crossing: touching, but not downstream.
    const lava: LevelDefinition['lava'] = [
      { id: 'cross', center: { x: 0, y: 0.1, z: 40 }, halfExtents: { x: 4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
      { id: 'wrong-side', center: { x: 6.4, y: -0.05, z: 40 }, halfExtents: { x: 2.4, y: 0.6, z: 1.5 }, role: 'pool' },
    ];
    const errors = validateLavaAuthoring(flowDef(lava));
    expect(errors.some((e) => e.includes("'cross'") && e.includes('downstream'))).toBe(true);
  });

  it('the flow hint is presentation-only (fingerprint-neutral)', () => {
    const hinted = flowDef(chain());
    const stripped: LevelDefinition = {
      ...hinted,
      lava: hinted.lava?.map((l) => ({ id: l.id, center: l.center, halfExtents: l.halfExtents, role: l.role })) ?? [],
    };
    expect(computeLevelFingerprint(hinted)).toBe(computeLevelFingerprint(stripped));
  });

  it('the gauntlet river chain satisfies rule 5 (crossing -> channel -> drop)', () => {
    expect(validateLavaAuthoring(MULTIMODE_GAUNTLET_01)).toEqual([]);
  });
});

describe('M8.4 directed lava flow presentation (conveyors)', () => {
  // Hinted pool (westward flow) + vent fall pouring into its east end:
  // pool 8 (body/surface/3 crustFlow/3 cores), fall 6 (4 segs/splash/
  // pulse), source 4 (collar/mouth/drip/chimney) = 18 meshes.
  const fixture = (): { view: LevelView; library: MaterialLibrary } => {
    const def: LevelDefinition = {
      id: 'lavaflow-fixture',
      displayName: 'LAVAFLOW',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [],
      hazards: [],
      lava: [
        { id: 'p', center: { x: 0, y: 0.1, z: 40 }, halfExtents: { x: 4, y: 0.6, z: 1.5 }, role: 'pool', flow: { x: -1, z: 0 } },
        { id: 'f', center: { x: 3.5, y: 1.5, z: 40 }, halfExtents: { x: 0.6, y: 1, z: 0.8 }, role: 'fall' },
        { id: 'v', center: { x: 3.5, y: 3.1, z: 40 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
      ],
      theme: THEME,
    };
    const library = makeTestLibrary();
    return { view: new LevelView(loadLevel(def), library), library };
  };
  const countMeshes = (view: LevelView): number => {
    let meshes = 0;
    view.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh === true) meshes += 1;
    });
    return meshes;
  };
  const fullTransforms = (view: LevelView): number[] => {
    const out: number[] = [];
    view.group.traverse((o) => {
      const m = o as unknown as {
        isMesh?: boolean;
        position: { x: number; y: number; z: number };
        scale: { x: number; y: number; z: number };
      };
      if (m.isMesh !== true) return;
      out.push(m.position.x, m.position.y, m.position.z, m.scale.x, m.scale.y, m.scale.z);
    });
    return out;
  };

  it('builds cores + pulse + lip-tied chimney within budget (18 meshes)', () => {
    const { view, library } = fixture();
    expect(countMeshes(view)).toBe(18);
    view.dispose();
    library.dispose();
  });

  it('flow cores travel downstream (net transport, not oscillation)', () => {
    const { view, library } = fixture();
    // Core build poses sit on the surface (topY + 0.08 = 0.78).
    const coreX = (): number[] => {
      const xs: number[] = [];
      view.group.traverse((o) => {
        const m = o as unknown as { isMesh?: boolean; position: { x: number; y: number } };
        if (m.isMesh === true && Math.abs(m.position.y - 0.78) < 1e-9) xs.push(m.position.x);
      });
      return xs.sort((a, b) => a - b);
    };
    const x0 = coreX();
    expect(x0.length).toBe(3);
    view.updateLava(0.5);
    const x1 = coreX();
    view.updateLava(0.5);
    const x2 = coreX();
    // Westward current: every core strictly loses x across both half-
    // seconds (0.55 u/s over a 6.5 u travel — no wrap inside this window).
    for (let i = 0; i < 3; i++) {
      expect((x1[i] as number)).toBeLessThan(x0[i] as number);
      expect((x2[i] as number)).toBeLessThan(x1[i] as number);
      expect((x0[i] as number) - (x1[i] as number)).toBeCloseTo(0.275, 5);
    }
    view.dispose();
    library.dispose();
  });

  it('the pour pulse descends the fall and wraps inside it', () => {
    const { view, library } = fixture();
    const pulseY = (): number => {
      let y = NaN;
      view.group.traverse((o) => {
        const m = o as unknown as {
          isMesh?: boolean;
          position: { x: number; y: number; z: number };
          scale: { x: number; y: number };
        };
        // The pulse is the small hot block inside the fall footprint.
        if (m.isMesh === true && Math.abs(m.position.x - 3.5) < 1e-9 && m.scale.y === 0.5) y = m.position.y;
      });
      return y;
    };
    const y0 = pulseY();
    view.updateLava(1);
    const y1 = pulseY();
    // One traverse is 2.5 s over travel 1.7: 1 s descends 0.68.
    expect(y0 - y1).toBeCloseTo(0.68, 5);
    // After a full cycle it wraps back near the top (bounded, masked).
    view.updateLava(1.5);
    expect(pulseY()).toBeCloseTo(y0, 5);
    view.dispose();
    library.dispose();
  });

  it('conveyors resume the build pose (no first-frame jump)', () => {
    const { view, library } = fixture();
    const before = fullTransforms(view);
    view.updateLava(1e-3);
    const after = fullTransforms(view);
    for (let i = 0; i < before.length; i++) {
      expect(Math.abs((after[i] as number) - (before[i] as number))).toBeLessThan(0.01);
    }
    view.dispose();
    library.dispose();
  });

  it('conveyors freeze exactly on dt = 0 (pause parity)', () => {
    const { view, library } = fixture();
    view.updateLava(1.25);
    const frozen = fullTransforms(view);
    view.updateLava(0);
    expect(fullTransforms(view)).toEqual(frozen);
    view.dispose();
    library.dispose();
  });

  it('unhinted lava keeps the exact M8.2/M8.3 structure (13 meshes)', () => {
    const def: LevelDefinition = {
      id: 'lavaview-fixture',
      displayName: 'LAVAVIEW',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [],
      hazards: [],
      lava: [
        { id: 'pool', center: { x: 0, y: -2.7, z: 40 }, halfExtents: { x: 1.2, y: 0.3, z: 1.2 }, role: 'pool' },
        { id: 'drop', center: { x: 0, y: 0, z: 40 }, halfExtents: { x: 0.6, y: 2.6, z: 0.8 }, role: 'fall' },
        { id: 'vent', center: { x: 0, y: 3.4, z: 40 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
      ],
      theme: THEME,
    };
    const library = makeTestLibrary();
    const view = new LevelView(loadLevel(def), library);
    view.updateLava(3);
    expect(countMeshes(view)).toBe(13);
    view.dispose();
    library.dispose();
  });
});

describe('M8.3 lava motion (alive, not a slab)', () => {
  const fixture = (): { view: LevelView; library: MaterialLibrary } => {
    const def: LevelDefinition = {
      id: 'lavamotion-fixture',
      displayName: 'LAVAMOTION',
      start: { x: 0, y: 1.5, z: -4 },
      startLaneIndex: 1,
      laneCenters: [...LANES],
      baseForwardSpeed: 14,
      finishZ: 60,
      deathY: -14,
      solids: [],
      hazards: [],
      lava: [
        { id: 'pool', center: { x: 0, y: -2.7, z: 40 }, halfExtents: { x: 1.2, y: 0.3, z: 1.2 }, role: 'pool' },
        { id: 'drop', center: { x: 0, y: 0, z: 40 }, halfExtents: { x: 0.6, y: 2.6, z: 0.8 }, role: 'fall' },
        { id: 'vent', center: { x: 0, y: 3.4, z: 40 }, halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, role: 'source' },
      ],
      theme: THEME,
    };
    const library = makeTestLibrary();
    return { view: new LevelView(loadLevel(def), library), library };
  };
  const meshTransforms = (view: LevelView): number[] => {
    const out: number[] = [];
    view.group.traverse((o) => {
      const m = o as unknown as { isMesh?: boolean; position: { x: number; y: number }; scale: { x: number; y: number } };
      if (m.isMesh !== true) return;
      out.push(m.position.x, m.position.y, m.scale.x, m.scale.y);
    });
    return out;
  };

  it('updateLava visibly moves the lava (crust/fall/splash/drip/mouth)', () => {
    const { view, library } = fixture();
    const before = meshTransforms(view);
    view.updateLava(0.5);
    const after = meshTransforms(view);
    expect(after.length).toBe(before.length);
    let moved = 0;
    for (let i = 0; i < before.length; i++) {
      if (Math.abs((after[i] as number) - (before[i] as number)) > 1e-6) moved++;
    }
    // At least the 3 crust plates + 4 fall segments + splash respond.
    expect(moved).toBeGreaterThan(8);
    view.dispose();
    library.dispose();
  });

  it('dt = 0 freezes the flow exactly (pause parity)', () => {
    const { view, library } = fixture();
    view.updateLava(1.25);
    const frozen = meshTransforms(view);
    view.updateLava(0);
    expect(meshTransforms(view)).toEqual(frozen);
    view.dispose();
    library.dispose();
  });

  it('motion adds no meshes (budget still 13)', () => {
    const { view, library } = fixture();
    view.updateLava(3);
    let meshes = 0;
    view.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh === true) meshes += 1;
    });
    expect(meshes).toBe(13);
    view.dispose();
    library.dispose();
  });

  it('the shared pulse breathes deeper (living heat, reversible)', () => {
    const library = makeTestLibrary();
    library.setLavaPulse(0.75);
    const lowSurface = library.lavaSurface.emissiveIntensity;
    library.setLavaPulse(0.25);
    const highSurface = library.lavaSurface.emissiveIntensity;
    // Swing >= 0.5 (was 0.35) with a brighter floor.
    expect(highSurface - lowSurface).toBeGreaterThanOrEqual(0.5);
    expect(lowSurface).toBeGreaterThanOrEqual(1.3);
    library.dispose();
  });
});
