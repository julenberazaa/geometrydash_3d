# M6 — Visual Production System

## STATUS

M6 overall:
IN PROGRESS

M6A:
ENGINEERING COMPLETE / HUMAN VISUAL GATE OPEN

M6B:
ENGINEERING COMPLETE / HUMAN MOTION-JUICE GATE OPEN

M6C1:
VISUAL TRIGGER INFRASTRUCTURE ENGINEERING COMPLETE

M6C2:
REACTIVE VISUAL AUTHORING + GROUND CONTACT FX ENGINEERING COMPLETE /
HUMAN REACTIVE/CONTACT GATE NOT PERFORMED

M6C2 / final artistic timeline authoring:
REMAINING (M6C2 below is the event/contact pass, not the full artistic
timeline — proof section values are still provisional taste)

M6D:
NOT STARTED (M6C2 was built without waiting for human review of the
M6A + M6B + M6C1 presentation at the user's explicit direction for this
session; all prior human gates are STILL OPEN and no foundation was
re-canonicalized by M6C2).

M6 HUMAN FEEDBACK (2026-09-08, recorded conservatively): the human played
the current M6 presentation, said it is "quite good", and explicitly
requested proceeding to M7. Recorded as: M6 PRESENTATION DIRECTION HUMAN
APPROVED TO PROCEED TO M7. No stronger claim is made; no individual
M6A/B/C parameter is permanently locked. M6D final real-GPU performance
closeout is intentionally deferred — M7 creates the representative
production-level workload M6D should profile. M6 is therefore NOT marked
fully closed.

Automated: 238/238 tests green (`npm run verify`: typecheck + lint + tests +
build) — 226 pre-M6C2 + 12 event-punch/contact regression tests. Browser QA:
M6C2 section 15/15 green AND M6C1 25/25 + M6A/M6B green (regressions),
zero console/page errors; historical sections show the documented
CDP-timing/load flake set on this machine (no M6C2 causation — see
§ BROWSER QA). Golden replay verifies unchanged (unit + headless timeline
integration + in-page F4 proof).

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

## M6B — Motion + Juice (ENGINEERING COMPLETE / HUMAN MOTION-JUICE GATE OPEN)

Built as a REVERSIBLE presentation layer on the current provisional M6A
foundation (M6A NOT re-approved, NOT re-canonicalized — still OPEN). No
M6A visual tuning was redesigned; two M6B-camp config additions only
(FxConfig block + burst lifetimes, all presentation). M6C/M6D not started.

### M6B OBJECTIVE

Motion language + gameplay juice without changing ANY authoritative
gameplay: Cube trail, jump/landing feedback, gravity-transition pulses,
speed streaks + transition bursts, richer pad/orb activation bursts —
presentation only, pooled, bounded, `?fx=off`-reversible.

### M6B VFX OWNERSHIP

`src/rendering/VfxSystem.ts` — the ONE presentation VFX owner, owned by
`RendererHost` (scene group +1 child: trail Points + burst Points +
streak InstancedMesh = exactly 3 draw calls when active, 0 when `?fx=off`
— group hidden). Observes pre-existing sim seams only (`onJump` bridged by
the Game composition root; `grounded` edge + pre-landing velocity;
`portalTransitionCount`; `speedPortalCount`; `interactionEventCount` +
`lastInteraction`; `deathId`/`attempts`/status/position-discontinuity for
reset). No sim change, no new sim event, no THREE in sim (pinned).
`MaterialLibrary` untouched (VFX owns 3 fixed materials + 3 fixed
buffers/geometries like the DeathBurstView precedent — no second
manager). FX tuning lives in the SAME authority (`ProductionTheme.fx`,
clamped by `validateProductionTheme`).

### M6B CUBE TRAIL

Fixed-capacity (96) additive cyan Points ring following the SAME
interpolated cube position as PlayerView. Spawns at the rear face
(surface-agnostic +Z offset — center-spawned points die inside the opaque
mesh to the depth test; found by screenshot review). Lifetime + density
scale with the authoritative speed multiplier (0.5x subtler → 4x
stronger, capped); fades to additive-black; Floor + Ceiling identical.

