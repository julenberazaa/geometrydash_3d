# M8 — MULTIMODE & HAZARD EXPANSION

## STATUS

ENGINEERING COMPLETE / HUMAN MULTIMODE GAMEPLAY GATE OPEN (feature branch;
NOT human approved; NOT merged).

## HUMAN PRODUCT DIRECTION

The old roadmap called M8 "music/rhythm". Human priority changed: M8 is the
multimode & hazard expansion — lava becomes real gameplay, death becomes
readable, portals become compact/professional, gravity goes four-way, Ship
and Spider modes ship, a dynamic lava predator (Chomper) hunts the route,
and maze + trap-island content lands in a new production level. Music/BPM
synchronization is deferred to the next provisional milestone (NOT started).

Quality > speed. No fluid simulation, no physics engine, no ECS, no
reference-pixel art. Every mechanic must create a new player decision.

## BRANCH

`feature/m8-multimode-gameplay` (all M8 commits; `main` untouched until the
human playtests the branch).

## ENTRY STATE

- `main` at `8d15b3d` (test(M6): add headed real-GPU performance gate).
- M6D engineering complete; M6 real-GPU HUMAN PERF GATE still open.
- M7.3 approved; `advanced-cube-01` anchor 7475 ticks (~62.292 s).
- Baseline `npm run verify`: 27 files / 381 tests (recorded pre-M8; actuals
  below).

## OBJECTIVES

Lava = instant death + physically grounded visuals; stronger/longer death;
compact portal family; Floor/Ceiling/Left wall/Right wall gravity; Ship +
Spider modes; deterministic dynamic Chomper; maze + trap islands;
`multimode-gauntlet-01` (80–100 s) finishing through legal inputs with a
verified replay; docs truthful; M6 perf gate left OPEN.

## ARCHITECTURE AUDIT

Pre-change reads: `AGENTS.md`, `GAME_DESIGN.md`, `ARCHITECTURE.md`,
`ROADMAP.md`, all M6/M7 specs, player/input/sim/collision/level/replay/
camera/rendering/content/scripts/tests. Findings:

- Hazard CCD (`sweptPathOverlaps` over the Y→Z→X path) is the one lethal
  pathway — lava and Chompers reuse/extend it, never duplicate it.
- `GravityMode === 'ceiling'` branches, `g.y`, `position.x`/`velocity.x`
  lane code, `hitFloor/hitCeiling`, Y-only void bounds, `mount`/`surface`
  floor|ceiling, camera above/belowFocus: all generalized via
  `GameplayFrame` data, not local if-chains.
- Lane policy lived inside `CubeController` (X-hardcoded despite relative
  comments) → extracted to `laneKinematics.ts` (one owner, all modes).
- Static `CollisionWorld` is never mutated per-frame → dynamic hazards live
  in simulation-owned preallocated state (`chomperSystem.ts` kinematics +
  `GameSimulation` arrays), rendered by `ChomperView`.
- Mode authority: `GameSimulation` owns `playerMode`; rendering observes;
  fingerprints extend conditionally (old tapes byte-identical).

## M8A LAVA

### LAVA GAMEPLAY

LAVA IS GAMEPLAY. Touching any lava volume (pool, fall, source) kills
INSTANTLY (cause `lava`, no delay/bar/bounce) through the normal swept-path
hazard CCD — lava volumes register as `lava-<id>` hazard-kind colliders at
load (no second lethal engine). CCD prevents tunneling at 2x/3x (tested).

### LAVA VISUAL MODEL

Minecraft-like authored logic, never a fluid solver: `source` vent attached
to solid rock → dense blocky `fall` → `pool` basin contained by floor + rim
walls (or a fall continuing below `deathY`). Floating slabs are forbidden
and rejected by pure `validateLavaAuthoring()` (pool touches solid; source
touches solid; fall fed at top + received at bottom / void-continued).
`advanced-cube-01` lava re-authored into contained basins (route unchanged).
Style: hot orange/red core, bright emissive edges, dark crust borders, slow
dense pulse on shared materials; zero per-frame geometry.

### PERFORMANCE STRATEGY

Shared materials/geometries, bounded volumes, in-place pulse only.

## DEATH REWORK

Root cause: 36-tick hold + 0.35–0.5 s burst cleared before the eye could
read the kill. New contract: **78-tick hold (0.65 s)** with integer-tick
authority (`DEATH_HOLD_TICKS`), stronger cyan-core explosion (24 pooled
fragments, core flash, shock ring, FOV +5 / +0.4 u camera punch), pooled
(zero allocation, 20+ death stress), auto-respawn AFTER the readable window
— fast restart feel preserved, manual `R` immediate.

