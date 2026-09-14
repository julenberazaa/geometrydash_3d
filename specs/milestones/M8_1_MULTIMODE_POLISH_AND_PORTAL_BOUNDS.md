# M8.1 — MULTIMODE POLISH, PORTAL BOUNDS & LAVA RIVERS

## STATUS

ENGINEERING COMPLETE / HUMAN POLISH GATE OPEN (branch
`feature/m8-1-polish-portals-lava-death`; NOT human approved; NOT merged).

## HUMAN FEEDBACK RECORDED

Human playtest of the M8 feature branch (`multimode-gauntlet-01`) found the
rest broadly good and requested a focused polish/fix pass (no new mechanics,
no music sync, no M9):

- **A. Lava rivers:** lava must cross the track as jumpable rivers fed by
  visible sources/vents — never arbitrary floating planes; still lava stays
  contained; falling lava reads as dense liquid flow; lava kills instantly.
- **B. Portal bug:** portals fired on the bare route-plane crossing even
  when the player passed outside the visible opening. Required: a portal
  fires ONLY when the player collider passes through the portal volume/gate
  opening — for gravity, speed, mode AND teleport portals — with
  deterministic ordering and replay correctness preserved. Missing a portal
  must fail later by geometry/routing, never by arbitrary instant death.
- **C. Wall-lane input bug:** on a wall, pressing toward the blocked side
  moved nothing physically but drifted the internal lane target, so coming
  back needed extra presses. Required: impossible moves must not accumulate
  hidden debt (general fix, not a one-off).
- **D. Ship containment:** Ship drifts too freely. Required: authored
  corridor/tunnel bounds (visual + logical), free control inside.
- **E. Death readability:** the explosion must read stronger/longer —
  voxel-like breakup of the ACTIVE avatar — without breaking instant-death
  semantics or deterministic respawn.
- **F. Chomper redesign:** the monster must read as a LAVA creature
  (lava material/glow, head/mouth, big teeth, chomping/lunging identity)
  with the same gameplay contract (approach → telegraph → horizontal lunge
  → jumpable → spent), no AI.
- **G. Portal visuals:** smaller, cleaner, more elegant; teleport entry +
  exit read as a co-visible pair; compact circular gates that never
  dominate the screen.
- **H. Preserve the good parts:** multimode structure, replay
  compatibility, determinism, visual direction.

## BRANCH

`feature/m8-1-polish-portals-lava-death` (branched from
`feature/m8-multimode-gameplay` at `b087a83`; `main` untouched).

## ENTRY STATE (verified, not trusted)

- Branch `feature/m8-multimode-gameplay` at `b087a83`, tree clean.
- Baseline `npm run verify`: 33 files / 464 tests green.
- M8 engineering complete; M5 golden replay valid; ReplayV1 unchanged.

## ROOT CAUSE ANALYSIS (all proven before fixing)

- **B:** `processGravityPortals` / `processModePortals` /
  `processSpeedPortals` tested only `prevZ < portal.z <= currentZ` — a
  pure plane crossing with no lateral/vertical bound. Only teleport had
  (optional) bounded entries. Hence flying meters outside the visible ring
  still transitioned.
- **C:** lane intent (`targetLaneIndex ±= 1`, unclamped by design since
  M1.2) never heard back from collision. Against a wall the position
  clamps but the counter drifts without bound. The M1.2 fall-off (virtual
  lanes, support-governed exits) is the deliberate counterpart that any
  fix must preserve.
- **D:** the S5 corridor had floor + ceiling but open sides (no side
  walls) and no side void bounds — free-sky flight.
- **E:** fragments shrank linearly (`1 − t`) so the second half of the
  burst was sub-visible; one generic cyan palette for every mode; no
  silhouette continuity (the avatar hides instantly on death).
- **G:** gravity rings (r 1.7) rendered offset by TARGET instead of by
  gate position, so ring and trigger could disagree by 3.4 u.

## ARCHITECTURAL DECISIONS

- **Portal volumes are data, not code branches:** `triggerCenter` /
  `triggerHalfExtents` (optional) on gravity/speed/mode defs, evaluated
  with the existing exact `sweptWindowOverlap` primitive (same CCD as
  hazards/pads/orbs — no second trigger engine). Volume-less definitions
  keep the legacy plane crossing (old content byte-compatible).
- **Fingerprints extend with zero bytes when absent:** bounded volumes
  hash behind a `portalvol:v1` separator written ONLY when a volume
  exists (the `lava:v1`/`chomper` precedent). A first attempt with an
  unconditional boolean broke the golden fixture — caught by
  `replayGolden.test.ts`, fixed to the conditional pattern, golden green.
