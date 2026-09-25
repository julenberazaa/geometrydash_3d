# M9.4 — Level Select + Live Practice-Mode Switching

> Status: IN PROGRESS (branch `feature/m9-4-level-select-live-practice-mode`).
> Takeover after M9.3 gameplay/presentation was human-approved in direction.
> This milestone is NOT a gameplay redesign: M9.3 mechanics, tuning, visuals,
> audio graph, camera, lava, replay and determinism are preserved untouched.

## 0. Goal

Turn the project from a single hard-coded showcase into a GAME STRUCTURE:

- TWO distinct selectable production levels behind a level-select screen.
- CLASSIC / CHECKPOINT mode selection before playing.
- Live checkpoint-mode ON/OFF switching WHILE playing (pause menu).
- Strict preservation of replay/determinism semantics (practice taint).

## 1. Historical-level preservation strategy

The M9.3 level is an EVOLUTION of THE DESCENT, not a second level. M9.4
materializes two independent `LevelDefinition` content objects:

- LEVEL 1 — **THE DESCENT**, id `the-descent`: the exact M9.2 content file
  recovered from Git revision
  `ff1d5843addbfae046ae472d33b3503f35f3232b` (the M9.2 docs-closeout commit;
  `productionShowcase01.ts` was byte-identical between M9.2 gameplay
  closeout and that commit — M9.3 is the only later content change).
  Materialized as `src/content/levels/theDescentClassic.ts`
  (`THE_DESCENT_CLASSIC`). The ONLY deltas vs the historical source are the
  export name, the level `id`, and the provenance header comment. No manual
  reconstruction, no reverse-editing of M9.3.
- LEVEL 2 — **THE DESCENT — EVOLVED**, id `production-showcase-01`: the
  current M9.3 content file unchanged (Spider first-snap tuning, Ship
  funnels + 3D route, island contact glow content, purple megastructure).
  The `id` is deliberately KEPT so existing replays/fingerprints/tests stay
  valid. The user-facing `displayName` becomes `THE DESCENT — EVOLVED`
  through one isolated top-of-file constant (trivial to rename later;
  `displayName` is fingerprint-excluded, so replays stay compatible).

INDEPENDENCE (critical): the two entries must not share mutable content.
The historical file is an explicit full copy — no import-and-mutate, no
shallow clone of nested arrays. A future edit to Level 2 must not silently
modify Level 1 (pinned by an independence test). Shared PRESENTATION
machinery (theme, materials, renderer, checkpoint/portal views, music
asset) is fine — content arrays are not shared.

Checkpoints/music per level: BOTH levels author the same 8 checkpoint gems
(same ids/geometry — M9.3 did not move checkpoints or music) and declare
the same `musicTrack` (`/audio/Gravity_Lessons.mp3`, offset 0) independently
in their own definitions. Music belongs to the selected level, never global.

## 2. Level ids + registry

- `the-descent` — THE DESCENT (M9.2 frozen).
- `production-showcase-01` — THE DESCENT — EVOLVED (M9.3 latest, default).
- `DEFAULT_LEVEL_ID` stays `production-showcase-01` (latest selected by
  default in the menu; `?level=` omission in direct entry also keeps it).
- `src/content/levelRegistry.ts` remains the authority (id → def,
  `resolveLevel` explicit-fallback semantics unchanged).
- NEW `src/content/levelMetadata.ts`: declarative card metadata the selector
  derives from (no hardcoded if-button1/2 in UI code):
  `LevelCardMeta { levelId, tag, subtitle, difficulty, durationLabel,
  accentCss, blurb }`. Gameplay data stays in `LevelDefinition`.
- Card identity: THE DESCENT = original production route (~115 s, Hard,
  forge-teal accent); EVOLVED = 3D megastructure route (~115 s, Expert,
  purple accent). Difficulty labels are UI metadata only — never mechanics.

## 3. Menu lifecycle + architecture

New application-level coordinator (no second Game/sim/engine):

- `src/app/AppController.ts` — owns MENU ↔ SESSION lifecycle:
  MENU (LevelSelectView: choose level/mode) → create `Game` →
  RETURN (dispose `Game`, show menu). `Game` stays focused on one active
  run: one `Game` instance owns exactly one selected `LevelDefinition`.
