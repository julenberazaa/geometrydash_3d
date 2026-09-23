# M9 — Gravity Lessons: Rhythm Polish ("THE DESCENT" music-driven superproduction)

> Status: ENGINEERING COMPLETE / HUMAN MUSIC-RHYTHM GAMEPLAY GATE OPEN
> (branch `feature/m9-gravity-lessons-rhythm-polish`, NOT merged).
> `npm run verify` green (49 files / 613 tests); both reference routes
> finish with 0 deaths and replay VERIFIED; `scripts/browser-qa-m9.mjs`
> 14/14 green with `qa/screenshots/m9-*` evidence. Measured: finish 60 ms
> off beat 230; majors median 60 ms, 30/51 within ±70 ms; openness
> 60.5% → 44.2% 3+-band (alt 62.3% → 46.0%). Automation cannot approve
> sync feel, flash power, musical flow, precision, difficulty-vs-fun,
> readability, or one-piece feel — do NOT mark PASS until the human plays
> it with sound on.
>
> (Entry context below preserved as written at milestone start.)
> M8.6 received a POSITIVE human verdict after the camera corrective pass:
> the level is visually strong and substantially more enjoyable. M9 takes it
> from "a good difficult 3D platforming level" to "a music-driven, highly
> authored, relentless 3D Geometry-Dash-like superproduction".
> Three equal pillars: (1) real music + rhythm sync, (2) precision-route
> extreme polish, (3) music-reactive visual presentation. None is optional.

## 1. Entry state (verified, not trusted)

- Source branch `feature/m8-6-extreme-density-verticality`, HEAD `550915b`
  matches origin. Working tree clean except the untracked user-supplied
  `Gravity_Lessons.mp3` (2,923,848 bytes) — NEVER delete/overwrite/replace.
- Baseline `npm run verify`: GREEN — 44 files / 585 tests, build OK
  (bundle 714.34 kB). Reference route: tick 14797 = 123.31 s, 0 deaths,
  replay VERIFIED, both variants.
- Preserved from M8.6: camera (multi-height + occlusion), lava, modes,
  moving platforms, world identity, all engine invariants.

## 2. Human complaint (the precision problem)

Wide permissive corridors admit ~4–5 equivalent safe lines with little
danger. M9 rule: MOST active gameplay presents ONE authored intended route
(obstacles define a precise weaving line through visually wide 3D space),
occasionally TWO meaningful alternatives, never 3–5 simultaneous easy
lanes. "One line" does NOT mean one cube wide / straight / no lateral
movement — it means hazard/island/height/portal geometry forces accurate
threading. Visual corridor width ≠ safe-route width (permanent design rule).

## 3. Music analysis (measured locally, 2026-09-23)

Asset: `Gravity_Lessons.mp3` — 121.574 s, MP3 44100 Hz stereo, 192 kbps,
2.79 MiB (fits Git/GitHub normally — NO LFS). Peak 1.467 (clipped master),
RMS 0.248. DO NOT re-encode unless technically necessary.

- Tempo: STABLE 120 BPM, beat period 0.500 s, beat grid offset **0.06 s**
  (beat k at `0.06 + 0.5·k`, verified by grid-phase scoring across every
  section — one grid fits the whole song; no tempo drift).
- First sustained sound ≈ 0.95 s; first strong onset 1.06 s (= beat 2).
- Last sustained sound ≈ 115.25 s; digital silence 115.3–121.6 s.
- Musical finish: **beat 230 at 115.06 s** (final impact), decay to 115.3.
- Structure (120 BPM, section ↔ sim-time mapping target):

