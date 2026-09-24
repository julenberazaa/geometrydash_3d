import { describe, it, expect } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { ShowcaseDriver } from './helpers/showcaseScript';
import type { PhysicalInputSnapshot } from '../src/input/InputSystem';
import { idleInput } from './helpers/simulation';

/**
 * M9.3 ship mandatory-portal contract (§16):
 *
 *   VISIBLE OPENING == REQUIRED TRAVERSAL OPENING.
 *
 * For every required Ship-sequence portal: inside the ring fires, beside
 * the ring does NOT fire, and attempting to bypass the ring cannot
 * successfully continue (missing the ring meets wall/collision via the
 * funnel architecture — never an invisible trigger).
 *
 * Legs are short ship flights (enter ship at the tunnel mouth, place at
 * the leg start in ship mode, hold the offset with a damped PD pilot).
 * Controls prove the pilot threads the ring; bypass legs prove the
 * funnel kills what misses it.
 */

const edge = (held: boolean, pressed: boolean) => ({
  held,
  pressedThisStep: pressed,
  releasedThisStep: false,
});
const tapLeft: PhysicalInputSnapshot = {
  ...idleInput,
  laneLeft: { held: false, pressedThisStep: true, releasedThisStep: true },
};

/** Velocity-damped altitude hold (driver-style) + lane taps to hold tx. */
class Pilot {
  private holding = false;
  private laneCd = 0;
  next(sim: GameSimulation, tx: number, ty: number): PhysicalInputSnapshot {
    const y = sim.player.position.y;
    const x = sim.player.position.x;
    const vy = sim.player.velocity.y;
    const inverted = sim.gravityMode === 'ceiling';
    const predicted = y + vy * 0.2;
    const hold = inverted ? predicted > ty + 0.1 : predicted < ty - 0.1;
    if (hold) {
      const first = !this.holding;
      this.holding = true;
      return { ...idleInput, space: edge(true, first) };
    }
    this.holding = false;
    if (this.laneCd <= 0) {
      // laneLeft decrements intent (toward +X/screen-left); laneRight
      // increments (toward −X/screen-right).
      if (x < tx - 0.35) {
        this.laneCd = 8;
        return { ...idleInput, laneLeft: { held: false, pressedThisStep: true, releasedThisStep: true } };
      }
      if (x > tx + 0.35) {
        this.laneCd = 8;
        return { ...idleInput, laneRight: { held: false, pressedThisStep: true, releasedThisStep: true } };
      }
    }
    this.laneCd--;
    return idleInput;
  }
}

const enterShip = (): GameSimulation => {
  const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
  sim.debugPlaceAt(0, 0.55, 1100);
  for (let i = 0; i < 600 && sim.playerMode !== 'ship'; i++) sim.update(idleInput);
  if (sim.playerMode !== 'ship') throw new Error('ship entry failed');
  return sim;
};

interface LegOutcome {
  status: string;
  z: number;
  mode: string;
  grav: string;
  speed: number;
}

/** Fly from a placed ship pose toward (tx,ty); stop at maxZ or death. */
const flyLeg = (
  startX: number,
  startY: number,
  startZ: number,
  tx: number,
  ty: number,
  maxZ: number,
  intentTapsLeft = 0,
): { sim: GameSimulation; outcome: LegOutcome } => {
  const sim = enterShip();
  sim.debugPlaceAt(startX, startY, startZ);
  for (let i = 0; i < intentTapsLeft; i++) {
    sim.update(tapLeft);
    sim.update(idleInput);
  }
  const pilot = new Pilot();
  const outcome: LegOutcome = { status: '', z: 0, mode: '', grav: '', speed: 0 };
  for (let i = 0; i < 3000; i++) {
    if (sim.status !== 'running' || sim.player.position.z > maxZ) break;
    if (sim.playerMode === 'ship') sim.update(pilot.next(sim, tx, ty));
    else sim.update(idleInput);
  }
  outcome.status = sim.status;
  outcome.z = sim.player.position.z;
  outcome.mode = sim.playerMode;
  outcome.grav = sim.gravityMode;
  outcome.speed = sim.speedMultiplier;
  return { sim, outcome };
};

