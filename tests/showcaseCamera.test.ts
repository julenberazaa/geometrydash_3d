import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/game/GameSimulation';
import { SIMULATION_DT } from '../src/core/constants';
import { PRODUCTION_SHOWCASE_01 } from '../src/content/levels/productionShowcase01';
import { ChaseCamera, type CameraFocusSide } from '../src/camera/ChaseCamera';
import {
  CameraOcclusionResolver,
  CAMERA_OCCLUSION_TUNING,
  type CameraBlocker,
} from '../src/camera/CameraOcclusionResolver';
import { ShowcaseDriver } from './helpers/showcaseScript';

/**
 * M8.6 camera corrective pass — THE DESCENT full-route visibility sweep
 * (deterministic, pure math + sim, no browser): steps the ChaseCamera and
 * the occlusion resolver per tick alongside BOTH scripted reference routes,
 * exactly like RendererHost frames them (gravity-following side, grounded
 * gating, authoritative platform poses), and pins the two visibility
 * invariants over the real multi-deck level:
 *
 *  1. the resolved eye never sits inside (or within a skin of) solid geometry;
 *  2. the focus→resolved-eye segment never crosses an opaque blocking solid
 *     after resolution (no fade fallback needed anywhere on the route).
 *
 * This is the level-data-aware auditor for the new contracts — the camera
 * itself still never reads level data at runtime.
 */

const CAMERA_SKIN = 0.05;

const eyeInsideSolid = (
  eye: Readonly<{ x: number; y: number; z: number }>,
  colliders: readonly { center: { x: number; y: number; z: number }; halfExtents: { x: number; y: number; z: number } }[],
): boolean => {
  for (const c of colliders) {
    const dx = Math.min(eye.x - (c.center.x - c.halfExtents.x), c.center.x + c.halfExtents.x - eye.x);
    const dy = Math.min(eye.y - (c.center.y - c.halfExtents.y), c.center.y + c.halfExtents.y - eye.y);
    const dz = Math.min(eye.z - (c.center.z - c.halfExtents.z), c.center.z + c.halfExtents.z - eye.z);
    if (dx > -CAMERA_SKIN && dy > -CAMERA_SKIN && dz > -CAMERA_SKIN) return true;
  }
  return false;
};

/** Sampled segment-vs-true-solids test (the §20 visibility contract: the
 *  mathematical sight segment must not cross opaque blocking solids; the
 *  resolver's sweep radius + wall skin ride on top as robustness margin). */
const segmentBlocked = (
  from: Readonly<{ x: number; y: number; z: number }>,
  to: Readonly<{ x: number; y: number; z: number }>,
  blockers: readonly CameraBlocker[],
): boolean => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  for (let s = 0; s <= steps; s++) {
    const px = from.x + (dx * s) / steps;
    const py = from.y + (dy * s) / steps;
    const pz = from.z + (dz * s) / steps;
    for (const b of blockers) {
      if (
        px > b.minX && px < b.maxX &&
        py > b.minY && py < b.maxY &&
        pz > b.minZ && pz < b.maxZ
      ) {
        return true;
      }
    }
  }
  return false;
};

const focusSideFor = (gravityMode: string): CameraFocusSide => {
  switch (gravityMode) {
    case 'ceiling': return 'belowFocus';
    case 'leftWall': return 'freeMinusFocus';
    case 'rightWall': return 'freePlusFocus';
    default: return 'aboveFocus';
  }
};

