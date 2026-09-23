# M9.1 — RADICAL RHYTHM REBUILD (takeover)

> **M9 HUMAN GATE: FAILED.** Reasons: (1) no audible music in the browser
> playtest; (2) insufficient gameplay re-authoring — the level still feels
> like THE DESCENT + extra spikes; (3) too much straight running; (4) too
> many wide permissive paths; (5) insufficient lateral/vertical/action
> density; (6) visuals still too calm. This spec does not rewrite that
> history — it records the recovery plan.

## 0. Source state

- Branch: `feature/m9-gravity-lessons-rhythm-polish`, HEAD `6dd740c`.
- Work branch: `feature/m9-1-radical-rhythm-rebuild` (no merge to main,
  no M10, no force-push).
- Track: user-supplied `Gravity_Lessons.mp3` (untracked root copy — never
  delete/overwrite); app copy `public/audio/Gravity_Lessons.mp3`
  (2,923,848 bytes, 121.574 s, 120 BPM, beat 0 at 0.06 s, beat 230 at
  115.06 s).

## 1. Phase A — real audible music (release-blocking, first)

Reproduce the silent-audio case (`npm run dev`, press start, no music),
then fix the root causes:

- A1. Asset binding uses the relative `audio/Gravity_Lessons.mp3`; prefer
  the unambiguous root-absolute `/audio/Gravity_Lessons.mp3` (port-proof).
- A2. The start gate carries a ~2.5 s wall-clock backstop that starts
  gameplay silently when audio is not ready — automation can pass while
  the human plays silently. For a music-declaring level the new contract
  is: press gesture → create/resume AudioContext → fetch/decode/verify →
  start audio + sim together at tick 0. Audio failure must be LOUD and
  VISIBLE (`MUSIC LOAD FAILED — RETRY`, optional explicit
  `START WITHOUT MUSIC`). `?music=off` stays the explicit silent mode.
- A3. `ensure()` never retries a failed preload fetch (no recovery path).
- A4. One central music-volume constant; death SFX stays subordinate.
- A5. Probes to prove real state: HTTP 200 + byte size, decoded duration
  ≈ 121.57 s, context running, transport playing, muted=false,
  gain > 0, music time advancing, drift within policy.
- Distinguish `TRANSPORT QA PASS` from `HUMAN AUDIBLE AUDIO PASS` in
  every report; only the human can close audibility.

## 2. Phase B — radical route rebuild (same id/title, new route)

Same level `production-showcase-01` / `THE DESCENT`, radically
re-authored gameplay geometry. Preserve: M8.4 lava, camera multi-height +
occlusion + Spider glide, determinism, moving-platform architecture,
ReplayV1, bounded portals, Chomper behavior, Cube/Ship/Spider controls,
verified music-analysis data, biome identities, DESCENT identity. Rebuild
the route: most acts get a significantly different player path.

- Movement density: ≥ 2.0× combined meaningful action events vs the M9
  baseline measured with the same metric over ~115 s (jump takeoffs,
  fast-fall activations, reversals, lane-target changes, orbs, pads,
  gravity/mode transitions, teleports, platform transfers, Spider snaps,
  deliberate drops, support/deck transitions — no empty-tap inflation).
  Sub-targets: lateral reversals ≥ 1.7×, height-band transitions ≥ 1.7×,
  support changes ≥ 1.5×, fast-fall/drop events ≥ 2×.
- Passive gaps: ≤ 0.75 s outside documented recovery windows
  (1.0–1.25 s max, intentional); prefer 0.3–0.6 s decision spacing.
- Safe-route width (active gameplay, recovery/start/finish excluded):
  ≥ 70% one safe band, ≥ 90% ≤ two bands, ≤ 10% 3+ bands (recovery /
  transitions / reveals only). ONE path may still weave through a huge
  room — blockers/spikes/lava/holes/islands/teeth/walls/decks sculpt it.
- Every act rebuilt (7/9 major geometry replacement, documented
  BEFORE/AFTER): immediate-action Forge; precision island chains +
  visible traps; stacked decks / shafts / towers; deliberate falls;
  massive lateral patterns; large threaded structures; fast weave /
  vertical / gravity / micro / Ship mazes; rapid doors; spike-sculpted
  combos; rebuilt Ship (3D threading, ~0.5–1 s apertures); denser Spider
  multi-surface snaps; moving-island combos (never waiting); integrated
  Chompers.
- Difficulty: EXTREME/EXPERT, fair (telegraphed, no memorization traps,
  no frame-perfect inputs, no camera unfairness).
- Reference driver rewritten to the new route (design level first, then
  driver); ONE strong intended route (TWO only where it improves play;
  old branches that over-open the route are deleted/blocked).

## 3. Phase C — music re-sync + visual overdrive

- Re-sync the NEW route to Gravity Lessons (recalculate reference event
  times; adjust spacing/speed portals/portal Z/Chomper triggers/platform
  phases/pad-orb spots). Feel > checkbox: quarters/eighths/syncopation/
  phrase/anticipation/impact; strong anchors tight, flow preserved.