### M6B JUMP / LANDING FX

Jump: one burst per REAL `onJump` (consumed signal — no polling
synthesis), biased along the frame surface normal. Landing: renderer-side
grounded edge, radial disk in the support plane, intensity from
pre-landing along-gravity speed (capped 0.25..1 — fast-fall lands harder
without exploding). No squash (particles alone). Collider untouched.

### M6B GRAVITY FX

One cyan/blue spatial pulse per `portalTransitionCount` edge (portals AND
gravity orbs share the one transition path), biased along the NEW surface
normal — mirrors naturally, no ceiling constant. Same-frame gravity-orb
interaction events deduplicated (no double burst). No camera/world motion.

### M6B SPEED FX

ONE InstancedMesh (24) of thin forward-aligned slivers recycled in a
corridor volume around the player: 0 at ≤1x (nearly absent by design),
8/16/24 at 2x/3x/4x + opacity tier + transition-spike surge. No motion
blur. Works with bloom on AND off (orb sections prove FX on the direct
path). Tier-colored one-shot pulse per `speedPortalCount` edge
(same-frame `speedPortal` interaction event deduped).

### M6B INTERACTION FX

M4 pooled rings KEPT (not deleted). Complemented: pad = yellow burst
along the surface normal; jump orb = compact yellow pulse; gravity orb =
blue flip pulse (or the shared flip pulse when the transition edge
coincides); speed portal = tier-colored pulse. Semantic M6A colors kept.
Fires only on real `interactionEventCount` edges at the `lastInteraction`
anchor — used/inert interactions emit nothing.

### M6B POOLING

Trail 96 + bursts 384 + streaks 24: preallocated Float32Arrays /
InstancedMesh, ring cursors, zero per-frame/per-event allocation (scratch
Vector3/Matrix4/Color only), dead slots fade to additive-black,
`frustumCulled=false`, idempotent dispose. Counts observable
(`trailSamples`/`activeParticles`/`activeStreaks`/cumulative per-kind
counters/monotonic `fxResets`).

### M6B RESET LIFECYCLE

Any `attempts` edge (death-respawn, manual R, replay start —
`startReplay()` respawns), any death edge, any >5 u teleport clears
transients: no respawn-to-death trail line, no stale streaks/particles.
Cumulative QA counters never reset (evidence).

### M6B REPLAY BEHAVIOR

Nothing stored (no positions/trail/bloom/timestamps in ReplayV1 —
unchanged schema/ruleset). F4 recreates juice naturally: the same
replayed sim events re-fire the same edges (proven headlessly: full
2346-frame golden tape verifies WHILE VFX observes every tick with
jump/landing/gravity/speed/pad all re-firing; proven in-page: replayed
jump re-fires the burst counter, then VERIFIED).

### M6B FX FALLBACK

`?fx=off` (or runtime `setFxEnabled(false)`) hides the whole layer:
group invisible + transients cleared, gameplay identical, M6A foundation
intact. Matrix proven: post×fx all four combos playable. No settings UI.
Pause passes dt=0 (Game composition root): trail/particles/rings/burst/
tumble/camera all freeze with presentation pause — sim pause untouched.
This also gives deterministic QA photography (freeze young bursts).

### M6B RESOURCE BUDGET

Draw calls +3 steady-state (2 Points + 1 InstancedMesh); triangles +288
max (streaks); scene children 49→50 (one group); library materials 26
+ geometries 8 UNCHANGED; VFX fixed +3/+3 outside the library;
active particles ≤384, trail ≤96, streaks ≤24; flat across
death/restart/replay (browser-proven). Build +15.81 kB (588.04 total;
>500 kB warning remains pre-existing three.js).

### M6B AUTOMATED QA

