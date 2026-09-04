# ARCHITECTURE.md — Actual System Boundaries and Invariants

> Authority for **technical structure**. Documents the code as it IS. When code
> changes an architectural fact, update this file in the same commit
> (`AGENTS.md` §10).

## 1. Dependency direction

```text
main.ts → Game (composition root)
  Game → InputSystem → GameSimulation → { CubeController, CollisionWorld, LevelRuntime }
  Game → ReplayCoordinator → GameSimulation (M5: recording/playback orchestration ABOVE the sim)
  Game → RendererHost → { LevelView, PlayerView, EnvironmentView, DebugView, ChaseCamera }
  Game → Hud, DebugOverlay
```

Hard boundary: **simulation never imports Three.js, DOM, or CSS.**
Verified: only `src/rendering/*` and `src/debug/DebugView.ts` import `three`.
Rendering observes simulation state; it never writes gameplay state.
Replay authority boundary (M5): **`GameSimulation` never imports replay
code and contains no replay branch** — the coordinator feeds it inputs
indistinguishable from keyboard input and reads back state for hashing.

## 2. Fixed-step loop (`src/core/`)

- `constants.ts`: `SIMULATION_HZ = 120`, `SIMULATION_DT = 1/120`,
  `MAX_FRAME_DELTA_MS = 250`, `MAX_CATCHUP_STEPS_PER_FRAME = 8`.
- `FixedStepLoop`: accumulator, per-frame delta clamp, at-most-N catch-up
  steps, remainder discard (spiral-of-death guard), exactly one render per
  frame with interpolation alpha = accumulator/step ∈ [0,1).
- The cap (8) deliberately exceeds the nominal 30 FPS need (4 steps) so FP
  jitter in frame deltas can never push carried time into the discard guard
  (see cadence-test history in `tests/fixedStep.test.ts`).
- Render framerate must not change jump height, landing timing, forward
  distance, lane motion, or collision results (cadence tests enforce this).

## 3. Input (`src/input/InputSystem.ts`)

Owns raw keyboard → PHYSICAL actions (`space`, `up`, `down`, `laneLeft`,
`laneRight`) with per-step immutable `PhysicalInputSnapshot` edges
(`held` / `pressedThisStep` / `releasedThisStep`; OS auto-repeat ignored).
The DOM layer is gravity-agnostic: one key maps to one physical action.
Gravity-relative interpretation happens INSIDE the simulation
(`interpretPhysicalInput(physical, mode)` — pure, deterministic):
Floor `jump = Space ∪ ArrowUp`, `fastFall = ArrowDown`; Ceiling
`jump = Space ∪ ArrowDown`, `fastFall = ArrowUp`. Merge semantics match the
historical ArrowUp+Space merge. Tests build physical snapshots directly — no
browser needed. `Game` owns separate non-gameplay keys (`R` restart, `P`
pause, `F1/F2/F3` debug) — a distinct domain from gameplay input.

## 4. Player (`src/player/`)

- `playerState.ts`: `PlayerState` — center position, velocity, `grounded`,
  `targetLaneIndex` (INTENT, not position), `laneCount`, `gravityMode`,
  `supportColliderId`. Single velocity representation. `GravityMode` is
  `'floor' | 'ceiling'` (wall modes are future work; no code may assume them).
  The authoritative value lives on `GameSimulation`; `player.gravityMode` is a
  read-only mirror for observers.
- `gameplayFrame.ts`: `GameplayFrame` — explicit `forwardAxis`,
  `gravityVector`, `surfaceNormal`, `laneAxis` data. Prebuilt `floor()` and
  `ceiling()` frames exist (M3); future modes change FRAME DATA, not
  controller code. `laneAxis` is explicit, never derived from a cross product
  (no control mirroring on ceiling/walls). M1.1 convention: increasing lane
  index runs toward screen-right, so the Floor AND Ceiling laneAxis is −X (the
  +Z chase camera shows −X on the right).
- `CubeController`: owns Cube movement policy. Per step: lane intent
  (**edge-triggered only, unclamped since M1.2** — one tap = one lane change;
  taps past the outer lane address virtual lanes via `laneCenterForIndex`
  linear extrapolation, so side exit is possible where support runs out),
  lateral kinematics
  (accelerate/cruise/analytic-brake/settle-snap, hard geometric no-overshoot
  cap), vertical kinematics (gravity + fast-fall + terminal speed, all along
  the frame's `gravityVector`), jump (grounded AND held → deterministic
  impulse replacing the along-gravity component — already gravity-relative),
  constant forward speed along `forwardAxis`. Computes velocities only — never
  moves positions (integration + collision belong to the simulation). The
  frame arrives PER STEP via the step context from the simulation's
  authoritative gravity mode; the controller's own frame is only a fallback
  for direct construction.
