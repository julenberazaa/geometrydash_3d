# M1 — Foundation Cube

## STATUS

**PASS** (2026-09-03). Recovery closeout: previous-agent work forensically
preserved (`geometrydash_3d_recovery_20260903_1137/` sibling snapshot),
audited claim-by-claim, one failing cadence test root-caused and fixed via an
engine correction (not tolerance loosening), hygiene defects removed,
permanent harness established, `npm run verify` green, browser QA green,
milestone commit on `main`.

## OBJECTIVE

Prove the deterministic Cube foundation: fixed-step simulation, auto-forward
precision controller (lanes/jump/repeat/fast-fall/air-correction), baseline
swept collision + death/reset, presentational camera/HUD/debug, data-driven
level — with executable invariants and a repeatable QA gate, before any M2+
mechanics.

## IN SCOPE

Project bootstrap (TS/Vite/Three); 120 Hz fixed-step loop (clamp, catch-up
cap, spiral guard, render interpolation); auto-forward Cube; continuous lanes;
jump; hold-to-repeat; fast-fall; airborne lane correction; explicit AABB
collision (solid/hazard/killFront) + death/reset; third-person camera;
data-driven controller Test Level 01; minimal HUD; F1/F2/F3 debug; unit +
integration tests; headless browser QA; original baseline neon visuals.

## OUT OF SCOPE

Ship mode; ceiling/wall gravity gameplay; gravity portals; orbs; pads; speed
portals; moving hazards; final VFX; music/BPM; public editor; backend;
persistence; additional levels.

## BEHAVIORAL REQUIREMENTS (all verified)

- Auto-forward at base speed along +Z with zero input.
- Fixed-impulse jump (13.2 u/s vs 42 u/s² gravity); apex ≈ 2.07 u, airtime
  ≈ 0.63 s, distance ≈ 8.8 u; holding re-jumps after every valid landing, no
  mid-air extras; single press = exactly one jump.
- Fast-fall shortens airtime (> 0.05 s); grounded fast-fall is a no-op.
- Lane changes continuous (no snapping), settle < 0.4 s with < 0.05 overshoot,
  work while airborne; rapid reversal settles without oscillation.
- Player stands stably on runway (no sink/jitter); landing never penetrates.
- Frontal wall contact kills; hazards kill on overlap; void fall kills;
  death holds ~0.45 s then auto-respawns, attempts increment; `R` restarts now.
- Progress % derives from real forward distance; finish gate completes level.
- Camera track-centered with ≤ 0.55 u lateral bias, look-ahead, no roll.
- Zero console/page errors during full gameplay exercise.

## ARCHITECTURE REQUIREMENTS (all verified)

Simulation imports no Three.js/DOM; `GameSimulation` holds no level
coordinates; collider independent of visual rotation; lane position continuous
with intent as index; fixed-step only; render rate provably irrelevant to sim
trajectory (integer cadence tests); camera not parented, bias bounded; levels
declarative; input preserves held/pressed/released; gameplay frame exposes
forward/gravity/normal/lane axes as explicit data; swept (non-endpoint)
collision; no physics engine/ECS/React; no PNG runtime assets.

## TEST REQUIREMENTS

`npm run verify` (typecheck + lint + 41 tests + build) green, no skipped or
weakened assertions. Coverage: fixed timestep, cadence invariance, jump
determinism, repeat-jump, fast-fall, continuous lanes, settling, air lanes,
solid collision, anti-tunneling (incl. 4× speed), grounding, data-driven
loading, death/reset. Cadence history: a seconds-based assertion once failed
by 1 ulp due to cap==need step-dropping + FP representation; fixed by
catch-up headroom (cap 8) and integer step-count assertions — documented in
`tests/fixedStep.test.ts`.

## BROWSER QA REQUIREMENTS

`scripts/browser-qa.mjs` against local dev server: 19/19 checks (boot,
auto-forward rate, settle, lane right/center, rapid reversal, jump apex,
landing, hold-repeat oscillation, airborne lane change, F1/F2 overlay,
void death, auto-respawn, R restart, resize, zero console/page errors) with
PNG + JSON provenance sidecars.

## VISUAL BASELINE

Dark modular track, violet neon edges, cyan procedural cube, orange spike
hazards, fog + starfield + pillar dressing, finish gate. `qa/screenshots/`
(local, git-ignored, regenerable).

## DEFINITION OF DONE (all met)

All behavioral + architecture + test + browser-QA requirements above, plus:
`AGENTS.md`, `GAME_DESIGN.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `README.md`
exist and match reality; `npm run verify` passes; milestone commit on `main`.

## KNOWN PROVISIONAL DECISIONS (human gate required)

- Edge-per-lane input (no hold-to-slide) — feel-untested.
- Landing visual rotation snaps to rest.
- killFront side/frontal edge semantics may need M2 polish.
- Controller mechanically validated; fun NOT human-approved.

## EVIDENCE

- `npm run verify` output (see milestone commit message / session record).
- `qa/screenshots/recovery-*.png` + `.json` sidecars (this session).
- Historical `qa/screenshots/01..04-*` from the previous session (preserved in
  recovery snapshot).
