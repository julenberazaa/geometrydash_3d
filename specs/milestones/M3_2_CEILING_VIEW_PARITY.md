# M3.2 — Ceiling View Parity & Readability Polish

## STATUS

**PASS (mechanically/browser/visually validated)** (2026-09-03). Focused
presentation-only follow-up to M3.1 from the second human ceiling playtest
("it now looks better", but the ceiling view may still be harder to read than
the floor view). Audited with measurements before touching anything; the fix
is renderer-side only. No camera, gameplay, controller, collider, tuning, or
level-content changes. **HUMAN CEILING FEEL = STILL OPEN** (re-playtest
requested on the M3.2 build).

## OBJECTIVE

Ceiling gravity must not be harder merely because the VIEW is worse. Audit
what actually causes the remaining floor-vs-ceiling readability gap — with
evidence, not guesses — then apply the minimal correct fix. Explicitly NOT
M4: no pads, orbs, speed portals, moving hazards, or any new mechanics.

## ROOT-CAUSE AUDIT (measured, not inferred)

A headless measurement pass (`scripts/m32-audit.mjs`, pre-fix run) froze
deterministic floor and ceiling framings and compared geometry (live-camera
projections) and pixels (decoded screenshots):

- **FACT — camera framing is already at parity (hypothesis rejected).**
  Eye-to-player distance 10.55 (floor) vs 10.30 (ceiling); apparent cube
  width 92 vs 97 px; player screen placement 72% vs 46% of frame height
  (both near center); forward run surface projects in-frame to +26 u on BOTH
  surfaces. The M3.1 framing is not the remaining offender.
- **FACT — cube-body luminance parity also holds (hypothesis rejected).**
  Cube-region mean luminance 9.9 (floor) vs 10.7 (ceiling): the Cube reads
  dark on BOTH surfaces; a player-material change was considered and
  rejected as unnecessary.
- **FACT — RC1: the ceiling run surface had ZERO neon edge structure.** All
  rail trims in `LevelView` sit on the TOP faces of solids; on ceiling slabs
  they are on the invisible upper side. The floor track glows with
  continuous longitudinal rails; the ceiling run surface was a featureless
  dim plane, and the lethal gap edges were unmarked where the player can
  actually see them.
- **FACT — RC2: the Cube's own silhouette occludes the ceiling run surface
  ~4..16 u ahead.** Surface points +4..+16 units ahead project INSIDE the
  Cube's screen bbox (the cube is closer to the below-focus eye, so it
  occludes them). Geometrically unavoidable while the eye is below the
  surface plane (it is, by design, under the slab): a grazing ray under the
  cube bottom still meets the plane ~19 u out. On the floor the camera looks
  DOWN over the cube and the surface is visible from ~1 u ahead.
  **CONSEQUENCE:** the only forward cues that can work on the ceiling are
  the LATERAL surface edges beside the silhouette — measured to project well
  outside the cube bbox (e.g. gap edges at px 471/809 vs cube 600..680) —
  which made RC1 critical rather than cosmetic.
- **INFERENCE (validated by fix + QA):** the perception gap is the missing
  surface cue structure, not the camera, not the cube material, not the
  section layout.
- **DECISION — presentation-only fix in `LevelView`; camera untouched.**
  Fixing RC2 via camera would require the eye above the surface plane —
  impossible under a slab — so the correct fix is to give the visible
  lateral edges the same cue language the floor already has.

## IN SCOPE (shipped)

- `LevelView`: underside edge rails — exposed undersides (bottom face ≥
  world y 2; a documented world-space heuristic that selects ceiling run
  surfaces and skips ground-resting/buried bottoms, whose rails would poke
  through host solids) mirror the existing top-edge neon treatment below
  the bottom face: 2 longitudinal rails at the lateral edges + 2 across
  rails, shared unit-box geometry and shared edge material. Zero per-frame
  work; no new systems; hazards/markers untouched.
- `RendererHost.projectToScreen` + `__gd3d.screenPoint` probe (QA
  observability, same category as `cameraEye`/`cameraLook`; cold path).
- `scripts/m32-audit.mjs` measurement tool (dev tool; not part of the
  verify gate).
- `tests/undersideRails.test.ts` (3 tests) + framing-parity bounds in
  `tests/cameraFraming.test.ts` (1 test).
- Browser QA M3.2 section (3 checks + `m32-*` screenshots).
- Docs updates (this spec, `GAME_DESIGN` §4, `ARCHITECTURE`, `ROADMAP`,
  `README`).

## OUT OF SCOPE / UNCHANGED

No camera changes of any kind (M3.1 framing constants byte-identical; Floor
branch untouched); no player-material/emissive change (measured unnecessary);
no controller/collider/tuning changes; no level-content changes; no portal
visual redesign; no M4 content.

## ACCEPTANCE CRITERIA (all met)

1. `npm run verify` green (typecheck + lint + tests + build).
2. M3.1 guarantees intact: camera-eye non-penetration playthrough test,
   floor-compat golden gate, floor framing browser checks — all green.
3. Floor presentation unchanged (audit screenshots pixel-comparable; rails
   apply only to exposed undersides — no floor solid qualifies).
4. Ceiling run surface carries longitudinal neon rails visible beside the
   Cube silhouette (unit-pinned geometry; browser-verified in screen space).
5. At ceiling gap approach, the lethal gap's lateral edges project inside
   the viewport and beside (not behind) the Cube silhouette.
6. Framing parity pinned by test: eye-to-player distance ratio within 15%
   across surfaces; player NDC within ±0.6 on both.
7. Browser QA fully green, zero console/page errors.

## VALIDATION EVIDENCE

- `npm run verify` green; **94/94** unique automated tests (4 new).
- Browser QA **76/76** green (40 M2 + 27 M3 + 5 M3.1 + 4 M3.2), zero
  console/page errors.
- Post-fix audit: rails visible ahead during ceiling run (projected px
  525..755, py 380..389); gap edges px 471/809 vs cube bbox 600..680.
- Evidence set: `qa/screenshots/m32-01-ceiling-corridor-rails.png`,
  `m32-02-ceiling-gap-approach.png`, `m32-03-floor-reference.png`,
  plus the measured `m32-audit-*` set (pre-fix comparison preserved in the
  M3.1 `m31-03/04` captures).

## KNOWN LIMITATIONS

- The near-surface occlusion itself (RC2) is physically inherent to a
  below-focus camera and is NOT eliminated — the fix makes the visible
  lateral boundaries carry the forward cue instead. A future level with
  hazards hanging INTO the corridor mid-face (not at the surface) may need
  an additional cue treatment.
- The `UNDER_RAIL_MIN_BOTTOM_Y = 2` exposure heuristic is world-space; a
  future level stacking solids with exposed undersides below y 2 would not
  get rails (revisit with a contact-graph exposure check if that content
  arrives).
- Frozen QA captures show the "PAUSED" overlay (existing M2/M3/M3.1 QA
  pattern).
- Depth-gradient strength still differs (floor surface gradient ~2.3× the
  ceiling's in screen space) — inherent to viewing a plane from above vs
  from below at shallow angle; judged acceptable now that boundary cues
  match.

## HUMAN GATE

Human ceiling-feel re-playtest still OPEN on the M3.2 build (the human
reported the M3.1 build "looks better" but possibly still harder to read on
the ceiling; this milestone addresses the measured cause — automated evidence
never substitutes for the human gate).
