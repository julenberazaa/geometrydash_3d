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

The Cube runs on a gravity surface (Floor, Ceiling, Left wall, Right wall
— see §6). All movement math is expressed through the gameplay frame
(`forwardAxis`, `gravityVector`, `surfaceNormal`, `laneAxis`); the world
NEVER rotates and the camera NEVER rolls when gravity changes.

- **Auto-forward:** the player always moves forward at level base speed
  (Test Level: 14 units/s along +Z). No manual longitudinal control.
- **Jump:** `Space` is ALWAYS the jump key. The directional jump key depends
  on the current gravity surface:
  - Floor: `ArrowUp` or `Space` = fixed-impulse jump away from the floor.
  - Ceiling: `ArrowDown` or `Space` = fixed-impulse jump away from the
    ceiling (downward, then gravity pulls back up).
  - Left wall (support at screen-left): `ArrowRight` or `Space` = jump
    away from the wall (screen-right), then gravity pulls back left.
  - Right wall (support at screen-right): `ArrowLeft` or `Space` = jump
    away from the wall, then gravity pulls back right.
  No variable-height hold behavior. Holding jump causes an immediate re-jump
  after every valid landing (hold-to-repeat), never a mid-air extra jump.
  - Impulse 13.2 u/s, gravity 42 u/s² → apex ≈ 2.07 units, airtime ≈ 0.63 s,
    forward distance ≈ 8.8 units (identical on every surface, mirrored
    along gravity).
- **Fast-fall:** airborne, the key pointing INTO the current gravity surface
  adds extra acceleration along gravity (+55); on the surface it does nothing.
  - Floor: airborne `ArrowDown`.
  - Ceiling: airborne `ArrowUp`.
  - Left wall: airborne `ArrowLeft`. Right wall: airborne `ArrowRight`.