- Visual overdrive (keep DESCENT identity; art-direction principles from
  the reference audit in the takeover brief §59): fill the black void
  with large-scale environment (walls/ceilings/towers/bridges/columns/
  machinery/suspended structures/distant silhouettes/layered geometry);
  strong per-biome PRIMARY/SECONDARY/ACCENT/IMPACT palettes carried by
  fog/edges/beams/particles/shafts/backgrounds; enrich dark surfaces
  (panel seams/insets/ribs/recesses/luminous sections); local colored
  ambient light (no global exposure/bloom lift); no white clipping
  (saturated identity, hot cores only); enclosed↔open alternation
  (corridors/shafts/tunnels/temples/reactors/island fields);
  gameplay-integrated architecture (doors with teeth, ceiling-forced
  drops, tunnel ribs as Ship gaps); foreground/midground/background/far
  layering with fog hierarchy; biome-appropriate beams/shafts/arcs/
  lightning/sweeps/halos/waves; focal composition toward the next action;
  music-following energy (quiet→build→drop→climax) with fast LOCALIZED
  COLORED impulses (no full-screen white strobe; readability preserved).
- Perf discipline: pools/instancing/merged statics/shared materials,
  scalar emissive modulation, no dynamic-light army; track materials /
  geometries / children / draw calls / triangles / pool use.

## 4. QA gates (all must hold — no fake pass)

- `npm run verify` green; camera/lava/platform/audio-transport gates
  green; replay VERIFIED on the full run.
- Full in-page production playthrough with real input injection: audio
  transport active, start gate works, complete run, 0 deaths, finish,
  replay VERIFIED, camera stable, Ship/Spider/moving platforms exercised,
  music target progresses, zero console/page errors.
- Screenshot/visual evidence across rebuilt sections + reference-vs-
  current screenshot test (§59.12).
- Final report separates AUTOMATED TRANSPORT PASS from HUMAN AUDIBLE
  MUSIC PASS and asks explicitly: "Can you hear Gravity Lessons
  immediately after pressing Start?" If not, M9.1 remains FAILED.

## 5. Definition of Done

Audio: asset HTTP 200, decode ok, context running, transport playing,
gain nonzero, audio time advances, no silent auto-fallback. Gameplay:
2× movement vs M9 baseline; 70/90/10 route-width split; ≤ 0.75 s normal
passive gap; most acts radically re-authored; no multi-second cruising;
much more X/Y movement, drops, precision islands, fast mazes, rebuilt
Ship, denser Spider, platform combos. Visual: clearly stronger/faster
rhythm VFX, more color, more setpieces, readability kept, lava kept. QA:
verify green + full browser production playthrough green + replay
VERIFIED.

## 6. Baseline (measured on M9 HEAD `6dd740c`, same metrics)

`tests/zzBaselineTmp.test.ts` run (since removed; numbers pinned here):

- PRIMARY: ticks 13800 (115.0 s), actionEvents 835, cubeJumpEdges 92,
  laneEdges 68 (target changes 68), xReversals 48, bandTransitions 225,
  supportChanges 202 (81 distinct), ffEngagedTicks 104, maxActionGap
  176 ticks = 1.47 s, sumDy 530.0, sumDx 205.7, pads 5, orbs 5,
  gravityTransitions 32, modeTransitions 6, spiderPresses 17.
- ALTERNATE: ticks 13800, actionEvents 829, cubeJumpEdges 88, laneEdges
  76, xReversals 47, bandTransitions 197, supportChanges 198 (76
  distinct), ffEngagedTicks 19, maxActionGap 171 ticks = 1.43 s.
- Openness PRIMARY: coverage 610, one-band 44.8%, two-band 11.1%,
  3+ bands 44.1%. ALTERNATE: one 42.1%, two 12.3%, 3+ 45.6%.

M9.1 acceptance targets (primary reference route, same metric code):

- actionEvents ≥ 1670 (2.0× 835); xReversals ≥ 82 (1.7× 48);
  bandTransitions ≥ 383 (1.7× 225); supportChanges ≥ 303 (1.5× 202);
  ffEngagedTicks ≥ 208 (2.0× 104); maxActionGap ≤ 90 ticks (0.75 s).
- Route width: one-band ≥ 70%, one+two ≥ 90%, 3+ ≤ 10%.

## 7. Open items (tracked, not hidden)

- `tests/musicAlignment.test.ts` went RED mid-rebuild (maxAbsError 0.377 s
  vs the M9 0.36 bound — acts 1–5 run 4 ticks faster on cleaner lines plus
  the inherited ship-tunnel syncopation) and is GREEN again after the full
  music re-sync (max 352 ms; NO bound was weakened at any point).
- Documented micro-recoveries (all < 1.0 s, intentional): exit-gap breath
  (620→633, 111 ticks), ferry-boarding breath (644→657, ~111 ticks),
  chomp-telegraph breaths (lunge waits, dramatic pauses).
- In-page full-run instrument ( adverse headless delivery, NOT geometry):
  wall-clock live driving (8 ms polls → KeyboardEvents) cannot deliver
  sub-2 u edges on SwiftShader (100 ms+ frames, ~1.9 u observation skips;
  8 instrumented runs, ~138 polls over minutes, deaths all delivery-timed
  past edges). The gate therefore plays the unit-recorded tick-exact tape
  in-page (`debugStartReplayJson`, same coordinator as F4): 20/20 PASS
  (finish z1790, 0 deaths, REPLAY VERIFIED, music target 115.0 s) at cap 8
  AND `?stepcap=4` (cross-cap determinism). Live hands stay the human gate.
- `?stepcap=N` (1..8, default engine budget) is permanent QA infra
  (`GameOptions.maxCatchUpSteps`, `__gd3d.stepCap()` probe): same ticks,
  same order, slower wall rate — replays verify across cap values in-gate.
- HUMAN AUDIBLE MUSIC PASS still open (headless proves TRANSPORT only).
  HUMAN M9.1 gameplay gate still open (automation proves completable,
  never fun).
