/**
 * M3.2 ceiling-vs-floor readability audit (dev measurement tool, not shipped).
 * Drives the real game in headless Chromium against the local dev server,
 * freezes deterministic framing scenarios, and measures BOTH:
 * - geometric parity via the live camera (eye/look, player screen placement,
 *   apparent cube size, forward run-surface visibility, preview distances),
 * - pixel parity via decoded screenshots (cube-region luminance, contact-band
 *   luminance, surface-ahead band luminance).
 * Usage: node scripts/m32-audit.mjs   (requires dev server on :5173)
 * Writes qa/screenshots/m32-audit-*.png + m32-audit-metrics.json.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.QA_URL ?? 'http://localhost:5173/';
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
  await page.waitForTimeout(700); // camera settles into the frozen frame
  return s;
}

/** Project world points through the live camera. */
const project = (points) =>
  page.evaluate(
    (pts) => pts.map((p) => window.__gd3d.screenPoint(p[0], p[1], p[2])),
    points,
  );

// Decode a captured PNG inside the page and measure pixel regions (0..255
// Rec.709 luminance). Regions arrive in screen px.
async function pixelStats(file, regions) {
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate(
    ({ data, regs }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      return new Promise((resolve) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const out = {};
          for (const [name, r] of Object.entries(regs)) {
            const x0 = Math.max(0, Math.round(r.x));
            const y0 = Math.max(0, Math.round(r.y));
            const x1 = Math.min(img.width, Math.round(r.x + r.w));
            const y1 = Math.min(img.height, Math.round(r.y + r.h));
            if (x1 <= x0 || y1 <= y0) {
              out[name] = null;
              continue;
            }
            const data2 = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
            let sum = 0;
            let max = 0;
            let n = 0;
            for (let i = 0; i < data2.length; i += 4) {
              const lum =
                0.2126 * data2[i] + 0.7152 * data2[i + 1] + 0.0722 * data2[i + 2];
              sum += lum;
              if (lum > max) max = lum;
              n++;
            }
            out[name] = { meanLum: sum / n, maxLum: max, px: n };
          }
          resolve(out);
        };
        img.onerror = () => resolve({ error: 'decode failed' });
      });
    },
    { data: b64, regs: regions },
  );
}

const metrics = { scenarios: {}, consoleErrors, pageErrors };

async function auditScenario(name, teleportZ, pred, surfaceY) {
  const s = await reach(teleportZ, pred);
  const p = s.pos;

  // Geometric projections.
  const cubeHalf = 0.62; // visual cube half-edge (1.24 / 2)
  const corners = [];
  for (const dx of [-cubeHalf, cubeHalf])
    for (const dy of [-cubeHalf, cubeHalf])
      for (const dz of [-cubeHalf, cubeHalf])
        corners.push([p.x + dx, p.y + dy, p.z + dz]);
  const cornerPx = await project(corners);
  const xs = cornerPx.map((c) => c.px);
  const ys = cornerPx.map((c) => c.py);
  const cube = {
    x0: Math.min(...xs), x1: Math.max(...xs),
    y0: Math.min(...ys), y1: Math.max(...ys),
  };
  const center = (await project([[p.x, p.y, p.z]]))[0];

  // Run-surface points ahead of the player (visible-runway profile).
  const aheadDists = [4, 8, 12, 16, 20, 26];
  const surfacePts = aheadDists.map((d) => [0, surfaceY, p.z + d]);
  const surfacePx = await project(surfacePts);

  // Contact-side band right beyond the cube (the surface the cube attaches to):
  // above the cube on the ceiling, below it on the floor.
  const contactBand =
    surfaceY > p.y
      ? { x: cube.x0, y: cube.y0 - 26, w: cube.x1 - cube.x0, h: 22 }
      : { x: cube.x0, y: cube.y1 + 4, w: cube.x1 - cube.x0, h: 22 };

  const shot = path.join(OUT_DIR, `m32-audit-${name}.png`);
  await page.screenshot({ path: shot });

  const regions = {
    cube: { x: cube.x0 + 3, y: cube.y0 + 3, w: cube.x1 - cube.x0 - 6, h: cube.y1 - cube.y0 - 6 },
    contactBand,
    frame: { x: 0, y: 0, w: 1280, h: 720 },
  };
  for (const [i, d] of aheadDists.entries()) {
    const sp = surfacePx[i];
    if (!sp.behind && sp.px > 0 && sp.px < 1280 && sp.py > 0 && sp.py < 720) {
      regions[`surfaceAhead${d}`] = { x: sp.px - 30, y: sp.py - 6, w: 60, h: 12 };
    }
  }
  const px = await pixelStats(shot, regions);

  metrics.scenarios[name] = {
    player: p,
    mode: s.mode,
    eye: s.eye,
    look: s.look,
    eyeToPlayerDist: Math.hypot(p.x - s.eye.x, p.y - s.eye.y, p.z - s.eye.z),
    playerScreen: { px: center.px, py: center.py, ndcY: center.ndcY },
    cubeScreen: cube,
    cubeWidthPx: cube.x1 - cube.x0,
    surfaceAheadPx: Object.fromEntries(aheadDists.map((d, i) => [d, surfacePx[i]])),
    pixels: px,
  };
  console.log(`audited ${name}: mode=${s.mode} z=${p.z.toFixed(1)} cubeW=${(cube.x1 - cube.x0).toFixed(0)}px py=${center.py.toFixed(0)}px`);
}

// --- Scenarios ---
// Floor reference framing: grounded approach before the portal-up (z=182).
await auditScenario('floor-approach', 170, (s) => s.mode === 'floor' && s.grounded && s.pos.z > 172 && s.pos.z < 178, 0);
await page.keyboard.press('KeyP');

// Ceiling run: grounded mid-slab A, before the gap (z 232..238).
await auditScenario('ceiling-run', 176, (s) => s.mode === 'ceiling' && s.grounded && Math.abs(s.pos.y - 5.45) < 0.12 && s.pos.z > 205 && s.pos.z < 215, 6);
await page.keyboard.press('KeyP');

// Ceiling gap approach: grounded, gap edge ~6..12 u ahead.
await auditScenario('ceiling-gap-approach', 176, (s) => s.mode === 'ceiling' && s.grounded && Math.abs(s.pos.y - 5.45) < 0.12 && s.pos.z > 222 && s.pos.z < 228, 6);
await page.keyboard.press('KeyP');

// Preview: project the ceiling gap edges from the gap-approach framing.
{
  const s = metrics.scenarios['ceiling-gap-approach'];
  const pts = await project([[0, 6, 232], [0, 6, 238], [5.4, 6, 232], [-5.4, 6, 232]]);
  s.gapEdgeScreen = {
    nearLeft: pts[2], nearRight: pts[3], nearCenter: pts[0], farCenter: pts[1],
  };
}
// Floor reference: project the first gap edges (z 76..84.5) from a mid-track
// framing is not directly comparable; instead record the floor portal-up frame.
{
  const s = metrics.scenarios['floor-approach'];
  const pts = await project([[0, 0, 182], [5.4, 0, 182], [-5.4, 0, 182]]);
  s.portalUpScreen = { center: pts[0], left: pts[2], right: pts[1] };
}

fs.writeFileSync(path.join(OUT_DIR, 'm32-audit-metrics.json'), JSON.stringify(metrics, null, 2));
console.log(`\nconsole errors: ${consoleErrors.length}, page errors: ${pageErrors.length}`);
await browser.close();