- **Lanes:** on Floor/Ceiling `ArrowLeft`/`ArrowRight` change the *target
  lane index*. **Lane-debt rule (M8.1):** intent never accumulates against
  an immovable wall — while lateral motion is blocked and the target lies
  further into the blockage, the target clamps to one meaningful lean step
  beyond the deepest reachable lane, so a single press back always
  recovers. Open-edge virtual lanes (M1.2 fall-off) are unaffected.
  On BOTH surfaces `ArrowRight` ALWAYS moves the Cube toward
  **screen-right** and `ArrowLeft` toward screen-left — flipping gravity
  never mirrors lanes. On wall gravity the lane axis is VERTICAL:
  `ArrowUp`/`ArrowDown` move along the wall lanes (Up = higher lanes on
  BOTH walls — never mirrored), with the same one-press-one-lane,
  accelerate/cruise/brake kinematics as horizontal lanes.
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
  (`hazard` | `frontImpact` | `void` | `lava`, internal/debug),
  exactly-once event, readable visual hold (0.65 s / 78 ticks) with a
  mode-aware voxel breakup (the ACTIVE avatar's palette/silhouette:
  cube / ship / spider ghost shell + tinted chunks that hold size, then
  core flash + shock ring + camera punch), deterministic respawn at
  start (restoring the level's start gravity mode).
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

**Wall framing (M8B):** on wall gravity the eye shifts ~3.4 u toward the
free-face side (the open corridor side of the wall run) while STAYING at
the elevated floor height and looking slightly toward the free side — so
the side free face opens up AND the top face stays readable in one stable
view. The camera NEVER rolls (`camera.up` stays world +Y on all four
surfaces); Floor/Ceiling framing is numerically unchanged.

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

Several levels ship (selected via `?level=<id>`, default THE DESCENT
since M8.5):

- **THE DESCENT** (`production-showcase-01`, M8.5, DEFAULT): the first
  superproduction level — ~116 s, HARD/EXPERT, multi-route (islands +
  two-door labyrinth + teleport choice), all modes/gravities, inverted
  Ship, wall Spider, Chompers, directed lava, full 9-act arc.
- **Test Level 01** (`controller-test-01`): the controller/gravity/
  interaction demo track with the M3 gravity section and the M4
  interaction section.
- **Validation Level 02** (`validation-02`, M5): the engine-portability
  proof — different start lane, slower base speed (11 u/s), spike weave,
  gap jump, ceiling run with a REQUIRED ceiling pad, ceiling gap, gravity
  orb return, 2× speed gap, final weave, real finish (~20 s). A validation
  and verification level, NOT the final production level.

## 6. Gravity surfaces and transitions — CURRENT (all four surfaces)

Gravity is a real gameplay state owned by the simulation. Four support
surfaces ship, named by SUPPORT SURFACE as seen from the chase camera:

- **Floor:** gravity −Y, surface normal +Y (the original approved gameplay).
- **Ceiling:** gravity +Y, surface normal −Y — the Cube physically runs on the
  UNDERSIDE of slabs. The world stays stationary; the camera stays level.
- **Left wall:** support on the screen-left wall (world +X); gravity +X,
  surface normal −X — the Cube runs on the +X wall face.
- **Right wall:** support on the screen-right wall (world −X); gravity −X,
  surface normal +X.

**Gravity portals** are data-driven level objects (`id`, crossing plane `z`,
`target` mode, optional bounded `triggerCenter`/`triggerHalfExtents`)
supporting all four targets. **Bounded-gate rule (M8.1):** a portal fires
ONLY when the player collider actually passes through the gate volume —
crossing the Z plane outside the visible opening does NOT trigger it.
Volume-less definitions keep the legacy plane crossing (compatibility).
Crossing the gate in the forward direction flips gravity exactly once per
attempt: world position is NOT teleported, all velocity is preserved (no
impulse, no snap), grounded/support is cleared immediately, and the Cube
visibly accelerates toward the new gravity surface. Portals reset after
respawn/restart. Missing a gate fails later by geometry/routing (wrong
surface, wall, void) — never by arbitrary instant death. Visually each
portal is a compact ring gate (cyan = flip up, warm = flip down)
rendered ON its trigger volume; triggering never depends on renderer,
camera, or visuals.

**Gravity orbs** flip to the OPPOSITE surface (floor ↔ ceiling,
leftWall ↔ rightWall) — never an arbitrary cycle. Jump pads launch along
the mount surface normal on all four supports. Spikes mount on all four
surfaces (base attached, tip away from the support). Levels using wall
gravity may declare `wallLaneCenters` (vertical lane layout) and side void
bounds (`deathXMin`/`deathXMax`); otherwise lanes mirror about the
corridor mid-plane and X is unbounded.

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
- **Speed portals (passive):** deterministic forward-crossing gate
  (`prevZ < z <= currentZ`, ascending Z, furthest crossed wins — or the
  swept gate volume when the portal carries one, per the M8.1
  bounded-gate rule) setting the authoritative speed multiplier (content
  tiers 0.5×/1×/2×/3×/4×). No teleport, no impulse. There is ONE speed
  authority: the level's `baseForwardSpeed` × the simulation's current
  multiplier, delivered to the controller per step. Respawn/`R` restores
  the level's `startSpeedMultiplier` (default 1).
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

## 7.3 Lava — CURRENT (M8A, rivers M8.1)

LAVA IS GAMEPLAY. Touching lava (pool surface, fall column, source vent)
kills INSTANTLY with cause `lava` — no delay, no damage bar, no bounce —
through the same swept-path CCD as every other hazard (no tunneling at
speed). Every lava composition is authored from one visual logic
(Minecraft-like, never a fluid simulation): a `source` vent visibly
attached to solid rock, an optional dense blocky downward `fall`, and a
`pool` basin surface visibly contained by surrounding solid geometry
(basin floor + rim walls) — or a fall visibly continuing below the lethal
world bounds. Floating lava slabs are forbidden (enforced by
`validateLavaAuthoring`; production levels pin it in-suite).

**Lava rivers (M8.1, directed M8.4):** lava crosses the track as sourced
rivers that must be jumped — twin vent pillars feed blocky falls pouring
into basin pools under gap jumps, and the signature at-grade river flows
ONE way across the route (3 u hop): a side vent pours into the strip,
the strip visibly travels across the lanes, spills over a lip into a
rock-shelf side channel, and falls off the cliff past the world bounds.
Every river obeys the same sourced/contained contract: no floating slabs,
no unsupported streams, no dead-end directed flows (a `flow`-hinted pool
must hand off downstream), the center jump line visibly clear of falls.

## 7.1 Vertical slice product contract — CURRENT (M7.1)

Deliberate M7/M7.1 content/product decisions (no temporary coordinates here):

- Target successful run 45–60 s (sweet spot ~50–55 s), measured in
  deterministic simulation time (speed portals make finishZ/speed math
  insufficient).
- Three-act dramatic arc: establish/flow → transform/build (gravity
  transition + ceiling passage) → climax/release (speed escalation +
  readable finish approach, no unfair surprise before the finish).
- Difficulty ramps; 3–5 signature moments per level (if everything is
  special, nothing is).
- Fair visual telegraphing: the player should usually understand WHY they
  died; no trial-and-error blindness, no hidden must-fast-fall checks.
- Recovery-window principle: short obvious-route windows separate major set
  pieces (difficulty never sits at maximum for the whole run; windows also
  let visual changes read).
- Required-assistance gaps/pads/orbs must be visually obvious; ambiguous
  secretly-assisted gaps are forbidden.
- M7.1 precision rules (human playtest demanded harder, narrower Cube
  content — M7 full-width direction REJECTED):
  - Production levels may use partial-width support geometry; all 3 lanes
    do NOT need simultaneous floor support.
  - Intentional landing precision is part of Cube difficulty; airborne lane
    correction is a deliberate advanced skill.
  - Hard levels constrain valid routes while staying visually telegraphed;
    full-width roads are recovery tools, not the default topology.
  - Single-lane islands keep fair lateral margin (Cube footprint + human
    margin — precision, never pixel-perfect).
- Production levels carry several clearly distinct visual scenes (section
  identity readable from one screenshot); major gameplay events visibly
  affect the environment (gravity flips weightiest).
- Future music synchronization is a product requirement: levels carry
  deterministic presentation-only rhythm cues (position-bound semantic
  markers) that NEVER affect gameplay, fingerprints, or replays — audio
  itself is a later milestone.

## 7.2 Advanced Cube product contract — CURRENT (M7.2)

Deliberate M7.2 content/product decisions (no temporary coordinates here):

- Advanced production Cube levels run HARDER and longer than the slice
  (target 60–75 s, preferred 62–70 s of authored content — never padded
  with empty straightaways) while keeping the fairness/readability
  contract (§7.1): deaths must teach, hazards stay telegraphed, margins
  stay measured (flagged for the human gate when thinnest).
- Approved production levels may use multiple vertical floor heights
  (LOW/MID/HIGH bands + ceiling) as real gameplay: height changes ride on
  the frozen jump envelope (a band reachable only from another band is a
  design lever, never a trap).
- Narrow/fragmented support is part of advanced Cube design; full-width
  slabs are recovery tools, not the default topology. Advanced levels may
  intentionally constrain to one route (lane-lazy and transfer-lazy
  variants demonstrably die).
- Fast-fall may gate an advanced route when explicitly telegraphed
  (visible gate + drop cue + measured window, never frame-perfect).
- Teleport portals are deterministic spatial transitions: a forward entry
  crossing relocates the Cube to an authored exit exactly once per
  attempt; a lethal step always wins over the teleport; the skipped
  world-space interval is never interpreted as traversed (no
  skipped-interval portal firing); exit velocity/lane/support semantics
  are explicit and pinned (flow preserved, vertical zeroed, lane handed
  off, support cleared).
- Decorative setpieces (e.g. monster-like guardians) are presentation
  ONLY — no AI, no movement, no collision, no trigger — and must never
  read as safely landable geometry (they live outside the route corridor
  or read unambiguously as backdrop).
- Rhythm cues remain presentation-only position metadata (teleport-in/out
  included); audio itself is still a later milestone.
- M7.3 spectacle/precision layer (CURRENT): short-hop teleport pairs may
  skip small readable intervals whose entry and exit share one frame
  (missing the ring is death — the hop is mandatory routing, not a
  shortcut); maze walls (`killFront` blocks) force lane commitment or a
  committed jump; tall spikes read bigger while staying inside the frozen
  jump envelope; lava basins and creature setpieces are pure environmental
  menace (never collision, never landable-looking); mini-islands glow as
  floating volumes; death bursts hit harder. All Cube-only, all fair and
  telegraphed — difficulty from geometry, timing, route commitment and
  lane discipline, never hidden deaths.

## 7.4 Player modes — CURRENT (M8C)

One authoritative player mode lives in the simulation (`cube` | `ship` |
`spider`); rendering observes. Attempts always start as Cube. Replay stays
input-only (modes derive deterministically from physical inputs).

- **Mode portals** are data-driven forward-crossing gates (`id`, `z`,
  `target`, optional bounded trigger volume — same bounded-gate rule as
gravity portals: flying outside the visible ring does NOT switch modes).
  Crossing switches mode exactly once per attempt with a clean handoff:
  forward/lateral flow preserved, along-gravity velocity zeroed,
  grounded/support cleared. Compact sky-cyan Ship rings (forward-dart
glyph) and mint-green Spider rings (surface-switch glyph), rendered on
  their trigger volumes.
- **Ship:** continuous flight, not jumping. Holding the primary action
  (`Space`) thrusts AWAY from gravity; release lets gravity pull back
  toward the support. Mode-owned terminal speeds both ways; frame-generic
  on all four gravity orientations. Lane steering stays available. Ship
  sections are authored as bounded corridors/tunnels (floor + ceiling +
  visible side walls with edge language) — free control inside, a guided
  flight space overall, never free sky.
- **Spider:** runs like a Cube but never jumps. On the primary PRESS the
  Spider instantly switches to the OPPOSITE support surface (floor ↔
  ceiling, leftWall ↔ rightWall), landing on the nearest valid opposite
  support within range and flipping gravity with it. Hold never repeats
  (edge only). A hazard in the transit path kills (death wins — no
  magical pass-through); a solid in the way, or no support in range,
  ignores the press (never clip, never void-launch).

`Space` is the universal primary action in every mode (jump / thrust /
surface-switch).

## 7.5 Dynamic lava chomper — CURRENT (M8D)
An ORIGINAL lava-predator design (dark basalt shell, molten cracks, bright
maw, energy-chain tether — never licensed geometry) and a REAL moving
gameplay hazard with a readable attack contract:

- The creature waits/floats beside the route (`dormant`) reading as a
  voxel lava chain-chomp (single mottled magma ball, huge dark maw on
  the lunge face, chunky block teeth, white-hot square eyes with dark
  pupils, lava-hot chain + weight cube). Touching it while dormant still
  kills — it is never decoration.
- When the player reaches the authored `triggerZ`, it captures the
  player's lateral X as its committed aim and telegraphs (eyes flare,
  anticipation pulse, jaw chews, ~0.3–0.6 s of fixed-tick warning).
