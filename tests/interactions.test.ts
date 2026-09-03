import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { SIMULATION_DT } from '../src/core/constants';
import type { LevelDefinition } from '../src/level/levelDefinition';
import type { PhysicalInputSnapshot } from '../src/input/InputSystem';
import { idleInput } from './helpers/simulation';

/**
 * M4 interaction suite: pads, jump orbs, gravity orbs, speed portals, the
 * authoritative speed model, trigger ordering and the input-window contract.
 * All levels here are compact data-driven fixtures (engine never hardcodes
 * content). 1× Floor golden behavior is pinned separately by
 * tests/floorCompat.test.ts; M2.1 hazard CCD by tests/hazardCcd.test.ts.
 */

const THEME = {
  background: 0x07040f,
  fogColor: 0x140b26,
  fogNear: 30,
  fogFar: 130,
  platform: 0x17122a,
  platformTop: 0x241b42,
  edge: 0xb44dff,
  hazard: 0xff9d00,
};

interface LevelOpts {
  id?: string;
  start?: { x: number; y: number; z: number };
  startGravityMode?: 'floor' | 'ceiling';
  baseForwardSpeed?: number;
  startSpeedMultiplier?: number;
  finishZ?: number;
  ceilingSlab?: boolean;
}

const makeLevel = (opts: LevelOpts = {}): LevelDefinition => ({
  id: opts.id ?? 'm4-test',
  displayName: 'M4 TEST',
  start: opts.start ?? { x: 0, y: 1.5, z: 0 },
  startLaneIndex: 1,
  laneCenters: [2.6, 0, -2.6],
  baseForwardSpeed: opts.baseForwardSpeed ?? 14,
  startSpeedMultiplier: opts.startSpeedMultiplier,
  finishZ: opts.finishZ ?? 200,
  deathY: -14,
  deathYMax: 14,
  startGravityMode: opts.startGravityMode,
  solids: [
    // Floor runway top y=0 (z -10..210) — present for every fixture.
    { center: { x: 0, y: -0.5, z: 100 }, halfExtents: { x: 5.4, y: 0.5, z: 110 } },
    // Optional ceiling slab underside y=6 for ceiling fixtures.
    ...(opts.ceilingSlab
      ? [{ center: { x: 0, y: 7, z: 100 }, halfExtents: { x: 5.4, y: 1, z: 110 } }]
      : []),
  ],
  hazards: [],
  theme: THEME,
});

const press = (key: 'space' | 'up' | 'down'): PhysicalInputSnapshot => ({
  ...idleInput,
  [key]: { held: true, pressedThisStep: true, releasedThisStep: false },
});

/** Settle a mid-air spawn onto its support surface. */
const settle = (sim: GameSimulation): void => {
  for (let i = 0; i < 240 && !sim.player.grounded; i++) sim.update(idleInput);
  expect(sim.player.grounded).toBe(true);
};

/** Run with idle input until z reaches the target (or the sim stops). */
const runTo = (sim: GameSimulation, z: number): void => {
  for (let i = 0; i < 3000 && sim.player.position.z < z && sim.status === 'running'; i++) {
    sim.update(idleInput);
  }
};

// ---------------------------------------------------------------------------
// Pads
// ---------------------------------------------------------------------------