- `cubeTuning.ts`: ALL gameplay magic numbers live here (see `GAME_DESIGN.md`
  §2 for values). Tune by playing, not by theory. NOTE (M4): forward speed is
  NOT tuning — the level's `baseForwardSpeed` × the simulation's speed
  multiplier is the single authority, delivered per step as
  `CubeControllerStepContext.forwardSpeed` (the old duplicate
  `CUBE_TUNING.baseForwardSpeed` was removed).

## 5. Collision (`src/collision/`)

- `collider.ts`: explicit gameplay collider categories (`solid`, `hazard`,
  `killFront`); exact single-axis swept query (`sweepAxis`, Minkowski-slab,
  deterministic, no iteration). Visual geometry is NEVER the collider.
- `CollisionWorld`: spatial-hash (X/Z) broadphase, level-load registration,
  caller-owned output arrays for queries.
- `moveAabb.ts`: axis-separated swept movement in Y → Z → X order; per-step
  `MoveResult` (floor/ceiling/wall contacts — named for the WORLD direction of
  the block, the simulation interprets them against gravity) plus the
  post-Y/post-Z clip positions that record the authoritative swept path for
  hazard tests; `probeGroundSupport` for stable grounded state at zero
  vertical velocity, probing ALONG the gravity direction (below the box on
  Floor, above it on Ceiling — identical contact skin, footprint and teeter
  semantics). The probe tests the full support footprint (minus a 0.02 skin):
  partial overlap still grounds (edge teeter), only full exit ungrounds →
  airborne → gravity → void bounds. No tunneling at high speed (tested incl.
  4× forward speed vs thin walls).
- Blocking kinds are `solid` AND `killFront` (identical clipping + support;
  `hazard` never blocks). The frontal-kill DECISION lives in `GameSimulation`
  (dot(contactNormal, forwardAxis) opposing forward + dot(preImpactVelocity,
  forwardAxis) approach — reduces exactly to the M2 Floor comparisons at
  forward +Z), never in kind checks — side/top contacts on either kind block
  or ground safely on both surfaces.
- Determinism: per axis the strictly smallest TOI wins; ties keep the first
  candidate in `CollisionWorld` query order (cell-index, then level insertion
  order) — deterministic per level, pinned by run-it-twice tests.
- No general physics engine, no ECS (permanent constraint unless justified).

## 6. Level (`src/level/`, `src/content/levels/`)

- `levelDefinition.ts`: declarative `LevelDefinition` (id, display name,
  start, `startGravityMode` (default floor), `startLaneIndex`, `laneCenters`,
  speeds, `finishZ`, `deathY` (lower void), `deathYMax` (optional upper void),
  `startGravityMode`, `gravityPortals` (id + crossing Z + target mode),
  `speedPortals` (id + crossing Z + multiplier tier), `jumpPads`
  (trigger volume + mount surface + explicit impulse), `jumpOrbs` /
  `gravityOrbs` (activation window AABBs, orbs add an impulse),
  solids, hazards, theme). Engine code must not hardcode level coordinates,
  void heights, or gravity/interaction content.
- `levelRuntime.ts`: `loadLevel` builds the `CollisionWorld` (pure, no THREE)
  and the Z-sorted portal lists; `computeProgress` derives [0,1] progress
  from real forward distance. `LoadedLevel` also exposes the indexed
  interaction lists (`jumpPads`, `jumpOrbs`, `gravityOrbs`, Z-sorted
  `speedPortals`) that `GameSimulation` processes.
- `testLevel01.ts`: controller test track (gaps ≤ 6.5 u, steps ≤ 1.7 u per
  jump limits; forced lane-change wall; spike weave; void gaps; finish gate)
  plus the appended M3 gravity section (z 176..278: Floor → portal up →
  ceiling run → ceiling gap → portal down → Floor) and the M4 interaction
  section (z 278..386: jump pad over a 10 u gap, jump orb over a second gap,
  gravity orb → ceiling slab → portal down → 2× speed portal → finish at
  380) — data-driven demo content, not the final production level.
- `levelRegistry.ts` (M5): id → `LevelDefinition` catalog
  (`registeredLevelIds`, `getLevel`, `resolveLevel`). Missing id selects the
  default (`controller-test-01`); an unknown id falls back EXPLICITLY with a
  logged reason (never silent substitution). `main.ts` selects content via
  `?level=<id>`. Adding a level = one data file + one registry entry + zero
  engine changes.
- `validationLevel02.ts` (M5, `validation-02`): the second-level
  architecture proof — different start lane (0), slower base speed
  (11 u/s), spike weave over all three safe lanes, plain gap, portal UP,
  ceiling pad (impulse 20) over a 7.5 u ceiling gap a plain jump cannot
  cross, ceiling gap jump, gravity orb back down, 2× portal into an 11 u
  gap a 1× jump cannot cross, final weave, finish at z=258 (~19.5 s).
  Runs on the unmodified `GameSimulation`; scripted real-input playthrough
  finishes at tick 2346 (`tests/helpers/level02Script.ts`).

