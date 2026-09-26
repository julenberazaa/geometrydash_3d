import { GameSimulation } from '../../src/game/GameSimulation';
import { ChaseCamera, type CameraFocusSide } from '../../src/camera/ChaseCamera';
import {
  CameraOcclusionResolver,
  type CameraBlocker,
} from '../../src/camera/CameraOcclusionResolver';
import { SIMULATION_DT } from '../../src/core/constants';
import type { LevelDefinition } from '../../src/level/levelDefinition';
import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';

/**
 * Headless sightline auditor (M9.6.1) — the executable form of the
 * GAME_DESIGN §7.10 visibility/telegraphing contract.
 *
 * Steps the resolved chase camera alongside a scripted reference route
 * (exactly like RendererHost frames it) and measures, for every
 * threat/decision/action point, when it is FIRST seen (in-frustum +
 * unoccluded from the resolved eye). Only on-line threats count: a
 * threat on a deck the route doesn't take is not a violation.
 *
 * Lives in a NON-TEST support module on purpose (test files must never
 * import another `*.test.ts` module). Deterministic, pure sim + math,
 * no browser, no replay data.
 */

/** Rule thresholds in seconds of travel (single owner, mirrors §7.10). */
export const SIGHTLINE_THRESHOLDS = {
  /** New lane/commit decisions (door gaps, lateral spikes, ferry boards). */
  decision: 0.7,
  /** Timed presses (orb windows). */
  action: 0.5,
  /** Passive gates/volumes (portals) and pad sightings. */
  routing: 0.4,
  /** Landing must read this long before touchdown when not seen at takeoff. */
  dropLead: 0.2,
  /** Dormant creature before its trigger. */
  chomper: 0.7,
  /** Sequenced-door follower: gap reads within this travel after the
   * previous door's plane (tutorial-rhythm exception, §7.10). */
  sequencedFollow: 0.5,
} as const;

export interface Vec3Like { x: number; y: number; z: number }

export interface SightInterest {
  id: string;
  kind: 'spike' | 'door' | 'chomper' | 'portal' | 'orb' | 'pad' | 'teleport' | 'ferrywatch';
  /** Watched point (dormant creature for chompers, gap/block for doors). */
  p: Vec3Like;
  /** Z the player must act by (defaults to the point's z). */
  actZ: number;
  /** Threat box for the on-line filter (center + half extents). */
  box: { center: Vec3Like; half: Vec3Like };
  /** Chompers only: the lunge corridor (the actual threat volume). */
  laneBox?: { center: Vec3Like; half: Vec3Like };
}

export interface SightVerdict {
  id: string;
  kind: SightInterest['kind'];
  actZ: number;
  online: boolean;
  seenAtZ: number | null;
  /** Seconds of travel between first sight and the act. */
  sightTime: number;
  /** Runner lateral spread over the 15 u before the act (pad shaping rule). */
  approachSpread: number;
}

export interface WalkoffVerdict {
  takeoffZ: number;
  landingZ: number;
  fatal: boolean;
  landingSeenAtTakeoff: boolean;
  /** Seconds before touchdown the landing first reads (0 when never). */
  leadTime: number;
  edgeVisible: boolean;
  landingZoneClear: boolean;
  ok: boolean;
}

export interface SpiderSnapSight {
  z: number;
  destVisible: boolean;
  reason: 'visible' | 'out-of-frame' | 'occluded';
}

export interface SightlineReport {
  ticks: number;
  finished: boolean;
  verdicts: SightVerdict[];
  walkoffs: WalkoffVerdict[];
  spiderSnaps: SpiderSnapSight[];
}

export interface SightDriver {
  nextInput(z: number, sim: GameSimulation): PhysicalInputSnapshot;
}

const focusSideFor = (gravityMode: string): CameraFocusSide => {
  switch (gravityMode) {
    case 'ceiling': return 'belowFocus';
    case 'leftWall': return 'freeMinusFocus';
    case 'rightWall': return 'freePlusFocus';
    default: return 'aboveFocus';
  }
};