- **Lane resync lives in the simulation** (post-collision, all modes,
  all four surfaces): while a contact blocks lane motion AND the target
  lies further in the blocked direction, the target clamps to at most one
  lane-step beyond the deepest reachable real lane. One step is the
  physically meaningful lean/teeter allowance (the pinned side-blocked
  settle holds against the wall); deeper is unreachable debt. Y-axis clips
  (`hitFloor`/`hitCeiling`) count as lateral blockage ONLY when the lane
  axis is vertical (walls) — Floor/Ceiling landings are untouched, and
  support-based open-edge exits produce no contact so M1.2 fall-off is
  intact. Mutates intent only — golden trajectories without lateral
  contacts are bit-identical (proven by the unchanged golden fixture).
- **No sim/render confusion:** volumes, resync, lava lethality stay in
  the sim; ring placement, teeth, ghost shell, tunnel beads stay in views.
- **Volume/visual agreement (hard rule):** bounded portal rings render ON
  their trigger volume center. A ring must never mark somewhere the sim
  does not test.
- **Routing consequences, not kills:** missing a gate fails through
  authored geometry (S3 floor routing gaps → void; ship corridor walls;
  spider dodge wall) — never an arbitrary death volume.

## LAVA RIVERS / AUTHORING CHANGES (`multimodeGauntlet01.ts`)

- Sourced gap rivers: both S1 gap basins gained flanking rock pillars
  with vent mouths (`source`) feeding blocky stepped falls (`fall`) that
  pour over the basin rims into the pools. Jump line center stays clear;
  all compositions validate clean (`validateLavaAuthoring`, pinned).
- At-grade river crossing (z 128..131): a lava curb (pool top 0.7) flows
  ACROSS the route and must be hopped (3 u); twin route-edge pillars carry
  vents + falls into the strip ends. Same slab, zero Z shift downstream.
- S1 side composition (vent + fall + pool) unchanged.
- Driver: river hop at z 125.5; completion still tick 10321 (constant
  speed ⇒ anchor is path-independent), 0 deaths, replay VERIFIED.

## PORTAL BOUNDS FIX

- Sim: bounded volumes for gravity/speed/mode (teleport already had
  them); legacy plane fallback; ascending-Z order preserved.
- Content: all 4 gauntlet gravity + all 4 mode portals carry volumes;
  gate pylons (`killFront` posts) flank floor-approach gates; S3 floor
  split into 4 segments with 3 unjumpable routing gaps (320..330 /
  395..405 / 465..475) under the wall/ceiling runs — a gate-misser on the
  floor voids out BY GEOMETRY (cause `void`, gravity untouched).
- Visuals: rings render on volume centers; radii shrunk ~15–20%
  (gravity 1.45, mode 1.35, speed 1.35, teleport 1.5/1.85, exits
  1.2/1.05); energy discs thinned (1.5→1.2); speed chevron stack
  tightened inside the ring.

## WALL-LANE BUG FIX

- `GameSimulation.resyncLaneTargetOnLateralBlock()` (see Decisions).
- Regression suite `tests/laneDebt.test.ts`: wall-bottom debt capped +
  single-press recovery; floor side-wall debt capped; open-edge virtual
  lanes still accumulate (M1.2 intact). The pre-existing
  side-blocked-settle pin (`tests/death.test.ts`) holds the lean — a first
  nearest-lane implementation was REJECTED by that test for dragging the
  Cube back to center, then refined to the debt-cap rule.

## SHIP TUNNEL CHANGES

- Full side walls (x ±6..7, y −3..9, z 710..860) meeting floor and
  ceiling: a closed guided flight space, controls untouched.
- Tunnel-wall mid-band (LevelView, geometric rule like the 0.8 trim and
  y ≥ 2 rail precedents): tall thin walls (height ≥ 5, narrow half ≤ 0.6)
  carry a neon bead at mid-height on both narrow faces (0.07 section —
  deliberately not the 0.055 rail stock). Shared edge material, 2 meshes
  per wall, zero per-frame work.
- Driver: exit-gate altitude tracking (y ≈ 2.75) through the bounded
  ship-off volume; dive entry at z 780 (latency margin).

## DEATH BURST IMPROVEMENT

- Mode voxel palettes (cube cyan / ship sky+flame / spider mint) +
  mode-scaled ghost shell (cube 1.15³ / ship dart / spider flat) hanging
  ~0.3 s while voxels leave it; chunks hold full size for the burst's
  first half, then break down fast. 78-tick hold, instant semantics, R
  behavior, respawn timing: unchanged. Pooled (32 + core + ring + ghost =
  35, owned materials, zero post-construction allocation).

## CHOMPER REDESIGN

- Sim: byte-identical (phase machine, swept lethality, fingerprints
  untouched). View only: armored snout + brow ridge + 3 dorsal
  heat-spikes + second (vertical) crack band + bright maw with 3 upper
  fangs + jaw-riding lower teeth + chomp cycle (chews while telegraphing,
  gapes while lunging; teeth ride the jaw). 22 meshes/chomper, shared
  library geo/mats, MAX 8 cap. Chain, eyes, phases preserved.

