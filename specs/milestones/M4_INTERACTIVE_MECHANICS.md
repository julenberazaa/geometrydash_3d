# M4 — Interactive Mechanics (Pads, Orbs, Speed Portals)

## STATUS

**COMPLETE (mechanically/browser/human-validated, M3.3 integrated)** on
`main`; the work originated on branch `parallel/m4-interactions`, built on
the validated M3.2 baseline `8cfa2c7`. M3.3 was finished in parallel on
`parallel/m3-camera-parity`
and cherry-picked into this branch in order (A `d3c76bd`, then B
`d3c250e` — see PARALLEL M3.3 INTEGRATION — RESULT below). Final state:
123/123 unique automated tests, browser QA 101/101, zero console/page
errors. HUMAN FEEL GATE = APPROVED (2026-09-04): human playtest on the
final integrated M3.3 + M4 build confirmed pads/jump orbs/gravity orbs/
speed portals feel. M4 fully CLOSED — engineering, browser, and human
gates all passed. Next milestone: M5.

## OBJECTIVE

Add the first production-quality INTERACTIVE gameplay mechanics on top of the
validated Cube foundation: jump pads, jump orbs, gravity orbs, and speed
portals, plus the minimal deterministic trigger infrastructure they need.
Ship mode is explicitly OUT of scope.

## ENTRY CONDITIONS

- M1/M1.1/M1.2, M2/M2.1, M3/M3.1/M3.2 validated (94 unique automated tests,
  76 browser checks green at baseline `8cfa2c7`).
- Floor gameplay + death/restart human-approved; Floor ↔ Ceiling architecture
  validated.
- `npm run verify` green on the branch baseline (re-verified in this worktree:
  94/94).

## IN SCOPE

1. Jump pads (passive, contact-activated impulse).
2. Jump orbs (active press-activated impulse, airborne-capable).
3. Gravity orbs (active press-activated Floor ↔ Ceiling flip).
4. Speed portals (deterministic forward-crossing speed multiplier change).
5. One authoritative forward-speed state (level base speed × current
   multiplier) consumed by the Cube controller.
6. Original lightweight procedural visuals + restrained activation VFX
   (presentation only).
7. Test Level interaction section (data-driven demo content).
8. Automated tests + browser QA per the matrices below.

## OUT OF SCOPE

- Ship mode.
- Moving obstacles — **explicitly deferred**: the M4 interaction set is the
  scope priority; a moving obstacle needs time-varying colliders, which the
  static spatial-hash `CollisionWorld` does not yet represent cleanly. Adding
  a hasty second collider pathway risks the swept-collision guarantees that
  M2/M2.1 pinned. Revisit after M4 lands, as its own small milestone item.
- No general trigger/event engine (no TriggerManager/EventBus/PortalManager —
  per the M4 mandate, interactions are explicit domain types processed by
  `GameSimulation`).
- No checkpoints, no practice mode, no music sync.

## INTERACTION MODEL

One concept, one owner:

- `LevelDefinition` (data): pad/orb/portal definitions — pure content.
- `levelRuntime.loadLevel` (indexing): validated, Z-sorted speed portals;
  flat pad/orb lists on `LoadedLevel`.
- `GameSimulation` (authority): the ONLY mutation point for activations,
  speed state, and gravity transitions. Owns per-attempt one-shot lifecycle.
- `CubeController` (movement policy only): consumes a per-step
  `forwardSpeed` from the step context; knows nothing about portals or orbs.
- `InputSystem` (physical input only): unchanged; orb activation reuses the
  existing gravity-relative `jump` action interpretation.
- Renderer (visuals only): reads level data + sim counters/state; triggering
  never depends on renderer/camera/visuals.

**Detection primitive (shared):** an interaction's activation volume is an
AABB. "The player contacted/crossed the volume this step" means the EXACT
swept-path test already used for hazard CCD (`sweptPathOverlaps` over the
authoritative Y → Z → X path, solid-clipping intermediates included). This
makes every interaction robust at 4× forward speed: a thin volume can never
be skipped between steps, and no corner the path never entered can falsely
trigger.

