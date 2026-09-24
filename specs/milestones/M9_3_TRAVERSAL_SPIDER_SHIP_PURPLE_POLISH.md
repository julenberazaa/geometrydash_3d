# M9.3 — TRAVERSAL DENSITY + SPIDER FIX + SHIP ROUTING + PURPLE MEGASTRUCTURE

> Targeted high-value polish on the human-approved M9.1/M9.2 game. No
> rebuild: music, checkpoint mode, audio-graph fix, M9.2 visuals, camera,
> lava, replay and determinism are preserved. The central principle is:
> **THE ROUTE PASSES THROUGH THE WORLD** (walls, windows, walkways,
> towers, tunnels, shafts, stacked floors — not flat slabs with props).

Work branch: `feature/m9-3-traversal-spider-ship-purple-polish` (no merge
to main, no force-push). Source HEAD: `ff1d584` (verified: branch
`feature/m9-2-audio-checkpoints-visual-overhaul`, HEAD match).

## 0. Human M9.2 verdict (authoritative)

Liked: M9.1/M9.2 gameplay direction, music/audio, checkpoint mode, lava,
camera, visual direction, overall difficulty. Findings (5 + 1):

1. Some sections need almost no lateral movement (central complaint).
2. Spider: real bug on the FIRST upside-down transition + slightly too
   difficult overall.
3. Ship can bypass mandatory portals (incorrect).
4. Ship needs more lateral/X movement, probably slightly lower speed.
5. Purple biome weakest: flat, little lateral, weak spikes/routes, too
   little architecture in traversal.
6. Islands should react MUCH more strongly on Cube landing.

## 1. Straight-run audit (measured, BEFORE)

Method: headless reference-route scan (`scripts/tmp-audit.ts`, scratch —
reference driver on THE DESCENT, both variants, finish tick 13799).
Action = lane-target change | jump edge | fast-fall engage | mode/gravity
change. Contract targets: action gaps rarely > 0.75 s (90 ticks);
lateral gaps rarely > 1.25 s (150 ticks) outside authored recovery.

Action gaps > 0.75 s (primary, 20): islands 263–346 (ferry ride);
purple 522–656 (7 gaps), 681–700; cathedral 740–752, 831–844, 890–913;
foundry 999–1042 (2); ship-exit runway 1311–1341 (1.14 s); spider
1488–1499; void 1503–1538 (1.64 s).

Lateral gaps > 1.25 s (primary, 20 — worst): purple 522–665 (10.22 s —
the single weakest stretch in the level); cathedral 714–806 (6.32 s),
852–942 (6.42 s); islands ferry 296–387 (6.48 s); ship 1086–1172
(5.03 s, cube 2× slalom + entry), 1214–1352 (~8.5 s across 3 gaps);
foundry 984–1048 (4.06 s); spider 1366–1463 (3.88 s, vertical climb —
engaged but not lateral); spider→void 1475–1633 (9.14 s); forge exit
130–174 (3.11 s).

Per-biome lateral changes (primary): forge 14, islands 18, purple 16
(over 19.6 s — worst rate), cathedral 4 (over 14.2 s), foundry 14,
ship 6 (over 14.9 s), spider 4 lane (+23 vertical snaps), void 0–1,
core 12. Ship flight envelope: x −2.6..2.6, y 0.6..6.4.

Rule for surgery: lane/portal/spike/wall insertions are TIME-NEUTRAL
(forward speed constant) — force lateral movement on the existing
timing skeleton; keep jump/gravity/speed/mode Z positions (musical
anchors) unless deliberately re-authoring with re-sync. Purple is the
exception (largest reauthoring, same event skeleton).

## 2. Spider bug RCA (PROVEN by reproduction, not inferred)

Symptom: first upside-down transition sometimes needs two presses.
Repro (`scripts/tmp-spider-repro.ts`): press ON the entry step enters
spider but does NOT snap (dead 0.11 u hop); press one step later snaps
cleanly (ceiling, grounded, support set).

