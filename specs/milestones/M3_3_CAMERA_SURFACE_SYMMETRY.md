# M3.3 — Surface-Relative Camera Projection Symmetry + M3 Closeout

## STATUS

**PASS (mechanically/browser/visually validated)** (2026-09-04). Focused
camera-contract follow-up to M3.2 from the third human playtest ("ceiling
depth/readability acceptable to continue", but one explicit CAMERA DESIGN
RULE must become an architectural invariant before M4): the Cube face
opposite the support surface must project with the same apparent size and
perspective on every gravity surface. Measured before fixing (BEFORE ratio
**0.219**), fixed with an exact surface-relative mirror (AFTER ratio
**1.000**), regression-pinned in deterministic math tests and live browser
QA. Plus the separately-requested simulation closeout: **lethal checks now
precede gravity portals** (death wins the step structurally, not just by
early return). No gameplay, control, collider, collision, tuning, or
level-content changes.

## OBJECTIVE

Enforce **surface-relative projection symmetry** as a camera invariant: on
Floor the visible free face is the Cube TOP face; on Ceiling it is the Cube
BOTTOM face; both must project with comparable apparent size/perspective.
The human screenshot pair showed the Ceiling free face far too shallow/small
("not just lower the camera a bit" — a geometry/camera parity contract).
Design the rule in gameplay-frame terms (support direction → identify the
face OPPOSITE support → framing gives that free face the Floor reference
projection) so any future gravity surface inherits it; ship Floor+Ceiling
only (no wall gravity). Second closeout: a lethal step must never apply a
gravity transition (portal state mutation must not survive a killing step).

## NEW CAMERA INVARIANT

**Surface-relative projection symmetry (M3.3).** Let the FREE face be the
Cube face on the `surfaceNormal` side (opposite the support surface): top
face on Floor, bottom face on Ceiling. For every gravity surface, at a
stable grounded rest frame the chase camera must project the free face with
the same apparent size and perspective as the Floor reference:

- projected free-face area ratio (ceiling/floor): **0.90 ≤ ratio ≤ 1.10**
  acceptance; the shipped mirror pins it to **1.000** (deterministic test
  band 0.98..1.02, live QA band 0.95..1.05);
- apparent overall Cube size comparable (width ratio within the same bands);
- player screen placement comparable (mirrored NDC-Y, equal magnitude);
- camera eye outside all solids (M3.1 contract preserved).

