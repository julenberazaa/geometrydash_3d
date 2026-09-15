# GeometryDash3D (working title)

Original 3D precision auto-run arcade game in the browser: deterministic
fixed-step simulation (Three.js rendering observes, never owns). Inspired by
the design philosophy of precision runners; all art, levels, and code are
original. Reference PNGs in the repo root are mood references only.

> **Coding agents start here, then read `AGENTS.md` — it is binding.**

## Current maturity

M3 gravity architecture PASS: true Floor ↔ Ceiling gravity with behaviorally
unchanged Floor gameplay (exact-float golden gate), deterministic gravity
portals, ceiling support/jump/fast-fall, upper/lower void bounds, and a
playable gravity section in the Test Level. M3.1 polish PASS: the ceiling
camera now frames the cube from below inside the open corridor (proven never
to enter level geometry) and the ceiling underside reads as a real contact
surface. M3.2 view-parity polish PASS: a measured audit rejected the camera
and cube-material hypotheses and proved the ceiling's readability gap came
from missing surface cue structure (all neon rails were top-face-only, while
the below-focus camera makes the cube's own silhouette occlude the ceiling
surface a few units ahead); ceiling run surfaces now carry the same
converging neon rail language as the floor. M3.3 camera-contract PASS: the
ceiling framing is now the exact mirror of the floor framing, so the cube
face opposite the support surface projects with identical size/perspective
on both surfaces (measured free-face area ratio 0.219 → 1.000; the invariant
is expressed surface-relatively so future gravity surfaces inherit it). M4
interactive mechanics (on `main`): data-driven jump
pads (passive contact impulse), jump orbs (press-edge activation windows,
airborne), gravity orbs (Floor ↔ Ceiling flip through the shared portal
transition) and speed portals (0.5–4× multiplier tiers) with one
authoritative speed state, explicit trigger ordering (lethal checks always
win the step), original procedural visuals + pooled activation VFX, and a
playable Test Level interaction section. M2 polish (fair frontal/lateral
collision, cause-tagged instant death, 0.30 s deterministic respawn with
pooled burst feedback) and M2.1 exact swept-path hazard CCD remain in place.
Cube movement feel human-approved (frozen); death/restart feel human-approved
(M2 playtest); **ceiling camera/ceiling feel and M4 interaction feel
human-approved (2026-09-04 playtest on the final integrated M3.3 + M4
build)**. M5 deterministic replay + Validation Level 02 PASS
(every attempt records a verifiable fixed-tick input tape, F4 replays with
live per-tick verification, the second level finishes via real inputs on
the unmodified engine); human replay/Level-02 feel gate APPROVED
(2026-09-07). M0–M5 complete. M8 multimode expansion engineering-complete
on `feature/m8-multimode-gameplay` (lava, four-way gravity, Ship/Spider,
Chompers, maze/traps, `?level=multimode-gauntlet-01` — human gameplay gate
OPEN, not merged), plus the M8.1 polish follow-up on
`feature/m8-1-polish-portals-lava-death` (bounded portal gates, lava
rivers, wall-lane debt fix, ship tunnel, mode-aware death breakup, lava
Chomper, compact rings — engineering complete, human gate OPEN; spec:
`specs/milestones/M8_1_MULTIMODE_POLISH_AND_PORTAL_BOUNDS.md`), plus the
M8.2 corrective follow-up on `feature/m8-2-lava-portal-spider-chomper-polish`
(true opening-sized portal bounds + validator, viscous-flow lava read +
vent-protrusion rule, lava-chomper redesign, spider-swap camera glide —
engineering complete, human gate OPEN; spec:
`specs/milestones/M8_2_LAVA_PORTAL_SPIDER_CHOMPER_POLISH.md`), plus the
M8.3 corrective follow-up on `feature/m8-3-lava-motion-chomper-style-spider-camera`
(living lava motion + tone-map-safe glow, reference-match voxel lava
Chomper, Spider-swap pose-continuity fix — engineering complete, human
gate OPEN; spec:
`specs/milestones/M8_3_LAVA_MOTION_CHOMPER_STYLE_SPIDER_CAMERA.md`). M6A visual production foundation
engineering-complete (production theme + shared materials + controlled
bloom/post, zero gameplay change, 182/182 tests, M6A browser QA 24/24
green, golden replay intact) — HUMAN VISUAL GATE OPEN
(`specs/milestones/M6_VISUAL_PRODUCTION_SYSTEM.md`). M6B motion juice
engineering-complete on the provisional foundation (pooled trail/bursts/
streaks, exact-once real-event emission, `?fx=off` fallback, 205/205
tests, M6B 24/24 + M6A 24/24 browser green, replay recreates juice) —
HUMAN MOTION/JUICE GATE OPEN, M6A gate STILL OPEN. M6C1 visual trigger
infrastructure engineering-complete (position-driven sections +
interpolation, in-place application, zero new draws, `?triggers=off`
exact baseline, 226/226 tests, M6C1 25/25 browser green, replay
timeline-free) — ARTISTIC TIMELINE HUMAN GATE NOT PERFORMED, M6A/M6B
gates STILL OPEN. M6C2 reactive visual authoring + ground contact FX
engineering-complete (event punch envelopes with family-tinted
bloom/exposure/environment flash above the section look + continuous
support-plane skid on Floor/Ceiling + bounded burst/streak amplification,
zero gameplay change, 238/238 tests, M6C2 15/15 browser green, replay
punch/contact-free) — HUMAN REACTIVE/CONTACT GATE NOT PERFORMED, all
prior gates STILL OPEN, final artistic timeline still remaining. M7 Cube
vertical slice engineering-complete, then HUMAN FUN GATE: REWORK REQUIRED
(human rejected the M7 level direction — too simple/wide, visuals too
conservative — plus a confirmed ceiling-spike bug). M7.1
precision/difficulty/spectacle rework engineering-complete on the frozen
controller (narrow islands + airborne transfers, six visual scenes, fixed
ceiling spikes, 20 beat-ready cues, no audio yet): deterministic real-input
finish tick 6190 (51.583 s) + verified replay, 285/285 tests, M7.1 browser
QA 45/45 green — M7.1 HUMAN FUN RE-TEST: APPROVED (2026-09-10;
`vertical-slice-01` preserved as the Cube reference level). M7.2 advanced
Cube expansion engineering-complete (`?level=advanced-cube-01`: harder
62.125 s Cube level with LOW/MID/HIGH bands, one teleport portal pair,
guardian setpiece, eight visual scenes, verified replay, 349/349 tests) —
HUMAN ADVANCED-CUBE GATE OPEN. M6D
real-GPU closeout intentionally pending (M7.1 is its workload).

