import { describe, expect, it } from 'vitest';
import { ChaseCamera, CAMERA_TUNING } from '../src/camera/ChaseCamera';
import { SIMULATION_DT } from '../src/core/constants';
import type { Collider } from '../src/collision/collider';
import { TEST_LEVEL } from '../src/content/levels/testLevel01';
import type { PhysicalInputSnapshot } from '../src/input/InputSystem';
import { GameSimulation } from '../src/game/GameSimulation';
import { idleInput, tapLaneLeft, tapLaneRight } from './helpers/simulation';

/**
 * M3.1 camera-framing regression: the chase camera EYE must never sit inside
 * (or within a skin of) blocking level geometry — including the M3 ceiling
 * section, where the pre-M3.1 framing penetrated the ceiling slabs (the slab
 * rendered invisible from inside via backface culling, leaving only floating
 * neon edge lines — the reported "camera fighting the ceiling / cube
 * floating" playtest defect).
 *
 * The camera is pure math and never reads level data at runtime; this test is
 * the level-data-aware auditor that owns that invariant.
 */

const CAMERA_SKIN = 0.05;

const eyeInsideAnySolid = (
  eye: Readonly<{ x: number; y: number; z: number }>,
  colliders: readonly Collider[],
): { colliderId: string; depth: number } | null => {
  let worst: { colliderId: string; depth: number } | null = null;
  for (const c of colliders) {
    const dx = Math.min(eye.x - (c.center.x - c.halfExtents.x), c.center.x + c.halfExtents.x - eye.x);
    const dy = Math.min(eye.y - (c.center.y - c.halfExtents.y), c.center.y + c.halfExtents.y - eye.y);
    const dz = Math.min(eye.z - (c.center.z - c.halfExtents.z), c.center.z + c.halfExtents.z - eye.z);
    if (dx > -CAMERA_SKIN && dy > -CAMERA_SKIN && dz > -CAMERA_SKIN) {
      const depth = Math.min(dx, dy, dz) + CAMERA_SKIN;
      if (worst === null || depth > worst.depth) {
        worst = { colliderId: c.id, depth };
      }
    }
  }
  return worst;
};

/** Idle snapshot with Space pressed (universal jump). */
const holdSpace = (): PhysicalInputSnapshot => ({
  ...idleInput,
  space: { held: true, pressedThisStep: true, releasedThisStep: false },
});

