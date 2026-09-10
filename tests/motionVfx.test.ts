import { describe, expect, it } from 'vitest';
import { VfxSystem } from '../src/rendering/VfxSystem';
import {
  PRODUCTION_THEME,
  validateProductionTheme,
} from '../src/visuals/productionTheme';
import { GameSimulation, type InteractionKind, type SimulationStatus } from '../src/game/GameSimulation';
import { VALIDATION_LEVEL_02 } from '../src/content/levels/validationLevel02';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { makeIdlePhysicalSnapshot } from '../src/input/InputSystem';
import { validateReplayObject, type ReplayV1 } from '../src/replay/replayFormat';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { makeTestLibrary } from './helpers/visuals';
import fixtureRaw from './fixtures/replays/validation-level-02-v1.json?raw';

/**
 * M6B motion-juice tests: the VfxSystem presentation layer.
 *
 * Structural only (never pixel-perfect): bounded pools, exact-once emission
 * per real sim edge, reset lifecycle (restart/respawn/replay/teleport),
 * ?fx=off independence, theme/fingerprint decoupling, no VFX in the sim
 * domain, golden-replay recreation of effects headlessly, idempotent
 * dispose. The sim is never modified to satisfy these tests.
 */

interface MutableVec {
  x: number;
  y: number;
  z: number;
}

interface MutableSimView {
  status: SimulationStatus;
  attempts: number;
  deathId: number;
  player: { position: MutableVec; velocity: MutableVec; grounded: boolean };
  gameplayFrame: { surfaceNormal: MutableVec; gravityVector: MutableVec };
  speedMultiplier: number;
  portalTransitionCount: number;
  speedPortalCount: number;
  interactionEventCount: number;
  lastInteraction: { kind: InteractionKind; x: number; y: number; z: number };
  teleportEventCount: number;
  lastTeleport: MutableVec;
}

const FLOOR_FRAME = (): MutableSimView['gameplayFrame'] => ({
  surfaceNormal: { x: 0, y: 1, z: 0 },
  gravityVector: { x: 0, y: -1, z: 0 },
});

const makeSimView = (): MutableSimView => ({
  status: 'running',
  attempts: 1,
  deathId: 0,
  player: {
    position: { x: 0, y: 0.55, z: 10 },
    velocity: { x: 0, y: 0, z: 14 },
    grounded: true,
  },
  gameplayFrame: FLOOR_FRAME(),
  speedMultiplier: 1,
  portalTransitionCount: 0,
  speedPortalCount: 0,
  interactionEventCount: 0,
  lastInteraction: { kind: 'pad', x: 0, y: 0, z: 0 },
  teleportEventCount: 0,
  lastTeleport: { x: 0, y: 0, z: 0 },
});

const DT = 1 / 60;

/** Run N frames with optional per-frame mutation (render-time evolution). */
const runFrames = (
  vfx: VfxSystem,
  sim: MutableSimView,
  frames: number,
  mutate?: (frame: number) => void,
): void => {
  for (let i = 0; i < frames; i++) {
    mutate?.(i);
    // The trail follows forward motion like the real rendered cube.
    sim.player.position.z += sim.player.velocity.z * DT;
    vfx.update(DT, sim, sim.player.position);
  }
};

describe('VfxSystem pools are bounded', () => {
  it('burst pool never exceeds capacity under event spam', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    for (let i = 0; i < 50; i++) {
      vfx.notifyJump();
      sim.portalTransitionCount += 1;
      sim.speedPortalCount += 1;
      sim.interactionEventCount += 1;
      sim.lastInteraction = { kind: 'pad', x: 0, y: 0.5, z: sim.player.position.z };
      vfx.update(DT, sim, sim.player.position);
    }
    expect(vfx.activeParticles).toBeLessThanOrEqual(vfx.burstCapacity);
    vfx.dispose();
  });

  it('trail stays bounded over a long run and scales with speed', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    runFrames(vfx, sim, 3600); // 60 s of render time at 1x
    const at1x = vfx.trailSamples;
    expect(at1x).toBeGreaterThan(0);
    expect(at1x).toBeLessThanOrEqual(vfx.trailCapacity);
    sim.speedMultiplier = 2;
    runFrames(vfx, sim, 600);
    const at2x = vfx.trailSamples;
    expect(at2x).toBeLessThanOrEqual(vfx.trailCapacity);
    expect(at2x).toBeGreaterThanOrEqual(at1x);
    vfx.dispose();
  });

  it('streak instances stay bounded and rise with the speed tier', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.activeStreaks).toBe(0); // nearly absent at 1x
    sim.speedMultiplier = 2;
    sim.speedPortalCount += 1;
    for (let i = 0; i < 10; i++) vfx.update(DT, sim, sim.player.position);
    const at2x = vfx.activeStreaks;
    expect(at2x).toBeGreaterThan(0);
    expect(at2x).toBeLessThanOrEqual(24);
    sim.speedMultiplier = 4;
    for (let i = 0; i < 10; i++) vfx.update(DT, sim, sim.player.position);
    expect(vfx.activeStreaks).toBeGreaterThanOrEqual(at2x);
    vfx.dispose();
  });
});