`tests/motionVfx.test.ts` (23 new): pool boundedness under spam + long
runs, exactly-once emission per edge (jump/landing/gravity/speed/pad/
orb/dedup rules/used-orb silence/ceiling surface-relativity), landing
intensity scaling + cap, reset paths (restart/death/teleport/replay-start
+ monotonic reset counter), `?fx=off` independence + clean resume,
library counts stable across events, idempotent dispose, fx-clamp + theme/
fingerprint decoupling, GameSimulation VFX-free boundary, golden-tape
headless VFX integration (verifies pass + juice re-fires).
Full gate: typecheck + lint + 205/205 + build. Untouched and green:
`floorCompat`, `cameraFraming`, `gravity`, `interactions`, `replay` +
`replayGolden`, `level02`, `hash`, `visualFoundation`.

### M6B BROWSER QA

M6A section intact (24/24, no check weakened). M6B section (§22,
`m6b-*`, 24 checks) — ALL GREEN, zero console/page errors: default-on +
runtime toggle + `?fx=off` independence, trail lifecycle (R + death +
resets edges), exact-once jump/landing/fast-fall-scaling/gravity/pad/
orb/g-orb/speed+streaks, Ceiling surface-relativity, Level 02 shared path,
F4 recreation + VERIFIED, resource boundedness, post×fx matrix, resize.
Tight-window orb presses run on a fresh `?post=off` page (~30 fps
headless; emission is post-independent) — documented in-section.
Historical-section note (unchanged): this machine's CDP-timing/load flake
set (wall-rate assertions, VFX-ring timing windows, M5 60 s verify
window); M4/M5 sections flap identically with and without M6B. No M6B
causation: sim untouched, all determinism tests green, M6A+M6B 100%
green across consecutive runs.

### M6B SCREENSHOTS

`qa/screenshots/m6b-*` (+ JSON sidecars): `01-trail` (+ `01b` fx-off
pair on the same frozen frame), `02-jump`, `03-landing`, `04-gravity-flip`
(orb-flip pulse — same shared path, clean backdrop), `05-pad`, `06-orb`
(post-off page), `07-speed-2x` (tier-2 sprint into the finish gate),
`08-ceiling`, `09-level02`, `10-replay` (VERIFIED + recreated trail).
Review findings (fixed in-run): center-spawned points died inside the
opaque cube (→ rear-face/shell spawns); 0.35 s lives expired before
headless photography (→ 0.45-0.6 s lives, still snappy); portal-pane wash
(→ orb-flip evidence + settled 2x framing).

### M6B PERFORMANCE DELTA

Same-machine headless (SwiftShader — comparative only, NOT a GPU
benchmark; real-GPU verdict stays M6D): calls ~363→~364 at spawn (+3
steady-state FX draws), tris ~6.2k (+288 max streaks), children 49→50,
materials 26 + geometries 8 (library flat), trail ≤96 / particles ≤384 /
streaks ≤24 observed live, build 572.23→588.04 kB. No sim hot-loop
impact (no sim code touched). 60 FPS on hardware still the target,
measurement deferred (M6D).

### M6B HUMAN GATE (OPEN)

Same URLs as M6A (`/` and `?level=validation-02`, plus `?fx=off` /
`&fx=off` for the foundation comparison). Added questions: does motion
read better (trail direction, jump/landing weight, flip cue, 2x energy)?
Is anything noisy, obscuring, or over-bright? Do effects stay subordinate
to hazards/player? `?fx=off` comparison: is the juice worth it?

### M6B KNOWN LIMITATIONS

- Headless 1-3 fps cannot show full trail shapes (0.45 s ≈ 6 u at 1x);
  evidence shows the language (glow/sparks/streaks), not the full ribbon.
- Tight-window orb photography needs the post-off page under load.
- Streaks are deliberately subtle (thin slivers, ≤0.5 opacity).
- Real-GPU frame-time still unmeasured (M6D).
- M6A gate STILL OPEN — M6B tuned against the provisional foundation.

### M6B DEFINITION OF DONE