const norm = (v: Vec3Like): Vec3Like => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/** Frustum proxy: FOV 62 vertical, 16:9 aspect (matches the chase camera). */
const inFrustum = (
  eye: Vec3Like,
  look: Vec3Like,
  p: Vec3Like,
): boolean => {
  const f = norm({ x: look.x - eye.x, y: look.y - eye.y, z: look.z - eye.z });
  const r = norm({ x: -f.z, y: 0, z: f.x });
  const u = {
    x: r.y * f.z - r.z * f.y,
    y: r.z * f.x - r.x * f.z,
    z: r.x * f.y - r.y * f.x,
  };
  const d = norm({ x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z });
  const z = d.x * f.x + d.y * f.y + d.z * f.z;
  if (z < 0.3) return false;
  const x = (d.x * r.x + d.y * r.y + d.z * r.z) / z;
  const y = (d.x * u.x + d.y * u.y + d.z * u.z) / z;
  return Math.abs(x) < 1.05 && Math.abs(y) < 0.58;
};

/** Segment vs AABB overlap (slab test) — the on-line filter mirrors the
 *  sim's swept-path philosophy: a threat is on-line iff the runner's
 *  swept path actually engages it (within a 0.5 margin). */
const segmentOverlapsBox = (
  a: Vec3Like,
  b: Vec3Like,
  center: Vec3Like,
  half: Vec3Like,
  margin: number,
): boolean => {
  let tmin = 0;
  let tmax = 1;
  const mins = [center.x - half.x - margin, center.y - half.y - margin, center.z - half.z - margin];
  const maxs = [center.x + half.x + margin, center.y + half.y + margin, center.z + half.z + margin];
  const av = [a.x, a.y, a.z];
  const bv = [b.x, b.y, b.z];
  for (let i = 0; i < 3; i++) {
    const d = (bv[i] ?? 0) - (av[i] ?? 0);
    const lo = mins[i] ?? 0;
    const hi = maxs[i] ?? 0;
    if (Math.abs(d) < 1e-9) {
      if ((av[i] ?? 0) < lo || (av[i] ?? 0) > hi) return false;
    } else {
      let t0 = (lo - (av[i] ?? 0)) / d;
      let t1 = (hi - (av[i] ?? 0)) / d;
      if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
      }
      tmin = Math.max(tmin, t0);
      tmax = Math.min(tmax, t1);
      if (tmin > tmax) return false;
    }
  }
  return true;
};

/** Sampled segment eye→point vs blockers; skips the point's own host. */
const occluded = (
  eye: Vec3Like,
  p: Vec3Like,
  blockers: readonly CameraBlocker[],
): boolean => {
  const dx = p.x - eye.x;
  const dy = p.y - eye.y;
  const dz = p.z - eye.z;
  const dist = Math.hypot(dx, dy, dz);
  const steps = Math.max(1, Math.ceil(dist / 0.5));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (t > 0.94) continue;
    const px = eye.x + dx * t;
    const py = eye.y + dy * t;
    const pz = eye.z + dz * t;
    for (const b of blockers) {
      if (px > b.minX && px < b.maxX && py > b.minY && py < b.maxY && pz > b.minZ && pz < b.maxZ) {
        return true;
      }
    }
  }
  return false;
};

