# M7.3 — Advanced Cube Polish & Spectacle Pass

## STATUS

M7.3: ENGINEERING COMPLETE / BROWSER QA GREEN (modulo documented
load-flakes) / HUMAN RE-TEST APPROVED TO PROCEED (2026-09-12).

Automated: 360/360 tests green (`npm run verify`: typecheck + lint + tests +
build) — 349 M7.2 + 11 new (3 death-burst, 2 maze-wall, 2 lava/beast,
1 air-gate, 3 teleport-integration). Browser QA: 302/312 green with zero
console/page errors — ALL M7.1, M7.2 (migrated) and M7.3 (19/19 logged)
checks green, including two full real-input finishes at the exact 7475-tick
anchor with in-page REPLAY VERIFIED. The 10 remaining fails are the
documented pre-existing CDP-timing/load flakes on frozen systems (wall-rate
dz signature, m2 burst-photo/respawn-window/chain, m3.1 eye sampling, m4
ring/2x-rate, m5 verify-window + knock-on) — each varying run to run with
zero M7.3 causation (sim untouched, all determinism suites green, m71
fully green this run). Golden replay verifies unchanged (unit + in-page).
Screenshots: `qa/screenshots/m73-*` (10 PNG + JSON sidecars).

Controller freeze honored: jump impulse 13.2, gravity 42, fast-fall 55, lane
accel 110 / max 16 / brake 135, collider 1.1 — pinned, zero tuning changes.
No Ship / Spider / wall gravity / music sync / monster AI / moving hazards /
new replay schema (all explicitly deferred). No level-id engine branches.

## HUMAN M7.1 APPROVAL (unchanged)

M7.1 HUMAN FUN RE-TEST: APPROVED (2026-09-10). `vertical-slice-01` is the
approved Cube reference level and is preserved byte-identical (its anchor —
tick 6190 / 51.583 s — is re-pinned by the M7.3 suite).

## OBJECTIVE

