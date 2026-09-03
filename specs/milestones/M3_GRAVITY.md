# M3 — Gravity Architecture + Floor ↔ Ceiling Gameplay

## STATUS

**PASS (mechanically/browser validated)** (2026-09-03). All behavioral,
contract, test, browser-QA, performance and documentation requirements met:
88/88 unique automated tests (26 new: `tests/gravity.test.ts` + the
`tests/floorCompat.test.ts` golden gate), `npm run verify` green, browser QA
**67/67** green (40 M2 checks unchanged + 27 M3 checks) with zero console/page
errors, validated milestone commit on `main`. Floor compatibility proven
bit-identical (exact-float golden trajectories captured from the pre-refactor
build at `4847e1d`). **HUMAN CEILING FEEL = OPEN** — playtest requested
(see §HUMAN PLAYTEST GATE in the milestone prompt / final report).
The human playtest found ceiling camera/readability defects; they were
root-caused and fixed in the M3.1 follow-up
(`M3_1_CEILING_CAMERA_READABILITY.md`, PASS) — ceiling feel gate remains
OPEN there.

## OBJECTIVE

Productionize the gameplay-frame architecture so the existing human-approved
Floor Cube remains behaviorally IDENTICAL while true Ceiling gameplay becomes
possible: actual gravity reversal, the Cube physically running on the ceiling,
world and camera stationary (no roll, no rotation), gravity-relative controls,
and deterministic support/death/restart under both gravity signs.

Not "flip a gravity sign" — make gravity a first-class, authoritative, data-
driven gameplay state with a minimal, clean Floor→Ceiling→Floor content path.

## ENTRY CONDITIONS

- M1/M1.1/M1.2/M2/M2.1 PASS; human Cube-movement feel APPROVED; human
  death/restart feel APPROVED. Tuning frozen.
- Baseline at M3 start: commit `4847e1d`, clean tree, `npm run verify` green,
  **62/62 unique automated tests**, browser QA 40/40 green, zero console/page
  errors (verified at session start).
- Floor compatibility evidence pinned BEFORE the refactor:
  `tests/floorCompat.test.ts` (golden trajectories captured from the
  pre-refactor build at `4847e1d`; exact-float assertions; see §FLOOR COMPAT).

## IN SCOPE

- GameplayFrame extension: `floor()` + `ceiling()` factories; frame passed
  through the controller context from the simulation's authoritative state.
- Authoritative `gravityMode` (`'floor' | 'ceiling'`) on `GameSimulation`
  (single owner), mirrored read-only onto `PlayerState`.
- Input split: physical key actions (`space`, `up`, `down`, `laneLeft`,
  `laneRight`) sampled by `InputSystem`; gravity-relative interpretation into
  logical actions (`jump`, `fastFall`) inside the simulation per step.
- Gravity transition content primitive: data-driven `GravityPortal`
  (id + crossing Z plane + target mode) with deterministic forward-crossing
  semantics, one-shot per attempt, reset on respawn/restart.
- Gravity-flip physics: preserve world position/forward/lateral/vertical
  velocity; clear grounded + supportColliderId; no impulse, no snap.
- Support/grounding generalization: probe along the gravity direction
  (below on Floor, above on Ceiling); head-bump cancellation generalized.
- Frontal-kill rule expressed via `forwardAxis` dot products (mechanical
  generalization; Floor behavior identical).
- Void bounds: lower `deathY` (unchanged) + optional upper `deathYMax` for
  ceiling void death.
- LevelDefinition: optional `startGravityMode` (default floor), optional
  `deathYMax`, optional `gravityPortals`. Existing levels remain valid.
- Test-level gravity section: Floor → portal → rise → Ceiling run → ceiling
  gap jump → portal → fall → Floor → finish (append-only; existing content
  untouched; finishZ extended).
- Portal visual: lightweight procedural neon gateway (renderer-only).
- Player visual rest orientation aligned to surface normal (render-only).
- Camera: unchanged math (vertical parallax already present); verify no roll
  and readable framing on the ceiling in browser QA.
- Debug/QA surface: gravity mode + frame vectors + support + last portal id +
  portal transition count in F1/`__gd3d`.
