import { GameSimulation } from '../../src/game/GameSimulation';
import type { LevelDefinition } from '../../src/level/levelDefinition';
import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import { interpretPhysicalInput } from '../../src/input/InputSystem';

/**
 * Test-side route telemetry (M8.6): drives a scripted run and reports
 * action-density / verticality / lateral-movement metrics WITHOUT touching
 * the engine — pure observation of inputs fed + state trajectory.
 * Shared by the density contract tests (never imported by *.test.ts files
 * from each other — this is a non-test helper module).
 */

export interface RecoveryWindow {
  z0: number;
  z1: number;
}

export interface RouteMetrics {
  status: string;
  attempts: number;
  ticks: number;
  seconds: number;
  jumpEdges: number;
  /** Jump presses outside Ship mode (Cube/Spider skill jumps). */
  cubeJumpEdges: number;
  fastFallHeld: number;
  laneEdges: number;
  laneTargetChanges: number;
  shipThrustEdges: number;
  spiderPresses: number;
  gravityTransitions: number;
  modeTransitions: number;
  speedChanges: number;
  pads: number;
  orbs: number;
  minY: number;
  maxY: number;
  yRange: number;
  bandsVisited: number;
  bandTransitions: number;
  sumDy: number;
  minX: number;
  maxX: number;
  xRange: number;
  sumDx: number;
  xReversals: number;
  distinctSupports: number;
  supportChanges: number;
  platformSupports: string[];
  platformSupportTicks: number;
  /** Ticks with fast-fall deliberately held while airborne. */
  ffEngagedTicks: number;
  actionEvents: number;
  /** Max action gap in ticks OUTSIDE the recovery windows. */
  maxActionGapTicks: number;
  maxActionGapSec: number;
}

