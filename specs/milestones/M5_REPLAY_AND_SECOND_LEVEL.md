# M5 — Deterministic Replay + Reproducible Verification + Second Level

## STATUS

Engineering PASS (2026-09-04). Human playtest gate: OPEN (requested, not yet
performed — no human has played the replay build or Validation Level 02).

Automated: 162/162 tests green (`npm run verify`: typecheck + lint + tests +
build). Browser QA: M5 section 16/16 green; historical sections flap on the
same CDP-timing checks that flap on pristine pre-M5 HEAD in this environment
(see § AUTOMATED QA / BROWSER QA and the takeover note).

## OBJECTIVE

Two architectural goals, zero new gameplay mechanics:

1. **Deterministic replay.** A completed attempt must be reproducible from
   deterministic level data + deterministic initial state + the fixed-tick
   PHYSICAL input tape. Playback feeds the REAL `GameSimulation` and verifies
   every fixed tick against committed per-tick state hashes. Same initial
   state + same level + same inputs reproduce the authoritative trajectory —
   proven, not asserted.
2. **Second level architecture proof.** A genuinely separate
   `LevelDefinition` (`validation-02`) proving engine, renderer,
   interactions, replay layer and QA are not hardcoded to Test Level 01. This
   is a validation/verification level, NOT the final production level.

## ENTRY CONDITIONS

M1/M1.1/M1.2, M2/M2.1, M3/M3.1/M3.2/M3.3, M4 all PASS with human gates
approved as recorded in `ROADMAP.md`. Baseline before M5: HEAD `1d5108f`,
working tree clean, `npm run verify` green, 123/123 tests, browser QA
101/101 on the previous agent's machine (see takeover note on this
environment's flake set).

## IN SCOPE

- Physical-input tape recording above `GameSimulation` (one compact integer
  per fixed tick; no transforms, no camera, no timestamps).
- Versioned replay container (schema + ruleset versions, level binding,
  per-tick hashes, final hash, terminal outcome) with JSON serialization.
- Deterministic level + simulation-state fingerprints (binary float hashing,
  canonical ordering).
- `ReplayCoordinator`: recording/playback orchestration, per-tick
  verification, first-divergence reporting, compatibility rejection.
- Application integration: `Game` owns the coordinator, F4 replays the last
  completed attempt, HUD badge, F1 replay lines, `window.__gd3d` replay
  probes, `?level=` selection through a level registry.
- Level registry (`test-01`/`controller-test-01` default + `validation-02`).
- Validation Level 02: distinct data-driven level, real-input playthrough to
  a real finish, record → replay verification.
- Committed golden replay fixture + manual regeneration tool + negative
  (divergence) golden test.
- Full automated matrix (codec, lifecycle, determinism, divergence,
  compatibility, fingerprints, cadence) + browser QA M5 section + evidence
  screenshots.
- Docs: this spec, `GAME_DESIGN.md`, `ARCHITECTURE.md`, `ROADMAP.md`,
  `README.md`.

## OUT OF SCOPE

Multi-attempt sessions (one replay = one attempt), replay menus/timelines/
scrubbing, slow-motion replay, binary persistence format, ghost racers,
networked/shared replays, a third level, any new gameplay mechanic (M6+),
weakening any historical test or QA assertion to pass.

## TAKEOVER NOTE

M5 was implemented across two agent sessions. The first agent delivered the
replay core (`src/replay/*`), the level registry, Validation Level 02 data,
and two test helpers as UNCOMMITTED new files (~1129 lines), then handed
over. The second agent audited every inherited file before extending it:

- **Preserved as correct:** `hash.ts` (FNV-1a over IEEE-754 bytes, scratch
  reuse), `replayInputCodec.ts` (15-bit physical-edge bitfield),
  `levelFingerprint.ts` (gameplay-only content hash),
  `stateFingerprint.ts` (complete mutable-state hash — audited field by
  field against `GameSimulation` + `PlayerState`), `replayFormat.ts`
  (versioned V1 container + structural validation), `ReplayCoordinator.ts`
  (above-simulation orchestration, no sim branching), `levelRegistry.ts`
  (explicit-fallback resolution), `tests/helpers/replay.ts` (headless
  record/play protocol mirroring `Game`).
- **Corrected (defects in inherited work):**
  1. `ReplayCoordinator.startReplay`/`abortReplay` never cleared a stale
     partial live recording, so resuming live play after a playback
     finalized a HYBRID tape (pre-playback live frames + post-playback
     ticks) that silently overwrote `lastReplay`. Fixed by discarding the
     partial on both transitions; pinned by two fault-proven regression
     tests (the hybrid test FAILS with the fix reverted).
  2. `tests/helpers/level02Script.ts` never steered back to the center lane
     for the ceiling pad: the scripted run missed the pad and voided out at
     z≈116 (both inherited playthrough tests failed). Fixed the lane plan
     (return to center at z≈50); the run now finishes at tick 2346 with
     pad + orb + 2× + finish gate.
  3. Lint errors in inherited `replayFormat.ts` / `tests/helpers/replay.ts`
     (baseline lint was green; the WIP was not).
