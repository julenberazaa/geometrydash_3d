# M6D — Performance / Resource / Stability Closeout

## STATUS

M6D: ENGINEERING COMPLETE / REAL-GPU HUMAN PERF GATE OPEN.

This is NOT a REAL-GPU PASS: the only renderer available to this session
is headless Chromium SwiftShader (software rasterizer — see
§ HARDWARE / BROWSER). All code/static/leak/determinism profiling possible
without a hardware GPU is done; the repeatable real-GPU harness exists
(`scripts/perf-gate.mjs` + `?perf=1` + `window.__gd3d.perfSnapshot()`); the
human runs the same command on a hardware-accelerated browser to close the
gate. No software number is presented as a GPU verdict anywhere in this
file.

Automated: 365/365 tests green (`npm run verify`: typecheck + lint + tests
+ build) — 360 M7.3 + 5 new profiler tests. Build 624.88 kB (+1.93 kB:
profiler + probes). Functional browser QA: see § FUNCTIONAL REGRESSION.
Golden replay verifies unchanged (unit + in-page natural-death PASS).
Screenshots: `qa/screenshots/m6d-*` (8 PNG, git-ignored, regenerable).
Machine evidence: `qa/perf/m6d-swiftshader.json` (committed).

## ENTRY STATE

Entry HEAD `c410723` (M7.3 engineering complete), clean tree, `main`
synced with `origin/main`, one worktree. Baseline `npm run verify`:
25 files, 360/360 tests, build 622.95 kB. Production workload:
`?level=advanced-cube-01`, deterministic route 7475 ticks / 62.292 s.
Resource shape: 29 materials / 8 geometries / 3 composer passes /
62 top-level scene children (all re-verified in-gate, see § BASELINE).

## HUMAN M7.3 APPROVAL (recorded, not strengthened)

