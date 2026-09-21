# M8.6 — Extreme Density, Verticality & Moving-World Overhaul ("THE DESCENT" rework)

> Status: IN PROGRESS (branch `feature/m8-6-extreme-density-verticality`,
> NOT merged to `main`).
> Automation proves completable, deterministic, replay-safe and denser.
> Automation CANNOT prove fun, fairness feel, or real difficulty — do NOT
> mark PASS until the human plays it end to end.

## 1. Human M8.5 verdict (entry context)

The human played the M8.5 showcase: visuals, environments, lava, monsters,
modes and presentation are LIKED. Gameplay is REJECTED as too easy, too
flat, too linear, too sparse, too slow in decision density, too horizontal,
too forgiving, too predictable — "a nice 3D obstacle course" instead of "a
relentless high-skill 3D rhythm/platforming gauntlet". Visual production
from M8.5 is PRESERVED; gameplay architecture and level geometry get a
major difficulty/density upgrade. Target: roughly 5× decisions, movement
changes, elevation changes, interactions, hazards, route complexity,
spatial variation and mechanical combinations — NOT literally 5× objects.

## 2. Difficulty / duration targets

VERY HARD / EXPERT (Demon-style density philosophy, fair in 3D — every
death explainable, mastery rewarded). Reference scripted route: 115–130 s,
0 deaths, replay VERIFIED, on primary AND alternate routes. Density goes
UP inside the same duration: shorter passive travel, more content per
meter, more speed variation — NOT a longer level.

## 3. Density philosophy (the §3 non-negotiable)

Outside deliberate ~0.5–1.5 s micro-recovery windows, the player is
constantly jumping / holding / releasing / fast-falling / lane-changing /
correcting / routing / orbing / padding / portaling / gravity-swapping /
mode-swapping / riding / dodging / threading / snapping. Never several
seconds of passive forward motion. Falling is a skill ("dejarse caer"):
high kills, jumping kills, timed fast-fall required, early landing a bad
line. Stairs, shafts, decks, corridors, ferries chain UP/DOWN/LEFT/RIGHT/
FLOOR/CEILING/WALL/ISLAND/PORTAL/DROP/JUMP/FLY/SNAP continuously.

## 4. M8.5 flatness audit (measured, primary route, 13955 ticks)

| Metric | M8.5 value |
|---|---|
| Action events (jump/lane/transition edges) | 60 / 116 s = 0.52 /s |
| Max passive gap | 7.72 s (8 gaps ≥ 4 s) |
| Jump edges | 30 (0.26 /s) |
| Fast-fall held | 0 ticks |
| Lane edges | 12 |
| Supports distinct / changes | 32 / 78 |
| Σ\|Δy\| / Σ\|Δx\| | 206.6 / 89.4 u |
| Y range / X range | 10.9 / 9.7 u |

M8.6 thresholds (test-pinned in `tests/showcaseDensity.test.ts`, both
routes, no recovery-window exemptions): skill jump edges ≥ 85
(measured 97/93), lane edges ≥ 50 (62/70, logical incl. wall-gravity
Up/Down taps), fast-fall held > 0 (144/35 ticks), max action gap ≤ 1.5 s
(1.47/1.43 s), supports ≥ 64 (79/76), Σ|Δy| ≥ 400 (561.7/505 u),
Σ|Δx| ≥ 150 (197.8/209.5 u), 2 u bands ≥ 8 (9/8) with transitions
≥ 150 (237/205), X range ≥ 8 (11.64/11.99 u) with reversals ≥ 20
(44/45), platform riding on both routes (5/4 decks, 200+ ticks),
gravity transitions ≥ 10, mode transitions ≥ 5, Spider presses ≥ 10.
Human feel remains authority — metrics detect emptiness, never certify fun.

## 5. Moving-platform contract (new scoped engine capability)

- `MovingPlatformDef` level data: id, base center, half extents, axis
  ('x' | 'y' ONLY — forward-axis platforms would fight auto-forward),
  amplitude, periodTicks, phaseTicks, pingpong triangular wave. Cap: ≤ 8
  per level (Chomper bound precedent).
- Pure tick-derived poses (`src/game/movingPlatformSystem.ts`, Chomper
  pattern): `platformPose(def, tick)` — no Date.now, no render delta, no
  randomness. Sim owns `platformTick` (reset on respawn, +1 per running
  step — deterministic given the input tape, like `ticksInPhase`).
- Dynamic-solid collision WITHOUT touching the static spatial hash:
  preallocated `platform-<id>` solid-kind pseudo-colliders appended to the
  per-step candidate lists of `moveAabbThroughWorld` /
  `probeGroundSupport` (new optional params — existing callers unchanged).
  Frontal-kill, lane-debt resync, swept anti-tunneling and support probing
  then apply uniformly; static query order + appended platforms keeps
  determinism (documented tie-break).