describe('M9.3 ship mandatory-portal routing', () => {
  it('ship-on: center enters ship; a lane-0 cube misses it and dies at the rise wall', () => {
    const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
    sim.debugPlaceAt(0, 0.55, 1100);
    for (let i = 0; i < 600 && sim.playerMode !== 'ship'; i++) sim.update(idleInput);
    expect(sim.playerMode).toBe('ship');
    expect(sim.isModePortalUsed('ps-ship-on')).toBe(true);

    const bypass = new GameSimulation(PRODUCTION_SHOWCASE_01);
    bypass.debugPlaceAt(0, 0.55, 1100);
    bypass.update(tapLeft);
    bypass.update(idleInput);
    for (let i = 0; i < 3000 && bypass.status === 'running' && bypass.player.position.z < 1130; i++) {
      bypass.update(idleInput);
    }
    expect(bypass.isModePortalUsed('ps-ship-on')).toBe(false);
    expect(bypass.status).toBe('dead');
  });

  it('speed-approach (1x): the ring slows; high/side bypasses cannot continue', () => {
    // NOTE: legs enter at 1x (the test harness skips the foundry 2x);
    // fire-vs-miss is distinguished by lastSpeedPortalId. The funnel
    // geometry (and the driver line) is speed-independent.
    const { sim: control } = flyLeg(0, 3.0, 1111, 0, 3.0, 1131);
    expect(control.speedMultiplier).toBe(1);
    expect(control.lastSpeedPortalId).toBe('ps-speed-approach');

    for (const [tx, ty] of [[0, 6.5], [4.8, 3.0]] as Array<[number, number]>) {
      const { sim, outcome } = flyLeg(tx, ty, 1111, tx, ty, 1131, tx > 2 ? 2 : 0);
      expect(sim.lastSpeedPortalId).not.toBe('ps-speed-approach');
      expect(outcome.status).toBe('dead');
      expect(outcome.z).toBeLessThan(1131);
    }
  });

  it('abyss-invert (ceiling, LEFT ring): the ring flips; high/side bypasses cannot continue', () => {
    const { sim: control, outcome: cOut } = flyLeg(0, 3.0, 1194, -2.6, 3.0, 1212);
    expect(cOut.grav).toBe('ceiling');
    expect(cOut.status).toBe('running');
    expect(control.playerMode).toBe('ship');

    for (const [tx, ty] of [[0, 6.5], [4.8, 3.0]] as Array<[number, number]>) {
      const { outcome } = flyLeg(tx, ty, 1194, tx, ty, 1212, tx > 2 ? 2 : 0);
      expect(outcome.grav).toBe('floor');
      expect(outcome.status).toBe('dead');
      expect(outcome.z).toBeLessThan(1212);
    }
  });

  it('abyss-revert (floor, HIGH-RIGHT ring): the ring flips back; a low bypass cannot continue', () => {
    // Full-route handoff: the reference driver threads the staggered
    // invert and flies the diagonal to z1240 (ceiling, right side); the
    // test pilot takes over for the station — hold the HIGH-RIGHT ring
    // (control) or dive low inside the same lane (bypass). (The driver
    // is not re-entrant mid-level — stale z-triggers would fire at once —
    // so the handoff always drives from the origin.)
    const run = (controlLine: boolean): { sim: GameSimulation; outcome: LegOutcome } => {
      const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
      const driver = new ShowcaseDriver('primary');
      for (let i = 0; i < 30000; i++) {
        if (sim.status !== 'running' || sim.player.position.z >= 1240) break;
        sim.update(driver.nextInput(sim.player.position.z, sim));
      }
      if (sim.playerMode !== 'ship' || sim.gravityMode !== 'ceiling') {
        throw new Error('handoff failed: not on the inverted diagonal');
      }
      const pilot = new Pilot();
      const outcome: LegOutcome = { status: '', z: 0, mode: '', grav: '', speed: 0 };
      for (let i = 0; i < 3000; i++) {
        if (sim.status !== 'running' || sim.player.position.z > 1260) break;
        const z = sim.player.position.z;
        // Widened read: the handoff guard above narrows the property chain
        // to 'ship' for the type-checker; gameplay can still leave ship.
        const modeNow: string = sim.playerMode;
        if (modeNow !== 'ship') {
          sim.update(idleInput);
          continue;
        }
        if (z < 1242) sim.update(pilot.next(sim, 2.6, 4.3));
        else if (z < 1250) sim.update(pilot.next(sim, 2.6, controlLine ? 5.5 : 2.2));
        else sim.update(pilot.next(sim, 2.6, controlLine ? 2.5 : 2.2));
      }
      outcome.status = sim.status;
      outcome.z = sim.player.position.z;
      outcome.mode = sim.playerMode;
      outcome.grav = sim.gravityMode;
      outcome.speed = sim.speedMultiplier;
      return { sim, outcome };
    };
    const control = run(true);
    expect(control.outcome.grav).toBe('floor');
    expect(control.outcome.status).toBe('running');

    const bypass = run(false);
    expect(bypass.outcome.grav).toBe('ceiling');
    expect(bypass.outcome.status).toBe('dead');
    expect(bypass.outcome.z).toBeLessThan(1260);
  });

  it('abyss-invert2 (ceiling): the ring flips; a side bypass cannot continue', () => {
    // NOTE: no clean HIGH line exists here pre-fix (burst teeth bottoms
    // 5.5 punish it — correct by design); the side line is the bypass.
    const { outcome: cOut } = flyLeg(0, 3.0, 1282, 0, 3.0, 1298);
    expect(cOut.grav).toBe('ceiling');
    expect(cOut.status).toBe('running');

    const { outcome } = flyLeg(4.8, 3.0, 1282, 4.8, 3.0, 1298, 2);
    expect(outcome.grav).toBe('floor');
    expect(outcome.status).toBe('dead');
    expect(outcome.z).toBeLessThan(1298);
  });

  it('abyss-revert2 (floor): the ring flips; a side bypass cannot continue', () => {
    // Two-phase leg: thread invert2 from just past the center pillar
    // (ceiling approach), then hold center (control) or dodge side
    // (bypass) through the revert2 station.
    const run = (txAtRevert2: number): { sim: GameSimulation; outcome: LegOutcome } => {
      const sim = enterShip();
      sim.debugPlaceAt(0, 3.0, 1283);
      const pilot = new Pilot();
      const outcome: LegOutcome = { status: '', z: 0, mode: '', grav: '', speed: 0 };
      for (let i = 0; i < 3000; i++) {
        if (sim.status !== 'running' || sim.player.position.z > 1315) break;
        const z = sim.player.position.z;
        if (sim.playerMode !== 'ship') {
          sim.update(idleInput);
          continue;
        }
        if (z < 1286) sim.update(pilot.next(sim, 0, 3.0));
        else sim.update(pilot.next(sim, txAtRevert2, 3.0));
      }
      outcome.status = sim.status;
      outcome.z = sim.player.position.z;
      outcome.mode = sim.playerMode;
      outcome.grav = sim.gravityMode;
      outcome.speed = sim.speedMultiplier;
      return { sim, outcome };
    };
    const control = run(0);
    expect(control.outcome.grav).toBe('floor');
    expect(control.outcome.status).toBe('running');

    const bypass = run(4.8);
    expect(bypass.outcome.grav).toBe('ceiling');
    expect(bypass.outcome.status).toBe('dead');
    expect(bypass.outcome.z).toBeLessThan(1315);
  });

  it('ship-off (cube): the ring exits ship mode; flying past it cannot continue', () => {
    const { sim: control, outcome: cOut } = flyLeg(0, 3.0, 1305, 0, 3.0, 1325);
    expect(control.isModePortalUsed('ps-ship-off')).toBe(true);
    expect(cOut.mode).toBe('cube');

    const { sim: bypass, outcome } = flyLeg(0, 6.0, 1305, 0, 6.0, 1325);
    expect(bypass.isModePortalUsed('ps-ship-off')).toBe(false);
    expect(outcome.status).toBe('dead');
    expect(outcome.z).toBeLessThan(1325);
  });

  it('speed-spider (2x): center takes the gate; a lane-0 sneak misses it and dies on teeth', () => {
    // NOTE: no funnel is built here — the lanes-0+2 teeth plus the
    // downstream spider-gate miss (cube into wall #1) already punish the
    // sneak naturally (lethal geometry, per §15). This test pins that the
    // sneak can never continue at 1x.
    const runCube = (lane0: boolean): { sim: GameSimulation; outcome: LegOutcome } => {
      const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
      // On the exit runway (top 0, z 1310..1330) as a 1x cube — the real
      // post-ship-off state.
      sim.debugPlaceAt(lane0 ? 2.6 : 0, 0.55, 1311);
      if (lane0) {
        // Hold lane 0 exactly (no transit — already there).
        sim.update(tapLeft);
        sim.update(idleInput);
      }
      const outcome: LegOutcome = { status: '', z: 0, mode: '', grav: '', speed: 0 };
      for (let i = 0; i < 3000; i++) {
        if (sim.status !== 'running' || sim.player.position.z > 1327) break;
        sim.update(idleInput);
      }
      outcome.status = sim.status;
      outcome.z = sim.player.position.z;
      outcome.mode = sim.playerMode;
      outcome.grav = sim.gravityMode;
      outcome.speed = sim.speedMultiplier;
      return { sim, outcome };
    };
    const control = runCube(false);
    expect(control.outcome.speed).toBe(2);
    expect(control.outcome.status).toBe('running');

    const bypass = runCube(true);
    expect(bypass.outcome.speed).toBe(1);
    expect(bypass.outcome.status).toBe('dead');
    expect(bypass.outcome.z).toBeLessThan(1327);
  });
});