- **Built on top:** application integration (`Game`, `main.ts`, `Hud`,
  style, probes), the full automated matrix, the golden fixture + generator,
  the M5 browser QA section, this spec, and all doc updates.

## REPLAY ARCHITECTURE

```
LIVE:     InputSystem → ReplayCoordinator → GameSimulation.update(input)
PLAYBACK: ReplayV1 tape → ReplayCoordinator → GameSimulation.update(input)
```

`GameSimulation` is replay-agnostic: it cannot tell keyboard, test, or tape
input apart, and contains no replay branch. The coordinator owns mode
(`live` | `replay`), the in-progress recording, the active playback
playhead, the last completed tape, and the verification state. `Game` drives
the per-tick protocol (`beforeSimTick` → `getInputForTick(live)` →
`sim.update(fed)` → `afterSimTick`) and ALWAYS consumes `input.sample()`,
even during playback — live edges are sampled-and-dropped, which is the
input-isolation mechanism (no second input path exists).

## INPUT TAPE

One integer per fixed tick: bit `actionIndex*3 + edgeIndex` over actions
`[space, up, down, laneLeft, laneRight]` × edges `[held, pressedThisStep,
releasedThisStep]` (15 bits, frames ∈ [0, 32767]). Round-trip is exact for
all 5 × 8 combinations plus the fully-simultaneous snapshot
(`tests/replay.test.ts`). Press+release inside one sampling interval
survives because edges — not just `held` — are encoded.

## REPLAY FORMAT V1

`ReplayV1`: `schemaVersion` (1), `rulesetVersion` (1), `simulationHz` (120),
`levelId`, `levelFingerprint`, `frameCount`, `inputFrames`, `stateHashes`
(one per tick), `outcome` (`finished`+null cause | `dead`+cause),
`finalStateHash` (must equal the last per-tick hash). JSON serialization
round-trips exactly; malformed input is rejected with a reason, never
trusted. `REPLAY_RULESET_VERSION` is a deliberate constant: any intentional
deterministic-gameplay change that invalidates old tapes must bump it (never
auto-derived from git/build metadata). The tape contains NO render data
(pinned key list: no camera/transform/timestamp fields).

## SCHEMA VERSION / RULESET VERSION

`REPLAY_SCHEMA_VERSION = 1`, `REPLAY_RULESET_VERSION = 1`
(`src/replay/replayFormat.ts`). Wrong schema, wrong ruleset, wrong level id,
or wrong level fingerprint each reject BEFORE playback touches the sim
(tested individually).

## LEVEL FINGERPRINT

`computeLevelFingerprint` (FNV-1a, exact Float64 binary encodings, fixed
field order, arrays in definition order — order is gameplay-authoritative
via collider ids/tie-breaks): id, start, startLaneIndex, laneCenters, base
speed, start multiplier, finishZ, death bounds, start gravity, all portals /
pads / orbs (ids + geometry + parameters), solids, hazards. EXCLUDED:
`displayName`, `theme`, hazard `visual` hints (renderer-only — restyling
keeps old replays compatible). Tested: stable, gameplay mutation changes it
(incl. array reorder), visual-only mutation does not.

## STATE FINGERPRINT

`computeStateFingerprint`: the per-tick verification hash. Includes every
mutable state element that can affect future gameplay (audited against
`GameSimulation` + `PlayerState`): status, deathCause, player position +
velocity, grounded, targetLaneIndex, laneCount, supportColliderId,
authoritative gravityMode, speedMultiplier, elapsedSimTime,
deathHoldTicksLeft, and the used-interaction bits in level order
(pads, jumpOrbs, gravityOrbs). Excluded with documented reason: `attempts`
(session counter), `prevPosition` (overwritten before every use),
debug/VFX-only records (portal ids, counters, death records, contact
data), derived `progress`. Binary float encoding — no `.toFixed()` hashing.

## HASHING CONTRACT

FNV-1a dual-state digest (16 hex chars) over exact IEEE-754 Float64 bytes in
fixed big-endian order through a reused module scratch; strings are
length-prefixed UTF-16 code units. Verification hash, not cryptography. No
float formatting, no timestamps, no nondeterministic metadata anywhere in
the hashed content.

## RECORDING LIFECYCLE

