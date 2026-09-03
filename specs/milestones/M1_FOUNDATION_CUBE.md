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

Dark modular track, violet neon edges (M1.1: top perimeter strips + vertical
corner trims on solids ≥ 0.8 tall), cyan procedural cube, orange spike
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

## M1.1 POLISH PASS (2026-09-03) — STATUS: PASS

Human playtest of the M1 build: "broadly good", two concrete fixes.
Scope was strictly limited to the feedback — no M2 mechanics, no retuning.

1. **Left/right reversal (root cause: view/model orientation mismatch).**
   Input map, controller edge logic, kinematics, and camera were each
   correct in isolation; the lane-index ordering (+X = increasing index)
   rendered mirrored under the +Z chase camera (screen-right = −X),
   confirmed by lookAt math and by M1 screenshots (x = −2.6 rendered right
   of center). Fix: index now increases toward screen-right —
   `laneCenters` [+2.6, 0, −2.6], Floor `laneAxis` −X (explicit, documented
   against the cross-product trap), asymmetric level geometry mirrored so
   existing left/right level comments are true. Controller code untouched;
   new unit test pins Right→−X-velocity / Left→+X-velocity.
2. **Vertical neon edges.** Extended the existing shared edge-strip system:
   4 unlit corner trims per solid ≥ 0.8 tall (thin, shared geometry +
   material, stopped below the top strips to avoid z-fighting); markers and
   hazards untouched. ~+40 cheap boxes; readability verified in browser QA.

Validation: 43/43 tests, `npm run verify` green, browser QA 19/19 green,
zero console errors; `qa/screenshots/m11-*` proof set.

## M1.2 FOLLOW-UP (2026-09-03) — STATUS: PASS

Human playtest follow-up: controls accepted; verticals still missing where
expected (gap/hole faces read as plain dark holes); side fall-off requested.

1. **Exposed-face readability (root cause: embedded trims are invisible).**
   The M1.1 corner posts sat 0.015 *inside* the opaque solid faces, so the
   human correctly saw no vertical lines. Reworked as face applique sharing
   the existing edge system: outboard corner posts, front-face bottom strips
   (landing faces at gaps read as framed portals), center seams on faces
   >= 6 wide; staggered 5 mm plane separations, no coplanar z-fighting.
   Markers and spike hazards untouched.
2. **Lateral fall-off (support-based, no fake walls).** Lane intent
   unclamped; `laneCenterForIndex` extrapolates virtual lanes linearly from
   the outer pair. Footprint probing already governed grounding, so no
   collision/sim changes were needed: outer tap teeters (COM over support),
   further taps exit -> airborne -> gravity -> death-plane reset; side
   contact with real geometry blocks without killing. No level changes
   needed (runway edges are open void). Controller code otherwise untouched.

Validation: 33/33 tests (4 new lateral fall-off tests; reversal test
rewritten deterministically after unclamping changed multi-tap dynamics),
`npm run verify` green, browser QA 19/19 green, zero console errors;
`qa/screenshots/m12-*` proof set.

## EVIDENCE

- `npm run verify` output (see milestone commit message / session record).
- `qa/screenshots/recovery-*.png` + `.json` sidecars (this session).
- Historical `qa/screenshots/01..04-*` from the previous session (preserved in
  recovery snapshot).
