# M7 — Cube Vertical Slice (Production Level 01)

## STATUS

M7:
REWORK IN PROGRESS / HUMAN FUN GATE REJECTED FOR THE M7 VERSION

M7.1:
ENGINEERING COMPLETE / HUMAN FUN RE-TEST GATE OPEN

## M7 HUMAN FUN GATE RESULT (recorded, not re-argued)

The human played the M7 vertical slice. Technical implementation worked;
the level direction was REJECTED as final:

1. Too simple; the track is much too wide; too many safe paths — horizontal
   movement is not precise because the route spans the full three-lane
   corridor. Wants islands / narrow platforms requiring intentional landings.
2. Jump precision and horizontal positioning should matter more; difficulty
   should increase significantly (difficult / precision-focused, not unfair).
3. Visuals are good but too conservative: wants much stronger color changes
   and environment transformations (background shifts, flashes, rays,
   stronger reactive changes at gravity/pad/speed moments), eventually synced
   with MUSIC (rhythm-platformer spirit — music NOT added in M7.1).
4. Confirmed visual bug: ceiling spikes point the wrong way (the player dies
   on what looks like the flat/base side).

M7.1 answers: "Can the current Cube system alone produce a level that is
precise, challenging, visually spectacular and memorable?" Until YES: no
Ship, no Spider, no teleport, no ramps, no monsters, no music.

Automated: 256/256 tests green (`npm run verify`: typecheck + lint + tests +
build) — 238 pre-M7 + 18 vertical-slice. Browser QA: M7 section 30/30
green (plus the 2 console audits, twice consecutively) with zero
console/page errors; M6A/M6B/M6C1/M6C2 regression sections 88/88 green;
full suite 227/235 with only the 8 documented historical CDP-timing/load
flakes (wall-rate, spike-chain, eye-sampling, ring-timing, 60 s verify
window + knock-on — identical signatures on pristine pre-M7 HEAD under
load; no M7 causation, sim untouched, all determinism suites green).
Golden replay verifies unchanged (unit + in-page). Screenshots:
`qa/screenshots/m7-*` (10 + JSON sidecars).

## OBJECTIVE

The FIRST PRODUCTION Cube vertical slice: one memorable, fair, readable,
completable, fun ~52 s Cube level on the production stack built through
M6C2 — proving Cube gameplay is fun for almost a minute BEFORE Ship mode
may begin. NOT Test Level 03, NOT a mechanics checklist, NOT a reskinned
validation level: authored pacing and composition in three acts.

## ENTRY STATE

Entry HEAD `aaea4fe` (M6C2 engineering complete), clean tree, `main` synced
with `origin/main`, one worktree. M0–M5 PASS/CLOSED. M6A/M6B/M6C1/M6C2
engineering complete, all human gates OPEN (presentation direction approved
to proceed — see below). Baseline `npm run verify`: 238/238 green.

## M6 HUMAN FEEDBACK / M6D STATUS (recorded, not strengthened)

The human personally played the M6 presentation and said it is "quite good",
explicitly requesting proceeding to M7. Recorded conservatively as:

M6 PRESENTATION DIRECTION: HUMAN APPROVED TO PROCEED TO M7.

No individual M6A/B/C parameter is claimed permanently locked. M6D final
real-GPU performance closeout is NOT performed — intentionally deferred:
M7 creates the representative production-level workload M6D should profile.
M6 is therefore NOT marked fully closed.

## DESIGN PILLARS (priority order)

1. Control fairness (the player understands WHY they died).
2. Readability (telegraphed hazards, honest geometry).
3. Fun / flow.
4. Pacing (three acts + recovery windows).
5. Memorable moments (3–5 signature beats, not 20).
6. Visual spectacle (subordinate to 1–3).
7. Difficulty (ramps; never frame-perfect chains).

## DIFFICULTY TARGET

Accessible but demanding. Not tutorial-easy, not Demon-level. The first
successful run may take several attempts; a competent player learns the
level visually. No repeated frame-perfect inputs; no blind knowledge checks.
Standard jumps keep >= 2 u margin inside the frozen envelope; near-limit
inputs are rare, intentional, and visually obvious (required pads/orbs).

## LEVEL IDENTITY

- Internal id: `vertical-slice-01` (`src/content/levels/verticalSlice01.ts`).
- Display name: `VERTICAL SLICE 01` (temporary; no commercial branding).
- Route: `?level=vertical-slice-01` through the existing registry (one data
  file + one registry entry, zero engine changes). Default level unchanged.
