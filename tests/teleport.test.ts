import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import type { LevelDefinition } from '../src/level/levelDefinition';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { computeStateFingerprint } from '../src/replay/stateFingerprint';
import { ReplayCoordinator } from '../src/replay/ReplayCoordinator';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { idleInput, tapLaneRight } from './helpers/simulation';
import { recordAttempt, playReplay } from './helpers/replay';
import { VfxSystem } from '../src/rendering/VfxSystem';
import { PRODUCTION_THEME } from '../src/visuals/productionTheme';
import { DT, makeSimView, runFrames } from './helpers/vfxSimView';

/**
 * M7.2 teleport portal suite: deterministic discontinuity semantics on
 * compact data-driven fixtures (no production level content here).
 *
 * Contract under test (see the processTeleportPortals docblock):
 * lethal wins the step → exactly once per attempt → skipped interval never
 * fires → exit velocity/lane/support semantics → replay reproduces →
 * fingerprint boundaries → ReplayV1 untouched.
 */

const LANES = [2.6, 0, -2.6];

/** Long runway; teleport entry z=50 → exit z=120 (same lane, floor band). */
const makeTeleportLevel = (overrides: Partial<LevelDefinition> = {}): LevelDefinition => ({
  id: 'tp-fixture',
  displayName: 'TP FIXTURE',
  start: { x: 0, y: 1.5, z: -4 },
  startLaneIndex: 1,
  laneCenters: [...LANES],
  baseForwardSpeed: 12,
  finishZ: 200,
  deathY: -14,
  teleportPortals: [
    { id: 'tp-1', entryZ: 50, exit: { x: 0, y: 1.5, z: 120 }, exitLaneIndex: 1 },
  ],
  solids: [
    { center: { x: 0, y: -0.5, z: 95 }, halfExtents: { x: 5.4, y: 0.5, z: 105 } },
  ],
  hazards: [],
  theme: TEST_LEVEL.theme,
  ...overrides,
});

/**
 * Advance until one MORE teleport fires (or the cap hits). Delta-based:
 * teleportEventCount is session-monotonic (like interactionEventCount), so
 * a stale count from a previous attempt must not end the wait early.
 */
const runUntilTeleport = (sim: GameSimulation, maxTicks = 10000): GameSimulation => {
  const before = sim.teleportEventCount;
  for (let i = 0; i < maxTicks; i++) {
    if (sim.teleportEventCount > before || sim.status !== 'running') break;
    sim.update(idleInput);
  }
  return sim;
};

describe('teleport portal triggering', () => {
  it('fires on exact entry crossing and relocates to the exit', () => {
    const sim = new GameSimulation(makeTeleportLevel());
    runUntilTeleport(sim);
    expect(sim.teleportEventCount).toBe(1);
    expect(sim.lastTeleportId).toBe('tp-1');
    expect(sim.isTeleportUsed('tp-1')).toBe(true);
    expect(sim.player.position.x).toBe(0);
    expect(sim.player.position.y).toBe(1.5);
    expect(sim.player.position.z).toBe(120);
    expect(sim.status).toBe('running');
  });

  it('fires exactly once per attempt (no refire, no cascade)', () => {
    const sim = new GameSimulation(makeTeleportLevel());
    runUntilTeleport(sim);
    // Keep running to the finish: the used entry must never refire, and the
    // exit must not match another entry (single-portal level).
    for (let i = 0; i < 10000 && sim.status === 'running'; i++) sim.update(idleInput);
    expect(sim.teleportEventCount).toBe(1);
    expect(sim.status).toBe('finished');
  });

  it('the furthest crossed unused entry wins (ascending order)', () => {
    const sim = new GameSimulation(
      makeTeleportLevel({
        teleportPortals: [
          { id: 'tp-b', entryZ: 60, exit: { x: 0, y: 1.5, z: 150 }, exitLaneIndex: 1 },
          { id: 'tp-a', entryZ: 50, exit: { x: 0, y: 1.5, z: 120 }, exitLaneIndex: 1 },
        ],
      }),
    );
    runUntilTeleport(sim);
    // Normal steps cross one entry at a time; the first in Z fires first.
    expect(sim.lastTeleportId).toBe('tp-a');
  });

  it('restart re-arms the portal (new attempt teleports again)', () => {
    const sim = new GameSimulation(makeTeleportLevel());
    runUntilTeleport(sim);
    expect(sim.teleportEventCount).toBe(1);
    const attempts = sim.attempts;
    sim.restart();
    expect(sim.attempts).toBe(attempts + 1);
    expect(sim.isTeleportUsed('tp-1')).toBe(false);
    expect(sim.lastTeleportId).toBeNull();
    runUntilTeleport(sim);
    expect(sim.teleportEventCount).toBe(2); // session-monotonic evidence
    expect(sim.lastTeleportId).toBe('tp-1');
    expect(sim.player.position.z).toBe(120);
  });
});