/** All decision/action points of a level (threats, gates, pickups). */
export const buildSightInterests = (def: LevelDefinition): SightInterest[] => {
  const out: SightInterest[] = [];
  const boxOf = (center: Vec3Like, half: Vec3Like): SightInterest['box'] => ({
    center: { ...center },
    half: { ...half },
  });
  for (const h of def.hazards) {
    const isDoor = h.kind === 'killFront';
    out.push({
      id: `${isDoor ? 'door' : 'spike'}@${h.center.x},${h.center.y},${h.center.z}`,
      kind: isDoor ? 'door' : 'spike',
      p: { ...h.center },
      actZ: h.center.z,
      box: boxOf(h.center, h.halfExtents),
    });
  }
  for (const c of def.chompers ?? []) {
    const x1 = c.dormant.x + c.lungeDirection * c.lungeDistance;
    out.push({
      id: `chomper@${c.triggerZ}`,
      kind: 'chomper',
      p: { ...c.dormant },
      actZ: c.triggerZ,
      box: boxOf(c.dormant, { x: 1.5, y: 1.5, z: 1.5 }),
      // The lunge corridor is the threat volume (the dormant spot only
      // telegraphs it): x from dormant to end, lunge height, ±2 in z.
      laneBox: boxOf(
        { x: (c.dormant.x + x1) / 2, y: c.dormant.y, z: c.dormant.z },
        { x: Math.abs(x1 - c.dormant.x) / 2, y: 1.5, z: 2.0 },
      ),
    });
  }
  const gate = (
    id: string, center: Vec3Like | undefined, fallbackZ: number, half: Vec3Like,
  ): void => {
    const c = center ?? { x: 0, y: 1.5, z: fallbackZ };
    out.push({
      id, kind: 'portal', p: { ...c }, actZ: fallbackZ, box: boxOf(c, half),
    });
  };
  for (const g of def.gravityPortals ?? []) {
    gate(`gportal@${g.z}`, g.triggerCenter, g.z, g.triggerHalfExtents ?? { x: 5, y: 3, z: 0.5 });
  }
  for (const m of def.modePortals ?? []) {
    gate(`mportal@${m.z}`, m.triggerCenter, m.z, m.triggerHalfExtents ?? { x: 5, y: 3, z: 0.5 });
  }
  for (const s of def.speedPortals ?? []) {
    gate(`sportal@${s.z}`, s.triggerCenter, s.z, s.triggerHalfExtents ?? { x: 5, y: 3, z: 0.5 });
  }
  for (const o of [...(def.jumpOrbs ?? []), ...(def.gravityOrbs ?? [])]) {
    const center = (o as { center: Vec3Like }).center;
    const half = (o as { halfExtents?: Vec3Like }).halfExtents ?? { x: 1, y: 1, z: 1 };
    out.push({ id: `orb@${center.x},${center.z}`, kind: 'orb', p: { ...center }, actZ: center.z, box: boxOf(center, half) });
  }
  for (const pd of def.jumpPads ?? []) {
    out.push({
      id: `pad@${pd.center.x},${pd.center.z}`, kind: 'pad', p: { ...pd.center }, actZ: pd.center.z,
      box: boxOf(pd.center, pd.halfExtents),
    });
  }
  for (const t of def.teleportPortals ?? []) {
    const c = t.entryCenter ?? { x: 0, y: 1.5, z: t.entryZ };
    const half = t.entryHalfExtents ?? { x: 5, y: 3, z: 0.5 };
    out.push({ id: `teleport@${t.entryZ}`, kind: 'teleport', p: { ...c }, actZ: t.entryZ, box: boxOf(c, half) });
  }
  return out;
};

interface TickFrame {
  eye: Vec3Like;
  look: Vec3Like;
  p: Vec3Like;
  speed: number;
  z: number;
  grounded: boolean;
  mode: string;
}

/**
 * Run the full sightline sweep for one reference route. Returns per-point
 * verdicts (sight time until the act), walk-off verdicts under R-drop,
 * and spider snap destination readability.
 */
