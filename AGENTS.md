# AGENTS.md — Mandatory Operating Contract for Coding Agents

> Read this file at the start of EVERY session. It is binding.

## 1. Session startup sequence (in order)

1. Read `AGENTS.md` (this file).
2. Read `GAME_DESIGN.md`.
3. Read the relevant sections of `ARCHITECTURE.md`.
4. Read the active milestone spec in `specs/milestones/`.
5. Inspect the current implementation (`git status`, read code — do not trust summaries).
6. Search for an existing owner before creating any subsystem (see §3).

## 2. Canonical authority (what overrules what)

| Question | Authority |
|---|---|
| How should the game behave / feel? | `GAME_DESIGN.md` |
| Where does logic live? What are the invariants? | `ARCHITECTURE.md` |
| What is in scope right now? What is done? | Active milestone spec + `ROADMAP.md` |
| Executable behavior contracts | Tests (`tests/`) |
| Onboarding only (NOT design authority) | `README.md` |

## 3. Search-before-create rule

Before adding a system, manager, service, controller, state representation,
utility, collider abstraction, material factory, input path, or level
representation: **search the codebase for an existing owner of that domain
concept.** If one exists, extend/refactor it — do not create a parallel
implementation. Duplication of a domain concept is a defect (see §7).

## 4. Spec-change rule

- You may freely improve the **implementation**.
- You may evolve the **architecture** when justified — and document it in
  `ARCHITECTURE.md` in the same commit.
- You MUST NOT silently change **product behavior** to make implementation
  easier. An implementation problem is never justification for weakening
  `GAME_DESIGN.md`. If the code suggests a design change, report it explicitly
  and wait for human direction.

## 5. No fake pass

A milestone is NOT complete because code compiles, a screenshot looks good, an
agent says "done", tests were skipped, a failing assertion was removed, or a
tolerance was arbitrarily weakened. A feature represented only visually (no
simulation, no test) does not exist. See the milestone spec's Definition of
Done — all of it, every time.

## 6. Code hygiene (non-negotiable)

- Strict TypeScript; no casual `any`; no unexplained `@ts-ignore`.
- No permanent debug logging in normal paths.
- No runtime dependency on the reference PNGs (`normal.png`, `cohete.png`,
  `arriba.png` are design references ONLY — never textures, sprites, or
  backgrounds).
- No level-specific hacks in engine code (`GameSimulation` must not contain
  Test Level coordinates; levels are data — see `src/level/levelDefinition.ts`).
- No gameplay logic in rendering objects; no gameplay state owned by Three.js.
- No general physics engine, no ECS, no React/R3F without demonstrated,
  documented need.
- Hot loop (per-fixed-step): avoid avoidable allocations; reuse scratch
  objects where reasonable. Do not micro-optimize cold code.

## 7. Avoid duplicated domain systems

One concept, one owner: player velocity lives in `PlayerState`; lane policy in
`CubeController`; collision queries in `CollisionWorld`/`moveAabb`; level data
in `LevelDefinition`; input semantics in `InputSystem`. Do not deduplicate
superficially-similar code that represents different concepts — but identical
domain concepts MUST share one implementation.

## 8. Git rules

- Inspect the working tree (`git status`, `git diff`) BEFORE editing.
- Preserve unknown user work. NEVER `git reset --hard`, `git clean -fd/x`,
  or any equivalent destructive operation.
- Commit to `main` only after `npm run verify` passes; `main` must stay playable.
- No force push.

## 9. QA rule

Before declaring gameplay work complete: `typecheck` + `lint` + `tests` +
`build` (i.e. `npm run verify`), plus real browser gameplay inspection when
available (console errors, screenshots). Automated tests prove mechanics, never
fun — controller feel requires a human gate (see `ROADMAP.md`).

## 10. Documentation rule

- Architecture fact changed → update `ARCHITECTURE.md`.
- Intended gameplay behavior changed → update `GAME_DESIGN.md`.
- Milestone state changed → update `ROADMAP.md` + the milestone spec.
- Docs must never describe systems that do not exist.
