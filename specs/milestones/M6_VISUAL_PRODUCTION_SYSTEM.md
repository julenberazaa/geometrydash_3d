# M6 — Visual Production System

## STATUS

M6 overall:
IN PROGRESS

M6A:
ENGINEERING COMPLETE / HUMAN VISUAL GATE OPEN

M6B / M6C / M6D:
PLANNED (not started — begin only after the human visual-direction gate approves M6A).

Automated: 182/182 tests green (`npm run verify`: typecheck + lint + tests +
build) — 170 pre-M6A + 12 visual-foundation regression tests. Browser QA:
M6A section 24/24 green with zero console/page errors; historical sections
show the documented CDP-timing/load flake set on this machine (no M6A
causation — see § BROWSER QA). Golden replay verifies unchanged (unit +
in-page proof).

## OBJECTIVE

Turn the M5-validated prototype into a coherent PRODUCTION VISUAL SYSTEM
without compromising gameplay readability, deterministic behavior, or
performance. M6A (this run) builds the reusable foundation M6B–M6D operate
on: production visual language, renderer-owned theme architecture,
shared/cached materials, platform/environment/hazard/player treatment,
controlled lighting/emissive/bloom/tone treatment, Floor/Ceiling parity, and
the screenshot evidence the human visual-direction gate decides on.

## ENTRY CONDITIONS

M0–M5 closed and human-approved (see `ROADMAP.md`). Entry HEAD `9233085`,
clean tree, 170/170 tests, `npm run verify` green, golden replay intact.

## CORE RULE: ZERO GAMEPLAY CHANGE

M6A is PRESENTATION ONLY. Untouched: Cube movement, jump, fast-fall, lanes,
gravity behavior, collision, hazards, interaction windows, pads/orbs, speed
portal behavior, portal ordering, death behavior, camera framing, Level 01 /
Level 02 geometry, replay semantics, simulation timing, ruleset version,
replay schema, level fingerprint gameplay contract. The 120 Hz simulation is
byte-identical (proven by the unchanged `floorCompat` golden gate + the
unchanged committed replay fixture verifying).

## VISUAL REFERENCES

`normal.png` (primary Cube direction), `arriba.png` (inverted-gravity
readability), `cohete.png` (future Ship reference — NOT built in M6A) are
DESIGN REFERENCES ONLY: never textures, sprites, backgrounds, or runtime
scene content (hygiene rule, pinned by review — no reference pixel ships).

Realized from `normal.png`: actual 3D depth, elevated chase perspective,
dark modular route with a clear vanishing direction, near-black environment,
deep violet/blue neon structure, cyan player, warm orange danger, strong
silhouette, obvious playable surface, controlled contrast.

## VISUAL HIERARCHY (canonical — see also `GAME_DESIGN.md` §9)

1. PLAYER (highest focal priority): cyan / electric blue, clean silhouette,
   bright free-face accents, restrained emissive, readable at all speeds.
2. HAZARDS: warm orange / amber, visually distinct from route geometry, never
   hidden by bloom, lethal silhouette readable before contact.
3. PLAYABLE GEOMETRY: dark blue / charcoal body, violet/blue edge language,
   clear surface plane, depth-oriented rails/seams.
4. INTERACTIONS (semantic accents, never one shared neon): yellow family =
   jump impulse (pads + jump orbs), blue = gravity (orb + portals share the
   cyan/blue family), one color + chevron count per speed tier.
5. ENVIRONMENT (lowest priority): depth, atmosphere, motion reinforcement —
   must not compete with hazards/player.

Anti-goal: "neon everything". Bloom reinforces important edges; dark surfaces
stay dark; black/near-black areas are allowed and desirable. No giant glowing
fog, no white clipping, no scene-wide wash, no constant visual noise, no
random light soup (exactly two lights: hemisphere + directional).

## PLAYER LANGUAGE

Dark cyan metal body (depth + surface response) + bright emissive accents on
BOTH free-face candidates (top panel = Floor free face, bottom panel =
Ceiling free face — children of the cube mesh so they inherit tumble and the
ceiling rest roll) + cyan edge lines + camera-side identity marker.
Cyan-dominant, never an over-bright white cube (face emissive 0.5, below the
bloom threshold — crisp, no halo). Visual size (1.24), collider (1.1³, never
rotates), tumble/landing/pose rules: UNCHANGED.

## PLAYABLE GEOMETRY LANGUAGE