## PORTAL REDESIGN

One compact professional family: circular ring + inner energy surface +
semantic glyph + controlled bloom + thin rim. Gravity (cyan/warm by
direction, wall flips offset), speed (per-tier color), teleport (violet,
compact RING gates instead of wall panes), mode (sky-cyan Ship dart,
mint-green Spider chevron). Teleport entries gain OPTIONAL bounded volumes
(`center`/`halfExtents`, new content) with full backward compatibility for
Z-plane entries (old anchors valid). Mandatory routing comes from geometry
funnels, never giant visuals.

## M8B FOUR-WAY GRAVITY

### GRAVITY FRAMES

`GravityMode = floor | ceiling | leftWall | rightWall`, named by SUPPORT
surface (leftWall = support at world +X/screen-left). Explicit per-mode
`GameplayFrame` data (`gravityVector`, `surfaceNormal`, `laneAxis`;
forward always +Z; laneAxis explicit, never cross-derived). Gravity orbs
flip to the OPPOSITE surface (floor↔ceiling, wall↔wall).

### INPUT MAPPING

`Space` = universal primary action on every surface. Floor/Ceiling arrows
unchanged (muscle memory preserved). Walls: lane axis is vertical —
`Up/Down` move along wall lanes (Up = higher on BOTH walls), horizontal
arrows work the support (Left wall: `Space`/`ArrowRight` jump,
`ArrowLeft` fast-fall; mirrored on Right wall). DOM layer stays
gravity-agnostic; interpretation is pure/deterministic in-sim.

### LANE GENERALIZATION

Lane coordinate `s = position · laneAxis` in shared `laneKinematics.ts`
(Cube/Ship/Spider). Floor/Ceiling behavior bit-identical (golden-gated);
walls steer world Y. `wallLaneCenters` (explicit or corridor-mid mirror)
author vertical lanes without touching old levels.

### SUPPORT/COLLISION

`probeGroundSupport` probes ALONG gravity; contacts interpreted against the
frame (world-named, simulation-mapped). Optional level-owned side void
bounds (`deathXMin`/`deathXMax`); Y bounds unchanged.

### CAMERA

Surface-relative framing, NEVER rolls (`up` = +Y always). Floor/Ceiling
formulas numerically unchanged. Walls: eye shifts ±3.4 u toward the free
side at elevated height — side free face AND top face readable, no
side-on silhouette.

### WALL HAZARDS

Spikes mount on all four surfaces (base attached, tip away); pads impulse
along the mount normal; frontal-kill rule is frame-relative.

## M8C PLAYER MODES

### MODE PORTALS

Data-driven `PlayerModePortalDef` (id/z/target) forward-crossing planes,
one-shot per attempt, clean handoff (flow preserved, along-gravity velocity
zeroed, support cleared). Fingerprinted conditionally; ReplayV1 unchanged.

### SHIP

Deterministic continuous flight (`ShipController` + owned `shipTuning.ts`;
Cube tuning untouched): primary-held thrust AWAY from gravity, release =
gravity pull; mode-owned terminals (fall 14 / rise 12); shared lane
steering; frame-generic on all four orientations. Procedural neon craft
(cyan identity, metal body, canopy, thrust flame).

### SPIDER

Runs like a Cube, never jumps (`SpiderController`, frozen Cube numbers).
Primary PRESS snaps to the OPPOSITE surface onto the nearest valid support
(≤ 14 u, footprint overlap, deterministic ties) + gravity flips with it.
Hazard in transit kills (death wins); solid blockage or no support ignores
the press (never clips, never void-launches). Compact crawler visual,
surface-aligned.

## M8D DYNAMIC HAZARDS

### CHOMPER DESIGN

Original lava predator (basalt shell, molten crack band, bright maw,
ignition eyes, opening jaw, 5-link energy-chain tether). Waits beside the
route (touching it dormant still kills) → triggerZ arms → aim captured
(player X, never re-homed) → telegraph (~0.4 s pulse) → linear horizontal
lunge across the route → spent. Never chases in Z.

### CHOMPER SIMULATION

`chomperSystem.ts` owns the pure phase machine; the simulation owns
preallocated states, activation, reset, and the swept test. Bounded (≤ 8).

### CHOMPER COLLISION

Both sides sweep (Chomper segment box vs player segment box) — no tunneling
either direction at any speed. Lunge lines authored low (top ≈ 1.2 <
jump-apex bottom ≈ 1.5): timed jumps clear; grounded contact kills
(`chomper-<id>`). State fingerprinted conditionally.

