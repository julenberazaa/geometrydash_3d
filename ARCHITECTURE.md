# ARCHITECTURE.md — Actual System Boundaries and Invariants

> Authority for **technical structure**. Documents the code as it IS. When code
> changes an architectural fact, update this file in the same commit
> (`AGENTS.md` §10).

## 1. Dependency direction

```text
main.ts → AppController (M9.4 menu ↔ session lifecycle + M9.6 3D island
  hub: IslandHub ⇄ LevelSelectView selection mirror → create Game →
  dispose → menu; one Game owns one LevelDefinition; menu XOR session
  canvas — the hub builds fresh on every menu entry and disposes on
  every START, so exactly one renderer/canvas is ever alive; level
  changes never hot-swap content inside an active session)
  Game → InputSystem → GameSimulation → { CubeController, CollisionWorld, LevelRuntime }
  Game → ReplayCoordinator → GameSimulation (M5: recording/playback orchestration ABOVE the sim)
  Game → RunModeController (M9.4: pure classic/practice-taint machine —
    the attemptKind answers officiality; the sim owns only snapshots)
  Game → PauseMenuView (M9.4: resume / live mode switch / full restart /
    MAIN MENU — M9.4.1 renamed the LEVEL SELECT button and added ESC as a
    pause key alongside P; presentation only)
  Game → MusicDirector → Web Audio output (M9: presentation-owned transport;
    audio FOLLOWS sim time, never drives it — §10; M9.2: every live voice
    satisfies BUFFER SOURCE → MASTER GAIN → DESTINATION, wired via
    engine.connectSourceToGain BEFORE start — structural test + graphReady)
  Game → RendererHost → { LevelView, PlayerView, EnvironmentView, DebugView, ChaseCamera, CheckpointView (M9.2) }
  Game → Hud (M9.2: mode selector + checkpoint progress), DebugOverlay
  Game owns the M9.4 run mode via RunModeController (classic/checkpoint +
  practice taint): `setRunMode` live-switches mid-attempt (sim flag +
  crystal visibility + HUD + partial-tape discard — position/music/camera
  untouched), `fullRestart` re-opens a fresh origin attempt in the current
  mode (progress + taint cleared, checkpoint mode re-armed), R follows the
  current flag, Shift+R is always a full restart, finish/F4 gate on
  `attemptKind` (tainted attempts show PRACTICE COMPLETE, never finalize
  ReplayV1).
  Checkpoint snapshots live in GameSimulation (capture/restore); Game
  never constructs them. `restartRun()` disarms the sim flag (Game re-arms
  on full restart); disarming alone retains earned snapshots (usable again
  on re-arm — retention rule, pinned by `tests/livePracticeMode.test.ts`).
  `Game.dispose()` removes the canvas, listeners, loop, music, HUD DOM,
  debug-overlay DOM and pause menu (M9.4.1: `Hud.dispose()` /
  `DebugOverlay.dispose()` remove the nodes instead of hiding them —
  return-to-menu leaves zero session residue).
  Probes live in `src/app/gameProbes.ts` (menu probes: `screen`+cards;
  session probes incl. `attemptKind`, `setRunMode`, `checkpointsVisible`).
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
- M9.1 QA slow-motion (`?stepcap=N`, `GameOptions.maxCatchUpSteps`,
  `__gd3d.stepCap()` probe): overrides the per-frame catch-up budget
  (clamped 1..8) WITHOUT changing tick order, count, or physics — fewer
  steps per frame = finer input-delivery quantum for precision QA on slow
  software renderers, at the cost of sim-vs-wall speed. Replays verify
  across cap values. Default path (cap 8) is byte-identical to before.

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
physical snapshots directly — no browser needed. `Game` owns separate non-gameplay keys (`R` restart, `P`/`Escape`
pause, `F1/F2/F3` debug) — a distinct domain from gameplay input.
M9.6 pointer primary action (still this owner, still gravity-agnostic):
`attachPointer(container)` maps pointerdown → the SAME `space` edge
(first contact presses, last release releases; multi-touch tracked by
pointer id) and pointerup/cancel/leave → release; keyboard and pointer
holds are tracked separately, so one release cannot disarm the other and
each new source press emits an edge even when the other is held. Pause,
blur and detach clear stale pending edges. Contacts starting on a
`button` are UI gestures (ignored here — buttons blur themselves on
activation so Space never re-fires them, fixing the post-menu spurious
pause). Pointer shares the `space` edge state, so the replay codec,
ReplayV1 and all tapes are byte-identical. `Game` attaches the pointer
root per session and detaches on dispose; the window `blur` handler is
named and removed on detach (the old anonymous closure leaked).

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
  the frame's `gravityVector`), jump (grounded AND held-or-press-edge → deterministic
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
  never touches the CollisionWorld). M9.6: the sim records every snap
  (`spiderSnapEventCount` + `lastSpiderSnapFrom/To` anchors) and every
  ignored press (`spiderRejectCount` + `lastSpiderRejectReason`) —
  presentation/QA only, excluded from the state hash and the level
  fingerprint (teleport-anchor precedent) — and arms a 6-tick press
  buffer (`spiderBufferTicksLeft`, cleared on death/respawn/restart/
  mode-exit, carried in checkpoint snapshots) that re-attempts ONLY the
  snap (never fabricates input, so pads/orbs/gravity never observe it).
  Reference tapes (success-first-try presses) are provably unaffected.
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
- `moveAabb.ts`: axis-separated swept movement in Y → Z → X order (M8.6:
  optional appended `extraBlockers` — preallocated moving-platform
  pseudo-colliders tested AFTER the static candidates without touching
  the spatial hash; order deterministic per level); per-step
  `MoveResult` (floor/ceiling/wall contacts — named for the WORLD direction of
  the block, the simulation interprets them against gravity) plus the
  post-Y/post-Z clip positions that record the authoritative swept path for
  hazard tests; `probeGroundSupport` for stable grounded state at zero
  vertical velocity, probing ALONG the gravity direction (below the box on
  Floor, above it on Ceiling — identical contact skin, footprint and teeter
  semantics). The probe tests the full support footprint (minus a 0.02 skin):
  partial overlap still grounds (edge teeter), only full exit ungrounds →
  airborne → gravity → void bounds. No tunneling at high speed (tested incl.
  4× forward speed vs thin walls). Parallel-rest rule (M8.6): Z straddles
  (toi 0 — already overlapping on the motion axis) are parallel rest on a
  slab whose z-range contains the player, never an approached face, so the
  Z clip skips them for both movement and contacts; support faces are
  parallel to forward by construction and can never genuinely block it.
  Without this, ±1 ulp rest-height dust from the landing clip flips the
  strict perpendicular test and phantom-kills/stalls step-top runs, while
  any tolerance skin instead swallows load-bearing slab-lip overhangs
  (proven both ways by the gravity-lip + showcase-stair pins). Genuine
  frontal impacts always approach with toi > 0. X keeps straddles (side
  blocking + lane-debt) and Y keeps them (landings).
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
  `checkpoints?` (M9.2: id + displayName + trigger center/halfExtents;
  HUD displayName is presentation-only and fingerprint-excluded, like
  teleport `style` / hazard `visual`+`mount`),
  `teleportPortals?` (M7.2: id + entry Z + exit + exit lane; `style` is
  presentation-only, never fingerprinted), `movingPlatforms?` (M8.6: id +
  base + halfExtents + axis x|y + amplitude + periodTicks + phaseTicks;
  pingpong tick-derived poses — see `movingPlatformSystem.ts` +
  `movingPlatformAuthoring.ts` + the dynamic-solid contract in §5/§7),
  `visualSetpieces?` (M7.2
  guardian + M7.3 lava + M9.6.1 `snapmark` (forced-spider-snap diamond)
  + M9.6.1 `fall` (waterfall sheets + pool): presentation-only
  decorative kind/center/extents — never gameplay, never fingerprinted),
  `visualDressing?` (M9.6.1: per-act biome rows z0/z1/biome/density/
  seed/accent/baseY — seeded route-adjacent midground dressing, opt-in
  per level, never gameplay, never fingerprinted),
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
  processes.   `movingPlatforms` rides in definition order (no trigger
  sorting — poses are pure tick functions). `checkpoints` (M9.2) rides in
  definition order (HUD progress + fingerprint order; empty when absent).
  M8A lethal lava volumes register as `lava-<id>` hazard-kind
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
   engine changes. M9.4: two production entries — `the-descent` (M9.4.2: the
   EXACT M8.6 density-verticality content from `e5b0d86`, byte-exact
   historical gameplay plus 8 crystals authored for its geometry and
   deliberately NO `musicTrack` — M9.4 had wrongly frozen the M9.2
   snapshot here, M9.4.1 had wrongly stored the M8.5 simple route) +
   `production-showcase-01` (modern route, display name `GRAVITY RIFT`
   via one isolated presentation-only const — internal id unchanged, so
   replays/fingerprints/URLs stay compatible); declarative card metadata in
   `src/content/levelMetadata.ts` (id/tag/subtitle/difficulty/duration/
   accent — the selector derives from it, no hardcoded if-button branches;
   M9.4.2: ORIGINAL M8.6 card first, GRAVITY RIFT default-selected).
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
- `theDescentClassic.ts` (M9.4.2: the EXACT M8.6 density-verticality
  content from `e5b0d86`, `the-descent`, "THE DESCENT", tag `ORIGINAL
  M8.6`, deliberately NO `musicTrack` — M9.4 had wrongly frozen the M9.2
  snapshot here, M9.4.1 had wrongly stored the M8.5 simple route; M9.5:
  the M8.6 foundation plus surgical density polish — 3 added Chompers
  (`ps-chomp-deck/lower/shaft`, 8 total at the ≤8 cap), the LOW
  under-deck weave (244/254), upper/lower maze doors (599/610/600),
  foundry-exit doors (1093/1104, replacing the 1100 hop) — and the
  `musicTrack` binding to Zenith of the Path, offset 0): the classic high-mobility
  descent — forge ascent, multi-deck skybridge islands with a lateral
  ferry + elevator branch, two-deck maze-runner with a ferry pair,
  compact four-way gravity spire, Chomper foundry, extreme Ship abyss
  with a sustained inverted segment, hard Spider spire with wall snaps,
  teleport-choice void terminal, everything-remix core finale, 5 moving
  platforms; scripted real-input playthroughs finish at tick 14797
  (123.31 s), 0 deaths, replay VERIFIED, on BOTH the primary and
  alternate routes (`tests/helpers/theDescentClassicScript.ts`, metrics
  in `tests/helpers/routeMetrics.ts`, contracts in
  `tests/theDescentClassic.test.ts`, moderate Zenith alignment in
  `tests/descentZenithAlignment.test.ts`, in-page gates in
  `scripts/browser-qa-m95.mjs` + the ported `scripts/browser-qa-m86.mjs`
  mirror).
- `productionShowcase01.ts` (modern route, `production-showcase-01`,
  display name "GRAVITY RIFT" — M9 retime + M9.1 radical rebuild + M9.2
  audio/checkpoints/visual + M9.3 traversal/spider/ship/purple on top
  of the M8.6 arc): the DEFAULT level — the same 9-act skeleton
  re-authored to EXPERT density with Ship funnels + 3D diagonal, the
  purple megastructure and ContactPulse, bound to Gravity Lessons;
  scripted real-input playthroughs finish at tick 13799 (115.0 s),
  0 deaths, replay VERIFIED, on BOTH routes
  (`tests/helpers/showcaseScript.ts`, contracts in
  `tests/showcase.test.ts` + `tests/showcaseDensity.test.ts`, in-page
  gates in `scripts/browser-qa-m92/m94/m941.mjs`).

## 7. Simulation (`src/game/`)

- `GameSimulation`: headless orchestration per fixed step — platforms
  (M8.6: tick + poses + rider carriage + embed backstop, BEFORE the
  controller) → controller →
  integrate+collide (vs static world + appended platform colliders) →
  frontal kill → grounding (probe sees platforms; `platform-<id>` support)
  → lethal checks (void bounds,
  hazard CCD, M8D dynamic chompers) → teleport portals → mode portals →
  jump pads → jump orbs → gravity orbs → speed portals →
  gravity portals → finish. M9.3 spider-entry edge: the top-of-step snap
  check runs under the pre-portal mode, so `processModePortals` honors a
  primary press on a genuine spider-entry step as a snap attempt in the
  new mode (before pads/orbs; hazard death still wins) — otherwise the
  entry step eats the first snap (dead input). Owns the AUTHORITATIVE gravity mode
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
  authoritative `speedMultiplier` (ascending Z, furthest wins; M9 one-shot
  per attempt via `usedSpeedPortals` — bounded volumes are consumed on
  first overlap instead of re-firing every tick inside). Lifecycle:
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
  respawn reset. RUNTIME ORDER (load-time invariant): `levelRuntime`
  sorts `level.chompers` by `triggerZ` — `sim.level.chompers[i]` and
  `sim.chomperStates[i]` share that sorted order (the sim, the driver,
  the probes and the ChomperView all index it consistently), while
  `def.chompers` keeps definition order for the fingerprint. Any code
  hardcoding chomper indices against definition order is wrong
  (M9.5 precedent: the m86 in-page mirror did — fixed to sorted
  indices). Aim (player X) is captured once at activation and never
  re-homed; the lunge is linear over authored ticks. `ChomperView`
  (owned by `RendererHost`) observes sim states only — M8.3 voxel lava
  chain-chomp anatomy (single mottled magma head-ball + hot-yellow voxel
  mottle, large dark cavity maw on the lunge face, 4 upper + 3 lower
  chunky block teeth, white-hot square eyes + dark pupils, lava-hot
  chain + anchor weight cube, chomp cycle), 26 meshes per Chomper, sim
  byte-identical.
- `movingPlatformSystem.ts` (M8.6): the ONE owner of platform pose math —
  pure pingpong triangular-wave `platformPose(def, tick)` (no state, no
  clocks). The SIMULATION owns the integer `platformTick` (+1 per running
  step before the controller, reset by `respawn()` — deterministic given
  the input tape), the preallocated state array + `platform-<id>` solid
  colliders (centers mutated per step, never reallocated), exact-
  displacement rider carriage (position only — no launch velocity, no
  lane-debt: intent untouched, the lane servo's pull-back is genuine
  counter-steer gameplay), and the smallest-axis embed push-out backstop
  (elevators surfacing into riders; positional, ±X/±Y — never a frontal
  kill). Static geometry wins support ties structurally (appended after
  static candidates) → ferry→ground handoff. Cap ≤ 8 (constructor throws).
  `MovingPlatformView` (owned by `RendererHost`) observes sim poses —
  shared route body + top plate, zero new materials/geometries.
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
  every frame. M9.2 run mode (still no gameplay logic): owns
  classic/checkpoint selection (selector buttons / Space+C+1+2 / bare
  click), applies it via `sim.setCheckpointRespawnEnabled` +
  `rendererHost.setCheckpointsVisible`, re-seeks music to the checkpoint
  sim time on checkpoint restores (`restartMusicForSimTime`), routes
  `Shift+R` to `sim.restartRun()` (full origin restart, progress cleared),
  guards `F4` to classic runs, and shows PRACTICE COMPLETE (discarding the
  partial tape — checkpoint runs are never official completions).
  `MusicDirector.restartAt` repositions the transport while preserving its
  paused state, so `R`/`Shift+R`/`F4` from the pause menu cannot start a
  voice until resume. Pausing a `ready` transport after a death/finish cut
  also records `paused`, closing the cut→pause→restart boundary.
- `SimulationCheckpointSnapshot` (M9.2, `GameSimulation`): the ONE
  deterministic resume representation — position/prev/velocity, grounded,
  support id, lane intent, authoritative gravity + player mode, speed
  multiplier, all four one-shot sets, Chomper states + swept prevs,
  platform TICK (poses/carriage/colliders recompute from it — never
  stored), elapsed sim time, debug/VFX continuity records + counters.
  `captureCheckpointState()` / `restoreCheckpointState()` are sim-owned
  (presentation never constructs snapshots); progress (activated ids +
  active id + per-id snapshots) is run-scoped, survives checkpoint
  restores, clears ONLY on `restartRun()`. Detection (`processCheckpoints`,
  swept-volume, once per id per run, after every gameplay mutation)
  runs ONLY when checkpoint mode is armed — classic trajectories are
  bit-identical (pinned by the `checkpoints` isolation test + the DESCENT
  13799-tick both-route anchor). `respawn()` routes to the latest snapshot
  when armed; attempts still +1 per restore; checkpoint progress is
  session state, never in the state hash (checkpoint runs are not
  ReplayV1); checkpoint defs ARE level-fingerprinted conditionally
  (`checkpoints:v1`, zero bytes when absent — golden fixture untouched).

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
  `platforms:v1` conditional block (M8.6: id/base/extents/axis/
  amplitude/period/phase; zero bytes when absent) + platform poses +
  clock in the state hash (M8.6, Chomper-state precedent).
- `stateFingerprint.ts`: per-tick authoritative-state hash (status,
  deathCause, player position/velocity, grounded, lane intent/count,
  support id, gravity mode, speed multiplier, elapsed time, death-hold
  ticks, used-interaction bits + used-teleport bits in level order).
  Session/debug-only records excluded with documented reason (attempts,
  prevPosition, portal/debug ids, counters, death anchors incl. the
  teleport anchor, derived progress).
- `replayFormat.ts`: versioned `ReplayV1` container (`schemaVersion` 1,
  `rulesetVersion` 2 (completed Cube taps accepted through their press
  edge; version-1 tapes rejected before playback) — a deliberate constant, never
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
  'freePlusFocus'`) selects the height line — Floor: `playerY * 0.35 +
  aboveIntercept` (elevated); Ceiling: `playerY * 0.35 + belowIntercept`.
  M8B walls: the eye shifts ±3.4 u toward the free-face side while keeping
  the elevated floor line (side free face + top face readable, never a
  side-on silhouette); `camera.up` stays world +Y on all four surfaces. **Surface-relative projection symmetry (M3.3):**
  the below-focus line is the EXACT mirror of the above-focus line about the
  corridor mid-plane (shared slope 0.35; corridor intercepts 4.2 / −0.3; look
  bias +0.6 above / −0.6 below with the focus side), so the Cube's FREE face
  (the face on the `surfaceNormal` side, opposite support — top on Floor,
  bottom on Ceiling) projects with identical apparent size/perspective on
  every gravity surface (measured 0.219 pre-fix → 1.000 post-fix; pinned
  0.98..1.02 in `tests/cameraFraming.test.ts`, acceptance 0.90..1.10). **Multi-height generalization (M8.6 corrective):**
  the intercepts are SLOW per-side state, not constants: while grounded the
  active side adapts toward its deck-invariant target (`playerY * 0.65 ±
  eyeHeight` 3.8425, λ=4/s) so any deck frames like the corridor; airborne
  they freeze so jumps/drops/portal flights keep the proven transient shape.
  Snaps land the intercept exact (teleports frame correctly from frame one);
  the corridor constants are fixed points (corridor behavior byte-preserved).
  The ceiling eye hangs mid-corridor BELOW the cube (rest y ≈ 1.61 vs cube 5.45, ≈4.4 u
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
  portals, respawn, and R-teleport still snap (the snap gate is
  status-independent since M8.6: a teleport that kills on arrival still
  snaps instead of stranding the ideal pose). Eye non-penetration
  across the real full-level playthrough is pinned by
  `tests/cameraFraming.test.ts` (level-data-aware auditor; the camera itself
  still never reads level data).
- `CameraOcclusionResolver` (`src/camera/`, M8.6 Bug B, pure math): resolves
  the ideal ChaseCamera pose against blocking geometry WITHOUT orbiting —
  pull-in along the focus→eye axis ahead of the nearest obstruction
  (expanded-AABB sphere-equivalent sweep, wall skin 0.25, min focus distance
  1.6). Appearance tracks immediately (never lags into occlusion), restore
  relaxes slowly (λ=2.4); an eye-inside-solid escape walks back toward the
  ideal (non-penetration outranks pull-in). Blockers: static solids adapted
  once per level + authoritative moving-platform poses in fixed ≤8 scratch
  (hazards/lava/portals never block). Runs AFTER damping/glide/snaps, so a
  Spider glide is never reinterpreted as a cut. Pinned by
  `tests/cameraOcclusion.test.ts` (A–J contract) + the both-route
  `tests/showcaseCamera.test.ts` sweep (0 penetrations, 0 uncovered blocked
  segments, fade triggers only at the ship-tunnel min-clamp, all covered).
- `CameraOccluderFade` (`src/rendering/`, M8.6 Bug B §14, last resort):
  when pull-in reports no usable pose, fades the single reported solid /
  platform body mesh to 0.25 (presentation-only; ≤4 concurrent single-use
  clones, disposed on release; trims/rails/hazards/lava/portals never
  registered — `LevelView.occluderMeshes` + `MovingPlatformView.occluderMesh`).
- `ContactPulse` (`src/rendering/`, M9.3 island landing response):
  RendererHost edge-detects the grounded transition and pulses the touched
  support body mesh only (same registered mesh sets as the fade path;
  platform clones ride the mesh so ferry pulses follow the pose) — accent
  emissive clone (peak 2.5, 0.30 s decay), ≤4 slots, shared materials never
  mutated, `?fx=off` silences it; probes `contactPulseCount /
  lastContactPulseId / contactPulseIntensity` via `__gd3d`.
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
  warm `GLOBAL_HAZARD_COLOR` as the base fallback (`LevelTheme.hazard` stays on
  the type for data compatibility but is renderer-inert, pinned by
  `visualFoundation` cross-level resolution tests). Authored biome bands
  additionally select cached spike materials and fixed luminous outlines
  through `MaterialLibrary.spikeBiome`; timeline accents never repaint them.
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
  M9.1 overdrive: (a) ONE `InstancedMesh` architecture layer (~250 seeded
  towers, focal gate-arches at portal/orb/teleport/chomper/door positions,
  flanking walls, overhead canopies, bridges, columns — 1 draw, shared box
  geometry, per-instance biome colors baked by z at build, static forever;
  everything off-route |x| ≥ 8 or y ≥ 13, fogged, never colliders); (b) ONE
  pooled `LineSegments` lightning field (10 jagged bolts, 1 draw, shared
  additive material flashed by strong rhythm levels only — thresholded, no
  strobe); (c) ray peak 0.28 → 0.38 (still subordinate). The view reads
  `LevelDefinition` at build ONLY (focal z + section accents — LevelView /
  rhythmCues precedent); nothing per-frame, nothing in replays.
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
- `musicTrack.ts` (`src/audio/`, M9): the authored Gravity Lessons timeline
  as pure data + pure beat/section math (120 BPM grid, offset 0.06 s,
  arrangement sections, anchors, sim-time master `targetMusicTime`).
  THREE-free, DOM-free, clock-free. The simulation NEVER imports it
  (gameplay is authored to MATCH the map, never driven by it); the
  presentation (MusicDirector targets, rhythm pulses, alignment tooling)
  reads it. `MusicTrackRef` on `LevelDefinition` binds a track to a level
  (presentation-only: never fingerprinted, never replayed).
- `zenithTrack.ts` (`src/audio/`, M9.5): the authored Zenith of the Path
  timeline as pure data + pure beat/section math (120 BPM grid, offset
  0.03 s, 10 arrangement sections, anchors, 127.713 s duration) — same
  API shape as `musicTrack.ts`, which stays Gravity-only and untouched.
  Also owns the per-track rhythm resolution: `TrackGrid`
  (beatOffset/beatPeriod/beatAtTime/sectionAtTime),
  `gridForAudioPath()` (Gravity default — trackless levels and every
  existing caller byte-identical) and `pulseScaleForAudioPath()`
  (Rift 1.0 = full M9.1 overdrive legs, Descent 0.55 = cleaner
  response). `rhythmPulse.evaluate/update` take an optional grid
  (default Gravity); `RendererHost` resolves grid + scale from the
  level's `musicTrack.audioPath` and scales every pulse/impact leg
  (FP-exact at 1.0, so Gravity behavior is byte-identical);
  `Game.musicStatusLine` resolves the same grid for its section/beat
  readout. THE DESCENT declares Zenith offset 0; GRAVITY RIFT keeps
  Gravity Lessons.
- `MusicDirector` (`src/audio/`, M9): the ONE presentation owner of music
  transport (Web Audio buffer source: load/decode/readiness, play, pause
  as stop + offset record, resume, restart at origin, cut with short fade,
  seek/resync, mute, volume, transport state). Owned by `Game`
  (composition root), which coordinates lifecycle edges only: the
  press-to-start gate (tick-0 hold until the first gesture starts music +
  sim together), P pause/resume, death/respawn cut + origin restart, R
  restart, F4 replay restart, per-frame `syncToTarget(elapsedSimTime +
  offset)` with dead-band ±60 ms / resync beyond 180 ms (presentation-only
  correction — the sim is never touched). Injectable engine surface keeps
  the state machine unit-tested without a real AudioContext; every method
  is guarded so audio can never throw into gameplay or QA. Levels without
  `musicTrack` start immediately and stay silent (legacy behavior).
- `rhythmPulse.ts` (`src/visuals/`, M9): deterministic music-reactive
  visual modulation WITHOUT audio analysis — subdivision/beat/downbeat
  exponential envelopes as a pure function of sim-time music time +
  section-energy pump + section-entry impact envelope (render-dt decay,
  dt 0 freezes with pause). Composed into the timeline base look by
  `RendererHost.applyVisualState` (bloom/exposure/environment/beams/VFX
  legs, all re-clamped; beams retint in the section accent = automatic
  biome response), BELOW the event-punch overlay;   trigger-owned
  (`?triggers=off` silences it), music-level-gated (trackless levels
  bit-identical), `?music=off`-independent (authored rhythm, not heard
  audio). M9 `impact` event-punch family (warm red, Chomper-lunge edges)
  joins the same overlay.
- `MusicDirector` graph contract (M9.2 — the M9/M9.1 silence root cause):
  `startAt()` created the source AND the gain, connected gain →
  destination, and started the source WITHOUT ever connecting source →
  gain (the interface exposed no connection at all), so transport stayed
  green while nothing could reach the speakers. Now every live voice
  satisfies BUFFER SOURCE → MASTER GAIN → DESTINATION, wired in that
  order BEFORE `start()` via `engine.connectSourceToGain` (real nodes stay
  inside `WebAudioEngine` behind wrapper→node maps; fakes record the
  order); wiring failure aborts loud (`failed`), never silent `playing`.
  Probes: `sourceCreated/sourceConnected/gainConnected/effectiveGain` +
  `graphReady()` (connected + gain > 0 + context running — necessary, not
  audible proof; only the human gate proves speakers).
- `CheckpointView` (M9.2, owned by `RendererHost`): floating gem/crystal
  gates from level data — shared gem geometry, two shared crystal
  materials (translucent idle / bright active), one shared halo, one fixed
  4-material burst pool (the interaction pool is view-owned and cannot be
  shared); polls `isCheckpointActivated`, edge-detects
  `checkpointEventCount` for the section-accent-tinted burst + scale pop.
   Hidden in classic runs (`setCheckpointsVisible`); empty-group rule keeps
   checkpoint-less levels at zero extra children. Crystal visuals never
   affect triggers (simulation-owned swept volumes).
- `IslandHub` (`src/menu/`, M9.6): the menu's own Three.js scene — Descent
  island (teal tiers + waterfall + pool + floating-rock path) + Rift
  island (basalt + lava cracks + spike ring + skull-abstract) + 5
  stepping stones with flow pulses traveling toward the selected island
  + water + motes + per-island beacon/ring rigs + raycast pick proxies.
  Own renderer/canvas/rAF/materials (bounded ~50 draws, no post), own
  lifecycle (start/stop/dispose — AppController builds on every menu
  entry, disposes on every START; menu XOR session canvas). Selection
  state stays in `LevelSelectView`; the hub only mirrors it. Menu probes
  extended (`hubReady`, `hubSelected`, `hubBeacon`, programmatic select).
- `SpiderBeamView` (`src/rendering/`, M9.6): the snap transition language
  — pooled 2-slot vertical core + halo + instanced jagged strands + fast
  traveling packet + spray + block endpoint flashes between the exact sim
  snap anchors, ~0.32 s decay, mint spider accent, owned
  materials/geometries, edge-fired by `RendererHost` from
  `spiderSnapEventCount` (silenced by `?fx=off`, cleared on respawn/
  teleport, disposed with the host). The camera glide is untouched.
- `doorGaps.ts` (`src/level/`, M9.6.1): pure door-gap geometry (same-z
  gate grouping + committable openings ≥2.0 u across the corridor span,
  corridor rule single-owned) — consumed by LevelView gap frames and
  the auditor; THREE-free, unit-tested.
- Door gap frames (M9.6.1, `LevelView` merged edge lines): one bright
  white-cyan rectangle per opening (third paint range — constant, never
  re-tinted; dynamic accent + warm ranges untouched), zero new draws /
  materials / geometries.
- `LevelView` cold-batches static tops, undersides, rails, seams and door
  face trims by geometry/material into 96-unit cullable instanced chunks.
  Primary bodies in `occluderMeshes` retain individual meshes for camera
  fade; lava/waterfall and portal animation registries remain separate.
  Instance buffers are view-owned; shared library assets are not disposed
  by the batches. Route material world coordinates include instance
  transforms. Structural tests inspect all instance transforms, not only
  direct child Mesh objects.
  Authored biome spikes use cached core/socket materials and nine geometric
  socket recipes in `LevelView`, batched through this same trim owner.
  Socket relief stays within the base footprint and lowest 22% of the
  pyramid on all four mounts; the lethal cone/collider and tip are unchanged.
  `CameraOccluderFade` explicitly carries shader callbacks/cache keys into
  its bounded temporary clones (Three.js material copy omits them), so
  fading never removes an authored procedural biome surface.
- `biomeDressing.ts` (`src/level/`, M9.6.1): pure seeded midground
  placement (9 biome vocabularies, corridor clearance, caps) +
  `routeGroundAt` terrain query. Authored garden/temple landmarks supplement
  seeded scatter without entering the route. `EnvironmentView` cold-builds
  solids, glow accents, water/lava fall strands, route-face chips, and
  biome architecture into cullable `InstancedMesh` chunks (48 units for
  dense architecture/solid scenery/foliage, 96 for glow/flow layers) with shared
  geometry/materials and computed culling bounds. The architecture and
  route-face materials use world-space face shading/grain, so no repeated
  image tile is loaded. One shared eight-face octahedron adds 3D moss/
  pointed foliage lobes and mineral shards in sparse, irregular off-route
  clusters. Narrow trunks, folded leaves, roots, segmented lianas and
  raised moss replace broad green box masses. Basalt relief and stepped
  side cascades add source/fall/basin silhouettes, outside the corridor.
  Close broken banks and tiered cliff fingers create a physical midground
  boundary; organic banks carry raised moss and hanging roots, volcanic
  banks cracks, and service banks mechanical strips. World-space fine
  grain and directional face contrast add detail without image tiles.
  Reactor side shells carry inner-face service conduits/panels outside
  ±5.4; exterior machinery alone is hidden by the opaque tunnel shell.
  Route shader structures distinguish all nine biomes, including angular
  foundry clinker, temple carvings, void slate and segmented core circuits.
  Fall-strand shader time advances from the existing
  `updateMotes` render-dt path; pause freezes it, and no objects are
  allocated per frame. Chunking trades extra visible draws for substantially
  fewer submitted off-camera instances.
  Opt-in per level via `visualDressing` (Descent declares, Rift keeps
  its exact look). Snap-zone diamonds batch into the glow instancing
  (0 extra draws); gameplay lava volumes remain owned by level data.
- `sightline.ts` (`tests/helpers/`, M9.6.1): the headless telegraphing
  auditor (resolved-eye frustum + occlusion per tick, on-line filter,
  walk-off R-drop verdicts, spider destination readability) behind
  `tests/telegraphing.test.ts` — the executable GAME_DESIGN §7.10.
- `Hud` mode selector (M9.2): two buttons inside the start gate (one click
  = mode + audio unlock + start; bare clicks/keys default classic) + a
  run-mode badge and a `CHECKPOINT i/N — NAME` progress line. CSS keeps the
  HUD root pointer-transparent except the gate (canvas keeps container
  clicks; buttons stopPropagation). M9.4.1 adds the always-visible
  `☰ MENU` corner button (pointer-events re-enabled on the button only;
  `Hud.onMenuRequest` → `Game` opens the pause menu, same as ESC/P —
  presentation only, never gameplay input) and `Hud.dispose()`.
  M9.6: every menu/HUD/pause button blurs itself on activation (a focused
  native button re-fires on Space keyup — the post-menu spurious pause);
  `LevelSelectView` stages destination panels + an animated CLASSIC/
  CHECKPOINT slider over the hub (legacy `.m94-*` hooks kept for QA) and
  mirrors selection into the hub via `onSelectionChange` (3D picks enter
  through the same `select()` state).
- `LevelView.updatePortals` (M9.2): outer portal rings breathe ±4% on a
  slow z-phased sine (delta-from-build, pause freezes, trigger bounds
  untouched). `EnvironmentView` M9.2 dressing (all cold-built, bounded):
  abyss floor (one static biome-tinted bed at y −13.5, below the void
  bound — 1 draw), biome motes (one 240-point rising field, per-biome
  vertex colors, in-place wrap, pause freezes — 1 draw), lightning 10 →
  14 bolts with per-vertex biome tint, architecture towers 30 → 44 /
  walls 20 → 28 (still one instanced draw). Library delta: +7 materials
  (checkpoint idle/active/halo + 4 burst) + 1 geometry (gem octahedron);
  no new lights, no per-frame allocation.
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
  vertices retain their authored biome color or the warm fallback; view-owned buffer disposed with the view,
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
   up/eye/look (+ M8.6 ideal eye, pull-in distance, occluded/blocker-count,
   faded-occluder probes), live-camera world→screen projection (`screenPoint`), renderer
  stats, scene-child count, burst state, player velocity
  (`playerVelocity`, M8.5 — Ship PD regulation under headless
  time-dilation), platform poses (`platforms`, M8.6) + the deterministic
  platform clock (`platformTick`, M8.6 — pose-read ferry boarding in QA),
  and the debug-only `debugTeleport` placement aid for
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
- `tests/checkpoints.test.ts` (M9.2, 13 tests, synthetic runway + the real
  DESCENT): classic never activates (origin respawn), checkpoint starts at
  origin, activate-once, latest-wins, no-checkpoint death → origin, full
  state restore (speed/mode/lane/gravity/velocity/used sets), Chomper
  spent/dormant round-trip, platform tick + pose re-derivation, elapsed
  anchor + prev re-seat, classic trajectory bit-identity under detection
  (state-hash equality), R-from-checkpoint vs `restartRun()` clearing,
  conditional fingerprinting, and the DESCENT 8/8 activation on BOTH
  reference routes with the 13799-tick anchor preserved.
- `scripts/browser-qa-m92.mjs` (M9.2, 16 checks, system Chrome): asset
  bytes, selector gate at tick 0, CLASSIC graph wired (structural:
  sourceCreated + sourceConnected + gainConnected + effectiveGain 0.9 +
  graphReady + buffer ≈ 121.57), checkpoint start, cp-forge 1/8, death →
  respawn at the crystal with music re-seek to the checkpoint anchor +
  camera snap, latest-wins, R/Shift+R, the full `?music=off` ×
  {classic, checkpoint} matrix, fail-loud preservation, zero console/page
  errors. Transport/graph pass ≠ human audible pass (open gate).
- M9.2 visual evidence: `qa/screenshots/m92-biome-*` (per-biome stills,
  local-only) + the m91 BEFORE set for comparisons.
- `scripts/browser-qa-m95.mjs` (M9.5, 14 checks, system Chrome): menu
  (Zenith card copy), Descent CLASSIC Zenith graph wired (buffer ≈
  127.71, exactly one fetch) + Zenith-grid pulse proof, headless-tape
  injection finishing in-page REPLAY VERIFIED (8/8 Chompers spent),
  new-zone probes/screenshots, pause/resume + live-switch (no
  restart/seek) + menu disposal, Descent CHECKPOINT cp-forge + Zenith
  re-seek, Rift regression (graph + seek), repeat-switch isolation,
  zero console/page errors (`qa/screenshots/m95-*`).
- M9.5 legacy-gate migrations: `browser-qa-m94/m941/m942.mjs` assert the
  Zenith behavior on Descent (graph wired, target preserved across
  toggles, per-session fetch); `browser-qa-m92.mjs` stays Rift-only;
  chomper indices) — its full live-input run is environment-flaky on
  SwiftShader (proven by a pristine-HEAD control run failing the same
  way), so the deterministic in-page proof is the m95 tape injection.