## Setup

Requires Node 22+ (developed on Node 24).

```sh
npm install
npm run dev      # Vite dev server → http://localhost:5173/
```

## Quality gates

```sh
npm run verify       # typecheck + lint + tests + build (required before commits)
npm run verify:full  # verify + headless browser QA (needs dev server + Playwright browsers)
npm run qa:browser   # browser QA alone (needs dev server on :5173, see QA_URL env)
```

Levels and replays:

```sh
# Play the second (validation) level:
http://localhost:5173/?level=validation-02
# Unknown ?level= ids fall back to the default with a logged reason.

# Regenerate the committed golden replay ONLY intentionally
# (gameplay/script change + ruleset rationale — see specs/milestones/M5_REPLAY_AND_SECOND_LEVEL.md):
npx vite-node scripts/generate-replay-fixture.ts
```

Individual: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Controls

| Input | Floor | Ceiling |
|---|---|---|
| `Space` (hold = repeat) | Jump | Jump |
| `↑` | Jump | Fast-fall (airborne) |
| `↓` | Fast-fall (airborne) | Jump |
| `←` / `→` | Lane target (one press = one lane, provisional) | Same — never mirrored |
| `R` | Instant restart | Instant restart (back to start gravity + speed) |
| `P` | Pause | Pause |
| `F1` / `F2` / `F3` | Debug stats / collider wireframes / player hitbox | Same |
| `F4` | Replay the last completed attempt (input ignored during playback) | Same |

