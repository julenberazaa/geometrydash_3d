# M9.6.1 — Descent Telegraphing + Biome Overhaul (fairness first)

> Status: ENGINEERING COMPLETE (branch
> `feature/m9-6-1-descent-telegraphing-biome-overhaul`). Human gates
> (readability feel, art direction, audible music) remain OPEN —
> automation proves mechanics, never art or fun. No merge to main,
> no force-push. Untracked user MP3s preserved untouched.
>
> Evidence: `npm run verify` green (64 files / 737 tests: +4
> telegraphing, +11 biomeDressing, +6 doorGaps, edgeLines re-pinned);
> `browser-qa-m961.mjs` 6/6 green (hub regression, 6 markers + 209
> dressing instances, gap/marker/biome stills, current-tape REPLAY
> VERIFIED 8/8 Chompers spent, perf flat vs Rift, zero errors);
> legacy m95 14/14 + m96 15/15 + m94 25/25 + m941 11/11 + m942 10/10 +
> m92 16/16 green on the final tree. M9.5 tape correctly stale after
> Zone G (fingerprint contract working — fresh tape generated).

## 0. Source state (verified 2026-09-26)

- Branch from `feature/m9-6-island-hub-input-spider-polish` @ `322b55f`
  (M9.6 hub work committed there first — nothing destroyed, nothing
  carried dirty). New branch has NO upstream (like M9.6 — never pushed).
- Baseline `npm run verify` FULLY GREEN: typecheck + lint + **716/716
  tests** + build.
- Two vite servers live (5173 + 5174, owners unclear) — QA uses 5174.
- Prior m95 rerun died with the audit tooling (stale); m96 gate 15/15
  green on current content.

## 1. GOAL-1 audit (headless sightline sweep, both reference routes)

Method: per-tick resolved camera eye + look target alongside both
drivers (ChaseCamera + CameraOcclusionResolver, RendererHost framing);
every hazard/door/chomper/portal/orb/pad/teleport gets first-seen
(in-frustum + unoccluded) → sight time until action; spider snaps get
destination visibility on the snap tick; no-input walk-offs get landing
visibility. Scripts: `scripts/tmp-sight.ts` (+`tmp-door66`,
`tmp-snapmand`, `tmp-pos`, `tmp-approach`, `tmp-geom*` — all temporary,
deleted before commit).

### Findings (primary + alternate agree unless noted)

- CHOMPERS CLEAR: every dormant creature visible ≥0.7 s before its
  trigger on both routes (incl. M9.5 deck/lower/shaft + weave@985).
- A1 doors (66/78/88, elevated weave): planes visible early (66 from
  spawn), but gaps hide behind the previous door's wall (78 seen 0.7 s
  out, 88 seen 0.5 s out). Screenshot: openings illegible at distance
  (dark red band). NOT a geometry bug — a gap-legibility bug.
- pad-sky: alternate 2.43 s ✓; primary 0.20 s (drops off the traverse
  onto it). Pad is passive + approach x-spread 0.00 (route-shaped) →
  fair by shaping, needs its own rule (not sight time).
- sportal@720 (ps-speed-spire, 1x): 0.41 s both. Passive routing gate;
  volume x±1.6 covers the weave exit (runner x=0.00 at 720 both
  variants) → fair by coverage. Threshold 0.4 for routing portals.
- Walk-offs: 360→365 + 622→629 (primary; hidden-below-frame landings),
  890→913 shaft (visible ✓), 1110→1312 (ship-flight artifact —
  discarded by mode-change rule). Landing zones 360-372 and 623-636
  contain ZERO hazards → curb verdict (visible edge + safe landing +
  no mid-fall action = fair by shaping).
- SPIDER: 6/14 snaps blind-destination, ALL `out-of-frame` (never
  occluded): 1344/1356/1364/1400/1482/1749. Mandatory test (remove the
  press → outcome): 1344/1364/1400/1482/1749 DIE, 1356 finishes
  (optional). 5 mandatory blind forced actions = the sharpest GOAL-1
  violation. Camera cannot show both surfaces (pinned framing) and
  route cannot move (frozen) → pattern-language fix: authored
  snap-zone markers (orb-pattern: visible cue + press edge).
