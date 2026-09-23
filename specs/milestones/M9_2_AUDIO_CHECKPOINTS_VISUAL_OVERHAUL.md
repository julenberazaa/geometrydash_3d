# M9.2 — AUDIO ROOT-CAUSE FIX + CHECKPOINT PRACTICE MODE + VISUAL OVERHAUL

> M9.1 gameplay: HUMAN APPROVED. No route redesign in this milestone —
> gameplay geometry changes only for checkpoint placement/readability,
> visual integration, or genuine bug fixes.

Work branch: `feature/m9-2-audio-checkpoints-visual-overhaul` (no merge to
main, no force-push). Source HEAD: `5781f79` (verified). Untracked root
`Gravity_Lessons.mp3` preserved; app copy `public/audio/Gravity_Lessons.mp3`
(2,923,848 bytes).

## Phase A — real audible music (first; gates B and C)

### A1. Root cause (proven by audit, not inferred)

`MusicDirector.startAt()` created a buffer source AND a gain, connected
`gain → destination`, applied 0.9, and called `source.start()` — but NEVER
connected `source → gain`. `AudioSourceLike` exposed no connection method
at all, so the omission was structural: every transport probe (HTTP 200,
bytes, duration, context running, gain 0.9, playing, advancing time) stayed
green while nothing could reach the speakers. This matches the human
"silence with green transport" symptom exactly.

### A2. Graph contract (testable)

Every live music voice MUST satisfy:

```
BUFFER SOURCE → MASTER MUSIC GAIN → AUDIO CONTEXT DESTINATION
```

wired in exactly that order BEFORE `start()`. Implementation: the engine
surface grows `connectSourceToGain(source, gain)`; `WebAudioEngine` wires
the real nodes via private wrapper→node maps (no raw nodes leave the
engine; `MusicDirector` stays the single music owner; `Game` never sees a
node). Wiring failure aborts loud (`failed`, returns false) — never a
silent `playing` transport.

### A3. Structural test

`tests/musicDirector.test.ts` (FakeEngine event log) proves
`createSource → createGain → sourceConnect → gainConnect → start` in
order, asserts the wired identities (source/gain pair + gain→destination),
pins `graphReady`, and proves a wiring failure returns `false`/`failed`
instead of the old silent `playing`.

### A4. Probes

`MusicProbe` grows `sourceCreated / sourceConnected / gainConnected /
effectiveGain / graphReady`; `MusicDirector.graphReady()` means
source-connected AND gain-connected AND gain > 0 AND context running.
`__gd3d` exposes `musicSourceCreated / musicSourceConnected /
musicGainConnected / musicEffectiveGain / musicGraphReady`. These are
necessary-condition evidence — NOT audible proof. Only the human gate
proves speaker output.

### A5. Gates

- `npm run verify` green; browser audio gate green incl. the structural
  graph assertion (never again TRANSPORT PASS with no output path).
- Final report MUST ask: CAN YOU HEAR GRAVITY LESSONS? A NO keeps audio
  FAILED.

## Phase B — checkpoint / practice mode (after audio)

- Start-mode selector on THE DESCENT gate: CLASSIC RUN vs CHECKPOINT RUN.
  One click = mode select + audio gesture unlock + run start.
- CLASSIC: current behavior, `ReplayV1` untouched, reference route
  deterministic. CHECKPOINT: practice — latest activated crystal
  auto-respawns after the death hold; no checkpoint → origin.
- `CheckpointDef` level data (id/center/halfExtents + presentation);
  authored positions, ~6–9 across THE DESCENT at stable safe boundaries
  (post-maze, post-islands, ship/spider edges, pre-finale). Fingerprint
  handling must not change classic `ReplayV1` semantics.
- Deterministic `GameSimulation` snapshot owned by the sim
  (`captureCheckpointState` / `restoreCheckpointState`): tick/elapsed
  time, position (+prev), velocity, grounded, support id, lane intent,
  gravity, player mode, speed, used portals/pads/orbs/teleports,
  Chomper states, moving-platform tick (poses derive from it), counters
  as needed, level status. Restore is atomic; presentation only
  triggers/observes.
- Music seeks to `targetMusicTime(checkpointSimTime)` on restore (world +
  song stay aligned); visual timeline resolves to checkpoint state
  immediately; camera snaps to the restored position + occlusion resolve.
- HUD shows CHECKPOINT MODE + progress; R = restart-from-checkpoint
  (Shift+R or menu = full restart — documented); session-scoped only (no
  persistence); checkpoint runs are NOT official `ReplayV1` completions
  (F4 stays classic); finish shows PRACTICE COMPLETE.
- Tests: classic isolation, activation-once, latest-wins, origin/death
  fallbacks, full state restore, platform phase, Chomper spent/available,
  camera snap, music target, replay isolation, restart semantics.

## Phase C — visual world overhaul (after B; no gameplay destabilization)

- Reusable GPU-cheap surface language (panel seams, insets, trims,
  emissive channels, luminous tiles) in per-biome material families with
  a PRIMARY/SECONDARY/ACCENT/IMPACT/DARK-BASE palette contract — every
  biome instantly identifiable, never universal black-block + neon edge.
- Local environmental color (emissive + fog + ambient accents; no global
  exposure/bloom lift, no white washout, no dynamic-light army).
- Frame-filling composition: foreground route / midground architecture /
  background skyline / far fogged silhouettes; renderer-only motion
  (light bands, beams, rings, particles, embers, machinery) from
  pools/shared geometry, zero per-frame garbage.
- Stronger rhythm visuals (beat/downbeat/phrase/drop/climax), biome-tuned
  lightning + light shafts, richer portal presentation, biome-tinted
  checkpoint crystals with activation burst. Lava core look preserved.
- Player (cyan) > hazards > route > portals/checkpoints > background
  readability order holds everywhere.
- Screenshot BEFORE/AFTER per biome; perf accounting (materials,
  geometries, draws, tris, children, pools).

## QA / docs / discipline

- `npm run verify` green; audio browser gate, checkpoint browser gate,
  classic full-playthrough + replay VERIFIED green; `?music=off` ×
  {classic, checkpoint} matrix green.
- Doc updates: `ROADMAP.md`, `GAME_DESIGN.md` (§1 checkpoints/practice +
  §11 mode selector — human-approved design evolution), `ARCHITECTURE.md`
  (§8 audio graph, §6 checkpoints, §7 snapshot), `README.md`.
- Commits: spec → audio fix → selector → snapshot/restore → authoring +
  visuals → music/camera integration → material/biome pass → env/motion
  pass → rhythm VFX → QA + docs. Never one mega-commit.

## Definition of Done

Audio: real source→gain→destination graph, structural test, transport
green, human audible gate explicitly open. Checkpoints: selector, visible
crystals, latest-wins save, auto-respawn with full deterministic state +
music time + camera snap + platform/Chomper correctness, classic
untouched. Visual: richer surfaces, stronger palettes, denser world, less
black, stronger depth/particles/rays/lightning/rhythm response,
readability + lava preserved. QA: verify green, all browser gates green,
replay VERIFIED, perf documented.
