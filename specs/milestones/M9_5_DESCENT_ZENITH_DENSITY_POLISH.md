# M9.5 — THE DESCENT Zenith Density Polish (surgical, NOT a rebuild)

> Status: IN PROGRESS (branch `feature/m9-5-descent-zenith-density-polish`,
> from M9.4.2 HEAD `b4c7b90`). Human verdict: THE DESCENT (M8.6) is GOOD —
> "the path is sometimes boring and too straight". This is a SURGICAL
> DENSITY POLISH (4 zones, 6 local edits, +3 Chompers) + the new
> `Zenith_of_the_Path.mp3` soundtrack with MODERATE music adaptation.
> GRAVITY RIFT is untouched. No merge to main, no force-push.

## 0. Source state (verified)

- Branch from `feature/m9-4-2-m86-descent-gravity-rift` @ `b4c7b90`
  (matches the expected remote HEAD).
- New branch: `feature/m9-5-descent-zenith-density-polish`.
- Preserve: two-level menu, THE DESCENT identity, GRAVITY RIFT (route,
  hazards, music, timing, checkpoints, visuals, difficulty), Classic /
  Checkpoint modes, live mode switching, pause/Main Menu flow, replay
  isolation, camera, Spider/Ship mechanics, moving platforms, checkpoint
  snapshots, session disposal, Gravity Lessons music, all M9.4.2
  architecture.

## 1. Human feedback interpretation

"The level is good, but the path is sometimes boring and too straight."
+ "a few more monsters/spikes" + "adapt it a little to the new song".

- NOT an extreme density overhaul, NOT GRAVITY RIFT 2.
- "Too straight" = the same X lane stays viable too long; jumps are
  straight-ahead hops; no threat forces horizontal repositioning —
  even where jump counts look fine.
- "Adapt a little" = MODERATE sync: major moments near strong musical
  moments; no global retime; gameplay readability wins over beat purity.

## 2. Straight-route audit (measured, both reference variants)

Method: headless both-variant driver runs binned per 40 u of Z
(`scripts/tmp-m95-audit.ts`, temporary): jumps, lane edges, X reversals,
X range, supports, hazards, Chomper triggers, mode/gravity per window.
Lane convention: index 0 = x +2.6 (screen-left), 1 = x 0, 2 = x −2.6.

Weakest stretches (both variants agree, cube mode):

| Rank | Z range | Act | Duration | Lanes (prim/alt) | Why passive |
|---|---|---|---|---|---|
| A1 | 214–264 | ACT 2 LOW road | ~3.6 s | 0 / 1 | full-width road, one spike (230), straight hops; MID deck above blocks jumps (2 u corridor) so lane moves are the only lever |
| A2 | 280–312 | ACT 2 MID deck | ~2.3 s | 0 / 0 | open deck run after the pad flight, first lane input at 285/286 |
| B1 | 588–622 | ACT 3 upper deck | ~2.4 s | 0 / — | straight center gap-hops (597/609 over center spikes) |
| B2 | 591–612 | ACT 3 lower deck | ~1.5 s | — / 0 | straight lane-2 rhythm (583/594/604.5) |
| D | 1086–1112 | ACT 5 foundry exit | ~1.9 s | 0 / 0 | four straight center hops (1087.5/1097.5 over 1090/1100) then ship |
| F | 871–890 | ACT 4 spire exit | ~1.4 s | 0 / 0 | straight center hops (872/882) then shaft fall |

Longest same-lane intervals: 160–280 LOW line (~8.6 s, 0 primary lane
edges across 120 u), 520–640 maze decks (~8.6 s, ~1 lane edge total).
Ship (1110–1330) is EXCLUDED: thrust/Y-flight is continuous control,
identity preserved. Spider (1330–1510) is EXCLUDED except no changes:
no significant hardening. Teleport zone (1510–1600) is EXCLUDED:
choice choreography + lift timing too fragile for blind surgery (its
fast windows are teleport-skips, not runouts). 320–360 is EXCLUDED:
orb gap + height transfers already decide (4 jumps/window + landing
precision). Opening 0–40 is EXCLUDED (entry).

## 3. Selected intervention zones (6 edits, 4 zones)

All edits use existing systems (spikes, killFront doors, deterministic
Chompers). No new mechanics. No portal/speed/checkpoint moves: the
14797-tick / 123.31 s anchor is expected to hold; if any edit shifts it,
the shift is reported and re-anchored deliberately.

- **Edit 1 — Zone A MID deck: +Chomper A** (`ps-chomp-deck`): dormant
  (8, 5.25, 292), triggerZ 283, dir −1, dist 16, telegraph 48,
  lunge 60, anchor (10, 7, 292) + anchor pillar solid. Role: break the
  longest HIGH-line grounded run with a timed jump (~288, driver);
  telegraph builds into the drop-A entry (~20.03 s). Alternate (LOW,
  4.7 u below) unaffected.
