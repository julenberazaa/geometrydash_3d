# M9.4.1 — Original THE DESCENT + Main-Menu Return (corrective pass)

> Status: IN PROGRESS (branch `feature/m9-4-1-original-descent-menu-fix`).
> Corrective pass over M9.4. NOT a gameplay redesign: M9.3/M9.4 mechanics,
> tuning, visuals, audio graph, camera, lava, replay and determinism are
> preserved untouched. Two corrections: (1) the historical level content,
> (2) explicit MAIN MENU return from any active run.

## 0. The M9.4 mistake (acknowledged)

M9.4 materialized LEVEL 1 (`the-descent`, "THE DESCENT") from Git revision
`ff1d5843addbfae046ae472d33b3503f35f3232b` (the M9.2 docs-closeout commit).

That is post-M8.6 content: M9.2 sits AFTER the extreme-density /
super-difficult transformation, so the two selector cards were two
snapshots of the same super-difficult version — not the easier original
the human asked for. M9.4's architecture (registry, menu, live switching,
taint, disposal) was correct; its content selection was wrong.

## 1. Verified historical boundary

- Correct source: `34db456de5c29b5f10710e6cfb623db7ee7edd3b`
  ("test(M8.5): harden in-page reference run + pin legacy QA to test
  level") — the LAST M8.5 state before M8.6 begins. Verified: the commits
  immediately after it start M8.6 development (`1e53728` spec,
  `c390266` mechanism, …).
- The transformation: `e5b0d868c37898da906e56f682019d1cb80f77c5`
  ("feat(M8.6): THE DESCENT density-verticality overhaul + drivers +
  contracts + browser gate").
- Method: `git show 34db456:src/content/levels/productionShowcase01.ts`
  (byte-exact) + `git show 34db456:tests/helpers/showcaseScript.ts`.
  No manual reconstruction, no coordinate guessing, no "simplification".

## 2. Extraction (exact deltas vs the historical source)

`src/content/levels/theDescentClassic.ts` (`THE_DESCENT_CLASSIC`, id
`the-descent`, displayName `THE DESCENT`) is the byte-exact M8.5 file
with ONLY these deltas (proven by diffing the new file against
`git show 34db456:...` — the diff contains nothing else):

1. Export name + level `id` + provenance header (incl. the verbatim M8.5
   act-arc/conventions documentation and the M9.4-correction note).
2. `musicTrack` (M9 engine binding): Gravity Lessons as BACKGROUND music.
   The M8.5 route predates M9 rhythm authoring — it is NOT beat-mapped
   and geometry was deliberately NOT distorted for sync (unlike EVOLVED).
3. `checkpoints` (M9.2 engine feature): 8 crystal gates authored for THIS
   M8.5 geometry at section boundaries — FORGE z=15, ISLANDS z=219
   (x-centered to catch both ACT 2 variants), LABYRINTH z=390, CATHEDRAL
   z=535 (pre-wall-gate), CANYON z=800 (post lane-recenter), REACTOR
   z=925 (pre-ship), TEMPLE z=1140 (ship-exit runway), CORE z=1610
   (pre-wall-burst). Every center is a grounded cube state on BOTH
   reference variants; wall/ship/spider segments carry no crystal. Ids
   mirror the evolved crystal vocabulary (`cp-forge` … `cp-core`).

Mechanically produced by `extract_m85.py` (kept out of the repo at
`$TEMP/opencode/m841/`; the verification is the committed diff, not the
script). Driver recovery is symmetric: `tests/helpers/
theDescentClassicScript.ts` is the byte-exact M8.5 `showcaseScript.ts`
with ONLY identifier renames (`ShowcaseDriver` →
`TheDescentClassicDriver`, `driveShowcaseToFinish` →
`driveTheDescentClassicToFinish` — required: the evolved route keeps its
own `ShowcaseDriver`) plus a provenance header. No policy logic touched.

## 3. Compatibility audit (M8.5 content × current engine)

| System | Verdict |
|---|---|
| `LevelDefinition` schema | All M8.5 fields still exist (`tsc` green with zero content edits). |
| Portals (gravity/speed/mode, all bounded) | M8.1 bounded-gate engine unchanged — compatible. |
| Chompers (4, M8D shape) | Unchanged engine path — compatible. |
| Lava (roles + `flow` hint) | M8A/M8.4 engine unchanged — compatible (`validateLavaAuthoring` green). |
| Teleports / pads / orbs | Unchanged engine paths — compatible (`validatePortalBounds` green). |
| `movingPlatforms` absent | Conditional engine blocks (zero bytes when absent, pinned) — compatible. |
| Fingerprinting | Conditional blocks only; new `checkpoints`/`musicTrack` are declared conditional/presentation-only — classic trajectory + golden fixtures untouched. |
| Renderer assumptions | Same def shapes `LevelView`/`CheckpointView` build from; historical `visualSequence`/`rhythmCues`/`visualSetpieces` ride along as presentation-only (current generic improvements apply, no modern level-specific architecture injected). |
| Camera assumptions | Generic chase/occlusion/deck logic — content-agnostic. |
| Music | NEW binding (background, not beat-mapped — documented in-file). |
| Checkpoints | NEW authoring (§2) — current engine feature applied to historical geometry; Classic mode leaves historical gameplay untouched. |

Adaptations are data-format integration ONLY (music binding + crystal
authoring). No route-design change was required by any compatibility bug.

## 4. Provenance evidence (measured, not asserted)

Recovered M8.5 driver on the current engine, both variants:

- finishes `finished`, 1 attempt, **tick 13955** — the exact M8.5
  historical anchor (M8.5 spec: 13955 ticks / 116.29 s), tick-identical on
  the current engine with zero driver repair;
- modes cube/ship/spider, gravities floor/ceiling/leftWall/rightWall;
- all 8 authored crystals activate on both variants with the 13955 anchor
  preserved (detection never perturbs the trajectory);
- route metrics (primary): 67 action events / 30 jump edges / 12 lane
  edges / 0 fast-fall ticks / 32 distinct supports / 78 support changes /
  Σ|ΔY| 206.6 / Σ|ΔX| 89.4 — matching the M8.6 flatness audit
  (60 / ~30 / ~12 / 0 / 32 / 206.6 / 89.4);
- evolved contrast (same harness): 917 action events, 88 supports,
  Σ|ΔY| 577.0, 178 hazards vs 32, 242 solids vs 100, finishZ 1790 vs
  1750. The cards are REALLY different levels.

Hard regression pins live in `tests/theDescentClassic.test.ts`
(provenance suite): finishZ 1750, zero moving platforms, exact M8.5
portal/chomper/teleport/speed/pad/orb id censuses, exact solid/hazard
counts (100/32), exact route metrics per variant, the 13955 anchor on
both variants, 8-crystal activation with anchor preserved, replay
VERIFIED, cross-level replay rejection both ways, and a 5×-density
evolved-contrast floor. Swapping in any later super-difficult snapshot
trips these.

## 5. Level registry (unchanged ids, corrected content)

- `the-descent` — THE DESCENT (REAL M8.5 original, ~116 s, Hard).
- `production-showcase-01` — THE DESCENT — EVOLVED (M9.3 latest, default).
- `DEFAULT_LEVEL_ID` stays `production-showcase-01`; `?level=the-descent`
  now resolves to the real original; `?level=production-showcase-01`
  unchanged; `?mode=` preselect unchanged.
- Cards (`levelMetadata.ts`): ORIGINAL first, EVOLVED second; default
  selection stays EVOLVED. Blurbs: "The original production route before
  the extreme-density rebuild." / "The modern high-density 3D version."

## 6. Main menu from gameplay (explicit user requirement)

- `ESC` toggles pause exactly like `P` (`Game.onKeyDown`; works in
  menu-managed sessions after start).
- Pause menu button renamed `LEVEL SELECT` → **`MAIN MENU`** (with an
  explanatory title) — RESUME / RUN MODE / RESTART LEVEL / MAIN MENU.
- New always-visible `☰ MENU` corner button (`Hud`, `hud-menu-button`
  CSS: 11 px, top-right, pointer-events re-enabled on the transparent
  HUD root, never blocking gameplay): opens the pause menu (same as
  ESC/P), ignored pre-start and while paused.
- MAIN MENU path (unchanged architecture, now labeled): `Game` →
  `onExitToMenu` → `AppController.returnToMenu` disposes the session and
  re-shows the SAME startup selector; the next START builds a fresh
  `Game` (sim + replay + music + camera + VFX + HUD all new). No reload,
  no hot-swap inside an active `GameSimulation`.
- Disposal hardened: `Game.dispose()` now REMOVES HUD + debug-overlay DOM
  (`Hud.dispose()` / `DebugOverlay.dispose()`), not just hides them —
  menu returns leave zero session residue (browser-pinned: 0 canvases,
  `.hud === null`, `.m94-pause-menu === null`).

Live mode switching (M9.4) is preserved on both maps, with the same
practice-taint contract (`RunModeController` untouched): CLASSIC ↔
CHECKPOINT mid-attempt, retention, R vs Shift+R, tainted-Classics show
`CLASSIC CONTROLS — PRACTICE RUN`, clean-classic-only ReplayV1.

## 7. Session-disposal + map×mode QA matrix

Headless (`tests/`): 4× completion/replay coverage (original primary +
alternate, evolved primary + alternate via existing suites), original
8-crystal activation both variants, original-geometry retention matrix
(earn cp-forge on the REAL route → checkpoint death restores it →
disarm → origin → re-arm → crystal again —
`tests/livePracticeMode.test.ts`), toggle/taint/R semantics (existing
`livePracticeMode` + `runModeController` + `checkpoints` suites).

Browser: `scripts/browser-qa-m94.mjs` migrated to the original
coordinates (cp-forge z=15, MAIN MENU labels, HUD-removal assertions);
`scripts/browser-qa-m941.mjs` (NEW) automates the exact §29 human flow —
menu → ORIGINAL/CLASSIC → historical fingerprint → ☰ pause/resume →
ESC CHECKPOINT switch → MAIN MENU (0 canvas, HUD gone) → EVOLVED/
CHECKPOINT (different fingerprint) → cp-forge restore → CLASSIC →
origin → MAIN MENU → ORIGINAL again (identical fingerprint, single
canvas/HUD/pause-menu, wired graph). Zero console/page errors.

Legacy migration (§30): monolith `browser-qa.mjs` bare-URL boots now
enter explicit levels (M6 flag-only boots → `&level=controller-test-01`,
restoring their original test-level intent; M5a asserts the menu +
explicit default entry; 24g M8.5 gate runs at `?level=the-descent` —
its in-page driver IS the M8.5 policy); `browser-qa-m86.mjs` boots the
evolved route explicitly + corrects its stale display-name assertion.
M8/M9/M9.1/camera scripts gate closed milestones against re-authored
content and are superseded (documented limitation, not migrated).

## 8. No-fake-pass / Definition of Done

- [ ] `the-descent` is byte-traceable to 34db456 (diff-verified, §2).
- [ ] Original completes tick-exact 13955 both variants, 0 deaths, replay VERIFIED.
- [ ] Provenance suite green (cannot re-freeze M9.2 silently).
- [ ] ORIGINAL+CLASSIC / ORIGINAL+CHECKPOINT / EVOLVED+CLASSIC / EVOLVED+CHECKPOINT matrix green headless + in-page.
- [ ] ESC + ☰ MENU open pause; MAIN MENU disposes to zero residue; level/mode switch = fresh session; fingerprints stable per level.
- [ ] `npm run verify` green; m94 + m941 + m92 browser gates green, zero console/page errors.
- [ ] Docs: this spec + `GAME_DESIGN.md` (§§1.1/5) + `ARCHITECTURE.md` + `ROADMAP.md` + `README.md`.
- [ ] Human gates: play ORIGINAL (easier, different) vs EVOLVED, and the ESC → MAIN MENU → switch → START flow, with sound on.