Root cause: the snap check runs at the top of the step under the
PRE-portal mode while mode portals fire at the bottom. A press on the
exact entry step is consumed as a cube jump whose only effect the
handoff then zeroes (`applyModeTransition` clears along-gravity
velocity) — a hidden one-step dead-input window. No cooldown, no flush,
no grounded dependence (all ruled out by code reading + probes:
`trySpiderSnap` never reads `grounded`; `aabbOverlap` is strict so the
dodge wall cannot veto the snap; input is sampled per sim tick with no
multi-delivery). Entry-step aliasing is the sole mechanism, and it
strikes anticipation presses exactly when a human reacts to the gate.

Fix (mechanics, `GameSimulation.processModePortals`): when a step with
the primary edge genuinely enters spider mode, honor the edge as a snap
attempt in the new mode (same order as the top-of-step snap — before
pads/orbs; hazard death still wins the step). Old-mode consumption on
that step is always vacuous (its effect is destroyed by the handoff),
so nothing is lost. Exits/ Szymanski unchanged; deterministic and
replay-safe (pure function of the input tape).

Regression: `tests/spiderFirstSnap.test.ts` (8 tests) — entry-step
press snaps (arena + real DESCENT entry y≈9.45), after-entry parity,
hold-no-edge, no-support ignore, transit-hazard death with no flip,
restart re-arm, checkpoint-restore re-cross.

## 3. Spider difficulty (one notch, separate from the fix)

- Technical entry sequence at 1× (extend the `ps-speed-wall-calm`
  1× window to cover the first multi-surface snaps), keep a shorter 2×
  climax burst. Existing tiers only.
- Slightly wider safe surfaces / larger openings on the hardest snap
  chain (climb shaft x±1.6 → roomier, one or two tight hazard pairs
  removed/softened), clearer spike silhouettes, brief recovery between
  the hardest chains.
- Keep: four-way snaps, wall Spider, snap density, musical anchors.

## 4. Ship portal bypass RCA

All DESCENT ship gates are ~3 u trigger boxes inside a ~12×12 open
tunnel (shell x±6, floor −3, ceiling 9, z 1110–1330): no gate is
hard-funneled. Probes (`scripts/tmp-ship-bypass.ts`):

- Altitude/side offsets miss rings and survive (e.g. invert miss at
  y6.5 alive past +15; ship-off miss continues as ship past 1328).
- Gravity flips self-heal at the next paired portal (missing one flip
  is often free), so the inversions read as optional and the beat-map
  breaks. Mode/speed misses are the severe class (wrong mode into the
  spider spire; 2× arrival ~250 ms early / 1× late arrivals desync music).
- Already-correct: `ps-ship-on` miss dies at the rise wall (punished by
  geometry — no change).

Fix (§15, NO invisible triggers): full barrier walls with ONE aperture
exactly at each ring (visible opening == required opening) for
`ps-speed-approach`, `ps-abyss-invert`, `ps-abyss-revert` (HIGH
aperture), `ps-abyss-invert2`, `ps-abyss-revert2`, `ps-ship-off`,
`ps-speed-spider` (center lane aperture on the runway). Missing a ring
= wall collision. Negative-route tests per gate (above/below/left/
right): inside fires, beside misses, bypass cannot continue.

## 5. Ship redesign (3D steering, lower speed)

- Funnel apertures are themselves lateral content (HIGH LEFT → LOW
  CENTER → MID RIGHT …): thread windows, side-wall slaloms, suspended
  pillars, upper/lower ribs, central columns, portal apertures.
- Technical abyss at 1× (already mostly 1×; keep), short 2× bursts only
  where musical; re-author distances so the 115.06 s finish anchor holds.
- Target feel: precise 3D trajectory through a machine, not reaction
  speed. Difficulty from trajectory/reading/X+Y control.

## 6. Island landing glow (presentation only, zero gameplay change)