Implementation: the `belowFocus` framing is the **exact mirror of the
`aboveFocus` framing** about the corridor mid-plane. Both height lines share
one parallax slope (`verticalParallax` 0.35); the ceiling anchor
(`belowFocusAnchor` −0.3) is the reflected Floor height anchor (4.2) minus
the corridor-geometry term (1.3 × mid-plane 3.0 = 3.9), and the look-height
bias flips sign with the focus side (+0.6 above / −0.6 below). The mirror is
vertical only — X/Z framing, FOV, `camera.up` (+Y) and no-roll are identical
on both sides. This is NOT a Ceiling-only magic constant: the anchor is
derived from the mirror relation and documented as corridor-tuned (same
known limitation category as M3.1's constants).

## MEASUREMENT METHOD

- `scripts/m33-audit.mjs` (dev tool, not part of the verify gate): freezes
  deterministic floor/ceiling rest framings via the debug teleport + pause
  pattern, re-reads state AFTER the freeze+settle so player and eye belong to
  the same frozen frame, then measures via the live `screenPoint` probe:
  eye→player vector decomposed into vertical (support-normal) and
  longitudinal components, eye-to-player distance, apparent cube width/height,
  and the projected screen AREA of the free face (shoelace over its 4
  projected corners). Tagged runs (`M33_TAG=before|after`) preserve evidence
  in `qa/screenshots/m33-audit-*-metrics.json`.
- Deterministic pure-math coverage in `tests/cameraFraming.test.ts` projects
  the free-face corners through the camera basis (forward/right/up, FOV,
  square NDC) and shoelace-measures the area — no browser, no screenshots.
- Live renderer parity check in `scripts/browser-qa.mjs` (M3.3 section).

## BEFORE METRICS (baseline `8cfa2c7`, `M33_TAG=before`)

| Metric | Floor (top face) | Ceiling (bottom face) |
|---|---|---|
| eye→player vertical offset | +3.84 u | −1.23 u |
| eye→player longitudinal offset | 8.50 u | 8.50 u |
| apparent cube width | 89 px | 94 px |
| projected FREE-face area | 2521 px² | 552 px² |

**Parity ratio ceiling/floor: 0.219** — the ceiling free face projected at
~22% of the floor's area (vertical-offset ratio −0.32 vs mirror target −1).
The human complaint is proven: total cube bounding size was comparable
(width ratio 1.05), but the free-face PERSPECTIVE was not — the below-focus
eye saw the bottom face nearly edge-on.

## AFTER METRICS (M3.3 mirror)

| Metric | Floor (top face) | Ceiling (bottom face) |
|---|---|---|
| eye→player vertical offset | +3.84 u | −3.84 u |
| eye→player longitudinal offset | 8.50 u | 8.50 u |
| apparent cube width | 89 px | 89 px |
| projected FREE-face area | 2521 px² | 2521 px² |

**Parity ratio ceiling/floor: 1.000** (live audit AND live browser QA;
deterministic test asserts 0.98..1.02). Vertical-offset ratio −1.000.

## NON-PENETRATION CONTRACT

The M3.1 contract (camera eye never inside blocking geometry, pinned by the
real-playthrough per-step sweep in `tests/cameraFraming.test.ts`) stays
green UNCHANGED with the deeper mirrored framing:

- Ceiling rest eye y ≈ 1.61 (corridor 0..6, ≈4.4 u clear of the underside).
- Portal-up rise: the eye dips to ≈0.4..0.7 (live QA sampled minimum 0.72)
  and never reaches the below-focus desired line's transient low value — the
  desired line rises with the cube faster than the damped eye converges.
- Portal-down fall: worst-case eye peak ≈5.6 < slab underside 6 (the
  above-focus desired line falls with the cube while the eye chases from
  below).
- Live QA corridor sweep through the rise: eye y 0.72..2.99, never in the
  slab band (≥5.85 guard), zero penetrating samples in the deterministic
  sweep.

## FLOOR PRESERVATION

- The `aboveFocus` branch is numerically identical (same height line
  `y·0.35 + 4.2`, same look bias +0.6, same lateral/X/Z math).
- Floor browser checks green unchanged (`m3.1 floor framing unchanged`
  eyeY 4.49; `m3.2 floor reference framing reached`).
- Floor gameplay untouched (floor-compat golden gate green; camera is
  presentation-only).

## PORTAL/DEATH PRECEDENCE CLOSEOUT

M3 semantic debt closed in the same milestone (separate commit — see
`M3_3_PARALLEL_HANDOFF.md`): `GameSimulation` step order was

`movement → frontal kill → grounding → gravity portals → void → hazard → finish`

which let a portal mutate `gravityMode`/`portalTransitionCount`/`lastPortalId`
in a step that a later void/hazard check then killed. New order:

`movement → frontal death → grounding → void death → hazard death → gravity portal → finish`

Contract (pinned by new `tests/gravity.test.ts` cases): if a hazard (or the
void bound) and a gravity portal trigger in the SAME fixed step, the player
dies, `gravityMode` remains the pre-step mode, `portalTransitionCount` does
not increment, and `lastPortalId` is not set by that portal. Death wins
before portal state mutation — collision math, hazard CCD, movement, portal
crossing mathematics and restart semantics are untouched (portal processing
simply runs after the death checks; crossing detection is
order-independent: `prevZ < portal.z ≤ currentZ` on the swept step path).

## TESTS

- `tests/cameraFraming.test.ts` (+2): (a) rest-frame mirror pinning — floor
  eye/look unchanged, ceiling eye/look exactly mirrored, equal-magnitude
  free-side offsets; (b) free-face projection parity — deterministic
  square-NDC projection of the free face: area ratio 0.98..1.02, apparent
  width ratio 0.95..1.05, mirrored player NDC-Y. Existing suites (incl. the
  M3.2 framing-parity bounds and the eye non-penetration playthrough) green
  unchanged.
- `tests/gravity.test.ts` (+2): hazard+portal same-step precedence (player
  dies, mode pre-step, transitions 0, portal id unset) and void+portal
  same-step precedence (same assertions; portal z derived from a probe run
  of a portal-free twin level so the void step IS the crossing step).
- `scripts/browser-qa.mjs`: M3.3 section (+4 checks): floor/ceiling free-face
  reference frames, live projected free-face parity ratio 0.95..1.05, gap
  approach with the mirrored view; `m33-01..04` screenshots. The M3.1
  ceiling-eye band was re-derived for the mirrored contract (eye below cube
  by the mirrored offset, corridor-bound) — not a weakening: the check now
  requires ≥2.5 u below the cube (was ≥0.5).

## BROWSER QA

**80/80 green** (40 M2 + 27 M3 + 5 M3.1 + 4 M3.2 + 4 M3.3), zero
console/page errors. Evidence: `qa/screenshots/m33-01-floor-free-face-reference.png`,
`m33-02-ceiling-free-face-reference.png`, `m33-03-floor-ceiling-parity-debug.png`
(F1 framing overlay), `m33-04-ceiling-depth-readability.png`, plus the
measured `m33-audit-*` before/after sets. Visual gate on the m33 set: pass.

## KNOWN LIMITATIONS

- `belowFocusAnchor` (−0.3) encodes the corridor mid-plane of corridor-style
  levels (support planes 0/6, cube rest 0.55 from its surface) — same
  category as M3.1's documented framing limitation; a future level with a
  very different ceiling band may need a level-declared framing hint.
- Parity is exact at stable rest frames; during portals/jumps the damped
  smoothing (unchanged) makes the framing approach the mirrored line
  asymmetrically for a few tenths of a second (projection parity is a
  rest-frame contract by design).
- The portal-up transition now swings the eye deeper (a short dive-and-rise
  glide, ~0.5 s) — inherent to mirroring the canonical offset; judged
  acceptable (no penetration, no cut, no roll; visual gate pass).
- Wall gravity is NOT implemented; the invariant is expressed surface-
  relatively (free face = surfaceNormal-side face; eye offset along the
  free-face normal) so a future wall mode inherits it.

## EVIDENCE

- Deterministic: `npx vitest run` — 98/98 unique tests (4 new), including
  the exact-mirror pins and the free-face area parity (pure math).
- Live audit: `M33_TAG=before` ratio 0.219 → `M33_TAG=after` ratio 1.000
  (`qa/screenshots/m33-audit-before-metrics.json` / `-after-metrics.json`).
- Browser QA: 80/80, zero console/page errors, live parity ratio 1.000
  (ceiling 2521 px² / floor 2521 px²), corridor eye sweep 0.72..2.99.
- `npm run verify` green (typecheck + lint + tests + build).
