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

Owns raw keyboard → logical actions (`jump`, `fastFall`, `laneLeft`,
`laneRight`). Per-step immutable `InputSnapshot` with `held` /
`pressedThisStep` / `releasedThisStep` edge semantics. `ArrowUp`+`Space` merge
into one jump action; OS auto-repeat ignored. Tests build snapshots directly —
no browser needed. `Game` owns separate non-gameplay keys (`R` restart,
`P` pause, `F1/F2/F3` debug) — a distinct domain from gameplay input.

## 4. Player (`src/player/`)

- `playerState.ts`: `PlayerState` — center position, velocity, `grounded`,
  `targetLaneIndex` (INTENT, not position), `laneCount`, `gravityMode`,
  `supportColliderId`. Single velocity representation.
- `gameplayFrame.ts`: `GameplayFrame` — explicit `forwardAxis`,
  `gravityVector`, `surfaceNormal`, `laneAxis` data. M1 always Floor; future
  modes change frame DATA, not controller code. `laneAxis` is explicit, never
  derived from a cross product (no control mirroring on ceiling/walls).
  M1.1 convention: increasing lane index runs toward screen-right, so the M1
  Floor laneAxis is −X (the +Z chase camera shows −X on the right).
- `CubeController`: owns Cube movement policy. Per step: lane intent
  (**edge-triggered only, unclamped since M1.2** — one tap = one lane change;
  taps past the outer lane address virtual lanes via `laneCenterForIndex`
  linear extrapolation, so side exit is possible where support runs out),
  lateral kinematics
  (accelerate/cruise/analytic-brake/settle-snap, hard geometric no-overshoot
  cap), vertical kinematics (gravity + fast-fall + terminal speed), jump
  (grounded AND held → deterministic impulse replacing the along-gravity
  component), constant forward speed. Computes velocities only — never moves
  positions (integration + collision belong to the simulation).
- `cubeTuning.ts`: ALL gameplay magic numbers live here (see `GAME_DESIGN.md`
  §2 for values). Tune by playing, not by theory.

## 5. Collision (`src/collision/`)

- `collider.ts`: explicit gameplay collider categories (`solid`, `hazard`,
  `killFront`); exact single-axis swept query (`sweepAxis`, Minkowski-slab,
  deterministic, no iteration). Visual geometry is NEVER the collider.
- `CollisionWorld`: spatial-hash (X/Z) broadphase, level-load registration,
  caller-owned output arrays for queries.
- `moveAabb.ts`: axis-separated swept movement in Y → Z → X order; per-step
  `MoveResult` (floor/ceiling/wall contacts) plus the post-Y/post-Z clip
  positions that record the authoritative swept path for hazard tests;
  `probeGroundSupport` for stable grounded state at zero vertical velocity.
  The probe tests the full support footprint (minus a 0.02 skin): partial
  overlap still grounds (edge teeter), only full exit ungrounds → airborne →
  gravity → death plane. No tunneling at high speed (tested incl. 4× forward
  speed vs thin walls).
- Blocking kinds are `solid` AND `killFront` (identical clipping + support;
  `hazard` never blocks). The frontal-kill DECISION lives in `GameSimulation`
  (contact normal opposing forward + forward approach velocity), never in
  kind checks — side/top contacts on either kind block or ground safely.
- Determinism: per axis the strictly smallest TOI wins; ties keep the first
  candidate in `CollisionWorld` query order (cell-index, then level insertion
  order) — deterministic per level, pinned by run-it-twice tests.
- No general physics engine, no ECS (permanent constraint unless justified).

## 6. Level (`src/level/`, `src/content/levels/`)

- `levelDefinition.ts`: declarative `LevelDefinition` (id, display name,
  start, `startLaneIndex`, `laneCenters`, speeds, `finishZ`, `deathY`, solids,
  hazards, theme). Engine code must not hardcode level coordinates.
- `levelRuntime.ts`: `loadLevel` builds the `CollisionWorld` (pure, no THREE);
  `computeProgress` derives [0,1] progress from real forward distance.
- `testLevel01.ts`: controller test track (gaps ≤ 6.5 u, steps ≤ 1.7 u per
  jump limits; forced lane-change wall; spike weave; void gaps; finish gate).

## 7. Simulation (`src/game/`)

