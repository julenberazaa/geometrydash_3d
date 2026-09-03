# GAME_DESIGN.md — Canonical Gameplay Contract

> Authority for **product/gameplay behavior**. Implementation follows this file;
> implementation difficulty never justifies silently changing it (see
> `AGENTS.md` §4). Each section is marked **CURRENT** (shipped, tested) or
> **PLANNED** (future milestone).

Product priority order (applies to every tradeoff):

1. Quality of control and fun
2. Visual quality and gameplay readability
3. Conceptual fidelity to precision auto-run arcade gameplay
4. Viral / immediate visual appeal
5. Architecture / editor / community infrastructure

## 1. Core loop — CURRENT

Automatic forward motion through a 3D track. Deterministic precision gameplay:
instant death on mistakes, fast restart (<~500 ms feel), memorable
data-driven levels. Lanes instead of free horizontal movement. No checkpoints,
no Practice Mode initially.

## 2. The Cube — CURRENT

The Cube runs on a gravity surface (Floor or Ceiling — see §6). All movement
math is expressed through the gameplay frame (`forwardAxis`, `gravityVector`,
`surfaceNormal`, `laneAxis`); the world NEVER rotates and the camera NEVER
rolls when gravity changes.

- **Auto-forward:** the player always moves forward at level base speed
  (Test Level: 14 units/s along +Z). No manual longitudinal control.
- **Jump:** `Space` is ALWAYS the jump key. The directional jump key depends
  on the current gravity surface:
  - Floor: `ArrowUp` or `Space` = fixed-impulse jump away from the floor.
  - Ceiling: `ArrowDown` or `Space` = fixed-impulse jump away from the
    ceiling (downward, then gravity pulls back up).
  No variable-height hold behavior. Holding jump causes an immediate re-jump
  after every valid landing (hold-to-repeat), never a mid-air extra jump.
  - Impulse 13.2 u/s, gravity 42 u/s² → apex ≈ 2.07 units, airtime ≈ 0.63 s,
    forward distance ≈ 8.8 units (identical on both surfaces, mirrored along
    gravity).
- **Fast-fall:** airborne, the key pointing INTO the current gravity surface
  adds extra acceleration along gravity (+55); on the surface it does nothing.
  - Floor: airborne `ArrowDown`.
  - Ceiling: airborne `ArrowUp`.
- **Lanes:** `ArrowLeft`/`ArrowRight` change the *target lane index*. On BOTH
  surfaces `ArrowRight` ALWAYS moves the Cube toward **screen-right** and
  `ArrowLeft` toward screen-left — flipping gravity never mirrors lanes.
  Physical lateral position is **continuous**
  (accelerate → cruise → analytic braking → settle/snap; max lateral speed
  16 u/s), participates in collision, and remains substantially correctable
  **while airborne**.
  - Test Level: 3 lanes, index 0/1/2 = screen-left/center/screen-right
    (world x = +2.6 / 0 / −2.6 — the +Z chase camera shows −X on the right;
    lane order fixed in M1.1, see `GameplayFrame` convention). Architecture
    supports arbitrary lane definitions per level.
  - **Lateral fall-off (M1.2):** intent is NOT clamped at the outer lanes.
    An outward tap past the edge lane steps onto a *virtual* lane one
    spacing beyond (centers linearly extrapolated). The first step teeters
    at the slab edge while the support footprint still overlaps; a further
    outward tap leaves support entirely: the Cube goes airborne, moves under
    gravity (falls on Floor, rises on Ceiling), and dies at the matching void
    bound unless support is recovered. Side exit is physical and
    support-based — no invisible side walls, no instant side kill. Side
    contact with real geometry (lane markers, walls) blocks movement without
    killing.
  - **PROVISIONAL (M1):** each lane transition requires a distinct left/right
    press edge; holding a lane key does NOT slide across multiple lanes. This
    is pending human-feel evaluation — do not treat it as final design.

## 3. Collision and death — CURRENT

- Predictable AABB hitboxes. The gameplay collider (1.1³ cube) NEVER rotates —
  visual tumble is render-only; rest orientation aligns to the surface normal
  (upside-down on the Ceiling).