**Lifecycle:** one-shot per interaction id per attempt. A used interaction
cannot re-fire during the same attempt (covers "no multi-fire while resting/
contacting" and "no orb double activation"); `respawn()`/`restart()` clears
all used flags, restores the speed tier and re-arms everything. Linear
auto-run levels never revisit content, so per-attempt one-shot is the
complete lifecycle — no re-arm-on-exit complexity is invented.

**Events/counters (debug + VFX edges):** monotonic `interactionEventCount`,
`lastInteraction { kind, id, position }`, per-kind counts
(`padActivationCount`, `orbActivationCount`, `speedPortalCount`), and
`isInteractionUsed(id)` for the renderer's dim-after-use state. These are
observability surfaces, never gameplay inputs.

## PAD CONTRACT

- Data: `JumpPadDef { id, center, halfExtents, surface: 'floor' | 'ceiling',
  impulse }` — an explicit trigger volume sitting on its surface.
- Activation: passive. Fires when the player's swept step path overlaps the
  pad volume (physical contact/crossing). No button press involved.
- Effect: velocity component along the pad's surface normal (floor pad +Y,
  ceiling pad −Y) is REPLACED with `impulse` (deterministic identical launch,
  identical semantics to the Cube jump's along-gravity replacement). Lateral
  and forward components are preserved. `grounded`/`supportColliderId` are
  cleared immediately.
- Impulse magnitude is explicit per-pad level data (never silently the jump
  impulse). Test Level floor pad uses 18 u/s (vs jump 13.2): apex ≈ 3.86 u,
  airtime ≈ 0.857 s ≈ 12.0 u forward at 1×.
- Exactly-once per attempt (see lifecycle).
- Input semantics: none (pads never read input).

## JUMP ORB CONTRACT

- Data: `JumpOrbDef { id, center, halfExtents, impulse }` — an activation
  window floating in space (Test Level: 1.8³ box around a glowing sphere).
- Activation requires BOTH, in the same fixed step:
  1. the player's swept step path overlaps the orb window (inside, entering,
     or exiting during this step), AND
  2. a press EDGE of the logical jump action occurs this step
     (`jump.pressedThisStep` — the same gravity-relative merge the Cube jump
     uses: Space OR the surface-appropriate arrow; so Space and the
     gravity-relative jump arrow both activate, consistently with Cube jump
     semantics).
- Press-edge only: held input inherited from before entering the window does
  NOT activate. There is NO input buffer — a press the step before entering
  expires unused (deliberate: no hidden buffering; windows are generous
  instead).
- Effect: velocity along the CURRENT gravity surface normal (away from the
  current support surface, gameplay-frame relative) is REPLACED with the
  orb's `impulse`; lateral/forward preserved; grounded/support cleared.
  Works while airborne (that is its purpose) and while grounded (if a ground
  jump fired earlier in the same step, the orb impulse supersedes it — later
  mutation wins within the same non-lethal step; deterministic).
- One press = one activation; the orb is one-shot per attempt, so two presses
  inside the same orb yield exactly one activation.
- Test Level jump orb impulse 13.2 (identical feel to a normal jump).

## GRAVITY ORB CONTRACT

- Data: `GravityOrbDef { id, center, halfExtents }` — same input-window
  semantics as the jump orb (press edge inside the swept window; one-shot per
  attempt).
- Effect: flips the authoritative gravity mode Floor ↔ Ceiling through the
  SAME transition path as M3 gravity portals (no orb-specific duplicate
  gravity state): world position preserved, ALL velocity components
  preserved (no impulse, no snap), grounded/support cleared. The world and
  camera never rotate.
- Velocity contract — deliberately identical to gravity portals (M3
  consistency argument): preserving world velocity means a falling Cube that
  flips continues its world motion and simply accelerates toward the new
  surface; clearing/zeroing vertical velocity would be an extra rule the
  portals don't have and would make portal and orb transitions feel
  different. Tested: flip while falling preserves the world-space velocity
  vector exactly.
- No oscillation: one-shot per attempt + press-edge semantics make repeated
  flip oscillation impossible (a second flip needs leaving... which one-shot
  forbids for the whole attempt).
- Resets on death/R: respawn restores the level's start gravity mode.

## SPEED CONTRACT

- Audit result: `baseForwardSpeed` previously lived in BOTH `CUBE_TUNING`
  (used by the controller) and `LevelDefinition` (declared but unwired). M4
  makes the LEVEL the single content authority: `LevelDefinition.
  baseForwardSpeed` is the level's 1× forward speed, and
  `LevelDefinition.startSpeedMultiplier` (default 1) is the level's starting
  tier. `CUBE_TUNING.baseForwardSpeed` is REMOVED (it duplicated the level
  value).
- ONE authoritative current speed state lives on `GameSimulation`
  (`speedMultiplier`); the per-step forward speed is
  `def.baseForwardSpeed * speedMultiplier`, delivered to the controller each
  step via `CubeControllerStepContext.forwardSpeed`. The controller applies
  exactly that value along `forwardAxis` — no multipliers sprinkled anywhere
  else. 1× with `baseForwardSpeed = 14` is bit-identical to the pre-M4
  behavior (multiplication by 1 is exact; pinned by `floorCompat`).
