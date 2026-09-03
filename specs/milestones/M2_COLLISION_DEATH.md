# M2 — Collision, Death & Restart Polish

## STATUS

**PASS (mechanically/browser validated)** (2026-09-03). All behavioral,
contract, test, browser-QA, and performance requirements met: 54/54 unique
automated tests (21 new in `tests/death.test.ts`), `npm run verify` green,
browser QA 40/40 green with zero console/page errors, validated commit on
`main`. Human Cube-movement-feel gate: APPROVED on entry (tuning frozen).
Human death/restart-feel gate: OPEN (requires playtest; automated QA cannot
prove feel).

## OBJECTIVE

Turn the validated M1/M1.2 Cube foundation into a collision/death loop that is
precise, fair, fast, readable, and commercially polished — without adding
mechanics. The player must always understand *"I died because I hit that"*,
never *"the engine randomly killed me"*. Target: PRECISION + FAIRNESS +
FAST FAILURE + SATISFYING RETRY.

## ENTRY CONDITIONS

- M1/M1.1/M1.2 PASS, human Cube movement feel APPROVED (frozen tuning).
- Baseline at M2 start: commit `4ab1a16`, `npm run verify` green,
  **33 unique automated tests** (historical 41/43 run-counts included
  re-executed suites via a since-fixed test-import bug; see §EVIDENCE note in
  M1 spec closeout / ROADMAP).
- No `killFront` colliders in any level; test level uses `solid` + `hazard` only.

## IN SCOPE

- Collision audit + explicit frontal/lateral decision model.
- `killFront` semantics productionized (blocking volume, lethal frontally only).
- Spike/hazard fairness review + pinned regression tests.
- High-speed robustness regression tests (2×/4×-equivalent displacement).
- Corner/edge determinism (documented tie-breaking, pinned tests).
- Death-state contract: instantaneous, exactly-once, cause-tagged.
- Death hold retune 0.45 s → **0.30 s** (36 sim ticks), deterministic.
- `R` restart audit (running / dead / repeated).
- Procedural death burst VFX (pooled, brief, leak-free).
- Restrained camera kick + clean camera reset on respawn.
- Minimal procedural death SFX (lazy Web Audio, guarded; non-blocking).
- Collision/death debug info (sim fields + F1 overlay + `__gd3d` probes).
- Browser QA M2 section + screenshots.
- This spec + doc updates + validated milestone commit.

## OUT OF SCOPE

Ship, ceiling/wall gravity gameplay, gravity portals, pads, orbs (jump or
gravity), speed/teleport/size portals, moving platforms/hazards, lasers,
crushing, music/BPM, collectibles, final level, vertical slice, public editor,
backend, persistence, mobile/gamepad, character selector, rendering overhaul,
post-processing stack. No general-gravity refactor (M3 owns it).

## BEHAVIORAL REQUIREMENTS

1. Frontal impact against a blocking face kills (see COLLISION CONTRACT).
2. Lateral scrape / side contact blocks or slides — never kills.
3. Landing on a valid safe top surface (solid or killFront) is safe.
4. Hazard overlap kills; spike gameplay box stays smaller than its visual.
5. No tunneling at normal speed or 2×/4×-equivalent per-step displacement.
6. Corner/edge contacts resolve deterministically (same inputs → same outcome).
7. Death is instantaneous at the lethal step; gameplay input/motion stops.
8. Death event fires exactly once per death; overlapping contacts never double-fire.
9. `attempts` increments exactly once per respawn/restart, never on death itself.
10. Finish can never trigger after death.
11. Auto-respawn exactly 36 ticks (0.30 s) after death; `R` restarts immediately
    from running, dead, airborne, or repeated-press states with one attempt each.
12. Respawn fully resets position, velocity, grounded/support, lane intent,
    and transient collision/death state; no ghost VFX, no stale camera kick.
13. Death burst plays on every death, expires in ≤ 0.4 s, never leaks.
14. Restart feels < ~500 ms wall-clock including the readable burst.
15. M1 movement feel unchanged (no tuning changes); M1.2 lateral fall-off intact.

## COLLISION CONTRACT

- Gameplay collider: unrotated 1.1³ AABB. Visual mesh never authoritative.
- Swept axis-separated movement, order Y → Z → X, exact single-axis slab
  queries (`sweepAxis`), no iteration.
