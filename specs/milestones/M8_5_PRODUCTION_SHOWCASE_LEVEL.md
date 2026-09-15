# M8.5 — Production Showcase Level ("THE DESCENT")

> Status: ENGINEERING COMPLETE / HUMAN SHOWCASE GATE OPEN (branch
> `feature/m8-5-production-showcase-level`, NOT merged to `main`).
> Automation proves completable, deterministic, replay-safe and
> branch-viable. Automation CANNOT prove fun, atmosphere, difficulty
> quality or visual identity — do NOT mark PASS until the human plays it.

## 1. Purpose

The first true "superproduction" level: a ~2-minute, HARD/EXPERT,
multi-route showcase combining every system built through M8/M8.1/M8.2/
M8.3/M8.4 (four-way gravity, Ship + inverted Ship, Spider + wall Spider,
Chompers, directed lava, bounded portals, teleports, maze, trap islands,
speed tiers, pads/orbs) into one coherent production-quality journey.

Target reaction: "this now feels like an actual game level, not a
collection of mechanics."

Explicitly out of scope: M9 music/BPM synchronization (no audio ships;
`rhythmCues` remain presentation-only position metadata for future
mapping), merges to `main`, ReplayV1 changes (unchanged), new simulation
mechanics (none added).

## 2. Level identity

- Id: `production-showcase-01` (`src/content/levels/productionShowcase01.ts`).
- Display name: `THE DESCENT`.
- **Default level**: opening `http://localhost:5173/` with no `?level=`
  loads the showcase. All legacy levels remain on explicit `?level=...`.
- Finish: z=1750. Reference route: tick 13955 = **116.29 s**, 0 deaths,
  1 attempt (both primary and alternate routes pin the identical anchor —
  same distance, same speed profile).
- Base speed 14 u/s; one 2× sprint (z 1510..1600) with a 1× return.

## 3. Act structure (9 acts, 9 visual scenes)

| Act | Z | Name | Gameplay |
|---|---|---|---|
| 1 | 0..210 | THE FORGE | 2 sourced gap basins, lane-split block, telegraphed spike, directed at-grade river (3 u hop) |
| 2 | 210..380 | FRACTURED ISLANDS | BRANCH (short): precision center chain vs side chain, decoy spike islands, required pad gap (10 u), required orb gap (9 u) |
| 3 | 380..540 | THE LABYRINTH | BRANCH (long, ~8 s): 4 tall walls with TWO viable doors each; routes reconverge at the single center door |
| 4 | 540..770 | GRAVITY CATHEDRAL | floor → leftWall → ceiling → rightWall → floor, routing gaps, ceiling spike garden |
| 5 | 770..930 | CHOMPER CANYON | 3 staged lunges, side lava pools, anchor pillars, arches, spike timing |
| 6 | 930..1160 | SHIP REACTOR | walled tunnel, rise/dive, flip to sustained INVERTED Ship (ceiling gravity), recovery chamber |
| 7 | 1160..1330 | SPIDER TEMPLE | floor ↔ ceiling snaps over dodge walls, ceiling spike, leftWall ↔ rightWall spider snaps past wall spikes |
| 8 | 1330..1480 | THE VOID | BRANCH: twin teleport entries (high orb line vs low pad line), reconnect, maw hop over 20 u void |
| 9 | 1480..1750 | FINAL GAUNTLET | 2× spike weave, wall-gravity burst, 4th Chomper, homage river, finish |

Recovery windows: full-width runways after islands (300..380), the
cathedral exit runway, the reactor recovery chamber (1090..1120), the
reconnect runway (1465..1480), the 1× return (1600..1620).

## 4. Branching (3 sections, all real)

1. **Islands** (z 228..300, short): route A center chain (lane 1) vs
   route B side chain (lane 2); same gaps, different lanes; decoy spiked
   islands beside both.
2. **Labyrinth** (z 405..520, ~8.2 s separated): primary lane-0 line vs
   alternate lane-2 line through two-door walls; reconverge at wall 4.