- High-speed collision must not tunnel (swept per-axis movement, Y → Z → X;
  hazard overlap is tested against that exact swept path — the union of the
  three single-axis swept segment volumes, not a loose pre/post bounding
  rectangle — so corners the Cube's path never enters cannot falsely kill).
- Frontal impact kills (kill-front arcade semantics), decided from contact
  geometry + motion: a wall contact whose normal opposes the forward axis
  while approaching along forward kills — identical on Floor and Ceiling.
  Side scrapes (±X contacts) block without killing; landings on the
  gravity-opposed surface (top on Floor, underside on Ceiling) are always safe.
- Blocking kinds are `solid` and `killFront` (identical movement blocking and
  ground support; `killFront` marks visually lethal fronts for future content
  and kills only via the same frontal rule — never by kind alone or by
  overlap). `hazard` never blocks. Spike gameplay boxes are intentionally
  smaller than their visuals (fairness margin).
- **Support:** "grounded" means resting against a blocking surface OPPOSING
  gravity — below the Cube on Floor, above it on Ceiling. Partial footprint
  overlap still grounds (edge teeter).
- Hazards kill on overlap; leaving the level's playable vertical bounds kills
  (lower `deathY` on Floor falls, optional upper `deathYMax` on Ceiling
  falls/launches).
- Death: instantaneous at the lethal step, tagged with a cause
  (`hazard` | `frontImpact` | `void`, internal/debug), exactly-once event,
  short visual hold (0.30 s / 36 ticks) with a brief procedural burst,
  deterministic respawn at start (restoring the level's start gravity mode).
  Attempts increment exactly once per respawn/restart, never on death itself;
  manual `R` restart is not death. `R` restarts immediately from any state.
  Finish can never trigger after death. Falling out of bounds after a lateral
  (or forward) exit completes through this same path — side falls are never
  instant kills. Lethal contact in a simulation step is never undone by a
  gravity portal (death wins the step).

## 4. Camera — CURRENT

Third person: behind and elevated, anchored to track center (NOT parented to
the player), small damped lateral bias only (never mirrors lane movement 1:1),
look-ahead down-track, never rolls. Gentle vertical parallax follows the
player so ceiling runs stay framed; `camera.up` remains world +Y on every
gravity surface.

## 5. Levels — CURRENT

Data-driven. Engine (`GameSimulation`, `CubeController`, collision) is
separated from level content (`LevelDefinition`) and visual theme. A new level
is a new data file plus zero engine changes. A level declares: geometry
(solids/hazards), lanes, speeds, `finishZ`, void bounds (`deathY`, optional
`deathYMax`), start gravity mode (default Floor), and gravity portals.

## 6. Gravity surfaces and transitions — CURRENT (Floor/Ceiling); walls PLANNED

Gravity is a real gameplay state owned by the simulation. Two surfaces ship:

- **Floor:** gravity −Y, surface normal +Y (the original approved gameplay).
- **Ceiling:** gravity +Y, surface normal −Y — the Cube physically runs on the
  UNDERSIDE of slabs. The world stays stationary; the camera stays level.

**Gravity portals** are data-driven level objects (`id`, crossing plane `z`,
`target` mode). Crossing the plane in the forward direction flips gravity
exactly once per attempt: world position is NOT teleported, all velocity is
preserved (no impulse, no snap), grounded/support is cleared immediately, and
the Cube visibly accelerates toward the new gravity surface. Portals reset
after respawn/restart. Visually each portal is a neon gateway spanning the
route (cyan = flip up, warm = flip down); triggering never depends on
renderer, camera, or visuals.

Primary future state: Left wall (−X) / Right wall (+X) gravity (PLANNED).
Frame data and lane conventions are designed so walls can be added without
mirroring controls; wall gravity itself is not implemented.

## 7. Out of scope for the current foundation

Ship mode, orbs, pads, speed portals, moving hazards, final VFX, music/BPM
sync, public editor, backend, persistence. See `ROADMAP.md`.

## 8. Reference art

`normal.png` / `cohete.png` / `arriba.png` are visual MOOD references only
(neon-on-dark modular 3D, cyan player, orange hazards, readable void). All
gameplay is real runtime 3D geometry. Never ship reference pixels.