- Automated tests (see §AUTOMATED TEST REQUIREMENTS), browser QA M3 section,
  docs updates, milestone commit.

## OUT OF SCOPE

Left/right wall gravity, 4-direction gravity, ship, gravity orbs, jump pads,
jump orbs, speed/teleport/size portals, moving platforms/hazards, generic
trigger/scripting framework, music/BPM, final level, vertical slice, editor,
backend, mobile/gamepad, visual overhaul. No new physics engine, no ECS.
Generalized collision axis ordering (wall gravity) is explicitly deferred.

## GAMEPLAY FRAME CONTRACT

- `GameplayFrame` remains explicit data: `forwardAxis`, `gravityVector`,
  `surfaceNormal`, `laneAxis`. NEVER cross-product-derived (lane mirroring
  guard, M1.1).
- Floor: forward +Z, gravity −Y, surfaceNormal +Y, laneAxis −X
  (lane index increases toward screen-right).
- Ceiling: forward +Z, gravity +Y, surfaceNormal −Y, laneAxis −X
  (same screen-left/right convention — gravity flip must NOT mirror lanes).
- `GameSimulation` owns the authoritative mode and passes the frame into
  `CubeController.step` via the step context each step (controller keeps its
  own frame only as a default for direct construction/tests).

## INPUT CONTRACT

- `InputSystem` samples PHYSICAL actions only: `space`, `up`, `down`,
  `laneLeft`, `laneRight` — identical held/pressedThisStep/releasedThisStep
  edge semantics as before, OS auto-repeat ignored, deterministic. The DOM
  layer never knows gravity.