describe('ChaseCamera framing invariants', () => {
  it('frames a ceiling-resting player from inside the corridor, below the focus', () => {
    // Ceiling rest on the test level: slab underside y=6, cube center y=5.45.
    const cam = new ChaseCamera();
    const player = { x: 0, y: 5.45, z: 210 };
    cam.snapTo(player, 0, 'belowFocus');
    const eye = cam.currentPosition;
    // The camera must hang BELOW the focus on the ceiling (opposite side from
    // the floor framing, which sits above) so it stays in the open corridor.
    expect(eye.y).toBeLessThan(player.y);
  });

  it('keeps floor/ceiling framing parity: comparable eye distance and centered player (M3.2)', () => {
    // M3.2 audit measurements: the remaining ceiling readability gap was NOT
    // camera framing (eye-to-player distance 10.55 vs 10.30, apparent cube
    // width within ~5%, both players near the vertical middle of the frame).
    // These bounds pin that parity so future framing changes cannot silently
    // reintroduce a view disadvantage on either surface.
    const rest = (y: number, side: 'aboveFocus' | 'belowFocus') => {
      const cam = new ChaseCamera();
      const player = { x: 0, y, z: 210 };
      cam.snapTo(player, 0, side);
      const eye = cam.currentPosition;
      const dist = Math.hypot(player.x - eye.x, player.y - eye.y, player.z - eye.z);
      // Player vertical NDC via the pure-math camera basis (fov 62, up +Y).
      const look = cam.currentLookTarget;
      let fx = look.x - eye.x, fy = look.y - eye.y, fz = look.z - eye.z;
      const fl = Math.hypot(fx, fy, fz);
      fx /= fl; fy /= fl; fz /= fl;
      // right = normalize(forward × worldUp); upv = right × forward
      let rx = -fz;
      const ry = 0;
      let rz = fx;
      const rl = Math.hypot(rx, ry, rz);
      rx /= rl; rz /= rl;
      const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
      const dx = player.x - eye.x, dy = player.y - eye.y, dz = player.z - eye.z;
      const upComp = dx * ux + dy * uy + dz * uz;
      const fwdComp = dx * fx + dy * fy + dz * fz;
      const ndcY = upComp / (fwdComp * Math.tan((62 / 2) * (Math.PI / 180)));
      return { dist, ndcY };
    };
    const floor = rest(0.55, 'aboveFocus');
    const ceiling = rest(5.45, 'belowFocus');
    // Apparent size scales ~1/distance: comparable framing within 15%.
    const ratio = ceiling.dist / floor.dist;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
    // Player stays in the middle band of the frame on BOTH surfaces.
    expect(Math.abs(floor.ndcY)).toBeLessThan(0.6);
    expect(Math.abs(ceiling.ndcY)).toBeLessThan(0.6);
  });

  it('camera eye never enters blocking geometry across the full Test-Level playthrough', () => {
    const sim = new GameSimulation(TEST_LEVEL);
    const cam = new ChaseCamera();
    const colliders = sim.level.world.colliders();

    // Same deterministic closed-loop script as the gravity playthrough test
    // (jump takeoff windows + lane taps + M4 orb presses in traversal order).
    const jumps: Array<[number, number]> = [
      [39.8, 45],
      [54.5, 58],
      [73.6, 76],
      [121.69, 121.99],
      [138.35, 141.4],
      [151.9, 153.9],
      [228.65, 232.5],
      [329.5, 331.5], // M4: runway F edge -> jump-orb gap
      [348.0, 350.5], // M4: runway G edge -> jump toward the gravity orb
    ];
    const orbPresses: Array<[number, number]> = [
      [336.0, 338.0], // M4 jump orb window
      [351.0, 352.9], // M4 gravity orb window
    ];
    const laneTaps: Array<[number, PhysicalInputSnapshot]> = [
      [110, tapLaneRight],
      [132, tapLaneLeft],
    ];
    let ji = 0;
    let li = 0;
    let oi = 0;
    let finished = false;
    let hitCount = 0;
    let worst: { colliderId: string; depth: number; eyeY: number; eyeZ: number; mode: string } | null = null;

    for (let t = 0; t < 9000; t++) {
      const z = sim.player.position.z;
      const laneTap = li < laneTaps.length ? laneTaps[li] : undefined;
      const orbPress = oi < orbPresses.length ? orbPresses[oi] : undefined;
      let input = idleInput;
      if (laneTap !== undefined && z >= laneTap[0]) {
        input = laneTap[1];
        li++;
      } else if (orbPress !== undefined && z >= orbPress[0] && z <= orbPress[1]) {
        input = holdSpace();
        oi++;
      } else {
        const jump = ji < jumps.length ? jumps[ji] : undefined;
        if (jump !== undefined && sim.player.grounded && z >= jump[0] && z <= jump[1]) {
          input = holdSpace();
          ji++;
        }
      }
      sim.update(input);
      // Camera advances with render dt = one simulation step (deterministic),
      // framed exactly like RendererHost frames it (gravity-following side).
      cam.update(
        sim.player.position,
        0,
        SIMULATION_DT,
        sim.gravityMode === 'ceiling' ? 'belowFocus' : 'aboveFocus',
      );
      if (sim.status === 'running') {
        const eye = cam.currentPosition;
        const hit = eyeInsideAnySolid(eye, colliders);
        if (hit) {
          hitCount++;
          if (worst === null || hit.depth > worst.depth) {
            worst = { ...hit, eyeY: eye.y, eyeZ: eye.z, mode: sim.gravityMode };
          }
        }
      }
      if (sim.status === 'finished') {
        finished = true;
        break;
      }
      expect(sim.status, `died at tick ${t} z=${z.toFixed(1)}`).toBe('running');
    }

    expect(finished).toBe(true);
    expect(hitCount).toBe(0);
    expect(
      worst,
      worst
        ? `camera eye entered solid "${worst.colliderId}" by ${worst.depth.toFixed(3)}u at y=${worst.eyeY.toFixed(2)} z=${worst.eyeZ.toFixed(2)} (mode=${worst.mode})`
        : '',
    ).toBeNull();
  });
});