- **Blocking kinds:** `solid` and `killFront` clip movement and count as
  ground support. `hazard` never blocks (overlap-tested only).
- **Frontal kill rule:** a wall contact whose normal opposes the forward axis
  (`normal.z < -0.5`) while approaching along forward (`preVel.z > 0`) kills —
  for BOTH blocking kinds. This is derived from contact geometry + motion,
  never from kind alone.
- **Lateral/top safety:** contacts with ±X normals block without killing;
  landings via Y resolution or the support probe (full footprint minus 0.02
  skin) are safe on either blocking kind.
- **Edge safety:** axis-boundary touches (`>=`/`<=`) do not count as overlap,
  so landing exactly on a top edge never converts to a frontal kill (Y resolves
  first, then Z sees no perpendicular overlap).
- **`killFront` vs `solid`:** identical blocking/support; identical frontal
  lethality. `killFront` exists so future content can mark *visually lethal*
  fronts (spike walls) while sharing one code path. No level is required to
  use it; the test level uses `solid` fronts (GD-standard: any block face kills
  head-on).
- **Hazard rule:** `hazard` kills on any AABB overlap (checked after movement
  each running step). Spike gameplay boxes are intentionally smaller than their
  visuals (0.5 tall vs ~0.85 visual) — fairness margin, pinned by test.
- **Determinism:** per-axis strictly-smallest-TOI wins; ties keep the first
  candidate in `CollisionWorld` query order (cell-index order, then level
  insertion order) — deterministic per level, documented, pinned by a
  run-it-twice test. No randomness anywhere in collision.
- **Check order per step:** move → frontal-kill → grounding → void → hazard →
  finish. Death returns immediately; finish is unreachable once dead.

## DEATH CONTRACT

- `status: running | dead | finished`. Only `update()` transitions.
- `die(cause)` sets `dead` + `deathHoldTimer = 0.30 s`, records `deathCause`
  (`hazard | frontImpact | void`), `deathId` (+1), lethal collider id, contact
  normal, and pre-impact velocity. **Idempotent:** calls while already dead are
  ignored (no second event, no timer reset).
- While `dead`: `update()` ignores gameplay input, freezes the player transform
  and `elapsedSimTime`, ticks the hold timer down, and auto-respawns at 0.
- `onDeath` fires exactly once per death. Manual `restart()` is NOT death
  (`deathCause` stays null, no `onDeath`).
- `respawn()` resets player state, `deathHoldTimer`, `elapsedSimTime`,
  transient death fields, sets `running`, and does `attempts += 1` exactly once.
  `restart()` from any status converges to one `respawn()` (single attempt).
- Debug surface: `deathCause`, `lastDeathId`, `lastLethalColliderId`,
  `lastContactNormal`, `lastPreImpactVelocity` getters on the simulation.

## RESTART CONTRACT

- Auto: death tick + 36 ticks → respawn. Asserted in ticks, never wall-clock.
- Manual `R`: immediate `respawn()` whether running, airborne, dead, or
  mid-hold; exactly one attempt; deterministic under repeats.
- No slow motion, fade, loading, async reload, or app/renderer rebuild.
- Camera snaps to the start frame on respawn (no backward swoosh); any death
  kick is zeroed.

## VFX REQUIREMENTS

- `DeathBurstView` (rendering-only, owned by `RendererHost`): 14 pooled
  fragments, 2 shared materials, 1 shared geometry; deterministic radial burst
  (fixed direction table), 0.35 s lifetime, shrink-out (no per-fragment
  materials/opacity); zero allocation after construction; hidden when expired.
- Trigger: renderer observes `deathId` change → burst at the frozen death
  position. Rendering never writes gameplay state.
- Camera: on death, +3.5 FOV kick and +0.25 u vertical offset, both decaying
  with ~0.12 s time constant; zeroed + camera snapped on respawn. No roll, no
  shake, no cinematic.
- Audio (non-blocking): `DeathSfx` — lazy `AudioContext` (created on first user
  gesture), 0.18 s descending square blip + click, fully guarded try/catch;
  silence on failure. Removable without touching gameplay.

## ARCHITECTURE REQUIREMENTS

- No new managers. Ownership: `GameSimulation` = death/attempt state;
  `moveAabb`/`CollisionWorld` = resolution; `CubeController` = movement policy;
  `LevelDefinition` = content; `DeathBurstView` = visual-only feedback;
  `ChaseCamera` untouched (kick lives in `RendererHost` as presentation).
