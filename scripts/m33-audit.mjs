/**
 * M3.3 surface-relative projection-parity audit (dev measurement tool, not
 * shipped). Drives the real game in headless Chromium against the local dev
 * server, freezes deterministic floor/ceiling framings, and measures the
 * M3.3 camera contract: the FREE face of the Cube (opposite the support
 * surface — top face on Floor, bottom face on Ceiling) must project with
 * comparable apparent size/perspective on every gravity surface.
 *
 * For each stable grounded scenario it records:
 * - player/eye world transforms, eye->player vector decomposed into
 *   vertical (support-normal) and longitudinal (forward) components,
 * - eye-to-player distance, apparent cube screen width/height,
 * - projected screen AREA of the free face (shoelace over its 4 corners),
 * and finally the ceiling/floor free-face area ratio (the M3.3 parity metric,
 * acceptance 0.90..1.10, tighter preferred).
 *
 * Usage: node scripts/m33-audit.mjs   (requires dev server on :5173)
 * Writes qa/screenshots/m33-audit-<tag>.png + m33-audit-<tag>-metrics.json.
 * Tag with M33_TAG=before|after to preserve before/after evidence.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.QA_URL ?? 'http://localhost:5173/';
const TAG = process.env.M33_TAG ?? 'run';
const OUT_DIR = path.resolve('qa/screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const state = () =>
  page.evaluate(() => ({
    pos: window.__gd3d.playerPosition(),
    mode: window.__gd3d.gravityMode(),
    grounded: window.__gd3d.grounded(),
    status: window.__gd3d.status(),
    eye: window.__gd3d.cameraEye(),
    look: window.__gd3d.cameraLook(),
  }));

async function rollUntil(pred, timeoutMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const s = await state();
    if (s.status === 'running' && pred(s)) return s;
    if (Date.now() - t0 > timeoutMs) return null;
    await page.waitForTimeout(30);
  }
}

/** Restart + teleport (debug QA aid) + roll to a deterministic framing. */
async function reach(teleportZ, pred) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);
    if ((await page.evaluate(() => window.__gd3d.playerPosition().z)) < 10) break;
  }
  await page.evaluate((z) => window.__gd3d.debugTeleport(0, 1.5, z), teleportZ);
  const s = await rollUntil(pred);
  if (!s) throw new Error(`scenario framing never reached (teleport z=${teleportZ})`);
  await page.keyboard.press('KeyP'); // freeze sim; render + camera smoothing continue
  await page.waitForTimeout(900); // camera settles into the frozen frame
  return s;
}

/** Project world points through the live camera. */
const project = (points) =>
  page.evaluate(
    (pts) => pts.map((p) => window.__gd3d.screenPoint(p[0], p[1], p[2])),
    points,
  );

/** Shoelace area (px²) of the projected quad, in corner order a b c d. */
const quadArea = (a, b, c, d) =>
  Math.abs(
    (a.px * b.py - b.px * a.py) +
    (b.px * c.py - c.px * b.py) +
    (c.px * d.py - d.px * c.py) +
    (d.px * a.py - a.px * d.py),
  ) / 2;

const CUBE_HALF = 0.62; // visual cube half-edge (1.24 / 2)

const metrics = { tag: TAG, scenarios: {}, consoleErrors, pageErrors };

