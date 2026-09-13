import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { LevelDefinition } from '../src/level/levelDefinition';
import type { ChomperDef } from '../src/level/levelDefinition';
import { computeLevelFingerprint } from '../src/replay/levelFingerprint';
import { computeStateFingerprint } from '../src/replay/stateFingerprint';
import { idleInput, holdJump, advance } from './helpers/simulation';

/**
 * M8D deterministic lava-Chomper contract:
 * - dormant beside the route until the player reaches triggerZ
 * - telegraph (committed aim captured, no re-homing) then horizontal lunge
 * - swept lethal contact in every phase (no tunneling at speed)
 * - a timed jump clears the lunge line (jumpable crossing)
 * - spent rest pose + full reset on respawn
 * - replay-safe: level + state fingerprints extend conditionally
 */

const THEME = TEST_LEVEL.theme;

const CHOMPER: ChomperDef = {
  id: 'chomp-1',
  dormant: { x: 8, y: 8, z: 60 },
  // Trigger ≈ 10 u before the lunge line: telegraph (48) + half-lunge
  // (30) ≈ 78 ticks ≈ 9.1 u at 14 u/s, so mid-lunge meets the player at z≈60.
  triggerZ: 50,
  lungeDirection: -1,
  lungeDistance: 16,
  telegraphTicks: 48,
  lungeTicks: 60,
  halfExtents: { x: 0.8, y: 0.7, z: 0.8 },
};

/** Low lunge line (top y≈1.2 < Cube jump-apex bottom ≈1.5): kills grounded, clears airborne. */
const LOW_CHOMPER: ChomperDef = {
  ...CHOMPER,
  dormant: { x: 8, y: 0.75, z: 60 },
  halfExtents: { x: 0.8, y: 0.45, z: 0.8 },
};

const makeChomperSim = (chomper: ChomperDef = CHOMPER): GameSimulation => {
  const def: LevelDefinition = {
    id: 'm8d-chomper-fixture',
    displayName: 'M8D CHOMPER FIXTURE',
    start: { x: 0, y: 1.5, z: -4 },
    startLaneIndex: 1,
    laneCenters: [2.6, 0, -2.6],
    baseForwardSpeed: 14,
    finishZ: 400,
    deathY: -14,
    deathYMax: 14,
    solids: [
      { center: { x: 0, y: -0.5, z: 190 }, halfExtents: { x: 5.4, y: 0.5, z: 200 } },
    ],
    hazards: [],
    chompers: [{ ...chomper, dormant: { ...chomper.dormant }, halfExtents: { ...chomper.halfExtents } }],
    theme: THEME,
  };
  return new GameSimulation(def);
};

