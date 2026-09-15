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
`jump = Space ∪ ArrowDown`, `fastFall = ArrowUp`. M8B walls: the lane axis
is vertical, so `laneLeft/laneRight = Down/Up` (Up increments on BOTH
walls) while the horizontal arrows work the support — Left wall:
`jump = Space ∪ ArrowRight`, `fastFall = ArrowLeft`; Right wall mirrored.
Merge semantics match the historical ArrowUp+Space merge. Tests build
physical snapshots directly — no browser needed. `Game` owns separate non-gameplay keys (`R` restart, `P`
pause, `F1/F2/F3` debug) — a distinct domain from gameplay input.

## 4. Player (`src/player/`)

- `playerState.ts`: `PlayerState` — center position, velocity, `grounded`,
  `targetLaneIndex` (INTENT, not position), `laneCount`, `gravityMode`,
  `supportColliderId`. Single velocity representation. `GravityMode` is
  `'floor' | 'ceiling' | 'leftWall' | 'rightWall'` (M8B; walls named by
  support surface — leftWall = support at world +X/screen-left). The
  authoritative value lives on `GameSimulation`; `player.gravityMode` is a
  read-only mirror for observers.
- `gameplayFrame.ts`: `GameplayFrame` — explicit `forwardAxis`,
  `gravityVector`, `surfaceNormal`, `laneAxis` data. Prebuilt `floor()`,
  `ceiling()`, `leftWall()` and `rightWall()` frames exist (M8B adds wall
  DATA, not controller code). `laneAxis` is explicit, never derived from
  a cross product (no control mirroring on ceiling/walls). M1.1
  convention: increasing lane index runs toward screen-right, so the
  Floor AND Ceiling laneAxis is −X (the +Z chase camera shows −X on the
  right); wall laneAxis is +Y on BOTH walls (increasing index runs UP).
- `laneKinematics.ts` (M8C): the ONE owner of the lane policy —
  edge-triggered intent lives in each controller, but the
  accelerate/cruise/brake/settle kinematics (`stepLaneKinematics` +
  `laneCenterForIndex`) live here and serve Cube, Ship and Spider alike.
- `CubeController`: owns Cube movement policy. Per step: lane intent
  (**edge-triggered only, unclamped since M1.2** — one tap = one lane change;
  taps past the outer lane address virtual lanes via `laneCenterForIndex`
  linear extrapolation, so side exit is possible where support runs out),
  lateral kinematics computed in LANE-AXIS space (M8B: s = position ·
  laneAxis — Floor/Ceiling behavior bit-identical, proven by the
  floorCompat golden gate; walls steer world Y through the same policy),
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
- `ShipController` (M8C): continuous flight — shared lane intent +
  kinematics, gravity always on, primary-held thrust away from the
  support, mode-owned terminal speeds, constant forward speed.
  Frame-generic (all accelerations through frame vectors). Own tuning
  (`shipTuning.ts` — Cube tuning never touched for Ship).
- `SpiderController` (M8C): Cube-like running (shared lane policy,
  gravity + fast-fall + terminal from the frozen `CUBE_TUNING` — same
  world gravity, deliberately) but NEVER jumps; the primary press is
  consumed by the simulation as an opposite-surface snap (the controller
  never touches the CollisionWorld).