- Base speed 12 u/s (distinct from 14 and 11); route theme: deep violet /
  cyan with a cyan-blue rail identity (`edge 0x4fd2ff`); hazards keep the
  semantic warm-orange identity.

## DURATION

Deterministic successful run: **6190 ticks = 51.583 s** (120 Hz sim time),
inside the required 45.0–60.0 s and inside the preferred 48–55 s sweet spot.
Measured from the real-input verification route (no estimation from
finishZ/speed — the 2x section over z 518..648 is accounted exactly:
684/12 − 130/24 ≈ 51.6 s). Pinned by test (exact tick + sim seconds).

## ACT I — ESTABLISH / FLOW (z −10..170, ~13 s)

Immediately enjoyable; teaches the pattern language. Opening runway with
lane markers → first decision (spike row z 30, safe screen-right) → two
platform hops (tops 0.8 / 1.6) → 5.5 u gap → forced lane wall (z 92) →
asymmetric spike weave (safe L at z 112, safe C at z 126) → 5 u gap →
recovery runway into the first portal. Desired feeling: "I understand this."

## ACT II — TRANSFORM / BUILD (z 170..440, ~22 s)

Gravity portal up (z 170) into a substantial ceiling world (slabs
z 174..300, ~10 s of ceiling running): ceiling-spike lane commitment
(z 200 center, z 216 center + screen-right) → 5 u ceiling gap → REQUIRED
ceiling pad (z 243, impulse 22) over an 8 u void gap → gravity-orb return
(z 285: jump then press, floor landing ~289) → REQUIRED floor pad (z 314,
impulse 23) over an 8 u gap → REQUIRED jump orb (z 354, impulse 15) over a
10 u gap → short inversion callback (portal up z 385, center block z 402,
portal down z 415). Desired feeling: "Now the level is changing."

## ACT III — CLIMAX / RELEASE (z 440..680, ~17 s)

1x closing weave (safe C z 480, safe R z 494) → 2x speed portal (z 518) →
sprint: 11 u gap (z 540..551, margin ~4 u at 2x), hold-R row (z 580),
commit-L row (z 610, two taps) → 1x release portal (z 648) → clean 32 u
finish approach with no hazards. Desired feeling: "I survived the climax."
No unfair surprise before the finish.

## SIGNATURE MOMENTS (5)

1. First gravity flip (z 170) into the blue ceiling corridor.
2. Ceiling pad launch over the 8 u void (z 243).
3. Gravity-orb flip return to the floor (z 285).
4. Floor pad + jump-orb combination (z 314 / 354).
5. 2x sprint weave with route-light intensity (z 518..648).

## LANE DESIGN

All three lanes used as safe lanes across the run (safe-lane sequence
R → R-wall-dodge → L → C → ceiling L → pad C → callback L → C → R →
sprint R → L). No mechanical L→C→R repeat. Ceiling spikes (same cone
language as floor spikes, base flush with the run surface) create lane
commitment with a fair alternative (jumping under also clears them).
Recovery zones separate every major set piece.

## JUMP / GAP MARGINS (frozen tuning: 13.2 impulse, 42 gravity)

- 1x range at speed 12: 7.55 u. Standard gaps (4 / 5 / 5.5 u) keep >= 2 u.
- Pad gaps (8 u) exceed plain range (pads REQUIRED, proven structurally);
  pad flights land with 1.8–2.2 u margin.
- Orb gap (10 u) exceeds plain range (orb REQUIRED — proven behaviorally:
  the route minus the press edge dies void in the gap); orb flight lands
  with ~1.8 u margin.
- 2x gap (11 u) exceeds 1x range, keeps ~4 u margin at the 2x range (15.1 u).
- Required-mechanic visuals are explicit (pads on the runway line, orb
  windows above the takeoff arc); no ambiguous secretly-assisted gaps.

## GRAVITY DESIGN

One substantial ceiling passage (~126 u of ceiling slabs, ~10 s) plus a
short inversion callback (slab z 388..420) — flips are rare and purposeful
(up-portal, orb return, callback pair). Every flip is amplified by the M6C2
blue gravity punch.

## PAD / ORB DESIGN

Pads are passive runway furniture (run through them); orb windows sit above
the grounded envelope with generous AABBs and visible approach arcs; the
gravity orb follows a setup jump (no blind press). No memorization-only
chains.