M7.3 HUMAN ADVANCED-CUBE RE-TEST: APPROVED TO PROCEED (2026-09-12 — the
human played the advanced level and said "esta bastante bien. vamos a
seguir hacia delante"). Recorded conservatively in `ROADMAP.md` + the M7.3
spec: the advanced Cube direction is accepted and development may proceed.
NOT claimed: "perfect", final art permanently locked, future tuning
forbidden. No redesign permission — M6D adds no mechanics, no sections,
no portals, no Ship/Spider, no wall gravity, no ramps, no monster AI, no
music/BPM sync.

## OBJECTIVE

Answer with MEASURED evidence: can the current production game render the
current advanced Cube workload smoothly at 60 FPS on a real
hardware-accelerated GPU, without frame-time spikes, memory growth,
material/geometry/scene-child growth, particle leakage, per-frame garbage
pressure, replay degradation, restart degradation, or fallback breakage?
M6D proves that everything already impressive is cheap enough, bounded
enough and stable enough to ship. Measure first, optimize second, never
redesign the game.

## HARDWARE / BROWSER

Available this session (probed via `WEBGL_debug_renderer_info`, recorded
in every evidence file):

- Browser: headless Chromium (Playwright), WebGL2
- Vendor: `Google Inc. (Google)`
- Renderer: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)
  (0x0000C0DE)), SwiftShader driver)` — SOFTWARE rasterizer
- devicePixelRatio: 1, renderer pixel ratio: 1 (DPR cap 1.5, see § DPR)
- Viewports: 1280×720 and 1920×1080 @ DPR 1

Verdict: NO hardware GPU was available. Per the milestone's critical rule,
SwiftShader numbers are used ONLY for functional/leak/regression evidence
(resource counts, determinism, pool peaks, fallback matrix). The final
REAL-GPU PASS verdict is explicitly left to the human gate (§ NEXT
MILESTONE), which reuses the identical harness and evidence format.

## PROFILING METHODOLOGY

`scripts/perf-gate.mjs` (repo-consistent with `scripts/browser-qa.mjs`:
safe navigation, readiness-gated, console/page-error capture, non-zero
exit on errors). Six configurations (warmup → sample → report) plus an
eight-scenario pass on the production level:

1. `advanced-default-720p` (+ 10-death / 10-restart leak stress)
2. `advanced-postoff-720p` (post cost attribution)
3. `advanced-fxoff-720p` (VFX cost attribution)
4. `advanced-triggersoff-720p` (timeline/punch cost attribution)
5. `slice-default-720p` (M7.1 reference workload)
6. `advanced-default-1080p` (resolution matrix)

Scenarios: opening / islands / ceiling / teleport-hop (edge-polled) /
lava-chomp / storm / death-burst (freeze/replay photo) / replay-stress
(natural-death tape → F4 → verify → repeated teleports).

Frame-delivery instrumentation is the DEBUG profiler
(`src/debug/perfProfiler.ts`, `?perf=1`, off by default — one branch per
frame when disabled): bounded Float64 ring (600 samples ≈ 10 s @ 60 fps,
no growth, zero hot-loop allocation), O(1) streaming budget counters,
percentiles computed on the cold snapshot path only. Exposed as
`window.__gd3d.perfSnapshot()` / `perfBeginSampling()` (+ `gpuIdentity()`
for the renderer verdict). Profiler overhead: one `performance.now()` +
a ring write per frame when enabled; disabled builds pay one branch.
Simulation is untouched — instrumentation lives strictly above gameplay
(`Game.frameRender`).

## WARMUP

6 s wall after readiness per configuration (shaders/resources settle),
then `perfBeginSampling()` discards the window; the 8 s sample that
follows is pure steady-state. Startup/loading is never counted.

## RESOLUTION MATRIX

1280×720 @ DPR 1 (primary), 1920×1080 @ DPR 1 (matrix), both with actual
DPR recorded (1) and the renderer cap read back (1). No 4K claim — not a
product target.

## BASELINE

`advanced-cube-01` opening, SwiftShader 1280×720 (functional shape, NOT a
GPU benchmark): ~530 draw calls / ~6.1k triangles / 62 children / 29
materials / 8 geometries / 3 passes — matching the M7.3 record (29/8/3/
62). `vertical-slice-01`: 363 calls / ~6.1k tris (the advanced level
carries +167 draws of M7.3 decor — all inside `LevelView.group`, zero
top-level growth). Zero console/page errors across every configuration
and scenario.

## BOTTLENECK ANALYSIS

Under SwiftShader the frame wall is software-rasterizer bound (opening
p50 ~90–130 ms ≈ 8–10 fps; 1080p halves it — fill-rate signature of CPU
rasterization, meaningless for hardware). Cost attribution, however, is
real and useful:

- `?post=off`: 518 calls / 0 passes, ~36 fps (3.5–4× the default) — the
  bloom composer dominates the SOFTWARE cost. On a real GPU this workload
  (6k tris, 2 lights, 3-pass bloom) is <1 ms class, but the human gate
  must confirm it; the fallback is proven playable either way.
- `?fx=off`: no measurable delta (VFX: 3 draws, ≤384 points + 24
  instances) — motion juice is essentially free.
- `?triggers=off`: no measurable delta (timeline = ~15 lerps into
  scratch + a few setHex writes; punch = 4 exp decays) — triggers are
  essentially free.
- Draw-call shape (530 advanced vs 363 slice) is the only number worth
  watching on hardware: trivially fine for any modern GPU's submission
  budget, recorded so the human gate can compare directly.

No structural optimization (instancing, merging) was warranted: profiling
shows no CPU/draw-call bottleneck, so per the decision tree the work
stopped at hot-loop hygiene (below). LevelView was deliberately NOT
refactored.

## HOT-LOOP ALLOCATION AUDIT

Audited every render-frame path (`RendererHost.applyFrame`,
`VfxSystem.update`, `InteractionView.update`, `PlayerView`,
`DeathBurstView`, `EnvironmentView`, `MaterialLibrary`,
`PostPipeline`, `ChaseCamera`, `eventPunch`, `visualTimeline`,
`Game.frameRender`). `eventPunch` remains allocation-safe (frozen
`PUNCH_KINDS` tuple, verified). `visualTimeline` remains allocation-free
(scratch write, no sorting, no THREE). `ChaseCamera` is pure math, no
allocation. Found and fixed (all behavior-preserving, all covered by the
unchanged suites + browser QA):

1. `PostPipeline.setBloomParams` allocated a `pendingBloom` staging
   literal on EVERY rendered frame (it is called every frame via the
   timeline/punch hooks). Now reuses the staged object and skips the
   write entirely when values are unchanged (steady-state sections sit
   still).
2. `RendererHost.applyFrame` called `camera.updateProjectionMatrix()`
   every frame AND `render()` repeated it — one matrix recompute per
   frame removed (the `render()` application is the single owner now).
3. `InteractionView.update` traversed the `dimmables` list TWICE per
   frame (orb loop + pad loop). Merged into one traversal with identical
   edge semantics (coreless-orb skip preserved).

Deliberately NOT touched: event-rate literals (`VfxSystem` anchor
objects — a few per event, not per frame), cold QA getters
(`liveBloomParams`, `countersSnapshot`, `projectToScreen` — never hot),
`hud.update` (DOM-bound anyway), `GameSimulation`/collision internals
(M2.1 already allocation-neutral; the `queryBox` Set is a documented
deferred note, not an M6D finding).

## THREE.JS AUDIT

All per-frame material writes are in-place `setHex`/scalar/opacity writes
on shared materials (`applyRouteState`, `applyVisualState`,
`setBloomParams`, `setEnergyRays`) — no state churn, no flag flips, no
program rebuilds. Visibility writes only on edges (rings, burst,
freeze paths). No per-frame color object creation (one `scratchColor` in
VfxSystem, reused). Composer never rebuilds (passes 3→3 in every sample).

## VFX POOL AUDIT

Capacities (authoritative): trail 96 / burst 384 / streak 24 (+ death
burst 24, separate bounded pool). Observed live peaks on the production
level: trail ≤33/96 (34%), burst ≤64/384 (17%, teleport exit-expansion —
the largest single event), streaks 0/24 at the sampled windows (2x
sections passed through staged windows without a live 2x sample; the
pool is 24-hard-capped by construction and pinned by `motionVfx` unit
tests). `?fx=off` parks all three at 0 with gameplay continuing. No
per-event allocation, no zombie particles (attempt/death/teleport edges
clear transients; cumulative QA counters never reset by design).

## DEATH BURST AUDIT

24 fragments / 0.5 s preserved exactly (no tuning change). Repeated-death
stress (10 deaths): same pool reused, `burstActive` live-in-hold proven
in-page, no fragment accumulation, no new geometry/materials, no
dangling fragments after reset (`clear()` on the respawn edge, pinned by
`tests/deathBurst.test.ts` + the 0/0/0 leak deltas). Evidence photo:
`m6d-07-death-burst` (freeze/replay path; the live hold is the
assertion, the photo the illustration).

## LEVELVIEW AUDIT

M7.3 decor (closed corner frames, rear sills, under-glow, ring gates,
tooth crowns, lava, guardians, chains) adds ~167 draw calls vs the slice
(530 vs 363) with ZERO new materials, ZERO new geometries, ZERO new
top-level children (all shared library instances inside the existing
group). No CPU/draw-call bottleneck demonstrated → no instancing merge
performed (deliberate non-change, documented). Portal visuals remain
static (zero per-frame work); reactive FX stays in the owned pools.
Environment rays: fixed 12, shared geometry/material, cheap opacity +
color writes only.

## POSTPROCESS COST

Production (Render → Bloom → Output, 3 passes) vs `?post=off` (direct
render, 0 passes): identical scene, fully playable both ways, all four
post×fx combos verified. Software delta is ~4× wall (rasterizer-bound,
not representative). Real-hardware post cost is the human gate's
measurement (the evidence JSON carries both shapes side by side).

## DPR ANALYSIS

Theme cap `dprCap: 1.5` (unchanged — respectable headroom, no evidence of
harm at DPR 1). Effective renderer ratio read back as 1 (headless DPR 1).
No cap change: uncapped-DPR cost was not demonstrated as harmful, and the
milestone forbids arbitrary resolution reduction. The human gate re-reads
this field at actual device DPR.

## RESOURCE LEAK TEST

Stress on the primary workload: 10 deaths + 10 restarts →
children Δ0 / materials Δ0 / geometries Δ0 / heap Δ0 (15.2 MB → 15.2 MB
in-run; second run 11.9 MB → 11.9 MB — flat, no trend). Replay stress
(repeated F4 replays + 3 teleport loops): Δ0/Δ0/Δ0. Composer passes 3→3
everywhere. Scene children 62 everywhere (opening → storm → replay).

## MEMORY TEST

`performance.memory` (Chromium): 12–15 MB used across configurations, no
growth across death/restart/replay/teleport stress (Δ0 to the byte on
both full runs — GC noise would show ±, a leak would trend; neither
appeared). No byte-identical expectation claimed; trend-tested instead.

## REPLAY STRESS

Natural-death tape (uncommanded cube into the opening spike — no debug
placement, which lives outside the input tape by design) → F4 →
verification `pass`, resources flat. (Method note: an early harness
attempt replayed a debug-teleported tape and diverged at the teleport
tick — CORRECT behavior, tape invalidation by design, not a product
finding; the scenario now uses natural deaths.) ReplayV1 untouched (1/1),
no ruleset bump, no performance data in replays. M5 golden fixture +
vertical-slice (6190) + advanced (7475) anchors all green in-suite.

## PERFORMANCE FIXES

1. `perf(M6)`: bloom staging reuse + change-guard (`PostPipeline`).
2. `perf(M6)`: single projection-matrix update per frame
   (`RendererHost`).
3. `perf(M6)`: single `dimmables` traversal (`InteractionView`).
4. `perf(M6)`: global warm hazard semantic — `resolveProductionTheme`
   no longer reads `LevelTheme.hazard` (see § M6A HAZARD AUDIT).
5. `test(M6)`: `PerfProfiler` + 5 regression tests; `?perf=1` probe;
   `gpuIdentity()` renderer verdict probe; `scripts/perf-gate.mjs`
   harness (6 configs + 8 scenarios + leak stress + evidence JSON).

Zero gameplay change: sim, controller, tuning, collision, level data,
teleport semantics, ReplayV1 all untouched (the only level-data-adjacent
change is renderer-side hazard resolution — colliders/fingerprints
byte-identical, pinned by the unchanged fingerprint suites).

## BEFORE / AFTER

Build 622.95 → 624.88 kB (+1.93 kB profiler/probes). Tests 360 → 365.
Resources 29/8/3/62 identical. SwiftShader wall-time is noise-dominated
across runs (8–10 fps ± load) so no before/after FPS claim is made from
it — the fixes remove per-frame garbage (pendingBloom literal),
redundant matrix work, and redundant traversal, whose payoff materializes
as GC/frame-time stability on hardware. The honest before/after on frame
times IS the human gate (§ NEXT MILESTONE), which is why the harness
records the exact same metrics both sides will compare.

## REAL-GPU RESULTS

Not obtained (no hardware GPU on this machine — stated plainly, not
worked around). `qa/perf/m6d-swiftshader.json` carries the full software
evidence set with `gpuSoftware: true` and a SOFTWARE verdict string the
harness prints. Claiming REAL-GPU PASS from it would violate the
milestone's critical rule; M6D does not.

## FUNCTIONAL REGRESSION

Full `scripts/browser-qa.mjs` gate post-optimization, two runs:

- Contaminated run (`qa/perf/browser-qa-m6d.log`, agent's fault —
  concurrent Chromium/SwiftShader instances during m71/m72): 301/312.
- Clean run (`qa/perf/browser-qa-m6d-clean.log`, current tree
  `0ff7394`, zero concurrent load): 303/312 with zero console/page
  errors. Green: every M7.1 check incl. the FULL real-input slice finish
  (`finished deaths=0`), every M7.3 section/staging/visual check, m73
  replay VERIFIED, restart/fallback guards, resource guards flat
  (29→29 / 8→8 / 62→62).

Remaining 9 fails, all classified (no M6D causation — the sim, input,
controller, collision, levels, portals and replays are byte-identical;
all determinism suites green; the advanced workload renders
pixel-identically to M7.3):

- 3 documented historical CDP-timing flakes (wall-rate dz signature,
  m3.1 eye sampling, m4 2x-rate) — identical signatures in every
  prior full-suite run.
- 6 advanced-route CDP-driver misses, all clustering at the single
  most latency-sensitive maneuver in the game (the FF-gate takeoff,
  ~25-tick window; M7.3 itself flags CDP latency up to ~2.5 u at 1x):
  m72 ceiling-islands staging stall, m72 FF mini-driver null, m72/m73
  full-finish drivers death-looping at the FF gate (22–23 deaths) +
  their runtime knock-ons. The box had been burning SwiftShader
  continuously for ~6 h across both runs; the same drivers passed at
  M7.3 on a cool box, and the maneuver itself is proven deterministically
  in-suite (FF required-proof + exact 7475-tick scripted finish, green).

A cooled-down confirmation run (291/312) showed the same CDP-actuator
pattern with zero product-side signal, so the loop was closed with a
decisive product-level proof instead of a fourth 2 h gate: the full
7475-tick advanced verification route — FF gate, both teleports, storm
climb included — was recorded headlessly through the REAL coordinator
and injected into the live page (`debugStartReplayJson`); it verified
tick-for-tick IN-PAGE (`pass`, 0 page errors, ~102 s wall under
SwiftShader). CDP reflexes cannot fake that: every input edge, the
22-tick FF hold, both teleport discontinuities and the 2x climb
reproduced exactly on the M6D tree. Perf-gate functional proofs
independently green: all 8 scenarios reached their sections, teleport
fired to the authored exit (`ac-teleport-hop` @ z≈515), natural-death
replay verified `pass`, restart/fallback/resource guards flat, zero
console/page errors in every perf configuration.

## VISUAL REGRESSION

Perceptual invariants verified on `m6d-*` shots: cyan player anchor,
warm readable hazards, rose route rails, mini-island frames, compact
teleport rings + toothed maw, guardian eyes/teeth/chain, lava glow, 2x
storm energy, strong death burst, violet punch tint. No renderer change
alters look (in-place value writes only). One deliberate pixel-level
delta: `validation-02` hazards now render the global `0xff9d00` instead
of its legacy `0xffb300` (indistinguishable warm-orange family — the
hazard-semantic contract fix, § M6A HAZARD AUDIT).

## M6A HAZARD SEMANTIC AUDIT

Confirmed the historical concern was LIVE: `resolveProductionTheme`
read `LevelTheme.hazard`, letting any theme replace the global warm
hazard identity (in practice `validation-02` shipped `0xffb300` against
the global `0xff9d00`). Resolved with the smallest safe change: the
overlay now flows route/environment identity only; hazards resolve to
`GLOBAL_HAZARD_COLOR` on every level (`LevelTheme.hazard` stays on the
type for data compatibility but is renderer-inert). Regression coverage:
`visualFoundation` pins identical hazard resolution across levels.
Gameplay untouched (fingerprint suites green; colliders identical).

## M6 STATUS CLOSEOUT

M6D: ENGINEERING COMPLETE (all code/static/leak/hot-loop work done,
harness built, software evidence recorded). The M6 visual production
system is NOT marked fully CLOSED/PASS: its defined M6D requirement
(real-GPU 60 FPS measurement) remains unperformed on hardware, and per
the milestone's reconciliation rule that is stated, not papered over.
Closing M6 = the human perf gate (§ NEXT MILESTONE). All prior human
gates keep their recorded states (M6A/B/C direction approved to proceed
2026-09-08; M7.1 approved 2026-09-10; M7.3 approved to proceed
2026-09-12).

## KNOWN LIMITATIONS

- No hardware GPU on this machine: steady-state p50/p95/p99, hitch
  counts, and the 60 FPS verdict are the human gate's job (harness +
  instructions ready).
- SwiftShader stills under-read additive juice/rays (unchanged).
- Streak live peak unobserved in staged windows (pool 24-capped by
  construction + unit-pinned; the human gate can sample a live 2x run).
- Ceiling scenario photo caught a post-spike death frame on one run
  (honest status recorded; section identity `ac-abyss` proven by probe).
- `?perf=1` is a URL/dev toggle, not a settings UI (no settings UI in
  scope).
- `LevelTheme.hazard` is now renderer-inert but still present in data
  (compatibility; documented).

## NEXT MILESTONE

M8 — MUSIC / BPM / RHYTHM SYNCHRONIZATION (nothing implemented here:
no audio, no clock, no sync engine — 31 position-bound rhythm cues stay
presentation-only metadata). Human M6D perf gate first:

1. `npm run dev` (or serve the built `dist/`).
2. Open a HARDWARE-accelerated browser (Chrome/Edge/Firefox with GPU).
3. `node scripts/perf-gate.mjs [--url http://localhost:5173/]`.
4. Check `qa/perf/m6d-real-gpu.json`: `gpu.renderer` must NOT match
   SwiftShader/llvmpipe/software/Basic-Render; steady-state envelope
   p50 ≤ 17.5 ms, p95 ≤ 20 ms, p99 ≤ 25 ms, no repeated >33.3 ms
   pattern at 1920×1080 @ DPR 1 production defaults.
5. If green: mark M6D PASS → M6 VISUAL PRODUCTION SYSTEM CLOSED, then M8.

No Ship, no new Cube content unless the human requests a specific fix.