- `cubeTuning.ts`: ALL Cube gameplay magic numbers live here (see `GAME_DESIGN.md`
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
  `wallLaneCenters` (M8B, optional Y lanes for walls), speeds, `finishZ`,
  `deathY` (lower void), `deathYMax` (optional upper void), `deathXMin` /
  `deathXMax` (M8B, optional side void bounds), `lava` (M8A lethal
  source/fall/pool volumes — gameplay, fingerprinted), `visualSetpieces`
  (presentation-only — never gameplay, never fingerprinted),
  `startGravityMode`, `gravityPortals` (id + crossing Z + target mode),
  `speedPortals` (id + crossing Z + multiplier tier), `jumpPads`
  (trigger volume + mount surface + explicit impulse), `jumpOrbs` /
  `gravityOrbs` (activation window AABBs, orbs add an impulse),
  `teleportPortals?` (M7.2: id + entry Z + exit + exit lane; `style` is
  presentation-only, never fingerprinted), `visualSetpieces?` (M7.2
  guardian + M7.3 lava: presentation-only decorative kind/center/extents —
  never gameplay, never fingerprinted),
  solids, hazards (each with presentation-only `visual` + `mount`
  floor/ceiling hints — never gameplay, never fingerprinted), theme,
  `visualSequence?` (M6C1), `rhythmCues?` (M7.1 beat-ready markers —
  position-bound semantic roles for future music mapping; no audio ships).
  Engine code must not hardcode level coordinates,
  void heights, or gravity/interaction content.
- `levelRuntime.ts`: `loadLevel` builds the `CollisionWorld` (pure, no THREE)
  and the Z-sorted portal lists; `computeProgress` derives [0,1] progress
  from real forward distance. `LoadedLevel` also exposes the indexed
  interaction lists (`jumpPads`, `jumpOrbs`, `gravityOrbs`, Z-sorted
  `speedPortals`, entryZ-sorted `teleportPortals`) that `GameSimulation`
  processes. M8A lethal lava volumes register as `lava-<id>` hazard-kind
  colliders through the SAME hazard pathway (no second lethal engine;
  the `lava-` prefix tags the `lava` death cause) — see
  `lavaAuthoring.ts` for the sourced/contained authoring contract. M8B
  resolves `wallLaneCenters` (explicit, else the corridor-mid mirror of
  `laneCenters`); the simulation selects X/Y lane data per gravity mode.
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
- `advancedCube01.ts` (M7.2, `advanced-cube-01`, reworked in M7.3): the HARD
  second production Cube level — LOW/MID/HIGH floor bands + ceiling world,
  offset island pairs with mid-air transfers, a full-width maze jump-wall +
  lane walls (`killFront`), tall spikes, fast-fall lintel gate, two paired
  teleport portals (a mid-air lava-hop `ac-teleport-hop` 489 → 513 whose
  rings share one readable frame + the maw jump `ac-teleport-maw` 524 →
  634), presentation-only guardian/beast + lava setpieces, 9-section visual
  arc, 31 rhythm cues; scripted real-input playthrough finishes at tick
  7475 (62.292 s) (`tests/helpers/advancedCube01Script.ts`).
- `validationLevel02.ts` (M5, `validation-02`): the second-level
  architecture proof — different start lane (0), slower base speed
  (11 u/s), spike weave over all three safe lanes, plain gap, portal UP,
  ceiling pad (impulse 20) over a 7.5 u ceiling gap a plain jump cannot
  cross, ceiling gap jump, gravity orb back down, 2× portal into an 11 u
  gap a 1× jump cannot cross, final weave, finish at z=258 (~19.5 s).
  Runs on the unmodified `GameSimulation`; scripted real-input playthrough
  finishes at tick 2346 (`tests/helpers/level02Script.ts`).
- `multimodeGauntlet01.ts` (M8E, `multimode-gauntlet-01`): the multimode
  integration level — lava intro, maze decisions, four-way gravity,
  two-Chomper biome, Ship corridor, Spider snaps, trap islands; scripted
  real-input playthrough finishes at tick 10321 (86.0 s), 0 deaths, replay
  VERIFIED (`tests/helpers/multimodeGauntletScript.ts`).
- `productionShowcase01.ts` (M8.5, `production-showcase-01`, "THE DESCENT"):
  the DEFAULT level — a ~2-minute superproduction arc (forge, islands,
  two-door labyrinth, four-way cathedral, Chomper canyon, Ship reactor
  with a sustained inverted segment, Spider temple with wall snaps,
  teleport-choice void, final gauntlet); scripted real-input playthroughs
  finish at tick 13955 (116.29 s), 0 deaths, replay VERIFIED, on BOTH the
  primary and alternate routes (`tests/helpers/showcaseScript.ts`).

## 7. Simulation (`src/game/`)

- `GameSimulation`: headless orchestration per fixed step — controller →
  integrate+collide → frontal kill → grounding → lethal checks (void bounds,
  hazard CCD, M8D dynamic chompers) → teleport portals → mode portals →
  jump pads → jump orbs → gravity orbs → speed portals →
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
  78-tick `deathHoldTicksLeft` (0.65 s, M8A readability rework) with integer-tick authority. Single
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
- `chomperSystem.ts` (M8D): the ONE owner of the dynamic-Chomper phase
  machine (dormant → telegraph → lunging → spent) — pure fixed-tick
  kinematics shared by the sim and the tests. The SIMULATION owns the
  preallocated state array, activation (player Z), the swept
  Chomper-vs-player lethal test (both sides sweep — no tunneling either
  direction, lethal in EVERY phase under id `chomper-<id>`), and the
  respawn reset. Aim (player X) is captured once at activation and never
  re-homed; the lunge is linear over authored ticks. `ChomperView`
  (owned by `RendererHost`) observes sim states only — M8.3 voxel lava
  chain-chomp anatomy (single mottled magma head-ball + hot-yellow voxel
  mottle, large dark cavity maw on the lunge face, 4 upper + 3 lower
  chunky block teeth, white-hot square eyes + dark pupils, lava-hot
  chain + anchor weight cube, chomp cycle), 26 meshes per Chomper, sim
  byte-identical.
  **Teleport portals (M7.2):** deterministic forward entry-crossing
  (`prevZ < entryZ ≤ currentZ`, furthest unused entry wins), processed
  AFTER the lethal checks (death wins the step) and BEFORE pads/orbs/
  portals/finish. A spatial discontinuity: world position jumps to the
  authored `exit`, `prevPosition` re-anchors there (the skipped interval is
  never traversed — no interval portal fires), gravity mode and speed
  multiplier unchanged, lateral/forward velocity preserved, vertical
  velocity zeroed, lane intent set to `exitLaneIndex`, grounded/support
  cleared. Lifecycle: one-shot per teleport id per attempt
  (`usedTeleports` set, cleared by `respawn()`). Observability: monotonic
  `teleportEventCount` + exit anchor `lastTeleport` (VFX/punch edge),
  `isTeleportUsed(id)`, `lastTeleportId` (reset per attempt).
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
  teleport gameplay (M7.2, conditionally extended — zero bytes when absent,
  so pre-M7.2 fingerprints are byte-identical), solids, hazards; definition
  order is authoritative). Renderer-only `displayName`/`theme`/hazard-
  `visual`+`mount`/teleport-`style`/setpieces/`visualSequence`/`rhythmCues`
  excluded, so restyling keeps old replays compatible.