- Interpretation (pure function, simulation-side, per step, using the
  authoritative mode BEFORE this step's portal processing):
  - Floor: `jump = space ∪ up`; `fastFall = down`.
  - Ceiling: `jump = space ∪ down`; `fastFall = up`.
  - Merge semantics identical to the old ArrowUp+Space merge (held = either,
    pressed = either, released = either).
- SPACE is always the universal jump key. Directional jump/fast-fall arrows
  flip with gravity. Lane keys never change meaning.
- Contradictory input (e.g. Up+Down held simultaneously): simplest stable rule
  — both logical actions simply reflect their physical keys (jump and
  fast-fall can both be true; controller order resolves deterministically as
  it always has). No new nondeterminism introduced; no special-casing.

## GRAVITY TRANSITION CONTRACT

- Level data: `gravityPortals: { id, z, target: 'floor' | 'ceiling' }[]`.
  A portal is a forward-crossing plane at world Z spanning the full route.
- Trigger: deterministic swept crossing — `prevZ < portal.z ≤ currentZ` after
  movement in the same step (works at any per-step displacement; not
  frame-rate- or visual-dependent). Multiple crossings in one step resolve in
  ascending Z order (the furthest crossed portal wins).
- One-shot semantics emerge from crossing-edge detection: no re-trigger while
  the plane is behind the player (forward motion is constant); crossing again
  in a later attempt (after respawn) is correct and required.
- Transition effects (same step, after grounding resolution):
  - `gravityMode` → target; controller frame follows;
  - world position NOT teleported; forward/lateral/vertical velocity preserved
    (no impulse, no snap);
  - `grounded = false`; `supportColliderId = null`;
  - subsequent steps accelerate toward the new gravity direction.
- Processing order per step (documented authority; revised by the M3.3
  closeout — lethal checks precede portal processing so a lethal step can
  never mutate gravity/portal state):
  1. controller (input interpreted with the pre-portal mode) → velocities
  2. integrate + collide (Y → Z → X swept; unchanged axis order)
  3. frontal-kill check (death returns immediately)
  4. grounding (support probe along gravity, head-bump cancel)
  5. void death checks (lower + upper)
  6. hazard swept-path CCD check
  7. gravity portal crossing → transition
  8. finish check
  Death at any earlier point wins: **a lethal step never applies a gravity
  transition** (death returns before portal processing; pinned by tests,
  incl. same-step hazard+portal and void+portal cases added in M3.3).
- Respawn/restart (`R`) resets gravity mode to the level's start mode.

## SUPPORT / GROUNDING CONTRACT

- Support = blocking surface opposing gravity (below on Floor, above on
  Ceiling). `probeGroundSupport` probes along the gravity direction with the
  same contact skin (0.02), footprint semantics (partial overlap grounds —
  edge teeter), and rest-speed epsilon as the approved Floor build.
- Landing (moving along gravity into support) cancels the along-gravity
  velocity component; head-bump (moving anti-gravity into a blocking surface)
  cancels it too. On Floor this is bit-identical to the M2 build (pinned).
- Ceiling support: upward motion clips at the slab underside, velocity into
  the support is cancelled, cube grounds with `supportColliderId` set, and
  remains stably grounded (no grounded/airborne vibration — gravity is
  re-absorbed every step exactly as on Floor).
- No sticky/invisible support: lateral support loss behaves physically on both
  surfaces (fall away from the surface under gravity; death via the void
  bounds).

## COLLISION CONTRACT

- Axis order Y → Z → X unchanged; M2.1 exact swept-path hazard CCD unchanged
  (upward motion is swept identically — direction-agnostic).
- Frontal kill: `dot(contactNormal, forwardAxis) < -0.5` AND
  `dot(preImpactVelocity, forwardAxis) > 0`. With forward +Z this reduces to
  the exact M2 comparisons (`normal.z < -0.5 && preVel.z > 0`) — bit-identical
  on Floor (pinned by golden tests); identical semantics on Ceiling.
- Side scrapes block without killing; top/underside landings safe — on both
  surfaces, both blocking kinds.

## VOID CONTRACT

- Lower bound: `deathY` (unchanged semantics, cause `void`).
- Upper bound: optional `deathYMax`; when defined, `position.y > deathYMax`
  kills with cause `void`. Levels without it behave exactly as before.
- Ceiling lateral fall-off: support lost → accelerates upward (+Y) → dies at
  the upper bound. No instant fake side kill. Floor fall-off path unchanged.

## CAMERA CONTRACT

- Camera math untouched: track-centered + damped bias, `desiredY` vertical
  parallax already follows the player; `camera.up` remains world +Y; no roll,
  no world rotation, no mirrored controls, no cinematic transition. Ceiling
  framing readability is verified (not tuned) in browser QA; any adjustment
  would be a separate human-gated change.

## VISUAL CONTRACT

- Gameplay collider stays an unrotated AABB; tumble/rest orientation is
  render-only. Rest orientation aligns to the surface normal (upside-down on
  the ceiling); landing settles cleanly.
- Portal visual: shared geometry/material neon gateway (cyan = gravity flip
  upward, warm = gravity flip downward), renderer-only, cheap (no shaders);
  triggering never depends on renderer/camera/mesh.
- Renderer observes gravity mode; it never owns or writes it.

## AUTOMATED TEST REQUIREMENTS

New suites (`tests/gravity.test.ts`, golden gate `tests/floorCompat.test.ts`,
focused additions elsewhere where natural). Cover at minimum:

1. Floor golden compatibility (exact-float trajectories, 3 scripts).
2. Floor frame data (gravity −Y, normal +Y, laneAxis −X, forward +Z).
3. Ceiling frame data (gravity +Y, normal −Y, laneAxis −X, forward +Z).
4. Portal crossing Floor→Ceiling triggers exactly once; Ceiling→Floor likewise.
5. Transition preserves position/forward/lateral velocity; clears
   grounded/support.
6. Respawn restores start gravity; R restores start gravity (from ceiling).
7. Ceiling gravity accelerates the cube upward (−velocity along new g).
8. Ceiling support: reaches underside, clips, grounds, stays stable.
9. Ceiling jump via ArrowDown and via Space; ArrowUp grounded on ceiling does
   NOT jump.
10. Ceiling fast-fall (ArrowUp airborne) accelerates toward +Y.
11. Floor input semantics unchanged (golden gate + existing suites).
12. Ceiling hold-to-repeat works.
13. Lane left/right screen convention unchanged on ceiling; airborne lane
    correction unchanged.
14. Ceiling lateral fall-off loses support physically (no instant kill).
15. Upper void death; lower void death unchanged.
16. Frontal kill forward-axis semantics identical on Floor; kills on Ceiling;
    lateral scrape survives on Ceiling; support-side contact does not kill.
17. Hazard CCD upward sweep; M2.1 false-positive near-miss stays safe.
18. Portal + lethal contact same-step precedence (death wins, pinned).
19. Finish-after-death still impossible.
20. Determinism: identical input/portal sequence → identical trajectory;
    clean reset across repeated deaths/restarts.

Existing 62 tests must stay green and unweakened. Final unique count reported
honestly.

## BROWSER QA REQUIREMENTS

Extend `scripts/browser-qa.mjs` (M2 checks stay green) with a closed-loop M3
section: floor baseline, portal crossing (mode changes exactly once), physical
upward travel, ceiling grounding, world unrotated / camera unrolled, lane keys
visually correct on ceiling, ceiling jump (Down/Space), ceiling fast-fall (Up),
ceiling side fall → upper void, Ceiling→Floor portal, R from ceiling resets to
floor start, death from ceiling respawns in start mode, no repeated portal
toggles, no stuck support, M2 death burst still works, resize, zero
console/page errors. Screenshots `qa/screenshots/m3-*.png` (+ JSON sidecars).

## PERFORMANCE REQUIREMENTS

- No new per-step allocations in the sim hot loop (portal checks are scalar
  comparisons; frame objects are prebuilt constants).
- Portal visuals: shared geometry/material, no per-frame allocation.
- Repeated Floor↔Ceiling transitions: scene children / draw calls / listeners
  flat (leak guard in browser QA).

## DEFINITION OF DONE

All contract sections above validated: `npm run verify` green; all unique
tests counted honestly; browser QA fully green with zero console/page errors;
Floor golden gate bit-identical; docs match reality (`GAME_DESIGN`,
`ARCHITECTURE`, `ROADMAP`, README, this spec); test-level gravity section
playable end-to-end; no resource growth across repeated transitions;
milestone commit pushed. Human Ceiling-feel gate remains OPEN until a human
playtests.

## KNOWN LIMITATIONS

- Wall gravity NOT implemented (explicitly deferred; axis ordering kept
  Y→Z→X for Floor/Ceiling).
- Lane kinematics remain world-X for Floor/Ceiling (laneAxis ±X); a wall
  mode will need lane-axis generalization.
- Portal is a full-route Z plane (not a lateral/vertical sub-volume).
- Ceiling content is a minimal playable section, not a showcase.
- Camera ceiling framing verified only in automated QA until the human gate.

## EVIDENCE

- `npm run verify` output (typecheck + lint + tests + build) — see milestone
  commit. Unique test count from `npx vitest run`: **88** (7 files).
- Floor compatibility: `tests/floorCompat.test.ts` — 3 golden trajectories
  (hold-jump, jump+fast-fall, lane taps; state sampled at fixed ticks) recorded
  from the human-approved build at `4847e1d` BEFORE the refactor, asserted with
  exact float equality (`toBe`) after the refactor — zero numerical drift.
- Browser QA log: 67/67 checks (40 M2 + 27 M3), zero console/page errors;
  repeated-transitions leak guard: draw calls 239→239, tris 2818→2818, scene
  children flat across the M2 10× death loop; portal transition count stable
  during on-ceiling dwell (no toggles).
- `qa/screenshots/m3-*.png` + `.json` sidecars (git-ignored, regenerable):
  m3-01 floor before portal (cyan gateway readable), m3-02 mid-rise inside the
  portal frame (captured frozen via the pause key), m3-03 grounded on the
  ceiling underside (world unrotated, camera level), m3-04 ceiling jump dip,
  m3-05 return to floor through the warm portal, m3-06 F1 debug overlay
  showing `gravity: ceiling | g: (0,1,0) | N: (0,-1,0) | laneAxis: (-1,0,0)`.
- Full gravity-section playability: deterministic per-step playthrough test
  (tests/gravity.test.ts) drives the REAL Test Level from spawn through both
  portals and the ceiling gap to the finish gate.