One replay = one attempt. Recording arms at the first running tick of a live
attempt (fresh start or post-respawn): one input frame BEFORE each update,
one state hash AFTER. Finalizes on the first dead/finished tick (dead-hold
and respawn ticks are outside the tape). Manual R during a live unfinished
attempt discards the partial tape (`discardRecording` + `restart`). Playback
start/abort also discard any partial (`startReplay`/`abortReplay` clear it —
the hybrid-tape fix). `lastReplay` always holds the most recent COMPLETED
attempt; playback never writes it.

## PLAYBACK LIFECYCLE

`startReplay` validates structure → schema → ruleset → level id → level
fingerprint, then `restart()`s the sim to the deterministic initial state
and feeds exactly one recorded frame per fixed tick. After every update the
authoritative hash is compared to the expected per-tick hash.

## VERIFICATION / DIVERGENCE REPORT

First mismatch STOPS playback immediately and reports
`{ kind: 'diverged', tick, expectedHash, actualHash }` — never corrected,
never snapped, never continued. A fully hash-matching run additionally
checks the terminal outcome (belt-and-braces: status + cause are already
inside the fingerprint). Terminal states surface as `pass`, `diverged`, or
`rejected` through the HUD badge (`REPLAY` / `REPLAY VERIFIED` /
`REPLAY DIVERGED` / `REPLAY REJECTED`), the F1 overlay, and the
`replayVerification()` probe.

## SERIALIZATION

`serializeReplay` / `parseReplay` (JSON). The golden test additionally
re-validates the committed file through `validateReplayObject` on every run.

## GOLDEN FIXTURE

`tests/fixtures/replays/validation-level-02-v1.json` (2346 frames,
~83 KB): the scripted Level 02 playthrough with all per-tick hashes and the
finish outcome, plus a `_provenance` block (generation commit, frame count,
outcome). Tests LOAD it and replay it on a fresh sim — they never generate
expectations. Regeneration is manual and intentional ONLY:

```sh
npx vite-node scripts/generate-replay-fixture.ts
```

The generator self-checks (fresh-simulation replay must pass) before writing
and refuses to persist a non-finishing run. It is NOT wired into
`npm run verify` (deliberate: regeneration must be a human/agent decision,
paired with a ruleset-version bump or documented rationale when gameplay
changes intentionally).

## REGENERATION PROCEDURE

1. Change gameplay or the script deliberately.
2. Bump `REPLAY_RULESET_VERSION` if old tapes are invalidated.
3. Run the generator; confirm it self-checks green.
4. Update pinned literals (`frameCount` 2346, first-press tick 651) in
   `tests/replayGolden.test.ts` together with the fixture — never one
   without the other.
5. Re-run full `verify` + browser QA; document in `ROADMAP.md`.

## LEVEL REGISTRY

`src/content/levelRegistry.ts`: `registeredLevelIds()`, `getLevel(id)`,
`resolveLevel(requestedId)` — missing id → default (`controller-test-01`);
unknown id → EXPLICIT fallback with a logged reason + HUD-visible warning,
never silent substitution. `main.ts` selects via `?level=<id>`
(`?level=validation-02`). Adding a level = one data file + one registry
entry + zero engine changes.

## LEVEL 02 DESIGN

`VALIDATION_LEVEL_02` (`validation-02`, ~19.5 s, base speed 11 u/s, start
lane 0): spike weave across all three safe lanes → plain gap jump (5.5 u) →
gravity portal UP → ceiling run → CEILING jump pad (impulse 20) over a 7.5 u
ceiling gap (a plain 6.9 u ceiling jump cannot cross — the pad is required)
→ plain ceiling gap jump (5 u) → gravity ORB back to floor (press edge in
window) → 2× speed portal → 11 u gap at 2× (a 1× jump cannot cross) → final
spike row → finish gate at z=258. Deliberately different start lane, speed,
and mechanic cross-section from Test Level 01; no new mechanics; no engine
changes (it runs on the unmodified `GameSimulation`).

## LEVEL 02 PLAYTHROUGH

`tests/helpers/level02Script.ts` (`Level02Driver`): z-triggered one-shot
policy using REAL physical input semantics (lane taps, `holdJump` presses),
driven by the live player z — the same policy family the browser harness
runs in-page. No `debugTeleport`. Finishes at tick 2346 exercising: 3 lane
decisions, 2 plain jumps, portal-up, ceiling pad, ceiling gap jump, gravity
orb flip, 2× portal, high-speed gap, final weave. Assertions pin each
mechanic (portal flips 2, pads 1, orbs 1, speed 2×, last interaction
`v2-speed-2x`).

## PORTABILITY PROOF

Level 02 loads as an independent `GameSimulation` (own identity, lane 0,
11 u/s, 1 pad / 1 gravity orb / 1 gravity portal / 1 speed portal),
fingerprints differently from Test Level 01, finishes via real inputs, and
its live record replays to `pass` on a fresh sim. Registry resolves both
levels with unique ids; unknown ids fall back explicitly.

## AUTOMATED QA

