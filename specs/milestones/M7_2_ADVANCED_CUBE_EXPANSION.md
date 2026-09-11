# M7.2 — Advanced Cube Expansion (Production Level 02 + Teleport Portals)

## STATUS

M7.2: ENGINEERING COMPLETE / HUMAN ADVANCED-CUBE GATE OPEN.

Automated: 349/349 tests green (`npm run verify`: typecheck + lint + tests +
build) — 306 pre-level (285 M7.1 + 20 teleport engine + 1 punch) + 43 new
M7.2 level/setpiece tests. Browser QA gate run: 284/293 checks green with
zero console/page errors — ALL M7.1 and M7.2 checks green, including two
consecutive zero-death full real-input finishes (exact 7455 frames) with
in-page REPLAY VERIFIED. The 9 remaining fails are all pre-existing
historical checks on frozen systems showing CDP-timing/measurement flakes
under the contended SwiftShader box (wall-rate dz=1.87 signature, m2
burst/respawn/chain photography, m3.1 eye sampling, m4 ring/2x-rate, m5
playthrough — each varying run to run, sim and determinism suites
untouched and green, zero M7.2 causation; the m5 playthrough flake passed
on adjacent runs with zero code delta). Golden replay verifies unchanged
(unit + in-page). Screenshots: `qa/screenshots/m72-*` (14 + JSON sidecars).

Controller freeze honored: jump impulse 13.2, gravity 42, fast-fall 55, lane
accel 110 / max 16 / brake 135, collider 1.1 — all pinned by test, zero
tuning changes. No Ship / Spider / wall gravity / ramps / monster AI /
moving hazards / music (all explicitly deferred).

## HUMAN M7.1 APPROVAL

M7.1 HUMAN FUN RE-TEST: APPROVED (2026-09-10 — the human played the slice
and said "esta muy bien, apruebo"). `vertical-slice-01` is the approved Cube
reference level and is preserved byte-identical (its deterministic anchor —
tick 6190 / 51.583 s — is re-pinned by the M7.2 suite). The approved Cube
controller remains frozen.

## OBJECTIVE

Answer: "How far can we push advanced CUBE gameplay before adding a new
player mode?" A SECOND production Cube level that is significantly harder,
more vertical, more fragmented and more spectacular than the slice — plus
ONE carefully-scoped new mechanic (paired teleport portals) and
monster-like presentation setpieces (no AI). Quality over scope.

## ENTRY STATE

Entry HEAD `0a55e7e` (M7.1 human approval recorded), clean tree, `main`
synced with `origin/main`, one worktree. M0–M5 PASS/CLOSED. M6A/M6B/M6C1/
M6C2 engineering complete (human gates open/proceeding as recorded). M7.1
approved (see above). Baseline `npm run verify`: 22 files, 285/285 tests,
build 606.97 kB.

## DESIGN PILLARS (priority order)

1. Fairness — every death teaches something; no blind memorization.
2. Readability — telegraphed hazards, honest geometry, distinct scenes.
3. Precision — intentional landings, measured margins, one-route solutions.
4. Flow — recovery windows separate set pieces; rhythm preserved.
5. Difficulty — HARD, clearly above M7.1, never frame-perfect.
6. Spatial variety — LOW/MID/HIGH bands + ceiling, fragmented topology.
7. Spectacle — eight scenes, guardian setpiece, teleport void moment.
8. Density — 21 meaningful hazards shaped into space, never spam.

## ADVANCED LEVEL IDENTITY

- Internal id: `advanced-cube-01` (`src/content/levels/advancedCube01.ts`).
- Display name: `ADVANCED CUBE 01` (temporary production name).
- Route: `?level=advanced-cube-01` through the existing registry (one data
  file + one registry entry, zero engine special-casing).
- Base speed 12 u/s (same frozen feel as the slice); route theme: dark
  ember/crimson with a rose rail identity (`edge 0xff4d88`); hazards keep
  the semantic warm-orange identity; teleport violet `0xc77dff`.

## DIFFICULTY TARGET

