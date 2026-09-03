import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { PhysicalInputSnapshot } from '../src/input/InputSystem';

/**
 * M3 FLOOR COMPATIBILITY GATE (tests/floorCompat.test.ts).
 *
 * Golden trajectory captured from the human-approved pre-M3 build
 * (commit 4847e1d) BEFORE any architecture change: deterministic sim,
 * fixed input scripts, exact player state sampled at fixed ticks.
 * Values are pinned with EXACT float equality (toBe) — the M3 gameplay-frame
 * refactor must be bit-identical on Floor. Never regenerate against a
 * changed build to make a failing test pass; a mismatch is a defect.
 *
 * Scripts (ticks are 1-based sim steps at 120 Hz):
 *   holdJump30  : settle (1-60), hold jump (61-90), release, roll to 260
 *   jumpFastFall: settle (1-60), jump (61), fast-fall (62-100), roll to 220
 *   lanes       : settle, tap Right (70), tap Left (130), roll to 260
 */

const idle = (): PhysicalInputSnapshot => ({
  space: { held: false, pressedThisStep: false, releasedThisStep: false },
  up: { held: false, pressedThisStep: false, releasedThisStep: false },
  down: { held: false, pressedThisStep: false, releasedThisStep: false },
  laneLeft: { held: false, pressedThisStep: false, releasedThisStep: false },
  laneRight: { held: false, pressedThisStep: false, releasedThisStep: false },
});

function run(script: (tick: number) => PhysicalInputSnapshot, total: number, samples: Set<number>): Map<number, { x: number; y: number; z: number; vx: number; vy: number; vz: number; grounded: boolean }> {
  const sim = new GameSimulation(TEST_LEVEL);
  const out = new Map<number, { x: number; y: number; z: number; vx: number; vy: number; vz: number; grounded: boolean }>();
  for (let t = 1; t <= total; t++) {
    sim.update(script(t));
    if (samples.has(t)) {
      const p = sim.player.position;
      const v = sim.player.velocity;
      out.set(t, { x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, grounded: sim.player.grounded });
    }
    if (sim.status !== 'running') break;
  }
  return out;
}

const expectSample = (
  actual: { x: number; y: number; z: number; vx: number; vy: number; vz: number; grounded: boolean } | undefined,
  golden: { tick: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; grounded: boolean },
): void => {
  expect(actual, 'sample at tick ' + String(golden.tick)).toBeDefined();
  const a = actual as { x: number; y: number; z: number; vx: number; vy: number; vz: number; grounded: boolean };
  expect(a.x).toBe(golden.x);
  expect(a.y).toBe(golden.y);
  expect(a.z).toBe(golden.z);
  expect(a.vx).toBe(golden.vx);
  expect(a.vy).toBe(golden.vy);
  expect(a.vz).toBe(golden.vz);
  expect(a.grounded).toBe(golden.grounded);
};

const GOLDEN_HOLDJUMP30 = [{"tick":55,"x":0,"y":0.55,"z":2.416666666666668,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":60,"x":0,"y":0.55,"z":3.0000000000000013,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":61,"x":0,"y":0.66,"z":3.116666666666668,"vx":0,"vy":13.2,"vz":14,"grounded":false},{"tick":62,"x":0,"y":0.7670833333333333,"z":3.2333333333333347,"vx":0,"vy":12.85,"vz":14,"grounded":false},{"tick":65,"x":0,"y":1.0708333333333333,"z":3.583333333333335,"vx":0,"vy":11.8,"vz":14,"grounded":false},{"tick":70,"x":0,"y":1.51875,"z":4.166666666666668,"vx":0,"vy":10.050000000000002,"vz":14,"grounded":false},{"tick":75,"x":0,"y":1.8937499999999998,"z":4.749999999999999,"vx":0,"vy":8.300000000000004,"vz":14,"grounded":false},{"tick":80,"x":0,"y":2.1958333333333337,"z":5.33333333333333,"vx":0,"vy":6.550000000000006,"vz":14,"grounded":false},{"tick":85,"x":0,"y":2.4250000000000007,"z":5.916666666666662,"vx":0,"vy":4.800000000000008,"vz":14,"grounded":false},{"tick":90,"x":0,"y":2.5812500000000007,"z":6.499999999999993,"vx":0,"vy":3.0500000000000083,"vz":14,"grounded":false},{"tick":95,"x":0,"y":2.6645833333333337,"z":7.083333333333324,"vx":0,"vy":1.3000000000000078,"vz":14,"grounded":false},{"tick":100,"x":0,"y":2.675,"z":7.666666666666655,"vx":0,"vy":-0.4499999999999921,"vz":14,"grounded":false},{"tick":110,"x":0,"y":2.477083333333335,"z":8.833333333333325,"vx":0,"vy":-3.9499999999999926,"vz":14,"grounded":false},{"tick":130,"x":0,"y":1.2062500000000038,"z":11.166666666666668,"vx":0,"vy":-10.949999999999987,"vz":14,"grounded":false},{"tick":160,"x":0,"y":0.55,"z":14.666666666666682,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":200,"x":0,"y":0.55,"z":19.333333333333368,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":260,"x":0,"y":0.55,"z":26.333333333333396,"vx":0,"vy":0,"vz":14,"grounded":true}];