- `tests/replay.test.ts` (29): codec round-trips (5×8 + simultaneous +
  bounds + malformed rejection), lifecycle (one frame per tick, finish
  finalizes, death finalizes with cause, R discards, playback discards
  stale partials —incl. the fault-proven hybrid-tape regressions),
  determinism (per-tick hashes, double replay, finish/death outcomes,
  gravity/interaction/speed reproduction), divergence (meaningful mutation
  → same-tick divergence; tampered hash → exact-tick failure; lied outcome
  → divergence; final-hash mismatch → structural reject), compatibility
  (schema/ruleset/level-id/fingerprint rejection, serialize round-trip,
  empty-tape reject), fingerprints (stable/gameplay-sensitive/
  visual-insensitive), cadence (chunk-1 vs chunk-7 identical trajectories;
  no render data in the container).
- `tests/replayGolden.test.ts` (2): committed fixture verifies on a fresh
  sim (pinned 2346 frames); single meaningful mutation (first jump press at
  tick 651 → zeroed) diverges at exactly tick 651 (pinned literal +
  tape-derived index).
- `tests/level02.test.ts` (8): registry contract, distinct content,
  deterministic finish with mechanics exercised, record → replay pass.
- Regressions: all 123 pre-M5 tests green unchanged (M1–M4, floorCompat
  golden, hazard CCD, camera parity, interactions).
- Total: 162/162.

## BROWSER QA

Historical baseline 101/101 (previous machine). M5 adds 16 checks (§20 of
`scripts/browser-qa.mjs`), all green: default level loads; live death
finalizes into an available versioned tape (441 frames, no transforms); F4
starts playback with REPLAY badge; injected keyboard input during playback
does not deflect the tape (tick-advance + final pass proof); death replay
reproduces death with matching frame count; REPLAY VERIFIED badge; F1 replay
lines; R resumes live play; `?level=validation-02` loads with HUD
confirmation; in-page real-input playthrough finishes (no teleport);
completion records a level-02 tape; level-02 replay verifies end-to-end;
level-01 tape on level 02 is explicitly rejected; unknown level falls back
to default. Zero console/page errors. Evidence: `qa/screenshots/m5-*`
(live, playback, verified, level02 start/mechanics/finish, replay debug).

Timing note (load-bearing for future QA): CDP round-trips here cost
~150 ms (~1.9 u at level speed), wider than the tightest physics-safe
takeoff windows — so the Level 02 playthrough is driven IN-PAGE via real
DOM KeyboardEvents through the real `InputSystem` (same listeners a
physical keyboard drives), with CDP observing. The death-replay checks
(which have no tight windows) stay fully CDP-driven, preserving true
end-to-end input coverage.

## PERFORMANCE

- Representative replay: 2346 frames → ~83 KB JSON (~35 bytes/frame; input
  tape itself ~2.3 KB as compact integers, hashes dominate).
- Recording: one small integer + one 16-char hash string per tick; hashing
  runs over a reused scratch (no per-tick buffer allocation).
- Playback cost = simulation cost + one fingerprint per tick (measured: the
  replay suite runs ~20 full 2346-tick record+replay cycles in well under a
  second headless — no render/render-loop impact; browser FPS unaffected).
- No compression (unnecessary at this scale).

## KNOWN LIMITATIONS

- One replay = one attempt; no multi-attempt sessions, no scrubbing/menu.
- F4 with no completed attempt is a no-op (no hint shown).
- The golden fixture pins exact tick literals (2346/651): intentional
  gameplay/script changes require the documented regen procedure.
- Browser QA historical sections flap on CDP-timing checks in loaded
  environments (proven identical on pristine pre-M5 HEAD; unrelated to M5).
- Human gates (replay UX feel, Level 02 fun) are OPEN by design at this
  stage.

## HUMAN GATE

Playtest requested (see final report): live record → F4 replay → input
isolation confidence → Level 02 → Level 02 replay. Do NOT approve without
playing.

## DEFINITION OF DONE

- [x] Inherited replay code audited; defects fixed (hybrid tape, script).
- [x] Physical fixed-tick input recorded; playback feeds real simulation.
- [x] `GameSimulation` replay-agnostic (no replay branch).
- [x] Live input cannot alter playback (sampled-and-dropped + proven).
- [x] Schema + ruleset versions explicit; level binding enforced.
- [x] Per-tick verification; first divergent tick reported; no correction.
- [x] Meaningful mutation → verified divergence (in-memory + golden).
- [x] Serialization round-trip exact; golden fixture committed + manual gen.
- [x] Test Level works; Level 02 separate, finishable, replay-verified.
- [x] Render-cadence independence tested.
- [x] 162/162 automated green; M5 browser QA 16/16 green; zero errors.
- [x] Docs updated; human playtest requested (gate OPEN).
