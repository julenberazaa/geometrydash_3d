# ROADMAP.md — Factual Milestone Record

> Status lines here describe VERIFIED reality (tests + browser QA + review),
> never aspiration. Update on every milestone state change (`AGENTS.md` §10).

## M0/M1 — Foundation + Cube controller: PASS (2026-09-03)

Deterministic 120 Hz fixed-step simulation; auto-forward Cube; continuous
3-lane kinematics with edge-triggered intent; deterministic jump +
hold-to-repeat + fast-fall + airborne lane correction; swept AABB collision
(solids/hazards/kill-front), void/frontal death, 0.45 s death hold,
deterministic respawn; track-centered chase camera; data-driven Test Level 01;
HUD + F1/F2/F3 debug; 41/41 automated tests; `npm run verify` green; browser
QA 19/19 green with zero console errors; milestone commit on `main`.

Provisional (needs human-feel gate before canonizing): edge-per-lane input
(no hold-to-slide), landing rotation snap, killFront side semantics.
Controller mechanically validated; HUMAN-APPROVED for feel post-M1.2 (movement
tuning frozen since — see M2). Historical note: run-counts here (41) predate
the test-import fix; unique tests at M1.2 closeout were 33.

## M1.1 — Input/visual polish: PASS (2026-09-03)

Human playtest feedback on the M1 build: broadly good; two fixes requested.
(1) Left/right reversal fixed at the root: lane index now increases toward
screen-right (`laneCenters` [+2.6, 0, −2.6], Floor `laneAxis` −X, asymmetric
level geometry mirrored) — `ArrowRight` = visually right, controller code
untouched. (2) Vertical neon corner trims added to solids ≥ 0.8 tall via the
existing shared edge system (markers/hazards untouched). 43/43 tests,
`npm run verify` green, browser QA 19/19 green with zero console errors.
Feel still NOT human-approved beyond the original feedback — M2 entry gate
(the human feel test) remains open. (Closed post-M1.2: human approved Cube
movement feel; tuning frozen. Historical run-counts (43) predate the
test-import fix; uniques were 33.)

## M1.2 — Exposed-face readability + lateral fall-off: PASS (2026-09-03)

Human playtest follow-up: controls accepted; verticals still missing on gap
faces; side fall-off requested. (1) M1.1 trims were fully embedded inside
opaque solids, hence invisible — reworked as face applique riding ~0.04
proud: outboard corner posts, front-face bottom strips (gap landing faces
read as framed portals), center seams on faces >= 6 wide; markers/hazards
untouched. (2) Lane intent unclamped with linear virtual-lane extrapolation:
outer tap teeters at the edge, further taps exit support -> airborne ->
fall -> existing death-plane reset; side contact with real geometry blocks
without killing. 33/33 tests, `npm run verify` green, browser QA 19/19
green with zero console errors.

## M2 — Collision/death/restart polish: PASS (2026-09-03)

Human Cube-feel gate APPROVED on entry (movement/jump/lane/gravity tuning
untouched). Explicit frontal-kill rule (contact normal + forward approach,
both blocking kinds); killFront blocks like solid, lethal frontally only,
safe top/side; hazard overlap swept; spike boxes pinned
smaller than visuals; corner ties documented + pinned; death instantaneous,
cause-tagged (hazard/frontImpact/void), idempotent, exactly-once event;
0.30 s (36-tick) hold; attempts +1 per respawn/restart only; R from any
state; finish-after-death impossible; pooled 14-fragment burst (0.35 s) +
restrained kick + camera snap on respawn; guarded Web Audio blip; F1 death
record + __gd3d probes. 54/54 unique automated tests (21 new), `npm run
verify` green, browser QA 40/40 green with zero console/page errors;
`qa/screenshots/m2-*` proof set (burst held via freeze/replay debug path).

## M2.1 — Collision fairness closeout: PASS (2026-09-03)

HUMAN M2 DEATH/RESTART FEEL = APPROVED (playtest: 0.30 s hold / 36 ticks,
burst, camera kick/snap, R behavior all accepted — M2 human gate closed).
Engineering closeout, zero gameplay retuning: (1) hazard kills now follow
the TRUE swept movement path — a hazard must overlap one of the three
single-axis swept segment volumes of the authoritative Y → Z → X path
(exact envelope-of-endpoints test, clipped intermediates included); the
old loose pre/post union rectangle remained only as broadphase and can no
longer falsely kill in corner regions the path never enters (regression
suite `tests/hazardCcd.test.ts`, incl. 4×-speed thin-hazard and clipped
fall cases). (2) duplicate death-hold timing authority removed —
`DEATH_HOLD_TICKS = 36` is the single source; `DEATH_HOLD_SECONDS` derives
from it. 62/62 unique automated tests (8 new), `npm run verify` green,
browser QA 40/40 green with zero console/page errors.

## M3 — Gravity architecture + Floor ↔ Ceiling gameplay: PASS (2026-09-03)

Gameplay-frame productionization with behaviorally UNCHANGED Floor gameplay
(proven by an exact-float golden trajectory gate captured from the pre-refactor
build). Authoritative gravity mode on the simulation; physical→logical input
interpretation (Space is always jump; arrow jump/fast-fall roles flip with
gravity; lanes never mirror); generalized support probing (below on Floor,
above on Ceiling); forward-axis frontal kill; lower + upper void bounds;
data-driven gravity portals (forward-crossing planes, exactly once per
attempt, no teleport/impulse, support cleared, death wins the step); ceiling
support/jump/fast-fall/lateral fall-off; data-driven test-level gravity
section (Floor → portal → ceiling run → ceiling gap → portal → Floor →
finish, playable end-to-end — proven by a deterministic per-step playthrough
test); cyan/warm neon portal visuals; render-only upside-down rest
orientation; world/camera never rotate or roll. 88/88 unique automated tests
(26 new), `npm run verify` green, browser QA 67/67 green with zero
console/page errors (40 M2 checks unchanged + 27 M3 checks), `qa/screenshots/
m3-*` proof set. HUMAN CEILING FEEL = OPEN (playtest requested).

## M3.1 — Ceiling camera, readability, and contact polish: PASS (2026-09-03)

Human playtest follow-up on M3: ceiling camera/scene "fighting the upper
geometry" + cube "floating". ROOT CAUSE PROVEN, not inferred: the gravity-
blind vertical framing put the camera EYE INSIDE the ceiling slabs (y≈6.11 vs
underside 6; pre-fix probe: 343 penetrating steps, worst 0.157 u) — backface
culling then hid the slab entirely (stray edge lines + black void → both
symptoms). Fixes, presentation-only: gravity-aware `CameraFocusSide` framing
(ceiling eye hangs mid-corridor BELOW the cube, settles y≈4.22, ≈1.8 u clear;
Floor branch byte-identical); dim unlit underside inset panel so the ceiling
run surface reads (down-facing Lambert is near-black there). Zero
gameplay/collider/controller/tuning changes; no camera collision system
(unneeded — non-penetration now pinned). 90/90 unique automated tests
(2 new, incl. the real-playthrough camera-eye non-penetration regression),
`npm run verify` green, browser QA 72/72 green (40 M2 + 27 M3 + 5 M3.1) with
  zero console/page errors, `qa/screenshots/m31-*` proof set, visual gate 4/4
  pass. HUMAN CEILING FEEL = STILL OPEN (re-playtest on the M3.1 build).