- Off-line artifacts (correctly EXCLUDED by the on-line filter, not
  fixed): primary 254/266 spikes + 601 chomper (alternate's LOW line),
  alternate 610/612 upper items (primary's deck), pad-sky for nobody
  (shaping rule instead).
- Auditor self-found bugs (fixed in-tool, documented): negative-z
  sentinel collision (spawn-visible points misreported NEVER-SEEN).

### Rule set (new GAME_DESIGN §7.10 — explicit quality rules)

- R-decision (doors forcing NEW decisions, lateral spikes, chomper
  triggers, ferry boards, teleport entries): gap/action visible ≥0.7 s.
  Sequenced doors: first ≥0.7 s, followers ≤0.5 s after the previous
  door's plane (tutorial-rhythm exception: alternating pattern,
  checkpoint-adjacent, instant retry — A1 only, documented).
- R-action (orbs — timed presses): window visible ≥0.5 s.
- R-routing (speed/mode/gravity portals, pads): gate/volume covers the
  natural exit line + visible ≥0.4 s. Pads alternatively pass by
  approach-line unambiguity (runner x-spread ≤2.5 u over the 15 u
  before the pad).
- R-drop (no-input walk-offs): landing visible at takeoff OR before
  touchdown (≥0.2 s) OR (edge visible + landing zone hazard-free +
  no mid-fall action). Mode/gravity/teleport flights excluded.
- R-spider (forced snaps): destination visible OR authored snap-zone
  marker on the runner's line (orb-pattern).
- R-chomper: dormant visible ≥0.7 s before trigger (pinned, all pass).
- R-new-content: the committed auditor (`tests/helpers/sightline.ts`
  + `tests/telegraphing.test.ts`) runs the full rule set on both
  reference routes — future content must keep it green.

## 2. GOAL-1 fixes (smallest robust changes)

- F-gapframes (rendering, kind-based, zero gameplay): LevelView detects
  same-z killFront groups → computes gap intervals → white-cyan 4-bar
  frames around each gap (1 shared library material, bounded meshes).
  Makes every maze/door opening pre-attentive the moment its plane
  reads. Lifts A1 + all M9.5 doors at once.
- F-snapmarks (data + rendering, zero gameplay): `VisualSetpieceDef`
  kind `'snapmark'` × 6 at the blind press points (mint diamonds via
  the biome glow instancing — 0 extra draws): (0,2.15,1341.5),
  (2.6,7.85,1353.5), (2.6,2.15,1361.5), (0,7.85,1397.6), (-3.4,3.0,1479.5),
  (0,5.85,1746.5) (runner line, free-face offset — wall runs offset +x
  toward the corridor — ~2.5 u before press).
- F-walkoffs: no geometry change (all fair by shaping) — pinned by the
  rule test instead.
- F-padsky/sportal720: no geometry change (shaping/coverage rules) —
  pinned by the rule test instead.
- Explicitly NOT done: moving A1 doors (would gut the tutorial weave;
  sequenced rule + frames cover it); new checkpoints (progress
  semantics frozen); camera changes (pinned); readiness-cue signal
  (deferred — documented NEXT step if markers prove insufficient).

## 3. GOAL-2 audit (dressing census per 200 u bin, Descent)

- 600-800 (maze/spire): 0 setpieces. 800-1000 (spire/foundry): 0
  setpieces. Whole level: 9 setpieces, 2 kinds (guardian/lava).
  Mid-level ~30 s runs with ZERO dressing — the evidence for "plain".
- Per-act color identity EXISTS (9 visualSequence sections) — the gap
  is texture/dressing, not color. Background layer EXISTS (instanced
  architecture + beams + motes). The gap is ROUTE-ADJACENT midground.
- Design: `biomeDressing.ts` (pure seeded placement, deterministic) +
  `LevelDefinition.visualDressing?` (opt-in per level — Descent
  declares, Rift untouched) + EnvironmentView instanced build (2 draws:
  solid props + glow props, static, per-instance section-accent
  colors) + ONE waterfall (skybridge islands act, 2 planes + pool,
  opacity pulse in the existing per-frame update path) + snapmark
  diamonds batch into the glow instancing (0 extra draws).
- Biome map (Descent sections): forge=foundry (vents/pipes/embers),
  islands=garden (waterfall + floating rocks + vines), labyrinth=ruins
  (pillars/arches), cathedral=cavern (crystals/stalactites),
  canyon=crag (basalt pillars/ember chains), reactor=works (ducts/
  chains/cells), temple=garden-tech (roots/vines/gold trim),
  void=void (crystals/rocks), core=core (crystals/arches, light).
- Constraints honored: |x|≥7 clearance (never in corridor), fogged,
  no new lights, no per-frame allocs, fingerprint-neutral
  (presentation-only data), no new solids (no gameplay/collision
  change), creatures skipped (design §7.2 forbids moving decoration;
  static animals would read as clutter — honest no).
- Vocabulary maps to EXISTING library geos/mats (+1 shared white glow
  basic material if none qualifies; rotated boxes = crystals/rocks).

## 4. QA gates

- `npm run verify` green (new: `telegraphing` + `biomeDressing`
  suites; updated: none — anchors/pins untouched by construction).
- New `scripts/browser-qa-m961.mjs`: gap-frame legibility shots (A1 +
  maze doors), snap-marker shots (spider entries), biome stills per
  act, Descent full completion (reference tape? Descent tape is
  gameplay-identical — reuse m95 tape!), perf/resource guards
  (draw calls/materials/geometries vs M9.6 baseline), zero errors.
- Legacy: m95 + m96 full re-run (gameplay-identical content, but
  LevelView/level-file touched → prove it); m94/m941/m942/m92
  overlap-covered (documented scope).

## 5. Definition of Done

- Rules in GAME_DESIGN §7.10 + ARCHITECTURE owners + auditor green on
  both routes (on-line threats only) + gap frames visible in shots +
  6 snap markers visible + completion anchors tick-exact + replays
  VERIFIED + perf flat (+≤4 draws, +0 hot allocs, materials +≤1,
  geometries +0) + branch pushed + tree clean (temp scripts deleted,
  playwright uninstalled, manifests restored) + final report.