## AUTOMATED QA

`npm run verify` green: typecheck + lint + **37 files / 492 tests** + build
(+28 tests over the M8 baseline: `laneDebt` 3, `portalBounds` 11,
`chomperView` 3, `deathBurst` +3, `multimodeGauntlet` +5, `tunnelWalls` 3).
M5 golden fixture intact (ReplayV1 unchanged — no ruleset bump);
gauntlet anchor tick 10321 re-pinned in-suite with replay VERIFIED.

## BROWSER QA

`scripts/browser-qa-m8.mjs` (mirrored into `browser-qa.mjs`): **43/43
green, zero console/page errors** — 35 M8 checks (incl. full in-page
real-input finish z=1200.1 + REPLAY VERIFIED + flat 35/8/63 resources)
plus 8 new M8.1 checks (river reads + missed-hop lava death + missed-gate
routing void + gate portrait + tunnel walls + dormant phase + frozen
burst+ghost). Evidence `qa/screenshots/m81-01 … m81-05` (+`04b`) with
provenance sidecars. Hardened along the way (all load-forensics
documented): pause-synced staging with read-back confirmation,
fail-fast STAGE-FAIL tags, re-staging crossings, attempt-tagged burst
latch, in-page dead-hold measurement, in-page death recorder, chomper
re-arm, dive margin 780. Software-rendering lag deaths still occur in
the full-run section (environmental; unit suite proves the 0-death
route); no check fails consistently.

## PERFORMANCE / RESOURCE IMPACT

Flat: 35 materials / 8 geometries / 63 scene children across restarts
(identical to the M8 gauge). No new materials/geometries (all views reuse
shared library stock + the burst's owned pool). Bounded mesh deltas:
lava +13, pylons +6, chomper +20 (2 resident), tunnel beads +8 —
all static, zero per-frame allocation.

## FILES CHANGED

- `src/level/levelDefinition.ts` — optional trigger volumes on
  gravity/speed/mode portals.
- `src/replay/levelFingerprint.ts` — conditional `portalvol:v1` writes.
- `src/game/GameSimulation.ts` — bounded activation ×3 + lane-debt resync.
- `src/content/levels/multimodeGauntlet01.ts` — rivers, volumes, pylons,
  S3 routing gaps, ship tunnel walls.
- `src/rendering/LevelView.ts` — volume-centered compact rings, tunnel
  mid-band rule.
- `src/rendering/InteractionView.ts` — compact speed gates on volumes.
- `src/rendering/ChomperView.ts` — lava-creature redesign + chomp cycle.
- `src/rendering/DeathBurstView.ts` — mode palettes + ghost + chunk curve.
- `src/rendering/RendererHost.ts` — mode-aware burst trigger.
- `src/main.ts` — `paused` QA probe.
- `tests/helpers/multimodeGauntletScript.ts` — river hop + ship steering.
- `scripts/browser-qa-m8.mjs`, `scripts/browser-qa.mjs` — M8.1 gate +
  load-hardening (both files).
- New tests: `laneDebt`, `portalBounds`, `chomperView`, `tunnelWalls`;
  extended: `multimodeGauntlet`, `deathBurst`.

## DOCUMENTATION UPDATED

This spec (new); `ROADMAP.md` (M8.1 entry); `ARCHITECTURE.md` (volumes,
resync, burst, chomper, beads, fingerprint, probes); `GAME_DESIGN.md`
(bounded-gate rule, lane-debt rule, rivers, tunnel, death read,
chomper); `README.md` (status pointer); M8 spec (bounds amendment note).

## GIT COMMITS / BRANCH STATUS

Branch `feature/m8-1-polish-portals-lava-death` (from
`feature/m8-multimode-gameplay` @ `b087a83`). `main` untouched. M8.1
engineering complete, human gate OPEN — not merged.

## KNOWN LIMITATIONS

- M6 real-GPU perf gate still OPEN (heavier workload; needs hardware).
- Music/BPM sync NOT started (next milestone).
- Browser full-run section stays load-sensitive under SwiftShader
  (mitigated, instrumented, never test-weakened).
- Wall-gravity + Ship content matrix unchanged (frame-generic, gauntlet
  demonstrates Ship on Floor).
- Tunnel mid-band beads also mark S3 wall slabs (welcomed: run-surface
  definition, not noise).

## HUMAN PLAYTEST REQUEST

`?level=multimode-gauntlet-01` on the M8.1 branch: river hops, gate
comings (try missing one!), wall-lane bottom presses, ship tunnel feel,
death read by mode, chomper menace, portal elegance — one run.

## NEXT RECOMMENDATION

Human playtest gate first. Then: M6D real-GPU closeout on the M8.1
workload → music/rhythm milestone. No new mechanics before the gate.