- `stateFingerprint.ts`: per-tick authoritative-state hash (status,
  deathCause, player position/velocity, grounded, lane intent/count,
  support id, gravity mode, speed multiplier, elapsed time, death-hold
  ticks, used-interaction bits + used-teleport bits in level order).
  Session/debug-only records excluded with documented reason (attempts,
  prevPosition, portal/debug ids, counters, death anchors incl. the
  teleport anchor, derived progress).
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

## 8. Presentation (`src/camera/`, `src/rendering/`, `src/ui/`, `src/debug/`, `src/visuals/`)

- `ChaseCamera` (pure math): track-centered + tiny damped bias (max 0.55 u,
  factor 0.12), follow 8.5 / look-ahead 10 / FOV 62, no roll, render-dt
  smoothing only. Gravity-aware VERTICAL framing (M3.1): an explicit
  `CameraFocusSide` (`'aboveFocus' | 'belowFocus'` + M8B `'freeMinusFocus' |
  'freePlusFocus'`) selects the height formula — Floor: `playerY * 0.35 +
  4.2` (elevated, unchanged); Ceiling: `playerY * 0.35 - 0.3`. M8B walls:
  the eye shifts ±3.4 u toward the free-face side while keeping the
  elevated floor height (side free face + top face readable, never a
  side-on silhouette); `camera.up` stays world +Y on all four surfaces. **Surface-relative projection symmetry (M3.3):**
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
  (presentation-only read; respawn `snapTo` included). M8.3 Spider-swap
  continuity: swaps SKIP the teleport-snap (the swap's ~5 u displacement
  tripped the >5 u cut detector, so the M8.2 glide armed after the cut)
  and `noteSpiderSwap` captures the pre-swap pose; the 0.55 s envelope
  blends it onto the moving desired framing with smootherstep (zero
  velocity at both ends — continuous, never a cut or whip). Teleport
  portals, respawn, and R-teleport still snap. Eye non-penetration
  across the real full-level playthrough is pinned by
  `tests/cameraFraming.test.ts` (level-data-aware auditor; the camera itself
  still never reads level data).
- `RendererHost`: SOLE owner of `WebGLRenderer`. Resolves the production
  theme (`resolveProductionTheme`, renderer-owned with a per-level route
  overlay) and owns the shared `MaterialLibrary` (sole material/geometry
  owner — views create Meshes only, never allocate per-frame, dispose
  nothing) plus the `PostPipeline` (RenderPass → UnrealBloomPass →
  OutputPass, theme-parameterized, resize-safe, disposable, with a
  direct-render fallback via `?post=off` / `setPostEnabled`). Centralized
  renderer config (ACES tone mapping, exposure 1.15, sRGB, DPR cap 1.5) +
  minimum lighting (one hemisphere + one directional, theme values — no
  point lights). Manual `renderer.info` accounting per frame (honest
  scene + post cost). Per frame interpolates
  visuals between `prevPosition`→`position` (gameplay never interpolates),
  advances camera, exposes `renderer.info` stats. M6D hot-loop hygiene:
  bloom staging reused + change-guarded (no per-frame literal), exactly
  one projection-matrix update per presented frame (in `render()`), one
  `dimmables` traversal per frame — all behavior-preserving. QA probe
  support: `projectToScreen(x,y,z)` (live-camera world→NDC/pixel projection;
  observability only, cold path) + `materialCount` / `geometryCount` /
  `postEnabled` / `postPassCount` / `bloomParams`.