| Section | Music time | Beats | Energy | Level mapping |
|---|---|---|---|---|
| Silence/count-in | 0–2.0 | 0–4 | — | tick 0 = music 0 (start gate) |
| Intro groove | 2–19 | 4–38 | moderate 8ths | ACT 1 forge + ACT 2 entry |
| Drop A | 19–41.5 | 38–83 | LOUD | ACT 2 islands + ACT 3 maze entry |
| Break/stutter | 41.5–46 | 83–92 | dips + hits @42/44 | maze mid breather |
| Drop B | 46–56 | 92–112 | LOUDEST | maze exit 2× + spire entry |
| Breakdown | 56–74 | 112–148 | quiet | gravity spire (strange gravity) |
| Build | 74–92 | 148–184 | rising from ~88 | foundry + ship entry + ship |
| Climax | 92–112 | 184–224 | LOUD sustained | ship end + spider + void + remix |
| Outro decay | 112–115.3 | 224–230 | falling | finish gate ≈ beat 230 (115.06) |

- Retime consequence: the M8.6 reference route (123.31 s) OVERRUNS the
  musical ending by ~8 s. M9 MUST land the finish at ≈ 114.5–115.5 s
  (target beat 230 ± 140 ms): target reference **13680–13920 ticks**.
  Levers (musically justified, §35): 2× maze-approach/doors during Drop A
  (high-speed lane maze), 2× spider during climax (fast snap chains),
  extended 2× remix; NO time-stretch, NO padding, NO base-speed change.

## 4. Audio architecture (hard rules)

- **MUSIC FOLLOWS DETERMINISTIC GAMEPLAY TIME. GAMEPLAY NEVER FOLLOWS THE
  AUDIO CLOCK.** Sim stays 120 Hz fixed; no `AudioContext.currentTime` /
  media time / wall clock in any gameplay decision (collisions, jumps,
  portals, hazards, platforms, gravity, modes, success/death).
- `MusicDirector` (new, `src/audio/`, presentation-owned — name audited:
  no existing audio transport owner; `DeathSfx` is a fire-and-forget blip):
  owns track loading (fetch + decode of `public/audio/Gravity_Lessons.mp3`
  via Web Audio), play/pause/resume/restart(offset)/seek-resync, mute,
  volume, transport state, authored track offset. Game coordinates lifecycle
  only. DeathSfx untouched (still guarded, still gesture-gated).
- Sim-time master: `targetMusicTime = sim.elapsedSimTime + TRACK_OFFSET`
  (TRACK_OFFSET = 0: tick 0 = music 0; first beat 0.06 s lands during the
  entry slab, first gameplay action ≈ beat 4+). Audio output follows;
  sim never follows audio.
- Pause (P): sim freezes + presentation freezes + music pauses (buffer
  stop + offset record). Resume continues from the same deterministic
  position — no drift jump. Death/R: immediate short fade/cut during the
  hold, restart at the authored origin on respawn. F4 replay: music follows
  replay sim time from the origin; audio failure/mute NEVER affects replay
  verification or state hashes.
- Drift correction (presentation-only, never touches sim): dead-band
  ±60 ms (leave alone), resync (restart-at-target) beyond 180 ms sustained,
  hard resync on lifecycle edges. No continuous micro-seek jitter.
- Debug probe: `musicTargetTime / musicActualTime / musicDriftMs /
  musicPlaying / musicMuted` (+ section/beat in F1). `?music=off` silences
  music with zero gameplay difference (pairs with `?fx=off`).
- Fingerprint rule: music asset path / track metadata / all rhythm VFX are
  presentation-only — excluded from level + state fingerprints (pinned).
  Obstacle/hazard/platform/portal/speed reauthoring IS gameplay and
  changes the fingerprint (expected; golden fixture is validation-02,
  unaffected).

## 5. Browser autoplay / start gate

On load THE DESCENT renders (tick 0 frozen) under a minimal
`PRESS SPACE / CLICK TO START` overlay. First gesture: resume/create
AudioContext → start music at origin → unpause sim from tick 0 — together.
Never run seconds silently first. Post-gesture restarts need no click.
Music loads/plays ONLY for levels declaring `musicTrack?` (validation +
  legacy levels stay silent; explicit `?level=` overrides valid).

## 6. Rhythm-map contract