- Data: `SpeedPortalDef { id, z, multiplier }`. Deterministic forward
  crossing on the swept step path (`prevZ < portal.z <= currentZ`), processed
  in ascending Z (furthest crossed portal wins), exactly-once per attempt by
  construction, no position jump, no impulse. Supported tiers (content
  guidance; the architecture accepts any finite positive multiplier):
  0.5×, 1×, 2×, 3×, 4×.
- Restart (`R`) and death respawn restore `startSpeedMultiplier`.
- Floor golden behavior at 1× is preserved and pinned.

## TRIGGER ORDER (authoritative per fixed step)

1. **Controller step** — physical input interpreted against the CURRENT
   (pre-mutation) gravity mode; lane intent, lateral kinematics, gravity,
   ground jump; forward speed = authoritative level speed × current
   multiplier.
2. **Integrate + collide** — Y → Z → X swept movement; swept path recorded.
3. **Frontal kill** — death wins the step immediately.
4. **Grounding** — support probe along gravity + velocity cleanup.
5. **Lethal checks** — void bounds (lower, then upper), then exact
   swept-path hazard CCD. Death wins; NOTHING later in the step may rescue
   or mutate a dead step. (This places lethal checks BEFORE all portal and
   interaction mutations — the M3.3 invariant "lethal checks must precede
   gravity portal state mutation", extended to every M4 interaction.)
6. **Passive interactions — jump pads** (ascending level order): swept
   contact, one-shot per attempt.
7. **Active interactions** — jump orbs, then gravity orbs (level order):
   press edge inside swept window, one-shot per attempt.
8. **Speed portals** — ascending-Z forward crossings; multiplier mutation.
9. **Gravity portals** — ascending-Z forward crossings; gravity transition
   (furthest crossed wins).
10. **Finish check** — `finishZ` reached → finished. Finish can never occur
    after a lethal event (steps 3/5 return before this).

Key invariant: **a lethal step (3 or 5) terminates the step before any
interaction or portal mutates state** — a pad, orb, speed portal, or gravity
portal can never rescue, rewind, or re-tag a death. Crossing/interaction
DETECTION uses this step's swept path, but all EFFECTS are velocity/state
mutations for subsequent steps; no interaction can alter the already-integrated
position of the current step, so no interaction can un-overlap a hazard or
un-exit a void bound.

Deterministic precedence at equal Z: speed portals process before gravity
portals (documented tie-break; the two mutations are independent).

## INPUT WINDOW CONTRACT (fairness semantics, deliberately chosen)

For pads: no input semantics (passive).

For orbs (jump + gravity), with the swept-path window:

- Press just BEFORE entry: no activation (edge expires unused; no buffer).
- Press on the entry step: activates (the path overlaps the window on the
  entering step).
- Press while inside: activates.
- Press on the exit step: activates (the exiting step's path still overlaps
  the window — the swept envelope includes the segment through the volume).
- Held input without a NEW press edge: never activates.
- Two presses inside the same orb: exactly one activation (one-shot per
  attempt).
- High-speed crossing: the swept-window test cannot skip the volume at any
  per-step displacement; a press during the crossing step activates.
- Windows are content-sized generously (Test Level: 1.8 u across) so the
  no-buffer policy is fair: the honest press timing is "when you see yourself
  in the orb", not frame-perfect.

## RESET CONTRACT

`respawn()` (both death auto-respawn and manual `R`) restores, exactly:
start position/lane, start gravity mode (M3), `speedMultiplier` =
`startSpeedMultiplier` (M4), clears ALL used-interaction flags (pads, orbs,
portals re-arm), clears interaction counters' attempt-scoped debug fields
(`lastPortalId`), and resets `elapsedSimTime`. Attempt count increments
exactly once per respawn/restart (unchanged M2 semantics).

## VISUAL CONTRACT

All original procedural visuals; no copyrighted Geometry Dash art; no
reference PNG reuse; shared geometries/materials; no heavy shaders.

- **Jump pad:** flat amber slab riding ON its surface + thin neon frame;
  readable at speed from the run line; surface-relative (floor pads on top
  faces, ceiling pads on undersides).
- **Jump orb:** floating yellow sphere with a thin ring, in the jump-boost
  color family (yellow) shared with pads — yellow = "jump impulse".
- **Gravity orb:** floating blue sphere with a ring, visually distinct from
  the jump orb (blue = gravity family, matching the cyan/blue portal
  language).
- **Speed portal:** a neon gateway ring in the tier color (0.5× orange,
  1× blue, 2× green, 3× pink, 4× red) with N chevron marks = multiplier
  tier — tier is readable from color + chevron count, never from tiny text.
- **Used state:** activated orbs dim (presentation read of
  `isInteractionUsed`); pads/one-shots likewise stop glowing.
- **Activation VFX:** a restrained pooled expanding ring at the interaction
  position (edge-detected from `interactionEventCount`), ~0.3 s, shrink-out;
  zero allocation post-construction; presentation only — no VFX ever
  determines gameplay activation; no object leaks.

## AUTOMATED TESTS

New suite `tests/interactions.test.ts` (data-driven custom levels, same
conventions as `gravity.test.ts`):

- PAD: floor pad activates exactly once (velocity replaced, grounded
  cleared); ceiling pad impulse correctly reversed (−Y); pad does not
  multi-fire while resting/contacting (multi-step overlap, single count).
- JUMP ORB: touch without press does not activate; valid press inside
  activates once (impulse replaced along surface normal); Space works;
  gravity-relative arrow works (ceiling: ArrowDown); held key without a new
  edge does not retrigger; press just before entry does not activate;
  press on exit step activates; high-speed (4×) crossing is not skipped.
- GRAVITY ORB: input activation flips gravity; no input = no flip; one press
  = one flip (two presses = one flip); support clears; world velocity
  preserved exactly through the flip; reset (respawn) restores start
  gravity; run-twice determinism (identical state trajectory).
- SPEED: 1× preserves existing Floor behavior (bit-identical to pre-M4 via
  `floorCompat`); speed portal changes forward speed (position advance
  scales); R resets speed; death respawn resets speed; 4× cannot tunnel a
  thin solid; 4× cannot skip a hazard (CCD); 4× does not skip a speed portal
  or gravity portal; 4× orb crossing honors the documented input semantics.
- ORDERING: lethal same-step event wins over interaction (hazard overlap +
  pad contact in one step → dead, pad not activated); finish cannot occur
  after lethal; speed portal vs gravity portal precedence deterministic.
- REGRESSIONS: all existing suites stay green and unmodified (Floor golden,
  M3 gravity/camera, M2.1 hazard CCD, underside rails).

## BROWSER QA

Extend `scripts/browser-qa.mjs` with an M4 section (teleport-assisted, same
pattern as M3): pad launch visible + VFX ring; orb no-press pass-through;
orb press activation; gravity orb Floor→Ceiling with readable ceiling state;
speed portal 2× (HUD/debug speed + faster advance); fast-section collision
safety; restart resets interactions/speed; repeated attempt (no duplicate
activations); M2/M3 checks unchanged; zero console/page errors; leak
observation (scene children/draw calls flat across repeated activations).
Screenshots: `m4-01-jump-pad`, `m4-02-jump-orb-window`, `m4-03-orb-activation`,
`m4-04-gravity-orb`, `m4-05-speed-portal`, `m4-06-high-speed-gameplay`.

## PERFORMANCE

- 120 Hz fixed simulation unchanged; no general physics engine.
- Hot loop stays allocation-neutral: window tests reuse the existing swept
  scratch; used-set is a pre-allocated `Set` cleared on respawn (activation
  is a cold event); renderer VFX is pooled.
- Shared unit-box geometry + shared materials for all interaction visuals.

## DEFINITION OF DONE

- [ ] All contracts above implemented and documented.
- [ ] `npm run verify` green with the full M4 test matrix + all regressions.
- [ ] Browser QA M4 section green + `m4-*` screenshot set; zero console/page
      errors; leak guard flat.
- [ ] Docs updated in the same commit set: `GAME_DESIGN.md` (mechanics
      sections), `ARCHITECTURE.md` (speed state, interaction model, order),
      `ROADMAP.md` (M4 entry), this spec.
- [ ] Test Level interaction section playable end-to-end.
- [ ] M3.3 integrated (see below) and its tests green on this branch.
- [x] Human playtest completed — pads/orbs/speed feel APPROVED
      (2026-09-04, final integrated M3.3 + M4 build).

## KNOWN LIMITATIONS

- Per-attempt one-shot lifecycle: content that wants re-armable interactions
  (non-linear levels) will need a lifecycle extension — out of scope until a
  level shape demands it.
- Moving obstacles deferred (see OUT OF SCOPE).
- Orb windows are AABBs (not spheres) — consistent with the all-AABB
  collision model; visual spheres are slightly smaller than the window
  (fairness margin, same principle as spikes).
- Speed multiplier is a scalar on the forward axis only; lane/lateral speeds
  are unchanged at higher tiers (deliberate: lane feel stays constant).

## PARALLEL M3.3 INTEGRATION

M3.3 (`parallel/m3-camera-parity`, same base `8cfa2c7`) ships two commits:
(A) surface-relative camera projection parity, (B) lethal-check-before-
gravity-portal precedence closeout, plus
`specs/milestones/M3_3_PARALLEL_HANDOFF.md`.

- M4 already implements the M3.3 ordering invariant (lethal checks precede
  ALL portal/interaction mutations — see TRIGGER ORDER step 5), so Commit B
  is expected to be semantically compatible; any textual conflict in
  `GameSimulation` will be reconciled manually, never ours/theirs.
- Integration is by `git cherry-pick A` then `B` (never a branch merge),
  at Checkpoint 3 (mandatory before final M4 validation/commit), followed by
  full `npm run verify` + browser QA.
- If M3.3 is unfinished at Checkpoint 3, M4 stops at
  "M4 IMPLEMENTATION READY — WAITING FOR M3.3 INTEGRATION" and does not
  declare PASS.

## EVIDENCE

- Baseline: `8cfa2c7`, `npm run verify` green (94/94) re-verified in this
  worktree before any M4 change.
- Automated: `npm run verify` green — 119/119 unique tests (25 new in
  `tests/interactions.test.ts`; all 94 baseline suites unmodified, including
  the `floorCompat` exact-float golden gate proving 1× Floor behavior is
  bit-identical, and the extended M3 gravity playthrough that now finishes
  the FULL level: pad → jump orb → gravity orb → portal-down-2 → 2× portal
  → finish, asserting interaction counts and the final speed tier).
- Browser QA: 97/97 checks (76 previous + 21 M4) with zero console/page
  errors (`npm run qa:browser`, headless Chromium against the dev server).
  Leak guard: scene children/draw calls flat across three repeated pad
  passes; exactly one pad activation per attempt.
- Screenshots: `qa/screenshots/m4-01-jump-pad` (mid-launch frozen frame),
  `m4-02-jump-orb-window` (orb ahead over the gap),
  `m4-03-orb-activation` (dimmed used orb post-activation),
  `m4-04-gravity-orb` (grounded on slab C underside, portal-down ahead),
  `m4-05-speed-portal` (green 2× gateway, two chevrons),
  `m4-06-high-speed-gameplay` (2× sprint to the finish gate) + JSON
  provenance sidecars (git-ignored, regenerable via `npm run qa:browser`
  with `QA_URL` pointing at a dev server serving this branch).
- Note: the QA machine had a pre-existing dev server of the MAIN worktree on
  port 5173; the M4 runs used a dedicated dev server for this worktree
  (`QA_URL`). Always point `QA_URL` at a server serving this branch.

## PARALLEL M3.3 INTEGRATION — RESULT

**INTEGRATED.** At Checkpoints 1 and 2 the branch was still at base; at
Checkpoints 3 (mandatory, before final validation) `parallel/m3-camera-parity`
had completed both commits plus the handoff:

- **Commit A — `92b8b19` (cherry-picked as `d3c76bd`):** surface-relative
  camera projection parity (ChaseCamera mirror framing + QA/audit tooling).
  Conflicts: `README.md` + `ARCHITECTURE.md` QA sections +
  `scripts/browser-qa.mjs` (both branches appended sections) — resolved by
  keeping BOTH sides' content merged (M4 sections renumbered 18/19/20);
  `tests/cameraFraming.test.ts` merged clean (M4's extended playthrough
  driver + M3.3's mirror pins coexist and both pass).
- **Commit B — `0b1ebf5` (cherry-picked as `d3c250e`):** lethal checks
  precede gravity portal state mutation. Conflicts in
  `src/game/GameSimulation.ts` + `ARCHITECTURE.md` §7 were exactly the
  anticipated overlap: M4 had already implemented the invariant (lethal
  checks precede ALL portal AND interaction mutations). Semantic resolution
  (never ours/theirs): kept M4's extended step order (which subsumes B's
  contract) and merged B's explanatory wording — a killing step leaves
  `gravityMode`/`portalTransitionCount`/`lastPortalId` at pre-step values;
  portal crossing detection is order-independent (reads only
  `prevPosition`/`position`). B's two new same-step precedence tests
  (`tests/gravity.test.ts`) merged clean and pass.
- M4 branch ancestry now contains M3.3 Commit A → Commit B → M4 work in
  auditable order; no shared commit rewritten, no force push.

Post-integration validation: `npm run verify` green (123/123 = 94 baseline
+ 25 M4 + 4 M3.3); full browser QA 101/101 (M4 section + M3.3 section
coexisting; M3.3 live free-face parity ratio measured 1.000 on the merged
build).