Same gameplay geometry, production treatment: dark standard-material body
(rough 0.82 / metal 0.25), readable top surface plane (lifted tone + faint
0.35 self-emissive so the route never goes black under any light angle),
unlit-appearing ceiling-run panel matched in luminance (M3.3 free-face
parity, visual side), violet emissive edge rails (0.95 — the ONE controlled
bloom contributor on the route). All M3.2/M3.3 readability work preserved:
underside rails, Floor/Ceiling free-face parity, camera mirror invariant,
eye non-penetration (all pinned by unchanged regression tests).

## HAZARD LANGUAGE

Same colliders, same visual-larger-than-hitbox fairness margin (M2): warm
orange emissive standard material (1.7) on the existing cone silhouette —
bright enough to read at 2× against Floor AND Ceiling backgrounds, below
white-clipping, crisp under bloom (threshold 0.8 keeps the core tight).

## INTERACTION LANGUAGE

No mechanic redesign. Same shapes/positions/windows, production materials:
emissive yellow pad slab + dim base frame, emissive orb core + halo (idle
bob retained, render-side), emissive portal frames + fainter pane (0.10),
per-tier emissive speed materials (cached, shared by parts), pooled ring VFX
unchanged in behavior. Visual center still aligns with activation geometry;
used-state dimming retained.

## ENVIRONMENT LANGUAGE

Near-black background + fog envelope (per-level route identity flows
through), dimmer starfield (0.6), darker pillar silhouettes with restrained
window slits — below the bloom threshold by construction. Parallax dressing
only.

## THEME OWNERSHIP

`src/visuals/productionTheme.ts` — renderer-owned, ONE owner for every
purely-visual tuning value: palette, material response, fog, lighting, tone
mapping/exposure, bloom, DPR cap. `LevelTheme` (previously WRITTEN in level
data but never READ by the renderer — dead field) is now ACTIVATED as a
renderer-only route-identity overlay via `resolveProductionTheme()`:
validation-02 keeps its teal edge identity while the shared production
language (player/hazard/interactions/bloom/exposure) stays identical across
levels — same code path, no engine special-case. `validateProductionTheme()`
clamps overrides into the bloom contract. `BLOOM_CONTRACT` +
`RENDERER_CONFIG` (ACES tone mapping, `?post=off` default-on flag) live here.

## MATERIAL OWNERSHIP

`src/rendering/MaterialLibrary.ts` — SOLE owner of shared materials (26) and
geometries (8). Views create Meshes only, hold references acquired at build
time, allocate nothing per-frame, dispose nothing (library lives/dies with
the RendererHost — no HMR/restart/replay leaks). Speed-tier materials cached
by tier; ring-pool materials are a fixed library-owned set of 8.
`materialCount`/`geometryCount` observables feed the QA guards. Deliberately
NOT a general asset manager — sized to this project. (DeathBurstView keeps
its pre-existing 2 shared materials + 1 geometry: already shared, already
allocation-free — compliant, documented, not duplicated.)

## LIGHTING

Audit decision: minimum viable lighting — ONE hemisphere (theme sky/ground,
0.85) + ONE directional (cool, 1.5). No point lights, no light growth:
emissive/material design carries the neon response. Theme-owned values,
renderer-only, zero simulation coupling.

## COLOR MANAGEMENT

Centralized in `RendererHost` construction (single owner, values from the
theme): `ACESFilmicToneMapping` (neon-on-dark without white clipping),
exposure 1.15, `SRGBColorSpace` output. Honored identically by the composer
`OutputPass` and the direct-render fallback.

## POST-PROCESSING

`src/rendering/PostPipeline.ts`: `RenderPass → UnrealBloomPass →
OutputPass` (Three's maintained `examples/jsm` utilities — no new
dependency). Owned by the RendererHost; gameplay-independent; exactly one
composer per pipeline; resize-safe (`composer.setSize` + pixel ratio);
disposable (passes + targets released; idempotent for HMR).
Fallback: `setEnabled(false)` / `?post=off` bypasses the composer — same
scene, direct render, fully playable at zero post cost (`__gd3d`
`postEnabled`/`setPostEnabled` probes).
Stats honesty: `renderer.info.autoReset = false` + per-frame `info.reset()`
so `stats` reports scene + post cost under the composer path (previously it
reflected only the final quad pass: calls=1).

## BLOOM CONTRACT

Threshold 0.8 / strength 0.45 / radius 0.5 — from the theme, enforced by
`BLOOM_CONTRACT` (threshold ≥ 0.6, strength ≤ 0.7, radius ≤ 0.6) and pinned
by unit test. Only emissive edges/faces/hazards/portals exceed the
threshold; route bodies, environment, and dark areas never bloom. No camera
change, no gameplay dependency, resize/dispose covered by browser QA.