## SPEED DESIGN

1x for readability across Acts I–II; 2x reserved for the Act III sprint
(130 u) with reduced micro-input density (one gap, two rows) and a 1x
release before the finish. Tier-colored punch + streaks communicate the
change.

## RECOVERY WINDOWS

Runway F→portal approach, post-orb floor D, runway G, pre-sprint H, and the
1x release J separate the set pieces; difficulty never sits at maximum for
the full 52 s.

## VISUAL ARC (authored, not proof)

`vs-opening` (violet/cyan identity) → `vs-inversion` (deeper blue,
calmer juice) → `vs-combination` (violet energy, lifted environment) →
`vs-sprint` (bloom 0.55 in-contract, exposure 1.2, max juice) →
`vs-release` (calm contrast for the finish). Player cyan anchor and hazard
orange never change (structural).

## REACTIVE FX AUTHORING

Pads answer warm yellow, the gravity flip + orb answer blue (weightiest),
the 2x portal answers tier green — spaced so punch envelopes decay between
events (no constant noise). Grounded passages throughout let the M6C2
contact skid plant the cube on Floor AND Ceiling.

## CONTENT ARCHITECTURE

`src/content/levels/verticalSlice01.ts` + one registry line. Zero engine
special-casing (no level-id branches in sim/rendering/controller). The
eventPunch hot path was cleaned (`PUNCH_KINDS` frozen tuple instead of
per-frame `Object.keys` allocation — zero behavior change, proven by the
unchanged 12-test punch suite).

## SCRIPTED COMPLETION PROOF

`tests/helpers/verticalSlice01Script.ts`: z-triggered physical-input driver
(11 lane taps, 10 jump presses incl. 2 orb edges). Finishes naturally:
tick 6190, 51.583 s, portals 4, pads 2, orbs 2, 2x observed, 1x released,
0 deaths, attempts 1. A verification route, not the ideal human route.

## REPLAY PROOF

Record → replay of the successful route verifies (`pass`, finish). ReplayV1
unchanged; visual/punch/contact state excluded (tape scan clean). The
Validation Level 02 golden fixture untouched and green.

## AUTOMATED QA

`tests/verticalSlice01.test.ts` (18): registration/identity, natural finish
with 0 deaths, 45–60 s + exact-tick pin, determinism, 3-lane usage, mechanic
coverage (4 transitions, 2 pads, 2 orbs, 2x observed + released), floor vs
substantial-ceiling inventory, no-debug-placement spy, tuning-computed gap
margins, behavioral orb-required proof, replay pass, fingerprint exclusion,
restart restore. Full gate: typecheck + lint + 256/256 + build.

## BROWSER QA

Historical sections intact (no check weakened). M7 section (`m7-*`,
30 checks + 2 console audits) — ALL GREEN: route resolves, display name,
start state, visual sequence active, player/hazard identity, Act I render,
first signature, portal flip (z=175.6) + blue punch (energy 0.61), ceiling
readability (in-viewport, contact skid live), floor pad (z=313.6) + warm
punch, jump orb (z=354.4) + warm punch, gravity orb (mode=floor, orbs=1),
2x portal (z=519.2) + streaks (8) + tier punch, sprint visual state
(vs-sprint), release section (vs-release @1x), full real-input finish via
the in-page driver (finished, 0 deaths), frameCount-derived duration
(6190 frames = 51.58 s, in target), replay VERIFIED (no divergence),
restart/death behavior, resource pins (27/8/3, 50 children), fallback
matrix, zero console/page errors.

Load honesty: this box (shared overnight workloads + SwiftShader software
GL) starves rAF periodically, which breaks CDP-timed observations without
breaking the deterministic sim. The M7 harness answers with principled
load-immunity only (verified R-loops, verified lane taps, pre-armed punch
loops, in-page peak watcher, restage + self-healing supervisors, release-
on-next-poll input edges, generous timeouts) — zero threshold weakening.
Two genuine script bugs found and fixed along the way (teleport lane
intent; the ceiling-pad lane tap missing from the gravity-orb mini-driver
— the headless verification route always had it). The hold-to-repeat
artifact mechanism (stalled keyup → extra jump) is documented in
limitations; drivers are immune by construction now.

## PERFORMANCE OBSERVATIONS