async function auditScenario(name, teleportZ, pred, freeFace) {
  await reach(teleportZ, pred);
  // Re-read state AFTER the freeze + settle so player and eye belong to the
  // SAME frozen frame (the pre-freeze poll position is stale by the time the
  // pause key lands and the damped camera converges).
  const s = await state();
  const p = s.pos;

  // Free face = the face OPPOSITE the support surface (the gameplay-visible
  // face): Floor -> top face, Ceiling -> bottom face. Visual cube half-edge.
  const faceY = freeFace === 'top' ? p.y + CUBE_HALF : p.y - CUBE_HALF;
  const corners = [
    [p.x - CUBE_HALF, faceY, p.z - CUBE_HALF],
    [p.x + CUBE_HALF, faceY, p.z - CUBE_HALF],
    [p.x + CUBE_HALF, faceY, p.z + CUBE_HALF],
    [p.x - CUBE_HALF, faceY, p.z + CUBE_HALF],
  ];
  const facePx = await project(corners);

  const all = await project(
    (() => {
      const pts = [];
      for (const dx of [-CUBE_HALF, CUBE_HALF])
        for (const dy of [-CUBE_HALF, CUBE_HALF])
          for (const dz of [-CUBE_HALF, CUBE_HALF])
            pts.push([p.x + dx, p.y + dy, p.z + dz]);
      return pts;
    })(),
  );
  const xs = all.map((c) => c.px);
  const ys = all.map((c) => c.py);
  const cubeW = Math.max(...xs) - Math.min(...xs);
  const cubeH = Math.max(...ys) - Math.min(...ys);

  const dx = s.eye.x - p.x;
  const dy = s.eye.y - p.y;
  const dz = s.eye.z - p.z;
  metrics.scenarios[name] = {
    mode: s.mode,
    player: p,
    eye: s.eye,
    look: s.look,
    eyeToPlayer: {
      distance: Math.hypot(dx, dy, dz),
      vertical: dy,
      longitudinal: -dz, // positive = eye behind the player
    },
    cubeWidthPx: cubeW,
    cubeHeightPx: cubeH,
    freeFace,
    freeFaceAreaPx: quadArea(facePx[0], facePx[1], facePx[2], facePx[3]),
  };
  console.log(
    `audited ${name}: mode=${s.mode} eyeΔv=${dy.toFixed(2)} eyeΔl=${(-dz).toFixed(2)} ` +
    `cubeW=${cubeW.toFixed(0)}px freeFaceArea=${metrics.scenarios[name].freeFaceAreaPx.toFixed(0)}px²`,
  );
  return name;
}

// --- Scenarios (same deterministic framings as the M3.2 audit) ---
await auditScenario(
  'floor-reference',
  170,
  (s) => s.mode === 'floor' && s.grounded && s.pos.z > 172 && s.pos.z < 178,
  'top',
);
await page.keyboard.press('KeyP');
await page.screenshot({
  path: path.join(OUT_DIR, 'm33-audit-floor-reference.png'),
});

await auditScenario(
  'ceiling-reference',
  176,
  (s) => s.mode === 'ceiling' && s.grounded && Math.abs(s.pos.y - 5.45) < 0.12 && s.pos.z > 205 && s.pos.z < 215,
  'bottom',
);
await page.keyboard.press('KeyP');
await page.screenshot({
  path: path.join(OUT_DIR, 'm33-audit-ceiling-reference.png'),
});

const f = metrics.scenarios['floor-reference'];
const c = metrics.scenarios['ceiling-reference'];
metrics.parity = {
  freeFaceAreaRatio: c.freeFaceAreaPx / f.freeFaceAreaPx,
  cubeWidthRatio: c.cubeWidthPx / f.cubeWidthPx,
  eyeDistanceRatio: c.eyeToPlayer.distance / f.eyeToPlayer.distance,
  verticalOffsetRatio: c.eyeToPlayer.vertical / f.eyeToPlayer.vertical,
};
console.log('\nPARITY (ceiling / floor):');
console.log(`  free-face area ratio : ${metrics.parity.freeFaceAreaRatio.toFixed(3)}  (acceptance 0.90..1.10)`);
console.log(`  cube width ratio     : ${metrics.parity.cubeWidthRatio.toFixed(3)}`);
console.log(`  eye distance ratio   : ${metrics.parity.eyeDistanceRatio.toFixed(3)}`);
console.log(`  vertical offset ratio: ${metrics.parity.verticalOffsetRatio.toFixed(3)}  (mirror target ≈ -1)`);

fs.writeFileSync(
  path.join(OUT_DIR, `m33-audit-${TAG}-metrics.json`),
  JSON.stringify(metrics, null, 2),
);
console.log(`\nconsole errors: ${consoleErrors.length}, page errors: ${pageErrors.length}`);
await browser.close();
