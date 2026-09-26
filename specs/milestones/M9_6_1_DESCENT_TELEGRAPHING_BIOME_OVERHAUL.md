# M9.6.1 — Descent Telegraphing + Biome Overhaul (fairness first)

> Status: IN PROGRESS (branch
> `feature/m9-6-1-descent-telegraphing-biome-overhaul`). Human gates
> (readability feel, art direction, audible music, real-GPU performance) remain OPEN —
> automation proves mechanics, never art or fun. No merge to main,
> no force-push. Untracked user MP3s preserved untouched.
>
> Latest evidence: `npm run verify` green, 793 tests / 72 files;
> browser `descent-release-evidence` 20/20, current tape VERIFIED,
> nine captures within their actual biome bands, zero errors.
> Independent final QA/audio agents hit usage limits. Their final
> sign-off is absent; the orchestrator's checks do not substitute for it.
> Art is richer but still below the requested near-1:1 references.

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
- Current implementation: `biomeDressing.ts` combines seeded scatter
  with authored garden/temple landmarks; `visualDressing?` remains
  opt-in (Rift untouched). `EnvironmentView` batches 3D assemblies,
  route-face chips and architecture into 48/96-unit cullable chunks using
  shared geometry/materials. Water/lava fall strands animate with one
  shared shader time uniform; world-space voxel face shading and route
  materials avoid repeating image tiles. The level also has an authored
  lava source→fall→pool link. Added geometry sits outside the route.
- Biome map (Descent sections): forge=foundry (vents/pipes/embers),
  islands=garden (waterfall + floating rocks + vines), labyrinth=ruins
  (pillars/arches), cathedral=cavern (crystals/stalactites),
  canyon=crag (basalt pillars/ember chains), reactor=works (ducts/
  chains/cells), temple=garden-tech (roots/vines/gold trim),
  void=void (crystals/rocks), core=core (crystals/arches, light).
- Scenery stays outside the ±5.4 corridor, with rotated extents checked
  for the authored foliage. Shared chunks/materials, no new lights and
  no per-frame object allocations. Scenery is fingerprint-neutral.
  Gameplay edits are explicit level data: two maze micro-patterns and a
  sourced lava fall beside the route; both reference routes still finish.
  No moving creatures were added. Leaf sway and falling strands are
  presentation motion, frozen on pause.
- Scenery uses shared boxes plus one low-poly organic geometry. Spike
  core/socket materials are cached per biome; nine distinct base relief
  recipes share the same static trim batching owner. Tip, collider,
  outline position and all four mount transforms remain unchanged.

## 4. QA gates

- `npm run verify` green (including `telegraphing`, `biomeDressing`,
  `overgrownDressing`, replay, Descent and Rift regression suites).
- `scripts/browser-qa-m961.mjs`: on-route gap-frame shots (A1 + maze
  doors), spider-entry and nine biome stills, freshly generated
  current-content Descent tape with REPLAY VERIFIED, live per-act
  draw/triangle bounds, resource/disposal guard and zero errors.
- Legacy: final m95 full re-run 14/14 and m96 16/16 green after the
  gameplay, input, audio and rendering changes; m94/m941/m942/m92
  overlap-covered (documented scope). Logs are retained beside the stills.

## 5. Definition of Done

- Rules in GAME_DESIGN §7.10 + ARCHITECTURE owners + auditor green on
  both routes (on-line threats only) + gap frames and snap markers
  visible + completion anchors tick-exact + replays VERIFIED + no
  hot-path allocation/regression + bounded live per-act resources +
  real-GPU frame-time evidence + human biome/spider/readability review.
  The former +≤4 draw target applied to the smaller 2-batch proposal;
  the user's subsequent request for substantially more 3D scenery
  superseded that proposal. This does not waive performance review.
  Current status: automated engineering gates green; art fidelity,
  independent final sign-off and human feel/performance gates remain open.

## 6. Final implementation review (2026-09-26)

- Real defects: pointer/key state conflation, completed taps ignored by
  Cube held-only eligibility, cut→pause→restart audio restarting, biome
  shader hooks lost by Three.js material cloning, and reactor thin walls
  filtered out before interior detail could be built. Each has regression
  coverage or browser evidence. Cube semantics deliberately bump ruleset 2;
  schema remains 1, the regenerated 2,346-frame golden tape verifies.
- Art workers: Carson authored overgrown waterfall banks; Ohm authored a
  sourced side lava fall; Laplace replaced green box masses with trunks,
  folded leaves, moss, segmented lianas and fractured volcanic forms;
  Tesla authored spike palettes and nine bounded geometric sockets.
  Euclid batched static route trims while preserving fade/animation owners.
- Critical review: Herschel rejected plain reactor/void proposals;
  Aristotle rejected the earlier art/performance verdict and demanded
  an actual browser Spider snap. The orchestrator added the real input
  proof (one input attempt, no retry hiding a lost first press), interior
  machinery, close banks, nine shader structures, shorter culling chunks
  and a lighter shared halo tube. Latest independent
  re-review and Feynman's audio audit failed on usage limits.
- Resolved conflicts: a finished-pose 100-call estimate was unrepresentative
  (mid-route had 400–1,020 calls before batching). The live gate remains
  450 calls / 70,000 triangles at each correctly located biome capture.
  A late Temple failure at 70,582 was fixed, not waived: final 63,406.
  Warm-only legacy hazard style conflicted with the user's biome-spike
  requirement; base/Rift fallback stays warm, authored spikes use fixed
  matching outlines with unchanged lethal geometry.
- Final live replay: 122 samples, peak 374 calls / 63,934 triangles,
  WebGL Intel UHD hardware at 1280×720, GPU resources 25 geometries / 13
  textures across the nine shots. Library counts are separate (Descent
  72 materials / 9 geometries, Rift 47 / 9). Rolling-window p95 ranged
  12.0–20.5 ms; final 600-frame window p95 15.9 / p99 18.0 ms. Whole-run
  counters still include 15 frames over 50 ms; no stutter-free claim.
- Inspect actual screenshots and `comparison.html` in
  `qa/screenshots/descent-release-evidence/`. Comparison poses are close,
  not pixel-identical; the old cavern capture was in the preceding biome.
- Still weak: water remains stylized geometry/strands without convincing
  refraction/reflection/spray; foliage is sparse against the reference;
  light/shadow separation and void/core composition remain insufficient.
  Fast water lanes were not added (existing speed/route timing retained).
- Human retest: rapid keyboard/click Spider presses across entry/landing;
  all six marked snaps; upper/lower maze lines at 552–564 and 640–652;
  first-time doors/drops/Chompers; pause→R/Shift+R/F4→resume; menu/mode/
  checkpoint switching and audible single-track output; sustained play on
  target hardware; reference comparison of jungle, falls and spike style.