## M8E LEVEL DESIGN

### MAZE

Three tall (7 u, unjumpable) `killFront` decision walls with alternating
2.6 u single-lane doors (lane 0 / lane 2 / lane 1) on 30 u+ approaches:
read fast, commit, wrong door dies frontally. Side scrape safe.

### TRAP ISLANDS

Center hop line (2.6 u islands, 5 u gaps) flanked by spike-dense decoy
islands: tempting, visibly lethal, never hidden; center route hazard-free.

### MULTIMODE GAUNTLET

`multimode-gauntlet-01` (MULTIMODE GAUNTLET 01), base 14 u/s, finish 1200:
S1 lava intro (2 basin gap-jumps + sourced side composition) → S2 maze →
S3 floor→leftWall→ceiling→rightWall→floor → S4 two-Chomper biome with side
pools → S5 Ship corridor (rise-over + dive-under) → S6 Spider (snap up over
a wall, snap down) → S7 trap islands → S8 release. ~86 s, medium-hard→hard,
no padding. Portals unmissable full-width planes; missing a Spider snap =
wall death.

## REPLAY

Input-only tapes throughout (modes, gravity, chompers, lava derive
deterministically). ReplayV1 NOT bumped (schema/ruleset unchanged).
Conditional fingerprint encoding keeps pre-M8 tapes byte-identical
(golden fixture green).

## FINGERPRINTS

Level: `modes:v1`, `chompers:v1` (gameplay fields only) behind separators.
State: player mode + Chomper phase/ticks/position/aim when present.

## PERFORMANCE OBSERVATIONS

Bounded everywhere (lava volumes, ≤ 8 chompers × 11 meshes shared
geo/mat, pooled fragments, 5-link chains, shared portal rings). Resource
deltas recorded from browser QA (advanced-cube-01 vs gauntlet). M6
real-GPU gate stays OPEN — rerun on the M8 workload after human approval.

## AUTOMATED QA

`npm run verify` green: typecheck + lint + 33 files / 464 tests + build.
New suites: lava lethality, four-wall gravity, player modes
(Ship/Spider/portals/snaps), Chomper contract (11), multimode integration
(7: completion tick 10321 / 86.0 s / 0 deaths, replay, wrong-door,
lava-cause, trap readability). Golden M5 fixture intact; ReplayV1 unchanged.

## BROWSER QA

Dedicated M8 section (old M1–M7 checks kept, none weakened): lava
basin/source/fall portraits + instant lava death + burst + linger; compact
portal portraits (gravity/speed/teleport/ship/spider); wall transitions +
attach + jump + lanes + no-roll; Ship switch/thrust/release/corridor;
Spider switch/snap/mandatory dodge; Chomper dormant/telegraph/lunge +
jump-over + contact kill; maze portrait + correct/wrong routing; trap
portrait + spike kill; FULL in-page real-input finish + REPLAY VERIFIED;
restart/resource guards; zero console/page errors.

M8 slice gate (`scripts/browser-qa-m8.mjs`, race-safe standalone mirror of
the canonical block): 35/35 green, zero console/page errors. Full in-page
run finishes (z=1200.1, 1 lag death under CDP load → re-armed, finished;
unit suite proves the 0-death route) with in-page REPLAY VERIFIED.
Resources flat on the gauntlet (35 mats / 8 geos / 63 children across
restart). Shared-library delta recorded: 28 → 36 materials (+2 lava, +2
mode portals, +4 chomper; geometries unchanged — new views reuse shared
geo). Screenshots m8-01 … m8-16 with provenance sidecars.

## SCREENSHOTS

`qa/screenshots/m8-01-lava-basin` … `m8-16-replay-verified` (with JSON
provenance sidecars).

## HUMAN GATE

Play `?level=multimode-gauntlet-01`: lava, death feel, maze reads, wall
gravity readability, Chomper fairness, Ship corridor, Spider snaps, trap
precision, portal clarity — in one run.

## KNOWN LIMITATIONS

- M6 real-GPU perf gate still open (heavier workload; needs hardware rerun).
- Music/BPM sync explicitly NOT implemented (next milestone).
- Wall-gravity content coverage: gauntlet exercises all four surfaces;
  Ship-on-walls is architecturally frame-generic but content-demonstrated
  on Floor (matrix documented in tests).
- Browser wall-rate flakes under software rendering are environmental
  (documented pre-existing load-flake set), never test weakening.
