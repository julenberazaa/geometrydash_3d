# M9.6 — Island Hub + Input Reliability + Spider Feel (follow-up polish)

> Status: IN PROGRESS (branch `feature/m9-6-island-hub-input-spider-polish`,
> from M9.5 HEAD `734e306`). Four goals, all audited first — no cosmetic
> tweaks claimed as fixes. No merge to main, no force-push. Untracked
> user MP3s at the repo root are preserved untouched.

## 0. Source state (verified 2026-09-25)

- Branch from `feature/m9-5-descent-zenith-density-polish` @ `734e306`
  (matches the expected remote HEAD; tree clean except the two untracked
  user MP3s, which are never touched).
- Baseline: `typecheck` clean, `lint` clean. Full `vitest` run: 695/698
  pass; the 3 failures are parallel-load timeout flakes (5 s default
  timeout under full-suite contention) — each failing file passes solo
  in <1 s (`multimodeGauntlet` 12/12 in 225 ms, `shipPortalBypass` 8/8
  in 310 ms). Verification during this milestone uses isolated/batched
  runs for evidence; the flake is environmental, not product behavior.
- Dev server runs fine with `npm run dev`.

## 1. Root-cause audit (evidence, not guesses)

### C1. Clicks/taps have NO gameplay path (structural)

`grep pointerdown|mousedown|touchstart src/` → zero hits. Gameplay input
is keyboard-only (`InputSystem`: Space/arrows → physical edges). A mouse
click or touch tap on the canvas mid-run is silently ignored — by design
so far, but it IS the literal "clicks do not register" report. The
start-gate click (`Game.onClick`) exists only pre-start; menu/pause
clicks are UI gestures.

Fix (structural, one owner): `InputSystem.attachPointer(root)` maps
pointerdown → `space` press edge, pointerup/cancel/leave → release, with
the SAME edge semantics as keyboard Space (gravity-agnostic; the sim
interprets it identically). Pointer shares the existing `space` edge
state — zero replay-codec change, zero ReplayV1 change, tapes stay
input-identical. Events whose target is inside a `button` (or overlay
`[data-ui]`) are ignored so UI clicks never become jumps. Wired once in
`Game` (composition root) on the session container, detached in
`dispose()` (no leaked listeners — session-disposal rule).

### C2. Focused-button Space re-activation (the "state change" bug)

Native buttons activate on Space keyup while focused. The always-visible
☰ MENU button keeps focus after being clicked. Repro path: click ☰ MENU
→ pause opens → click RESUME (focus moves to hidden RESUME) → … click
☰ MENU again → ESC/P resume (focus STAYS on visible MENU) → next
gameplay Space: keydown jumps correctly, keyup re-clicks MENU → the game
pauses mid-run one press after every menu use. Exact match for
"unreliable especially during state changes". Spider suffers most: the
snap fires on keydown, the pause lands on keyup — reads as a broken
spider press.

Fix: blur every menu/HUD/pause button synchronously inside its click
handler (`(e.currentTarget as HTMLButtonElement).blur()`). Presentation
only; keyboard operability preserved (Tab re-focus still works).

### C3. Stale edges across the async start handoff

`startRun` flushes input synchronously, but the music `ensure()` gap is
async — presses during it accumulate and fire at tick 0. Fix: flush
again in the continuation immediately before `loop.setPaused(false)`
(and keep the gesture flush). Same for the silent/music-off paths.

### C4. `blur` listener leak in `InputSystem.attach`

The `blur → releaseAll` listener is an anonymous closure, never removed
by `detach()`. Fix: named handler, removed on detach. Hygiene, same
touch, no behavior change.

### C5. Spider ignored presses are silent (→ Goal D observability)

`trySpiderSnap()` returns false with no observable (no counter, no
anchor, no probe). A press with no support in range / blocked transit
reads exactly like a dropped input. Fix: `spiderRejectCount` +
`lastSpiderRejectReason` (`'no-support' | 'blocked'`), presentation-only
probes (excluded from fingerprint/state hash — teleport-anchor
precedent).

### D1. Spider transition language is "teleport", not "energy move"

Snap commits instantly (correct, top-of-step) but the only feedback is
the shared gravity pulse + camera glide. No snap-specific burst, no
beam, no from→to connector; `VfxSystem` even wipes the trail (>5 u
clear) leaving a visual gap. Fix (presentation only): `SpiderBeamView`
— vertical additive beam + particle burst connecting the exact snap
from→to anchors, ~0.3 s decay, mint-green spider accent, pooled,
`?fx=off`-silenced. Camera untouched (glide preserved, no snaps).

### D2. Spider has zero input forgiveness (mechanism)

Orb design pins "no buffer", but spider snaps are positional (support
must be in range ON the edge step). A 50 ms-early press is silently
ignored. Fix (deterministic, replay-safe): a 6-tick spider press buffer
— an ignored press edge arms `spiderBufferTicksLeft = 6`; subsequent
spider steps re-attempt the snap; success consumes it, expiry clears it.
Cleared on death/respawn/restart/mode-exit; carried in the checkpoint
snapshot (one field). The buffer ONLY calls `trySpiderSnap()` — it never
fabricates input, so pads/orbs/gravity logic never see it. Reference
tapes (all presses succeed first-try) are provably unaffected: both
Descent + Rift anchors must stay tick-exact or the buffer is reverted.

