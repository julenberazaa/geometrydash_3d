# M9.4.2 — M8.6 THE DESCENT + GRAVITY RIFT Rename (corrective pass)

> Status: IN PROGRESS (branch `feature/m9-4-2-m86-descent-gravity-rift`,
> from M9.4.1 HEAD `a7a90d3`). Corrective pass over M9.4.1. NOT a gameplay
> redesign: the current engine (GameSimulation, collision, camera,
> renderer, checkpoint infrastructure, ReplayV1, session lifecycle) is
> preserved untouched. Two corrections: (1) the historical level content,
> (2) the modern level's user-facing name. No merge to main, no
> force-push.

## 0. The M9.4.1 mistake (acknowledged)

M9.4.1 materialized LEVEL 1 (`the-descent`, "THE DESCENT") from Git
revision `34db456de5c29b5f10710e6cfb623db7ee7edd3b` (the LAST M8.5 state).

That is the SIMPLE pre-M8.6 content (30 jumps / 12 lane edges / 0
fast-fall / 32 supports / Σ|ΔY| 206.6 / Σ|ΔX| 89.4). The human has now
identified the EXACT version they want: the M8.6 density-verticality
redesign — substantially more interesting, still preceding the later
M9/M9.1 transformation into the very difficult modern level. M9.4.1's
architecture (registry, menu, live switching, taint, disposal) was
correct; its content selection was wrong — for the second time (M9.4
froze M9.2; M9.4.1 restored M8.5). This pass ends the sequence.

## 1. Verified historical boundary