describe('VfxSystem emits exactly once per real sim edge', () => {
  it('one jump signal = one jump burst (no repeats, no polling synthesis)', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.jump).toBe(0);
    vfx.notifyJump();
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.jump).toBe(1);
    vfx.update(DT, sim, sim.player.position);
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.jump).toBe(1);
    vfx.dispose();
  });

  it('grounded->airborne->grounded emits exactly one landing burst', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    sim.player.grounded = false;
    sim.player.velocity.y = 13.2;
    runFrames(vfx, sim, 20);
    expect(vfx.countersSnapshot.landing).toBe(0);
    sim.player.grounded = true;
    sim.player.velocity.y = -8;
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.landing).toBe(1);
    runFrames(vfx, sim, 30); // stays grounded: no more landings
    expect(vfx.countersSnapshot.landing).toBe(1);
    vfx.dispose();
  });

  it('landing intensity scales with impact but stays capped', () => {
    const soft = new VfxSystem({ ...PRODUCTION_THEME });
    const softSim = makeSimView();
    soft.update(DT, softSim, softSim.player.position);
    softSim.player.grounded = false;
    softSim.player.velocity.y = -2;
    runFrames(soft, softSim, 5);
    softSim.player.grounded = true;
    soft.update(DT, softSim, softSim.player.position);
    const softIntensity = soft.lastLandingIntensityValue;

    const hard = new VfxSystem({ ...PRODUCTION_THEME });
    const hardSim = makeSimView();
    hard.update(DT, hardSim, hardSim.player.position);
    hardSim.player.grounded = false;
    hardSim.player.velocity.y = -40; // terminal-class fast fall
    runFrames(hard, hardSim, 5);
    hardSim.player.grounded = true;
    hard.update(DT, hardSim, hardSim.player.position);
    const hardIntensity = hard.lastLandingIntensityValue;

    expect(hardIntensity).toBeGreaterThan(softIntensity);
    expect(hardIntensity).toBeLessThanOrEqual(1);
    expect(softIntensity).toBeGreaterThanOrEqual(0.25);
    soft.dispose();
    hard.dispose();
  });

  it('one gravity transition = one flip pulse', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    sim.portalTransitionCount += 1;
    sim.gameplayFrame = {
      surfaceNormal: { x: 0, y: -1, z: 0 },
      gravityVector: { x: 0, y: 1, z: 0 },
    };
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.gravity).toBe(1);
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.gravity).toBe(1);
    vfx.dispose();
  });

  it('one speed portal = one tier pulse (dedupes the same-frame interaction event)', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    sim.speedMultiplier = 2;
    sim.speedPortalCount += 1;
    sim.interactionEventCount += 1; // the sim registers both edges same step
    sim.lastInteraction = { kind: 'speedPortal', x: 0, y: 1, z: 372 };
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.speed).toBe(1);
    vfx.dispose();
  });

  it('pad and jump-orb activations emit their semantic bursts', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    sim.interactionEventCount += 1;
    sim.lastInteraction = { kind: 'pad', x: 0, y: 0.5, z: 305 };
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.pad).toBe(1);
    sim.interactionEventCount += 1;
    sim.lastInteraction = { kind: 'jumpOrb', x: 0, y: 2.5, z: 337 };
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.jumpOrb).toBe(1);
    vfx.dispose();
  });

  it('gravity-orb flip emits the flip pulse once (no double burst)', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    sim.portalTransitionCount += 1; // shared transition path fires too
    sim.interactionEventCount += 1;
    sim.lastInteraction = { kind: 'gravityOrb', x: 0, y: 2, z: 350 };
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.gravity).toBe(1);
    expect(vfx.countersSnapshot.gravityOrb).toBe(0);
    vfx.dispose();
  });

  it('a used orb (no new sim event) emits nothing', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    runFrames(vfx, sim, 60); // no events: only trail accumulates
    expect(vfx.countersSnapshot).toEqual({
      jump: 0, landing: 0, gravity: 0, speed: 0, pad: 0, jumpOrb: 0, gravityOrb: 0, teleport: 0,
    });
    expect(vfx.activeParticles).toBe(0); // trail is not in the burst pool
    expect(vfx.trailSamples).toBeGreaterThan(0);
    vfx.dispose();
  });

  it('jump/landing bursts work surface-relatively on Ceiling', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    sim.gameplayFrame = {
      surfaceNormal: { x: 0, y: -1, z: 0 },
      gravityVector: { x: 0, y: 1, z: 0 },
    };
    vfx.update(DT, sim, sim.player.position);
    vfx.notifyJump();
    vfx.update(DT, sim, sim.player.position);
    sim.player.grounded = false;
    sim.player.velocity.y = -13.2;
    runFrames(vfx, sim, 20);
    sim.player.grounded = true;
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.jump).toBe(1);
    expect(vfx.countersSnapshot.landing).toBe(1);
    vfx.dispose();
  });
});