export const auditSightlines = (
  def: LevelDefinition,
  driver: SightDriver,
  opts: { stride?: number } = {},
): SightlineReport => {
  const stride = opts.stride ?? 4;
  const sim = new GameSimulation(def);
  const cam = new ChaseCamera();
  const resolver = new CameraOcclusionResolver();
  const colliders = sim.level.world.colliders();
  const solids = colliders.filter((c) => c.kind === 'solid' || c.kind === 'killFront');
  const staticBlockers: CameraBlocker[] = solids.map((c) => ({
    id: c.id,
    minX: c.center.x - c.halfExtents.x, minY: c.center.y - c.halfExtents.y, minZ: c.center.z - c.halfExtents.z,
    maxX: c.center.x + c.halfExtents.x, maxY: c.center.y + c.halfExtents.y, maxZ: c.center.z + c.halfExtents.z,
  }));
  const platformDefs = sim.level.movingPlatforms;
  const platformScratch: CameraBlocker[] = platformDefs.map((platformDef) => ({
    id: `platform-${platformDef.id}`, minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0,
  }));
  const allBlockers = [...staticBlockers, ...platformScratch];
  const frames: TickFrame[] = [];
  const spiderSnaps: SpiderSnapSight[] = [];
  interface PendingWalkoff {
    eye: Vec3Like; look: Vec3Like; z: number; tick: number; blockers: CameraBlocker[];
  }
  let pendingWalkoff: PendingWalkoff | null = null;
  let prevGrounded = true;
  let lastSupportId: string | null = null;
  let prevPads = 0;
  let prevOrbs = 0;
  let prevTeleports = 0;
  let prevModes = 0;
  let prevGravs = 0;
  let lastSnapCount = 0;
  interface RawWalkoff {
    takeoff: PendingWalkoff; landing: Vec3Like | null; fatal: boolean; landingTick: number;
    supportId: string | null;
  }
  const rawWalkoffs: RawWalkoff[] = [];
  let tick = 0;
  for (; tick < 30000; tick++) {
    if (sim.status !== 'running') {
      if (pendingWalkoff !== null) {
        rawWalkoffs.push({ takeoff: pendingWalkoff, landing: null, fatal: true, landingTick: tick, supportId: null });
        pendingWalkoff = null;
      }
      break;
    }
    const preInput = driver.nextInput(sim.player.position.z, sim);
    const anyEdge =
      preInput.space.pressedThisStep || preInput.up.pressedThisStep || preInput.down.pressedThisStep ||
      preInput.laneLeft.pressedThisStep || preInput.laneRight.pressedThisStep;
    const preMode = sim.playerMode;
    const preGrav = sim.gravityMode;
    sim.update(preInput);
    const postStatus: string = sim.status;
    if (postStatus !== 'running') {
      if (pendingWalkoff !== null) {
        rawWalkoffs.push({ takeoff: pendingWalkoff, landing: null, fatal: true, landingTick: tick, supportId: null });
        pendingWalkoff = null;
      }
      break;
    }
    const p = sim.player.position;
    cam.update(p, 0, SIMULATION_DT, focusSideFor(sim.gravityMode), sim.player.grounded);
    const states = sim.platformStates;
    for (let i = 0; i < platformScratch.length; i++) {
      const st = states[i];
      const platformDef = platformDefs[i];
      const b = platformScratch[i];
      if (st === undefined || platformDef === undefined || b === undefined) continue;
      b.minX = st.x - platformDef.halfExtents.x; b.maxX = st.x + platformDef.halfExtents.x;
      b.minY = st.y - platformDef.halfExtents.y; b.maxY = st.y + platformDef.halfExtents.y;
      b.minZ = st.z - platformDef.halfExtents.z; b.maxZ = st.z + platformDef.halfExtents.z;
    }
    resolver.resolve(p, cam.currentPosition, cam.currentLookTarget, allBlockers, SIMULATION_DT);
    const eye = resolver.currentResolvedEye;
    const eyeV: Vec3Like = { x: eye.x, y: eye.y, z: eye.z };
    const lookV: Vec3Like = {
      x: cam.currentLookTarget.x, y: cam.currentLookTarget.y, z: cam.currentLookTarget.z,
    };
    // Guided-flight guard: a mode/gravity/teleport transition voids any
    // pending walk-off (ship flights, portal rides — not walk-offs).
    if (
      sim.modeTransitionCount !== prevModes || sim.portalTransitionCount !== prevGravs ||
      sim.teleportEventCount !== prevTeleports
    ) {
      pendingWalkoff = null;
    }
    const assisted =
      anyEdge || sim.padActivationCount !== prevPads || sim.orbActivationCount !== prevOrbs ||
      sim.playerMode !== 'cube' || preMode !== 'cube' || sim.gravityMode !== preGrav;
    // Mid-fall assistance (e.g. dropping onto a pad) also guides the fall.
    if (
      pendingWalkoff !== null &&
      (sim.padActivationCount !== prevPads || sim.orbActivationCount !== prevOrbs)
    ) {
      pendingWalkoff = null;
    }
    prevPads = sim.padActivationCount;
    prevOrbs = sim.orbActivationCount;
    prevTeleports = sim.teleportEventCount;
    prevModes = sim.modeTransitionCount;
    prevGravs = sim.portalTransitionCount;
    if (prevGrounded && !sim.player.grounded && !assisted && pendingWalkoff === null) {
      pendingWalkoff = {
        eye: { ...eyeV }, look: { ...lookV }, z: p.z, tick,
        blockers: allBlockers.map((b) => ({ ...b })),
      };
    }
    if (sim.player.grounded && pendingWalkoff !== null) {
      const w = pendingWalkoff;
      pendingWalkoff = null;
      rawWalkoffs.push({
        takeoff: w, landing: { ...p }, fatal: false, landingTick: tick,
        supportId: lastSupportId,
      });
    }
    if (sim.player.grounded) lastSupportId = sim.player.supportColliderId;
    if (sim.spiderSnapEventCount > lastSnapCount) {
      lastSnapCount = sim.spiderSnapEventCount;
      const dest = sim.lastSpiderSnapTo;
      const destV: Vec3Like = { x: dest.x, y: dest.y, z: dest.z };
      const inFr = inFrustum(eyeV, lookV, destV);
      const occ = occluded(eyeV, destV, allBlockers);
      spiderSnaps.push({
        z: p.z,
        destVisible: inFr && !occ,
        reason: !inFr ? 'out-of-frame' : occ ? 'occluded' : 'visible',
      });
    }
    frames.push({
      eye: { ...eyeV }, look: { ...lookV }, p: { x: p.x, y: p.y, z: p.z },
      speed: sim.currentForwardSpeed, z: p.z, grounded: sim.player.grounded, mode: sim.playerMode,
    });
    prevGrounded = sim.player.grounded;
  }

  // Per-point verdicts (on-line filter + first sight).
  const interests = buildSightInterests(def);
  const verdicts: SightVerdict[] = [];
  for (const it of interests) {
    // On-line filter (else it's another deck's business and its own
    // line audits it):
    // - chompers: positional triggers, always on-line;
    // - doors: the gate confronts whoever crosses its plane inside the
    //   corridor at a readable height (margin 1.0 — passing 2.5 u under
    //   a tall wall is not a confrontation);
    // - chompers: the lunge corridor must engage the runner (the
    //   dormant spot only telegraphs it — a lunge 4 u below your deck
    //   is another line's business);
    // - everything else: the swept path must engage the box (+0.5) —
    //   a near miss that never overlaps is a startle, not a violation.
    // Forward-travel guard (dz in (0,2]) excludes teleports/respawns.
    let online = false;
    {
      for (let i = 1; i < frames.length; i += 1) {
        const prev = frames[i - 1];
        const f = frames[i];
        if (prev === undefined || f === undefined) continue;
        const dz = f.z - prev.z;
        if (dz <= 0 || dz > 2) continue;
        // Chompers test the lunge corridor (their threat volume).
        if (it.kind === 'chomper' && it.laneBox !== undefined) {
          if (segmentOverlapsBox(prev.p, f.p, it.laneBox.center, it.laneBox.half, 0.5)) {
            online = true;
            break;
          }
          continue;
        }
        if (it.kind === 'door') {
          const z0 = it.actZ;
          if ((prev.z - z0) * (f.z - z0) > 0) continue;
          const t = (z0 - prev.z) / dz;
          const cx = prev.p.x + (f.p.x - prev.p.x) * t;
          const cy = prev.p.y + (f.p.y - prev.p.y) * t;
          if (Math.abs(cx) > 6.5) continue;
          const dy = Math.abs(cy - it.box.center.y) - (0.55 + it.box.half.y + 1.0);
          if (dy < 0) {
            online = true;
            break;
          }
        } else if (segmentOverlapsBox(prev.p, f.p, it.box.center, it.box.half, 0.5)) {
          online = true;
          break;
        }
      }
    }
    let seen = false;
    let seenAtZ = 0;
    for (let i = 0; i < frames.length; i += stride) {
      const f = frames[i];
      if (f === undefined) continue;
      if (f.z < it.actZ - 130 || f.z > it.actZ + 1) continue;
      if (!inFrustum(f.eye, f.look, it.p)) continue;
      if (occluded(f.eye, it.p, staticBlockers)) continue;
      seen = true;
      seenAtZ = f.z;
      break;
    }
    let sightTime = 0;
    let approachSpread = 0;
    if (seen) {
      const idx = frames.findIndex((f) => f.z >= seenAtZ);
      const speed = frames[idx]?.speed ?? 14;
      sightTime = (it.actZ - seenAtZ) / speed;
      // Lateral spread over the 15 u approach (pad shaping rule).
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < frames.length; i += stride) {
        const f = frames[i];
        if (f === undefined || f.z < it.actZ - 15 || f.z > it.actZ) continue;
        minX = Math.min(minX, f.p.x);
        maxX = Math.max(maxX, f.p.x);
      }
      approachSpread = maxX >= minX ? maxX - minX : 0;
    }
    verdicts.push({ id: it.id, kind: it.kind, actZ: it.actZ, online, seenAtZ: seen ? seenAtZ : null, sightTime, approachSpread });
  }

  // Walk-off verdicts under R-drop.
  const walkoffs: WalkoffVerdict[] = [];
  for (const w of rawWalkoffs) {
    if (w.landing === null || w.fatal) {
      walkoffs.push({
        takeoffZ: w.takeoff.z, landingZ: -1, fatal: true, landingSeenAtTakeoff: false,
        leadTime: 0, edgeVisible: false, landingZoneClear: false, ok: false,
      });
      continue;
    }
    const landing = w.landing;
    const landingSeenAtTakeoff =
      inFrustum(w.takeoff.eye, w.takeoff.look, landing) &&
      !occluded(w.takeoff.eye, landing, w.takeoff.blockers);
    // First sight during the fall (frames between takeoff and landing).
    let leadTime = 0;
    if (!landingSeenAtTakeoff) {
      for (let i = 0; i < frames.length; i += stride) {
        const f = frames[i];
        if (f === undefined || f.z < w.takeoff.z || f.z > landing.z) continue;
        if (inFrustum(f.eye, f.look, landing) && !occluded(f.eye, landing, staticBlockers)) {
          leadTime = (landing.z - f.z) / (f.speed || 14);
          break;
        }
      }
    } else {
      leadTime = (landing.z - w.takeoff.z) / 14;
    }
    // Edge readability: the support's far lip reads ~0.3 s before
    // takeoff (static blockers only — platforms drift slightly).
    let edgeVisible = false;
    if (w.supportId !== null) {
      const support = colliders.find((c) => c.id === w.supportId);
      if (support !== undefined) {
        const lip: Vec3Like = {
          x: w.takeoff.eye.x,
          y: support.center.y + support.halfExtents.y,
          z: support.center.z + support.halfExtents.z,
        };
        for (let i = 0; i < frames.length; i += stride) {
          const f = frames[i];
          if (f === undefined || f.z < w.takeoff.z - 5 || f.z > w.takeoff.z) continue;
          if (inFrustum(f.eye, f.look, lip) && !occluded(f.eye, lip, staticBlockers)) {
            edgeVisible = true;
            break;
          }
        }
      }
    }
    // Landing-zone lethality: any hazard/killFront/lava collider within
    // 8 u past the landing, overlapping the landing corridor.
    let landingZoneClear = true;
    for (const c of colliders) {
      if (c.kind !== 'hazard' && c.kind !== 'killFront') continue;
      const z0 = c.center.z - c.halfExtents.z;
      const z1 = c.center.z + c.halfExtents.z;
      if (z1 < landing.z - 2 || z0 > landing.z + 8) continue;
      const dx = Math.abs(c.center.x - landing.x) - (c.halfExtents.x + 1.5);
      const dy = Math.abs(c.center.y - landing.y) - (c.halfExtents.y + 1.5);
      if (dx < 0 && dy < 0) {
        landingZoneClear = false;
        break;
      }
    }
    const ok =
      landingSeenAtTakeoff || leadTime >= SIGHTLINE_THRESHOLDS.dropLead ||
      (edgeVisible && landingZoneClear);
    walkoffs.push({
      takeoffZ: w.takeoff.z, landingZ: landing.z, fatal: false,
      landingSeenAtTakeoff, leadTime, edgeVisible, landingZoneClear, ok,
    });
  }
  return { ticks: tick, finished: sim.status === 'finished', verdicts, walkoffs, spiderSnaps };
};
