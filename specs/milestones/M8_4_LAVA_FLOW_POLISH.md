# M8.4 — Lava Flow Polish (source → crossing → cliff-fall)

Corrective follow-up on `feature/m8-3-lava-motion-chomper-style-spider-camera`
(new branch `feature/m8-4-lava-flow-polish`; `main` untouched). Human verdict
on M8.3: everything good EXCEPT the lava — still not glowing enough, not
liquid enough, and the river reads as a static gate, not a flow.

## 1. Root causes (audited, not assumed)

- **R1 weak glow presence (presentation, measured):** the bright lava area
  is a thin inset slab (`w − 0.3`) seen mostly at grazing chase angles;
  the bulk is dark `lavaDeep`. Emissive `0xff5000 @ 1.7` under ACES +
  bloom-threshold 0.8 reads as flat dark-red at 20 u (see
  `qa/screenshots/m83-01b-lava-flow.png`: dim blobs beside the route).
  There is NO near-white-hot accent anywhere in lava — yet the Chomper
  eyes prove small white-hot accents survive this exact pipeline.
- **R2 no net transport (presentation, by construction):** `updateLava`
  moves are all in-place oscillations (crust ±0.12, fall width ±13%,
  splash/drip breathe). The checksum advances but nothing visibly
  TRAVELS. Flat materials mean no texture scroll — direction needs
  conveyor features, which do not exist.
- **R3 the river has no story (content):** symmetric twin-feed (both
  sides pour in), no exit, no drop. It cannot read
  source → crossing → fall because it is not authored that way, and the
  validator does not require it.
- **R4 small vents (presentation):** 0.9-halfwidth collars with
  0.08-thick mouths read as blobs at chase distance.

## 2. Scope

- A. `LavaVolumeDef.flow?: { x, z }` — optional presentation-only surface
  direction hint. Auto-excluded from the level fingerprint (`writeLava`
  hashes id/center/halfExtents/role only — precedent: `chainAnchor`).
- B. Validator rule 5: a flow-hinted pool must touch/overlap a downstream
  lava volume (center strictly downstream along the hint) — flows must
  continue, never dead-end. Rules 1–4 unchanged.
- C. Gauntlet river re-author (content, data only): the `mg-river`
  crossing box is BYTE-IDENTICAL (lethal footprint frozen — the 3 u hop,
  the missed-hop lava kill, and the scripted line are untouched).
  Source stays east (KEEP `mg-river-src-r`/`mg-river-fall-r`); the west
  vent pair is removed; new `mg-river-out` channel pool (top 0.55,
  spillover lip below the crossing top 0.7) on a rock shelf with side
  rims; new `mg-river-drop` cliff fall (top 0.55 → bottom −15, past
  deathY −14); west curb removed (spillway), west pillar removed (stood
  in the channel path), east architecture untouched.
- D. Renderer (same owners, same hooks): shared `lavaCore` material
  (small-area near-white-hot accents — the ONLY sub-cream-clip way to
  read "hotter"); flow-hinted pools get 3 traveling core blocks +
  current-riding crust (directional drift + wrap); falls adjacent to
  flow-hinted pools get a descending pour pulse; a static pour-lip at
  the channel→drop joint; flow-fed vents get a chimney block; ALL vent
  mouths/drips render wider (render-only, no box changes). No new
  geometries (unitBox everywhere — `geometryCount` 8 pinned); no new
  materials besides `lavaCore` (restart-stable, pinned relatively).
- E. `updateLava` kinds `core` / `crustFlow` / `pulse`: conveyor motion
  from build-time bases (wrap math in render-clock), zero alloc,
  dt = 0 freezes. Existing kinds untouched.
- Non-goals: music/BPM, M9, new mechanics, fluid sim, particle floods,
  touching portal bounds / spider camera / ship tunnel / death /
  chomper / wall-lane code paths, ReplayV1 bump.

## 3. Accepted edge-case consequences (explicit, not silent)

- West route edge at z 128..131: stepping sideways into the strip meets
  lava (death, per the touch-lava contract) where the curb/pillar used
  to block. Obscure by construction (deliberate sideways walk into a
  lava strip); scripted line never goes there.