## M3.2 — Ceiling view parity & readability polish: PASS (2026-09-03)

Human re-playtest on M3.1: "looks better", but the ceiling view may still be
harder to read than the floor view. Measured audit (headless framing/pixel
probes, `scripts/m32-audit.mjs`) REJECTED the camera-framing and cube-
material hypotheses (eye distance 10.55 vs 10.30, cube width 92 vs 97 px,
both players mid-frame) and PROVED the real causes: (1) every neon rail sat
on TOP faces, so the ceiling run surface had zero edge structure exactly
where (2) the below-focus camera makes the Cube's own silhouette occlude the
ceiling surface ~4..16 u ahead (geometrically unavoidable from below). Fix,
presentation-only in `LevelView`: exposed undersides (ceiling run surfaces)
now mirror the top-edge rail treatment (2 longitudinal + 2 across neon rails
per slab), giving the ceiling the same converging-corridor language as the
floor; buried/resting bottoms unaffected (floor pixels unchanged). Camera,
gameplay, colliders, tuning, level content: untouched. Plus `screenPoint` QA
probe, `scripts/m32-audit.mjs` measurement tool, `tests/undersideRails.test.ts`
(3) + framing-parity bounds in `cameraFraming` (1). 94/94 unique automated
tests, `npm run verify` green, browser QA 76/76 green (40 M2 + 27 M3 + 5
M3.1 + 4 M3.2) with zero console/page errors, `qa/screenshots/m32-*` proof
set. HUMAN CEILING FEEL = STILL OPEN (re-playtest on the M3.2 build).

## M3.3 — Surface-relative camera projection symmetry + M3 closeout: PASS (2026-09-04)

Human re-playtest on M3.2: ceiling depth/readability acceptable to continue,
but one explicit CAMERA DESIGN RULE had to become an architectural invariant
before M4: the Cube face OPPOSITE the support surface (the FREE face — top
on Floor, bottom on Ceiling) must project with the same apparent size and
perspective on every gravity surface. Measured before fixing
(`scripts/m33-audit.mjs`): the ceiling free face projected at only **0.219×**
the floor's area (eye vertical offset −1.23 u vs +3.84 u — nearly edge-on),
while total cube width was comparable (the bounding-box size was never the
problem). Fix, presentation-only in `ChaseCamera`: the below-focus framing is
now the EXACT mirror of the above-focus framing about the corridor mid-plane
(shared 0.35 parallax slope, reflected anchor −0.3, look bias mirrored
+0.6/−0.6), giving a measured ratio of **1.000**; the rule is expressed
surface-relatively (free face = `surfaceNormal`-side face) so future gravity
surfaces inherit it — no Ceiling-only magic constant. Floor branch numerically
identical; M3.1 eye non-penetration contract green unchanged (rise dip min
0.72, portal-down peak ≈5.6 < underside 6). Plus the M3 semantic closeout
(separate commit): lethal checks (void, hazard) now run BEFORE gravity
portal processing, so a lethal step can never apply a gravity transition
(mode/count/portal-id stay pre-step). Camera, gameplay, colliders, tuning,
level content: otherwise untouched. `tests/cameraFraming.test.ts` +2
(exact-mirror pins, deterministic free-face projection parity),
`tests/gravity.test.ts` +2 (hazard+portal and void+portal same-step
precedence), browser QA M3.3 section +4 with `m33-*` parity evidence pair.
98/98 unique automated tests, `npm run verify` green, browser QA 80/80 green
(40 M2 + 27 M3 + 5 M3.1 + 4 M3.2 + 4 M3.3) with zero console/page errors.
HUMAN CAMERA/CEILING FEEL GATE = APPROVED (2026-09-04): human playtest on
the final integrated M3.3 + M4 build confirmed the surface-relative
projection parity and overall ceiling feel — M3 fully closed.

## M4 — Interactive mechanics: PASS (2026-09-04)

Pads, orbs, speed portals; moving obstacles deferred. Only on top of a validated Cube.
**STATUS (built on `8cfa2c7`, on `main`): COMPLETE mechanically/browser/
validated, including M3.3 parallel integration (cherry-picked A `d3c76bd`
+ B `d3c250e`; see the M3.3 entry above). HUMAN INTERACTION FEEL GATE =
APPROVED (2026-09-04): human playtest on the final integrated M3.3 + M4
build confirmed pads/jump orbs/gravity orbs/speed portals feel very well —
M4 fully closed (engineering, browser, and human gates all passed). Next
milestone: M5.**
First production interactive mechanics, data-driven and simulation-owned:
jump pads (passive contact impulse, surface-relative, explicit per-pad
magnitude), jump orbs (press-edge inside a swept activation window, airborne,
no buffer, held-input inert), gravity orbs (same window semantics; flips
Floor ↔ Ceiling through the ONE shared gravity-transition path — position and
velocity preserved), speed portals (deterministic forward-crossing multiplier
tiers 0.5–4×) and ONE authoritative speed state (level baseForwardSpeed ×
sim multiplier; 1× proven bit-identical by the floorCompat golden gate).
Trigger order made explicit with lethal checks preceding ALL portal and
interaction mutations (M3.3 invariant extended to every M4 interaction).
Original procedural visuals + pooled activation-ring VFX (presentation only).
Test Level interaction section (z 278..386) playable end-to-end
(deterministic playthrough test). Moving obstacles explicitly deferred
(time-varying colliders need their own pathway; see spec). 123/123 unique
automated tests (25 new M4 + 4 imported M3.3), `npm run verify` green,
browser QA 101/101 green (40 M2 + 27 M3 + 5 M3.1 + 4 M3.2 + 4 M3.3 + 21 M4)
with zero console/page errors, `qa/screenshots/m4-*` proof set.

## M5 — Replay + deterministic verification + second level: PASS (2026-09-07)

Deterministic replay + second-level architecture proof, zero new gameplay
mechanics. One completed attempt = one fixed-tick PHYSICAL input tape (one
compact integer per tick: 5 actions × held/pressed/released; no transforms,
no camera, no timestamps) recorded ABOVE a replay-agnostic `GameSimulation`
and replayed through the real sim with per-tick authoritative-state-hash
verification (first mismatch stops with tick + expected/actual hashes —
never corrected). Versioned V1 container (schema + explicit ruleset
versions, level binding via gameplay-content fingerprint, terminal
outcome); JSON serialization; committed golden fixture
(`tests/fixtures/replays/validation-level-02-v1.json`, 2346 frames) with a
manual generator (`npx vite-node scripts/generate-replay-fixture.ts`, never
in verify) and a negative divergence proof (one mutated input → divergence
at exactly tick 651). App integration: `Game` owns the `ReplayCoordinator`,
F4 replays the last attempt, HUD badge (REPLAY / VERIFIED / DIVERGED /
REJECTED), F1 replay lines, `__gd3d` replay probes, `?level=` selection via
a level registry with explicit unknown-id fallback. Validation Level 02
(`validation-02`, ~20 s, 11 u/s, ceiling pad/orb + 2× sections) is genuinely
separate content on the unmodified engine: real-input playthrough finishes
(tick 2346) and its live record replays to pass. Implemented across two
agent sessions (takeover audit preserved the replay core, fixed a
stale-partial hybrid-tape bug in `startReplay`/`abortReplay` and the Level
02 lane plan — see the M5 spec). 170/170 automated tests (39 new M5 + 8 hash-contract hardening — see below),
`npm run verify` green, browser QA M5 section 16/16 green with zero
console/page errors (`qa/screenshots/m5-*`); historical QA sections flap on
the same CDP-timing checks that flap on pristine pre-M5 HEAD in loaded
environments (proven via control run; no M5 causation). Hash-portability hardening (commit `74a7695`): `hash.ts` now stores Float64 bytes through an explicit big-endian `DataView.setFloat64(..., false)` — identical bytes on every host, byte-identical to the little-endian baseline, so the persisted golden replay stayed compatible and unchanged (no regen); 8 pinned hash-contract regression tests added (`tests/hash.test.ts`). HUMAN REPLAY + LEVEL-02 FEEL GATE = APPROVED (2026-09-07): human playtest confirmed M5 works well — M5 fully closed (engineering, browser, and human gates all passed). `npm run verify` green; browser QA M5 section 16/16 green with zero console/page errors. Next milestone: M6 — Visual production system.