Representative M7 workload (headless Chromium 1280×720, SwiftShader —
comparative only): 294 draw calls / 5.3k triangles at the start (LIGHTER
than the M6A test-level baseline ~363 — fewer meshes), children flat at 50
across transitions/death/restart/replay, 27 materials (shared 26 + one
extra cached speed-tier material: M7 uses tiers 1 and 2, cached per tier by
the same code path) / 8 geometries / 3 composer passes, build 604.81 kB
(+4.5 kB level data). No new pools, no per-frame allocation, no transition
leaks. Real-GPU closeout remains M6D.

## SCREENSHOT EVIDENCE

`qa/screenshots/m7-01-opening` … `m7-10-replay-verified` (+ JSON sidecars).

## HUMAN FUN GATE (OPEN)

Play the slice: `http://localhost:5173/?level=vertical-slice-01`. Controls:
Space/↑ jump (Floor) · Space/↓ jump (Ceiling) · ←/→ lanes · ↓/↑ fast-fall ·
R restart · F4 replay. Questions: is it fun for ~52 s? Fair deaths? Readable
at 2x? Memorable moments? Difficulty ramp? Do NOT mark PASS without human
playtest.

## KNOWN LIMITATIONS

- Thin-margin audit (headless probe): the 2x double-tap (scripted R→L at
  z 600/603 for the safe-L row at z 610) clears the center-spike kill zone
  at z≈604.5 — roughly 5 u of margin at 2x. Comfortable deterministically,
  but it is the tightest input in the level; human playtest must confirm
  the climax weave is demanding yet fair.

- Human fun gate NOT performed (automation proves possible, never fun).
- M6D real-GPU closeout still pending (M7 is its workload).
- Tightest orb windows assume human rhythm learning; the script is only one
  verification route.
- Headless-load QA artifact (no product impact): when the main thread
  stalls across a tap's keyup, Space stays held past a landing and the
  documented hold-to-repeat fires an extra jump — e.g. airborne through the
  ceiling-pad window, skipping a REQUIRED pad and dying in runoff. The
  in-page drivers therefore release every tap redundantly (10/25/60 ms);
  redundant releases are no-ops when not held. Headless suites use exact
  snapshots and never see this.
- Headless stills under-read additive juice (real-GPU gate question).

---

# M7.1 — PRECISION, DIFFICULTY & SPECTACLE REWORK (this section)

## M7.1 STATUS

M7.1: ENGINEERING COMPLETE / HUMAN FUN RE-TEST GATE OPEN.

Automated: 285/285 tests green (`npm run verify`: typecheck + lint + tests +
build) — 256 pre-M7.1 + 29 new (6 spike-orientation, 32 level incl. topology
proofs, 6 rhythm-cue, 3 energy-ray; the level suite grew from 18 to 32).
Browser QA: M7.1 section 45 checks green with zero console/page errors (plus
the standing M6 regression sections); historical sections show only the
documented CDP-timing/load flake set (no M7.1 causation — sim untouched, all
determinism suites green). Golden replay verifies unchanged (unit + in-page).
Screenshots: `qa/screenshots/m71-*` (11 + JSON sidecars + spike pair).

Controller freeze honored: jump impulse 13.2, gravity 42, lane accel 110 /
max 16 / brake 135, collider 1.1, fast-fall 55 — all pinned by test, zero
tuning changes. Difficulty comes from geometry + timing + position, never
from envelope abuse. No Ship / Spider / teleport / ramps / monsters / moving
hazards / music (all explicitly deferred).

## M7.1 ENTRY STATE

Entry HEAD `d64469f`, clean tree, `main` synced with `origin/main`, one
worktree. Baseline `npm run verify`: 19 files, 256/256 tests, build
604.81 kB.

## PRECISION DESIGN STRATEGY

Same dramatic skeleton (portal/speed Z positions, mechanic flow) but rebuilt
topology: full-width slabs survive only as THREE short recovery/release
tools (start z −10..14, portal approach z 154..176, release z 648..684 —
under 35% of route length); everything else is single-lane islands (2.6 u
wide, 0.75 u margin per side), two-lane platforms (5.2 u, one deliberate
choice), narrow bridges and staggered offsets. Six airborne single-lane
transfers (Act I ×3 incl. the opening island chain, weave exit ×1, 2x sprint
×2) require the existing airborne lateral control — one lane per jump, never
chaotic multi-tap windows.