- Simulation stays THREE/DOM-free (new sim fields are plain data).
- Hot loop: no per-step allocations added (scratch reuse for pre-impact
  velocity / contact normal copies).
- `restart()` single-path cleanup (remove the redundant branch).

## AUTOMATED TEST REQUIREMENTS

New `tests/death.test.ts` (+ focused additions to `tests/collision.test.ts`)
covering product behavior, in ticks not wall-clock:

1. frontal `solid` impact kills with cause `frontImpact`.
2. frontal `killFront` impact kills; side scrape on `killFront` blocks, no kill.
3. landing on `killFront` top is safe and grounds.
4. hazard overlap kills with cause `hazard`, exactly-once event.
5. void fall kills with cause `void`.
6. high-displacement (2×/4×-equivalent) frontal impact blocks/kills, no tunnel.
7. identical input streams → identical trajectories (determinism).
8. corner graze fixture: deterministic outcome, run twice, pinned.
9. repeated hazard overlap while dead: one event, no attempt change pre-respawn.
10. attempts +1 exactly per auto-respawn and per manual restart (running/dead).
11. dead steps freeze position and sim time; inputs while dead are ignored.
12. respawn resets position/velocity/grounded/support/lane/death fields.
13. finish unreachable after death.
14. death→respawn latency is exactly 36 ticks.
15. spike fairness: gameplay box smaller than visual; adjacent-lane run survives;
    jump over spike survives; direct run-through dies.
16. all M1/M1.2 suites stay green unmodified in intent.

## BROWSER QA REQUIREMENTS

Extend `scripts/browser-qa.mjs` (M2 section, closed-loop polling, no fixed-wait
flakes): frontal wall death → auto-respawn (+1 attempt); spike death via
scripted closed-loop jump chain; void death (existing); lateral fall death
(existing); burst visible on death frame and cleared after; 10× die/respawn
loop with flat draw-call/triangle/scene-child counts (leak guard); manual R
from running and from dead; camera reset (position sane post-respawn); F1 shows
death cause + lethal info; resize; zero console/page errors. Screenshots:
`m2-01-pre-impact`, `m2-02-death-burst`, `m2-03-respawn`, `m2-04-lateral-scrape`,
`m2-05-debug-contact` (names may vary, PNG + JSON sidecars).

## PERFORMANCE REQUIREMENTS

- Baseline draw calls / triangles unchanged outside the ≤0.4 s burst window.
- Scene child count constant across 10+ deaths (pooled burst, no listeners).
- No per-death geometry/material allocation; no audio-node accumulation.
- `npm run verify` green; browser QA 100% with zero console/page errors.

## DEFINITION OF DONE

All behavioral + contract + test + browser-QA + performance requirements above,
plus: M1 movement feel untouched (tuning diff empty); docs match reality
(`GAME_DESIGN`, `ARCHITECTURE`, `ROADMAP`, this spec); unique test count
reported honestly; validated milestone commit on `main`. Human death-feel gate
explicitly left OPEN for playtest.

## KNOWN LIMITATIONS

- `killFront` has no test-level content yet (fixtures only) — content pass is M7.
- Tie-breaking depends on level insertion order (documented, deterministic).
- Death SFX is a placeholder blip; music/BPM untouched.
- Camera snap on respawn is instant (no transition) — chosen for retry speed.
- No M3 gravity generalization of the frontal rule yet (forward axis is +Z);
  the rule is written axis-explicitly to make M3 mechanical.

## EVIDENCE

- `npm run verify` output (see milestone commit).
- `qa/screenshots/m2-*.png` + `.json` sidecars (git-ignored, regenerable):
  m2-01 pre-impact, m2-02 death burst (frozen mid-flight via the
  freeze/replay debug path — fresh page reload precedes it because
  long-lived headless pages serve stale compositor surfaces; documented in
  `scripts/browser-qa.mjs`), m2-03 respawn, m2-04 lateral scrape,
  m2-05 debug contact.
- Unique test count from `npx vitest run` (54, not historical run-counts).
- In-page burst gate (burstActive + dead at detection) + natural-observation
  asserts + draw-call deltas + 10× leak loop, all in the QA log.