## M6 — Visual production system: IN PROGRESS (M6A engineering complete, human visual gate OPEN)

M6A foundation (production visual language + material/lighting/post
foundation) is ENGINEERING-COMPLETE on `main`: renderer-owned production
theme (`src/visuals/productionTheme.ts`, bloom contract + ACES + exposure in
one owner), shared `MaterialLibrary` (26 materials / 8 geometries, zero
per-frame allocation, disposable), `PostPipeline` (RenderPass →
UnrealBloomPass → OutputPass, resize-safe, `?post=off` fallback), production
treatment for route/hazards/player/portals/interactions/environment,
per-level route overlay (validation-02 keeps its teal identity, same code
path), Floor/Ceiling parity re-proven (live free-face ratio 1.000, zero
camera changes). ZERO gameplay change: sim untouched, 182/182 automated
tests (12 new visual-foundation), M6A browser QA 24/24 green with zero
console/page errors, golden replay verifies unchanged (unit + in-page),
`qa/screenshots/m6a-*` evidence set. Spec:
`specs/milestones/M6_VISUAL_PRODUCTION_SYSTEM.md`. HUMAN VISUAL GATE = OPEN
(M6B was explicitly scoped as a reversible layer on the provisional
foundation — no re-approval implied). M6C (triggers),
M6D (performance closeout): ENGINEERING COMPLETE / REAL-GPU HUMAN PERF
GATE OPEN (see the M6D entry below).

M6B appendage (built on the provisional M6A foundation — M6A gate STILL
OPEN, nothing re-canonicalized): reversible motion-juice layer
ENGINEERING-COMPLETE — `VfxSystem` (trail 96 + bursts 384 + streaks 24,
pooled, 3 draw calls, `?fx=off` fallback, all four post×fx combos
playable), exact-once emission from real sim edges, surface-relative
Floor/Ceiling, replay recreates juice live (golden tape verifies WHILE
VFX observes, headless + in-page), zero sim change. 205/205 automated
tests (23 new motion-juice), M6B browser QA 24/24 + M6A 24/24 green, zero
console/page errors, `qa/screenshots/m6b-*` evidence set (review findings
fixed in-run: rear-face/shell spawns, snappier-but-photographable lives).
Spec: M6B sections in `M6_VISUAL_PRODUCTION_SYSTEM.md`. HUMAN
MOTION/JUICE GATE = OPEN. M6C1 trigger infrastructure (below) built on
the still-provisional M6A+M6B presentation — no re-approval implied.

M6C1 appendage (visual trigger infrastructure ENGINEERING-COMPLETE):
position-driven presentation timeline (`VisualSection` data on the level +
`visualTimeline.ts` controller: base + section + smooth interpolation =
scratch state, no drift), applied through in-place hooks only (route
retint, bloom retune in-contract, environment modulation, VFX
multipliers, exposure) — zero new draws/materials/geometries (children
50→50, 26/8/3 flat), `?triggers=off` exact-baseline fallback composing
with post/fx flags, replay carries zero timeline state (F4 recreates from
trajectory; golden tape verifies WHILE the timeline observes). Restrained
PROOF sections on both levels (explicitly not art direction). 226/226
automated tests (21 new timeline), M6C1 browser QA 25/25 + M6A/M6B 24/24
green, zero console/page errors, `qa/screenshots/m6c1-*` evidence set
(wash contexts documented, not hidden). Spec: M6C1 sections in
`M6_VISUAL_PRODUCTION_SYSTEM.md`. ARTISTIC TIMELINE HUMAN GATE = NOT
PERFORMED. M6C2 (reactive pass, below, not the full timeline
re-authoring)/M6D: M6C2 engineering-complete, M6D engineering-complete /
human perf gate open (see the M6D entry below).

M6C2 appendage (reactive visual authoring + ground contact FX
ENGINEERING-COMPLETE, built at the user's direction without waiting for
prior human gates — M6A/M6B/M6C1 gates all STILL OPEN, nothing
re-canonicalized): event-reactive punch (`visuals/eventPunch.ts`
envelope: pad/jumpOrb warm, gravity blue, speed tier-tinted — bloom
+0.15 in-contract, exposure +0.1, bg/fog flash + environment lift above
the section base, exact rest-restore, trigger-owned so `?triggers=off`
stays silent) + continuous support-plane skid sharing the trail buffer
(Floor/Ceiling surface-relative, speed-scaled, timeline-calmed, silent
airborne/off, existing reset path) + bounded companion amplification
(pad 20 / gravity 34 / speed 24 / orb 16 + gravity/pad streak kicks,
worst-case 124 << 384 pool). Zero gameplay change (sim untouched),
replay carries zero punch/contact state (in-page F4 VERIFIED), player/
hazard identities structurally stable, 26/8/3 + 50 children flat.
238/238 automated tests (12 new event-punch/contact), M6C2 browser QA
15/15 + M6C1 25/25 green, zero console/page errors, `qa/screenshots/
m6c2-*` evidence set (pane-wash contexts documented, not hidden). Spec:
M6C2 sections in `M6_VISUAL_PRODUCTION_SYSTEM.md`. HUMAN
REACTIVE/CONTACT GATE = NOT PERFORMED (final artistic timeline also
still remaining).

## M7 — 45–60 s Cube vertical slice: REWORK IN PROGRESS (M7 HUMAN FUN GATE REJECTED THE M7 LEVEL)

M7 HUMAN FUN GATE: REWORK REQUIRED — the human played the slice and
rejected the direction (too simple, track far too wide, too many safe
paths, visuals too conservative) plus confirmed a ceiling-spike orientation
bug. The M7 engineering record below stands as built; the M7 LEVEL is not
final. See M7.1.

## M7.1 — Precision, difficulty & spectacle rework: HUMAN FUN RE-TEST APPROVED