- `MusicTrackDefinition` (`src/audio/`, THREE-free data + pure helpers):
  the §3 map as data — 120 BPM grid (offset 0.06), named sections with
  beat ranges, drop/build/breakdown/climax/ending anchors. Compact
  beat-grid representation (tempo is genuinely stable) + explicit anchors
  for the stutter hits (42.0/44.0 s) and the 115.06 finale.
- `rhythmCues` (M7.1 position-bound semantic markers) are EVOLVED, not
  replaced: cue `z` positions get authored `beat` anchors
  (`MusicCueAnchor`: cue id → beat index) in ONE deterministic mapping
  module; cues stay presentation-only and fingerprint-excluded. No second
  disconnected rhythm system.
- Alignment loop (tooling, test-side): drive the reference route, record
  event tick→time for pads/orbs/gravity/speed/mode/teleport/platform-
  transfer/major-jump/chomper-lunge/spider/ship-inversion/finish, compare
  to nearest authored anchor. Targets: MAJOR anchors ±70 ms, STANDARD
  rhythmic actions ±140 ms (reference driver; human play stays approximate
  by design). NEVER `if (beat) spawn/flip` — hazards/platforms/portals
  exist deterministically at world positions whose reference arrival lands
  on the beat (author triggerZ/phase/period/location to achieve it).
- Musical hierarchy: strong moments → pads/orbs/portals/teleports/drops/
  chomper lunges/mode flips; subdivisions → small hops/lane weaves.

## 7. Level reauthoring (precision + musical)

Same id `production-showcase-01` (evolution, not a copy). Same 9-act arc,
same biomes, same lava, same camera. Changes:

- **Funnel audit first**: new test-side `routeOpenness` analyzer samples
  Cube/Floor sections every 2 u and counts simultaneously safe lane bands
  (support + no hazard + no killFront within the decision window). Baseline
  report, then re-measure. Target: demanding gameplay shows 1 intended
  band (occasionally 2); 3+ equivalent easy bands ~eliminated.
- **Funnels, not corridors**: close non-driver lines with spike
  formations / hazard teeth / walls / holes / height constraints — never
  shrink every corridor to one lane physically.
- **Spikes**: many more — singles, doubles, floor/ceiling/wall chains,
  island-tip + landing-zone spikes, alternating lanes, corridor teeth;
  always fair (frozen envelope, telegraphed, never decorative confusion).
- **Double-spike / chained jumps**: immediate lane shifts, short island
  landings between doubles, fast-fall enforced drops — all inside the
  8.8 u / 0.63 s envelope.
- **Precision islands**: many more small/staggered/moving/spike-crowned
  chains (5–10 transfers without passive reset); readable trap islands
  (decoy with spikes / blocked transition / chomper lane — never invisible
  knowledge).
- **Falls as gameplay**: high→fast-fall→gap→lower-island, drop shafts with
  immediate landing jumps, gravity-controlled falls; staying high sometimes
  wrong.
- **Heights**: more stacked decks / shafts / micro-islands / broken stairs
  / elevators / ceiling + wall routes + crossovers (use the M8.6 camera).
- **Labyrinths**: several distinct short mazes — (A) high-speed lane maze
  @2× Drop A, (B) vertical maze, (C) gravity maze, (D) 5–8 s micro-maze —
  primarily ONE safe flow line with rapid reads, occasional 2-route.
- **Ship**: denser gates (alternating high/low, offset slots, side
  corrections, ribs/pillars), beat-aligned openings, stronger inverted
  segments timed to accents. **Spider**: beat-subdivision snap chains
  (floor→ceiling→wall→wall→floor) with snap light bursts; semantics
  untouched. **Platforms**: retune phase/period/location so ferry
  arrivals/departures land on beats (trajectories stay fixed-tick).
  **Chompers**: telegraphs start on anticipation, lunges land on
  downbeats/impacts (author triggerZ only). **Speed**: arrangement per §3
  table (0.5× precision moments, 2× drops/climax); every portal justified.