- `productionTheme.ts` (`src/visuals/`, M6A): ONE owner for all visual tuning
  (palette hierarchy, material response, fog, lights, exposure,
  bloom 0.45/0.5/0.8 under BLOOM_CONTRACT, DPR cap). Renderer-only: the
  level fingerprint never reads it (replay-compatible restyling, pinned).
  `LevelDefinition.theme` (previously written but never read) is now the
  per-level route overlay — same code path for every level, no engine
  special-case. M6B adds the `fx` block in the SAME authority (trail/burst/
  streak counts, lifetimes, speeds, sizes, colors — presentation only,
  clamped by `validateProductionTheme`; the M6A provisional values above
  are untouched by it). M6D hazard-semantic contract: the overlay flows
  route/environment identity ONLY — hazards resolve to the single global
  warm `GLOBAL_HAZARD_COLOR` on every level (`LevelTheme.hazard` stays on
  the type for data compatibility but is renderer-inert, pinned by
  `visualFoundation` cross-level resolution tests).
- `visualTimeline.ts` (`src/visuals/`, M6C1) — the ONE renderer-side
  owner computing CURRENT VISUAL STATE = base theme + current section +
  transition interpolation. Position-driven only (active = last section
  with `startZ <= playerZ`; `endZ` documents intent + drives section
  progress); pure function of (base, prepared sequence, z) into
  caller-owned scratch — no accumulation, no drift. Sparse overrides
  inherit the previous section's resolved value, else base; everything
  clamped at resolve (bloom ⇒ BLOOM_CONTRACT, exposure 0.5..2,
  intensities 0..2). THREE-free (hex RGB lerp). No player/hazard fields
  by construction. `resetVisualState` restores the exact base through the
  same path (triggers-off === base structurally).
- `LevelDefinition.visualSequence?` (M6C1 data, Pattern B): optional
  presentation timeline riding with the level file (the `LevelTheme`
  precedent — presentation lives in level data, fingerprint excludes it).
  Absent = baseline everywhere. Section identity is pure Z ranges (no
  gameplay ids duplicated). `RendererHost` prepares it once (cold,
  sorted copy), evaluates per frame from the interpolated Z, and applies
  it through in-place hooks only (`MaterialLibrary.applyRouteState`,
  `PostPipeline.setBloomParams`, `EnvironmentView.applyVisualState`,
  `VfxSystem.setIntensity`, owned exposure) — zero new scene content,
  zero new draws, every system restored exactly on the off-edge.
  `?triggers=off` (URL + runtime) composes with `?post=off`/`?fx=off`.
- `EnvironmentView` (M7.1 addition): 12 fixed background energy beams
  sharing one geometry + one additive material (bounded, renderer-only, no
  collision), driven by section energy with punch-envelope bursts in the
  event tint; silenced by the same reset path (triggers-off === silent).
- `rhythmCues.ts` (`src/visuals/`, M7.1) — deterministic beat-ready cue
  resolution (prepared z-sorted copy + `cueAtZ`/`cueIdAtZ`, pure positional
  — no clocks). Level data owns the cues; `RendererHost` exposes the active
  id as a probe; nothing cue-related reaches the sim, the fingerprint, or
  replays. The visual timeline resolves independently (no competing trigger
  system — sections and cues are authored to coincide).
- `eventPunch.ts` (`src/visuals/`, M6C2) — the ONE renderer-side owner
  computing the EVENT PUNCH ENVELOPE (per-family 0..1 energy + dominant
  tint, THREE-free pure numbers like `visualTimeline.ts`). The RendererHost
  feeds it from the same pre-existing sim edges the VFX reads and maps it
  onto the existing in-place hooks ABOVE the section base look (bloom
  re-clamped in-contract, exposure nudge clamped 0.5..2, environment flash
  toward the family tint, all absolute writes, exact rest-restore).
  Trigger-owned: `?triggers=off` holds it at rest. Nothing punch-related
  in replays (energy derives from replayed trajectory). M7.2 adds the
  `teleport` family (violet, peak 1.0, wins color ties — the rarest
  signature event); the RendererHost feeds it from the sim's
  `teleportEventCount` edge.