- It then lunges HORIZONTALLY across the route (linear, deterministic,
  jaw gaping).
  It never chases forward in Z and never re-homes after activation.
- The lunge line is authored low so a timed jump clears it; lane
  positioning after activation also matters (the attack is committed).
- After crossing it rests `spent` at the far side; respawn/`R` resets
  every Chomper to dormant. Contact in ANY phase kills (`hazard`).
- Fixed-tick state, bounded count (≤ 8 per level), swept Chomper-vs-player
  collision (no tunneling either direction), replay-safe (input-only
  tapes; level + state fingerprints extend conditionally).

## 7.6 Maze and trap islands — CURRENT (M8E)

- **Maze:** tall lethal frontal walls with narrow passage doors force quick
  horizontal route decisions. Correct openings are readable before the
  decision window closes (no blind memorization): generous approaches,
  doors centered on lanes, wrong paths visibly lethal (wall / spikes /
  lava / void). Frontal contact kills; side scrape obeys the standard
  blocking semantics.
- **Trap islands:** tempting but visibly dangerous choices — spike-covered
  decoy islands beside a clean precision line. "Trap" never means hidden
  colliders, spawn-after-landing surprises, or unavoidable deaths.
- **Multimode production levels** chain lava, gravity, modes, Chompers,
  maze and traps into one authored arc with mandatory portal routing
  (missing a transition naturally kills via wall / spike / lava / void).