- [x] Trail / jump / landing / gravity / speed / pad-orb juice, pooled.
- [x] Zero gameplay change (sim untouched; golden gates green).
- [x] Replay compatibility (nothing stored; recreated live, unit+in-page).
- [x] `?fx=off` independent fallback (all 4 post×fx combos playable).
- [x] Floor/Ceiling surface-relative (no ceiling hacks; zero camera edits).
- [x] 205/205 automated green; M6B 24/24 + M6A 24/24 browser green.
- [x] Performance BEFORE/AFTER recorded; bounded pools proven.
- [x] Evidence screenshots captured (review findings fixed, not hidden).
- [x] M6A NOT marked approved; M6C/M6D NOT started.
- [ ] HUMAN MOTION-JUICE GATE approval (OPEN).

## M6C1 — Visual Trigger Infrastructure (ENGINEERING COMPLETE /
ARTISTIC TIMELINE HUMAN GATE NOT YET PERFORMED)

Reusable, reversible, data-driven presentation timeline on the provisional
M6A+M6B foundation (neither re-approved nor re-canonicalized — all human
gates STILL OPEN). A restrained engineering PROOF (3–4 sections per level),
NOT the final artistic timeline. M6C2 / final trigger authoring NOT STARTED.

### M6C1 OBJECTIVE

Let a level change its PRESENTATION as the player moves through it —
background/fog evolution, route accents, environment intensity, restrained
bloom/exposure modulation, VFX multipliers — with zero gameplay effect,
position-driven (never wall-clock), level-agnostic, replay-compatible,
cheap, testable, and `?triggers=off`-reversible to the EXACT baseline.

### M6C1 DATA OWNERSHIP (Pattern B — presentation field on level data)

`VisualSectionOverride` / `VisualSection` / `VisualSequenceDefinition`
types live in `src/level/levelDefinition.ts` (same precedent as
`LevelTheme`: presentation data rides with the level file it belongs to);
`LevelDefinition.visualSequence?` is optional (absent = baseline
everywhere). `computeLevelFingerprint()` deliberately never reads it —
the established theme-exclusion pattern, pinned by test (add/mutate/
remove sequence → identical fingerprint). WHY NOT a renderer-side
registry: a second id-keyed lookup would duplicate level-presentation
ownership (AGENTS.md §7: one concept, one owner) and add fallback/sync
risk; the field keeps one source per level with zero engine special-case.
Section identity uses pure Z ranges (no gameplay object ids duplicated).

### M6C1 EVALUATION MODEL

`src/visuals/visualTimeline.ts` — the ONE renderer-side controller:
BASE THEME + CURRENT SECTION + TRANSITION INTERPOLATION = CURRENT VISUAL
STATE, written into a caller-owned scratch `VisualState` every frame.
Active section = last with `startZ <= playerZ` (forward-only motion +
respawn-to-start make this robust); blend `t = smoothstep((z-startZ)/
blendIn)`; sparse overrides inherit the previous section's resolved value
(sticky), else base. Pure function of (base, sequence, z): no
accumulation, no drift (forward/backward sampling pinned bit-identical).
THREE-free (hex RGB lerp) — the sim could never import it for gameplay.
`resetVisualState` restores the exact base through the SAME path
(triggers-off === base structurally, never an approximation). No player /
hazard fields exist in the model (semantic identities stable by structure).
All overrides clamped at resolve time: bloom through BLOOM_CONTRACT,
exposure 0.5..2, intensities 0..2, fog guards.

### M6C1 SYSTEM INTEGRATION (all in-place, zero new scene content)

- `MaterialLibrary.applyRouteState` / `resetRouteToTheme`: retints the
  EXISTING shared route materials (body, surface + self-emissive, edge +
  emissive). `routeUnder` deliberately untouched (M3.3 parity calibration).
- `PostPipeline.setBloomParams` / `resetBloomToTheme`: retunes the
  EXISTING bloom pass (re-clamped; staged when the composer is off so
  post on/off never loses intent). Composer never rebuilds (passes 3→3).