- `VfxSystem` (`src/rendering/`, M6B) — the ONE presentation owner for
  motion language + gameplay juice (Cube trail, jump/landing bursts,
  gravity-transition pulses, speed streaks + tier pulses, pad/orb bursts,
  M6C2 surface-contact skid sharing the trail buffer + gravity/pad streak
  kicks + amplified event counts within the same bounded pools + M7.2
  teleport exit-expansion bursts (violet, at the `lastTeleport` anchor,
  fired AFTER the discontinuity trail wipe; M7.3 theme count 44 / life
  0.75) + teleport streak kick).
  Owned by `RendererHost` (one scene group: trail Points + burst Points +
  one streak InstancedMesh = 3 draw calls; `?fx=off` hides it). Observes
  pre-existing sim seams only (bridged `onJump`, grounded edge,
  portal/speed/interaction counters, attempts/death/teleport reset edges);
  never writes gameplay, owns no replay data (replays recreate effects
  from replayed sim events). Fixed pools (96/384/24), zero per-frame
  allocation, render-dt evolution (freezes with presentation pause via
  Game's dt=0), idempotent dispose. Owns 3 fixed materials + 3 fixed
  buffers/geometries (DeathBurstView precedent — NOT a second material
  manager; the library is untouched). QA surface: live counts, cumulative
  per-kind counters, monotonic reset counter, landing intensity.
- `Game` (M6B wiring, composition root only): bridges the REAL `onJump`
  sim event to `RendererHost.notifyJump` (one signal = one burst) and
  passes render-dt 0 while paused so ALL presentation (VFX, rings, burst,
  tumble, camera) freezes with pause — sim pause untouched.
- `PlayerView`: production Cube (M6A) — dark cyan metal body + bright
  emissive free-face accents on ALL FOUR side faces (top = Floor free
  face, bottom = Ceiling free face, left/right = wall free faces; children
  of the cube so they inherit tumble/rest roll) + cyan edge lines +
  camera-side marker. Visual 1.24 vs collider 1.1; airtime tumble is
  render-only and snaps to rest on landing — rest orientation aligns to
  the surface normal (180° Z roll on Ceiling, ±90° Z roll on walls; the
  CAMERA never rolls and the collider never rotates). Collider and mesh
  are independent by construction (debug F3 visualizes the real hitbox).
  Visibility follows sim status (hidden while dead), applied in
  `RendererHost` so debug frame-freezes capture true death frames.
- `LevelView` builds the M3 gravity portal visuals from level data (shared
  unit box geometry, ONE shared material per direction — cyan up / warm down;
  translucent pane + neon frame, zero per-frame work). Portal triggering is
  simulation-only; the visuals are pure presentation. M7.2 adds paired
  teleport gates (violet frame + pale pane; `maw`-style entries render as a
  mouth ring from the shared halo geometry) and presentation-only guardian
  setpieces (dark body + warm eyes, shared meshes/materials only) — same
  ownership, same zero-per-frame-work contract; the sim never reads them.
- `InteractionView` (M4, owned by `RendererHost`): builds pad/orb/speed-portal
  visuals from level data (library box/sphere/halo/chevron geometries,
  library emissive accent materials, per-tier cached speed materials) plus the
  activation VFX — a pooled ring set (8 rings, library-owned fixed material
  set) edge-detected from the
  simulation's `interactionEventCount` (pure presentation read; VFX never
  drives gameplay). Used interactions dim via `isInteractionUsed` polling;
  orbs idle-bob (render-side only). Original palette language: yellow family
  = jump impulse (pads + jump orbs), blue = gravity orb, one color +
  chevron count per speed tier.
- `DeathBurstView` (M2, owned by `RendererHost`; M8A: 32 pooled fragments
  + core flash + shock ring, 0.65 s matching the 78-tick hold; M8.1: mode
  voxel palettes + avatar ghost shell + chunks holding size for the first
  half): owned materials (recolored per mode on play), deterministic radial
  burst, zero allocation post-construction; triggered by the `deathId` edge
  with the active player mode. Death kick (M8A: FOV +5, +0.4 u lift) +
  camera snap-to-start on respawn/teleport also live in `RendererHost`.
  Debug-only `debugFreezeFrame` (skip visual updates, keep presenting) +
  `debugReplayBurst` (re-fire at recorded death pos, mode-aware) exist
  SOLELY for photographing the effect under headless screenshot latency.