describe('VfxSystem reset lifecycle', () => {
  it('reset counter tracks every clear path (attempt/death/teleport/disable)', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.resetCountValue).toBe(1); // initial edge-sync clears once
    sim.attempts += 1;
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.resetCountValue).toBe(2);
    sim.status = 'dead';
    sim.deathId += 1;
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.resetCountValue).toBe(3);
    sim.attempts += 1;
    sim.status = 'running';
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.resetCountValue).toBe(4);
    sim.player.position = { x: 0, y: 1.5, z: 300 };
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.resetCountValue).toBe(5);
    vfx.setEnabled(false);
    expect(vfx.resetCountValue).toBe(6);
    vfx.dispose();
  });
  it('restart (attempts edge) clears trail history', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    runFrames(vfx, sim, 120);
    expect(vfx.trailSamples).toBeGreaterThan(10);
    sim.attempts += 1; // R / respawn / replay start all respawn the sim
    sim.player.position = { x: 0, y: 0.55, z: 0 };
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.trailSamples).toBe(0);
    vfx.dispose();
  });

  it('death clears the trail and streaks; respawn clears transient particles', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    sim.speedMultiplier = 2;
    runFrames(vfx, sim, 120);
    vfx.notifyJump();
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.trailSamples).toBeGreaterThan(0);
    expect(vfx.activeParticles).toBeGreaterThan(0);
    expect(vfx.activeStreaks).toBeGreaterThan(0);
    sim.status = 'dead';
    sim.deathId += 1;
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.trailSamples).toBe(0);
    expect(vfx.activeStreaks).toBe(0);
    sim.attempts += 1; // respawn
    sim.status = 'running';
    sim.player.position = { x: 0, y: 0.55, z: 0 };
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.activeParticles).toBe(0);
    expect(vfx.trailSamples).toBe(0);
    vfx.dispose();
  });

  it('teleport clears transients (no respawn-to-death trail line)', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    runFrames(vfx, sim, 120);
    expect(vfx.trailSamples).toBeGreaterThan(10);
    sim.player.position = { x: 0, y: 1.5, z: 300 }; // debug teleport
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.trailSamples).toBe(0);
    vfx.dispose();
  });

  it('replay start clears stale VFX through the sim respawn edge', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    runFrames(vfx, sim, 120);
    vfx.notifyJump();
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.trailSamples + vfx.activeParticles).toBeGreaterThan(0);
    // ReplayCoordinator.startReplay() respawns the sim: attempts edge fires.
    sim.attempts += 1;
    sim.player.position = { x: 0, y: 0.55, z: 0 };
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.trailSamples).toBe(0);
    expect(vfx.activeParticles).toBe(0);
    vfx.dispose();
  });
});

describe('VfxSystem independence (?fx=off)', () => {
  it('disabled FX emits nothing but leaves the sim view untouched', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.setEnabled(false);
    expect(vfx.isEnabled).toBe(false);
    for (let i = 0; i < 120; i++) {
      vfx.notifyJump();
      sim.portalTransitionCount += 1;
      sim.player.position.z += sim.player.velocity.z * DT;
      vfx.update(DT, sim, sim.player.position);
    }
    expect(vfx.trailSamples).toBe(0);
    expect(vfx.activeParticles).toBe(0);
    expect(vfx.activeStreaks).toBe(0);
    expect(vfx.countersSnapshot).toEqual({
      jump: 0, landing: 0, gravity: 0, speed: 0, pad: 0, jumpOrb: 0, gravityOrb: 0, teleport: 0,
    });
    // Gameplay state flowed through untouched (positions kept advancing).
    expect(sim.player.position.z).toBeGreaterThan(30);
    // Re-enable resumes cleanly (no stale flood, no stuck state).
    vfx.setEnabled(true);
    runFrames(vfx, sim, 30);
    expect(vfx.trailSamples).toBeGreaterThan(0);
    vfx.dispose();
  });
});

