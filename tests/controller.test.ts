import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import { GameplayFrame } from '../src/player/gameplayFrame';
import {
  advance,
  holdFastFall,
  holdJump,
  idleInput,
  makeGroundedSim,
  makeSim,
  tapLaneLeft,
  tapLaneRight,
} from './helpers/simulation';

describe('GameSimulation — auto forward travel', () => {
  it('moves forward at base speed along +Z without any input', () => {
    const sim = makeSim();
    const z0 = sim.player.position.z;
    advance(sim, idleInput, 120); // one simulated second
    expect(sim.player.position.z).toBeCloseTo(z0 + TEST_LEVEL.baseForwardSpeed, 1);
    expect(sim.status).toBe('running');
  });
});

describe('Jump determinism', () => {
  it('same inputs produce identical trajectory step by step', () => {
    const a = makeGroundedSim().sim;
    const b = makeGroundedSim().sim;
    advance(a, holdJump, 40); // jump happens on first grounded step
    advance(b, holdJump, 40);
    expect(a.player.position.x).toBeCloseTo(b.player.position.x, 9);
    expect(a.player.position.y).toBeCloseTo(b.player.position.y, 9);
    expect(a.player.position.z).toBeCloseTo(b.player.position.z, 9);
  });

  it('jump impulse identical every time; apex matches v^2/(2g) within tolerance', () => {
    const { sim } = makeGroundedSim();
    const yBefore = sim.player.position.y;
    advance(sim, holdJump, 1);
    expect(sim.player.velocity.y).toBeCloseTo(13.2, 3);
    // Track apex over the jump.
    let apexY = sim.player.position.y;
    for (let i = 0; i < 80; i++) {
      sim.update(idleInput);
      apexY = Math.max(apexY, sim.player.position.y);
    }
    // Apex above takeoff = impulse^2/(2*g) ≈ 2.074. Discrete 120 Hz sampling
    // of the true apex has ± one step of integration error; bound it.
    expect(apexY - yBefore).toBeGreaterThan(1.9);
    expect(apexY - yBefore).toBeLessThan(2.3);
  });

  it('landing timing is deterministic across two identical runs', () => {
    const landingStep = (): number => {
      const { sim } = makeGroundedSim();
      advance(sim, holdJump, 1); // trigger jump on ground
      let steps = 1;
      while (!sim.player.grounded && steps < 200) {
        sim.update(idleInput);
        steps++;
      }
      return steps;
    };
    expect(landingStep()).toBe(landingStep());
  });
});

describe('Hold-to-repeat-jump', () => {
  it('jumps once from ground, no mid-air extra jumps, re-jumps after landing', () => {
    let jumpCount = 0;
    const counting = new GameSimulation(TEST_LEVEL, {
      onJump: () => jumpCount++,
    });
    // Settle from spawn, then hold jump for 3 simulated seconds (~4+ cycles).
    for (let i = 0; i < 120 && !counting.player.grounded; i++) counting.update(idleInput);
    advance(counting, holdJump, 360);
    expect(jumpCount).toBeGreaterThanOrEqual(3);
    expect(jumpCount).toBeLessThan(12);
  });

  it('holding jump does not increase impulse beyond the deterministic value', () => {
    const { sim } = makeGroundedSim();
    advance(sim, holdJump, 1);
    const vy = sim.player.velocity.y;
    expect(vy).toBeCloseTo(13.2, 3);
  });

  it('single press (not held) produces exactly one jump, no repeat after landing', () => {
    let jumpCount = 0;
    const counting = new GameSimulation(TEST_LEVEL, { onJump: () => jumpCount++ });
    for (let i = 0; i < 120 && !counting.player.grounded; i++) counting.update(idleInput);
    advance(counting, holdJump, 2);
    advance(counting, idleInput, 300); // release, land, keep rolling
    expect(jumpCount).toBe(1);
  });
});

describe('Fast-fall', () => {
  it('shortens airtime versus the same jump without fast-fall', () => {
    const airtimeWith = (fastFall: boolean): number => {
      const { sim } = makeGroundedSim();
      advance(sim, holdJump, 1);
      let steps = 1;
      while (!sim.player.grounded && steps < 200) {
        sim.update(fastFall ? holdFastFall : idleInput);
        steps++;
      }
      return steps * (1 / 120);
    };
    const normal = airtimeWith(false);
    const fast = airtimeWith(true);
    expect(fast).toBeLessThan(normal);
    // Sanity: meaningfully shorter, not just epsilon.
    expect(normal - fast).toBeGreaterThan(0.05);
  });

  it('grounded ArrowDown does nothing (no crouch, no velocity change)', () => {
    const { sim } = makeGroundedSim();
    // Grounded and holding fast-fall: must remain grounded/stable.
    advance(sim, holdFastFall, 60);
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.velocity.y).toBeCloseTo(0, 4);
  });
});