describe('teleport precedence and discontinuity', () => {
  it('a lethal step wins over the teleport (death, no relocation)', () => {
    // Hazard volume straddling the entry plane at run height: the crossing
    // step overlaps it, so the hazard check fires before the teleport.
    const sim = new GameSimulation(
      makeTeleportLevel({
        hazards: [
          { kind: 'hazard', center: { x: 0, y: 0.55, z: 50 }, halfExtents: { x: 2, y: 0.6, z: 1 } },
        ],
      }),
    );
    runUntilTeleport(sim);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('hazard');
    expect(sim.teleportEventCount).toBe(0);
    expect(sim.isTeleportUsed('tp-1')).toBe(false);
    expect(sim.player.position.z).toBeLessThan(120);
  });

  it('skipped gravity/speed portals between entry and exit never fire', () => {
    const sim = new GameSimulation(
      makeTeleportLevel({
        gravityPortals: [{ id: 'skipped-up', z: 80, target: 'ceiling' }],
        speedPortals: [{ id: 'skipped-2x', z: 90, multiplier: 2 }],
      }),
    );
    runUntilTeleport(sim);
    expect(sim.teleportEventCount).toBe(1);
    expect(sim.player.position.z).toBe(120);
    // The discontinuity jumped over z=80/90: neither portal may have fired.
    expect(sim.portalTransitionCount).toBe(0);
    expect(sim.lastPortalId).toBeNull();
    expect(sim.gravityMode).toBe('floor');
    expect(sim.speedPortalCount).toBe(0);
    expect(sim.speedMultiplier).toBe(1);
  });

  it('portals past the exit still fire when reached by real motion', () => {
    const sim = new GameSimulation(
      makeTeleportLevel({
        gravityPortals: [{ id: 'after-up', z: 140, target: 'ceiling' }],
      }),
    );
    runUntilTeleport(sim);
    expect(sim.gravityMode).toBe('floor');
    for (let i = 0; i < 10000 && sim.status === 'running'; i++) {
      sim.update(idleInput);
      if (sim.gravityMode === 'ceiling') break;
    }
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.lastPortalId).toBe('after-up');
  });
});

