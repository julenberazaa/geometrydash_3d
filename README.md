# GeometryDash3D (working title)

Original 3D precision auto-run arcade game in the browser: deterministic
fixed-step simulation (Three.js rendering observes, never owns). Inspired by
the design philosophy of precision runners; all art, levels, and code are
original. Reference PNGs in the repo root are mood references only.

> **Coding agents start here, then read `AGENTS.md` — it is binding.**

## Current maturity

M0/M1 foundation PASS: playable Cube controller test track with instant death
and fast restart. Fun/feel NOT yet human-approved (mechanics validated only).

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

M1 Foundation Cube — spec: `specs/milestones/M1_FOUNDATION_CUBE.md`.
Next: human controller-feel test, then M2 (see `ROADMAP.md`).
