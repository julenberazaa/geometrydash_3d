# M3.1 — Ceiling Camera, Readability, and Contact Polish

## STATUS

**PASS (mechanically/browser/visually validated)** (2026-09-03). Focused
corrective follow-up to M3 from the first human ceiling playtest. Root cause
proven, fixed at the camera/framing level, regression-pinned, all validation
green. No gameplay, control, collider, or Floor changes. **HUMAN CEILING FEEL
= STILL OPEN** (re-playtest requested on the M3.1 build).

## OBJECTIVE

The human playtest reported two ceiling-section defects: (1) the camera/frame
looked like it was colliding with or fighting the upper geometry — the scene
was not comprehensible in motion; (2) the cube appeared to "float" — the
upside-down attachment did not read. Diagnose the actual root cause (penetration
vs framing vs readability), fix it at the root, preserve the approved core
gameplay, leave the project clean and validated.

## ROOT-CAUSE AUDIT (evidence, not inference)

- **FACT — the camera eye literally traveled INSIDE the ceiling slabs.**
  Pre-M3.1 the vertical framing was gravity-blind:
  `desiredY = playerY * 0.35 + 4.2`. A ceiling-grounded cube rests at
  y = 5.45 (slab underside 6 − collider half 0.55), putting the eye at
  y ≈ 6.11 — above the underside, i.e. inside slab A/B (y 6..8) whenever the
  eye's Z was under a slab. Proven by a pre-fix probe run
  (`tests/cameraFraming.test.ts` driven against the old math): **343
  penetrating simulation steps across the real Test-Level playthrough, worst
  depth 0.157 u** (eye y 6.10–6.11 inside solid-14/solid-15).
- **FACT — this explains BOTH reported symptoms.** From inside a box, all of
  its outward-facing faces are backface-culled by three.js: the ceiling slab
  rendered as INVISIBLE, leaving only stray neon edge appliqués crossing the
  frame (the "camera fighting geometry" look) and a black void where the
  surface should be — so the attached cube read as "floating".
- **FACT — the underside was nearly unrenderable even from outside.** A
  down-facing Lambert face receives only the hemisphere light's near-black
  ground color (0x140a24), so the ceiling run surface had no readable tone of
  its own (a secondary readability defect independent of the camera).
- **INFERENCE (validated by fix + QA) — no gameplay/support mismatch existed.**
  The collider/support/portal mechanics were correct all along (M3 suite +
  browser QA never failed); the defect was purely presentation.
- **DECISION — fix framing + surface readability, not gameplay.** No camera
  collision system (the corrected framing never penetrates; complexity
  unjustified), no collider/controller/tuning changes, no world rotation, no
  camera roll.

## IN SCOPE (shipped)

- `ChaseCamera`: explicit `CameraFocusSide` framing parameter
  (`'aboveFocus' | 'belowFocus'`). Ceiling framing hangs the eye BELOW the
  focus in the open corridor: `desiredY = playerY * 0.15 + 3.4`
  (`belowFocusHeight`/`belowFocusParallax` tuning) → eye settles at y ≈ 4.22
  vs cube 5.45 — ≈ 1.8 u clear under the slab, looking up at the contact
  (look bias +0.6 kept, so the look target reads the contact line). Floor
  math is byte-identical on the `'aboveFocus'` branch. The gravity flip only
  shifts the desired height by ~1 u at the crossing instant; the existing
  damped smoothing turns it into a short glide (no cut, no roll).
- `RendererHost` maps the simulation's authoritative `gravityMode` to the
  focus side (presentation-only read; respawn `snapTo` included).
- `LevelView`: underside inset panel for solids ≥ 0.8 tall — same visual
  language as the existing top inset (runs 0.011 proud below the bottom face,
  shared geometry, new shared unlit material `PALETTE.platformUnder`
  0x322858). Down-facing Lambert can never read (near-black ground light), so
  the run surface is unlit by design. Invisible on floor content (bottom
  faces buried or void-facing).
- `__gd3d` probes: `cameraEye()` / `cameraLook()` (QA observability only).
- `tests/cameraFraming.test.ts` (2 tests): (a) ceiling rest frames from below
  the focus; (b) the camera eye — advanced per step with the REAL playthrough
  script and framed exactly like `RendererHost` frames it — never enters any
  blocking collider (0.05 skin) across the full Floor → Ceiling → Floor run.
  Proven FAILING pre-fix (343 samples, worst 0.157 u), PASSING post-fix (0).
- Browser QA M3.1 section (5 checks): floor framing unchanged (eye ≈ 4.5);
  live eye sampled through rise + under-slab transit stays in the corridor
  (observed 3.70..4.22, slab band starts at 6); ceiling eye settles below the
  cube with clearance; look target reads the contact surface; gap-approach
  framing reached. Fresh `m31-01..04` screenshots.
- Docs updates (this spec, `GAME_DESIGN` §4, `ARCHITECTURE`, `ROADMAP`,
  `README`).

## OUT OF SCOPE / UNCHANGED

No camera collision/obstruction system (unneeded once framing is correct —
proven by the regression test), no FOV/look-ahead/damping changes, no
controller or collider changes, no portal-visual redesign (re-evaluated in the
new framing: readable), no Floor behavior changes (golden gate untouched),
no M4 content.

## VALIDATION EVIDENCE

- `npm run verify` green; **90/90** unique automated tests (2 new).
- Browser QA **72/72** green (40 M2 + 27 M3 + 5 M3.1), zero console/page
  errors.
- Visual gate (judge on `qa/screenshots/m31-01..04`): 4/4 pass — ceiling
  reads as an attached surface with depth ("reads attached, not floating"),
  no crossing-line chaos, portals readable.
- Floor compatibility: `tests/floorCompat.test.ts` exact-float golden gate
  green; floor camera branch unchanged.

## KNOWN LIMITATIONS

- Ceiling framing constants (`belowFocusHeight` 3.4, parallax 0.15) are tuned
  for corridor-style levels (underside ~6 u over the floor); a future level
  with a very different ceiling band may need a level-declared framing hint.
- The camera still has no general obstruction system; the regression test
  pins non-penetration for THIS level's geometry. New content should re-run
  it (it drives the real level, so new geometry is covered automatically).
- Frozen QA captures show the "PAUSED" overlay (existing M2/M3 QA pattern).

## HUMAN GATE

Human ceiling-feel re-playtest still OPEN (camera/framing approved only by
automated + visual-gate evidence, never a substitute for the human gate).