Interactions (M4): yellow pads launch on contact (no input); yellow orbs
grant a mid-air jump on a Space/arrow press inside their window; blue orbs
flip gravity on a press; green speed portals change the run speed on
crossing. One activation each per attempt; restart re-arms everything.

## Folders

- `src/core/` — fixed-step loop, sim constants, THREE-free math
- `src/input/` — edge-semantics input snapshots
- `src/player/` — Cube controller, tuning, gameplay frame, state
- `src/collision/` — colliders, swept movement, spatial-hash world
- `src/level/` + `src/content/levels/` — declarative levels + runtime loader
- `src/game/` — headless `GameSimulation` + `Game` composition root
- `src/camera/` `src/rendering/` `src/debug/` `src/ui/` `src/visuals/` — presentation
- `tests/` — executable invariants · `scripts/` — browser QA · `specs/` — milestones

## Current milestone

M3 Gravity Architecture (Floor ↔ Ceiling) + M3.1 ceiling camera/readability
+ M3.2 ceiling view-parity polish + M3.3 surface-relative camera projection
parity — specs:
`specs/milestones/M3_GRAVITY.md`,
`specs/milestones/M3_1_CEILING_CAMERA_READABILITY.md`,
`specs/milestones/M3_2_CEILING_VIEW_PARITY.md`,
`specs/milestones/M3_3_CAMERA_SURFACE_SYMMETRY.md` (all PASS; human
ceiling/ceiling-camera feel gate APPROVED 2026-09-04). M4 Interactive
Mechanics (jump pads, jump orbs, gravity orbs, speed portals) PASS and
merged to `main` — `specs/milestones/M4_INTERACTIVE_MECHANICS.md` (human
interaction-feel gate APPROVED 2026-09-04; M4 fully closed). M5
Deterministic Replay + Second Level — PASS —
`specs/milestones/M5_REPLAY_AND_SECOND_LEVEL.md`: every completed attempt
records its fixed-tick physical input tape and replays it through the real
simulation with per-tick verification (F4 replays the last attempt; HUD
badge + F1 replay lines + `__gd3d` probes; committed golden fixture with a
manual regeneration tool). Validation Level 02 (`?level=validation-02`)
proves the unmodified engine is level-agnostic (real-input finish +
verified replay). Human replay/Level-02 feel gate APPROVED (2026-09-07).
M0–M5 complete. M6A visual production foundation engineering-complete —
HUMAN VISUAL GATE OPEN — plus M6B motion juice engineering-complete
(HUMAN MOTION/JUICE GATE OPEN, M6A still provisional) plus M6C1 visual
trigger infrastructure engineering-complete (ARTISTIC TIMELINE GATE NOT
PERFORMED, all prior gates still provisional) plus M6C2 reactive visual
authoring + ground contact FX engineering-complete (HUMAN
REACTIVE/CONTACT GATE NOT PERFORMED, final artistic timeline still
remaining; see
`specs/milestones/M6_VISUAL_PRODUCTION_SYSTEM.md`). M7 Cube vertical
slice engineering-complete, then HUMAN FUN GATE: REWORK REQUIRED — M7.1
precision/difficulty/spectacle rework engineering-complete
(`?level=vertical-slice-01`, narrow islands + airborne transfers, six visual
scenes, fixed ceiling spikes, 20 beat-ready cues, deterministic real-input
finish tick 6190 / 51.583 s + verified replay, 285/285 tests, M7.1 browser
QA 45/45 green) — M7.1 HUMAN FUN RE-TEST: APPROVED (2026-09-10) — plus truthful M6 status: human played the
M6 presentation ("quite good") and chose to proceed to M7 (presentation
direction approved to proceed; M6D real-GPU closeout intentionally pending
with M7 as its workload). Spec: `specs/milestones/M7_CUBE_VERTICAL_SLICE.md`.