- Density floor (no regression from M8.6 §4): skill jumps ≥ 85, lane
  edges ≥ 50, max passive gap ≤ 1.5 s, supports ≥ 64, Σ|Δy| ≥ 400,
  Σ|Δx| ≥ 150, reversals ≥ 20, platform riding both routes — thresholds
  re-pinned if the retime shifts them honestly (never weakened to pass).

## 8. Rhythm visual system (superproduction, bounded)

- ONE presentation owner composing existing systems: extend
  `visualTimeline` (sections re-authored to §3 energy: quiet precision /
  build climb / drop flash / breakdown dim / climax max) + `eventPunch`
  (new `beat`/`drop` families? or a dedicated beat envelope — decision:
  new THREE-free `rhythmPulse.ts` computing subdivision/beat/downbeat/drop
  envelopes PURELY from deterministic sim time + the music map, fed into
  the existing in-place hooks) + `VfxSystem` intensity + `EnvironmentView`
  beams. NO competing trigger system; ownership documented in
  ARCHITECTURE.md.
- Hierarchy: subdivision = route-edge micro-pulse; beat = edge/emissive +
  environment light; downbeat = bloom accent + beam burst; drop/major =
  localized flash + portal/architecture surge + ray burst + brief
  exposure/bloom punch (in-contract). Never every beat equally dramatic.
- New bounded language: pooled/reused energy rays (distant lightning,
  tower beams, reactor arcs, core radials — presentation timelines, never
  collision-confusable), localized colored flashes (no prolonged white
  washout, no high-frequency full-screen strobing — readability bound;
  `?fx=off` stays the escape hatch).
- Biome response: forge amber, islands cool streaks, maze wall-edge
  flashes, cathedral shafts, foundry lava-red impacts, reactor machine
  bands, spider-temple gold snaps, void sparse indigo violence, final-core
  magenta/orange/white-gold max. LAVA NEVER REGRESSED.
- Perf: shared geometry/materials, pooled rays/flashes, precomputed beat
  map, scalar modulation; no per-frame allocation, no per-object lights,
  no per-frame FFT (no analyzer at all — pulses are authored, not heard).

## 9. QA

- `npm run verify` green; deterministic tests: track-map parse/order,
  cue-anchor validity, reference-event alignment report, pulse-envelope
  bounds, pause-freeze, replay-timeline identity, fingerprint exclusion,
  transport state-machine via fakes.
- Route: ShowcaseDriver updated for new geometry (0 deaths primary;
  legitimate alternates only — no fake branch preservation); lane-lazy
  death pin (no-tap variant dies → lane discipline forced); openness +
  density + musical-action metrics re-pinned.
- Browser/audio QA: start gate, tick-0 music start, pause/resume,
  death/respawn, R, F4 replay, mute/music-off, drift probes, zero
  console/page errors; screenshots at all 14 §54 stations (quiet intro →
  finish) + pulse/ray-change probes (screenshots can't prove rhythm).
- Legacy gates re-run: replay, camera, platforms, lava, portals, spider.
- Human gate (OPEN at close): song-sync feel, flash power, musical flow,
  route precision, difficult-but-enjoyable, readability, one-piece feel.
  Final state: ENGINEERING COMPLETE / HUMAN MUSIC-RHYTHM GAMEPLAY GATE.

## 10. Definition of Done (engineering)

Verify green · music asset committed (no LFS) · start gate + pause/
restart/replay semantics proven in browser · drift probes sane · finish
≈ beat 230 (115.06 ± 140 ms on the reference driver) · major anchors
±70 ms / standard ±140 ms (measured, reported honestly) · openness audit
shows 1-line (occ. 2) routing · density floor held · driver 0 deaths ·
replay VERIFIED · screenshots at 14 stations · legacy gates green ·
docs (ROADMAP/GAME_DESIGN/ARCHITECTURE/README) updated with the two
permanent rules (music-follows-simtime; single-flow precision routing) ·
logical commits, no merge of main, no force-push, mp3 preserved.