- `EnvironmentView.applyVisualState` / `resetToTheme`: background + fog
  envelope + dressing intensity (star opacity, pillar/window color scale —
  no transparency-flag or object churn).
- `VfxSystem.setIntensity(vfx, streak)`: scales emission counts, trail
  density/brightness, streak count/opacity. Pool capacities fixed;
  `?fx=off` still wins.
- `RendererHost` owns the prepared sequence + scratch state + enabled
  flag; evaluates from the SAME interpolated Z as the trail (pause-safe:
  same z re-resolves the same state); restores every system on the
off-edge. Exposure applied on the owned renderer (clamped).
- Toggles compose independently: `?triggers=off`, `?fx=off`, `?post=off`
  (all eight combos coherent; all-off = playable baseline). No settings UI.
- Probes: `visualSectionId/Progress/TriggersEnabled`,
  `setVisualTriggersEnabled`, `visualExposure/VfxIntensity/Background/
  FogColor/RouteAccent/PlayerColor/HazardColor` (+ existing `bloomParams`).

### M6C1 PROOF CONTENT (PROVISIONAL — explicitly not art direction)

Level 01: `runway` (identity) → `gravity-descent` (cooler/deeper,
calmer dressing/juice) → `interaction-run` (route-accent shift, lifted
environment/bloom/juice) → `speed-sprint` (bloom 0.55, exposure 1.2,
max juice). Level 02 (teal retained): `v2-weave` → `v2-ceiling`
(calmer) → `v2-speed` (restrained lift). No palette shocks, no strobes,
no camera/music/beat (all explicitly excluded).

### M6C1 RESET / REPLAY MODEL

Position-driven ⇒ resets are natural: R/death-respawn/replay-start all
return to start Z ⇒ opening section (browser-proven). NOTHING timeline
is stored in ReplayV1 (exported tape scanned: zero section/visual/bloom/
fog/exposure/trigger keys); F4 recreates sections from the replayed
trajectory (headless: full 2346-frame golden tape verifies WHILE the
timeline observes every tick and walks v2-weave→v2-ceiling→v2-speed;
in-page: natural-death tape → F4 → section `runway` → VERIFIED).
Fixture NEVER regenerated.

### M6C1 RESOURCE / PERFORMANCE

Section changes add NOTHING: draw calls +0, triangles +0, children
50→50, materials 26→26, geometries 8→8, composer passes 3→3
(browser-proven across every transition + death/restart/replay). Per-frame
cost is one evaluation (∼15 lerps into scratch, zero allocation) + a few
setHex/opacity writes. Build 588.04→595.94 kB (+7.90). No sim code
touched (no hot-loop impact by construction).

### M6C1 AUTOMATED QA

`tests/visualTimeline.test.ts` (21 new): Z-determinism + boundaries +
endpoints, exact-base restore, start-section resolution, drift-free
resampling, color determinism, bloom/exposure/intensity clamps,
player/hazard stability across a full proof sweep, fingerprint
decoupling, sim trigger-free boundary (incl. type-only visuals import in
level data + THREE-free controller), post pass constancy, VFX capacity
constancy, idempotent reset/prepare, golden-tape timeline integration.
Full gate: typecheck + lint + 226/226 + build. Untouched and green:
every M0–M6B suite (incl. `floorCompat`, `replayGolden`, `level02`).

### M6C1 BROWSER QA

M6A 24/24 + M6B 24/24 intact (no check weakened). M6C1 section (§23,
`m6c1-*`, 25 checks) — ALL GREEN, zero console/page errors: default-on +
opening sections both levels, gravity mid-blend bounded (bg/exposure
strictly between), settled gravity/fog shift, interaction accent +
lifted juice, speed bloom in-contract, route-accent with zero geometry
growth, player/hazard identity pins, R + death reset, natural-death F4 →
VERIFIED + tape-carries-zero-timeline-state proof, 26/8/3 resource pins,
`?triggers=off` exact-baseline (+ deep-level stay-baseline), Level 02
same-infra (teal/ceiling/speed), post-off/fx-off/all-off matrix, resize.
Historical-section note (unchanged): this machine's CDP-timing/load flake
set; M6C1 causation excluded (sim untouched, all determinism green,
25/25 across the final run).

