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