/**
 * M3.3 — SURFACE-RELATIVE PROJECTION SYMMETRY (deterministic, pure math — no
 * browser, no screenshots): the Cube face OPPOSITE the support surface (the
 * FREE face — top face on Floor, bottom face on Ceiling) must project with
 * the same apparent size/perspective from the chase camera on every gravity
 * surface. The contract is expressed through the gameplay-frame concept
 * "free face = the face on the surfaceNormal side", never as a Ceiling-only
 * constant: the below-focus framing is the exact mirror of the above-focus
 * framing, so the ratio must be 1 up to floating-point noise (acceptance
 * band 0.90..1.10; the mirror pins it far tighter).
 */

/** Square-NDC projection scale (aspect scales x uniformly and cancels in ratios). */
const TAN_HALF_FOV = Math.tan((CAMERA_TUNING.fov / 2) * (Math.PI / 180));

interface NdcPoint {
  x: number;
  y: number;
}

const projectNdc = (
  eye: Readonly<{ x: number; y: number; z: number }>,
  look: Readonly<{ x: number; y: number; z: number }>,
  p: Readonly<{ x: number; y: number; z: number }>,
): NdcPoint => {
  let fx = look.x - eye.x, fy = look.y - eye.y, fz = look.z - eye.z;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  // right = normalize(forward × worldUp); upv = right × forward
  let rx = -fz;
  const ry = 0;
  let rz = fx;
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl; rz /= rl;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
  const depth = dx * fx + dy * fy + dz * fz;
  return { x: (dx * rx + dy * ry + dz * rz) / (depth * TAN_HALF_FOV), y: (dx * ux + dy * uy + dz * uz) / (depth * TAN_HALF_FOV) };
};

const shoelaceArea = (pts: readonly NdcPoint[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    if (!cur || !next) continue;
    a += cur.x * next.y - next.x * cur.y;
  }
  return Math.abs(a) / 2;
};