Rebuilds the vertical slice on the frozen Cube controller (zero tuning
changes): single-lane islands / two-lane platforms / narrow bridges /
staggered offsets with real airborne transfers (full-width slabs survive
only as 3 short recovery/release tools); difficulty up to
DIFFICULT/PRECISION-FOCUSED but fair (measured margins, thinnest 1.8 u
pad landing); ceiling spikes fixed by a general surface-relative rendering
rule (tip away from support); six distinct visual scenes + punch-amplified
events + 12 bounded background energy rays; 20 beat-ready rhythm cues for
future music mapping (NO audio ships). Deterministic real-input route
finishes tick 6190 (51.583 s), 0 deaths, replay VERIFIED. 285/285 automated
tests, M7.1 browser QA 45/45 green with zero console/page errors, golden
replay intact. Spec: `specs/milestones/M7_CUBE_VERTICAL_SLICE.md` (M7.1
section). M7.1 HUMAN FUN RE-TEST: APPROVED (2026-09-10 — the human played
the slice and said "esta muy bien, apruebo"). `vertical-slice-01` is the
approved Cube reference level and must be preserved. The approved Cube
controller remains frozen. Ship remains blocked until further milestones
land (see M7.2).

## M7.2 — Advanced Cube content expansion: ENGINEERING COMPLETE / HUMAN ADVANCED-CUBE GATE OPEN

Second production Cube level (`advanced-cube-01`, "ADVANCED CUBE 01",
`?level=advanced-cube-01`) on the frozen controller: HARD (clearly above
M7.1), longer (7455 ticks = 62.125 s deterministic), more vertical
(LOW/MID/HIGH floor bands + ~8 s ceiling world), more fragmented
(single-lane islands, offset transfers, fast-fall lintel gate), denser
(21 meaningful hazards at 2.2/100 u), plus ONE new mechanic — paired
teleport portals (entry 514 → exit 634 through a guardian-mouth setpiece;
deterministic, exactly-once, lethal-wins, skipped-interval-clean, pinned
exit semantics, ReplayV1 unchanged) — and monster-like presentation
setpieces with no gameplay (no AI/movement/collision). Eight visual
scenes + 27 beat-ready cues (still no audio). Deterministic real-input
route finishes with 0 deaths and replays VERIFIED; `vertical-slice-01`
preserved (M7.1 anchor tick 6190 re-pinned in-suite). 349/349 automated
tests, M7.2 browser QA green with zero console/page errors, golden replay
intact. Spec: `specs/milestones/M7_2_ADVANCED_CUBE_EXPANSION.md`.
Automation proves POSSIBLE, never FUN — do NOT mark PASS until the human
plays the advanced level.

Future direction (conceptual, not started): M6D human real-GPU gate
(harness ready; M7.3 is its workload) → music/rhythm synchronization
architecture → Ship mode → teleport expansions / Spider mode /
inclined/ramp surfaces / dynamic/moving hazards / animated
entities/monsters → harder production levels → editor/community later.
Basic teleport portals shipped in M7.2. Exact milestone numbering
provisional.