describe('teleport exit semantics', () => {
  it('zeroes vertical velocity, preserves forward motion, clears support', () => {
    const sim = new GameSimulation(makeTeleportLevel());
    runUntilTeleport(sim);
    expect(sim.player.velocity.y).toBe(0);
    expect(sim.currentForwardSpeed).toBe(12);
    expect(sim.player.grounded).toBe(false);
    expect(sim.player.supportColliderId).toBeNull();
    expect(sim.gravityMode).toBe('floor');
    expect(sim.speedMultiplier).toBe(1);
  });

  it('preserves lateral velocity across the jump (flow)', () => {
    const sim = new GameSimulation(
      makeTeleportLevel({
        teleportPortals: [
          { id: 'tp-1', entryZ: 50, exit: { x: -2.6, y: 1.5, z: 120 }, exitLaneIndex: 2 },
        ],
      }),
    );
    // Start a lane change just before the entry so lateral velocity is live.
    let before = 0;
    for (let i = 0; i < 10000; i++) {
      if (sim.teleportEventCount > 0 || sim.status !== 'running') break;
      const z = sim.player.position.z;
      before = sim.player.velocity.x;
      if (z >= 46 && z < 47) {
        sim.update(tapLaneRight);
      } else {
        sim.update(idleInput);
      }
    }
    expect(sim.teleportEventCount).toBe(1);
    expect(sim.player.velocity.x).toBe(before);
    expect(sim.player.targetLaneIndex).toBe(2);
  });

  it('sets the authored lane intent at the exit', () => {
    const sim = new GameSimulation(
      makeTeleportLevel({
        teleportPortals: [
          { id: 'tp-1', entryZ: 50, exit: { x: 2.6, y: 1.5, z: 120 }, exitLaneIndex: 0 },
        ],
      }),
    );
    expect(sim.player.targetLaneIndex).toBe(1);
    runUntilTeleport(sim);
    expect(sim.player.targetLaneIndex).toBe(0);
    expect(sim.player.position.x).toBe(2.6);
  });

  it('an airborne exit falls and lands (support resolves next steps)', () => {
    const sim = new GameSimulation(
      makeTeleportLevel({
        teleportPortals: [
          { id: 'tp-1', entryZ: 50, exit: { x: 0, y: 4, z: 120 }, exitLaneIndex: 1 },
        ],
      }),
    );
    runUntilTeleport(sim);
    expect(sim.player.grounded).toBe(false);
    for (let i = 0; i < 1000 && sim.status === 'running'; i++) {
      sim.update(idleInput);
      if (sim.player.grounded) break;
    }
    expect(sim.player.grounded).toBe(true);
    expect(sim.status).toBe('running');
  });
});

describe('teleport determinism and replay', () => {
  it('reproduces tick-for-tick across runs', () => {
    const first = runUntilTeleport(new GameSimulation(makeTeleportLevel()));
    const second = runUntilTeleport(new GameSimulation(makeTeleportLevel()));
    expect(first.teleportEventCount).toBe(1);
    expect(second.player.position.x).toBe(first.player.position.x);
    expect(second.player.position.y).toBe(first.player.position.y);
    expect(second.player.position.z).toBe(first.player.position.z);
    expect(second.player.velocity.x).toBe(first.player.velocity.x);
    expect(second.player.velocity.y).toBe(first.player.velocity.y);
  });

  it('a recorded teleport run replays VERIFIED (ReplayV1 unchanged)', () => {
    const sim = new GameSimulation(makeTeleportLevel());
    const coordinator = new ReplayCoordinator(sim);
    const ticksUsed = recordAttempt(sim, coordinator, () => idleInput);
    expect(ticksUsed).toBeGreaterThan(0);
    const replay = coordinator.lastReplay;
    expect(replay).not.toBeNull();
    expect(replay?.outcome.status).toBe('finished');
    const serialized = JSON.stringify(replay);
    for (const key of ['teleport', 'exit', 'entryZ']) {
      expect(serialized).not.toContain(`"${key}`);
    }
    const verification = playReplay(sim, coordinator, replay);
    expect(verification.kind).toBe('pass');
    expect(sim.status).toBe('finished');
    // Session-monotonic evidence: record fired once, replay re-fires once.
    expect(sim.teleportEventCount).toBe(2);
    expect(sim.lastTeleportId).toBe('tp-1');
  });

  it('teleport lifecycle participates in the state hash (replay evidence)', () => {
    const before = new GameSimulation(makeTeleportLevel());
    const hashBefore = computeStateFingerprint(before);
    runUntilTeleport(before);
    const hashAfter = computeStateFingerprint(before);
    expect(hashAfter).not.toBe(hashBefore);
    // Same trajectory, fresh sim: identical post-teleport hash.
    const other = runUntilTeleport(new GameSimulation(makeTeleportLevel()));
    expect(computeStateFingerprint(other)).toBe(hashAfter);
  });
});