## 7.7 Out of scope for the current foundation

Music/BPM sync, public editor, backend, persistence. See `ROADMAP.md`.
(Pads, orbs, speed portals and the trigger infrastructure shipped in M4 —
§6.1. Ship/Spider modes, wall gravity and moving hazards ship in M8.)

## 8. Reference art

`normal.png` / `cohete.png` / `arriba.png` are visual MOOD references only
(neon-on-dark modular 3D, cyan player, orange hazards, readable void). All
gameplay is real runtime 3D geometry. Never ship reference pixels.

## 9. Visual language — CURRENT (M6A foundation)

Deliberate production hierarchy (presentation-only; gameplay in §§1–6 is
unaffected): player (cyan, highest priority) > hazards (warm orange,
readable before contact, never bloom-hidden) > playable route (dark body +
violet/blue edge language, obvious surface plane) > interactions (semantic
accents: yellow = jump impulse, blue = gravity, per-tier speed colors) >
environment (depth only, never competes). Dark surfaces stay dark; bloom
reinforces edges instead of washing the scene. The Cube reads identically
on Floor and Ceiling (free-face accents on both faces; §4 symmetry holds).

## 9.1 Motion language — CURRENT (M6B juice, presentation only)

Deliberate product-facing motion cues (gameplay in §§1–6 unaffected): the
Cube carries a cyan trail communicating forward motion (stronger at higher
speed tiers); gravity transitions fire a distinct spatial pulse; speed
tiers gain increasing motion energy (streaks ~absent at 1x, clearly
present at 2x+); pads/orbs/portals answer activation with semantic-color
bursts (yellow = jump impulse, blue = gravity, tier colors = speed).
Effect hierarchy never obscures hazards: particles stay subordinate to
the player/hazard/route readability order (§9). All juice is reversibly
disableable (`?fx=off`) with zero gameplay difference. NOT human-approved
(M6B motion/juice gate OPEN).

