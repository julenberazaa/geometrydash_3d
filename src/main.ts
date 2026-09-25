import { AppController } from './app/AppController';

/**
 * Entry point. Owns the canvas container and the app lifecycle.
 * No gameplay logic here.
 *
 * M9.4: bare `/` shows the level/mode selector (no auto-start — the START
 * gesture unlocks audio and begins tick 0). `?level=<id>` enters that
 * level directly (legacy developer/debug behavior with the tick-0
 * press-to-start gate); unknown ids fall back explicitly with a logged
 * reason. `?mode=classic|checkpoint` preselects the run mode on both
 * paths (bare clicks/keys keep legacy semantics: Space/click = pending
 * mode, C/2 = checkpoint).
 */
const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container missing from DOM');
}

const gameParams = new URLSearchParams(window.location.search);
// M6A post fallback: `?post=off` forces the direct-render path (same scene,
// no composer passes) — the game stays fully playable without post.
const postParam = gameParams.get('post');
// M6B FX fallback: `?fx=off` disables the motion-juice layer only (trail,
// bursts, streaks) — same scene, same gameplay, M6A foundation intact.
const fxParam = gameParams.get('fx');
// M6C1 trigger fallback: `?triggers=off` resolves the scene to the exact
// M6A+M6B baseline (no section state) — same scene, same gameplay.
const triggersParam = gameParams.get('triggers');
// M6D perf profiler: `?perf=1` enables the DEBUG frame profiler (bounded
// ring buffer, off by default, zero gameplay effect).
const perfParam = gameParams.get('perf');
// M9 music transport: `?music=off` silences the track (no start gate, no
// audio load) with zero gameplay difference — pairs with `?fx=off`.
const musicParam = gameParams.get('music');
// M9.1 QA slow-motion: `?stepcap=N` overrides the per-frame catch-up
// budget (clamped 1..8) for precision input delivery on slow renderers —
// same ticks, same order, slower wall rate; replays verify across values.
const stepCapRaw = Number.parseInt(gameParams.get('stepcap') ?? '', 10);
const stepCapParam = Number.isInteger(stepCapRaw)
  ? Math.min(8, Math.max(1, stepCapRaw))
  : undefined;
const controller = new AppController(container, {
  levelId: gameParams.get('level'),
  mode: gameParams.get('mode'),
  rendererOptions: {
    postEnabled: postParam === null ? undefined : postParam !== 'off',
    fxEnabled: fxParam === null ? undefined : fxParam !== 'off',
    triggersEnabled: triggersParam === null ? undefined : triggersParam !== 'off',
  },
  gameOptions: {
    perfEnabled: perfParam === '1',
    musicEnabled: musicParam === null ? undefined : musicParam !== 'off',
    maxCatchUpSteps: stepCapParam,
  },
});
controller.start();

// Hot Module Acceptance for Vite dev server.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    controller.dispose();
  });
}