- **Edit 2 — Zone A LOW road: +2 singles** (244/index 0, 254/index 1,
  y 0.25, standard spike box): under-deck lane-only weave (jumps
  head-bump there, so lane moves are the ONLY option — fully forcing).
  Role: lateral obligation for the LOW line (R then L); primary (MID
  above) unaffected. Driver: taps ~238 (R), ~250 (L); jumps unchanged.
- **Edit 3 — Zone B upper deck: +2 maze doors** (door index 2 at 599,
  door index 1 at 610; killFront blocks y 4.5–7.5, unjumpable —
  flights pass only through the door lane). Role: CENTER→LEFT→CENTER
  weave the reference CANNOT jump over; composes with existing jumps
  597/609/623. Driver: taps ~594 (R), ~604 (L). Music: drop-B entry
  grid (43.03/44.03 s).
- **Edit 4 — Zone B lower deck: +1 door (600, door index 0, y 0–3)
  + Chomper B** (`ps-chomp-lower`: dormant (−8, 0.75, 612), triggerZ
  603, dir +1, dist 16, telegraph 48, lunge 60, anchor + pillar).
  Role: weave (2 taps) + the existing 604.5 jump becomes load-bearing
  (grounded runners meet the lunge). Driver: remove jump 594
  (off-path once displaced), taps ~594/596 (L,L), ~602 (R); jumps
  583/604.5/621 kept. Music: drop-B grid (~44.03 s).
- **Edit 5 — Zone D foundry exit: −1 spike (1100 center, replaced),
  +2 maze doors** (door index 2 at 1093, door index 0 at 1104, y 0–3;
  1090 center hop kept as off-path approach texture). Role:
  CENTER→LEFT→RIGHT→CENTER ratchet into the ship ring (recenter by
  ~1112 verified against the ring volume x ±1.5). Driver: remove trunk
  jumps 1087.5/1097.5, taps ~1082 (R, mid-flight), ~1097/1099 (L,L),
  ~1108 (R). Music: build section (secondary, loose).
- **Edit 6 — Zone F shaft approach: +Chomper F** (`ps-chomp-shaft`:
  dormant (8, 0.75, 884), triggerZ 871, dir −1, dist 16, telegraph 48,
  lunge 60, anchor + pillar). Role: the existing pre-shaft jump
  (879.5) becomes timing-load-bearing (late/grounded runners meet the
  lunge at x≈−1.1). NO driver change expected (verify). Music: climax
  grid (62.53/62.79 s). Checkpoint cp-spire (880) restores BEFORE the
  trigger fires fresh with a full telegraph (audited safe, §7).

Chomper count 5 → 8 (cap ≤ 8, constructor-enforced). Each new Chomper
keeps telegraph → threat → reaction → lunge → recovery; camera-visible
open placements; no checkpoint restores into lunges (audited §7).

Difficulty guardrail: all additions are single-tap weaves / timed
jumps on open geometry with existing margins; no pixel-perfect
landings, no nonstop taps, no Spider/Ship hardening, no one-route
ratchets. THE DESCENT stays clearly easier than GRAVITY RIFT.

## 4. Untouched zones (and why)

Ship abyss (continuous flight control + identity), Spider spire (no
hardening), teleports/lift (fragile choreography), 320–360 HIGH/LOW
(orb + height decisions suffice), opening (entry), maze ferry pair,
gravity spire combos, foundry core (already dense), final remix
(already weaves). GRAVITY RIFT: everything.

## 5. Zenith audio analysis (measured from the shipped file)

- File: `Zenith_of_the_Path.mp3`, 3 071 177 bytes, SHA-256
  `40D03D78…BA4B0`, MP3 44.1 kHz stereo 192 kbps.
- Duration **127.713 s** (vs Gravity Lessons 121.574 s; vs level
  123.31 s → song is 4.40 s LONGER than the run).
- Tempo: **120 BPM** (0.5 s onset grid, phase +0.03 s; half-time 60 BPM
  autocorrelation). Same tempo family as Gravity Lessons, independent
  measurement.
- Song map (energy + spectral-flux onsets, numpy, no new dependency):

| Track time | Section | Energy | Notes |
|---|---|---|---|
| 0–4 | intro-quiet | silence | first entry hit 4.03 |
| 4–20 | intro | groove | sparse 1–2 s onsets |
| 20–36 | drop-a | loud | 0.5 s grid from 20.03; dip ~36 |
| 36–40 | break | break | dip |
| 40–56 | drop-b | loud | 0.5 s grid from 40.03 |
| 56–72 | climax | loudest | dense grid to 72.04 |
| 72–92 | breakdown | quiet | quietest 2 s @74; sparse build from 76 |
| 92–108 | build | build | rising density from 92.03; fakeout gap 105.78→108.03 |
| 108–124 | finale | loud | dense 0.25–0.5 s grid 108.03–123.78 |
| 124–127.7 | outro/silence | silence | digital silence from ~124.7 |

## 6. Music strategy (moderate sync, no retime)

