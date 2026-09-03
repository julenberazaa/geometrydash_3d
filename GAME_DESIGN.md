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

## 2. Cube on the floor — CURRENT

- **Auto-forward:** the player always moves forward at level base speed
  (Test Level: 14 units/s along +Z). No manual longitudinal control.
- **Jump:** `ArrowUp` or `Space` = fixed-impulse jump. No variable-height hold
  behavior. Holding jump causes an immediate re-jump after every valid landing
  (hold-to-repeat), never a mid-air extra jump.
  - Impulse 13.2 u/s, gravity 42 u/s² → apex ≈ 2.07 units, airtime ≈ 0.63 s,
    forward distance ≈ 8.8 units.
- **Fast-fall:** airborne `ArrowDown` adds extra downward acceleration (+55);
  grounded `ArrowDown` does nothing.
- **Lanes:** `ArrowLeft`/`ArrowRight` change the *target lane index*.
  `ArrowRight` ALWAYS moves the Cube toward **screen-right**, `ArrowLeft`
  toward screen-left. Physical lateral position is **continuous**
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
    outward tap leaves support entirely: the Cube goes airborne, falls under
    gravity, and dies at the death plane unless support is recovered. Side
    exit is physical and support-based — no invisible side walls, no instant
    side kill. Side contact with real geometry (lane markers, walls) blocks
    movement without killing.
  - **PROVISIONAL (M1):** each lane transition requires a distinct left/right
    press edge; holding a lane key does NOT slide across multiple lanes. This
    is pending human-feel evaluation — do not treat it as final design.

## 3. Collision and death — CURRENT

- Predictable AABB hitboxes. The gameplay collider (1.1³ cube) NEVER rotates —
  visual tumble is render-only.
- High-speed collision must not tunnel (swept per-axis movement, Y → Z → X;
  hazard overlap is tested against that exact swept path — the union of the
  three single-axis swept segment volumes, not a loose pre/post bounding
  rectangle — so corners the Cube's path never enters cannot falsely kill).
- Frontal impact kills (kill-front arcade semantics), decided from contact
  geometry + motion: a wall contact whose normal opposes the forward axis
  while approaching along forward kills. Side scrapes (±X contacts) block
  without killing; top landings are always safe.
- Blocking kinds are `solid` and `killFront` (identical movement blocking and
  ground support; `killFront` marks visually lethal fronts for future content
  and kills only via the same frontal rule — never by kind alone or by
  overlap). `hazard` never blocks. Spike gameplay boxes are intentionally
  smaller than their visuals (fairness margin).
- Hazards kill on overlap; falling below the level death plane kills.
- Death: instantaneous at the lethal step, tagged with a cause
  (`hazard` | `frontImpact` | `void`, internal/debug), exactly-once event,
  short visual hold (0.30 s / 36 ticks) with a brief procedural burst,
  deterministic respawn at start. Attempts increment exactly once per
  respawn/restart, never on death itself; manual `R` restart is not death.
  `R` restarts immediately from any state. Finish can never trigger after death.
  Falling below the death plane after a lateral (or forward) exit completes
  through this same path — side falls are never instant kills.

## 4. Camera — CURRENT

Third person: behind and elevated, anchored to track center (NOT parented to
the player), small damped lateral bias only (never mirrors lane movement 1:1),
look-ahead down-track, never rolls.

## 5. Levels — CURRENT

Data-driven. Engine (`GameSimulation`, `CubeController`, collision) is
separated from level content (`LevelDefinition`) and visual theme. A new level
is a new data file plus zero engine changes.

## 6. Gravity futures — PLANNED (not implemented)

Gravity changes the actual gravity vector; the world does NOT rotate and the
camera does NOT roll to fake orientation. The Cube will physically run on the
ceiling / walls. Primary future states: Floor (−Y), Ceiling (+Y), Left wall
(−X), Right wall (+X). Input semantics stay relative to the gameplay frame
(`forwardAxis`, `gravityVector`, `surfaceNormal`, `laneAxis` — explicit data,
never cross-product-derived mirroring).

## 7. Out of scope for the current foundation

Ship mode, gravity portals, orbs, pads, speed portals, moving hazards,
final VFX, music/BPM sync, public editor, backend, persistence. See `ROADMAP.md`.

## 8. Reference art

`normal.png` / `cohete.png` / `arriba.png` are visual MOOD references only
(neon-on-dark modular 3D, cyan player, orange hazards, readable void). All
gameplay is real runtime 3D geometry. Never ship reference pixels.