- The rock shelf under the channel is support: an edge-fall landing on
  it recovers (design-allowed: "dies at the void bound UNLESS support
  is recovered") and strolls back onto the route. No trap, no softlock.
- New/removed lava + solid boxes change the gauntlet level fingerprint
  (expected — content changed). No stored gauntlet tapes exist; the
  golden fixture (validation-02/test-level, no lava) is untouched.

## 4. Tests / QA

- `lava`: rule-5 accept/reject, gauntlet validates clean, `flow` hint
  fingerprint-neutral, hinted-fixture mesh budget (cores/pulse/lip/
  chimney counted), conveyor motion (cores travel + wrap, pulse
  descends + wraps, crust rides downstream), dt = 0 freezes all new
  kinds, unhinted 13-mesh fixture unchanged, pulse floor/swing kept.
- `multimodeGauntlet`: full scripted run still finishes 0 deaths replay
  VERIFIED (tick count may shift — path, not content, is the contract;
  jumps/kills re-pinned if so).
- Browser M8 slice stays green; new M8.4 checks — lava alive
  (checksum), pause freeze, river coherence (source vent + crossing +
  cliff drop all in-frame from staged anchors), missed-hop lava kill,
  replay VERIFIED, zero console/page errors; `m84-*` evidence
  (source, crossing, drop, close-up).

## 5. Definition of Done

- [x] `npm run verify` green (typecheck + lint + tests + build).
- [x] Gauntlet driver still completes via real inputs, 0 deaths, replay
  VERIFIED; ReplayV1 unchanged; golden fixture intact.
- [x] River reads source → crossing → cliff-fall in screenshots AND in
  motion (cores travel, pulses descend, crust rides downstream;
  composition NDC-verified in one frame).
- [x] Glow reads hotter with no cream washout (small-area cores only).
- [x] M8.3 goods preserved (spider continuity, chomper, portal bounds,
  ship tunnel, death, wall-lane — untouched paths, full slice green).
- [x] Browser M8 slice green (65/65, first fully-green run on this box)
  + zero console/page errors with `m84-*` evidence.
- [x] Docs: this spec, ROADMAP, ARCHITECTURE, GAME_DESIGN §7.3 river
  paragraph, README. No human approval claimed.

## Follow-up polish (same branch, post-human-playtest)

Human verdict on the M8.4 build: reads as lava now, but (a) glows too
weakly — the maze kill-walls out-glow it, which is backwards for the
primary luminous hazard; (b) flows a touch too slowly. Root cause
(measured, not guessed): maze walls emit amber `0xff9d00 @ 1.7`
(luminance ≈ 1.1) over large camera-facing faces while the lava surface
emitted deep red-orange `0xff5000 @ ~1.85` (≈ 0.67) — walls won by ~1.7×
and bloomed harder past the 0.8 threshold; the only hotter lava elements
(3 small cores) subpixel-blended into the surface at chase distance.
Fix, presentation-only: surface emissive → hotter amber `0xff5a00`
(blue stays 0 — ACES-safe) with band `1.9..2.6` (matches wall peak on
the bright breath); cores `0xffd166` + lengthened 0.5 → 0.65 (hot bands
survive 20 u); deep floor +0.15. Speed, still viscous: cores 0.55 → 0.8
u/s, crust 0.32 → 0.45 u/s (shear preserved), pour traverse 2.5 → 1.8 s,
fall wave +20%. No sim, no fingerprint, no budget change; unit rates
re-pinned, slice 65/65 green, replay VERIFIED.

Second follow-up (continuous glow): the bright band still breathed as
a GLOBAL synchronized swing (surface 1.9..2.6, deep 0.85..1.35, every
mesh in lockstep) — the whole river flashed on/off together. Removed:
`setLavaPulse` now holds a stable baseline (surface 2.35..2.47, deep
1.0..1.1, ripple <= 0.12) so lava never has a dim phase and stays
above maze-wall luminance at all times; peak 2.47 stays inside shipped
cream-safe territory. Motion is now purely the traveling features
(cores 0.8 u/s, shear crust, 1.8 s pour traverse, fall waves). Unit
test pins floor + small ripple; slice 65/65 green, replay VERIFIED.

Third follow-up (REAL glow on real GPUs): playtesting on a discrete
GPU showed the lava as flat matte plastic with zero halo while the
trail/rails/portals bloomed. HDR math: surface luma ~0.79, cores
~0.78 — BOTH just under the 0.8 bloom threshold, so the lava never
entered the bloom pass (SwiftShader QA has no bloom, hiding it).
Fixed without new meshes: surface emissive 0xff4a00 @ 3.45..3.6
(luma ~1.04, always past threshold with margin); cores are now HDR
working-space (2.2, 1.25, 0.35, luma ~1.6) — blooming traveling hot
spots. Red-dominant/blue-free emissive keeps ACES orange, never
cream. Unit test pins the luma math + hue safety (bloom-less runners
can't catch this class of regression otherwise).