## 7. Simulation (`src/game/`)

- `GameSimulation`: headless orchestration per fixed step — controller →
  integrate+collide → frontal kill → grounding → lethal checks (void bounds,
  hazard CCD) → jump pads → jump orbs → gravity orbs → speed portals →
  gravity portals → finish. Owns the AUTHORITATIVE gravity mode
  (`gravityMode`, reset to the level start mode by `respawn()`) and the
  AUTHORITATIVE speed state (`speedMultiplier`: the per-step forward speed is
  `def.baseForwardSpeed × speedMultiplier`, passed to the controller as
  `context.forwardSpeed`; reset to `startSpeedMultiplier` by `respawn()`),
  the prebuilt per-mode `gameplayFrame`, and the input interpretation.
  Step order (authoritative, M4): the LETHAL CHECKS precede ALL portal and
  interaction mutations — a lethal step terminates before any pad, orb, or
  portal can rescue, mutate, or re-tag it (M3.3 invariant extended to M4:
  `gravityMode`, `portalTransitionCount` and `lastPortalId` stay at their
  pre-step values on a killing step; portal/interaction crossing detection
  is order-independent — it reads only `prevPosition`/`position`).
  Death at any earlier point wins the step. Owns `prevPosition` (also the
  portal/interaction forward-crossing reference) for render interpolation,
  `status` (`running`/`dead`/`finished`), `attempts`, `elapsedSimTime`,
  36-tick `deathHoldTicksLeft` (0.30 s) with integer-tick authority. Single
  `die()`/`respawn()`/`restart()` paths (`restart()` converges to one
  `respawn()` from any status); `die(cause)` is idempotent with `deathCause`
  (`hazard` | `frontImpact` | `void`), stable `lastDeathCause`/
  `lastDeathLethalId` records, `deathPosition`, `deathId` counter (VFX edge),
  lethal id, contact normal, pre-impact velocity. Emits
  `onDeath`/`onFinish`/`onJump`. Hazard kills use EXACT swept-path CCD:
  a hazard must overlap one of the three single-axis swept segment volumes of
  the authoritative Y → Z → X path (prev → afterY → afterZ → final, including
  solid clipping), via `sweptPathOverlaps`/`sweptSegmentAabb` in `collider.ts`
  — the loose pre/post union broadphase box remains only as a superset. No
  thin-hazard skipping at speed, no false kills in never-visited corners.
  **Gravity portals (M3):** deterministic forward-crossing on the swept step
  path (`prevZ < portal.z ≤ currentZ`), processed in ascending Z order (the
  furthest crossed portal wins). Transitions go through the ONE shared
  `applyGravityTransition(target)` path (also used by M4 gravity orbs): flip
  the authoritative mode, clear grounded/support, preserve world position and
  ALL velocity components (no teleport, no impulse, no snap). Crossing a
  plane whose target equals the current mode is a no-op. Debug/QA surface:
  `lastPortalId` (reset per attempt) + monotonic `portalTransitionCount`.
  Debug-only `debugPlaceAt(x,y,z)` exists for browser QA placement (same
  category as the renderer's debug aids; never called by gameplay).
  **M4 interactions:** activation volumes are tested with the SAME exact
  swept-path primitive as hazard CCD (`sweptWindowOverlap`), so no pad/orb
  window can be skipped at any per-step displacement. Pads are passive
  (contact fires them; velocity along the pad surface normal is REPLACED by
  the pad impulse). Orbs require a press EDGE of the logical jump action
  during a step whose swept path overlaps the window (no buffer; held input
  without a new edge is inert; jump orbs replace the along-surface-normal
  velocity with their impulse; gravity orbs call the shared gravity
  transition). Speed portals are forward-crossing planes that set the
  authoritative `speedMultiplier` (ascending Z, furthest wins). Lifecycle:
  one-shot per interaction id per attempt (`usedInteractions` set, cleared by
  `respawn()`). Observability: monotonic `interactionEventCount` +
  `lastInteraction {kind,id,position}` (VFX edge), per-kind counters
  (`padActivationCount`, `orbActivationCount`, `speedPortalCount`),
  `isInteractionUsed(id)`, `lastSpeedPortalId`/`lastInteractionId` (reset per
  attempt).
- `Game`: composition root only (input → sim → renderer → UI). No gameplay
  logic. Owns pause, FPS EMA, debug toggles. M5 replay wiring (still no
  gameplay logic): owns the `ReplayCoordinator` and drives the per-tick
  protocol (`beforeSimTick` → `getInputForTick(liveSample)` →
  `sim.update(fed)` → `afterSimTick`); `input.sample()` is ALWAYS consumed
  so live edges can never leak across a replay. Owns the non-gameplay keys
  `R` (abort playback / discard partial tape + restart) and `F4` (replay
  the last completed attempt), and pushes the coordinator badge to the HUD
  every frame.

## 7.1 Replay (`src/replay/`, M5)

Recording + playback orchestration living ENTIRELY ABOVE `GameSimulation`
(conceptual flow in this file's §1). One replay = one attempt = one
fixed-tick PHYSICAL input tape plus verification evidence.

- `replayInputCodec.ts`: one compact integer per tick (bit
  `actionIndex*3 + edgeIndex` over 5 physical actions × held/pressed/
  released; frames ∈ [0, 32767]). Exact round-trip; malformed frames throw.
- `hash.ts`: deterministic FNV-1a dual-state digest (16 hex chars) over
  exact IEEE-754 Float64 bytes in fixed big-endian order through a reused
  module scratch; length-prefixed strings. Verification hash, never
  `.toFixed()`, never timestamps.
- `levelFingerprint.ts`: canonical gameplay-content hash (id, start, lanes,
  speeds, finish/void bounds, start gravity, all portals/pads/orbs,
  solids, hazards; definition order is authoritative). Renderer-only
  `displayName`/`theme`/hazard-`visual` excluded, so restyling keeps old
  replays compatible.
- `stateFingerprint.ts`: per-tick authoritative-state hash (status,
  deathCause, player position/velocity, grounded, lane intent/count,
  support id, gravity mode, speed multiplier, elapsed time, death-hold
  ticks, used-interaction bits in level order). Session/debug-only records
  excluded with documented reason (attempts, prevPosition, portal/debug ids,
  counters, death anchors, derived progress).
- `replayFormat.ts`: versioned `ReplayV1` container (`schemaVersion` 1,
  `rulesetVersion` 1 — a deliberate compatibility constant, never
  auto-derived — `simulationHz`, `levelId`, `levelFingerprint`,
  `frameCount`, `inputFrames`, per-tick `stateHashes`, `outcome`,
  `finalStateHash` == last per-tick hash). JSON serialize/parse with
  structural validation; malformed input rejected with a reason. No render
  data in the container (pinned key list).
- `ReplayCoordinator.ts`: mode (`live`|`replay`), in-progress recording
  (one frame BEFORE + one hash AFTER each update; finalizes on the first
  dead/finished tick; dead-hold/respawn ticks excluded), active playback
  playhead (one recorded frame per tick, hash compared after every update,
  FIRST mismatch stops with `{tick, expectedHash, actualHash}` — never
  corrected/snapped/continued), `lastReplay` (most recent COMPLETED
  attempt; playback never writes it), verification state
  (`idle|running|pass|diverged|rejected`), compatibility rejection (schema
  → ruleset → level id → fingerprint, before the sim is touched).
  Starting or aborting playback discards any partial live recording, so a
  stale partial can never finalize into a hybrid tape (regression-pinned).
  `hudBadge`, `exportLastReplay`, tick/frame observability.

## 8. Presentation (`src/camera/`, `src/rendering/`, `src/ui/`, `src/debug/`)

- `ChaseCamera` (pure math): track-centered + tiny damped bias (max 0.55 u,
  factor 0.12), follow 8.5 / look-ahead 10 / FOV 62, no roll, render-dt
  smoothing only. Gravity-aware VERTICAL framing (M3.1): an explicit
  `CameraFocusSide` (`'aboveFocus' | 'belowFocus'`) selects the height
  formula — Floor: `playerY * 0.35 + 4.2` (elevated, unchanged); Ceiling:
  `playerY * 0.35 - 0.3`. **Surface-relative projection symmetry (M3.3):**
  the below-focus line is the EXACT mirror of the above-focus line about the
  corridor mid-plane (shared `verticalParallax` 0.35; reflected anchor
  `belowFocusAnchor` −0.3; look bias +0.6 above / −0.6 below with the focus
  side), so the Cube's FREE face (the face on the `surfaceNormal` side,
  opposite support — top on Floor, bottom on Ceiling) projects with
  identical apparent size/perspective on every gravity surface (measured
  0.219 pre-fix → 1.000 post-fix; pinned 0.98..1.02 in
  `tests/cameraFraming.test.ts`, acceptance 0.90..1.10). The ceiling eye
  hangs mid-corridor BELOW the cube (rest y ≈ 1.61 vs cube 5.45, ≈4.4 u
  clear of the slab) and can never be pulled up into the slab the player
  runs under — the pre-M3.1 gravity-blind formula put the eye at y ≈ 6.11,
  INSIDE the slabs (proven: 343 penetrating steps, worst 0.157 u;
  backface culling then hid the ceiling, which read as the cube floating).
  `RendererHost` maps the sim's authoritative gravity mode to the focus side
  (presentation-only read; respawn `snapTo` included). Eye non-penetration
  across the real full-level playthrough is pinned by
  `tests/cameraFraming.test.ts` (level-data-aware auditor; the camera itself
  still never reads level data).
- `RendererHost`: SOLE owner of `WebGLRenderer`. Per frame interpolates
  visuals between `prevPosition`→`position` (gameplay never interpolates),
  advances camera, exposes `renderer.info` stats. DPR capped at 1.5. QA probe
  support: `projectToScreen(x,y,z)` (live-camera world→NDC/pixel projection;
  observability only, cold path).
- `PlayerView`: original procedural cyan cube (visual 1.24 vs collider 1.1);
  airtime tumble is render-only and snaps to rest on landing — rest
  orientation aligns to the surface normal (180° Z roll presentation on
  Ceiling; the CAMERA never rolls and the collider never rotates). Collider
  and mesh are independent by construction (debug F3 visualizes the real
  hitbox). Visibility follows sim status (hidden while dead), applied in
  `RendererHost` so debug frame-freezes capture true death frames.
- `LevelView` builds the M3 gravity portal visuals from level data (shared
  unit box geometry, ONE shared material per direction — cyan up / warm down;
  translucent pane + neon frame, zero per-frame work). Portal triggering is
  simulation-only; the visuals are pure presentation.
- `InteractionView` (M4, owned by `RendererHost`): builds pad/orb/speed-portal
  visuals from level data (shared box/sphere/torus/cone geometries, shared
  live materials, per-portal tier materials) plus the activation VFX — a
  pooled ring set (8 rings, materials allocated once) edge-detected from the
  simulation's `interactionEventCount` (pure presentation read; VFX never
  drives gameplay). Used interactions dim via `isInteractionUsed` polling;
  orbs idle-bob (render-side only). Original palette language: yellow family
  = jump impulse (pads + jump orbs), blue = gravity orb, one color +
  chevron count per speed tier.