- `GameSimulation`: headless orchestration per fixed step — controller →
  integrate+collide → grounding → death/finish checks. Owns `prevPosition`
  for render interpolation, `status` (`running`/`dead`/`finished`),
  `attempts`, `elapsedSimTime`, 36-tick `deathHoldTicksLeft` (0.30 s) with
  integer-tick authority. Single `die()`/`respawn()`/`restart()` paths
  (`restart()` converges to one `respawn()` from any status); `die(cause)` is
  idempotent with `deathCause` (`hazard` | `frontImpact` | `void`), stable
  `lastDeathCause`/`lastDeathLethalId` records, `deathPosition`, `deathId`
  counter (VFX edge), lethal id, contact normal, pre-impact velocity.
  Emits `onDeath`/`onFinish`/`onJump`. Hazard kills use EXACT swept-path CCD:
  a hazard must overlap one of the three single-axis swept segment volumes of
  the authoritative Y → Z → X path (prev → afterY → afterZ → final, including
  solid clipping), via `sweptSegmentAabb`/`sweptPathOverlaps` in `collider.ts`
  — the loose pre/post union box remains only as the broadphase superset. No
  thin-hazard skipping at speed, no false kills in never-visited corners.
- `Game`: composition root only (input → sim → renderer → UI). No gameplay
  logic. Owns pause, FPS EMA, debug toggles.

## 8. Presentation (`src/camera/`, `src/rendering/`, `src/ui/`, `src/debug/`)

- `ChaseCamera` (pure math): track-centered + tiny damped bias (max 0.55 u,
  factor 0.12), follow 8.5 / height 4.2 / look-ahead 10 / FOV 62, no roll,
  render-dt smoothing only. Applied to the THREE camera by `RendererHost`.
- `RendererHost`: SOLE owner of `WebGLRenderer`. Per frame interpolates
  visuals between `prevPosition`→`position` (gameplay never interpolates),
  advances camera, exposes `renderer.info` stats. DPR capped at 1.5.
- `PlayerView`: original procedural cyan cube (visual 1.24 vs collider 1.1);
  airtime tumble is render-only and snaps to rest on landing. Collider and
  mesh are independent by construction (debug F3 visualizes the real hitbox).
  Visibility follows sim status (hidden while dead), applied in `RendererHost`
  so debug frame-freezes capture true death frames.
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
  portals), center seams on faces ≥ 6 wide; solids < 0.8 tall and all hazards
  untouched — no new systems), `EnvironmentView` (fog,
  deterministic starfield/pillars — seeded PRNG, visuals only), finish gate.
- `Hud`: level name, real progress %, attempt count, key help, messages.
- `DebugOverlay` (F1 text stats, incl. latched last-death record:
  cause/lethal/hold/contact-normal/pre-impact-velocity) + `DebugView` (F2
  collider wireframes, F3 player hitbox). `__gd3d` probes expose death cause,
  lethal info, renderer stats, scene-child count, burst state for browser QA.

## 9. QA (`tests/`, `scripts/`, `qa/`)

- Unit/integration: `fixedStep` (timestep, cadence invariance on INTEGER step
  counts, clamp, spiral guard, alpha range), `controller` (determinism, jump,
  repeat-jump, fast-fall, lanes, air lanes), `collision` (grounding,
  penetration, frontal kill, anti-tunneling, void death, data-driven loading),
  `death` (M2: frontal/side/top killFront semantics, causes, exactly-once
  + idempotent death, 36-tick hold, attempt accounting, R semantics, freeze
  + full reset, finish-after-death, determinism, spike fairness pins).
- `scripts/browser-qa.mjs`: headless Chromium gameplay harness (Playwright) —
  console audit, input sequences, `window.__gd3d` probes, PNG + JSON
  provenance sidecars in `qa/screenshots/` (git-ignored, regenerable).
  M2 section: wall/spike/void/fall deaths, burst visible + cleared, 10×
  die/respawn leak guard (scene children + draw calls flat), R-from-dead,
  camera reset, F1 death record, `m2-*` screenshots (burst held via the
  freeze/replay debug path after a page reload for compositor freshness).
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
| Input preserves held/pressed/released edges | `InputSystem` + controller edge tests |
| Camera not parented; lateral bias bounded | `ChaseCamera` tuning + code review |
| Swept collision, no tunneling at speed | `collision` anti-tunneling tests |
| Frontal kills, lateral/top contacts safe (either blocking kind) | `death` killFront semantics tests + browser QA |
| Death exactly-once; attempts +1 per respawn/restart only | `death` event/attempt tests |
| 36-tick death hold; respawn fully resets | `death` tick + reset tests |
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
