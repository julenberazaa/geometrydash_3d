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
NOT human-approved for fun — mechanics validated only.

## M1.1 — Input/visual polish: PASS (2026-09-03)

Human playtest feedback on the M1 build: broadly good; two fixes requested.
(1) Left/right reversal fixed at the root: lane index now increases toward
screen-right (`laneCenters` [+2.6, 0, −2.6], Floor `laneAxis` −X, asymmetric
level geometry mirrored) — `ArrowRight` = visually right, controller code
untouched. (2) Vertical neon corner trims added to solids ≥ 0.8 tall via the
existing shared edge system (markers/hazards untouched). 43/43 tests,
`npm run verify` green, browser QA 19/19 green with zero console errors.
Feel still NOT human-approved beyond the original feedback — M2 entry gate
(the human feel test) remains open.

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

## M2 — Collision/death/restart polish + human controller tuning (NEXT)

Entry: human playtest of M1 approves (or retunes) Cube feel. Polish death
feedback/restart snap, killFront side semantics, early hazard readability.
No new mechanics.

## M3 — Gravity architecture productionization

Floor ↔ Ceiling first (real gravity-vector change, fixed world/camera per
`GAME_DESIGN.md` §6). Lateral wall gravity only when robust.

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