export const collectRouteMetrics = (
  def: LevelDefinition,
  inputFor: (z: number, sim: GameSimulation) => Readonly<PhysicalInputSnapshot>,
  opts: { maxTicks?: number; recoveryWindows?: RecoveryWindow[] } = {},
): RouteMetrics => {
  const sim = new GameSimulation(def);
  const maxTicks = opts.maxTicks ?? 30000;
  const windows = opts.recoveryWindows ?? [];
  const inWindow = (z: number): boolean => windows.some((w) => z >= w.z0 && z <= w.z1);

  let jumpEdges = 0;
  let cubeJumpEdges = 0;
  let fastFallHeld = 0;
  let laneEdges = 0;
  let laneTargetChanges = 0;
  let shipThrustEdges = 0;
  let spiderPresses = 0;
  let lastTarget = sim.player.targetLaneIndex;
  let lastShipHold = false;
  let gravTrans = 0;
  let modeTrans = 0;
  let lastSpeed = sim.speedMultiplier;
  let speedChanges = 0;
  let lastPads = 0;
  let lastOrbs = 0;
  let lastTeleports = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let sumDy = 0;
  let sumDx = 0;
  let prevX = sim.player.position.x;
  let prevY = sim.player.position.y;
  const bands = new Set<number>();
  let bandTrans = 0;
  let lastBand = -999;
  const supports = new Set<string>();
  let supportChanges = 0;
  let lastSupport: string | null = null;
  const platformSupports = new Set<string>();
  let platformSupportTicks = 0;
  let ffEngagedTicks = 0;
  let ffWasActive = false;
  let lastDxSign = 0;
  let revAccum = 0;
  let xReversals = 0;
  const actions: { tick: number; z: number }[] = [];
  let tick = 0;
  for (; tick < maxTicks; tick++) {
    if (sim.status !== 'running') break;
    const z = sim.player.position.z;
    const input = inputFor(z, sim);
    const logical = interpretPhysicalInput(input, sim.gravityMode);
    const isJump = logical.jump.pressedThisStep;
    // Logical lanes (gravity-relative): counts wall-gravity Up/Down taps too.
    const isLane = logical.laneLeft.pressedThisStep || logical.laneRight.pressedThisStep;
    if (isJump) jumpEdges++;
    if (isJump && sim.playerMode !== 'ship') cubeJumpEdges++;
    if (logical.fastFall.held) fastFallHeld++;
    if (isLane) laneEdges++;
    if (sim.playerMode === 'spider' && isJump) spiderPresses++;
    if (sim.playerMode === 'ship') {
      const hold = logical.jump.held;
      if (hold !== lastShipHold) shipThrustEdges++;
      lastShipHold = hold;
    }
    const transitioned =
      sim.portalTransitionCount !== gravTrans || sim.modeTransitionCount !== modeTrans;
    gravTrans = sim.portalTransitionCount;
    modeTrans = sim.modeTransitionCount;
    // Pads / orbs / teleports / speed changes are player interactions —
    // passive in input but decisive in execution, so they punctuate action.
    const interacted =
      sim.padActivationCount !== lastPads ||
      sim.orbActivationCount !== lastOrbs ||
      sim.teleportEventCount !== lastTeleports ||
      sim.speedMultiplier !== lastSpeed;
    lastPads = sim.padActivationCount;
    lastOrbs = sim.orbActivationCount;
    lastTeleports = sim.teleportEventCount;
    if (sim.speedMultiplier !== lastSpeed) speedChanges++;
    lastSpeed = sim.speedMultiplier;
    // Fast-fall engagement (deliberate held input while airborne) counts
    // as action on its rising edge — falling as a skill, not passivity.
    const ffActive = logical.fastFall.held && !sim.player.grounded;
    if (ffActive) ffEngagedTicks++;
    const ffEdge = ffActive && !ffWasActive;
    ffWasActive = ffActive;
    if (isJump || isLane || transitioned || interacted || ffEdge) actions.push({ tick, z });
    sim.update(input);
    const p = sim.player.position;
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    sumDy += Math.abs(p.y - prevY);
    sumDx += Math.abs(p.x - prevX);
    const dx = p.x - prevX;
    prevX = p.x;
    prevY = p.y;
    const s = Math.abs(dx) < 1e-9 ? 0 : Math.sign(dx);
    if (s !== 0) {
      if (lastDxSign !== 0 && s !== lastDxSign && revAccum > 0.5) xReversals++;
      if (s !== lastDxSign) revAccum = 0;
      lastDxSign = s;
      revAccum += Math.abs(dx);
    }
    const band = Math.floor(p.y / 2);
    bands.add(band);
    if (lastBand !== -999 && band !== lastBand) bandTrans++;
    lastBand = band;
    if (sim.player.targetLaneIndex !== lastTarget) laneTargetChanges++;
    lastTarget = sim.player.targetLaneIndex;
    const sup = sim.player.grounded ? (sim.player.supportColliderId ?? 'grounded?') : null;
    if (sup !== null) {
      supports.add(sup);
      if (sup.startsWith('platform-')) {
        platformSupports.add(sup);
        platformSupportTicks++;
      }
    }
    if (sup !== lastSupport) supportChanges++;
    lastSupport = sup;
  }
  let maxGap = 0;
  for (let i = 1; i < actions.length; i++) {
    const a = actions[i - 1];
    const b = actions[i];
    if (a === undefined || b === undefined) continue;
    // Exempt gaps fully inside a designated recovery window.
    if (inWindow(a.z) && inWindow(b.z)) continue;
    const gap = b.tick - a.tick;
    if (gap > maxGap) maxGap = gap;
  }
  return {
    status: sim.status,
    attempts: sim.attempts,
    ticks: tick,
    seconds: tick / 120,
    jumpEdges,
    cubeJumpEdges,
    fastFallHeld,
    laneEdges,
    laneTargetChanges,
    shipThrustEdges,
    spiderPresses,
    gravityTransitions: sim.portalTransitionCount,
    modeTransitions: sim.modeTransitionCount,
    speedChanges,
    pads: sim.padActivationCount,
    orbs: sim.orbActivationCount,
    minY: +minY.toFixed(2),
    maxY: +maxY.toFixed(2),
    yRange: +(maxY - minY).toFixed(2),
    bandsVisited: bands.size,
    bandTransitions: bandTrans,
    sumDy: +sumDy.toFixed(1),
    sumDx: +sumDx.toFixed(1),
    minX: +minX.toFixed(2),
    maxX: +maxX.toFixed(2),
    xRange: +(maxX - minX).toFixed(2),
    xReversals,
    distinctSupports: supports.size,
    supportChanges,
    platformSupports: [...platformSupports].sort(),
    platformSupportTicks,
    ffEngagedTicks,
    actionEvents: actions.length,
    maxActionGapTicks: maxGap,
    maxActionGapSec: +(maxGap / 120).toFixed(2),
  };
};