describe('VfxSystem resources', () => {
  it('no event increases shared material/geometry counts', () => {
    const library = makeTestLibrary();
    const matsBefore = library.materialCount;
    const geosBefore = library.geometryCount;
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    for (let i = 0; i < 30; i++) {
      vfx.notifyJump();
      sim.portalTransitionCount += 1;
      sim.speedPortalCount += 1;
      sim.interactionEventCount += 1;
      sim.lastInteraction = { kind: 'pad', x: 0, y: 0.5, z: sim.player.position.z };
      sim.player.position.z += sim.player.velocity.z * DT;
      vfx.update(DT, sim, sim.player.position);
    }
    expect(library.materialCount).toBe(matsBefore);
    expect(library.geometryCount).toBe(geosBefore);
    vfx.dispose();
    expect(library.materialCount).toBe(matsBefore);
    library.dispose();
  });

  it('dispose is idempotent and releases the group', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    runFrames(vfx, sim, 30);
    expect(vfx.group.children.length).toBe(3); // trail + bursts + streaks
    vfx.dispose();
    expect(vfx.group.children.length).toBe(0);
    expect(() => {
      vfx.dispose();
    }).not.toThrow();
  });
});

describe('VfxSystem config stays presentation-only', () => {
  it('fx config validation clamps pools and never touches fingerprints', () => {
    const before = computeLevelFingerprint(TEST_LEVEL);
    const wild = validateProductionTheme({
      fx: {
        ...PRODUCTION_THEME.fx,
        trailMax: 10000,
        burstMax: -5,
        streakMax: 500,
        trailLifetime1x: 99,
      },
    });
    expect(wild.fx.trailMax).toBeLessThanOrEqual(128);
    expect(wild.fx.burstMax).toBeGreaterThanOrEqual(64);
    expect(wild.fx.streakMax).toBeLessThanOrEqual(32);
    expect(wild.fx.trailLifetime1x).toBeLessThanOrEqual(1.2);
    // The shared default object is not mutated by validation.
    expect(PRODUCTION_THEME.fx.trailMax).toBe(96);
    expect(computeLevelFingerprint(TEST_LEVEL)).toBe(before);
  });
});

describe('simulation stays VFX-free (architecture boundary)', () => {
  // Raw source text of the simulation entry (same ?raw glob technique as
  // tests/visualFoundation.test.ts — no node:fs imports in tests).
  const simEntry = import.meta.glob('../src/game/GameSimulation.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  });
  it('GameSimulation imports no rendering, visuals, or VFX code', () => {
    const src = simEntry['../src/game/GameSimulation.ts'];
    expect(typeof src).toBe('string');
    if (typeof src !== 'string') return;
    expect(src).not.toContain('VfxSystem');
    expect(src).not.toContain('../rendering/');
    expect(src).not.toContain('../visuals/');
    expect(src).not.toContain("from 'three'");
  });
});

interface GoldenFixtureFile {
  _provenance: { levelId: string; frameCount: number };
  replay: ReplayV1;
}

describe('golden replay recreates VFX naturally (headless integration)', () => {
  it('the committed tape still verifies while VFX observes every tick', () => {
    const file = JSON.parse(fixtureRaw) as GoldenFixtureFile;
    const validated = validateReplayObject(file.replay);
    if (!validated.ok) throw new Error(`golden replay invalid: ${validated.reason}`);
    const replay = validated.replay;
    expect(replay.frameCount).toBe(2346);

    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = new GameSimulation(VALIDATION_LEVEL_02, {
      // The REAL onJump seam (same bridge Game wires to notifyJump).
      onJump: () => {
        vfx.notifyJump();
      },
    });
    const coordinator = new ReplayCoordinator(sim);
    const start = coordinator.startReplay(replay);
    expect(start.ok).toBe(true);
    let tick = 0;
    while (coordinator.isPlaying && tick < 60000) {
      coordinator.beforeSimTick();
      const input = coordinator.getInputForTick(makeIdlePhysicalSnapshot());
      sim.update(input);
      coordinator.afterSimTick();
      // Presentation observes the replayed sim exactly like live play.
      vfx.update(DT, sim, sim.player.position);
      expect(vfx.trailSamples).toBeLessThanOrEqual(vfx.trailCapacity);
      expect(vfx.activeParticles).toBeLessThanOrEqual(vfx.burstCapacity);
      tick += 1;
    }
    expect(coordinator.isPlaying).toBe(false);
    expect(coordinator.verification.kind).toBe('pass');
    // The replayed mechanics recreated their juice (no VFX stored in tape).
    const counters = vfx.countersSnapshot;
    expect(counters.jump).toBeGreaterThan(0);
    expect(counters.landing).toBeGreaterThan(0);
    expect(counters.gravity).toBeGreaterThan(0);
    expect(counters.speed).toBeGreaterThan(0);
    expect(counters.pad).toBeGreaterThan(0);
    vfx.dispose();
  });
});