describe('M4 jump pads', () => {
  it('floor pad activates exactly once with the impulse replacing vertical velocity', () => {
    const def = makeLevel({ id: 'pad-floor' });
    def.jumpPads = [
      {
        id: 'pad-1',
        center: { x: 0, y: 0.15, z: 20 },
        halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
        surface: 'floor',
        impulse: 22,
      },
    ];
    const sim = new GameSimulation(def);
    settle(sim);
    let sawImpulse = false;
    let sawLaunch = false;
    for (let i = 0; i < 600 && sim.status === 'running'; i++) {
      sim.update(idleInput);
      if (sim.padActivationCount === 1) {
        sawImpulse = sawImpulse || sim.player.velocity.y === 22;
        sawLaunch = sawLaunch || (!sim.player.grounded && sim.player.supportColliderId === null);
      }
      if (sim.padActivationCount > 1) break;
    }
    expect(sim.padActivationCount).toBe(1);
    expect(sim.isInteractionUsed('pad-1')).toBe(true);
    expect(sawImpulse).toBe(true); // replaced, not added (falling onto it would too)
    expect(sawLaunch).toBe(true);
  });

  it('ceiling pad impulse is correctly reversed (-Y, away from the ceiling)', () => {
    const def = makeLevel({ id: 'pad-ceiling', startGravityMode: 'ceiling', ceilingSlab: true, start: { x: 0, y: 4.45, z: 0 } });
    def.jumpPads = [
      {
        id: 'pad-c-1',
        center: { x: 0, y: 5.6, z: 20 },
        halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
        surface: 'ceiling',
        impulse: 15,
      },
    ];
    const sim = new GameSimulation(def);
    settle(sim);
    expect(sim.gravityMode).toBe('ceiling');
    let sawImpulse = false;
    for (let i = 0; i < 600 && sim.status === 'running'; i++) {
      sim.update(idleInput);
      if (sim.padActivationCount === 1) {
        sawImpulse = sim.player.velocity.y === -15;
        break;
      }
    }
    expect(sawImpulse).toBe(true);
    expect(sim.padActivationCount).toBe(1);
  });

  it('does not multi-fire while resting/contacting (spawn overlapping the pad)', () => {
    const def = makeLevel({ id: 'pad-rest', start: { x: 0, y: 0.55, z: 20 } });
    def.jumpPads = [
      {
        id: 'pad-r-1',
        center: { x: 0, y: 0.15, z: 20 },
        halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
        surface: 'floor',
        impulse: 22,
      },
    ];
    const sim = new GameSimulation(def);
    // Spawn directly above the pad; it fires mid-fall and the player lands
    // back onto/overlapping it — the count must stay at exactly one.
    for (let i = 0; i < 300 && sim.status === 'running'; i++) sim.update(idleInput);
    expect(sim.padActivationCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Jump orbs
// ---------------------------------------------------------------------------

/** Falling-spawn fixture: the player falls through an orb window airborne,
 *  so activation semantics are testable without ground-jump interference. */
const makeFallingOrbLevel = (id: string, speed = 14): { def: LevelDefinition; sim: GameSimulation } => {
  const def = makeLevel({ id, baseForwardSpeed: speed, start: { x: 0, y: 3.6, z: 16 } });
  def.jumpOrbs = [
    {
      id: 'orb-1',
      center: { x: 0, y: 2.5, z: 20 },
      halfExtents: { x: 1.2, y: 1.0, z: 1.2 },
      impulse: 13.2,
    },
  ];
  return { def, sim: new GameSimulation(def) };
};

describe('M4 jump orbs', () => {
  it('touch without press does not activate', () => {
    const { sim } = makeFallingOrbLevel('orb-no-press');
    for (let i = 0; i < 300 && sim.status === 'running'; i++) sim.update(idleInput);
    expect(sim.orbActivationCount).toBe(0);
    expect(sim.isInteractionUsed('orb-1')).toBe(false);
  });

  it('valid press inside the window activates once (Space)', () => {
    const { sim } = makeFallingOrbLevel('orb-press');
    let pressed = false;
    let sawImpulse = false;
    for (let i = 0; i < 300 && sim.status === 'running'; i++) {
      const z = sim.player.position.z;
      if (!pressed && Math.abs(z - 20) <= 0.5) {
        sim.update(press('space'));
        pressed = true;
        sawImpulse = sim.player.velocity.y === 13.2;
        continue;
      }
      sim.update(idleInput);
    }
    expect(pressed).toBe(true);
    expect(sawImpulse).toBe(true);
    expect(sim.orbActivationCount).toBe(1);
  });

  it('gravity-relative jump arrow activates on the ceiling (ArrowDown)', () => {
    const def = makeLevel({
      id: 'orb-ceiling',
      startGravityMode: 'ceiling',
      ceilingSlab: true,
      start: { x: 0, y: 4.45, z: 0 },
    });
    def.jumpOrbs = [
      {
        id: 'orb-c-1',
        center: { x: 0, y: 4.0, z: 30 },
        halfExtents: { x: 1.2, y: 1.0, z: 3.0 },
        impulse: 13.2,
      },
    ];
    const sim = new GameSimulation(def);
    settle(sim);
    let jumped = false;
    let activated = false;
    for (let i = 0; i < 600 && sim.status === 'running'; i++) {
      const z = sim.player.position.z;
      if (!jumped && z >= 24 && sim.player.grounded) {
        sim.update(press('down')); // ceiling: ArrowDown IS the jump key
        jumped = true;
        continue;
      }
      if (jumped && !activated && !sim.player.grounded && Math.abs(z - 30) <= 1.5) {
        sim.update(press('down')); // fresh press edge inside the window
        activated = sim.orbActivationCount === 1 && sim.player.velocity.y === -13.2;
        continue;
      }
      sim.update(idleInput);
      if (activated) break;
    }
    expect(jumped).toBe(true);
    expect(activated).toBe(true);
  });

  it('held key without a new press edge does not activate', () => {
    const def = makeLevel({ id: 'orb-held', start: { x: 0, y: 3.6, z: 16 } });
    def.jumpOrbs = [
      { id: 'orb-h-1', center: { x: 0, y: 2.5, z: 20 }, halfExtents: { x: 1.2, y: 1.0, z: 1.2 }, impulse: 13.2 },
    ];
    const sim = new GameSimulation(def);
    // Hold Space from BEFORE entering the window: the single press edge is
    // consumed outside the window; no new edge occurs during the crossing.
    const held: PhysicalInputSnapshot = { ...idleInput, space: { held: true, pressedThisStep: true, releasedThisStep: false } };
    for (let i = 0; i < 300 && sim.status === 'running'; i++) {
      sim.update(i === 0 ? held : { ...idleInput, space: { held: true, pressedThisStep: false, releasedThisStep: false } });
    }
    expect(sim.orbActivationCount).toBe(0);
  });

  it('4x crossing activation is not skipped (swept window)', () => {
    const def = makeLevel({ id: 'orb-4x', baseForwardSpeed: 56, start: { x: 0, y: 3.6, z: 96 } });
    def.jumpOrbs = [
      { id: 'orb-f-1', center: { x: 0, y: 2.5, z: 100 }, halfExtents: { x: 1.2, y: 1.0, z: 1.2 }, impulse: 13.2 },
    ];
    const sim = new GameSimulation(def);
    let pressed = false;
    for (let i = 0; i < 300 && sim.status === 'running'; i++) {
      const z = sim.player.position.z;
      if (!pressed && Math.abs(z - 100) <= 0.5) {
        sim.update(press('space'));
        pressed = true;
        continue;
      }
      sim.update(idleInput);
    }
    expect(pressed).toBe(true);
    expect(sim.orbActivationCount).toBe(1);
    expect(sim.isInteractionUsed('orb-f-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gravity orbs
// ---------------------------------------------------------------------------

describe('M4 gravity orbs', () => {
  /** Falling fixture through a gravity-orb window at z 20. */
  const makeGravityOrbLevel = (id: string): GameSimulation => {
    const def = makeLevel({ id, start: { x: 0, y: 3.6, z: 16 } });
    def.gravityOrbs = [{ id: 'g-orb-1', center: { x: 0, y: 2.5, z: 20 }, halfExtents: { x: 1.2, y: 1.0, z: 1.2 } }];
    return new GameSimulation(def);
  };

  it('input activation flips gravity; support clears; forward velocity preserved', () => {
    const sim = makeGravityOrbLevel('g-orb-flip');
    let pressed = false;
    let vyBefore = 0;
    for (let i = 0; i < 300 && sim.status === 'running'; i++) {
      const z = sim.player.position.z;
      if (!pressed && Math.abs(z - 20) <= 0.5) {
        vyBefore = sim.player.velocity.y; // pre-press velocity (end of last step)
        sim.update(press('space'));
        pressed = true;
        // Same step: floor gravity was integrated by the controller, then the
        // flip PRESERVED that velocity exactly (no impulse, no zeroing).
        expect(sim.gravityMode).toBe('ceiling');
        expect(sim.player.velocity.y).toBeCloseTo(vyBefore - 42 * SIMULATION_DT, 10);
        expect(sim.player.velocity.z).toBe(14);
        expect(sim.player.velocity.x).toBe(0);
        expect(sim.player.grounded).toBe(false);
        expect(sim.player.supportColliderId).toBe(null);
        expect(sim.portalTransitionCount).toBe(1); // same transition path as portals
        continue;
      }
      sim.update(idleInput);
    }
    expect(pressed).toBe(true);
  });

  it('no input = no flip', () => {
    const sim = makeGravityOrbLevel('g-orb-idle');
    for (let i = 0; i < 300 && sim.status === 'running'; i++) sim.update(idleInput);
    expect(sim.gravityMode).toBe('floor');
    expect(sim.orbActivationCount).toBe(0);
  });

  it('one press = one flip (second press inside the same orb is inert)', () => {
    const sim = makeGravityOrbLevel('g-orb-once');
    let presses = 0;
    for (let i = 0; i < 300 && sim.status === 'running'; i++) {
      const z = sim.player.position.z;
      if (presses < 2 && Math.abs(z - 20) <= 0.5) {
        sim.update(press('space'));
        presses++;
        continue;
      }
      sim.update(idleInput);
    }
    expect(presses).toBe(2);
    expect(sim.orbActivationCount).toBe(1);
    expect(sim.portalTransitionCount).toBe(1);
  });

  it('reset restores start gravity and re-arms the orb', () => {
    const sim = makeGravityOrbLevel('g-orb-reset');
    let pressed = false;
    for (let i = 0; i < 300 && sim.status === 'running'; i++) {
      const z = sim.player.position.z;
      if (!pressed && Math.abs(z - 20) <= 0.5) {
        sim.update(press('space'));
        pressed = true;
        continue;
      }
      sim.update(idleInput);
    }
    expect(sim.gravityMode).toBe('ceiling');
    sim.respawn();
    expect(sim.gravityMode).toBe('floor');
    expect(sim.isInteractionUsed('g-orb-1')).toBe(false);
    expect(sim.orbActivationCount).toBe(1); // session counter stays (debug record)
  });

  it('interaction is deterministic run-twice', () => {
    const run = (): { z: number; y: number; mode: string; count: number } => {
      const sim = makeGravityOrbLevel('g-orb-det');
      let pressed = false;
      for (let i = 0; i < 200 && sim.status === 'running'; i++) {
        const z = sim.player.position.z;
        if (!pressed && Math.abs(z - 20) <= 0.5) {
          sim.update(press('space'));
          pressed = true;
          continue;
        }
        sim.update(idleInput);
      }
      return {
        z: sim.player.position.z,
        y: sim.player.position.y,
        mode: sim.gravityMode,
        count: sim.portalTransitionCount,
      };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Speed model + portals
// ---------------------------------------------------------------------------

describe('M4 speed model + portals', () => {
  it('speed portal changes the authoritative forward speed (no position jump)', () => {
    const def = makeLevel({ id: 'speed-basic' });
    def.speedPortals = [{ id: 'sp-2x', z: 30, multiplier: 2 }];
    const sim = new GameSimulation(def);
    settle(sim);
    runTo(sim, 28);
    const zBefore = sim.player.position.z;
    for (let i = 0; i < 60; i++) sim.update(idleInput);
    expect(sim.speedMultiplier).toBe(2);
    expect(sim.player.velocity.z).toBe(28);
    expect(sim.speedPortalCount).toBe(1);
    // Speed change is a multiplier on motion, never a teleport: the player
    // advanced monotonically through the portal plane.
    expect(sim.player.position.z).toBeGreaterThan(zBefore);
    expect(sim.lastSpeedPortalId).toBe('sp-2x');
  });

  it('startSpeedMultiplier is honored from level data', () => {
    const def = makeLevel({ id: 'speed-start', startSpeedMultiplier: 2 });
    const sim = new GameSimulation(def);
    expect(sim.speedMultiplier).toBe(2);
    expect(sim.currentForwardSpeed).toBe(28);
    settle(sim);
    expect(sim.player.velocity.z).toBe(28);
  });

  it('R restart resets speed to the level start tier', () => {
    const def = makeLevel({ id: 'speed-r' });
    def.speedPortals = [{ id: 'sp-4x', z: 30, multiplier: 4 }];
    const sim = new GameSimulation(def);
    settle(sim);
    runTo(sim, 31);
    expect(sim.speedMultiplier).toBe(4);
    sim.restart();
    expect(sim.speedMultiplier).toBe(1);
    expect(sim.currentForwardSpeed).toBe(14);
  });

  it('death respawn resets speed', () => {
    const def = makeLevel({ id: 'speed-death' });
    def.speedPortals = [{ id: 'sp-3x', z: 20, multiplier: 3 }];
    def.hazards = [
      { kind: 'hazard', visual: 'block', center: { x: 0, y: 0.25, z: 40 }, halfExtents: { x: 5.4, y: 0.25, z: 0.5 } },
    ];
    const sim = new GameSimulation(def);
    settle(sim);
    runTo(sim, 41);
    expect(sim.status).toBe('dead');
    sim.respawn();
    expect(sim.speedMultiplier).toBe(1);
  });

  it('4x cannot tunnel a thin solid (frontal death at the wall face)', () => {
    const def = makeLevel({ id: 'speed-tunnel', baseForwardSpeed: 56 });
    def.solids.push({ center: { x: 0, y: 2, z: 40 }, halfExtents: { x: 5.4, y: 2, z: 0.05 } });
    const sim = new GameSimulation(def);
    for (let i = 0; i < 300 && sim.status === 'running'; i++) sim.update(idleInput);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('frontImpact');
    expect(sim.player.position.z).toBeLessThan(40); // never passed through
  });

  it('4x cannot skip a thin hazard (swept-path CCD)', () => {
    const def = makeLevel({ id: 'speed-hazard', baseForwardSpeed: 56 });
    def.hazards = [
      { kind: 'hazard', visual: 'block', center: { x: 0, y: 0.25, z: 40 }, halfExtents: { x: 5.4, y: 0.25, z: 0.05 } },
    ];
    const sim = new GameSimulation(def);
    for (let i = 0; i < 300 && sim.status === 'running'; i++) sim.update(idleInput);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('hazard');
  });

  it('4x does not skip a speed portal crossing', () => {
    const def = makeLevel({ id: 'speed-skip' });
    def.speedPortals = [
      { id: 'sp-a', z: 20, multiplier: 4 },
      { id: 'sp-b', z: 60, multiplier: 2 },
    ];
    const sim = new GameSimulation(def);
    settle(sim);
    runTo(sim, 61);
    expect(sim.speedPortalCount).toBe(2);
    expect(sim.speedMultiplier).toBe(2);
    expect(sim.player.velocity.z).toBe(28);
  });

  it('4x interaction crossing honors the documented press semantics', () => {
    // At 4x (56 u/s -> ~0.47 u/step) the player presses while the swept path
    // overlaps the window; the activation must not be lost between steps.
    const { sim } = makeFallingOrbLevel('speed-orb-semantics', 56);
    let pressed = false;
    for (let i = 0; i < 300 && sim.status === 'running'; i++) {
      const z = sim.player.position.z;
      if (!pressed && z >= 19.5 && z <= 20.5) {
        sim.update(press('space'));
        pressed = true;
        continue;
      }
      sim.update(idleInput);
    }
    expect(pressed).toBe(true);
    expect(sim.orbActivationCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Trigger ordering
// ---------------------------------------------------------------------------

describe('M4 trigger ordering', () => {
  it('lethal same-step event wins over interaction (pad never fires on a dead step)', () => {
    const def = makeLevel({ id: 'order-lethal' });
    def.jumpPads = [
      {
        id: 'pad-dead',
        center: { x: 0, y: 0.15, z: 20 },
        halfExtents: { x: 1.2, y: 0.3, z: 0.8 },
        surface: 'floor',
        impulse: 22,
      },
    ];
    // Hazard shares the pad's exact z-extent: both first overlap on the SAME
    // step; the lethal check runs before interactions, so the pad is inert.
    def.hazards = [
      { kind: 'hazard', visual: 'block', center: { x: 0, y: 0.25, z: 20 }, halfExtents: { x: 5.4, y: 0.25, z: 0.8 } },
    ];
    const sim = new GameSimulation(def);
    settle(sim);
    runTo(sim, 21);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('hazard');
    expect(sim.padActivationCount).toBe(0);
    expect(sim.isInteractionUsed('pad-dead')).toBe(false);
  });

  it('finish cannot occur on a step where a lethal event also fires', () => {
    const def = makeLevel({ id: 'order-finish', finishZ: 48.8 });
    // Hazard front face 49.35: the player's swept path first overlaps when
    // center >= 48.8 — exactly the finish threshold, so both fire same step.
    def.hazards = [
      { kind: 'hazard', visual: 'block', center: { x: 0, y: 0.25, z: 49.9 }, halfExtents: { x: 5.4, y: 0.25, z: 0.55 } },
    ];
    const sim = new GameSimulation(def);
    settle(sim);
    runTo(sim, 49.5);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('hazard');
    // The death step is the same step that reached finishZ — yet the status
    // is dead, never finished (lethal checks precede the finish check).
  });

  it('speed portal and gravity portal at the same Z apply deterministically', () => {
    const def = makeLevel({ id: 'order-portals' });
    def.speedPortals = [{ id: 'sp-x', z: 30, multiplier: 2 }];
    def.gravityPortals = [{ id: 'gp-x', z: 30, target: 'ceiling' }];
    const sim = new GameSimulation(def);
    settle(sim);
    runTo(sim, 30.5);
    expect(sim.speedMultiplier).toBe(2);
    expect(sim.gravityMode).toBe('ceiling');
    expect(sim.speedPortalCount).toBe(1);
    expect(sim.portalTransitionCount).toBe(1);
  });

  it('lethal checks precede gravity portal mutation (M3.3 invariant)', () => {
    const def = makeLevel({ id: 'order-lethal-portal' });
    def.gravityPortals = [{ id: 'gp-dead', z: 30, target: 'ceiling' }];
    def.hazards = [
      { kind: 'hazard', visual: 'block', center: { x: 0, y: 0.25, z: 31 }, halfExtents: { x: 5.4, y: 0.25, z: 0.5 } },
    ];
    const sim = new GameSimulation(def);
    settle(sim);
    runTo(sim, 31.5);
    expect(sim.status).toBe('dead');
    expect(sim.deathCause).toBe('hazard');
    // The portal plane was crossed, but the death wins the step semantics:
    // the gravity mode is unchanged and no transition was applied.
    expect(sim.gravityMode).toBe('floor');
    expect(sim.portalTransitionCount).toBe(0);
  });
});