- Riding: exact-displacement carriage of platform-supported players BEFORE
  the controller step (no slip, no launch velocity, no lane debt) +
  smallest-axis embed push-out backstop (elevators rising into riders).
- Fingerprints: level hash conditionally extended (`platforms:v1`,
  zero bytes when absent — golden fixture untouched); state hash
  conditionally extends with poses (tick-derived, Chomper-state precedent).
- Renderer: `MovingPlatformView` (RendererHost-owned, ChomperView pattern)
  observes sim poses; shared library materials/geometries; zero per-frame
  allocation. `__gd3d.platforms()` cold probe for browser QA.
- Unit tests: pose determinism, reset, replay consistency, ride / jump-off
  / land-on (lateral + vertical), blocking, frontal kill, no tunneling,
  support handoff, fingerprint bytes, overlap backstop.

## 6. Verticality contract

Multiple real height bands (LOW y≈0 / MID y≈4 / HIGH y≈8 + ceiling runs +
wall rides + shafts) as gameplay, never decoration: stairs (1.5 risers on
the frozen jump envelope), drop chambers, elevator/shaft transitions,
multi-deck maze, stacked corridors, overhead/underfoot route crossings.
Camera must frequently reveal playable geometry above/below/beside the
route. Height proof: Y min/max, 2 u bands visited, band transitions
(test-pinned vs the §4 baseline).

## 7. Redesign (same id `production-showcase-01`, same 9-act arc, same scenes)

| Act | Z | Name | Density content |
|---|---|---|---|
| 1 | 0..170 | FORGE ASCENT | stair ascent + drop chamber + river hop + lane weaves from tick 0 |
| 2 | 170..430 | SKYBRIDGE ISLANDS | multi-deck 5–10-transfer chains, lateral ferry, elevator, spike ceilings, BRANCH (upper speed vs lower technical) |
| 3 | 430..700 | MAZE RUNNER | two-deck high-speed maze, drop holes, pad up-links, opposite-phase island pair, 2× exit burst |
| 4 | 700..900 | GRAVITY SPIRE | compact floor→ceiling→wall→floor combos, fall shaft, gravity-orb chains |
| 5 | 900..1090 | CHOMPER FOUNDRY | 4+ Chompers × (moving island / lane weave / gravity swap / lava jump / low ceiling) |
| 6 | 1090..1310 | SHIP ABYSS | extreme tunnel: teeth, pillars, ribs, offsets, normal→inverted→normal→inverted-burst |
| 7 | 1310..1490 | SPIDER SPIRE | rapid floor/ceiling swaps, wall-to-wall, narrow spike-lined openings, vertical climb |
| 8 | 1490..1600 | VOID TERMINAL | teleport network + moving architecture + elevator deck change |
| 9 | 1600..1750+ | CORE REMIX | everything-remix finale (hardest ~15 s), 2×, finish |

Boundaries move empirically with the driver clock; duration stays 115–130 s
via speed tiers (0.5× precision moments, 2× bursts), never padding.
Lava contract, bounded portals, validators, edge-line pass, scene
identities: all preserved. Branch count ≥ 3, all real and tested.

## 8. QA plan

- `ShowcaseDriver` rewritten for the new route (real inputs, 0 deaths,
  both variants, replay VERIFIED) — automation proof of possibility only.
- `tests/helpers/routeMetrics.ts`: input-edge + trajectory analysis from a
  driven run (no engine changes — pure test-side observation).
- New tests: moving platforms, density thresholds, height/lateral proof,
  action-gap contract with designated recovery windows, completion bands,
  routing deaths, replay, alternate route.
- Browser QA: 16 evidence captures (opening density, multi-level islands,
  moving island, stairs, high-speed maze, stacked decks, gravity
  architecture, Chomper combo, Ship, inverted Ship, Spider floor/ceiling,
  Spider walls, teleport network, vertical environment, final remix,
  finish) + full in-page finish + REPLAY VERIFIED, zero console/page errors.
- Perf: materials/geometries/children/draws/dynamic-platforms tracked;
  bounded, no per-frame garbage.

## 9. Definition of Done (engineering)

`npm run verify` green; default still showcase; 115–130 s reference;
density/verticality/lateral thresholds green; moving platforms functional
+ tested + visible in browser QA; multi-level architecture; stairs/ascents/
drops; dense 3D maze; hard Cube/Ship/inverted-Ship/Spider/wall-Spider;
four-way gravity; more islands/pads/orbs/speed variation/traps; no
invisible kills; replay VERIFIED; alternate viable; browser QA clean;
performance bounded. Human gate: ENGINEERING COMPLETE / HUMAN
EXTREME-GAMEPLAY GATE OPEN.