- `DeathBurstView` (M2, owned by `RendererHost`): 14 pooled fragments, shared
  geometry + 2 shared materials, deterministic radial burst, 0.35 s lifetime,
  shrink-out; zero allocation post-construction; triggered by `deathId` edge.
  Death kick (FOV +3.5, +0.25 u lift, ~0.12 s decay, no roll/shake) + camera
  snap-to-start on respawn/teleport also live in `RendererHost`.
  Debug-only `debugFreezeFrame` (skip visual updates, keep presenting) +
  `debugReplayBurst` (re-fire at recorded death pos) exist SOLELY for
  photographing the 0.35 s effect under headless screenshot latency.
- `DeathSfx` (`src/audio/`, M2): lazy guarded Web Audio death blip (0.18 s),
  created on first user gesture; silence-on-failure; gameplay never depends
  on it.
- `LevelView` (shared geometries/materials; M1.1/M1.2 face applique — thin
  unlit trims in the shared edge material riding PROUD of solid faces:
  outboard corner posts, front-face bottom strips (gap faces read as framed
  portals), center seams on faces ≥ 6 wide; M3.1 underside inset — a dim
  UNLIT panel (`PALETTE.platformUnder`) riding proud of each tall solid's
  bottom face so the CEILING run surface reads from the corridor (down-facing
  Lambert gets only the near-black hemisphere ground light; invisible on
  floor content where bottom faces are buried or void-facing); M3.2 underside
  RAILS — exposed undersides (bottom face ≥ world y 2, i.e. ceiling run
  surfaces) mirror the top-edge neon rail treatment below the face (2
  longitudinal + 2 across rails, shared edge material), so the ceiling
  corridor reads with the same converging neon language as the floor;
  ground-resting/buried bottoms stay rail-free (rails would poke through host
  solids or never be seen — pinned by `tests/undersideRails.test.ts`;
  evidence: the M3.2 audit measured that the below-focus camera makes the
  Cube silhouette occlude the ceiling surface ~4..16 u ahead, so the lateral
  underside edges are the only viable forward cue); solids < 0.8
  tall and all hazards untouched — no new systems), `EnvironmentView` (fog,
  deterministic starfield/pillars — seeded PRNG, visuals only), finish gate.