Generic renderer-owned contact response: the touched support/island
briefly surges edge emissive + local glow pulse + pooled particles
(~0.15–0.40 s), LOCAL only (no global brightening). Material sharing is
preserved via the `CameraOccluderFade` precedent (clone-on-land bounded
slots, restore + dispose — no leaks). Moving islands supported (effect
follows the platform pose). Fires on landing (never delayed to a beat;
optionally modulated near musical anchors). Probes:
`lastContactPulseId / contactPulseIntensity / contactPulseCount`.

## 7. Purple biome overhaul (`ps-labyrinth`, z 430–720 — largest rebuild)

BEFORE: maze doors + flat upper hole-chain + lower weave + ferry pair;
16 lateral changes over 19.6 s; y range 2.6–6.6 (alternate);
10.22 s lateral gap. AFTER target: multi-level neon megastructure —
elevated walkway → window drop → lower passage → suspended bridge →
wall apertures (HIGH LEFT / LOW RIGHT / CENTER MID) → tower interior →
precision islands → stairs → fast-fall opening → bridge underpass →
tunnel → high route. ≥4 height bands, ≥1.7× lateral direction changes,
spikes that SHAPE the path (edge/ceiling/one-side/aperture/double/
alternating rows), one landmark (energy tower / reactor shaft / bridge
city), violet/indigo + magenta/cyan identity, fog/windows/shafts/
towers/motes/lightning without white-out or hazard masking. Same event
skeleton (doors, orbs, pad 530.5, ferries, speed 692) so musical anchors
hold; checkpoint `cp-labyrinth` re-seated if its safe boundary moves.

## 8. Global cleanup + musical re-alignment

Ferry-ride gaps (islands 296–387), cathedral laterals (714–806,
852–942), foundry (984–1048), void runway (1503–1538), forge exit
(130–174), ship-exit runway (1311–1341): time-neutral lateral forcing
(staggered walls, windows, pillars, spike rows, island offsets) on the
timing skeleton. One/two-route philosophy kept (funnel teeth, never
open corridors). Checkpoints re-seated only if safe boundaries move;
audio graph, camera, lava untouched. Music re-aligned after geometry:
Z positions, speed portals, cues, Chomper triggers re-anchored to
Gravity Lessons (finish beat 230 / 115.06 s).

## 9. QA + Definition of Done

`npm run verify` green; audio structural/browser gate; checkpoint gate;
full classic playthrough + replay VERIFIED (13799-tick anchor or a
re-derived + re-justified anchor); camera occlusion sweep through new
walls/windows/tunnels; targeted Spider gate (first-snap browser proof);
targeted Ship bypass gate (negative routes); island-contact probes;
route metrics before→after (§41 table). Human gates: traversal feel,
spider feel, ship feel, purple look + route, island feedback.

## 10. Commits

1. spec + audit (this file) 2. spider fix + tests 3. spider easing
4. ship funnels + bypass tests 5. ship lateral/speed 6. island glow
7. purple gameplay 8. purple visuals 9. global cleanup + resync
10. browser QA + docs (ROADMAP/GAME_DESIGN/ARCHITECTURE as changed).

## As-built (updated per commit)

- Commit 2: entry-edge fix + `tests/spiderFirstSnap.test.ts` (8 tests);
  anchor 13799 intact (showcase/playerModes/checkpoints/density/M91/
  openness/musicAlignment green).
- Commit 3: spider easing (wall #1 1350→1353, climb slabs ±1.6→±2.1,
  teeth 1348→1351/1362→1364, pairs 1378+1392 removed, pre-gate pair at
  1340 added for the width ratchet); driver presses/taps re-seated;
  anchor + width (74.0/16.2/9.9) green.
- Commit 4: six portal funnels (speed-approach, invert, revert-HIGH,
  invert2, revert2, ship-off; visible opening == trigger volume) +
  `tests/shipPortalBypass.test.ts` (8 groups: controls fire, offsets
  miss + die at rock; ship-on miss dies at the rise wall; speed-spider
  sneak dies on the lanes-0+2 teeth — no funnel needed there); S-weave
  center pillar 1280→1276 + return tap 1282→1278 so the reference line
  clears the invert2 funnel face; anchor 13799 intact.