### A1. Menu is DOM-only (no 3D hub)

`LevelSelectView` is pure DOM over an opaque `.m94-menu` background; no
Three.js in the menu path. Fix: `IslandHub` (`src/menu/islandHub.ts`) —
own Three.js scene behind the menu: Descent island (teal, waterfall +
pool + floating-rock path) + Rift island (basalt, red cracks, spike
ring, skull-abstract) + stepping-stone connectors with flow pulses +
water + motes + selection beacons. `AppController` owns hub lifecycle
(build on menu, dispose on START, rebuild on return — menu XOR session
canvas, never two). Selection state stays plain TS in
`LevelSelectView`; hub only mirrors it. Island picking via raycast AND
restyled DOM destination panels (both set the same state). Legacy QA
selectors (`.m94-card`, `.m94-mode-button`, `.m94-start-button`) are
KEPT as aliases so pre-M9.6 browser gates keep passing; only the
`canvases === 0` menu assertion migrates (hub adds exactly one canvas).

### B1. Descent straight zones (re-audit on M9.5 content)

M9.5 fixed 4 zones; ship/spider/teleport/320–360/opening were excluded
with documented reasons. M9.6 re-runs the per-40 u bin audit
(`scripts/tmp-m96-audit.ts`, temporary, deleted before commit) and picks
only remaining cube-mode straight stretches. Same guardrails: single-tap
weaves / timed jumps, existing margins, still clearly easier than Rift,
anchor re-pinned deliberately if it moves.

## 2. Scope / preservation

- Both levels preserved; Rift route/gameplay/music/fingerprint unchanged
  (spider buffer must not move its anchor — verified, else reverted).
- Classic/checkpoint semantics + practice-taint untouched. Music behavior
  untouched (hub is silent; no transport while in menu).
- Session disposal: hub canvas + listeners + rAF disposed on START;
  session canvas/listeners/music/HUD disposed on menu return (existing
  path, extended with hub rebuild). Browser QA asserts canvas/HUD counts.
- Replay/fingerprint: pointer path shares `space` edges (no codec
  change); spider anchors/rejects/buffer excluded from hashes (teleport
  precedent); Descent content edits change its fingerprint (documented,
  old Descent tapes stale — M9.5 precedent); Rift fingerprint pinned.
- Camera: no framing changes (beam + glide only).
- Lava look + art direction preserved; hub reuses the same palette.

## 3. Commit plan

1. This spec.
2. GOAL C: `InputSystem` pointer path + blur-leak fix; `Game` wiring +
   start/resume flush; button-blur in Hud/PauseMenuView/LevelSelectView;
   `tests/inputPointer.test.ts` (+ blur-detach test); browser focus +
   pointer regression checks.
3. GOAL D: sim spider observables (`spiderSnapEventCount`,
   `lastSpiderSnap`, `spiderRejectCount`, `lastSpiderRejectReason`) +
   6-tick buffer + snapshot field; `tests/spiderSnap.test.ts`
   (observability + buffer + determinism + replay-safety); `SpiderBeamView`
   + RendererHost wiring + probes; anchor verification both levels.
4. GOAL B: temp audit → surgical edits → driver update → re-pin census/
   metrics/alignment; both routes finish + replay VERIFIED.
5. GOAL A: `IslandHub` scene + AppController lifecycle + LevelSelectView
   island panels + mode slider + CSS; menu probe extensions; legacy
   script migration (`canvases === 0` → hub canvas).
6. `scripts/browser-qa-m96.mjs` (hub, slider, switching, menu return,
   pointer/spider reliability, beam, disposal) + legacy gates green.
7. Docs closeout (GAME_DESIGN input/spider/hub, ARCHITECTURE hub/input/
   spider owners, ROADMAP, README if it claims menu behavior).

## 4. Definition of Done

- Hub: two visually distinct animated islands + connectors, selection
  obvious (beacon + camera ease + panel), mode slider preserves
  classic/checkpoint semantics, START/disposal clean, menu↔game
  switching robust (repeat-switch isolation, one canvas at a time).
- Descent: recognizably the same route, richer straight zones, still
  easier than Rift, reference anchors green + replay VERIFIED.
- Input: pointer taps act as primary action; no spurious pause after
  menu use (browser-proven); no stale tick-0 edge; no leaked listeners;
  unit + browser proof.
- Spider: snaps observable (count/anchors/rejects in probes), beam +
  burst on every snap, 6-tick forgiveness without moving reference
  anchors, camera glide preserved.
- `npm run verify` green (modulo the documented parallel-load flake —
  evidence via batched runs), `browser-qa-m96` green, legacy gates
  green, branch pushed, tree clean (temp scripts deleted).
