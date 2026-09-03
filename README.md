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
surface. 90 automated tests + 72 browser checks green. M2 polish (fair
frontal/lateral collision, cause-tagged instant death, 0.30 s deterministic
respawn with pooled burst feedback) and M2.1 exact swept-path hazard CCD
remain in place. Cube movement feel human-approved (frozen); death/restart
feel human-approved (M2 playtest); **ceiling feel awaiting human re-playtest
on the M3.1 build**.

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
| `R` | Instant restart | Instant restart (back to start gravity) |
| `P` | Pause | Pause |
| `F1` / `F2` / `F3` | Debug stats / collider wireframes / player hitbox | Same |

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
polish — specs: `specs/milestones/M3_GRAVITY.md`,
`specs/milestones/M3_1_CEILING_CAMERA_READABILITY.md` (both PASS
mechanically/browser-validated; human ceiling-feel gate OPEN). Next: human
re-playtest of the ceiling on the M3.1 build, then M4 (see `ROADMAP.md`).