const sweepRoute = (route: 'primary' | 'alternate'): {
  ticks: number;
  penetrations: number;
  blockedSegments: number;
  uncoveredBlocked: number;
  fadeTriggers: number;
  occludedFrames: number;
  minEyePlayerDist: number;
  worst: string;
} => {
  const sim = new GameSimulation(PRODUCTION_SHOWCASE_01);
  const driver = new ShowcaseDriver(route);
  const cam = new ChaseCamera();
  const resolver = new CameraOcclusionResolver();
  const colliders = sim.level.world.colliders();
  const solids = colliders.filter((c) => c.kind === 'solid');

  const staticBlockers: CameraBlocker[] = solids.map((c) => ({
    id: c.id,
    minX: c.center.x - c.halfExtents.x,
    minY: c.center.y - c.halfExtents.y,
    minZ: c.center.z - c.halfExtents.z,
    maxX: c.center.x + c.halfExtents.x,
    maxY: c.center.y + c.halfExtents.y,
    maxZ: c.center.z + c.halfExtents.z,
  }));
  const defs = sim.level.movingPlatforms;
  const platformScratch: CameraBlocker[] = defs.map((def) => ({
    id: `platform-${def.id}`,
    minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0,
  }));
  const allBlockers = [...staticBlockers, ...platformScratch];

  let penetrations = 0;
  let blockedSegments = 0;
  let uncoveredBlocked = 0;
  let fadeTriggers = 0;
  let occludedFrames = 0;
  let minEyePlayerDist = Infinity;
  let worst = '';
  let tick = 0;
  for (; tick < 30000; tick++) {
    if (sim.status !== 'running') break;
    sim.update(driver.nextInput(sim.player.position.z, sim));
    const status: string = sim.status;
    if (status !== 'running') break;
    const p = sim.player.position;
    cam.update(p, 0, SIMULATION_DT, focusSideFor(sim.gravityMode), sim.player.grounded);
    const states = sim.platformStates;
    for (let i = 0; i < platformScratch.length; i++) {
      const st = states[i];
      const def = defs[i];
      const b = platformScratch[i];
      if (st === undefined || def === undefined || b === undefined) continue;
      b.minX = st.x - def.halfExtents.x; b.maxX = st.x + def.halfExtents.x;
      b.minY = st.y - def.halfExtents.y; b.maxY = st.y + def.halfExtents.y;
      b.minZ = st.z - def.halfExtents.z; b.maxZ = st.z + def.halfExtents.z;
    }
    resolver.resolve(p, cam.currentPosition, cam.currentLookTarget, allBlockers, SIMULATION_DT);
    const eye = resolver.currentResolvedEye;
    if (eyeInsideSolid(eye, solids)) {
      penetrations++;
      if (worst === '') {
        worst = `penetration at tick ${tick} eye=(${eye.x.toFixed(2)},${eye.y.toFixed(2)},${eye.z.toFixed(2)}) player=(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) mode=${sim.gravityMode}`;
      }
    }
    if (segmentBlocked(p, eye, allBlockers)) {
      blockedSegments++;
      // §20: a blocked post-resolution segment is allowed ONLY when the
      // fade fallback explicitly covers it (needsOccluderFade this tick).
      if (!resolver.needsOccluderFade) {
        uncoveredBlocked++;
        if (worst === '') {
          worst = `UNCOVERED blocked segment at tick ${tick} eye=(${eye.x.toFixed(2)},${eye.y.toFixed(2)},${eye.z.toFixed(2)}) player=(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) mode=${sim.gravityMode}`;
        }
      }
    }
    if (resolver.needsOccluderFade) fadeTriggers++;
    if (resolver.isOccluded) occludedFrames++;
    const d = Math.hypot(eye.x - p.x, eye.y - p.y, eye.z - p.z);
    if (d < minEyePlayerDist) minEyePlayerDist = d;
  }
  return { ticks: tick, penetrations, blockedSegments, uncoveredBlocked, fadeTriggers, occludedFrames, minEyePlayerDist, worst };
};

describe('M8.6 THE DESCENT camera visibility sweep', () => {
  it('keeps the resolved eye out of solids with a clear sight line on the primary route', { timeout: 120000 }, () => {
    const r = sweepRoute('primary');
    expect(r.ticks, 'route must finish').toBeGreaterThan(14000);
    expect(r.worst).toBe('');
    expect(r.penetrations).toBe(0);
    // Every blocked post-resolution segment is explicitly fade-covered
    // (ship-tunnel min-clamp); none may go uncovered.
    expect(r.uncoveredBlocked).toBe(0);
    expect(r.minEyePlayerDist).toBeGreaterThanOrEqual(CAMERA_OCCLUSION_TUNING.minFocusDistance - 1e-6);
  });

  it('keeps the resolved eye out of solids with a clear sight line on the alternate route', { timeout: 120000 }, () => {
    const r = sweepRoute('alternate');
    expect(r.ticks, 'route must finish').toBeGreaterThan(14000);
    expect(r.worst).toBe('');
    expect(r.penetrations).toBe(0);
    expect(r.uncoveredBlocked).toBe(0);
    expect(r.minEyePlayerDist).toBeGreaterThanOrEqual(CAMERA_OCCLUSION_TUNING.minFocusDistance - 1e-6);
  });
});
