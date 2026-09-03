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
    const simR = makeGroundedSim().sim;
    advance(simR, tapLaneRight, 3);
    expect(simR.player.targetLaneIndex).toBe(2);
    expect(simR.player.velocity.x).toBeLessThan(0);
    const simL = makeGroundedSim().sim;
    advance(simL, tapLaneLeft, 3);
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

  it('rapidly switching lanes reverses smoothly without oscillation', () => {
    const sim = makeSim();
    advance(sim, tapLaneLeft, 8);
    advance(sim, tapLaneLeft, 8); // now target back to center? No: left twice clamps at lane 0.
    // Instead: right then left repeatedly around center.
    const sim2 = makeSim();
    for (let k = 0; k < 5; k++) {
      advance(sim2, tapLaneLeft, 10);
      advance(sim2, idleInput, 10);
      advance(sim2, { ...idleInput, laneRight: { held: false, pressedThisStep: true, releasedThisStep: true } }, 1);
      advance(sim2, idleInput, 10);
    }
    // Must end near a lane center, not oscillating between.
    const finalX = sim2.player.position.x;
    const nearestCenter = TEST_LEVEL.laneCenters.reduce((best, c) =>
      Math.abs(c - finalX) < Math.abs(best - finalX) ? c : best,
    );
    expect(Math.abs(finalX - nearestCenter)).toBeLessThan(0.35);
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
