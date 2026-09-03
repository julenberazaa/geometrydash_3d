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

## M4 — Interactive mechanics

Pads, orbs, speed portals, moving hazards. Only on top of a validated Cube.

## M5 — Replay + deterministic verification + second level

Input-timeline replay proving determinism; second level as data-only proof
that the engine is level-agnostic.

## M6 — Visual production system

Themes, neon materials, trails, particles, controlled bloom, triggers,
performance pass (incl. hot-loop allocation review per `ARCHITECTURE.md` §11).

## M7 — 45–60 s Cube vertical slice

One memorable, completable, fun level on the production stack.

## Ship mode — ONLY after the Cube vertical slice and control validation

Enclosed tunnels, multi-surface hazards, speed feel. Never before Cube is fun.