Answer the human M7.2 feedback ("good base, but still too medium, not
spectacular/vertical enough") with a focused polish/rework pass on
`advanced-cube-01` — significantly more advanced, vertical, precise and
spectacular while remaining fair and readable. Cube-only; no new mode.

## ENTRY STATE

Entry HEAD `720a785` (M7.2 engineering complete), clean tree, `main` synced
with `origin/main`, one worktree. Baseline `npm run verify`: 349/349 green.

## HUMAN FEEDBACK (recorded, implemented item-by-item)

1. Closer to medium-hard/hard than medium → offset island pairs, maze
   walls, denser spikes, commit pair, HIGH spike, release hop.
2. More blocks in the air + height changes → offset pairs at three heights,
   two overhead air-gate arches, more LOW/MID/HIGH/CEILING transitions.
3. Track too simple in places → Phase-1/Phase-2 splits, commit pair, second
   teleport hop, release hop.
4. Block corners/edge closures → closed corner frames (strips overhang into
   posts) + rear sills on every tall slab.
5. Mini-platform glow → under-glow bottom frames on exposed narrow islands.
6. Bigger death explosion → 24 fragments, larger chunks, faster spray,
   0.5 s life (still one bounded pool).
7. Teleport portals smaller/rounder/clearer → ring gates (outer halo +
   inner rim + pane), toothed maw mouth, compact exit rings.
8. Entry/exit co-present → short-hop pair (489 → 513, 24 u apart, both rings
   in one frame); the signature maw jump stays long (524 → 634).
9. Other portals smaller + forced routing → tighter gravity/speed gates;
   rings sit over void (miss = death); maze walls commit lanes.
10. Taller/denser spikes → 3 tall spikes (0.7 gameplay height, still far
    inside the 2.07 apex), spike pairs, triple ceiling spikes.
11. More frontal-kill maze walls → 4 killFront walls (full-width jump wall +
    3 lane walls) rendered as framed hazard-orange blocks.
12. More horizontal demands → 6 new mid-air transfers (drop-drift, island
    hops, bridge return, drop-transfer, HIGH approach, release line-up).
13. Stronger chain-chomp presence → guardian jaw + tooth crown + trailing
    chain links + a second off-corridor beast at the storm climb.
14. Lava pits/danger → 6 lava basins (chain void, FF basin, hop lake, maw
    river, furnace flank, storm flank), presentation-only.
15. Music sync wanted later → 4 new beat-ready cues (hop in/out, wall,
    beast); NO audio/clock/sync engine ships.

## CONTENT REWORK (advanced-cube-01, data only)

- Phase 1: LOW two-lane → offset island pair (L 98..112, C 116..134) with
  drop-drift + two island spikes + mid-air transfer; tall bridge spike.
- Phase 2: full-width maze jump-wall (194..196) + weave (190/202); LOW
  two-lane → offset pair (C 257..270 spike 264, R 274..286 spike 274.5 flown
  over by the transfer arc) + bridge (290..303 spike 295).
- Phase 3: third ceiling spike (364); MID lane wall (432); hop runway
  (511..527 spike 518) replacing the old anticipation straight.
- Phase 4: short-hop teleport (mid-air ring 489 → grounded exit 513 over
  the lava lake); maw entry 524 (guardian 532); post-exit lane wall (640)
  + commit pair (646/654) + drop-transfer back to center.
- Phase 5: tall spike pair (760/764), HIGH island spike (845), epilogue
  lane wall (908), tall final spike (927), release hop (951..955 gap,
  finish 960 on the island).
- 29 hazards (25 spikes + 4 walls) at 3.0/100 u vs M7.2's 2.2; 2 air-gate
  arches (clearance-pinned); 8 setpieces (2 guardians + 6 lava).
- Duration: 7475 ticks = 62.292 s (60–75 required, 62–70 preferred).

## TELEPORT REDESIGN (presentation)

Ring gates from shared halo/box geometries + shared teleport materials:
outer ring + bright inner rim + faint pane; maw entry adds an 8-tooth
hazard-orange crown. Entry radii 2.2/1.8, exits 1.5/1.3 (was wall-sized).
Teleport FX strengthened (44-count exit burst, 0.75 s life, violet punch
unchanged in family). Semantics untouched (ReplayV1 unchanged, lethal wins,
skipped intervals clean, exit velocity/lane/support pinned).

## SETPIECE / LAVA (presentation-only, fingerprint-excluded)

`VisualSetpieceDef.kind` gains `lava` (glow slab + dark crust, below the
route). Guardians gain jaw + teeth + chain (shared geometries only). Lava
never collides; the void bound still kills (falling reads as sinking into
molten danger). New-beast clearance pinned (off-corridor or past-runway).

## SCRIPTED COMPLETION

`tests/helpers/advancedCube01Script.ts`: 69 z-triggered actions (lane taps,
jump presses, one 22-tick fast-fall hold). Finishes tick 7475, 62.292 s,
portals 2, pads 2, orbs 2, teleports 2, 2x climbed + released, 0 deaths.
Record → replay verifies (`pass`, 7475 frames, zero presentation keys).

## AUTOMATED QA

`tests/advancedCube01.test.ts` (+8: hop-first/second/both-once/co-visible,
maze-wall routing incl. no-jump frontImpact proof, tall-spike fairness,
lava-below-route, beast clearance, air-gate clearance) + new
`tests/deathBurst.test.ts` (3: 24-pool, play/clear, bounded). Migrated:
`spikeOrientation` (geometry-aware mesh match), `undersideRails` (closed
frame + exposure-gated glow). Full gate: typecheck + lint + 360/360 + build.

## BROWSER QA

M7.2 section migrated to the reworked coordinates (overlap-safe teleport
staging, full M7.3 holds-driver plan) — green, including a 1-death full
real-input finish at the exact anchor + REPLAY VERIFIED. M7.3 section (19
logged checks, `m73-*`) — ALL GREEN, zero console/page errors: route
resolves, start state, player/hazard identity, offset-island landing,
wall frontImpact (z=193.4), tall-spike hazard, burst live-in-hold
(dead@21.0), ceiling tip-down projection, hop-pair co-visibility (both
rings in one frame), hop snapshot (513.6/0.64) + VFX (bursts=2) + violet
punch (0.33), maw ring staging (ac-maw), beast in-frame, air-gate + storm
photos, full real-input finish (3 deaths) + runtime band (7475 = 62.29 s)
+ REPLAY VERIFIED (finished) + replay photo, restart/fallback/resource
guards (29 mats / 8 geos / 62 children flat). Full gate: 302/312 (10
documented flakes, see STATUS).

## PERFORMANCE OBSERVATIONS

Headless Chromium 1280×720 (SwiftShader — comparative only): opening
29 materials (26 shared + 2 teleport + 1 cached tier) / 8 geometries /
3 composer passes / 62 scene children — IDENTICAL top-level counts to
M7.2 (all new meshes ride inside existing groups; zero new materials,
zero new geometries, zero new pools/draws at the top level). Mesh count
inside LevelView.group grows (closed frames + glow + rings + teeth +
chains + lava ≈ +150 meshes on this level). Build 618.84 → 622.95 kB
(+4.11 kB: level data + renderer deltas + tests). Real-GPU closeout
remains M6D.

## HUMAN GATE (APPROVED TO PROCEED — 2026-09-12)

M7.3 HUMAN ADVANCED-CUBE RE-TEST: APPROVED TO PROCEED. The human played
`advanced-cube-01` and said "esta bastante bien. vamos a seguir hacia
delante". Recorded conservatively: the advanced Cube direction is
accepted and development may proceed. NOT claimed: "perfect", final art
permanently locked, or future tuning forbidden. No redesign permission —
M6D remains a performance/resource/stability closeout.

Original human-gate playtest brief (kept for record — the gate above is now approved):

Play: `http://localhost:5173/?level=advanced-cube-01`. Hardest sections:
(1) FF gate (z 243..257), (2) Phase-1 offset pair (z 92..134), (3) Phase-2
island chain + wall (z 186..307), (4) hop ring (z 489, mid-air),
(5) commit pair (z 646..660), (6) storm climb + tall pair (z 728..855).
Questions: is HARD fair (deaths teach)? Do heights/walls read? Is the hop
one connected moment? Is the beast/lava spectacle worth it? No agent may
mark PASS without the human playtest.

## KNOWN LIMITATIONS

- Thinnest windows: FF takeoff (~25 ticks), C-island edge landing (~7
  ticks), commit-pair commit (~5 ticks) — all deterministic, flagged.
- Edge-riding (side-scrape sliding along a lane wall's x-face) can squeeze
  past single-lane walls: the garden wall is therefore full-width (the
  lane walls remain as maze dressing + weave reinforcement).
- Headless stills under-read additive juice/rays (real-GPU gate question).
- M6D real-GPU closeout still pending (M7.3 is its workload).
- No Ship/Spider/wall-gravity/music/AI (future milestones).

## QA-HARDENING LESSONS (for future milestones on loaded boxes)

- CDP input latency under headless load reaches ~2.5 u at 1x (~6 u at 2x):
  in-page drivers must use hold-to-repeat (per-tick grounded+held) for
grounded takeoffs, arrival-early lane taps, spammed orb windows and
  redundant keyups — never single edge-taps at tight margins. Jitter
  margins ≥ 1.5 u headless double as human-fairness margins.
- debugTeleport staging must clear hazard margins (> 1.05 u = cube half +
  hazard half); staging inside a margin reads as instant death on stage.
- Pause keypresses prove unreliable under load: gate flows must be
  pause-free (freeze only for best-effort photography, never for logic).
- Monotonic session counters (teleportEventCount) must be baselined AFTER
  the restart and BEFORE staging (cube at start cannot fire); the first
  poll observing count > baseline snapshots the event — no arming races.
- Navigation needs fallback (networkidle → load → commit + ready poll);
  a single networkidle flake must never abort a 2 h gate.