- `DeathSfx` (`src/audio/`, M2): lazy guarded Web Audio death blip (0.18 s),
  created on first user gesture; silence-on-failure; gameplay never depends
  on it.
- `perfProfiler.ts` (`src/debug/`, M6D) — DEBUG/PERF-only frame profiler
  living ABOVE gameplay (never touches sim/input/replay): bounded
  Float64 ring (600 samples, zero hot-loop allocation, O(1) counters),
  percentiles on the cold snapshot path, off by default (`?perf=1` — one
  branch per frame when disabled). Owned by `Game` (composition root),
  exposed as `__gd3d.perfSnapshot()` / `perfBeginSampling()`; the
  `RendererHost.gpuIdentity()` cold probe reports the actual WebGL
  vendor/renderer (SwiftShader verdicts are software, never a GPU pass).
  Repeatable gate: `scripts/perf-gate.mjs` → `qa/perf/*.json`.
- `LevelView` builds route/hazard/portal meshes from level data (M8.5:
  ONE merged edge-line `LineSegments` outlining every solid/killFront
  box + spike pyramid on the shared vertex-colored `routeEdgeLine`
  material — dark faces + luminous edges; solid vertices follow the
  section accent via `setEdgeAccent` (change-guarded, cold), spike
  vertices stay hazard-warm; view-owned buffer disposed with the view,
  so the library geometry count never moves; M7.1:
  spike visuals orient relative to their declared `mount` surface — base
  attached, tip AWAY from the support (floor +Y, ceiling −Y); colliders
  untouched, no level-id branches, omitted mount = floor), (M7.3:
  `killFront`/block hazards render as exact-size hazard-orange blocks with
  a glowing front frame (kind-based presentation branch, never level-id);
  top/bottom edge strips overhang 0.05 per end to close corners under the
  outboard posts + every tall slab gains a rear sill (both gap faces read
  framed); narrow exposed islands (halfX ≤ 1.4, bottom exposed) carry a
  full bottom-edge under-glow frame; teleport gates are compact RING gates
  (shared halo: outer ring + inner rim + pane; maw entries add a shared-
  chevron tooth crown) instead of wall-sized rectangles; `lava` setpieces
  render as glow slab + dark crust below the route; `guardian` setpieces
  gain jaw + teeth + trailing chain links — all shared library
  geometries/materials, zero new resources), (library
  unit-box/cone geometries, library route/hazard/portal materials — no owned
  materials/geometries; M1.1/M1.2 face applique — thin emissive trims in the
  shared edge material riding PROUD of solid faces:
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
  deterministic starfield/pillars — seeded PRNG, visuals only;
  theme-driven, below the bloom threshold by construction), finish gate
  (library material).
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
  stats, scene-child count, burst state, player velocity
  (`playerVelocity`, M8.5 — Ship PD regulation under headless
  time-dilation), and the debug-only `debugTeleport` placement aid for
  browser QA. M5 adds:
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
- `tests/deathBurst.test.ts` (M8.1: 35-child pool pin incl. the ghost
  shell, play-then-clear lifecycle, repeated-death boundedness, mode
  palettes/ghost scales, chunk-hold curve, ghost release timing).