### M6C1 SCREENSHOTS

`qa/screenshots/m6c1-*` (+ JSON sidecars): `01-level01-base` (runway),
`02-gravity-transition` (mid-blend frame, portal-pane wash context —
numbers are the proof), `03-ceiling-section`, `04-interaction-section`,
`05-speed-section` (inside the finish-gate wash at the sprint photo —
bloom 0.55 in-contract is the proof; wash documented, not hidden),
`06/07/08-level02-*`, `09-replay` (REPLAY badge + runway section),
`10-triggers-off` (exact-baseline pair of 01). Engineering evidence ONLY
— explicitly NOT human-approved art.

### M6C1 HUMAN GATE (NOT PERFORMED)

ARTISTIC TIMELINE HUMAN GATE NOT YET PERFORMED. When the human can
review: same URLs (`/`, `?level=validation-02`, `?triggers=off` /
`&triggers=off` comparison). Questions: does presentation evolution read
as progression (not distraction)? Do sections stay subordinate to
hazards/player? Is `?triggers=off` comparison favorable? Is anything
misleading as a gameplay cue?

### M6C1 KNOWN LIMITATIONS

- Proof values are provisional taste, not direction (M6C2 authors taste).
- Mid-blend/sprint photos can sit inside portal/finish-gate washes under
  headless framing (documented; probes are the proof).
- `routeUnder` (ceiling panel) intentionally not modulated (M6C2 may
  revisit with parity evidence).
- Real-GPU frame-time still unmeasured (M6D).
- M6A + M6B gates STILL OPEN — proof tuned against provisional ground.

### M6C1 DEFINITION OF DONE

- [x] Data-driven, renderer-owned, position-driven trigger infra.
- [x] Zero gameplay change (sim untouched; golden gates green).
- [x] Replay compatibility (nothing stored; recreated live, unit+in-page).
- [x] `?triggers=off` exact-baseline fallback (matrix proven).
- [x] Player/hazard identities structurally stable.
- [x] Floor/Ceiling + Level 01/02 shared path (zero camera edits).
- [x] 226/226 automated green; M6C1 25/25 + M6A/M6B 24/24 browser green.
- [x] Zero-cost transitions proven (50→50 children, 26/8/3 flat).
- [x] Evidence screenshots captured (wash contexts documented).
- [x] M6A/M6B NOT marked approved; final timeline NOT authored.
- [ ] ARTISTIC TIMELINE HUMAN GATE (NOT PERFORMED).

## M6C2 — Reactive Visual Authoring + Ground Contact FX (ENGINEERING COMPLETE / HUMAN REACTIVE-CONTACT GATE NOT PERFORMED)

User-driven presentation pass on the still-provisional M6A+M6B+M6C1 stack
(all prior human gates STILL OPEN, nothing re-canonicalized): important
events hit harder in the environment, and the cube drags visible contact
language along its support surface. Restrained by design — richer, not
louder. Final artistic timeline authoring still REMAINS (proof section
values untouched).

### M6C2 OBJECTIVE

Two concrete product problems (user feedback on the M6C1 build):
(A) pads, gravity flips, and speed/orb transitions fire only small local
particle bursts — no bloom/exposure/environment answer, so they never
"hit"; (B) grounded running has zero support-plane language — the rear
trail reads as motion, not contact, so the cube floats over the surface.

### M6C2 EVENT PUNCH (`src/visuals/eventPunch.ts` + RendererHost overlay)

