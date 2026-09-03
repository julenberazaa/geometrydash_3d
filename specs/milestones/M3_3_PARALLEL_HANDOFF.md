# M3.3 — PARALLEL INTEGRATION HANDOFF (for the M4 agent)

Branch: `parallel/m3-camera-parity` (dedicated worktree
`geometrydash_3d_m3cam`). Base SHA: **8cfa2c7** (M3.2 tip, same base as
`parallel/m4-interactions`). Never merged to `main`; never merged with M4.
Two commits, deliberately separated so M4 can integrate them independently.

## COMMIT A — presentation only

- **SHA: `92b8b19`** — `fix(M3.3): enforce surface-relative camera projection parity`
- Purpose: surface-relative camera projection symmetry. The below-focus
  (ceiling) framing is now the EXACT mirror of the above-focus (floor)
  framing, so the Cube's FREE face (opposite support: top on Floor, bottom
  on Ceiling) projects identically on every gravity surface (measured ratio
  0.219 → 1.000). Plus M3.3 QA/spec/audit tooling.
- Files: `src/camera/ChaseCamera.ts`, `tests/cameraFraming.test.ts`,
  `scripts/browser-qa.mjs`, `scripts/m33-audit.mjs` (new),
  `specs/milestones/M3_3_CAMERA_SURFACE_SYMMETRY.md` (new), `GAME_DESIGN.md`
  (§3 sentence + §4), `ARCHITECTURE.md` (§8 ChaseCamera, §9 QA, §10 matrix),
  `ROADMAP.md`, `README.md`.

## COMMIT B — simulation closeout only (this commit, HEAD of the branch)

- Purpose: lethal checks precede gravity portals. `GameSimulation` step order
  is now movement → frontal kill → grounding → void → hazard → **portal →
  finish**; a step that kills the player can never mutate
  `gravityMode` / `portalTransitionCount` / `lastPortalId` (they stay
  pre-step). Collision math, hazard CCD, movement, portal crossing
  mathematics, restart semantics: untouched.
- Files: `src/game/GameSimulation.ts`, `tests/gravity.test.ts` (+2 same-step
  precedence tests: hazard+portal and void+portal),
  `ARCHITECTURE.md` (§7 step order), `GAME_DESIGN.md` (§3 death-wins
  wording), `specs/milestones/M3_GRAVITY.md` (processing order list), and
  this handoff file.
- Exact SHA: take `git log --oneline -2` — this is the second of the two
  M3.3 commits (a commit cannot contain its own SHA).

## Integration order

**A then B** (B is independent of A; order keeps presentation and simulation
changes separable). Rebase/merge M4 onto this tip, or cherry-pick A and B
individually.

## Expected conflicts

- Commit A (camera): **likely low** — M4 should not need `ChaseCamera` or
  the camera test file. `scripts/browser-qa.mjs` may conflict if M4 adds QA
  sections (M3.3's section is appended after 17c; keep both).
- Commit B (GameSimulation precedence): **possible with M4** — if M4 touches
  the `update()` step order, note that portal processing now runs AFTER the
  void/hazard death checks and BEFORE the finish check. If M4 adds new
  per-step state mutations, preserve the invariant below. `tests/gravity.test.ts`
  may conflict if M4 edits the same describe block (the two new tests are at
  the end of 'Precedence, hazards and frontal rule under both gravities').

## Invariants M4 MUST preserve

1. Surface-relative projection symmetry: any new gravity surface must frame
   the FREE face (opposite support) with the Floor-reference projection
   (acceptance 0.90..1.10; shipped mirror pins 1.000). Do not add per-surface
   one-off camera constants; extend the mirror formulation.
2. Camera: no roll, `camera.up` = world +Y, world never rotates, eye never
   enters blocking geometry (re-run `tests/cameraFraming.test.ts` — it drives
   the REAL level, so new geometry is covered automatically).
3. Floor camera branch is numerically identical to the pre-M3.3 build.
4. A lethal step never applies a gravity transition (death wins before
   portal state mutation) — keep lethal checks before portal processing.
5. Floor gameplay bit-identical (floor-compat golden gate); no gameplay
   logic in rendering; camera is presentation-only.

## Final validation on this branch

- `npm run verify` green: typecheck + lint + **98/98 unique automated tests**
  + build.
- Browser QA **80/80** green (40 M2 + 27 M3 + 5 M3.1 + 4 M3.2 + 4 M3.3),
  zero console/page errors.
- M3.3 evidence: `qa/screenshots/m33-audit-before-metrics.json` (ratio 0.219)
  vs `m33-audit-after-metrics.json` (ratio 1.000), `m33-01..04` parity
  screenshots, live free-face parity check ratio 1.000.
- Milestone spec: `specs/milestones/M3_3_CAMERA_SURFACE_SYMMETRY.md`.