## FLOOR/CEILING PARITY

M3.3 is frozen and respected: ZERO `ChaseCamera` changes. New materials and
bloom apply surface-relatively (free-face accents on BOTH faces, matched
under/top inset luminance), so Ceiling reads with comparable depth.
Proof: live free-face projected-area ratio 1.000 under M6 visuals (browser
QA `m6a` parity check, same 0.95..1.05 live band as M3.3) + paired
Floor/Ceiling evidence screenshots. Existing `cameraFraming` (5) +
`undersideRails` (3) tests green unchanged.

## LEVEL 01 / LEVEL 02 REUSE

Same production system on both levels (`controller-test-01` violet,
`validation-02` teal overlay). No Level 03, no Level 02 gameplay redesign,
no engine special-case. Proven by shared-code-path construction + Level 02
browser checks + screenshots.

## REPLAY COMPATIBILITY

Hard gate, all green:
- Committed golden fixture (`validation-level-02-v1.json`, 2346 frames)
  NEVER regenerated; verifies via `tests/replayGolden.test.ts` (2/2).
- Theme/fingerprint decoupling pinned by new tests (renderer-only theme
  mutation → identical fingerprint).
- `computeLevelFingerprint()` source unchanged; replay schema/ruleset
  versions unchanged (still 1/1).
- In-page proof: natural death → F4 → REPLAY → REPLAY VERIFIED under M6
  visuals (browser QA), PLUS the full 2346-frame golden tape verified
  end-to-end in-page under M6 visuals (82 s wall under headless load —
  see § KNOWN LIMITATIONS on the 60 s M5-section window).
- A replay LOOKS richer in M6; its authoritative simulation is identical.

## PERFORMANCE BASELINE

Same machine, headless Chromium 1280×720 (SwiftShader — comparative only,
not a GPU benchmark):

| Metric | BEFORE (M5) | AFTER (M6A, post on) | AFTER (`?post=off`) |
|---|---|---|---|
| draw calls (level 01 start) | ~342 | ~363 (scene ~345 + ~18 bloom mips) | ~345 |
| triangles | ~6.1k | ~6.2k | ~6.1k |
| scene children | 49 | 49 | 49 |
| materials / geometries | ad-hoc (~30/12 across views) | 26 / 8 shared | 26 / 8 |
| rAF fps (software GL) | ~10–12 | ~8 | ~30 |
| build JS | 547.47 kB | (see § AUTOMATED QA) | — |
| console/page errors | 0 | 0 | 0 |

Reading: no mesh growth (same views, same counts); post adds exactly one
composer (3 passes) and ~18 driver calls for bloom mips; scene children
flat 49 across death/restart/replay. Headless fps is software-rasterizer
bound (fullscreen bloom passes on CPU) — NOT representative of real GPUs,
where this load is <1 ms class; `?post=off` is the weak-machine fallback.
No hot-loop simulation allocations added (no sim code touched). 60 FPS on
real hardware remains the target; a real-GPU measurement is explicitly
deferred to the human gate / M6D (see § KNOWN LIMITATIONS).

Budget contract (pinned): no unbounded growth, no per-frame
material/geometry creation, no sustained gameplay stutter introduced by
presentation (sim timing untouched — cadence tests green).

## AUTOMATED QA

- `tests/visualFoundation.test.ts` (12 new): theme↔fingerprint decoupling
  (mutation + resolution), shared-language identity across levels, bloom
  contract conformance + validator clamps/defaults, library sharing +
  bounded growth across views + update-stability + dispose-to-zero, post
  fallback structural test (disabled pipeline: direct render, 0 passes,
  resize/dispose-safe), sim-domain import-boundary scan (no `three` /
  `rendering` imports in core/input/player/collision/level/replay/content/
  GameSimulation).
- `tests/helpers/visuals.ts` (new, non-test support per AGENTS.md §9):
  `makeTestLibrary()`.
- `tests/undersideRails.test.ts`: updated to the M6A view constructor
  (library injection; assertions unchanged).
- Full gate: typecheck + lint + 182/182 tests + build (`npm run verify`).
- Untouched and green: `floorCompat` golden, `cameraFraming`, `gravity`,
  `interactions`, `replay` + `replayGolden`, `level02`, `hash`.

## BROWSER QA

Historical sections intact (no check weakened). M6A section (§21,
`m6a-*`, 24 checks) — ALL GREEN: theme/post/bloom active, bounded shared
resources, player/hazard/surface readability, floor + hazard + ceiling +
portal + interactions + 2× framing, Level 02 reuse, live-area parity 1.000,
F4 replay → VERIFIED under M6 visuals, resource/draw-call stability across
death/restart/replay, resize survival, `?post=off` fallback playable.
Zero console/page errors.