3. **Void teleports** (z 1360..1465, ~7.5 s separated): entry HIGH →
   orb line vs entry LOW → pad line; reconnect runway; maw hop shared.
- Missing a teleport ring meets the killFront divider (frontImpact).
- No fake doors: every advertised door is a traversable collider gap.

## 5. Systems exercised (all pre-existing, zero engine changes)

- 10 gravity portals (cathedral 4, ship invert/revert 2, temple 2,
  finale burst 2), 4 mode portals, 2 speed portals, 3 teleports —
  ALL bounded to their visible rings (`validatePortalBounds` clean).
- 2 jump pads, 2 jump orbs (both MANDATORY routing: plain crossings die
  by geometry — pinned in-suite), 4 Chompers (all spent on both routes).
- Lava: 2 gap-basin compositions, 2 directed rivers (forge + finale
  homage), 1 side composition, 2 canyon side pools — all
  sourced/contained (`validateLavaAuthoring` clean); islands/void menace
  via presentation-only setpieces.
- Ship: normal + sustained inverted (ceiling gravity) with inverted
  closed-loop regulation in the driver; Spider: floor/ceiling + wall
  snaps; maze killFront walls; trap-island decoys; 2.07-apex jump
  envelope honored everywhere (plain gaps ≤ 6 u).

## 6. Scripted QA

- `tests/helpers/showcaseScript.ts`: `ShowcaseDriver` (`primary` /
  `alternate`) — z-triggered real-input policy: gap jumps, in-window orb
  presses, lane taps, Spider presses, gravity-aware Ship closed loop,
  Chomper-lunge reactive jumps. Shared by unit tests and browser QA.
- `tests/showcase.test.ts` (12 tests): registry/default/override
  behavior, lava + portal-bounds validators, primary completion
  (116.29 s band, all modes/gravities, 4 spent, high+maw used, speed 1),
  replay VERIFIED, alternate completion (low+maw, high unused), maze
  frontImpact, basin lava, river lava, orb-gap void, divider frontImpact.
- Browser QA (`scripts/browser-qa.mjs`, M8.5 section): default-load +
  legacy-override checks, 8 staged environment frames
  (`showcase-01..12`), NDC river-composition proof, Chomper telegraph
  proof, FULL in-page real-input reference run with checkpoint captures
  (ship / inverted / spider-wall / teleport / core / finish) + in-page
  REPLAY VERIFIED. M5 default/fallback strings updated to the showcase
  (legacy geometry now pins via explicit `?level=controller-test-01`).

## 7. Visual identity (presentation-only, fingerprint-excluded)

Nine `visualSequence` scenes (forge ember / islands teal / labyrinth
violet / cathedral cyan / canyon red / reactor green / temple gold /
void indigo / core magenta), 28 `rhythmCues` (position metadata, no
audio), guardian route markers, lava menace setpieces, reactor glow,
void lake, finish arch. Renderer-owned only; ReplayV1 unchanged; golden
fixture intact.

## 8. Resource impact

Level data only (no new materials/geometries/systems). Heavier than the
gauntlet by content volume (more solids/hazards/lava/portals), same
shared-library budget. Real-GPU gate stays with the human (M6D
methodology applies when the level is approved).

## 9. Definition of Done

- [x] New level, default registry, legacy routes intact (unit-pinned)
- [x] 9 acts, 3 branch sections (2 substantial), maze, inverted Ship,
      wall Spider, 4 Chompers, rivers/falls/pools, islands, multi-surface
      spikes, bounded portals/teleports, speed changes, pads/orbs,
      recovery windows, climax finish
- [x] Reference completion 115–130 s, 0 deaths (13955 ticks / 116.29 s)
- [x] Alternate-route completion + replay VERIFIED
- [x] `npm run verify` green (typecheck + lint + tests + build)
- [x] Browser QA section + evidence captures
- [ ] HUMAN SHOWCASE GATE (fun / fairness / readability / identity) —
      OPEN. Play `?level=production-showcase-01` (default) end to end.