- `Hud`: level name, real progress %, attempt count, key help, messages.
  M5 adds the minimal replay badge (`REPLAY` / `REPLAY VERIFIED` /
  `REPLAY DIVERGED` / `REPLAY REJECTED`, hidden otherwise) driven by `Game`
  from `ReplayCoordinator.hudBadge`, plus the F4 hint in the help line.
- `DebugOverlay` (F1 text stats, incl. the live gravity frame (mode,
  gravityVector, surfaceNormal, laneAxis), support id, last portal id +
  transition count, and the latched last-death record:
  cause/lethal/hold/contact-normal/pre-impact-velocity) + `DebugView` (F2
  collider wireframes, F3 player hitbox). `__gd3d` probes expose death cause,
  lethal info, gravity mode/portal state, support id, speed multiplier +
  current forward speed + interaction counters/used-state (M4), camera
  up/eye/look, live-camera world→screen projection (`screenPoint`), renderer
  stats, scene-child count, burst state, and the debug-only
  `debugTeleport` placement aid for browser QA. M5 adds:
  `levelId`/`levelDisplayName`, `hasReplay`, `replayMode`, `replayTick`,
  `replayFrameCount`, `replayVerification` (kind + tick/reason),
  `replayLevelId`, `replayLevelFingerprint`, `replayBadge`,
  `replayLastHash`, `startReplay` (the F4 path), `exportLastReplay`, and the
  QA-only `debugStartReplayJson` (arbitrary-tape injection for the
  cross-level rejection proof). The F1 overlay carries two replay lines
  (mode/tick/frames/verification + level/hash/frequency).

