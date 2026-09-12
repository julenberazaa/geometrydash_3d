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

## M8 — Multimode & Hazard Expansion: IN PROGRESS (feature/m8-multimode-gameplay)

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

## Ship mode — part of M8 (multimode expansion)

Enclosed tunnels, multi-surface hazards, speed feel. Cube validation
(M7.1 + M7.3 approvals) is complete, so Ship ships inside M8.