## 9.2 Presentation evolution — CURRENT INFRASTRUCTURE (M6C1),
PROOF TUNING PROVISIONAL

Product rules (gameplay in §§1–6 unaffected): presentation MAY evolve
across a level as the player advances — atmosphere, route accents,
environment energy, restrained bloom/exposure, juice multipliers. Visual
section semantics are STRICTLY position-driven (same location → same
section, every machine); transitions are smooth presentation
interpolation that must never obscure gameplay, mislead as gameplay cues,
flash, or strobe. The cyan player anchor and warm hazard identity NEVER
change with sections. All evolution is reversibly disableable
(`?triggers=off` = exact baseline) with zero gameplay difference. The
shipped section values are ENGINEERING PROOF, not direction (M6C1 proof
gate NOT performed; full artistic timeline authoring still remains after
the M6C2 reactive pass — see §9.3). NOT human-approved
(M6C1 artistic-timeline gate NOT PERFORMED).

## 9.3 Event-reactive punch + surface-contact language — CURRENT (M6C2, presentation only)

High-salience interactions answer in the ENVIRONMENT, not just in local
particles (gameplay in §§1–6 unaffected): pads and jump orbs punch warm
yellow (bloom lift, exposure nudge, background/fog flash toward the family
tint, environment-energy lift); gravity flips (portals and gravity orbs
share the transition) punch blue, longer and weightier; speed portals
punch in their tier color. Punches are short (<2 s), composable by maximum
(never stacked), and decay to the exact section look with no residue —
flashes stay controlled, never strobe-like, and never touch player/hazard/
route identities. While grounded and running on Floor or Ceiling alike, the
Cube drags a faint skid/splash along the current support plane
(continuous contact language complementing the rear trail and the
one-shot landing disk) — readable but subordinate, silent while airborne.
Both layers are reversibly disableable (`?triggers=off` silences the
punch envelope to the exact baseline; `?fx=off` silences particles and
skid) with zero gameplay difference. NOT human-approved (M6C2
reactive/contact gate NOT PERFORMED).
