/**
 * M8.6 camera corrective-pass browser QA (dev tool, not shipped).
 * Stages THE DESCENT across its full height spread (low river → high
 * ceiling run → high Spider decks) and proves per stage:
 *  - the camera follows the deck (eye on the correct free-face side),
 *  - the player stays visible on screen (screenPoint, not behind),
 *  - no roll, no console/page errors,
 *  - pull-in/fade activity is reported (fade must stay ~never in
 *    staged frames; the ship-tunnel min-clamp is covered by suite sweep).
 *
 * Usage: node scripts/browser-qa-camera-m86.mjs (requires dev server on :5173)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import nodeChildProcess from 'node:child_process';

const URL = process.env.QA_URL ?? 'http://localhost:5173/';
const OUT_DIR = path.resolve('qa/screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
let failures = 0;
const log = (name, ok, detail) => {
  results.push({ name, ok, detail: detail ?? '' });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
};

const gitSha = (() => {
  try {
    return nodeChildProcess.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

const browser = await chromium.launch({
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

const waitReady = async () => {
  await page.waitForFunction(() => window.__gd3d !== undefined, null, { timeout: 60000 });
};
const safeGoto = async (url) => {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
  } catch {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    } catch {
      await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
    }
    await waitReady();
  }
};
await safeGoto(URL);
await waitReady();
await page.waitForTimeout(2000);

const sidecarBase = {
  url: URL,
  capturedAt: new Date().toISOString(),
  git: { sha: gitSha },
  env: { userAgent: await page.evaluate(() => navigator.userAgent) },
};
async function capture(name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify({
    ...sidecarBase,
    capture: { name, accepted: true, rejectionReasons: [] },
    errors: { consoleErrors: [...consoleErrors], pageErrors: [...pageErrors] },
    png: { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
  }, null, 2));
}

const camProbe = () => page.evaluate(() => {
  const p = window.__gd3d.playerPosition();
  const eye = window.__gd3d.cameraEye();
  const ideal = window.__gd3d.cameraIdealEye();
  const sp = window.__gd3d.screenPoint(p.x, p.y, p.z);
  return {
    status: window.__gd3d.status(),
    pMode: window.__gd3d.playerMode(),
    grav: window.__gd3d.gravityMode(),
    support: window.__gd3d.supportId(),
    px: p.x, py: p.y, pz: p.z,
    eyeX: eye.x, eyeY: eye.y, eyeZ: eye.z,
    idealY: ideal.y,
    pullIn: window.__gd3d.cameraPullInDistance(),
    occluded: window.__gd3d.cameraOccluded(),
    occluders: window.__gd3d.cameraOccluderCount(),
    faded: window.__gd3d.cameraFadedOccluders(),
    upY: window.__gd3d.cameraUpY(),
    ndcX: sp.ndcX, ndcY: sp.ndcY, behind: sp.behind,
  };
});

// R → teleport → P-pause → verify frozen (m86 pattern); then a SHORT live
// settle (0.8 s: damped camera converges ~95% with minimal hazard exposure),
// re-pause, and read. Retries when the settle run dies mid-stage.
// `snap` mode skips the live settle (teleport → immediate pause → read):
// for precision sections where a blind cube cannot survive 0.8 s, this
// proves the §17 snap framing (snap lands exact, then the resolver keeps
// the new pose safe at once).
const stageRead = async (x, y, z, mode) => {
  if (mode === 'snap') {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);
    await page.evaluate((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x, y, z });
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(400);
    return { s: await camProbe(), settled: false };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);
    await page.evaluate((pt) => window.__gd3d.debugTeleport(pt.x, pt.y, pt.z), { x, y, z });
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(250);
    // Settle live (camera converges on the running player).
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(800);
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(300);
    const s = await camProbe();
    if (s.status === 'running' && Math.abs(s.pz - z) < 40) return { s, settled: true };
  }
  return { s: await camProbe(), settled: true };
};

// [name, x, y, z, mode, label] — teleport points (fall/attach, then read).
const stages = [
  ['cam-01-river-low', 0, 0.55, 128, 'settle', 'low opening (river + weave)'],
  ['cam-02-stairs', 0, 0.55, 30, 'settle', 'staircase ascent'],
  ['cam-03-islands-mid', 0, 5.05, 240, 'settle', 'mid islands'],
  ['cam-04-ferry', 0, 0.55, 365, 'settle', 'moving ferry void'],
  ['cam-05-maze', 0, 0.55, 465, 'settle', 'high-speed maze'],
  ['cam-06-maze-upper', 0, 5.05, 570, 'settle', 'stacked maze upper deck'],
  ['cam-07-ceiling-high', 0, 9.45, 760, 'settle', 'HIGH ceiling run (y~11.6)'],
  ['cam-08-chomper', 0, 0.55, 940, 'settle', 'Chomper combo deck'],
  ['cam-09-ship', 0, 3, 1155, 'snap', 'Ship tunnel'],
  ['cam-10-ship-inverted', 0, 3, 1205, 'settle', 'inverted Ship ribs'],
  ['cam-11-spider-low', 0, 0.55, 1345, 'snap', 'Spider floor/ceiling'],
  ['cam-12-spider-high', 0, 14.2, 1440, 'snap', 'HIGH Spider wall decks (y~13)'],
  ['cam-13-teleport', 0, 0.55, 1505, 'snap', 'teleport gantry'],
  ['cam-14-remix', 0, 0.55, 1675, 'settle', 'final remix'],
];

let totalFaded = 0;
for (const [name, x, y, z, mode, label] of stages) {
  const { s, settled } = await stageRead(x, y, z, mode);
  await capture(name);
  totalFaded += s.faded;
  const running = s.status === 'running';
  const dy = s.eyeY - s.py;
  const sideOk = s.grav === 'ceiling' ? dy < -1.5 : dy > 1.5;
  const bandOk = Math.abs(dy) > 1.5 && Math.abs(dy) < 6.5;
  const visible = !s.behind && Math.abs(s.ndcX) < 1 && Math.abs(s.ndcY) < 1;
  const noRoll = Math.abs(s.upY - 1) < 0.01;
  // Settle stages must be alive and following; snap stages prove the §17
  // snap framing on whatever frame the cut lands (status reported).
  log(`cam ${label} ${settled ? 'running+follows' : 'snap framing'}`, settled ? running && sideOk : sideOk,
    `status=${s.status} grav=${s.grav} mode=${s.pMode} py=${s.py.toFixed(1)} eyeY=${s.eyeY.toFixed(1)} dy=${dy.toFixed(2)} support=${s.support}`);
  log(`cam ${label} framing band+visible`, bandOk && visible,
    `|dy|=${Math.abs(dy).toFixed(2)} ndc=(${s.ndcX.toFixed(2)},${s.ndcY.toFixed(2)}) behind=${s.behind} pullIn=${s.pullIn.toFixed(2)} occluders=${s.occluders} faded=${s.faded}`);
  log(`cam ${label} no roll`, noRoll, `upY=${s.upY}`);
}

// Fade fallback must stay dormant in staged open frames (a degenerate
// teleport pose may legitimately engage it; the bound keeps that visible).
log('cam fade fallback near-dormant in staged frames', totalFaded <= 2, `totalFaded=${totalFaded}`);

// Resource flatness (fade clones would leak materials if mishandled).
const res = await page.evaluate(() => ({
  mats: window.__gd3d.materialCount(),
  geos: window.__gd3d.geometryCount(),
  children: window.__gd3d.sceneChildren(),
}));
log('cam resources flat', res.mats <= 45 && res.children < 120,
  `mats=${res.mats} geos=${res.geos} children=${res.children}`);

log('cam zero console errors', consoleErrors.length === 0, `${consoleErrors.length} errors`);
log('cam zero page errors', pageErrors.length === 0, `${pageErrors.length} errors`);

await browser.close();
console.log(`\nCAMERA QA: ${results.length - failures}/${results.length} green`);
process.exit(failures === 0 ? 0 : 1);