## 9. QA (`tests/`, `scripts/`, `qa/`)

- Unit/integration: `fixedStep` (timestep, cadence invariance on INTEGER step
  counts, clamp, spiral guard, alpha range), `controller` (determinism, jump,
  repeat-jump, fast-fall, lanes, air lanes), `collision` (grounding,
  penetration, frontal kill, anti-tunneling, void death, data-driven loading),
  `death` (M2: frontal/side/top killFront semantics, causes, exactly-once
  + idempotent death, 36-tick hold, attempt accounting, R semantics, freeze
  + full reset, finish-after-death, determinism, spike fairness pins),
  `hazardCcd` (M2.1 exact swept-path hazard CCD), `floorCompat` (M3 golden
  gate: exact-float Floor trajectories captured from the pre-refactor build),
  `gravity` (M3: frame data, portals, ceiling support/jump/fast-fall/lanes,
  void bounds, precedence, determinism, full Test-Level gravity-section
  playthrough to finish), `cameraFraming` (M3.1: ceiling rest frames from
  below the focus; the camera eye — stepped per sim tick alongside the REAL
  playthrough with the RendererHost framing — never enters any blocking
  collider; proven failing pre-fix, 343 penetrating samples / worst 0.157 u;
  M3.2: floor/ceiling framing-parity bounds — eye-to-player distance ratio
  and centered-player NDC on both surfaces), `undersideRails` (M3.2
  presentation geometry: elevated ceiling run surfaces carry 4 underside
  rails incl. 2 longitudinal; ground-resting/buried bottoms none; M3.1
  underside inset pinned). M3.3: exact-mirror rest-frame pins (floor
  unchanged, ceiling reflected) + deterministic free-face projection parity
  (pure-math square-NDC projection, area ratio 0.98..1.02, mirrored player
  NDC).
- `tests/interactions.test.ts` (M4: pads, jump orbs, gravity orbs, speed
  model + portals, trigger ordering, input-window semantics, 4× safety,
  run-twice determinism — 25 tests on compact data-driven fixtures).
- `tests/replay.test.ts` (M5, 29 tests, all through the REAL coordinator +
  REAL simulation): codec round-trips (5 actions × 8 edge combos +
  simultaneous + bounds + malformed rejection), lifecycle (exactly one frame
  per tick, finish/death finalization, R discards partials, playback
  start/abort discards stale partials — incl. fault-proven hybrid-tape
  regressions), determinism (per-tick hashes, double replay, finish/death
  outcomes, gravity/interaction/speed reproduction), divergence (meaningful
  input mutation → same-tick divergence with expected/actual hashes;
  tampered hash → exact-tick failure; lied outcome → divergence;
  final-hash mismatch → structural reject), compatibility (wrong
  schema/ruleset/level-id/fingerprint rejected; serialize round-trip exact;
  empty tape rejected), fingerprints (stable, gameplay-sensitive incl.
  array order, visual-insensitive), render-cadence independence (chunk-1 vs
  chunk-7 identical trajectories; container carries no render data).
- `tests/replayGolden.test.ts` (M5, 2 tests): the committed fixture
  `tests/fixtures/replays/validation-level-02-v1.json` (2346 frames,
  ~83 KB, `_provenance` block) verifies on a fresh sim (frame count
  pinned); a single meaningful mutation (first jump press at tick 651 →
  zeroed) diverges at exactly tick 651 (pinned literal + tape-derived
  index). Fixture NEVER regenerated by tests; manual tool
  `scripts/generate-replay-fixture.ts` (`npx vite-node
  scripts/generate-replay-fixture.ts`) self-checks before writing.
