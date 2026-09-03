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
- `CubeController`: owns Cube movement policy. Per step: lane intent
  (**edge-triggered only** — one tap = one lane change), lateral kinematics
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
  `MoveResult` (floor/ceiling/wall contacts); `probeGroundSupport` for stable
  grounded state at zero vertical velocity. No tunneling at high speed
  (tested incl. 4× forward speed vs thin walls).
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
  `attempts`, `elapsedSimTime`, 0.45 s `deathHoldTimer`. Single
  `die()`/`respawn()`/`restart()` paths. Emits `onDeath`/`onFinish`/`onJump`.
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
- `LevelView` (shared geometries/materials), `EnvironmentView` (fog,
  deterministic starfield/pillars — seeded PRNG, visuals only), finish gate.
- `Hud`: level name, real progress %, attempt count, key help, messages.
- `DebugOverlay` (F1 text stats) + `DebugView` (F2 collider wireframes,
  F3 player hitbox).

## 9. QA (`tests/`, `scripts/`, `qa/`)

- Unit/integration: `fixedStep` (timestep, cadence invariance on INTEGER step
  counts, clamp, spiral guard, alpha range), `controller` (determinism, jump,
  repeat-jump, fast-fall, lanes, air lanes), `collision` (grounding,
  penetration, frontal kill, anti-tunneling, void death, data-driven loading).
- `scripts/browser-qa.mjs`: headless Chromium gameplay harness (Playwright) —
  console audit, input sequences, `window.__gd3d` probes, PNG + JSON
  provenance sidecars in `qa/screenshots/` (git-ignored, regenerable).
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
| Reference PNGs never runtime assets | Repo/runtime search + visual review |
| No milestone passes with failing verification | `npm run verify` + `AGENTS.md` process rule |

## 11. Known non-defects / deferred perf notes (M1)

- `CollisionWorld.queryBox` allocates a small dedupe `Set` per call and the
  support probe allocates a candidate array per step — acceptable at M1 scale;
  revisit in the M6 performance pass, not before.
- `GameSimulation.restart()` has a redundant branch (both paths respawn) —
  harmless, intentional minimal churn.