- `src/ui/LevelSelectView.ts` — polished DOM start screen (dark
  high-energy, neon cards, selected-state highlight, mode buttons with
  crystal motif for CHECKPOINT, START button). Two cards are enough — no
  menu framework. No WebGL preview (CSS/DOM only).
- `main.ts` becomes thin: parse URL params → `AppController`.
- Level changes NEVER hot-swap a `LevelDefinition` inside an active
  `GameSimulation`: return-to-menu disposes the session and the next START
  creates a fresh `Game` (sim + replay + music + camera + VFX + HUD all new).

Start/audio gesture contract: the START click knows (level, mode), unlocks
the AudioContext, ensures/decodes that level's music, wires
source→gain→destination, constructs the `Game` for that `LevelDefinition`,
and begins at tick 0. Gameplay inputs from the gesture never leak into the
run (existing edge-flush preserved).

URL contract (documented, developer ergonomics preserved):

- Bare `/` → level-select menu (no auto-start; the START gesture also
  unlocks audio).
- `?level=<id>` → direct entry into that level (legacy behavior: tick-0
  gate + press-to-start overlay). Unknown ids keep the explicit fallback.
- `?mode=classic|checkpoint` → preselects the mode for BOTH paths (menu
  card preselect / direct-gate pending mode). Bare clicks/keys keep legacy
  semantics (Space/click = classic, C/2 = checkpoint).
- `?music=off`, `?fx=off`, `?post=off`, `?triggers=off`, `?perf=1`,
  `?stepcap=N` unchanged.

## 4. Mode semantics (classic vs checkpoint — unchanged core)

- CLASSIC: crystals hidden/inactive, death → origin, R → origin,
  ReplayV1 recording allowed, clean completion savable/replayable, F4 per
  existing semantics. The official run mode.
- CHECKPOINT (practice): crystals visible, activation on crossing, death →
  latest crystal (origin if none), R → latest checkpoint, Shift+R → full
  origin restart, music seeks to checkpoint sim time, camera snaps via the
  existing dead→running edge, deterministic snapshot restore, completions
  show PRACTICE COMPLETE and are never official.

## 5. Live mode switching (NEW) + practice taint (NEW)

Pause (P) opens a compact overlay: PAUSED / RUN MODE [CLASSIC|CHECKPOINT] /
RESUME / RESTART LEVEL / LEVEL SELECT. Mode buttons are labelled UI, not a
hidden keyboard toggle. Switching needs no page reload and works mid-attempt:

- CLASSIC → CHECKPOINT: crystals appear + detection arms immediately. No
  checkpoint granted — the next physically-reached crystal saves. Position,
  music, camera untouched. The attempt becomes PRACTICE (see taint).
- CHECKPOINT → CLASSIC: crystals hide + auto-respawn disarms. Position,
  music, gameplay continue. The attempt REMAINS practice-tainted.
- Checkpoint RETENTION rule (explicit): the latest earned snapshot is
  retained internally while Classic is active but NOT usable there. Turning
  Checkpoint back ON makes the already-earned checkpoint usable again
  (toggling presentation never erases earned practice progress). Death
  while Classic → origin. Death while Checkpoint → latest earned crystal.
  FULL restart clears checkpoint progress (existing `restartRun`).
- PRACTICE-TAINT contract: explicit attempt state
  `attemptKind: 'classic' | 'practice'` (owned by `Game` via the pure,
  headless-tested `RunModeController`). An attempt that EVER armed
  checkpoint mode is `practice` until a FULL level restart from origin.
  Classic→Checkpoint→…→Classic→finish (no death) = PRACTICE COMPLETE, no
  ReplayV1 final tape, F4 stays disabled. A full restart in the currently
  selected mode opens a fresh attempt (`classic` mode → clean classic;
  `checkpoint` mode → practice).
- R semantics (current mode wins): CLASSIC: R = origin restart.
  CHECKPOINT: R = latest-checkpoint restart. Shift+R (both modes): FULL
  origin restart in the CURRENT mode + taint cleared (fresh attempt).
  Example: checkpoint earned → switch Classic → R restarts at the ORIGIN
  (no hidden checkpoint use).
- HUD: CLASSIC (clean) shows no badge; CHECKPOINT shows `CHECKPOINT i/N`;
  tainted-while-Classic shows `CLASSIC CONTROLS — PRACTICE RUN` so a
  practice run can never be mistaken for an official one.