First production Cube vertical slice (`vertical-slice-01`, "VERTICAL SLICE
01", `?level=vertical-slice-01`): authored three-act ~51.6 s level on the
frozen M1–M6 stack (zero engine changes) — Act I flow, Act II ceiling world
with required ceiling/floor pads, jump orb gravity-orb return and inversion
callback, Act III 1x weave + 2x sprint + 1x release; authored 5-section
visual arc on the M6C1/C2 infrastructure. Deterministic real-input route
finishes at tick 6190 (51.583 s) with 0 deaths and replays VERIFIED.
256/256 automated tests (18 new M7), M7 browser QA 30/30 green with zero
console/page errors, golden replay intact. Spec:
`specs/milestones/M7_CUBE_VERTICAL_SLICE.md`. Automation proves POSSIBLE,
never FUN — do NOT mark PASS until the human plays the complete slice.
Ship remains BLOCKED.

M6 human-feedback note (recorded 2026-09-08, conservative): the human
played the M6 presentation, said it is "quite good", and explicitly chose
to proceed to M7 — recorded as M6 PRESENTATION DIRECTION APPROVED TO
PROCEED. No individual M6A/B/C parameter claimed locked; M6D engineering
closeout is complete with M7.3 as its workload (see the M6D entry above).
M6 is NOT fully closed until the human real-GPU perf gate passes.

## M6D — Performance / resource / stability closeout: ENGINEERING COMPLETE / REAL-GPU HUMAN PERF GATE OPEN

M6D engineering is complete on `main`: production workload is
`advanced-cube-01` (7475 ticks / 62.292 s). Hot-loop hygiene (bloom
staging reuse, single projection update, single interaction traversal),
global warm hazard semantic locked (`LevelTheme.hazard` renderer-inert),
DEBUG profiler (`?perf=1`, bounded 600-sample ring) + `gpuIdentity()`
renderer verdict probe + repeatable `scripts/perf-gate.mjs` harness
(6 configs + 8 scenarios + death/restart/replay/teleport leak stress).
Software evidence (`qa/perf/m6d-swiftshader.json`): 29 materials /
8 geometries / 3 passes / 62 children flat; 10 deaths + 10 restarts +
replays + teleports → zero resource/heap growth; natural-death replay
PASS; VFX peaks bounded (burst ≤64/384, trail ≤33/96); zero
console/page errors; 365/365 automated tests; build 624.88 kB.
NOT a REAL-GPU PASS: only SwiftShader (software) was available — the
60 FPS hardware verdict is the human gate (same harness, same JSON).
Spec: `specs/milestones/M6_D_PERFORMANCE_CLOSEOUT.md`. M6D.1 adds the
explicit headed hardware mode (`--real-gpu [--channel chrome|msedge]`,
rules in `scripts/perfGateLib.mjs`, unit-tested without a GPU; default
headless mode unchanged, evidence now defaults to
`qa/perf/m6d-swiftshader.json` vs `qa/perf/m6d-real-gpu.json`). M6 is
NOT fully closed until the human perf gate passes. Next: M8
music/BPM/rhythm.

## M7.3 — Advanced Cube polish & spectacle pass: ENGINEERING COMPLETE / BROWSER QA GREEN / HUMAN RE-TEST APPROVED TO PROCEED

Focused M7.2-feedback rework of `advanced-cube-01` on the frozen
controller (zero tuning changes, no level-id engine branches, ReplayV1
unchanged): offset island pairs with mid-air transfers, a full-width maze
jump-wall + 3 lane walls, tall spikes + denser groups + triple ceiling
spikes, two overhead air-gate arches, a second short-hop teleport (mid-air
ring 489 → exit 513, co-visible pair) beside the maw jump (524 → 634),
smaller rounder ring gates, closed block corners + rear sills, glowing
mini-islands, 6 lava basins + chained guardian/beast setpieces
(presentation-only), stronger death burst (24 fragments / 0.5 s) and
teleport FX. Scripted real-input route finishes tick 7475 (62.292 s),
0 deaths, replay VERIFIED (unit). 360/360 automated tests (11 new),
`npm run verify` green, golden replay intact. Browser QA: 302/312 green
with zero console/page errors — ALL M7.1/M7.2/M7.3 checks green incl. two
full real-input finishes at the exact 7475 anchor with in-page REPLAY
VERIFIED (10 remaining fails: the documented pre-existing load-flake set,
zero M7.3 causation). Spec:
`specs/milestones/M7_3_ADVANCED_CUBE_POLISH.md`. M7.3 HUMAN
ADVANCED-CUBE RE-TEST: APPROVED TO PROCEED (2026-09-12 — the human played
the advanced level and said "esta bastante bien. vamos a seguir hacia
delante"). Recorded conservatively: the advanced Cube direction is
accepted and development may proceed — not "perfect", not permanently
locked art, no redesign permission. Next: M6D real-GPU closeout →
music/rhythm → Ship.

## M8 — Multimode & Hazard Expansion: ENGINEERING COMPLETE / HUMAN MULTIMODE GAMEPLAY GATE OPEN (feature/m8-multimode-gameplay, NOT merged)

PRODUCT REPRIORITIZATION (human direction): M8 is NO LONGER music/rhythm.
M8 is the multimode & hazard expansion — real lethal lava (sourced/
contained, instant death), stronger readable death (78-tick hold), compact
professional portals, four-way gravity (Floor/Ceiling/Left wall/Right
wall), Ship + Spider player modes, the dynamic lava Chomper, maze + trap-
island production content (`multimode-gauntlet-01`), all deterministic and
replay-safe. Music/BPM/rhythm synchronization is deferred to the NEXT
provisional milestone after M8 (NOT started). M6 real-GPU hardware gate
remains OPEN (the M8 workload is heavier; rerun after human approval).
Ship mode is part of THIS milestone (was previously gated behind Cube
validation — that validation has now passed twice: M7.1 + M7.3).

M8 engineering record (2026-09-14, feature branch): lava gameplay +
death rework, portal redesign + bounded teleports, four-way gravity with
frame-relative lanes, Ship + Spider modes, deterministic Chomper system,
`multimode-gauntlet-01` (finish z=1200, scripted real-input completion
tick 10321 / 86.0 s / 0 deaths / all modes + gravities / both Chompers
spent, replay VERIFIED in-suite). `npm run verify` green (33 files /
464 tests, ReplayV1 unchanged, golden fixture intact). Browser M8 slice:
35/35 green with zero console/page errors (lava, death, portals, walls,
Ship, Spider, Chomper, maze, traps, full in-page finish + REPLAY
VERIFIED, restart/resource guards). Screenshots `qa/screenshots/m8-*`
(+ sidecars). Shared-material delta 28 → 36 recorded (+2 lava, +2 mode,
+4 chomper). Monolithic-gate M1–M7 sections show the documented
software-rendering load-flakes in this environment (unchanged product
behavior; no test weakened). Human playtest next:
`?level=multimode-gauntlet-01` on the feature branch.

## M8.1 — Multimode polish & portal bounds: ENGINEERING COMPLETE / HUMAN POLISH GATE OPEN (feature/m8-1-polish-portals-lava-death, NOT merged)

Focused human-feedback pass on the M8 branch (playtest: rest broadly
good): sourced lava-river crossings (gap-river vents + an at-grade curb
hop), BOUNDED portal triggers on gravity/speed/mode portals (swept-volume
gates — crossing outside the opening no longer fires; S3 routing gaps +
gate pylons make misses fail by geometry), a general wall-lane debt fix
(impossible presses clamp to one lean step — single-press recovery, M1.2
fall-off intact), a walled Ship tunnel with neon mid-bands, mode-aware
voxel death breakup (palettes + ghost shell + held chunk size, same
78-tick hold), a lava-creature Chomper (snout/fangs/spikes/chomp cycle,
sim byte-identical), compact volume-centered portal rings. Gauntlet anchor
tick 10321 preserved (0 deaths, replay VERIFIED); ReplayV1 unchanged;
golden fixture intact. 37 files / 492 automated tests (+28), `npm run
verify` green. Browser M8.1 gate: 43/43 green with zero console/page
errors (35 M8 incl. full in-page finish + REPLAY VERIFIED, flat 35/8/63
resources; 8 new M8.1) with `qa/screenshots/m81-*` evidence. Spec:
`specs/milestones/M8_1_MULTIMODE_POLISH_AND_PORTAL_BOUNDS.md`.
Automation proves POSSIBLE, never FUN — do NOT mark PASS until the human
plays the M8.1 branch.

## M8.2 — Lava / portal-bounds / spider-camera / chomper polish: ENGINEERING COMPLETE / HUMAN POLISH GATE OPEN (feature/m8-2-lava-portal-spider-chomper-polish, NOT merged)

Corrective follow-up on the M8.1 branch (playtest: lava still an orange
block; portal bug still fires from outside the ring; chomper reads like a
mouse; spider camera snaps; wall-lane/ship-tunnel/death reported good
and preserved untouched). (A) Lava render rework, presentation-only:
pool crust plates over bright cracks, 4-step zigzag viscous falls grading
bright-to-deep, impact splash discs, vent-mouth drips; re-authored vent
compositions (protruding lips over their falls); new lavaAuthoring rule 4
(vent mouths must not be buried in rock). Lethal boxes unchanged.
(B) TRUE portal bounds: new `portalAuthoring.ts` validator (trigger
volume ≈ visible ring opening, ring radii single-owned there and used by
LevelView); gauntlet gates shrunk to opening size on probed rider lines;
side runaway catcher (deathX ±11) so missed S3 wall gates fail by routing.
Trigger mechanism untouched. (C) Chomper view-only redesign: bright
emissive-orange blocky body, big square head, wide hot maw, 4 large fangs
+ jaw teeth, brow-hooded eyes; sim byte-identical. (D) Spider camera:
presentation-only 0.55 s swap glide envelope (slower lambdas, spider-
context only); gravity/Cube/Ship framing numerically untouched. Gauntlet
driver still completes via real inputs (0 deaths, replay VERIFIED);
ReplayV1 unchanged; golden fixture intact. 507 automated tests, `npm run
verify` green. Browser M8.2 gate: 54/54 green with zero console/page
errors (M8 + M8.1 + 11 new M8.2: lava source/fall/river, gate
inside/outside + geometric miss failure, spider glide arming, chomper,
replay VERIFIED) with `qa/screenshots/m82-*` evidence. Spec:
`specs/milestones/M8_2_LAVA_PORTAL_SPIDER_CHOMPER_POLISH.md`.
Automation proves POSSIBLE, never FUN — do NOT mark PASS until the human
plays the M8.2 branch.

## M8.3 — Lava motion, Chomper style match, spider camera continuity: ENGINEERING COMPLETE / HUMAN POLISH GATE OPEN (feature/m8-3-lava-motion-chomper-style-spider-camera, NOT merged)

Second corrective follow-up (M8.2 verdict: lava still static/dull;
Chomper still off-reference; Spider swap still a teleport/reload).
Root causes, all audited: (a) every lava mesh was build-time static —
the only motion a global ±0.35 emissive breathe; (b) the M8.2 head was a
box bolted on a separate body with a slab maw, glow-sphere eyes and
cone fangs; (c) REAL camera bug — every Spider swap tripped the >5 u
teleport detector and hard-cut via `snapTo` BEFORE the M8.2 glide armed.
Fixes (mechanism untouched everywhere): living lava — tone-map-safe
saturated glow + deeper pulse + `LevelView.updateLava` convection/flow
(render-dt, zero alloc, pause freezes); reference-match Chomper — one
mottled magma head-ball, cavity maw, 7 block teeth, square white/pupil
eyes, hot chain + weight cube (same 26 budget, sim identical); Spider
continuity — swaps skip the snap, pose-capture smootherstep blend
(in-page peak eye velocity ~4 u/s; a snap would read >100 u/s).
512 automated tests, `npm run verify` green. Browser M8 slice: all M8.3
checks green, zero console/page errors, replay VERIFIED (`qa/screenshots/m83-*`);
residual scripted-timing flakes (ship pair) proven environmental by a
same-day pristine-M8.2 control run failing the identical checks. Spec:
`specs/milestones/M8_3_LAVA_MOTION_CHOMPER_STYLE_SPIDER_CAMERA.md`.
Automation proves POSSIBLE, never FUN — do NOT mark PASS until the human
plays the M8.3 branch.

## M8.4 — Lava flow polish (source → crossing → cliff-fall): ENGINEERING COMPLETE / HUMAN POLISH GATE OPEN (feature/m8-4-lava-flow-polish, NOT merged)

Third corrective follow-up (M8.3 verdict: everything good EXCEPT lava).
Root causes, all audited: (a) bright lava area a thin grazing-angle slab
with no white-hot accents; (b) all motion in-place oscillation, zero net
transport; (c) the river content symmetric twin-feed with no exit — a
gate, not a flow; (d) small vents. Fixes (mechanism untouched):
presentation-only `flow` hint + validator rule 5 (downstream handoff) +
rule-3 spillover; gauntlet river re-authored east-source → identical
crossing box → shelf channel → cliff drop past deathY; renderer
conveyors (traveling near-white-hot cores, shear-riding crust, pour
pulses, spill lips, chimneys, all t = 0-continuous) + modest glow lift.
523 automated tests, `npm run verify` green. Browser M8 slice: 65/65
fully green, zero console/page errors, replay VERIFIED
(`qa/screenshots/m84-*`; composition NDC-verified in one frame).
Spec: `specs/milestones/M8_4_LAVA_FLOW_POLISH.md`. Automation proves
POSSIBLE, never FUN — do NOT mark PASS until the human plays the M8.4
branch.

## Ship mode — part of M8 (multimode expansion)

Enclosed tunnels, multi-surface hazards, speed feel. Cube validation
(M7.1 + M7.3 approvals) is complete, so Ship ships inside M8.

## M8.5 — Production showcase level (THE DESCENT): ENGINEERING COMPLETE / HUMAN SHOWCASE GATE OPEN (feature/m8-5-production-showcase-level, NOT merged)

First superproduction level (`production-showcase-01`, now the DEFAULT
level — legacy levels stay on explicit `?level=`): ~2-minute HARD/EXPERT
arc (forge, fractured islands, two-door labyrinth, four-way gravity
cathedral, Chomper canyon, Ship reactor with a sustained INVERTED Ship
segment, Spider temple with wall snaps, teleport-choice void, final
gauntlet), 3 real branch sections, 9 visual scenes, 10 bounded gravity
portals + 4 mode + 2 speed + 3 teleports + 2 pads + 2 required orbs +
4 Chompers + directed lava rivers. Reference AND alternate scripted
routes finish at tick 13955 (116.29 s) with 0 deaths and replay VERIFIED
(`tests/helpers/showcaseScript.ts`, `tests/showcase.test.ts` — 12 tests;
`npm run verify` green; browser M8.5 section incl. a full in-page
real-input finish + REPLAY VERIFIED with `qa/screenshots/showcase-*`
evidence). Spec: `specs/milestones/M8_5_PRODUCTION_SHOWCASE_LEVEL.md`.
Automation proves POSSIBLE, never FUN — do NOT mark PASS until the human
plays the showcase branch end to end.

## M8.6 — Extreme density, verticality & moving-world overhaul: ENGINEERING COMPLETE / HUMAN EXTREME-GAMEPLAY GATE OPEN (feature/m8-6-extreme-density-verticality, NOT merged)

Human M8.5 verdict: visuals/lava/monsters/modes liked; gameplay rejected
as too easy, flat, sparse and slow ("a nice 3D obstacle course"). M8.6
buffs gameplay INSIDE the preserved production: THE DESCENT reworked to
VERY HARD/EXPERT density (5× decisions/elevation/interactions, not objects)
in the same ~2-minute duration (reference 14797 ticks = 123.31 s both
routes, inside the 115–130 s band). New scoped engine capability:
deterministic moving platforms (`MovingPlatformDef` data + pure
tick-derived pingpong poses + sim-owned clock/riding + dynamic-solid
collision path appended after the static hash + fingerprints extended;
≤ 8 per level; 5 ship in the showcase: void ferry, maze pair, chomp ferry,
void lift) plus a parallel-rest Z-straddle fix in `moveAabb` (support faces
can never block forward). Level: multi-deck islands, stair ascents/drops,
two-deck maze with pose-read ferry transfer, compact 4-way gravity spire,
Chomper × moving-island/weave/gravity/lava combos, hard + inverted Ship
tunnel, hard multi-surface Spider incl. walls, teleport network, everything-
remix finale. Proof: `npm run verify` green (567 tests incl. moving-platform
units, density/height/lateral contracts pinning the M8.5 baseline far
below, both-route completion + replay VERIFIED, routing-death pins);
`scripts/browser-qa-m86.mjs` 26/26 green twice in a row (16 staged captures,
live platform motion, Chomper telegraph, full real-input in-page finish
with 0 deaths, in-page REPLAY VERIFIED, flat resources, zero errors).
Spec: `specs/milestones/M8_6_EXTREME_DENSITY_VERTICALITY.md`. Automation
proves completable, deterministic and denser — never fun, fair-feeling or
really hard: do NOT mark PASS until the human plays it end to end.

Camera corrective pass (same branch): human playtest found multi-height
framing collapse + solid occlusion. Fixed by deck-invariant intercept
adaptation (rest ±3.84 u on all sides at every deck; corridor pins
unchanged) + occlusion pull-in resolver with fade last resort (Spider glide
and teleport snaps preserved). Proof: 28 camera tests green (5 multi-height,
11 occlusion A–J, 2 both-route sweeps) + `scripts/browser-qa-camera-m86.mjs`
46/46 (14 staged high/low areas, live pull-in, fade dormant, zero errors).
Final state: ENGINEERING COMPLETE / HUMAN CAMERA GATE OPEN.

## M9.1 — Radical rhythm rebuild: IN PROGRESS (feature/m9-1-radical-rhythm-rebuild, NOT merged)

Takeover after the M9 human gate FAILED (silent browser audio + insufficient
re-authoring). Phase A (audible-music root cause + fail-loud start gate):
TRANSPORT PASS 13/13 twice (`scripts/browser-qa-m91-audio.mjs`). Phase B
(same id/title, radically re-authored route, 7/9 acts replaced): density
targets held per `tests/showcaseM91.test.ts` + `tests/showcaseDensity.test.ts`
(2× action events, 1.7× reversals/bands, 1.5× supports, 2× fast-fall,
≤90-tick gaps), route-width 70/90/10 contract green, both reference routes
finish tick 13799 with 0 deaths + replay VERIFIED, `npm run verify` green
(50 files / 619 tests). Phase C (re-sync + visual overdrive: instanced
architecture, lightning, per-biome palettes): music alignment green,
screenshots `qa/screenshots/m91-*`. Browser playthrough gate 20/20 via the
tick-exact in-page tape (wall-clock live driving exceeds headless delivery
quantum at this density — documented in the spec §7; `?stepcap=N` QA slow-mo
proves cross-cap determinism in-gate). Automation proves completable, never
fun — do NOT mark PASS until the human plays it with sound on (HUMAN AUDIBLE
MUSIC PASS + HUMAN M9.1 gameplay gate both OPEN).

## M9.2 — Audio root-cause fix + checkpoint practice mode + visual overhaul: ENGINEERING COMPLETE / HUMAN AUDIO + CHECKPOINT + VISUAL GATE OPEN (feature/m9-2-audio-checkpoints-visual-overhaul, NOT merged)

M9.1 gameplay HUMAN-APPROVED (no route redesign). Three goals:

Audio (root cause PROVEN by audit, not inferred): `MusicDirector.startAt()`
created the buffer source AND the gain, connected gain → destination, and
started the source — but NEVER connected source → gain (the interface
exposed no connection at all). Transport stayed green while nothing could
reach the speakers — the exact human symptom. Fix: every live voice now
satisfies BUFFER SOURCE → MASTER GAIN → DESTINATION, wired in that order
BEFORE `start()` via `engine.connectSourceToGain` (real nodes stay inside
`WebAudioEngine`; wiring failure aborts loud, never silent `playing`);
`MusicProbe` + `__gd3d` carry `sourceCreated/sourceConnected/
gainConnected/effectiveGain/graphReady`; `tests/musicDirector.test.ts`
proves the wiring order structurally (fails on the old silent-`playing`
behavior). Browser gate `scripts/browser-qa-m92.mjs` 16/16 green incl.
the structural graph assertion (source + gain connected, 0.9, ready,
buffer ≈ 121.57 s). HUMAN AUDIBLE MUSIC PASS stays open (only ears prove
speakers).

Checkpoints: CLASSIC RUN vs CHECKPOINT RUN selector on the start gate
(one click = mode + audio unlock + start; Space/bare click = classic,
C/2 = checkpoint). Eight authored gem/crystal gates (FORGE/SKYBRIDGE/
LABYRINTH/CATHEDRAL/FOUNDRY/REACTOR/TEMPLE/CORE — sampled grounded cube
states, both reference routes activate 8/8 with the 13799-tick anchor
preserved). Sim-owned atomic snapshots (position/velocity, grounded,
support, lane, gravity, mode, speed, all one-shot sets, Chompers,
platform tick with pose re-derivation, elapsed anchor); death
auto-respawns from the latest; music re-seeks to the checkpoint time;
camera snaps via the existing dead→running edge; R = checkpoint,
Shift+R = full restart; session-scoped; F4 stays classic (checkpoint runs
are practice, finish shows PRACTICE COMPLETE). `npm run verify` green
(635 tests incl. 13 new `checkpoints` + 3 new structural audio).

Visual: abyss floor (biome-tinted bed below the void bound), 240 biome
motes, lightning 10 → 14 with per-bolt biome tint, architecture 30 → 44
towers / 20 → 28 walls (still one instanced draw), portal-ring energy
breathing, checkpoint crystals (shared gem + idle/active materials +
pooled bursts). Lava untouched. Library 40 → 47 materials (+7 checkpoint),
 8 → 9 geometries (+1 gem); per-biome `qa/screenshots/m92-biome-*` stills
vs the m91 set. Real-GPU perf verdict stays a human gate (draw calls are
dominated by pre-existing per-mesh route dressing; M9.2 adds ~30).

## M9.3 — Traversal density + Spider fix + Ship routing + purple megastructure: ENGINEERING COMPLETE / HUMAN TRAVERSAL + SPIDER + SHIP + PURPLE GATE OPEN (feature/m9-3-traversal-spider-ship-purple-polish, NOT merged)

M9.2 gameplay HUMAN-APPROVED (no rebuild). Targeted surgical polish on six
human findings (spec: `specs/milestones/M9_3_TRAVERSAL_SPIDER_SHIP_PURPLE_POLISH.md`):

- Straight-run audit (measured, both reference routes): the 10.22 s
  purple lateral gap (522–665), ship laterals (~8.5 s), cathedral/foundry
  gaps mapped; surgery is time-neutral (lane/wall/spike insertions never
  move the 13799-tick / 115.06 s anchor — only speed portals affect it,
  and none moved).
- Spider first-snap BUG (reproduced, root-caused): entry-step presses died
  in the mode handoff (consumed as cube jumps, effect zeroed) — now
  honored as snap attempts (`tests/spiderFirstSnap.test.ts`, 8 tests;
  in-page 3/3 one-press proof). Difficulty eased one notch (later first
  wall, wider climb slabs, teeth rebalance; 4-way/wall snaps kept).
- Ship portals: six funnel walls (visible opening == trigger volume;
  `tests/shipPortalBypass.test.ts`, 8 groups — offsets miss and die at
  rock) + LOW-LEFT → HIGH-RIGHT 3D diagonal (staggered invert/revert
  rings; abyss already 1× technical).
- Island landing glow (`ContactPulse`: local 0.30 s accent pulse, pooled
  no-leak slots, moving islands ride the mesh; 7 unit tests + in-page
  count/id/decay probes).
- Purple megastructure (`ps-labyrinth` 430–720): offset transfer decks
  (A→B→C1→C2 lateral jumps), tower+lintel gates, bridge city, exit weave,
  lane-0 door 4; primary lateral 16→22, reversals 13→17; visual deepen.
- Global: ship-exit gateway; remaining gaps justified (1-lane precision,
  ferry carriage, wall stairs, orb rhythm, recovery).

Proof: `npm run verify` green (54 files / 658 tests); anchor 13799 both
routes + replay VERIFIED; m92 browser gate 16/16 green (audio + checkpoints
intact); m93 in-page probes 12/12 green (spider 3/3, island count/id/decay,
screenshots, zero errors). Human gates (feel, purple look, island feedback,
audible music) remain OPEN — automation proves mechanics, never fun.

## M9.4 — Level select + live practice-mode switching: ENGINEERING COMPLETE / HUMAN LEVEL-SELECT + LIVE-MODE GATE OPEN (feature/m9-4-level-select-live-practice-mode, NOT merged)

M9.3 gameplay/presentation HUMAN-APPROVED in direction (no redesign).
Game structure on the untouched M9.3 stack:

- TWO independent production levels: `the-descent` (THE DESCENT — exact
  M9.2 content from `ff1d584`, materialized as `THE_DESCENT_CLASSIC` with
  only id/export/header changed, M9.2-era driver frozen alongside) +
  `production-showcase-01` (id kept so replays/fingerprints stay valid;
  user-facing title isolated as THE DESCENT — EVOLVED, display-only).
  No shared mutable content (pinned); both declare the same 8 crystals +
  the same Gravity Lessons track independently.
- Start flow: bare URL → polished SELECT LEVEL → SELECT MODE → START
  screen (EVOLVED + CLASSIC preselected, no auto-start — the START
  gesture unlocks audio and begins tick 0); `?level=<id>` keeps direct
  legacy entry; `?mode=` preselects on both paths.
- Live switching: pause menu toggles CLASSIC/CHECKPOINT mid-attempt (no
  reload) — crystals appear/disappear, earned snapshots retained but
  unusable in Classic (death → origin), reusable on re-arm, music/camera/
  position untouched by the toggle. Practice-taint contract
  (`RunModeController`, headless-tested): an attempt that EVER armed
  checkpoints stays PRACTICE until a full origin restart (Shift+R or
  pause RESTART, always in the current mode); tainted Classic shows
  CLASSIC CONTROLS — PRACTICE RUN; finish/F4 gate on `attemptKind`.
- Sessions: one `Game` per selected level (`AppController`); LEVEL
  SELECT disposes everything (canvas, listeners, loop, music, HUD,
  replay) and the next START builds fresh. Cross-level replays rejected
  both directions (pinned); both routes finish each level at tick 13799
  with 0 deaths, replays VERIFIED.

Proof: `npm run verify` green (682 tests: 658 M9.3 + 24 new);
`scripts/browser-qa-m94.mjs` 22/22 green (full menu→sessions→toggle→
return flow incl. spider one-press + contact-pulse M9.3 spots, zero
console/page errors); `scripts/browser-qa-m92.mjs` 16/16 green on the
menu flow (audio graph + checkpoints + fail-loud intact). Spec:
`specs/milestones/M9_4_LEVEL_SELECT_AND_LIVE_PRACTICE_MODE.md`.
Automation proves structure, never feel — do NOT mark PASS until the
human plays the menu + live-switch gate. Known doc debt: pre-M9.4
full-suite browser scripts that boot the bare URL (monolith m85 section,
m86 boot) still assume immediate start + the old display name and need
menu-flow migration; the systems they cover stay green in-suite.

## M9.4.1 — Original THE DESCENT + main-menu return: ENGINEERING COMPLETE / HUMAN ORIGINAL-LEVEL + MAIN-MENU GATE OPEN (feature/m9-4-1-original-descent-menu-fix, NOT merged)

Corrective pass over M9.4 (no gameplay redesign — M9.3/M9.4 mechanics,
tuning, visuals, audio, camera, replay untouched):

- M9.4 MISTAKE CORRECTED: `the-descent` was the frozen M9.2 snapshot
  (post-M8.6 super-difficult content). It is now the REAL pre-M8.6 M8.5
  production route, byte-extracted from `34db456` (last M8.5 state before
  the `e5b0d86` M8.6 overhaul) with only id/export/header + M9 music
  binding (background, NOT beat-mapped) + 8 crystals authored for its own
  geometry. Diff-vs-history verified.
- Proof: recovered M8.5 driver finishes tick-exact at the historical
  13955 anchor (116.29 s) on both variants with 0 deaths on the current
  engine, replay VERIFIED; metrics match the M8.6 audit (67 action
  events / 30 jumps / 12 lanes / 0 fast-fall / 32 supports / Σ|ΔY| 206.6
  / Σ|ΔX| 89.4) against 917 / 88 / 577.0 evolved. Provenance suite pins
  it (`tests/theDescentClassic.test.ts`, 13 tests).
- MAIN MENU from any run: `ESC` pauses like `P`; pause button renamed to
  MAIN MENU; always-visible ☰ MENU corner button; MAIN MENU disposes the
  session to zero residue (HUD/debug DOM now removed, browser-pinned) and
  returns to the startup selector for a fresh map/mode START. Live
  CLASSIC↔CHECKPOINT switching + practice-taint contract preserved on
  both maps.
- QA: `npm run verify` green (686 tests); `browser-qa-m941.mjs` NEW (§29
  human flow); `browser-qa-m94.mjs` migrated (original coordinates, MAIN
  MENU, HUD-removal); `browser-qa-m92.mjs` migrated (original crystals);
  monolith bare-URL boots → explicit levels (M6 → test level, 24g M8.5
  gate → `the-descent`); `browser-qa-m86.mjs` → explicit evolved entry.
  Spec: `specs/milestones/M9_4_1_ORIGINAL_DESCENT_AND_MAIN_MENU_FIX.md`.
  Automation proves structure, never feel/fun — do NOT mark PASS until
  the human plays ORIGINAL vs EVOLVED plus the ESC → MAIN MENU →
  switch → START flow with sound on.

## M9 — Gravity Lessons rhythm polish: ENGINEERING COMPLETE / HUMAN MUSIC-RHYTHM GAMEPLAY GATE OPEN (feature/m9-gravity-lessons-rhythm-polish, NOT merged)

Human M8.6 verdict: POSITIVE after the camera corrective pass (level
visually strong, substantially more enjoyable) — but wide permissive
corridors still admit ~4–5 equivalent safe lines. M9 takes THE DESCENT
from platforming level to music-driven superproduction on three pillars:
(1) real music + rhythm sync, (2) precision-route polish, (3) rhythm VFX.

Music (measured locally from the user-supplied file — never replaced):
`Gravity_Lessons.mp3` (121.574 s, 44.1 kHz stereo, 192 kbps, committed at
`public/audio/`, no LFS) is stable 120 BPM (beat k at 0.06 + 0.5·k s),
final impact beat 230 at 115.06 s, digital silence after ~115.3 s.
`MusicDirector` (presentation-owned Web Audio transport) follows the
deterministic sim clock (`targetMusicTime = elapsedSimTime + offset`;
dead-band ±60 ms, resync beyond 180 ms — sim never touched); press-to-start
gate (tick-0 frozen scene, first gesture starts music + sim together);
P pause/resume, death/respawn cut + origin restart, R restart, F4 replay
follow, `?music=off` silent with zero gameplay difference. Music metadata
is fingerprint-excluded (pinned); ReplayV1 unchanged.

Retime: reference route 14797 ticks (123.31 s) → 13800 ticks (115.00 s),
finish 60 ms off beat 230 (major tier). Levers, all musically justified:
2× Spider spire (climax snap chains) with a 1× wall-entry precision window,
2× foundry slalom (Drop-B single-door weave walls), 2× ship-exit runway;
vertical transitions stay 1× (rise/fall physics covers 2× distance at 2×).
Authored alignment (reference driver vs beat grid): majors median 60 ms,
30/51 within ±70 ms, finish ±70 ms; documented outliers (recovery
pad-shaft, physics-locked ceiling hop, river-locked spider pair, wall-calm
lip window, syncopated ship-tunnel flips, 2×-lip speed portals) report
honestly with reasons. 44 beat-anchored rhythm cues (evolved M7.1 system).

Precision routing: route-openness audit (safe-band counter) 60.5% → 44.2%
3+-band samples (alternate 62.3% → 46.0%), one-band plurality, no demanding
stretch over 12 u open (entry + designated runouts exempt); lane-lazy
variant dies at the first weave doors; double-spike + slalom + road-narrow
surgery + ~70 funnel teeth (both reference lines verified); density floor
held (skill jumps, lane edges, passive gap, supports, travel, reversals,
platform riding — all green on both routes).

Rhythm VFX: deterministic `rhythmPulse` (8th/beat/downbeat/drop envelopes
from sim time + section-entry impacts — no audio analysis, pause/replay
safe) composed into the existing timeline/punch/VFX/beam hooks (zero new
draws/materials; biome response via section accents); new warm-red
`impact` punch family on Chomper-lunge edges. Bounded + photosensitivity
bound (smooth decays, in-contract clamps, `?fx=off` escape hatch).

Proof: `npm run verify` green (49 files / 613 tests); both routes finish
0 deaths + replay VERIFIED; `scripts/browser-qa-m9.mjs` 14/14 green (gate,
unlock, transport lifecycle, pause/restart/death/mute, pulse oscillation,
staged captures, `?music=off`, flat 40/8/64 resources, zero errors) with
`qa/screenshots/m9-*` evidence. Spec:
`specs/milestones/M9_GRAVITY_LESSONS_RHYTHM_POLISH.md`. Automation cannot
decide sync feel, flash power, musical flow, precision, difficulty-vs-fun,
readability, or one-piece feel — do NOT mark PASS until the human plays it
with sound on. Next: human music-rhythm gameplay gate, then real-GPU perf.