## PLATFORM / ISLAND VOCABULARY (shipped)

- Single-lane island (halfX 1.3): bridge z 14..34, islands z 38..50 (R),
  54..66 (C), 70.5..82 (L), 321..348 (C), sprint island z 549..596 (R).
- Elevated island (top 0.8): z 84..96 (step-up gap 82..84).
- Two-lane platform (halfX 2.6): L+C z 100..130 / 445..480 / 606..648,
  C+R ceiling z 174..230 / 234..244 / 252..274, floor z 280..313.
- Narrow bridge (halfX 1.3 continuous): z 134.5..150, ceiling z 276..288,
  floor z 358..402 / 412..445 / 484..518 / 518..538.
- Split/stagger with void: island chain gaps 34..38 / 50..54 / 66..70.5;
  sprint gaps 538..549 / 596..606 with lateral transfer.
- Short recovery: the three full-width tools above (straight, no hazards).

## TRACK WIDTH BEFORE VS AFTER

M7: ~every slab halfExtents.x = 5.4 (10.8 u corridor, all lanes always
supported). M7.1: 24 slabs, only 3 full-width; narrow (≤2.7) slabs ≥ 15 by
count and >65% by length (full-width is ~13% of route length). The opening bridge is provably narrow in-browser
(off-lane teleport placement falls to void where the old road survived).

## DIFFICULTY CURVE

Act I (z −10..170, ~13 s): medium — teaches the precision language (bridge
jump, 3 transfers, elevated hop, weave with 2 lane answers). Act II
(z 170..440, ~22 s): medium-hard/hard — narrow ceiling (dip-unders, weave,
pad transfer), orb return, offset pads, callback dip-under. Act III
(z 440..680, ~17 s): hard — 1x weave + transfer, 2x island sprint (gap +
transfer, island spike jump, gap + transfer, weave answer), clean release.
No fast-fall requirement authored (geometry carries the difficulty); no
frame-perfect chains (thinnest input: the 2x mid-air taps, ~0.4 s windows).

## SIGNATURE MOMENTS (5)

1. First island chain over the void (z 34..82, three lateral transfers).
2. Gravity flip into the navy ceiling world (z 170 + blue punch + rays).
3. Ceiling pad launch from the offset lane onto the narrow C+R run (z 243).
4. Gravity-orb return + offset floor pad + jump-orb combination (z 285/311).
5. 2x island sprint across the fragmented magenta/cyan route (z 518..648).

## FAIRNESS MARGINS (measured, documented for the human playtest)

- Smallest longitudinal margin: floor-pad landing ~1.8 u past the gap edge
  (~0.15 s / 18 ticks at 12 u/s); thinnest plain landing ~2.05 u.
- Smallest lateral landing margin: 0.75 u per side on every single-lane
  island (2.6 − 1.1 collider = 1.5 total; pinned ≥ 0.5 by test).
- Smallest timing/input margin: 2x mid-air transfers (tap inside ~0.4 s
  flight windows); 1x transfers have ≥ 0.5 s.
- Standard gaps ≤ 5 u keep ≥ 2.5 u inside the frozen 7.55 u envelope; pad
  gaps (8 u) and the orb gap (10 u) exceed plain range (REQUIRED, proven);
  2x gaps (10..11 u) keep 4..5 u inside the 15.1 u envelope.
- Thinnest human margin overall: the floor-pad landing (1.8 u longitudinal).
  Deaths stay visually understandable (telegraphed spikes/gaps, no blinds).

## CEILING SPIKE FIX

General rendering rule in `LevelView` (no level-id branch, no coordinate
heuristic): presentation-only `mount` metadata on `LevelHazard` (default
floor) seats the base on the support surface and points the tip AWAY
(floor +Y, ceiling −Y). Colliders byte-identical; `mount` excluded from the
gameplay fingerprint (old replays compatible). Pinned by
`tests/spikeOrientation.test.ts` (floor tip-up/base-bottom, ceiling
tip-down/base-flush, unchanged hitboxes, default-unchanged old levels,
fingerprint exclusion, no-branch source pin) + paired browser screenshots
with screen-space tip/base projection proofs.

## VISUAL SCENE ARC (authored)

