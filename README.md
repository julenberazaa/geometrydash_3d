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
interactive mechanics (branch `parallel/m4-interactions`): data-driven jump
pads (passive contact impulse), jump orbs (press-edge activation windows,
airborne), gravity orbs (Floor ↔ Ceiling flip through the shared portal
transition) and speed portals (0.5–4× multiplier tiers) with one
authoritative speed state, explicit trigger ordering (lethal checks always
win the step), original procedural visuals + pooled activation VFX, and a
playable Test Level interaction section. M2 polish (fair frontal/lateral
collision, cause-tagged instant death, 0.30 s deterministic respawn with
pooled burst feedback) and M2.1 exact swept-path hazard CCD remain in place.
Cube movement feel human-approved (frozen); death/restart feel human-approved
(M2 playtest); **ceiling feel and M4 interaction feel awaiting human
playtest**.

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
+ M3.2 ceiling view-parity polish — specs:
`specs/milestones/M3_GRAVITY.md`,
`specs/milestones/M3_1_CEILING_CAMERA_READABILITY.md`,
`specs/milestones/M3_2_CEILING_VIEW_PARITY.md` (all PASS
mechanically/browser-validated; human ceiling-feel gate OPEN). M4
Interactive Mechanics implemented on `parallel/m4-interactions` —
`specs/milestones/M4_INTERACTIVE_MECHANICS.md` (pending M3.3 parallel
integration + human feel gate). Next: integrate M3.3, human playtest
(ceiling + M4 interactions), then M5 (see `ROADMAP.md`).
