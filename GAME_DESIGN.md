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
  instant kills. A lethal step NEVER applies a gravity transition: lethal
  checks (frontal, void, hazard) precede portal processing, so a step that
  kills the player keeps the pre-step gravity mode and portal state (death
  wins the step).

## 4. Camera — CURRENT

Third person: behind, anchored to track center (NOT parented to the player),
small damped lateral bias only (never mirrors lane movement 1:1), look-ahead
down-track, never rolls; `camera.up` remains world +Y on every gravity
surface. The vertical framing follows the gravity surface (M3.1): on Floor
the camera is elevated above the cube; on Ceiling it frames the cube from
BELOW, hanging in the open corridor under the slab, looking up at the
contact surface. The framing side flips only with the authoritative gravity
mode and the existing damped smoothing turns it into a short glide — the
camera eye must never enter blocking geometry (pinned by
`tests/cameraFraming.test.ts`).

**Surface-relative projection symmetry (M3.3):** the Cube face OPPOSITE the
support surface (the FREE face — top face on Floor, bottom face on Ceiling)
must project with the same apparent size and perspective from the chase
camera on every gravity surface. The ceiling framing is therefore the exact
mirror of the Floor framing: the rest eye sits the SAME distance on the
free-face side of the cube on both surfaces (3.84 u above on Floor, 3.84 u
below on Ceiling; projected free-face area ratio pinned at 1 within
0.98..1.02 in tests, 0.90..1.10 acceptance). The rule is expressed
surface-relatively (free face = the face on the `surfaceNormal` side; eye
offset along the free-face normal) so future gravity surfaces inherit it.
Presentation only — no camera roll, no world rotation, no gameplay
difference, no Cube-scale or FOV tricks.

**View parity (M3.2):** the ceiling must never be harder because of the VIEW.
Because the below-focus eye makes the Cube's own silhouette partially occlude
the ceiling run surface a few units ahead, ceiling run surfaces carry the
SAME neon edge-rail language as the floor track (underside rails on exposed
undersides) so corridor boundaries and gap edges stay readable beside the
silhouette.

## 5. Levels — CURRENT

Data-driven. Engine (`GameSimulation`, `CubeController`, collision) is
separated from level content (`LevelDefinition`) and visual theme. A new level
is a new data file plus zero engine changes. A level declares: geometry
(solids/hazards), lanes, speeds, `finishZ`, void bounds (`deathY`, optional
`deathYMax`), start gravity mode (default Floor), and gravity portals.

Two levels ship (selected via `?level=<id>`, default Test Level):

- **Test Level 01** (`controller-test-01`): the controller/gravity/
  interaction demo track with the M3 gravity section and the M4
  interaction section.
- **Validation Level 02** (`validation-02`, M5): the engine-portability
  proof — different start lane, slower base speed (11 u/s), spike weave,
  gap jump, ceiling run with a REQUIRED ceiling pad, ceiling gap, gravity
  orb return, 2× speed gap, final weave, real finish (~20 s). A validation
  and verification level, NOT the final production level.

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

## 6.1 Interactive mechanics — CURRENT (M4)

All interactions are data-driven level content (`LevelDefinition`); the
simulation owns every activation. Detection uses the EXACT swept-path test
(the same primitive as hazard CCD), so no interaction can be skipped at any
speed, and no volume the path never entered can falsely trigger. Lifecycle is
one-shot per interaction id per attempt; death/`R` reset everything (used
flags, speed tier, gravity mode).

- **Trigger order (per fixed step):** controller → integrate/collide →
  frontal kill → grounding → LETHAL CHECKS (void, hazards) → jump pads →
  jump orbs → gravity orbs → speed portals → gravity portals → finish.
  A lethal step terminates before ANY interaction or portal mutates state —
  no interaction can rescue, rewind, or re-tag a death.
- **Jump pads (passive):** contact/crossing fires them — never a button.
  The velocity component along the pad's surface normal (floor pad +Y,
  ceiling pad −Y) is REPLACED with the pad's explicit `impulse` (Test Level
  floor pad: 22 u/s vs jump 13.2); lateral/forward preserved; support
  cleared. No input semantics, no multi-fire while overlapping.
- **Jump orbs (active):** require a press EDGE of the logical jump action
  (Space OR the gravity-appropriate arrow — identical merge to the Cube
  jump) during a fixed step whose swept path overlaps the orb window.
  Press-edge only: held input inherited from before the window does
  nothing, and there is NO input buffer (a press the step before entering
  expires). Effect: velocity along the CURRENT surface normal replaced with
  the orb's `impulse` (gameplay-frame relative; works airborne; supersedes
  a same-step ground jump deterministically). One press = one activation.
- **Gravity orbs (active):** same input-window semantics; flips Floor ↔
  Ceiling through the SAME transition as gravity portals (world position and
  ALL velocity preserved, support cleared, no world/camera rotation). One
  press = one flip; oscillation is impossible (one-shot per attempt).
- **Speed portals (passive):** deterministic forward-crossing plane
  (`prevZ < z <= currentZ`, ascending Z, furthest crossed wins) setting the
  authoritative speed multiplier (content tiers 0.5×/1×/2×/3×/4×). No
  teleport, no impulse. There is ONE speed authority: the level's
  `baseForwardSpeed` × the simulation's current multiplier, delivered to the
  controller per step. Respawn/`R` restores the level's
  `startSpeedMultiplier` (default 1).
- **Fairness windows:** orb activation windows are generous AABBs (Test
  Level: ~1.8 u across) and sit ABOVE the grounded envelope where a
  grounded-running press must not accidentally fire (gravity orb); visuals
  are slightly smaller than the windows (same fairness margin as spikes).

## 6.2 Deterministic replay — CURRENT (M5)

One completed attempt = one reproducible run. The game records the exact
physical inputs (jump/lane keys with held/pressed/released edges) at every
fixed simulation tick — never positions, never camera, never video. Pressing
**F4** replays the last completed attempt through the real simulation:
identical inputs reproduce the run tick-for-tick, and the game verifies
this live, stopping with `REPLAY DIVERGED` at the first mismatching tick
instead of silently drifting. During playback your keyboard input is
ignored (the replay shows `REPLAY`, then `REPLAY VERIFIED`); `R` returns to
live play. Replays are bound to the exact level content they were recorded
on — a restyled level still accepts its old replays, but changed gameplay
rejected explicitly rather than mis-played. Deaths replay too (a death tape
reproduces the same death). This is a determinism proof and a practice/
verification tool, not a menu, timeline, or editor feature.

## 7. Out of scope for the current foundation

Ship mode, moving hazards/obstacles, final VFX polish, music/BPM sync,
public editor, backend, persistence. See `ROADMAP.md`. (Pads, orbs, speed
portals and the trigger infrastructure shipped in M4 — §6.1.)

## 8. Reference art

`normal.png` / `cohete.png` / `arriba.png` are visual MOOD references only
(neon-on-dark modular 3D, cyan player, orange hazards, readable void). All
gameplay is real runtime 3D geometry. Never ship reference pixels.