describe('M3.3 surface-relative projection symmetry', () => {
  const FREE_FACE_HALF = 0.62; // visual cube half-edge (1.24 / 2)
  const FLOOR_REST_Y = 0.55;
  const CEILING_REST_Y = 5.45;

  const restFrame = (playerY: number, side: 'aboveFocus' | 'belowFocus') => {
    const cam = new ChaseCamera();
    const player = { x: 0, y: playerY, z: 210 };
    cam.snapTo(player, 0, side);
    return { player, eye: cam.currentPosition, look: cam.currentLookTarget };
  };

  /** Projected corners of the FREE face (opposite the support surface),
   *  in perimeter order so the shoelace formula measures the true quad. */
  const freeFaceCorners = (playerY: number, side: 'aboveFocus' | 'belowFocus') => {
    const frame = restFrame(playerY, side);
    const faceY = side === 'aboveFocus' ? playerY + FREE_FACE_HALF : playerY - FREE_FACE_HALF;
    const pts: Array<{ x: number; y: number; z: number }> = [];
    for (const [dx, dz] of [
      [-FREE_FACE_HALF, -FREE_FACE_HALF],
      [FREE_FACE_HALF, -FREE_FACE_HALF],
      [FREE_FACE_HALF, FREE_FACE_HALF],
      [-FREE_FACE_HALF, FREE_FACE_HALF],
    ] as const) {
      pts.push({ x: frame.player.x + dx, y: faceY, z: frame.player.z + dz });
    }
    return { frame, pts };
  };

  it('mirrors the Floor rest framing exactly (eye/look offsets reflected)', () => {
    const floor = restFrame(FLOOR_REST_Y, 'aboveFocus');
    const ceiling = restFrame(CEILING_REST_Y, 'belowFocus');
    // Floor reference is UNCHANGED by M3.3: canonical height line + look bias.
    expect(floor.eye.y).toBeCloseTo(FLOOR_REST_Y * 0.35 + 4.2, 10);
    expect(floor.look.y).toBeCloseTo(FLOOR_REST_Y + 0.6, 10);
    // The ceiling height line is the exact mirror of the floor height line
    // about the corridor mid-plane: same parallax slope, reflected anchor.
    expect(ceiling.eye.y).toBeCloseTo(CEILING_REST_Y * 0.35 - 0.3, 10);
    expect(ceiling.look.y).toBeCloseTo(CEILING_REST_Y - 0.6, 10);
    // Rest eye offset along the free-face normal: identical magnitude below
    // (ceiling) as above (floor) — the surface-relative parity contract.
    const floorAbove = floor.eye.y - FLOOR_REST_Y;
    const ceilingBelow = CEILING_REST_Y - ceiling.eye.y;
    expect(ceilingBelow).toBeCloseTo(floorAbove, 10);
  });

  it('projects the free face with parity: area, apparent width, player placement', () => {
    const floor = freeFaceCorners(FLOOR_REST_Y, 'aboveFocus');
    const ceiling = freeFaceCorners(CEILING_REST_Y, 'belowFocus');
    const floorArea = shoelaceArea(floor.pts.map((p) => projectNdc(floor.frame.eye, floor.frame.look, p)));
    const ceilingArea = shoelaceArea(ceiling.pts.map((p) => projectNdc(ceiling.frame.eye, ceiling.frame.look, p)));
    const areaRatio = ceilingArea / floorArea;
    // Mirror-exact contract: far tighter than the 0.90..1.10 acceptance band.
    expect(areaRatio).toBeGreaterThan(0.98);
    expect(areaRatio).toBeLessThan(1.02);

    // Apparent overall cube size stays comparable (width via all 8 corners).
    const cubeWidthNdc = (playerY: number, side: 'aboveFocus' | 'belowFocus') => {
      const frame = restFrame(playerY, side);
      const pts: Array<{ x: number; y: number; z: number }> = [];
      for (const dx of [-FREE_FACE_HALF, FREE_FACE_HALF])
        for (const dy of [-FREE_FACE_HALF, FREE_FACE_HALF])
          for (const dz of [-FREE_FACE_HALF, FREE_FACE_HALF])
            pts.push({ x: dx, y: playerY + dy, z: frame.player.z + dz });
      const ndc = pts.map((p) => projectNdc(frame.eye, frame.look, p));
      return Math.max(...ndc.map((n) => n.x)) - Math.min(...ndc.map((n) => n.x));
    };
    const widthRatio = cubeWidthNdc(CEILING_REST_Y, 'belowFocus') / cubeWidthNdc(FLOOR_REST_Y, 'aboveFocus');
    expect(widthRatio).toBeGreaterThan(0.95);
    expect(widthRatio).toBeLessThan(1.05);

    // Player screen placement mirrors: equal magnitude, opposite side.
    const floorPlayer = projectNdc(floor.frame.eye, floor.frame.look, floor.frame.player);
    const ceilingPlayer = projectNdc(ceiling.frame.eye, ceiling.frame.look, ceiling.frame.player);
    expect(ceilingPlayer.y).toBeCloseTo(-floorPlayer.y, 6);
  });
});
