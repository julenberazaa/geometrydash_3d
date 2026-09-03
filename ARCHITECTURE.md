# ARCHITECTURE.md — Actual System Boundaries and Invariants

> Authority for **technical structure**. Documents the code as it IS. When code
> changes an architectural fact, update this file in the same commit
> (`AGENTS.md` §10).

## 1. Dependency direction

```text
main.ts → Game (composition root)
  Game → InputSystem → GameSimulation → { CubeController, CollisionWorld, LevelRuntime }
  Game → RendererHost → { LevelView, PlayerView, EnvironmentView, DebugView, ChaseCamera }
  Game → Hud, DebugOverlay
```

Hard boundary: **simulation never imports Three.js, DOM, or CSS.**
Verified: only `src/rendering/*` and `src/debug/DebugView.ts` import `three`.
Rendering observes simulation state; it never writes gameplay state.

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
  §2 for values). Tune by playing, not by theory.

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
  `gravityPortals` (id + crossing Z + target mode), solids, hazards, theme).
  Engine code must not hardcode level coordinates, void heights, or gravity
  content.
- `levelRuntime.ts`: `loadLevel` builds the `CollisionWorld` (pure, no THREE)
  and the Z-sorted portal list; `computeProgress` derives [0,1] progress from
  real forward distance.
- `testLevel01.ts`: controller test track (gaps ≤ 6.5 u, steps ≤ 1.7 u per
  jump limits; forced lane-change wall; spike weave; void gaps; finish gate)
  plus the appended M3 gravity section (z 176..278: Floor → portal up →
  ceiling run → ceiling gap → portal down → Floor → finish).

## 7. Simulation (`src/game/`)

- `GameSimulation`: headless orchestration per fixed step — controller →
  integrate+collide → grounding → gravity portals → death/finish checks. Owns
  the AUTHORITATIVE gravity mode (`gravityMode`, reset to the level start mode
  by `respawn()`), the prebuilt per-mode `gameplayFrame`, and the input
  interpretation. Step order: controller (input interpreted with the
  pre-portal mode) → Y→Z→X swept move → frontal kill → grounding (support
  probe along gravity + head-bump cancel) → gravity portal crossings → void
  bounds → hazard CCD → finish. Death at any earlier point wins the step
  (lethal contact is never undone by a portal). Owns `prevPosition`
  (also the portal forward-crossing reference) for render interpolation,
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
  solid clipping), via `sweptSegmentAabb`/`sweptPathOverlaps` in `collider.ts`
  — the loose pre/post union broadphase box remains only as a superset. No
  thin-hazard skipping at speed, no false kills in never-visited corners.
  **Gravity portals (M3):** deterministic forward-crossing on the swept step
  path (`prevZ < portal.z ≤ currentZ`), processed in ascending Z order (the
  furthest crossed portal wins). A transition flips the authoritative mode,
  clears grounded/support, and preserves world position and ALL velocity
  components (no teleport, no impulse, no snap); crossing a plane whose
  target equals the current mode is a no-op. Debug/QA surface:
  `lastPortalId` (reset per attempt) + monotonic `portalTransitionCount`.
  Debug-only `debugPlaceAt(x,y,z)` exists for browser QA placement (same
  category as the renderer's debug aids; never called by gameplay).
- `Game`: composition root only (input → sim → renderer → UI). No gameplay
  logic. Owns pause, FPS EMA, debug toggles.

## 8. Presentation (`src/camera/`, `src/rendering/`, `src/ui/`, `src/debug/`)

- `ChaseCamera` (pure math): track-centered + tiny damped bias (max 0.55 u,
  factor 0.12), follow 8.5 / look-ahead 10 / FOV 62, no roll, render-dt
  smoothing only. Gravity-aware VERTICAL framing (M3.1): an explicit
  `CameraFocusSide` (`'aboveFocus' | 'belowFocus'`) selects the height
  formula — Floor: `playerY * 0.35 + 4.2` (elevated, unchanged); Ceiling:
  `playerY * 0.15 + 3.4` so the eye hangs mid-corridor BELOW the cube
  (settles y ≈ 4.22 vs cube 5.45) and can never be pulled up into the slab
  the player runs under — the pre-M3.1 gravity-blind formula put the eye at
  y ≈ 6.11, INSIDE the slabs (proven: 343 penetrating steps, worst 0.157 u;
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
- `DebugOverlay` (F1 text stats, incl. the live gravity frame (mode,
  gravityVector, surfaceNormal, laneAxis), support id, last portal id +
  transition count, and the latched last-death record:
  cause/lethal/hold/contact-normal/pre-impact-velocity) + `DebugView` (F2
  collider wireframes, F3 player hitbox). `__gd3d` probes expose death cause,
  lethal info, gravity mode/portal state, support id, camera up/eye/look,
  live-camera world→screen projection (`screenPoint`), renderer stats,
  scene-child count, burst state, and the debug-only
  `debugTeleport` placement aid for browser QA.

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
  underside inset pinned).
- `scripts/m32-audit.mjs`: M3.2 measurement tool (dev tool, not part of the
  verify gate) — freezes deterministic floor/ceiling framings and measures
  geometric parity (eye distance, screen placement, apparent cube size,
  surface-visibility profile) + pixel parity (cube/contact-band luminance)
  into `qa/screenshots/m32-audit-*`.
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
| Swept collision, no tunneling at speed | `collision` anti-tunneling tests |
| Frontal kills, lateral/top contacts safe (either blocking kind, either surface) | `death` killFront semantics tests + `gravity` tests + browser QA |
| Death exactly-once; attempts +1 per respawn/restart only | `death` event/attempt tests |
| 36-tick death hold; respawn fully resets (incl. gravity mode) | `death` tick + reset tests + `gravity` tests |
| Gravity portals: exactly once per attempt, no teleport, support cleared, death wins the step | `gravity` portal/precedence tests + browser QA |
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