- `scripts/browser-qa-m961.mjs` (M9.6.1, system Chrome): hub/menu
  regression, 6 snapmarks + bounded dressing probes, gap-frame
  legibility stills (A1/maze/foundry), spider snap-marker stills,
  per-act biome stills (human-judged from the PNGs), current-content
  tape injection finishing in-page REPLAY VERIFIED (8/8 Chompers
  spent — gameplay-identity proof for the visual pass), perf vs the
  Rift control (dressing ≈ +6 draws, +0 geometries), zero console/page
  errors (`qa/screenshots/m961-*`).
- M9.6.1 telegraphing QA: `tests/helpers/sightline.ts` (resolved-eye
  frustum + occlusion auditor) + `tests/telegraphing.test.ts`
  (both-route rule pins) + `tests/doorGaps.test.ts` (pure gap geometry)
  + gap-frame paint pins in `tests/edgeLines.test.ts` + snapmark
  coverage. M9.6.1 dressing QA: `tests/biomeDressing.test.ts`
  (determinism, bounds, caps, vocabulary, fingerprint-neutrality).

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
| Camera-to-player sight line: no opaque solid between eye and Cube after pull-in resolution, except fade-covered min-clamp | `cameraOcclusion` A–J + `showcaseCamera` both-route sweep + camera browser QA staged visibility |
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
| Base hazard identity remains warm; authored biome spikes may use fixed biome materials/bright outlines, preserving lethal pyramid semantics | `visualFoundation` base theme resolution + `biomeHazardStyle` authored spike palette/outline tests |
| DEBUG profiler bounded (ring ≤ capacity), off by default, sim-untouched; software rasterizers never a GPU pass | `perfProfiler` tests + `gpuIdentity()` probe + `perf-gate.mjs` evidence (M6D; M6D.1 headed `--real-gpu` mode, rules in `scripts/perfGateLib.mjs` + colocated tests) |
| Controlled bloom (contract-pinned), resize-safe post, playable no-post fallback | `visualFoundation` contract tests + browser QA m6a resize/fallback checks |
| VFX observes but never writes sim; sim imports no VFX/rendering/visuals; nothing visual in replays | `motionVfx` boundary + golden-integration tests + browser QA m6b replay checks |
| VFX pools bounded; no per-frame/per-event allocation; exact-once emission per real edge; reset on attempt/death/teleport; `?fx=off` preserves gameplay | `motionVfx` lifecycle tests + browser QA m6b section (counters, resets, resource guards, post×fx matrix) |
| Event punch envelope peaks/decays/composes by max with family tints; contact skid grounded-only, Floor/Ceiling-relative, speed-scaled, timeline-calmed, reset-safe; worst-case event volume << burst pool; sim trigger-free; punch excluded from replays; `?triggers=off` holds the envelope at rest | `eventPunch` tests + browser QA m6c2 section (peak/tint/rest-restore proofs, skid floor+ceiling, fallback split, replay proof, 26/8/3 guards) |
| Timeline section identity position-driven; state never accumulates/drifts; bloom ⇒ contract, exposure ⇒ 0.5..2; player/hazard stable; sequence excluded from fingerprint; sim trigger-free; transitions add zero draws/materials/geometries; `?triggers=off` restores exact base; nothing timeline in replays | `visualTimeline` tests + browser QA m6c1 section (interpolation bounds, identity pins, reset/replay proofs, 26/8/3 guards, fallback matrix) |
| M9.2 audio output path: every live voice is source → gain → destination, wired in order before start; wiring failure fails loud, never silent `playing` | `musicDirector` structural order test + fail-loud wiring test + graphReady pins + browser QA m92 graph assertion (never TRANSPORT PASS with no output path) |
 | M9.2 checkpoints: latest-wins activation, atomic full-state restore (incl. platform tick + elapsed anchor), classic bit-identity, R = checkpoint / Shift+R = full, session-scoped, replay-isolated | `checkpoints` tests + DESCENT 8/8 both-route activation pin + browser QA m92 checkpoint section |