THREE-free envelope controller (same discipline as `visualTimeline.ts`):
per-family energy 0..1 (pad peak 1.0/decay 3.2, jumpOrb 0.8/4.0, gravity
1.0/2.0 weightiest, speed 0.9/2.6), retrigger restarts (never stacks past
1), combined = max, dominant tint (gravity wins ties). RendererHost feeds
it from the SAME pre-existing sim edges the VFX reads (portal/speed/
interaction counters, same dedup rules — no sim change) and maps it onto
the existing in-place hooks ABOVE the section base look: bloom +0.15·e
(re-clamped to BLOOM_CONTRACT — a sprint-section punch peaks at exactly
0.7), exposure +0.1·e (clamped 0.5..2), bg/fog lerp toward the family tint
(0.22/0.18·e) + environment intensity +0.6·e (clamped 0..2). Absolute
writes every frame from the timeline-resolved base (no accumulation, no
drift; dt 0 while paused freezes the envelope); at rest the exact section
look is restored through the same applyVisualState path. Player / hazard /
route materials never touched. Trigger-owned: `?triggers=off` holds the
envelope at rest (exact-baseline contract preserved); `?fx=off` still kills
only the particle layer (documented split: flash is trigger-owned).

### M6C2 SURFACE-CONTACT FX (VfxSystem, zero new resources)

While grounded+running, the cube emits faint skid/splash sharing the
TRAIL point buffer (one draw call, flagged per-sample for QA): spawn on
the contact side (surface-normal-relative — Floor/Ceiling mirror
naturally), in-plane jitter, static in world so the cube carves past.
Pale-ice family (landing-dust relative, 0.65 brightness), shorter life
(0.8× trail), rate-scaled by speed tier, calmed by `vfxLevel`, silent
while airborne/dead/finished/`?fx=off`, cleared by the existing
attempt/death/teleport path. Companion amplification (same pools, still
bounded): pad 14→20, gravity 26→34, speed 18→24, orb 12→16 bursts +
gravity-flip/pad streak-energy kicks (0.7/0.35 — environment rays with no
new system). Worst-case single-frame event volume (124) stays well under
the 384 burst pool (pinned by test).

### M6C2 RESET / REPLAY MODEL

Nothing new stored in ReplayV1 (tape scanned: zero punch/contact keys);
F4 recreates punches + skid from replayed sim edges/trajectory (in-page
natural-death tape → VERIFIED under reactive visuals). R/death-respawn/
replay-start return to start Z with counters synced (no false fire on the
first frame — edges initialize from the live sim in the constructor).

### M6C2 RESOURCE / PERFORMANCE

Zero new draws/materials/geometries/pools: children 50→50, 26/8/3 flat,
composer passes 3→3 (browser-proven). Per-frame cost is the envelope
update (4 exp decays) + a few absolute writes. Build 595.94→596 kB
class (see § AUTOMATED QA). No sim code touched.

### M6C2 AUTOMATED QA

`tests/eventPunch.test.ts` (12 new) + `tests/helpers/vfxSimView.ts` (shared
fake-sim harness — motionVfx.test.ts left untouched): envelope peak/decay/
rest, gravity-longest vs orb-snappiest, max-composition + retrigger,
dominance + tier override + clear, dt-0 freeze; contact grounded-only,
Ceiling support-side, speed scaling + timeline calm, reset + fx-off paths,
pure running fires zero event counters (7-field shape pinned); emission
budget + 3-child group pins. Full gate: typecheck + lint + 238/238 +
build. Untouched and green: every M0–M6C1 suite (incl. `floorCompat`,
`replayGolden`, `level02`).

### M6C2 BROWSER QA