describe('Lane change', () => {
  it('moves continuously toward target lane — no snapping', () => {
    const sim = makeSim();
    const startX = sim.player.position.x;
    advance(sim, tapLaneLeft, 6); // half a step of motion
    const earlyX = sim.player.position.x;
    expect(earlyX).not.toBeCloseTo(startX - TEST_LEVEL.laneCenters.length, 5);
    expect(Math.abs(earlyX - startX)).toBeGreaterThan(0);
    expect(Math.abs(earlyX - startX)).toBeLessThan(1.5); // clearly not teleported
  });

  it('screen-side convention: Right key moves toward screen-right (−X), Left toward +X', () => {
    // M1.1 regression: the +Z chase camera shows world −X on screen-right,
    // so laneRight must produce −X velocity and laneLeft +X velocity.
    // Index convention: laneCenters ordered screen-left -> screen-right.
    expect(GameplayFrame.floor().laneAxis.x).toBe(-1);
    expect(TEST_LEVEL.laneCenters[0]).toBeCloseTo(2.6, 5); // index 0 = screen-left
    expect(TEST_LEVEL.laneCenters[2]).toBeCloseTo(-2.6, 5); // index 2 = screen-right
    // NOTE: tap snapshots carry pressedThisStep, so each step advanced with
    // one fires an edge — single edges need exactly 1 tap step + idle steps.
    const simR = makeGroundedSim().sim;
    advance(simR, tapLaneRight, 1);
    advance(simR, idleInput, 2);
    expect(simR.player.targetLaneIndex).toBe(2);
    expect(simR.player.velocity.x).toBeLessThan(0);
    const simL = makeGroundedSim().sim;
    advance(simL, tapLaneLeft, 1);
    advance(simL, idleInput, 2);
    expect(simL.player.targetLaneIndex).toBe(0);
    expect(simL.player.velocity.x).toBeGreaterThan(0);
  });

  it('reaches neighboring lane center quickly, settles, bounded overshoot', () => {
    const sim = makeSim();
    advance(sim, tapLaneRight, 1);
    const target: number = TEST_LEVEL.laneCenters[2] ?? 0; // -2.6, screen-right
    let overshoot = 0;
    let settledStep = -1;
    for (let i = 0; i < 90; i++) {
      sim.update(idleInput);
      if (sim.player.position.x < target - 0.001 && settledStep < 0) {
        overshoot = Math.max(overshoot, Math.abs(sim.player.position.x - target));
      }
      if (
        settledStep < 0 &&
        Math.abs(sim.player.position.x - target) <= 0.03 &&
        Math.abs(sim.player.velocity.x) <= 0.01
      ) {
        settledStep = i;
        break;
      }
    }
    expect(settledStep).toBeGreaterThanOrEqual(0);
    expect(settledStep).toBeLessThan(45); // arrives well under 0.4 s
    expect(overshoot).toBeLessThan(0.05);
  });

  it('reversing lane intent mid-course settles cleanly without oscillation', () => {
    const sim = makeSim();
    advance(sim, tapLaneLeft, 8);
    advance(sim, tapLaneLeft, 8); // M1.2: intent unclamped — second tap targets virtual lane -1.
    // Reversal with full settle between intents (deterministic: sub-settle
    // alternation windows beat against accel/brake rates and random-walk, so
    // rapid-tap timing artifacts are not asserted here — reversal + damping
    // are). M1.2: one tap step = one edge (multi-step tap snapshots would
    // walk the unclamped index outward).
    const sim2 = makeGroundedSim().sim;
    const tapRightInline = {
      ...idleInput,
      laneRight: { held: false, pressedThisStep: true, releasedThisStep: true },
    };
    advance(sim2, tapLaneLeft, 1); // head screen-left...
    advance(sim2, idleInput, 60);
    expect(sim2.player.position.x).toBeCloseTo(2.6, 1);
    advance(sim2, tapRightInline, 1); // ...reverse mid-course...
    advance(sim2, idleInput, 60);
    expect(sim2.player.targetLaneIndex).toBe(1);
    expect(sim2.player.position.x).toBeCloseTo(0, 1);
    expect(Math.abs(sim2.player.velocity.x)).toBeLessThan(0.05);
    advance(sim2, tapRightInline, 1); // ...mirror side...
    advance(sim2, idleInput, 60);
    expect(sim2.player.position.x).toBeCloseTo(-2.6, 1);
    advance(sim2, tapLaneLeft, 1); // ...and back: no residual oscillation.
    advance(sim2, idleInput, 60);
    expect(sim2.player.targetLaneIndex).toBe(1);
    expect(sim2.player.position.x).toBeCloseTo(0, 1);
    expect(Math.abs(sim2.player.velocity.x)).toBeLessThan(0.05);
  });
});