- `scripts/browser-qa.mjs`: M7.2 section migrated to the M7.3 rework
  (overlap-safe staging 521/484, race-free baseline→stage→poll teleport
  snapshots, holds-based full-route drivers) + M7.3 section (`m73-*`,
  19 logged checks, all green: offset islands, wall frontImpact,
  tall-spike hazard, live burst-in-hold, ceiling tip-down projection,
  hop-pair co-visibility + snapshot + VFX/punch, maw ring, beast
  in-frame, air-gate + storm photos, full real-input finish + runtime
  band + REPLAY VERIFIED, restart/fallback/resource guards).
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
| 78-tick death hold; respawn fully resets (incl. gravity mode) | `death` tick + reset tests + `gravity` tests + `lava` hold tests |
| Gravity portals: exactly once per attempt, no teleport, support cleared, death wins the step | `gravity` portal/precedence tests + browser QA |
| Lethal checks precede ALL portal + interaction mutations (M3.3 invariant, extended in M4) | `interactions` ordering tests + `gravity` precedence tests |
| Teleport portals: exactly once per attempt, lethal wins the step, skipped interval never fires, exit velocity/lane/support semantics pinned, gameplay fingerprinted (style excluded), ReplayV1 unchanged | `teleport` tests + `advancedCube01` teleport integration tests + browser QA m72 section |
| M8.1 bounded portal triggers: gravity/speed/mode portals fire only when the swept step path overlaps the authored gate volume (legacy volume-less plane crossing kept); volumes fingerprinted conditionally (`portalvol:v1`, zero bytes when absent); ring visuals centered on the volume (volume/visual agreement) | `portalBounds` tests (inside/outside ×3 kinds, legacy compat, visual agreement, fingerprint reversibility) + `multimodeGauntlet` gate/routing tests + browser QA m81 section |
| M8.2 TRUE portal bounds: trigger volumes must match the visible ring
opening (ring radii single-owned in `portalAuthoring.ts` and used by
LevelView; `validatePortalBounds` rejects oversized/off-plane volumes);
gauntlet gates are opening-sized on probed rider lines; missed S3 wall
gates fail by routing (floor gaps or deathX ±11 runaway catcher) |
`portalBounds` tests (all four kinds inside/outside, missed-gate void,
validator rejection, gauntlet clean) + browser QA m82 inside/outside checks |
| M8.2 lava read: pool crust plates over bright cracks, stepped zigzag
falls grading bright-to-deep, splash discs, vent drips; vent mouths must
protrude from rock (`lavaAuthoring` rule 4); lethal boxes unchanged |
`lava` protrusion/alignment/view-structure tests + gauntlet clean +
browser QA m82 lava portraits |
| M8.3 living lava: tone-map-safe saturated glow (orange, never cream)
+ deeper shared pulse + `LevelView.updateLava` (render-dt crust
convection, descending fall pulse, splash/drip/mouth breathing; zero
alloc, pause freezes, mesh budget unchanged) + `sampleLavaMotion`
checksum probe | `lava` motion/freeze/budget/pulse tests + browser QA
m83 flow-advance + pause-freeze checks + two-phase portraits |
| M8.4 directed lava flow: optional presentation-only `flow` hint on
`LavaVolumeDef` (auto-excluded from the fingerprint — `writeLava` hashes
geometry/role only); validator rule 5 (hinted pools hand off downstream)
+ rule-3 spillover (a pool surface feeds the fall below an edge);
gauntlet river re-authored source → crossing (box-identical) → shelf
channel → cliff drop; renderer conveyors (traveling `lavaCore` cores,
current-riding crust with viscous shear, descending pour pulses, spill
lips, vent chimneys; all kinds t = 0-continuous) | `lava` rule-5 /
spillover / fingerprint-neutrality / conveyor-motion / freeze / budget
tests + `multimodeGauntlet` run + browser QA m84 coherence/kill/portraits +
continuous-glow follow-up (global pulse flattened to a stable base,
motion carried by traveling features) +
real-bloom follow-up (surface HDR luma ~1.04 past the 0.8 threshold,
HDR cores ~1.6; lava genuinely blooms on real GPUs) |
| M8.1 lane-debt resync: laterally-blocked intent clamps to one lean step beyond the deepest reachable lane (all modes/surfaces); open-edge virtual lanes untouched; Y-clips count only when the lane axis is vertical | `laneDebt` tests (wall-bottom + floor side-wall + open-edge) + `death` lean-settle pin + golden fixture (bit-identical without lateral contacts) |
| M8.1 death breakup: mode voxel palettes + ghost shell + held chunk size (same 78-tick hold); pooled 35, owned materials, render-only | `deathBurst` mode/lifecycle tests + browser QA m81 frozen-burst photo |
| M8.2 chomper redesign: bright lava-orange blocky body, big square head,
wide hot maw, large fangs + jaw teeth, brow-hooded eyes, 26 meshes max;
chomp cycle + sim byte-identical | `chomperView` structure/animation/bound tests + `chomper` sim contract + browser QA m82 portraits |
| M8.3 chomper reference match: ONE mottled magma head-ball, large dark
cavity maw on the lunge face, 7 chunky block teeth, white-hot square
eyes + dark pupils (eye children), lava-hot chain + anchor weight cube;
same 26 budget, same 8 geometries, one new shared eye-white material |
`chomperView` anatomy/budget/cycle/cap tests + browser QA m83 portraits |
| M8.2 spider-swap camera glide: Spider-context gravity swaps ease with
slower lambdas over 0.55 s (same endpoints, no roll); gravity-portal /
Cube / Ship framing numerically untouched | `spiderCamera` glide/endpoint/snap/expiry tests + `cameraFraming` regression pins + browser QA m82 glide arming |
| M8.3 spider-swap continuity: swaps SKIP the teleport-snap (the ~5 u
swap displacement tripped the >5 u cut detector — the M8.2 glide armed
after the cut); the envelope blends the captured pre-swap pose onto the
moving target with smootherstep (zero velocity both ends, same
endpoints); teleport/respawn/R still snap | `spiderCamera`
first-frame stillness/peak/endpoints/snap/expiry tests + browser QA m83
in-page eye-velocity proof (no cut) |
| M8.1 tunnel-wall mid-band: tall thin walls carry a 0.07 neon bead (not the 0.055 rail stock) on both narrow faces; purely geometric | `tunnelWalls` tests + browser QA m81 tunnel checks |
| Presentation setpieces: no collision/AI/movement/trigger, fingerprint-excluded, never landable-looking | `advancedCube01` setpiece structure + fingerprint-exclusion tests + browser QA m72 setpiece checks |
| M4 interactions: swept-window detection (no skip at speed), press-edge orbs (no buffer, held-inert), one-shot per attempt, respawn re-arms | `interactions` tests + browser QA m4 section |
| Replay records physical fixed-tick input only; playback feeds the real sim; sim stays replay-agnostic | `replay` lifecycle/determinism tests + `Game` protocol review (no sim import of replay code) |
| Same level + same initial state + same input tape reproduces the run tick-for-tick; first divergence stops and reports | `replay` determinism/divergence tests + golden fixture (load-and-verify + negative proof) |
| Replays are bound to exact gameplay content; renderer-only changes keep compatibility | `replay` fingerprint tests (gameplay-sensitive, visual-insensitive) + compatibility rejection tests |
| Old tapes never silently run after intentional gameplay changes | `REPLAY_RULESET_VERSION` discipline + ruleset rejection test + manual fixture regen procedure (M5 spec) |
| One replay = one attempt; partials never finalize; playbacks never contaminate tapes | `replay` lifecycle tests incl. fault-proven hybrid-tape regressions |
| Engine is level-agnostic: Level 02 runs with zero engine changes and finishes via real inputs | `level02` tests (distinct content, scripted finish, record→replay) + browser QA m5 section |
| ONE speed authority: level baseForwardSpeed × sim multiplier; 1× bit-identical; R/death reset | `interactions` speed tests + `floorCompat` golden gate |
| Reference PNGs never runtime assets | Repo/runtime search + visual review |
| Visual theme changes never alter gameplay or fingerprints; sim imports no rendering | `visualFoundation` theme/fingerprint + import-boundary tests + golden replay (unit + in-page) |
| Shared materials/geometries only; no per-frame allocation; bounded resources | `visualFoundation` library tests + browser QA resource/draw-call guards |
| Global warm hazard identity on every level (per-level themes move route/environment only) | `visualFoundation` cross-level hazard-resolution tests (M6D) |
| DEBUG profiler bounded (ring ≤ capacity), off by default, sim-untouched; software rasterizers never a GPU pass | `perfProfiler` tests + `gpuIdentity()` probe + `perf-gate.mjs` evidence (M6D; M6D.1 headed `--real-gpu` mode, rules in `scripts/perfGateLib.mjs` + colocated tests) |
| Controlled bloom (contract-pinned), resize-safe post, playable no-post fallback | `visualFoundation` contract tests + browser QA m6a resize/fallback checks |
| VFX observes but never writes sim; sim imports no VFX/rendering/visuals; nothing visual in replays | `motionVfx` boundary + golden-integration tests + browser QA m6b replay checks |
| VFX pools bounded; no per-frame/per-event allocation; exact-once emission per real edge; reset on attempt/death/teleport; `?fx=off` preserves gameplay | `motionVfx` lifecycle tests + browser QA m6b section (counters, resets, resource guards, post×fx matrix) |
| Event punch envelope peaks/decays/composes by max with family tints; contact skid grounded-only, Floor/Ceiling-relative, speed-scaled, timeline-calmed, reset-safe; worst-case event volume << burst pool; sim trigger-free; punch excluded from replays; `?triggers=off` holds the envelope at rest | `eventPunch` tests + browser QA m6c2 section (peak/tint/rest-restore proofs, skid floor+ceiling, fallback split, replay proof, 26/8/3 guards) |
| Timeline section identity position-driven; state never accumulates/drifts; bloom ⇒ contract, exposure ⇒ 0.5..2; player/hazard stable; sequence excluded from fingerprint; sim trigger-free; transitions add zero draws/materials/geometries; `?triggers=off` restores exact base; nothing timeline in replays | `visualTimeline` tests + browser QA m6c1 section (interpolation bounds, identity pins, reset/replay proofs, 26/8/3 guards, fallback matrix) |
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