describe('M8D Chomper phase machine', () => {
  it('stays dormant beside the route before the trigger', () => {
    const sim = makeChomperSim();
    advance(sim, idleInput, 60);
    const st = sim.chomperStates[0];
    expect(st?.phase).toBe('dormant');
    expect(st?.x).toBe(CHOMPER.dormant.x);
    expect(sim.status).toBe('running');
  });

  it('activates at triggerZ, captures aim, telegraphs, then lunges and rests spent', () => {
    const sim = makeChomperSim();
    // Run until activation (triggerZ=30 at 14 u/s from z=-4 ≈ tick 292).
    let activatedAt = -1;
    for (let i = 0; i < 600; i++) {
      sim.update(idleInput);
      if (sim.chomperStates[0]?.phase !== 'dormant') {
        activatedAt = i;
        break;
      }
    }
    expect(activatedAt).toBeGreaterThan(0);
    const st = sim.chomperStates[0];
    expect(st?.phase).toBe('telegraph');
    // Aim captured from the live player X at activation.
    expect(st?.aimX).toBeCloseTo(sim.player.position.x, 6);
    // Telegraph holds for exactly telegraphTicks, then lunges.
    advance(sim, idleInput, CHOMPER.telegraphTicks - 1);
    expect(sim.chomperStates[0]?.phase).toBe('telegraph');
    advance(sim, idleInput, 1);
    expect(sim.chomperStates[0]?.phase).toBe('lunging');
    // Lunge travels linearly dormant -> end over lungeTicks.
    advance(sim, idleInput, CHOMPER.lungeTicks);
    const end = sim.chomperStates[0];
    expect(end?.phase).toBe('spent');
    expect(end?.x).toBeCloseTo(CHOMPER.dormant.x - CHOMPER.lungeDistance, 6);
  });

  it('never re-homes: aim stays frozen after activation', () => {
    const sim = makeChomperSim();
    for (let i = 0; i < 600 && sim.chomperStates[0]?.phase === 'dormant'; i++) {
      sim.update(idleInput);
    }
    const aim = sim.chomperStates[0]?.aimX ?? 0;
    advance(sim, idleInput, 20);
    expect(sim.chomperStates[0]?.aimX).toBe(aim);
  });

  it(' touching the dormant creature kills (lethal in every phase)', () => {
    // Dormant body sits ON the route center: running into it dies.
    const sim = makeChomperSim({
      ...CHOMPER,
      dormant: { x: 0, y: 1.1, z: 20 },
      triggerZ: 1000, // never activates — pure dormant contact
    });
    for (let i = 0; i < 400 && sim.status === 'running'; i++) sim.update(idleInput);
    expect(sim.status).toBe('dead');
    expect(sim.lastDeathCause).toBe('hazard');
    expect(sim.lastDeathLethalId).toBe('chomper-chomp-1');
  });

  it('lunging across the player kills without a jump', () => {
    const sim = makeChomperSim(LOW_CHOMPER);
    // Death auto-respawns after the hold, so watch attempts (death proof)
    // rather than the transient `dead` status.
    for (let i = 0; i < 2000 && sim.attempts === 1; i++) sim.update(idleInput);
    // The Chomper lunges across x=0 at z=60 while the Cube runs grounded
    // through z=60 — contact kills (attempt 1 ends in a Chomper death).
    expect(sim.attempts).toBeGreaterThan(1);
    expect(sim.lastDeathLethalId).toBe('chomper-chomp-1');
  });

  it('a timed jump clears the lunge line (jumpable crossing)', () => {
    const sim = makeChomperSim(LOW_CHOMPER);
    let jumped = false;
    for (let i = 0; i < 2000 && sim.status === 'running'; i++) {
      const st = sim.chomperStates[0];
      // Jump the moment the lunge starts: airborne over the whole z-window.
      const shouldJump = st !== undefined && st.phase === 'lunging' && !jumped;
      sim.update(shouldJump ? holdJump : idleInput);
      if (shouldJump) jumped = true;
      if (sim.player.position.z > 80) break;
    }
    expect(jumped).toBe(true);
    expect(sim.status).toBe('running');
    expect(sim.player.position.z).toBeGreaterThan(80);
  });

  it('respawn resets the Chomper to dormant', () => {
    const sim = makeChomperSim(LOW_CHOMPER);
    for (let i = 0; i < 2000 && sim.attempts === 1; i++) sim.update(idleInput);
    expect(sim.attempts).toBeGreaterThan(1);
    sim.respawn();
    const st = sim.chomperStates[0];
    expect(st?.phase).toBe('dormant');
    expect(st?.x).toBe(CHOMPER.dormant.x);
  });

  it('run-twice determinism: identical inputs reproduce Chomper state exactly', () => {
    const run = (): string[] => {
      const sim = makeChomperSim();
      const hashes: string[] = [];
      for (let i = 0; i < 500; i++) {
        sim.update(i === 300 ? holdJump : idleInput);
        hashes.push(computeStateFingerprint(sim));
      }
      return hashes;
    };
    expect(run()).toEqual(run());
  });
});

describe('M8D Chomper fingerprints (conditional encoding)', () => {
  it('levels without chompers hash byte-identically to before', () => {
    const without: LevelDefinition = {
      ...TEST_LEVEL,
      chompers: undefined,
    };
    expect(computeLevelFingerprint(without)).toBe(computeLevelFingerprint(TEST_LEVEL));
  });

  it('Chomper defs affect the level fingerprint (gameplay-bound)', () => {
    const withChomper: LevelDefinition = { ...TEST_LEVEL, chompers: [CHOMPER] };
    expect(computeLevelFingerprint(withChomper)).not.toBe(computeLevelFingerprint(TEST_LEVEL));
  });

  it('Chomper state affects the state fingerprint once active', () => {
    const sim = makeChomperSim();
    const dormantHash = computeStateFingerprint(sim);
    for (let i = 0; i < 600 && sim.chomperStates[0]?.phase === 'dormant'; i++) {
      sim.update(idleInput);
    }
    expect(sim.chomperStates[0]?.phase).not.toBe('dormant');
    expect(computeStateFingerprint(sim)).not.toBe(dormantHash);
  });
});