- Track offset 0 (sim t ≈ track t). Natural alignment: forge entry↔
  intro, z~280↔drop-a 20.03, z~560↔drop-b 40.03, spire↔climax 56.03,
  ship burst↔build 92.03, terminal↔finale 108.03, finish 123.31 ≈
  final peak 123.78 (−0.47 s… see alignment table; finish CUT with
  0.09 s fade per existing semantics, tail silence never plays).
- No time-stretch, no speed change, no loop. Song 4.4 s longer than
  the run: clean finish-cut (existing `director.cut()` on finish).
- Major anchors (sim-time from driver telemetry vs track; target
  ±100–150 ms for majors, looser for secondary):

| Game event | sim t | track t | anchor | err |
|---|---|---|---|---|
| Chomper A lunge (z 292) | ~21.14 | 21.14 | grid 21.04 | +100 ms |
| Upper doors (z 599/610) | ~43.1/44.0 | = | grid 43.03/44.03 | +70/−30 ms |
| Chomper B lunge (z 612) | ~44.0 | = | grid 44.03 | −30 ms |
| Chomper F lunge (z 884) | ~62.6 | = | grid 62.53/62.79 | +70/−190 ms |
| Finish (z 1790) | 123.31 | = | final peak 123.78 | −470 ms (secondary; cut, reported honestly) |

(Times confirmed/adjusted against real telemetry during implementation.)

## 7. Checkpoint safety audit (new hazards vs 8 crystals)

- cp-forge 60, cp-skybridge 410: all edits ≥ 100 u away — safe.
- cp-maze 520: nearest edit door 599 / chomper trigger 603 — 79+ u — safe.
- cp-spire 880: Chomper F trigger 871 is 9 u BEFORE the crystal;
  restore at 880 fires a FRESH full 48-tick telegraph; lunge starts
  ~5.6 u later; reaction window from restore ≈ 1.0 s — safe.
- cp-foundry 1040, cp-abyss 1315, cp-temple 1500, cp-remix 1620: no
  edits within 30 u — safe.
- Revalidate 8/8 activation on both variants after edits.

## 8. Music integration (existing architecture, no second implementation)

- `THE_DESCENT_CLASSIC.musicTrack = { audioPath:
  '/audio/Zenith_of_the_Path.mp3', trackOffset: 0 }`; asset copied to
  `public/audio/Zenith_of_the_Path.mp3` with byte-identity check.
- New `src/audio/zenithTrack.ts` (Zenith map, same API shape as
  `musicTrack.ts`; Gravity file untouched) + track-grid resolver used
  by `rhythmPulse` (optional grid param, Gravity default
  byte-identical) and `Game.musicStatusLine` (per-level section/beat).
- Transport: BufferSource → Gain → Destination via the proven
  MusicDirector; gesture gate, pause/resume, checkpoint seek
  (`restartMusicForSimTime`), R/Shift+R, finish cut, Main Menu
  disposal — all existing level-driven paths.
- Card: "♪ Zenith of the Path" (no more "No music").
- Visual rhythm: SAME pulse engine on the Zenith grid with a
  Descent-specific restraint scale (~0.55, track-resolved, Rift stays
  1.0); no white-flash spam; Descent keeps its M8.6 section look.

## 9. Replay / fingerprint consequences

- THE DESCENT gameplay changed (hazards/chompers/geometry): its
  fingerprint MUST change; historical M8.6 replays correctly go stale
  (documented, never silently mis-played).
- GRAVITY RIFT fingerprint unchanged (proof required).
- Reference driver updated ONLY for the new challenges (taps/jumps
  listed in §3); every driver behavior change reported.

## 10. QA gates

Gameplay: both references finish 0 deaths; new Chompers telegraph/commit;
new spikes/doors fair; lateral additions real (reversals up); platforms/
Ship/Spider/gravity intact; 8/8 checkpoints; replay VERIFIED; camera safe
(eye non-penetration + no offscreen lethal).
Audio: correct file, decode, graph (source→gain→destination), gesture
unlock, pause/resume, checkpoint seek, restart, finish cut, menu disposal;
Rift Gravity Lessons gates green.
Before/after: hazard/Chomper counts, lateral edges/reversals, longest
same-lane intervals, jumps, supports, Σ|ΔX|/Σ|ΔY|, duration.

## 11. Commit plan

1. spec + straight-route audit + Zenith analysis (this file).
2. Zenith audio asset + level music integration (track module, card).
3. Targeted Chomper/spike/lateral gameplay additions.
4. Reference-driver + checkpoint adjustments.
5. Music alignment + restrained visual rhythm response.
6. Browser/audio/gameplay QA.
7. Docs closeout (design/architecture/roadmap/readme).

## 12. Definition of Done

THE DESCENT: recognizable M8.6 foundation; 6 local edits in 4 zones;
+3 Chompers with roles; purposeful spikes/doors; fewer straight
stretches; slightly more lateral obligation; still easier than Rift;
Zenith audible with moderate sync; checkpoint seek correct; full
reference/replay green. GRAVITY RIFT: gameplay/music unchanged, gates
green. APP: menu/mode/audio lifecycle clean, session disposal clean.
