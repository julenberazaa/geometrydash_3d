# M8.2 — Lava / Portal-Bounds / Spider-Camera / Chomper Polish

> Follow-up corrective milestone after M8.1. Branch:
> `feature/m8-2-lava-portal-spider-chomper-polish` (base: M8.1 tip
> `08a4665`). Engineering complete requires every Definition-of-Done line.
> Human gate stays OPEN. `main` untouched. No music sync, no M9, no new
> mechanics, no merge to main.

## 0. Human feedback (recorded verbatim, then diagnosed)

1. Lava still looks like an orange block.
2. Portal bug still exists: state changes even if the player passes
   outside the portal.
3. Wall-lane behavior is now fine. **Preserve it.**
4. Ship tunnel is fine. **Preserve it.**
5. Death is better. **Preserve; touch only if visually needed.**
6. Chomper should be brighter lava-orange, more square/blocky, bigger
   head, big teeth — reads too much like a mouse right now.
7. Lava should feel more fluid/sensible — Minecraft-like source / fall /
   viscous-flow logic, still lightweight.
8. Spider camera transition is abrupt; smooth it like the gravity-flip feel.

## 1. Root causes (proven before fixing — facts, not impressions)

- **R1 (portal bug REAL, content-side):** the M8.1 trigger mechanism
  (`sweptWindowOverlap` over optional volumes) is correct and unit-pinned,
  but the gauntlet's volumes are corridor-sized boxes (up to 10 u wide ×
  5 u tall) while the visible ring opening is ~2.9 u across. Passing
  3+ units beside the visible ring still overlaps the box and fires.
  Size — not center — disagrees with the visual. Nothing in code or
  content validation enforces volume ≈ opening.
- **R2 (lava read, presentation + authoring):** pools render the full
  lethal box as a flat bright slab (the "orange block"); falls are
  straight columns whose tops sit laterally offset from their vents;
  several vents are fully embedded in rock (invisible — the mouth glows
  inside a pillar). Facts: river vent boxes sit 100% inside their
  pillars; gap-fall columns sit ~0.9 u sideways of their vent mouths.
- **R3 (chomper mouse read, presentation):** round dark basalt sphere
  body dominates + two small round eyes on top + small teeth = rodent
  silhouette. The glow is trim, not body.
- **R4 (spider snap, presentation):** `RendererHost.focusSide` follows
  only `gravityMode`, and the Spider snap teleports the player up to 14 u
  along gravity in one tick. Gravity portals move the player continuously
  (the camera swoops *with* the motion); the Spider teleport leaves the
  camera covering a ~2.8 u eye + ~6 u look discontinuity with no
  motivating motion — a whip at look λ=9/s. Endpoints are correct; the
  *rate* is the bug.

## 2. Scope (ONLY this)

- **A. Lava:** presentation-only render upgrade (crust plates, stepped
  viscous falls, impact splash, vent lips) + re-authored gauntlet vents
  (protruding, over their falls) + one new validation rule (sources must
  protrude from rock). Zero sim change; lethal boxes unchanged wherever
  possible.
- **B. Portal bounds:** new `portalAuthoring.ts` validator (volume ≈
  visual opening, centered on the gate plane) + gauntlet volumes shrunk
  to opening size on the proven rider lines + pylons re-framed on the
  small gates + side runaway catcher (`deathXMin/Max ±11`) + regression
  tests for the exact human scenario. Mechanism untouched.
- **C. Chomper:** view-only redesign (bright lava-orange blocky body,
  big head, big teeth, brow-set eyes) + brighter chomper-scoped
  materials. Sim byte-identical.
- **D. Spider camera:** presentation-only swap envelope (slower lambdas
  ~0.5 s, spider-context only) in `ChaseCamera` + `RendererHost` edge
  detection. Gravity/Cube/Ship framing numerically untouched.
- **E. Preserve:** wall-lane resync, ship tunnel, death burst/timing,
  ReplayV1, M5 golden, M8 structure. Death code NOT touched.

## 3. Non-goals

Music/BPM sync, M9, new modes/mechanics, fluid simulation, AI, merge to
main, "fixing" routing with arbitrary kills, touching gravity-flip
camera feel, weakening any existing test.

## 4. Definition of Done

- [ ] `npm run verify` green (typecheck + lint + tests + build).
- [ ] Gauntlet driver still completes (same anchor tick unless a
  documented content reason moves it), 0 deaths, replay VERIFIED.
- [ ] Portal tests: through-opening fires / 2.5 u-beside-the-ring does
  NOT fire (gravity + mode + speed + teleport mechanism) / missed-gate
  geometric failure / validator rejects oversized volumes /
  gauntlet validates clean.
- [ ] Lava tests: gauntlet validates clean under the protrusion rule /
  vent-over-fall alignment pinned / view structure bounded.
- [ ] Chomper view tests updated (anatomy + budget + chomp cycle).
- [ ] Spider camera unit tests (glide vs legacy whip, same endpoints,
  gravity-flip path byte-identical).
- [ ] Browser M8.2 section green + zero console/page errors:
  lava source/fall/river, gate inside/outside, spider swap, chomper,
  replay verified.
- [ ] Screenshots for every feedback item (evidence, not proof).
- [ ] Docs: this spec, ROADMAP, ARCHITECTURE/GAME_DESIGN where behavior
  truly changed. No human approval claimed.
