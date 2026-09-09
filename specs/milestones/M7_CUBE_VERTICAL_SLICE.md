# M7 — Cube Vertical Slice (Production Level 01)

## STATUS

M7:
ENGINEERING COMPLETE / HUMAN FUN GATE OPEN

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