| M9.5 per-track rhythm: Gravity grid default (existing callers/pulse byte-identical); Zenith grid + restrained pulse scale resolve from the level's track; chomper runtime order is triggerZ-sorted | `zenithTrack` map/resolution/scale tests + `rhythmPulse` default-path + Zenith-grid tests + `descentZenithAlignment` + browser QA m95 pulse/graph proof |
| M9.6 pointer primary action: taps drive the shared `space` edge (keyboard-identical downstream, replay-identical tapes); independent keyboard/pointer holds and presses, pointer-leave release, pending-edge purge on pause/blur; button contacts never become gameplay input; no leaked listeners across sessions | `inputPointer` tests (source overlap, rapid tap, fake-root edges, multi-touch, UI-target exclusion, disabled parity, detach/blur removal) + browser QA m96 tap-jump + spider-edge proofs |
| M9.6 focused buttons never re-fire gameplay Space (blur on activation) | Browser QA m96 C2 (Space after menu use jumps, never pauses) |
| M9.6 spider snaps observable (count + travel anchors) and ignored presses counted with reasons; 6-tick press buffer re-attempts ONLY the snap, clears on death/respawn/restart/mode-exit, rides snapshots; reference tapes unaffected | `spiderSnap` tests (anchors, no-support/blocked, buffer fire/expiry, restart clear, snapshot carry, determinism) + both-route anchors tick-exact + replay VERIFIED + browser QA m96 beam/anchor proofs |
| M9.6 hub: menu XOR session canvas (hub disposed on START, rebuilt on menu return); selection stays in LevelSelectView; legacy menu hooks intact | Browser QA m96 hub/slider/switching/disposal checks + migrated m94/m941/m942/m95 menu gates (m92 needs no canvas migration) |
| M9.6.1 telegraphing: on-line threats read in time (decision 0.7 / action 0.5 / routing 0.4 / drop-lead 0.2 / chomper 0.7, sequenced-door exception); door gaps framed; blind forced snaps marked; walk-offs fair | `sightline` auditor + `telegraphing` both-route pins + `doorGaps` units + gap-frame paint pins + snapmark coverage + browser QA m961 readability/completion shots |
| M9.6.1 dressing: authored/seeded route-adjacent 3D scenery, corridor-clear, capped, chunked/cullable instancing, 0 hot allocations, opt-in per level, fingerprint-neutral | `biomeDressing`/`overgrownDressing` units (determinism, bounds, caps, vocab, fingerprint) + browser QA m961 biome stills + per-act resource guard |
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