- `tests/level02.test.ts` (M5, 8 tests): registry contract (both levels,
  unique ids, default, explicit unknown-id fallback), Level 02 as distinct
  data-driven content (own identity + different fingerprint), deterministic
  real-input finish with every mechanic exercised, record → replay pass.
- `scripts/m32-audit.mjs`: M3.2 measurement tool (dev tool, not part of the
  verify gate) — freezes deterministic floor/ceiling framings and measures
  geometric parity (eye distance, screen placement, apparent cube size,
  surface-visibility profile) + pixel parity (cube/contact-band luminance)
  into `qa/screenshots/m32-audit-*`.
- `scripts/m33-audit.mjs`: M3.3 measurement tool (dev tool, not part of the
  verify gate) — frozen floor/ceiling rest framings, eye→player offset
  decomposition (support-normal vs longitudinal) and projected FREE-face
  area (shoelace over the live `screenPoint` projections); tagged
  `M33_TAG=before|after` runs preserve the 0.219 → 1.000 parity evidence in
  `qa/screenshots/m33-audit-*-metrics.json`.
- `scripts/browser-qa.mjs`: headless Chromium gameplay harness (Playwright) —
  console audit, input sequences, `window.__gd3d` probes, PNG + JSON
  provenance sidecars in `qa/screenshots/` (git-ignored, regenerable).
  M2 section: wall/spike/void/fall deaths, burst visible + cleared, 10×
  die/respawn leak guard (scene children + draw calls flat), R-from-dead,
  camera reset, F1 death record, `m2-*` screenshots (burst held via the
  freeze/replay debug path after a page reload for compositor freshness).
  M3 section: teleport-assisted passes over the gravity section (debug-only
  `debugTeleport`; the pause key freezes the sim during screenshots so CDP
  latency cannot race the observation): portal crossings (exactly once, no
  teleport, support cleared), rise + ceiling grounding/stability, lane
  convention, ceiling jumps/fast-fall, side fall → upper void → respawn mode,
  R reset, portal down → floor landing → finish, `m3-*` screenshots.
  M3.1 section: live camera-eye sampling through the rise + under-slab transit
  (eye stays in the open corridor, never in the slab band y ≥ 6), floor
  framing unchanged, ceiling eye settles below the cube with clearance, look
  target reads the contact surface, `m31-*` screenshots.
  M3.2 section: screen-space ceiling parity via the `screenPoint` probe —
  underside rails ahead during a stable ceiling run project inside the
  viewport, the lethal gap's lateral edges project beside (not behind) the
  Cube silhouette at gap approach, floor reference framing reached,
  `m32-*` screenshots.
  M3.3 section: surface-relative projection parity via the `screenPoint`
  probe — projected FREE-face area (shoelace over the face opposite support)
  on frozen floor/ceiling reference frames, live ceiling/floor ratio
  0.95..1.05 (measured 1.000), gap approach with the mirrored view,
  `m33-*` screenshots.
  M4 section: teleport-assisted passes over the interaction section — pad
  activation exactly once + apex + gap crossing + re-arm on R, orb no-press
  pass-through vs press activation + pooled-ring VFX observation, gravity
  orb Floor→Ceiling grounding + portal-down return, speed portal 2× tier +
  live forward-rate peak + R reset, 2× sprint through the finish gate,
  3-pass leak guard (scene children flat, exactly one pad activation per
  attempt), `m4-*` screenshots.
  M5 section (16 checks, `m5-*` screenshots): fresh page, then — default
  level loads; live death finalizes into an available versioned input tape
  (no transforms); F4 starts playback with the REPLAY badge; keyboard input
  injected mid-playback does not deflect the tape (tick-advance + final
  pass); death replay reproduces death with matching frame count (end
  state observed atomically with the pass — the 36-tick hold expires fast);
  REPLAY VERIFIED badge; F1 replay lines; R resumes live play;
  `?level=validation-02` loads with HUD confirmation; in-page real-DOM-input
  playthrough finishes with no teleport (CDP round-trips exceed the
  tightest takeoff windows, so the scripted policy drives real
  KeyboardEvents through the real `InputSystem`; CDP observes); completion
  records a level-02 tape; level-02 replay verifies end-to-end (finish);
  the level-01 tape on level 02 is explicitly rejected; unknown level ids
  fall back to default.
- Gate: `npm run verify` = typecheck + lint + tests + build. Full:
  `npm run verify:full` adds browser QA (needs `npm run dev` + browsers).

## 10. Invariant matrix