M6C2 section (§24, `m6c2-*`, 15 checks) — ALL GREEN, zero console/page
errors: probes live with envelope at rest; floor skid + trail; pad warm
punch (energy + yellow tint + bloom/exposure/live-env lift above the
sticky-inherited section values); exact rest-restore (bloom 0.5/exp 1.08/
live==section); portal-flip blue punch photographed past the portal pane;
ceiling support-side skid; 2x tier-green punch (reframed past the
finish-gate pane — envelope/speed are position-independent); jump-orb
warm punch (firing + tint + residual — the 0.25 s-tau peak is pinned
headlessly, not photographable under CDP latency); triggers-off silence
with events still simulating; fx-off particle/skid silence with gameplay
continuing; Level 02 shared skid; F4 VERIFIED + zero punch/contact tape
keys; 26/8/3 + 50-children pins. M6C1 section needed two honest
accommodations (intent unchanged): strict live-exposure pins now quiesce
the <2 s punch transient first (gravity-descent + R checks). Final run:
197/205 overall with M6A/M6B/M6C1/M6C2 fully green (0 fails in any M6
section); the 8 remaining fails are all pre-existing historical checks
with diagnosed frame-starvation mechanisms on this box (SwiftShader ~4
fps post-on): the auto-forward wall-rate pin catches exactly 2 rAF frames
(16 fixed steps = dz 1.87 to the decimal across runs — the SIM is exactly
per spec under starvation, the wall clock is not); the m2 spike chain
loses its 80 ms CDP hold between ~400 ms-spaced input samples; m3.1 eye
sampling, m4 ring timing, and the m5 82 s-verify/90 s-window all miss
under the same starvation (plus 2 knock-ons). M6C2 causation excluded by
measurement, not just reasoning: fps control (pre-M6C2 tree 4.2/12.8 vs
M6C2 tree 4.0/12.7 post-on/post-off — the 8→4 drop since M6A predates
M6C2), untouched sim/camera/determinism suites, and identical failure
signatures across 5 runs while M6 sections stayed green.

### M6C2 SCREENSHOTS

`qa/screenshots/m6c2-*` (+ JSON sidecars): `01-floor-contact`,
`02-pad-punch` (portal-down pane context in the distance — scene content,
liveBg measured dark, not red), `03-gravity-punch` (past-pane framing),
`04-ceiling-contact`, `05-speed-punch` (reframed, tier frame in view),
`06-orb-punch`, `07-level02-contact`, `08-replay` (VERIFIED badge).
Engineering evidence ONLY — explicitly NOT human-approved art.

### M6C2 HUMAN GATE (NOT PERFORMED)

HUMAN REACTIVE/CONTACT GATE NOT PERFORMED. When the human reviews (real
GPU, 60 fps — SwiftShader stills under-read additive points): do pads and
gravity changes feel impactful? Does the environment answer without
shouting? Does the cube feel planted on floor AND ceiling? Is anything
noisy, wash-prone, or strobe-like? Compare `?triggers=off` / `?fx=off`.

### M6C2 KNOWN LIMITATIONS

- Punch photos are pause-frozen peaks; live punches breathe for <2 s.
- Sticky section inheritance (M6C1) means pad-punch section values are
gravity-descent-inherited (exp 1.08), not runway base — asserted as such.
- Contact skid is deliberately subtle (probes are the proof); final
readability verdict needs the real-GPU human gate.
- `routeUnder` still unmodulated (unchanged from M6C1).
- Real-GPU frame-time still unmeasured (M6D).
- M6A + M6B + M6C1 gates STILL OPEN.

### M6C2 DEFINITION OF DONE

- [x] Event-reactive punch (bloom/exposure/environment, family-tinted).
- [x] Ground-contact skid on Floor + Ceiling (zero new resources).
- [x] Bounded companion amplification (bursts + streak kicks).
- [x] Zero gameplay change (sim untouched; golden gates green).
- [x] Replay compatibility (nothing stored; recreated live, in-page pass).
- [x] `?triggers=off` silence + `?fx=off` split (matrix proven).
- [x] Player/hazard identities structurally stable.
- [x] 238/238 automated green; M6C2 15/15 browser green.
- [x] Evidence screenshots captured (wash contexts documented).
- [x] M6A/M6B/M6C1 NOT marked approved; timeline NOT re-authored.
- [x] M6D/M7 NOT started.
- [ ] HUMAN REACTIVE/CONTACT GATE (NOT PERFORMED).

## M6D — Performance Closeout (PLANNED — do not implement yet)

Real-GPU measurement, hot-loop allocation review (§11 constraints),
draw-call/material/program audit, DPR/bloom quality scaling, final budget
sign-off. Closes M6.