- Pause freezes sim + music + camera + VFX (existing); mode choice happens
  frozen; RESUME continues at identical `elapsedSimTime`. The toggle itself
  never seeks music (only death/checkpoint restore seeks) and never moves
  the camera (only respawn/teleport snap does).

## 6. Replay rules

- Clean CLASSIC attempts only: ReplayV1 finalization + F4 + LEVEL COMPLETE.
- Any practice-tainted attempt (checkpoint armed now or ever) finalizes
  nothing, shows PRACTICE COMPLETE, F4 refused with a practice message.
- Per-level binding unchanged and authoritative: level id + gameplay
  fingerprint gate `startReplay`. A `the-descent` tape is rejected on
  `production-showcase-01` and vice versa (pinned by test).
- Switching mode discards the in-progress partial tape (a hybrid
  classic+practice tape must never finalize).

## 7. Audio/session/disposal lifecycle

- `MusicDirector` receives the SELECTED level's track (no global
  THE_DESCENT assumption). Level 1 → Level 1 transport; Level 2 → Level 2
  transport; returning to menu stops/cuts music immediately (short fade
  where the engine supports it); no AudioBufferSource survives across
  sessions.
- Leaving a level disposes everything: music stop/disconnect, renderer +
  scene dispose, HUD/debug nodes, animation loop, event listeners
  (resize/keydown/input/click — no duplicates), checkpoint presentation,
  replay state. No second RendererHost behind the menu; hidden menu DOM
  costs no GPU work while playing.
- Changing level resets: simulation, replay coordinator, music transport,
  checkpoint progress, camera, visual timeline, session counters.

## 8. No-fake-pass / Definition of Done

- Two independent selectable levels (historical + evolved), no shared
  mutable content, per-level ids/fingerprints/checkpoints/music.
- Start menu: level + mode select, polished, audio-unlock correct, no
  auto-start, no input leak.
- Live switch: crystals appear/disappear, earned checkpoint retained,
  Classic death = origin, Checkpoint death = latest crystal, music in sync,
  camera unaffected, taint enforced, R/Shift+R per §5, HUD honest.
- Replay: clean-classic only, per-level isolation, no masquerading.
- Session: return-to-menu disposes cleanly, no duplicate loops/listeners/
  songs; level switch = fresh session.
- QA: 4× level×mode matrix + full toggle matrix (both levels) + M9.3
  regression gates (spider first-snap, ship bypass, contact pulse, purple
  content, audio graph, checkpoints, camera, lava, replay, music) +
  `npm run verify` green + browser gate (§9) with zero console/page errors.

## 9. QA plan

- Unit (headless): 4× starts (level × mode: geometry id, music ref,
  crystal visibility flag, death/finish semantics); toggle matrix per
  level (C→P, P→C, C→P→C, P→C→P: visibility, latest checkpoint, respawn
  target, taint, replay eligibility); retention (P→C→P death restores the
  earned crystal; P→C death → origin); taint (C→P→C finish = practice, no
  tape; full restart → clean classic → finish = official + F4); R/Shift+R
  under toggles; fingerprint isolation + cross-level replay rejection;
  registry independence (no shared mutable arrays); historical checkpoints
  validate against historical geometry; M9.2-era driver completes
  `the-descent` (anchor tick 13799); current driver completes
  `production-showcase-01` (anchor tick 13799, existing).
- Browser (`scripts/browser-qa-m94.mjs`): the §48 flow — menu render →
  select THE DESCENT → classic start → return → checkpoint start →
  crystal activates → switch Classic → death → origin → checkpoint ON →
  death → crystal → return → EVOLVED classic → fingerprint/id →
  pause → switch Checkpoint → taint → checkpoint restore → return.
  Zero console/page errors, no duplicated audio/input.
- M9.3 regressions: full unit suite + adapted m92 gate (menu flow) +
  spider/ship/pulse browser probes green.

## 10. Documentation closeout

Update `README.md`, `GAME_DESIGN.md` (§§1.1/5: two selectable levels, live
toggle, taint), `ARCHITECTURE.md` (AppController, RunModeController,
attemptKind, session disposal), `ROADMAP.md` (M9.4 entry).
Permanent rules: level selection lives ABOVE `GameSimulation`; one `Game`
owns one `LevelDefinition`; checkpoint mode toggles mid-play; taint lasts
until full restart; level changes create fresh sessions.