- Required source: `e5b0d868c37898da906e56f682019d1cb80f77c5`
  ("feat(M8.6): THE DESCENT density-verticality overhaul + drivers +
  contracts + browser gate"). Verified: `git show e5b0d86 --stat` touches
  `src/content/levels/productionShowcase01.ts` (1219 changed lines),
  `tests/helpers/showcaseScript.ts`, `tests/helpers/routeMetrics.ts`,
  `tests/showcase.test.ts`, `tests/showcaseDensity.test.ts`,
  `scripts/browser-qa-m86.mjs`.
- Forbidden substitutes: M8.5 (`34db456`), M9, M9.1/M9.2, the modern
  route. No approximation, no manual reconstruction, no
  delete-later-changes from the modern level.
- Method: byte-exact `git show e5b0d86:<path>` of the level file + the
  driver (script `extract_m86.py`, kept out of the repo at
  `$TEMP/opencode/m942/`; the verification is the committed diff, not
  the script). Deltas vs history, and ONLY these: export/id renames +
  provenance headers, driver identifier renames + header, `checkpoints`
  authored for the M8.6 geometry. `musicTrack` is ABSENT (as upstream).

## 2. Extraction (exact deltas vs the historical source)

`src/content/levels/theDescentClassic.ts` (`THE_DESCENT_CLASSIC`, id
`the-descent`, displayName `THE DESCENT`) is the byte-exact M8.6 file
with ONLY these deltas (proven by `git diff --no-index` of the new file
against `git show e5b0d86:...` — level: header + 2 renamed lines;
driver: header + 3 renamed identifiers):

1. Export name + level `id` + provenance header (the verbatim M8.6
   act-arc/conventions documentation is preserved below it).
2. `checkpoints` (M9.2 engine feature): 8 crystal gates authored for THIS
   M8.6 geometry from simulation evidence — grounded floor-cube states
   shared by BOTH reference variants (cp-forge z=60 stairs, cp-skybridge
   z=410 islands end, cp-maze z=520 deck, cp-spire z=880 post-spire,
   cp-foundry z=1040, cp-abyss z=1315 ship-exit runway, cp-temple z=1500
   post-spider, cp-remix z=1620). Wall/ship/spider segments carry no
   crystal (M9.4.1 precedent — the run re-arms on each return to cube).
3. NO `musicTrack` — hard requirement (§5).

Driver recovery is symmetric: `tests/helpers/theDescentClassicScript.ts`
is the byte-exact M8.6 `showcaseScript.ts` with ONLY `ShowcaseDriver` →
`TheDescentClassicDriver`, `driveShowcaseToFinish` →
`driveTheDescentClassicToFinish` plus a provenance header. No policy
logic touched. No M8.5 driver, no M9/M9.1 driver, no modern GRAVITY
RIFT driver may certify THE DESCENT.

## 3. Compatibility audit (M8.6 content × current engine)

| System | Verdict |
|---|---|
| `LevelDefinition` schema | All M8.6 fields still exist (`tsc` green, zero content edits). |
| Portals (gravity/speed/mode, all bounded) | M8.1 bounded-gate engine unchanged — compatible. |
| Chompers (5) / lava (`flow` hints) / teleports / pads / orbs | Unchanged engine paths — compatible (`validateLavaAuthoring` + `validatePortalBounds` green). |
| `movingPlatforms` (5) | M8.6 mechanism unchanged — compatible. |
| Spider first-snap (M9.3 fix) | Current (corrected) behavior used; the verbatim M8.6 driver still finishes tick-exact 14797 both variants with zero repair — no topology impact, no workaround needed. |
| Ship (M8.6 geometry) | Untouched: the later M9.3 funnel redesign stays in GRAVITY RIFT only. |
| Camera / renderer / ContactPulse | Current generic systems; no historical camera bugs restored; no M9.1/M9.2/M9.3 level-specific dressing imported. |
| Rhythm VFX | Trackless level: `rhythmPulse` degrades to no pulse (music-level-gated, bit-identical); no fake beats. |
| Fingerprinting / ReplayV1 | Conditional blocks only; new `checkpoints` are declared conditional; absent `musicTrack` is presentation-only. |

Adaptations are data-format integration ONLY (crystal authoring). No
route-design change was required by any compatibility bug.

## 4. Provenance evidence (measured, not asserted)

Recovered M8.6 driver on the current engine, both variants (verbatim,
zero repair):

- finishes `finished`, 1 attempt, **tick 14797** — the exact M8.6
  historical anchor (123.31 s, inside the 115–130 s band), tick-identical
  on the current engine;
- modes cube/ship/spider, gravities floor/ceiling/leftWall/rightWall;
- all 8 authored crystals activate on both variants with the 14797
  anchor preserved (detection never perturbs the trajectory);
- route metrics (primary / alternate): 97 / 93 skill jumps, 62 / 70
  lane edges, 144 / 35 fast-fall ticks, 79 / 76 distinct supports,
  Σ|ΔY| 557.5 / 505.0, Σ|ΔX| 197.8 / 209.5, 30 gravity transitions,
  6 mode transitions, 17 spider presses, 5 moving-platform supports
  ridden (primary; 4 alternate), max action gap 176 / 171 ticks —
  matching the M8.6 density contract floors;
- M8.5 negative proof: 30 jumps / 12 lanes / 0 fast-fall / 32 supports /
  Σ|ΔY| 206.6 / Σ|ΔX| 89.4 — every M8.6 floor sits far above.

Hard regression pins live in `tests/theDescentClassic.test.ts`
(provenance suite): id/displayName/registry, GRAVITY RIFT default,
card coverage, no shared mutable content, exact M8.6 portal/chomper/
teleport/speed/pad/orb census (16/6/6/5/2/3/3 gravity/speed/mode/pads/
jump-orbs/gravity-orbs/teleports, 5 chompers, 5 platforms, finishZ
1790), exact route metrics per variant, the 14797 anchor both variants,
8-crystal activation with anchor preserved, NO-MUSIC proof (no
`musicTrack`, `Game` builds a null `musicDirector`, starts without a
gate fetch), replay VERIFIED, cross-level replay rejection both ways,
and the M8.5 negative contract. Swapping in M8.5 (or any later
snapshot) trips these.

## 5. THE DESCENT — no music (hard requirement)

`THE_DESCENT_CLASSIC` declares NO `musicTrack` (the field is `undefined`
— not muted, not gain-0, not disabled-after-startup). Consequences,
all covered by existing `Game` architecture (null-music paths predate
this pass; this spec pins them per level):

- no audio asset fetch, no decode, no MusicDirector instance
  (`game.musicDirector === null`), no start-gate audio handoff;
- the START gesture starts the run immediately in the chosen mode;
- checkpoint restores re-seek nothing (`restartMusicForSimTime`
  null-guarded); pause/resume touches no transport;
- `musicStatusLine` reports the intentional `level declares no track`
  state — never an error; "no music" is content, not failure;
- F1/debug + `__gd3d` music probes degrade to `none`/`false`/`-1`
  without throwing.

GRAVITY RIFT keeps Gravity Lessons with the corrected source → gain →
destination graph and all M9.2 transport semantics (gesture, fail-loud,
sync, checkpoint seek, pause/resume, restart) untouched.

## 6. Level registry (stable ids, corrected content + rename)

- `the-descent` — THE DESCENT (REAL M8.6 original, ~123 s, tag
  `ORIGINAL M8.6`, subtitle "The classic high-mobility descent.",
  NO music).
- `production-showcase-01` — id KEPT (replay/fingerprint/URL/tests
  compatibility); user-facing `displayName` renamed `THE DESCENT —
  EVOLVED` → **`GRAVITY RIFT`** via the isolated
  `PRODUCTION_SHOWCASE_DISPLAY_NAME` const (fingerprint-excluded,
  so replays stay compatible — pinned). Tag `EXPERT`, subtitle
  "High-density 3D gravity gauntlet.", Gravity Lessons.
- `DEFAULT_LEVEL_ID` stays `production-showcase-01` (latest flagship
  default); `?level=` semantics unchanged; cards ORIGINAL M8.6 first,
  GRAVITY RIFT second, GRAVITY RIFT default-selected.

## 7. Main menu / pause / live switching (preserved)

Unchanged M9.4/M9.4.1 architecture: bare URL → SELECT LEVEL → SELECT
MODE → START; `?level=`/`?mode=` preselects; ESC/P/☰ MENU → pause
(RESUME / RUN MODE / RESTART LEVEL / MAIN MENU); MAIN MENU disposes to
zero residue and returns to the selector; live CLASSIC↔CHECKPOINT
switching with the practice-taint contract on both maps; R =
checkpoint, Shift+R = full restart. Only the card copy changes
(THE DESCENT / ORIGINAL M8.6 / "No music." vs GRAVITY RIFT / EXPERT /
"Gravity Lessons.").

## 8. Session-disposal + map×mode QA matrix

Headless (`tests/`): completion/replay for both maps × both variants,
8-crystal activation both M8.6 variants, retention matrix on the M8.6
route (earn cp-forge z=60 → checkpoint death restores it → disarm →
origin → re-arm → crystal again), toggle/taint/R semantics (existing
suites), no-music matrix (THE DESCENT classic/checkpoint start with
null director; GRAVITY RIFT classic/checkpoint keep the wired graph +
checkpoint seek).

Browser: `scripts/browser-qa-m942.mjs` (NEW) automates the human flow —
menu (THE DESCENT + GRAVITY RIFT cards, tags, GRAVITY RIFT preselected)
→ THE DESCENT CLASSIC (no music fetch, null graph) → ☰ pause/resume →
CHECKPOINT switch → MAIN MENU (0 canvas, HUD gone, no leaked audio) →
GRAVITY RIFT CHECKPOINT (wired graph, crystal restore re-seeks) →
MAIN MENU → repeat-switch disposal (0/1 session invariants, never two
music transports). `browser-qa-m94/m92/m941` migrated to the new
titles; `browser-qa-m86` boots the M8.6 `the-descent` route explicitly.

Legacy note: M8/M9/M9.1/camera scripts gate closed milestones against
re-authored content and stay superseded (documented limitation).

## 9. No-fake-pass / Definition of Done

- [ ] `the-descent` is byte-traceable to e5b0d86 (diff-verified, §2).
- [ ] M8.6 reference completes tick-exact 14797 both variants, 0 deaths, replay VERIFIED.
- [ ] Provenance suite green incl. M8.5 negative contract (M8.5 can never silently return).
- [ ] THE DESCENT declares no music; GRAVITY RIFT keeps Gravity Lessons; matrix green headless + in-page.
- [ ] Menu shows exactly THE DESCENT (ORIGINAL M8.6) + GRAVITY RIFT (EXPERT); default GRAVITY RIFT + CLASSIC.
- [ ] ESC + ☰ MENU open pause; MAIN MENU disposes to zero residue; fingerprints/replays isolated per level.
- [ ] `npm run verify` green; m942 + m94 + m92 browser gates green, zero console/page errors.
- [ ] Docs: this spec + `GAME_DESIGN.md` (§§1.1/5/7.9) + `ARCHITECTURE.md` + `ROADMAP.md` + `README.md`.
- [ ] Human gates: recognize THE DESCENT as the remembered M8.6 level (no music), GRAVITY RIFT as the harder modern evolution; menu/switch/audio flow with sound on.

## 10. Commit plan (no single giant commit)

1. spec + M8.6 provenance audit (this file).
2. replace old THE DESCENT content with exact e5b0 M8.6 content (+ checkpoints hunk rides along; validated by step 3).
3. M8.6 driver + provenance tests (incl. M8.5 negative + no-music + retention updates).
4. rename modern displayName to GRAVITY RIFT + card metadata.
5. menu/HUD/probe copy polish + music-optionality pins.
6. browser QA scripts (new m942 gate + migrations).
7. docs closeout (design/architecture/roadmap/readme).