const GOLDEN_JUMPFASTFALL = [{"tick":61,"x":0,"y":0.66,"z":3.116666666666668,"vx":0,"vy":13.2,"vz":14,"grounded":false},{"tick":70,"x":0,"y":1.3468749999999998,"z":4.166666666666668,"vx":0,"vy":5.924999999999997,"vz":14,"grounded":false},{"tick":75,"x":0,"y":1.492708333333333,"z":4.749999999999999,"vx":0,"vy":1.8833333333333295,"vz":14,"grounded":false},{"tick":80,"x":0,"y":1.4701388888888887,"z":5.33333333333333,"vx":0,"vy":-2.158333333333337,"vz":14,"grounded":false},{"tick":82,"x":0,"y":1.413958333333333,"z":5.566666666666663,"vx":0,"vy":-3.775000000000004,"vz":14,"grounded":false},{"tick":85,"x":0,"y":1.2791666666666661,"z":5.916666666666662,"vx":0,"vy":-6.200000000000005,"vz":14,"grounded":false},{"tick":90,"x":0,"y":0.9197916666666659,"z":6.499999999999993,"vx":0,"vy":-10.241666666666672,"vz":14,"grounded":false},{"tick":95,"x":0,"y":0.55,"z":7.083333333333324,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":100,"x":0,"y":0.55,"z":7.666666666666655,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":110,"x":0,"y":0.55,"z":8.833333333333325,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":140,"x":0,"y":0.55,"z":12.33333333333334,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":180,"x":0,"y":0.55,"z":17.000000000000025,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":220,"x":0,"y":0.55,"z":21.66666666666671,"vx":0,"vy":0,"vz":14,"grounded":true}];

const GOLDEN_LANES = [{"tick":65,"x":0,"y":0.55,"z":3.583333333333335,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":70,"x":-0.007638888888888889,"y":0.55,"z":4.166666666666668,"vx":-0.9166666666666666,"vy":0,"vz":14,"grounded":true},{"tick":72,"x":-0.04583333333333333,"y":0.55,"z":4.4,"vx":-2.75,"vy":0,"vz":14,"grounded":true},{"tick":75,"x":-0.16041666666666665,"y":0.55,"z":4.749999999999999,"vx":-5.5,"vy":0,"vz":14,"grounded":true},{"tick":80,"x":-0.5041666666666667,"y":0.55,"z":5.33333333333333,"vx":-10.083333333333332,"vy":0,"vz":14,"grounded":true},{"tick":85,"x":-1.0388888888888888,"y":0.55,"z":5.916666666666662,"vx":-14.666666666666663,"vy":0,"vz":14,"grounded":true},{"tick":90,"x":-1.702083333333333,"y":0.55,"z":6.499999999999993,"vx":-16,"vy":0,"vz":14,"grounded":true},{"tick":100,"x":-2.577742051585002,"y":0.55,"z":7.666666666666655,"vx":-5.4454046190200245,"vy":0,"vz":14,"grounded":true},{"tick":130,"x":-2.5923611111111113,"y":0.55,"z":11.166666666666668,"vx":0.9166666666666666,"vy":0,"vz":14,"grounded":true},{"tick":132,"x":-2.5541666666666667,"y":0.55,"z":11.400000000000002,"vx":2.75,"vy":0,"vz":14,"grounded":true},{"tick":135,"x":-2.439583333333333,"y":0.55,"z":11.750000000000004,"vx":5.5,"vy":0,"vz":14,"grounded":true},{"tick":140,"x":-2.0958333333333337,"y":0.55,"z":12.33333333333334,"vx":10.083333333333332,"vy":0,"vz":14,"grounded":true},{"tick":150,"x":-0.8979166666666671,"y":0.55,"z":13.50000000000001,"vx":16,"vy":0,"vz":14,"grounded":true},{"tick":170,"x":0,"y":0.55,"z":15.833333333333353,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":200,"x":0,"y":0.55,"z":19.333333333333368,"vx":0,"vy":0,"vz":14,"grounded":true},{"tick":260,"x":0,"y":0.55,"z":26.333333333333396,"vx":0,"vy":0,"vz":14,"grounded":true}];

describe('M3 floor compatibility gate (golden trajectories pinned pre-refactor)', () => {
  it('holdJump30: floor trajectory bit-identical to the approved pre-M3 build', () => {
    const got = run(
      (t) => (t <= 60 ? idle() : t <= 90 ? { ...idle(), space: { held: true, pressedThisStep: t === 61, releasedThisStep: false } } : idle()),
      260,
      new Set([55, 60, 61, 62, 65, 70, 75, 80, 85, 90, 95, 100, 110, 130, 160, 200, 260]),
    );
    for (const g of GOLDEN_HOLDJUMP30) expectSample(got.get(g.tick), g);
  });
  it('jumpFastFall: floor trajectory bit-identical to the approved pre-M3 build', () => {
    const got = run(
      (t) => (t <= 60 ? idle() : t === 61 ? { ...idle(), space: { held: true, pressedThisStep: true, releasedThisStep: false } } : t <= 100 ? { ...idle(), down: { held: true, pressedThisStep: t === 62, releasedThisStep: false } } : idle()),
      220,
      new Set([61, 70, 75, 80, 82, 85, 90, 95, 100, 110, 140, 180, 220]),
    );
    for (const g of GOLDEN_JUMPFASTFALL) expectSample(got.get(g.tick), g);
  });
  it('lanes: floor trajectory bit-identical to the approved pre-M3 build', () => {
    const got = run(
      (t) => (t === 70 ? { ...idle(), laneRight: { held: false, pressedThisStep: true, releasedThisStep: true } } : t === 130 ? { ...idle(), laneLeft: { held: false, pressedThisStep: true, releasedThisStep: true } } : idle()),
      260,
      new Set([65, 70, 72, 75, 80, 85, 90, 100, 130, 132, 135, 140, 150, 170, 200, 260]),
    );
    for (const g of GOLDEN_LANES) expectSample(got.get(g.tick), g);
  });
});