| Invariant | Enforcement |
|---|---|
| 120 Hz fixed gameplay; render FPS never changes sim results | `fixedStep` cadence tests (integer step counts) |
| Simulation imports no Three.js/DOM | Architecture rule + import inspection (§1) |
| Levels data-driven; no level coordinates in engine | `levelDefinition`/`levelRuntime` + data-driven tests |
| Collider independent of visual mesh/rotation | Architecture + F3 debug visualization |
| Lane intent ≠ position; position continuous, collides | `CubeController` + lane tests |
| Input preserves held/pressed/released edges; DOM layer gravity-agnostic | `InputSystem` + controller edge tests + `interpretPhysicalInput` tests |
| Gravity mode authoritative on the simulation; world never rotates; camera never rolls | `gravity` tests + browser QA camera-up check |
| Floor behavior bit-identical to the approved pre-M3 build | `floorCompat` golden gate (exact-float trajectories) |
| Camera not parented; lateral bias bounded | `ChaseCamera` tuning + code review |
| Camera eye never inside blocking geometry (either gravity surface) | `cameraFraming` regression (real-playthrough eye sweep) + browser QA m3.1 live eye sampling |
| Floor/ceiling view parity: comparable eye distance + centered player; ceiling run surfaces carry floor-parity underside rails | `cameraFraming` M3.2 parity bounds + `undersideRails` regression + browser QA m3.2 screen-space checks |
| Surface-relative projection symmetry: the FREE face (opposite support) projects identically on every gravity surface; floor framing unchanged | `cameraFraming` M3.3 exact-mirror + free-face area parity tests + `m33-audit.mjs` before/after metrics + browser QA m3.3 live parity check |
| Swept collision, no tunneling at speed | `collision` anti-tunneling tests |
| Frontal kills, lateral/top contacts safe (either blocking kind, either surface) | `death` killFront semantics tests + `gravity` tests + browser QA |
| Death exactly-once; attempts +1 per respawn/restart only | `death` event/attempt tests |
| 36-tick death hold; respawn fully resets (incl. gravity mode) | `death` tick + reset tests + `gravity` tests |
| Gravity portals: exactly once per attempt, no teleport, support cleared, death wins the step | `gravity` portal/precedence tests + browser QA |
| Lethal checks precede ALL portal + interaction mutations (M3.3 invariant, extended in M4) | `interactions` ordering tests + `gravity` precedence tests |
| M4 interactions: swept-window detection (no skip at speed), press-edge orbs (no buffer, held-inert), one-shot per attempt, respawn re-arms | `interactions` tests + browser QA m4 section |
| Replay records physical fixed-tick input only; playback feeds the real sim; sim stays replay-agnostic | `replay` lifecycle/determinism tests + `Game` protocol review (no sim import of replay code) |
| Same level + same initial state + same input tape reproduces the run tick-for-tick; first divergence stops and reports | `replay` determinism/divergence tests + golden fixture (load-and-verify + negative proof) |
| Replays are bound to exact gameplay content; renderer-only changes keep compatibility | `replay` fingerprint tests (gameplay-sensitive, visual-insensitive) + compatibility rejection tests |
| Old tapes never silently run after intentional gameplay changes | `REPLAY_RULESET_VERSION` discipline + ruleset rejection test + manual fixture regen procedure (M5 spec) |
| One replay = one attempt; partials never finalize; playbacks never contaminate tapes | `replay` lifecycle tests incl. fault-proven hybrid-tape regressions |
| Engine is level-agnostic: Level 02 runs with zero engine changes and finishes via real inputs | `level02` tests (distinct content, scripted finish, record→replay) + browser QA m5 section |
| ONE speed authority: level baseForwardSpeed × sim multiplier; 1× bit-identical; R/death reset | `interactions` speed tests + `floorCompat` golden gate |
| Reference PNGs never runtime assets | Repo/runtime search + visual review |
| No milestone passes with failing verification | `npm run verify` + `AGENTS.md` process rule |

## 11. Known non-defects / deferred perf notes

- `CollisionWorld.queryBox` allocates a small dedupe `Set` per call and the
  support probe allocates a candidate array per step — acceptable at M1 scale;
  revisit in the M6 performance pass, not before.
- M2.1 swept-path hazard CCD keeps the hot loop allocation-neutral: the three
  segment envelope boxes live in a reused scratch (`SweptPathScratch`), the
  post-clip positions ride the reused `MoveResult`, and the loose union
  broadphase box is a per-step stack literal as before.
- M5 replay recording adds one small integer + one 16-char hash string per
  fixed tick; hashing runs over a reused module scratch (no per-tick buffer
  allocation). Representative cost: 2346-frame Level 02 tape ≈ 83 KB JSON
  (~35 bytes/frame; the input tape itself ≈ 2.3 KB, hashes dominate); the
  replay suite runs ~20 full record+replay cycles headless in well under a
  second. No compression (unnecessary at this scale); revisit in the M6
  performance pass only if tapes grow orders of magnitude.