`vs-opening` (violet/cyan identity) → `vs-precision` (electric purple/blue,
brighter edge) → `vs-gravity` (deep navy, strong fog shift, env 1.4) →
`vs-tech` (magenta energy) → `vs-climax` (cyan/magenta, bloom 0.6
in-contract, exposure 1.25, streaks 1.6, env 1.4) → `vs-release` (calm teal,
quiet juice). Each recognizable from one screenshot. Gravity/pad/speed hits
punch blue/yellow/tier + ray bursts; 12 fixed background beams carry section
energy (peak opacity 0.28 — subordinate by construction). Player cyan and
hazard orange structurally stable.

## BEAT-READY ARCHITECTURE

`src/visuals/rhythmCues.ts`: 20 position-bound semantic cues (intro, accent,
build, sectionChange ×4, gravityHit ×3, padHit ×2, orbHit, speedHit, drop,
climax, release, finish) coinciding with section boundaries and mechanic
hits. Deterministic (same z → same cue), no clocks, sim/fingerprint/replay
excluded, visual timeline resolves independently (no competing triggers).
Future songs map cue.z → sim time → beat/bar/drop once BPM/offset/structure
is known. NO audio ships in M7.1.

## SCRIPTED REAL-INPUT COMPLETION

`tests/helpers/verticalSlice01Script.ts`: 35 z-triggered actions (lane taps
+ jump presses only — no fast-fall). Finishes naturally: tick 6190 =
51.583 s (same clock as M7 — the portal/speed skeleton is unchanged and
forward motion is constant-speed), portals 4, pads 2, orbs 2, 2x observed +
released, 0 deaths, attempts 1. Route-minus-one-transfer dies (transfer
REQUIRED); lane-lazy route dies in the island chain (constrained solutions);
route-minus-orb-press dies void in the orb gap (orb REQUIRED).

## REPLAY VERIFICATION

Record → replay of the M7.1 route verifies (`pass`, finish); tape scan
proves zero visual/punch/cue keys; ReplayV1 versions unchanged (1/1); the
M5 golden fixture verifies untouched.

## QA (see sections above + `qa/screenshots/m71-*`)

M7.1 browser section: 45/45 green (route, narrowness proofs floor + ceiling,
island chain, transfers, flip + blue punch + scene change, ceiling
readability + spike-DOWN projection proof, floor spike-UP proof, pad +
punch, orbs + punches, tech scene, 2x + streaks + punch + climax scene +
rays + readability, release + ray quiet, real-input finish deaths=2 with
6190 frames, duration, replay VERIFIED, cues resolve + absent from tape,
restart, death/respawn, fallback matrix + triggers-off baseline, resources
27/8/3 + 62 children, zero console/page errors). Full suite 239/250: the
11 fails are all pre-existing checks on frozen systems showing CDP-timing/
measurement flakes under a contended SwiftShader box (wall-rate, m2
burst/respawn/chain, edge-teeter input timing, m3.1 eye sampling, m4
2x-rate, m5 playthrough cascade) — varying run to run, sim and determinism
suites untouched and green, zero M7.1 causation.

## PERFORMANCE OBSERVATIONS (headless Chromium 1280×720, SwiftShader)

Start (measured in-page, same start-line condition as the M7 294-call
baseline): 302 draw calls / 5404 triangles (only +8 calls — fewer hazards
than M7 offset most island meshes; the 12 ray beams are trivial boxes),
children 62 (50 + 12 rays), materials 27 (shared 26 + 1 cached speed tier)
/ geometries 8 / composer passes 3, build 606.97 kB (+2.16 kB: level data +
cues + rays). Flat across transitions/death/restart/replay. Real-GPU
closeout stays M6D.

## HUMAN FUN RE-TEST GATE (OPEN)

Play: `http://localhost:5173/?level=vertical-slice-01`. No agent may mark
PASS without the human playtest. Hardest three sections to evaluate: (1) the
Act I island chain (z 34..82 transfers), (2) the ceiling weave + pad lane
(z 193..243), (3) the 2x island sprint (z 536..626 transfers + spike jump).

## KNOWN LIMITATIONS

- Thinnest margin is the floor-pad landing (1.8 u) — human must confirm fair.
- Headless-load QA artifact (unchanged): stalled keyup → hold-to-repeat
  artifact jump; drivers immune by construction (release-on-next-poll).
- Headless stills under-read additive juice/rays (real-GPU gate question).
- M6D real-GPU closeout still pending (M7.1 is its workload).
- No fast-fall showcase (deliberate — geometry carries M7.1 difficulty).