describe('teleport presentation edges (VFX exit burst)', () => {
  // Drives the REAL VfxSystem with the shared fake sim view: the exit
  // burst must fire exactly once per teleport edge — including across the
  // position-discontinuity clear that long jumps trip.
  it('a teleport edge emits one violet exit burst at the anchor', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    runFrames(vfx, sim, 10);
    expect(vfx.countersSnapshot.teleport).toBe(0);
    sim.teleportEventCount += 1;
    sim.lastTeleport = { x: 1, y: 2, z: 300 };
    runFrames(vfx, sim, 5);
    expect(vfx.countersSnapshot.teleport).toBe(1);
    expect(vfx.activeParticles).toBeGreaterThan(0);
    runFrames(vfx, sim, 120); // decay: no refire without a new edge
    expect(vfx.countersSnapshot.teleport).toBe(1);
    vfx.dispose();
  });

  it('a long-jump discontinuity still emits the exit burst (after the wipe)', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    vfx.update(DT, sim, sim.player.position);
    // Teleport far away in one frame: position jump + teleport edge.
    sim.teleportEventCount += 1;
    sim.lastTeleport = { x: 0, y: 1.5, z: 500 };
    sim.player.position.x = 0;
    sim.player.position.y = 1.5;
    sim.player.position.z = 500;
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.countersSnapshot.teleport).toBe(1);
    expect(vfx.activeParticles).toBeGreaterThan(0);
    // No trail line bridges the gap: trail was wiped by the clear.
    expect(vfx.trailSamples).toBeLessThanOrEqual(2);
    vfx.dispose();
  });
});

describe('teleport fingerprint boundaries', () => {
  it('teleport gameplay data changes the level fingerprint', () => {
    const base = computeLevelFingerprint(makeTeleportLevel());
    const moved = computeLevelFingerprint(
      makeTeleportLevel({
        teleportPortals: [
          { id: 'tp-1', entryZ: 55, exit: { x: 0, y: 1.5, z: 120 }, exitLaneIndex: 1 },
        ],
      }),
    );
    expect(moved).not.toBe(base);
    const relaned = computeLevelFingerprint(
      makeTeleportLevel({
        teleportPortals: [
          { id: 'tp-1', entryZ: 50, exit: { x: 0, y: 1.5, z: 120 }, exitLaneIndex: 2 },
        ],
      }),
    );
    expect(relaned).not.toBe(base);
  });

  it('presentation-only teleport style does NOT change the fingerprint', () => {
    const base = computeLevelFingerprint(makeTeleportLevel());
    const styled = computeLevelFingerprint(
      makeTeleportLevel({
        teleportPortals: [
          { id: 'tp-1', entryZ: 50, exit: { x: 0, y: 1.5, z: 120 }, exitLaneIndex: 1, style: 'maw' },
        ],
      }),
    );
    expect(styled).toBe(base);
  });

  it('setpieces do NOT change the fingerprint', () => {
    const base = computeLevelFingerprint(makeTeleportLevel());
    const dressed = computeLevelFingerprint(
      makeTeleportLevel({
        visualSetpieces: [
          { id: 'g-1', kind: 'guardian', center: { x: 0, y: 6, z: 45 }, halfExtents: { x: 4, y: 4, z: 1 } },
        ],
      }),
    );
    expect(dressed).toBe(base);
  });

  it('levels without teleports hash exactly as before (golden compatible)', () => {
    // The conditional extension writes zero bytes when no teleports exist:
    // stripping teleports from a teleport level equals the plain level.
    const plain = computeLevelFingerprint(TEST_LEVEL);
    const withEmpty: LevelDefinition = { ...TEST_LEVEL, teleportPortals: [] };
    expect(computeLevelFingerprint(withEmpty)).toBe(plain);
  });
});