HARD — materially harder than M7.1 by construction: smaller landing islands
(6 u FF island, offset transfers at three heights), 21 hazards (density
2.2/100 u vs M7.1's 1.7), one fast-fall gate, a 2x precision climb
(MID→HIGH transfer at speed), and single-route constraint (lane-lazy and
transfer-lazy variants die in the island chain — proven behaviorally).
Many deaths are acceptable; each normally teaches (telegraphed spikes,
visible gaps, one mechanic per challenge).

## DURATION TARGET

Deterministic successful run: **7455 ticks = 62.125 s** (120 Hz sim time),
inside the required 60–75 s and inside the preferred 62–70 s band —
~10.5 s more substantial than the ~51.6 s slice, all from authored content
(no empty-straightaway padding; the teleport skip is content, not padding).
Measured from the real-input verification route (teleport 514→634 saves
120 u ≈ 10 s, accounted exactly). Pinned by test (exact tick + seconds).

## VERTICAL GEOMETRY

Cube Floor/Ceiling gravity only (no wall gravity). Three authored floor
bands + the M7.1-proven ceiling band:

- LOW floor:  top y = 0   (run height 0.55)
- MID floor:  top y = 1.2 (run height 1.75) — reachable from LOW
- HIGH floor: top y = 2.4 (run height 2.95) — reachable from MID
  (rise 1.2 < apex 2.07), NOT directly from LOW (rise 2.4 > apex 2.07 —
  used as a design lever, never as a trap).
- CEILING: underside y = 6 (run height 5.45), ~100 u of slabs (~8+ s).

Height is gameplay, not decoration: the route's grounded samples cover all
four run heights (pinned); low→high (island chain, garden climb, 2x storm
climb) and high→low (Phase 1 drop, FF gate, Phase 5 drop) transitions are
all required by the verification route. Camera untouched (M3.3 parity
holds — bands were chosen inside the validated framing).

## HEIGHT BANDS

(See above. Exact values audited against collider 1.1, apex 2.07, ceiling
corridor 6, camera visibility — then frozen as level data.)

## PLATFORM VOCABULARY

M7.1 vocabulary retained (single-lane islands, two-lane platforms, narrow
bridges, offset landings, split support, staggered gaps, recovery slabs —
full-width survives only as 3 short tools) plus M7.2 additions: raised
MID/HIGH islands, descending chains, stair-step low→mid→high patterns,
high-to-low drops, a fast-fall lintel gate (side pylons + high bar that the
fall passes under — bottom y 6.0 clears the HIGH jump apex 5.57), and
stacked visual mass (guardian) that is never playable.

## PRECISION / FAIRNESS

- Lateral: 0.75 u per side on every single-lane island (pinned ≥ 0.5).
- Longitudinal: standard 1x gaps ≤ 5 u (≥ 2.5 u margin); thinnest landing
  margin 2 u (FF follow-up onto S14); thinnest human window the FF takeoff
  (~2.5 u / ~25 ticks) — flagged for the human gate, deterministic and
  scripted, visually telegraphed (lintel + short island + `drop` cue).
- Timing: 1x transfers ≥ 0.5 s windows; 2x transfers ~0.4 s (climax only).
- One route: transfer-lazy and lane-lazy variants die in the island chain.
- No fake routes: the guardian lives outside the corridor (|x| ≥ 4.5 or
  z beyond the traversed runway); decorative pylons never overlap the cube
  path (structural clearance test).

## HAZARD DESIGN

21 spikes (vs M7.1's 12): island spike jumps, two-lane weaves (safe-lane
answers stay ON the platform — the M7.2 audit caught and fixed two
off-platform weave answers during authoring), a full-width row jump,
ceiling dip/commit pair (tips DOWN, `mount: ceiling`), MID commit spikes,
2x weave at speed, epilogue weave + final jump. Gameplay boxes stay
±0.5/0.25 (fairness margin intact). M7.1 spike-orientation rule honored
(tip away from support, both surfaces, pinned).

## FAST-FALL

One authored gate (HIGH center island → short LOW island 247..253): jump
~243.5 + 22-tick ArrowDown hold lands ~250.5 mid-island with room for the
follow-up gap jump; the identical taps without the hold land at the island
edge (~252.8) with a ~2-tick reaction window and die at the 253..257 gap
(proven behaviorally — frontImpact into S14). Telegraphing: lintel gate,
short island, `ac-cue-fastfall` drop cue. Not frame-perfect; flagged for
the human gate as the level's hardest single move.

## GRAVITY SECTION

One substantial ceiling passage (portal up z 322; slabs 326..376 +
380..392 + 396..424 ≈ 86 u, ~8+ s of ceiling mode): dip/commit spike pair,
hop gap, REQUIRED ceiling pad (z 391, impulse 22) over the 392..400 gap,
gravity-orb return (setup jump ~417.5, press ~419.5) onto a MID floor
platform (new height vs M7.1's floor return), amplified by the blue punch.

## TELEPORT DESIGN

One paired portal (`ac-teleport-maw`, style `maw`): entry plane z 514 on
the anticipation runway → exit (0, 1.75, 634) grounded center on the MID
post-teleport platform (lane 1). Skips 514..634 (120 u of void — no
portals, pads, orbs or geometry inside). Entry sits inside the guardian's
mouth ring; the exit is a compact violet doorway in the furnace world.

## TELEPORT SEMANTICS

Data-driven (`TeleportPortalDef`: id, entryZ, exit, exitLaneIndex,
presentation-only style). Deterministic: forward-crossing
(`prevZ < entryZ ≤ currentZ`), furthest unused entry wins, exactly once
per attempt (respawn re-arms). Lethal checks precede it (death wins the
step — pinned by fixture test). Discontinuity: skipped interval portals
never fire (pinned); `prevPosition` re-anchors at the exit so same-step
destination overlap is all the later trigger stages see. Exit: gravity
mode unchanged, speed multiplier unchanged, lateral/forward velocity
preserved, vertical velocity zeroed, lane intent = exitLaneIndex,
grounded/support cleared. ReplayV1 unchanged (input-only tapes reproduce
teleports; used-bits ride the state hash).

## TELEPORT TRIGGER ORDER

Per fixed step: controller → integrate/collide → frontal kill → grounding
→ LETHAL (void, hazards) → TELEPORT → pads → orbs → speed portals →
gravity portals → finish. Teleport sits after lethal (precedence) and
before interactions/portals (destination overlap evaluates same-step).

## TELEPORT VISUAL LANGUAGE

Paired violet gate (`0xc77dff` frame + pale pane), distinct from cyan/warm
gravity portals, tier-colored speed gates and yellow/blue orbs. The `maw`
entry renders as a large mouth ring (shared halo geometry) inside the
guardian; the exit is a compact doorway. Teleport punch family (violet,
peak 1.0, decay 2.2, wins color ties) + violet exit-expansion burst (theme
`teleportCount/teleportLife/teleportColor`, shares the burst pool) +
streak kick. VFX discontinuity-clear ordering handled explicitly (burst
fires AFTER the trail wipe).

## SETPIECES

One `guardian` setpiece (presentation-only level data: id/kind/center/
halfExtents; eyes derived — no extra fields): dark silhouette (shared
route body) + two warm glowing eyes (shared sphere + hazard material) on
the corridor-facing side at z 522, behind the teleport entry. Zero new
materials, zero new geometries, zero new pools. NO AI/movement/collision/
trigger (pinned structurally — the sim never reads setpieces; fingerprint
excludes them; the verification route never contacts them).

## VISUAL ARC

Nine sections (each screenshot-identifiable): `ac-ember` (crimson intro) →
`ac-ascent` (electric blue) → `ac-garden` (magenta) → `ac-abyss` (deep
navy ceiling) → `ac-return` (violet tech) → `ac-maw` (teleport void) →
`ac-furnace` (red/orange post-exit) → `ac-storm` (cyan 2x, bloom 0.6,
streaks 1.6) → `ac-calm` (teal release). Player cyan + hazard orange
structurally stable; punch envelopes decay between events.

## RHYTHM CUES

27 position-bound semantic cues (intro/accents/builds, 7 sectionChanges,
gravity/pad/orb/speed hits, teleport-in `drop` + teleport-out, storm
climax, release, finish) coinciding with sections and mechanic hits. Still
NO music/BPM/audio clock/sync engine — future songs map cue.z → sim time.

## PHASE 1 — PRECISION ASCENT (z −10..176, ~15 s)

LOW bridge + spike → right island (transfer) → MID center (rise + transfer)
→ MID left (transfer) → HIGH center (rise + transfer) → drop to LOW
two-lane → L/C weave → center bridge → recovery runway. Teaches height +
transfers at medium-hard. Signature: first elevated ascent (z 34..94).

## PHASE 2 — HAZARD GARDEN (z 176..325, ~12 s)

MID step-up → MID weave (2 answers) → HIGH right (rise) → HIGH center
(transfer + island spike) → FAST-FALL GATE → two-lane row jump → bridge
spike → portal approach. Hard. Signatures: FF gate (z 243..257), row jump.

## PHASE 3 — GRAVITY / CEILING WORLD (z 322..519, ~16 s)

Portal up → ceiling weave → hop → REQUIRED ceiling pad → gravity-orb
return onto MID → MID commit → REQUIRED floor pad (MID→LOW, 8 u gap) →
bridge spike → anticipation spike → teleport runway. The level's
technical core. Signatures: abyss entry, pad launch, orb return.

## PHASE 4 — TELEPORT SETPIECE (z 510..712, ~11 s incl. skip)

Anticipation runway → guardian mouth → TELEPORT (514→634) → furnace world
→ commit → drop-hop to LOW → REQUIRED jump orb (8 u gap) → approach spike
→ 2x portal. Signature: the teleport (entry, violet punch, exit burst,
palette break) — the level's most memorable moment.

## PHASE 5 — SPEED CLIMAX (z 708..944, ~13 s)

2x: gap + transfer to right island → island spike jump → gap + transfer +
rise to MID → gap + transfer + rise to HIGH left → drop to two-lane → 2x
weave (1x portal rides inside) → 1x epilogue weave → gap → final island
spike jump → gap → calm release → finish 944. Signatures: storm climb
(z 783..855), 2x weave, epilogue.

## SIGNATURE MOMENTS (7)

1. First elevated island ascent (z 34..94).
2. Fast-fall lintel gate (z 243..257).
3. Gravity flip into the navy abyss (z 322).
4. Ceiling pad launch + gravity-orb MID return (z 391/420).
5. Guardian mouth + teleport into the furnace world (z 514→634).
6. 2x MID→HIGH storm climb (z 783..855).
7. 1x technical epilogue + calm release (z 889..944).

## SCRIPTED COMPLETION

`tests/helpers/advancedCube01Script.ts`: 57 z-triggered actions (lane taps,
jump presses, one 22-tick fast-fall hold). Finishes naturally: tick 7455,
62.125 s, portals 2, pads 2, orbs 2, teleports 1, 2x climbed + released,
0 deaths, attempts 1. Verification route only, not the ideal human route.

## REPLAY

Record → replay of the successful route verifies (`pass`, finish, 7455
frames). ReplayV1 versions unchanged (1/1); tape scan proves zero
visual/punch/cue/teleport-definition keys. The M5 golden fixture verifies
untouched (fingerprint binding re-pinned in-suite).

## AUTOMATED QA

`tests/teleport.test.ts` (20: triggering, precedence, discontinuity, exit
semantics, determinism, replay, fingerprint boundaries, punch + VFX edges)
+ `tests/advancedCube01.test.ts` (43: registry/identity incl. M7.1 anchor
re-pin, completion incl. exact tick, vertical geometry incl. grounded-band
samples, hazards incl. density + orientation + fairness, FF gate incl.
required-proof + telegraph clearance, teleport integration incl. semantics
+ interval + fairness + determinism + fingerprint + restart, presentation
structure incl. mesh-count pin, visual/cue contracts, replay + reset +
golden binding). Full gate: typecheck + lint + 349/349 + build.

## BROWSER QA

M7.2 section (~48 checks) — staged passes (teleport-assisted pattern) +
full real-input finish via the in-page driver (mirrors the headless
script incl. the fast-fall hold + orb press windows) + replay VERIFIED +
restart/death/fallback/resource guards + vertical-slice-01 regression.
Zero console/page errors. Historical flake set separated (no M7.2
causation — sim untouched, all determinism suites green).

## PERFORMANCE OBSERVATIONS

Headless Chromium 1280×720 (SwiftShader — comparative only): opening
snapshot 29 materials (26 shared + 2 teleport + 1 cached tier-2) / 8
geometries / 3 composer passes / 62 scene children (50 + 12 rays —
teleport gates + guardian ride inside LevelView.group: +10 meshes, zero
new scene children at the top level). Flat across transitions/death/
restart/replay. Build 618.84 kB (+11.87 kB: level data + teleport +
setpiece + tests). Real-GPU closeout remains M6D.

## SCREENSHOTS

`qa/screenshots/m72-01-opening` … `m72-14-replay-verified` (+ JSON
sidecars): opening, height ascent, narrow islands, hazard garden, gravity
transition, ceiling world, fast-fall gate, guardian setpiece, teleport
entry, teleport exit, new color world, speed climax, finish,
replay-verified.

## HUMAN GATE

Play: `http://localhost:5173/?level=advanced-cube-01`. Controls:
Space/↑ jump (Floor) · Space/↓ jump (Ceiling) · ←/→ lanes · ↓/↑ fast-fall ·
R restart · F4 replay. Hardest sections to evaluate: (1) the FF gate
(z 243..257 — is the lintel telegraph clear? is the ~25-tick takeoff
window fair?), (2) the 2x storm climb + weave (z 783..886), (3) the
teleport moment (readable entry? surprising but fair exit?). Questions:
is HARD fair (deaths teach)? Do heights read? Is the teleport a real
signature moment? No agent may mark PASS without the human playtest.

## KNOWN LIMITATIONS

- Thinnest human window is the FF takeoff (~2.5 u / ~25 ticks after the FF
  landing; follow-up landing margin 2 u) — deterministic and scripted, but
  the human gate must confirm fairness.
- 2x weave taps (z 864/878) are the tightest lane inputs (~0.4 s windows).
- Headless-load QA artifact (unchanged): stalled keyup → hold-to-repeat
  artifact jump; drivers immune by construction (release-on-next-poll +
  redundant releases).
- Headless stills under-read additive juice/rays (real-GPU gate question).
- M6D real-GPU closeout still pending (M7.2 is its workload).
- No Ship/Spider/wall-gravity/ramps/moving hazards/monster AI/music (future
  milestones, individually scoped).