Historical-section note: this machine's runs show the documented
CDP-timing/load flake set (M5 spec: identical flakes on pristine pre-M5
HEAD in loaded environments) — e.g. wall-rate assertions, VFX-ring timing
windows, and the M5 60 s verify window (the full golden tape needs ~82 s
wall at headless throughput; verified pass with a longer window, in-page,
under M6 visuals). No M6A causation: the failing checks vary run-to-run,
the sim is untouched (all determinism tests green), and every M6A-specific
check is 100% green across runs.

## SCREENSHOT EVIDENCE

`qa/screenshots/m6a-*` (with JSON provenance sidecars):
`m6a-01-floor-production` (runway + rails + spikes + portal ahead),
`m6a-02-floor-hazard` (weave closeup),
`m6a-03-ceiling-production` (mirrored ceiling run),
`m6a-04-gravity-portal` (cyan flip-up gateway),
`m6a-05-interactions` (pad + orb + portal-down accents),
`m6a-06-speed-2x` (tier gateway),
`m6a-07-level02` (teal identity, weave + portal),
`m6a-08-replay` (REPLAY VERIFIED under M6 visuals).
Paired Floor/Ceiling free-face parity: `m33-*` method re-run in-section
(ratio 1.000).

## HUMAN VISUAL GATE (OPEN)

The human is asked to inspect/play (dev server, `main` @ this spec):
1. Floor normal gameplay. 2. Hazards. 3. Portals. 4. Interactions.
5. Ceiling section. 6. 2× speed section. 7. Validation Level 02
(`?level=validation-02`). 8. F4 replay.

Questions: does it look substantially more production-quality? Is the
player always obvious? Are hazards immediately readable? Is bloom
controlled (no wash, no white clipping)? Is the route visually clear? Is
Ceiling as readable as Floor? Does the style match the dark/neon 3D
direction? Anything too bright / noisy / flat? Does 2× remain readable?

Suggested URLs: `http://localhost:5173/` and
`http://localhost:5173/?level=validation-02` (append `?post=off` /
`&post=off` to compare the no-post fallback).

## KNOWN LIMITATIONS

- Real-GPU frame-time NOT measured on this machine (headless SwiftShader
  only) — 60 FPS on hardware is plausibly fine (6k tris, 2 lights,
  3-pass composer) but must be confirmed at the human gate / M6D.
- The M5 browser section's 60 s replay-verify window can expire under
  headless load (needs ~82 s wall for the 2346-frame tape); historical
  section left untouched — the pass was proven with a longer window.
- `?post=off` is a URL/dev toggle, not a settings UI (no settings UI in M6A).
- Ship visuals, trails, particles, triggers, beat sync, music: explicitly
  M6B+ (not started).
- Reference PNGs remain repo-root mood references only.

## DEFINITION OF DONE (M6A)

- [x] Production visual language established + documented (hierarchy).
- [x] Renderer-owned theme architecture (no second competing system).
- [x] Shared/cached material system (no per-frame creation, disposal clean).
- [x] Platform/environment/hazard/player production treatment.
- [x] Controlled lighting/emissive/bloom/tone treatment (contract-pinned).
- [x] Floor/Ceiling readability parity (ratio 1.000, zero camera changes).
- [x] Level 01 + Level 02 reuse proven.
- [x] Zero gameplay change (sim untouched; golden gates green).
- [x] Replay compatibility (golden unchanged + verified, unit + in-page).
- [x] 182/182 automated green; M6A browser QA 24/24 green; zero errors.
- [x] Performance BEFORE/AFTER recorded; no unbounded growth.
- [x] Evidence screenshots captured.
- [ ] HUMAN VISUAL GATE approval (OPEN — do not start M6B before it).

---

## M6B — Motion + Juice (PLANNED — do not implement yet)

Cube trail system, jump/landing particles, speed streaks, gravity-flip
bursts, richer orb activation bursts. Builds on the M6A material/post
foundation; must respect the same bloom contract + hierarchy + determinism
(sim never owns particles; presentation-only).

## M6C — Visual Triggers (PLANNED — do not implement yet)

Environment visual timeline/triggers, beat sync hooks, presentation events
driven by (never driving) simulation state. Design after M6A gate + M6B.

## M6D — Performance Closeout (PLANNED — do not implement yet)

Real-GPU measurement, hot-loop allocation review (§11 constraints),
draw-call/material/program audit, DPR/bloom quality scaling, final budget
sign-off. Closes M6.
