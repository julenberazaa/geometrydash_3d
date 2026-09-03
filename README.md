# GeometryDash3D (working title)

Original 3D precision auto-run arcade game in the browser: deterministic
fixed-step simulation (Three.js rendering observes, never owns). Inspired by
the design philosophy of precision runners; all art, levels, and code are
original. Reference PNGs in the repo root are mood references only.

> **Coding agents start here, then read `AGENTS.md` — it is binding.**

## Current maturity

M2 collision/death/restart polish PASS: precise fair frontal/lateral
collision, cause-tagged instant death, 0.30 s deterministic respawn with
pooled burst feedback, 54 automated tests + 40 browser checks green.
Cube movement feel human-approved (frozen); death/restart feel awaits
human playtest.

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

| Input | Action |
|---|---|
| `Space` / `↑` (hold = repeat) | Jump |
| `←` / `→` | Lane target (one press = one lane, provisional) |
| `↓` (airborne) | Fast-fall |
| `R` | Instant restart |
| `P` | Pause |
| `F1` / `F2` / `F3` | Debug stats / collider wireframes / player hitbox |

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

M2 Collision & Death — spec: `specs/milestones/M2_COLLISION_DEATH.md` (PASS,
pending human death-feel playtest).
Next: M3 gravity architecture (see `ROADMAP.md`).