describe('Lateral fall-off (M1.2)', () => {
  it('outward tap past the outer lane targets a virtual lane (no clamping)', () => {
    const { sim } = makeGroundedSim();
    advance(sim, tapLaneRight, 1);
    advance(sim, idleInput, 50); // settle at outer lane
    expect(sim.player.targetLaneIndex).toBe(2);
    expect(sim.player.position.x).toBeCloseTo(-2.6, 1);
    advance(sim, tapLaneRight, 1); // one more outward tap: virtual lane 3
    expect(sim.player.targetLaneIndex).toBe(3);
  });

  it('leaving support laterally transitions to airborne, then falls (no instant kill)', () => {
    const { sim } = makeGroundedSim();
    advance(sim, tapLaneRight, 1);
    advance(sim, idleInput, 50); // settle outer lane (x = -2.6)
    // Grid truth: lane spacing is 2.6 and the slab edge is at x = -5.4, so
    // virtual lane 3 (center -5.2) is a grounded teeter with COM over support;
    // lane 4 (center -7.8) is past the footprint exit (x < -4.87). Two taps.
    advance(sim, tapLaneRight, 1); // virtual lane 3: teeter, still grounded
    advance(sim, tapLaneRight, 1); // virtual lane 4: committed exit
    // Drive out: the support footprint must fully leave the slab before lift ends.
    let lostSupportAt = -1;
    for (let i = 0; i < 150; i++) {
      sim.update(idleInput);
      if (!sim.player.grounded) {
        lostSupportAt = i;
        break;
      }
    }
    expect(lostSupportAt).toBeGreaterThanOrEqual(0); // support-based exit happened
    expect(sim.status).toBe('running'); // airborne, NOT instantly killed
    const yAtLoss = sim.player.position.y;
    advance(sim, idleInput, 40); // gravity takes over
    expect(sim.player.position.y).toBeLessThan(yAtLoss - 0.5); // really falling
    expect(sim.status).toBe('running');
  });

  it('side fall ends through the existing death-plane reset (attempts + 1)', () => {
    const { sim } = makeGroundedSim();
    advance(sim, tapLaneRight, 1);
    advance(sim, idleInput, 50);
    advance(sim, tapLaneRight, 1); // virtual lane 3: teeter (COM over support)
    advance(sim, tapLaneRight, 1); // virtual lane 4: off the edge
    for (let i = 0; i < 400 && sim.attempts === 1; i++) sim.update(idleInput);
    // Fall to deathY -> die -> 0.45 s hold -> deterministic respawn.
    expect(sim.attempts).toBe(2);
    expect(sim.status).toBe('running');
    expect(sim.player.position.z).toBeLessThan(10); // back at the start line
  });

  it('a solid side face still blocks lateral exit as geometry (no kill, no pass-through)', () => {
    // Lane-marker block at x = -1.3 +/- 0.35, z = 34 +/- 0.35: drive -X into
    // its +X face (x = -0.95); the collider must stop at x = -0.40, grounded.
    const sim = makeSim();
    advance(sim, idleInput, 310); // roll to z ~= 32 on open runway
    expect(sim.player.grounded).toBe(true);
    advance(sim, tapLaneRight, 1);
    advance(sim, tapLaneRight, 1); // virtual lane: committed outward drive
    advance(sim, idleInput, 16);
    expect(sim.player.position.x).toBeCloseTo(-0.4, 1);
    expect(sim.player.grounded).toBe(true);
    expect(sim.status).toBe('running'); // side contact is not lethal
  });
});

describe('Airborne lane change', () => {
  it('lateral movement works while airborne after a jump', () => {
    const { sim } = makeGroundedSim();
    advance(sim, holdJump, 2);
    expect(sim.player.grounded).toBe(false);
    const xAtTakeoff = sim.player.position.x;
    advance(sim, tapLaneLeft, 15);
    // M1.1: Left key moves toward screen-left = world +X.
    expect(sim.player.position.x).toBeGreaterThan(xAtTakeoff + 0.5);
  });
});
