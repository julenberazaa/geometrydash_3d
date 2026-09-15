# M8.3 — Lava Motion, Chomper Style Match, Spider Camera Continuity

Follow-up corrective milestone on `feature/m8-2-lava-portal-spider-chomper-polish`
(new branch `feature/m8-3-lava-motion-chomper-style-spider-camera`; `main`
untouched). Human verdict on M8.2: lava still static/dull; Chomper still
doesn't match its reference; Spider swap still feels like a teleport/reload.
Wall-lane, ship tunnel, death readability stay preserved (no changes there).

## 1. Root causes (audited, not assumed)

- **R1 lava static (presentation):** every lava mesh is build-time static
  geometry. The ONLY motion is `setLavaPulse`, a global ±0.35
  emissiveIntensity breathe on two shared materials — uniform, directionless,
  no traveling energy. Nothing scrolls, nothing descends, nothing convects.
- **R2 Chomper mismatch (presentation):** the M8.2 head is a box bolted onto
  a separate body (elongated two-mass silhouette); the maw is a thin hot
  slab, not a cavity; eyes are small glow spheres under a brow (ear-like
  read); teeth are small cones; chain is dark. The reference is ONE mottled
  magma ball whose front IS a huge dark mouth ringed with chunky block
  teeth, white square side eyes, and a glowing lava chain + weight cube.
- **R3 Spider cut (REAL camera bug):** `RendererHost.applyFrame` treats ANY
  >5 u per-frame player displacement as a teleport and calls
  `chaseCamera.snapTo`. A Spider floor↔ceiling swap moves ~5 u in Y in one
  tick, so EVERY swap hard-cuts the camera to the post-swap framing; the
  M8.2 glide envelope arms AFTER the cut and merely eases residual error.
  The exponential rate was never the cut — the snap was. Proof path:
  gravity-portal flips (continuous motion) never snap; Spider swaps always do.

## 2. Scope

- A. Lava: stronger glow + a `LevelView.updateLava(dt)` convection/flow
  animation (crust drift, descending fall pulse, splash/drip response).
  Shared geo/mats only; zero per-frame allocation; render-dt driven
  (pause freezes). Lethal boxes + authoring rules unchanged.
- B. Chomper view-only redesign to the reference (single mottled head-ball,
  cavity maw, block teeth, square white/pupil eyes, hot chain + weight
  cube). Sim byte-identical. Same 26-mesh budget, same 8 geometries.
- C. Spider camera: skip the teleport-snap on Spider-context gravity
  swaps; `noteSpiderSwap` captures the pre-swap pose and the envelope
  blends it to the moving target with zero initial velocity (smootherstep
  over 0.55 s). Teleport portals, respawn, and R-teleport still snap.
- Non-goals: music/BPM, M9, new modes/mechanics, refactors, touching
  death/wall-lane/ship-tunnel/portal-bounds behavior.

## 3. Tests / QA

- `spiderCamera`: first-frame stillness, peak-displacement reduction vs
  legacy, same endpoints, snap cuts, legacy rates resume after the window.
- `lava`: motion actually displaces meshes, dt=0 freezes, mesh budget
  unchanged, stronger pulse pinned.
- `chomperView`: new anatomy within the same 26 budget, chomp cycle kept.
- Browser: M8 slice stays green; new M8.3 checks — lava frames differ
  across time (alive), chomper portrait, spider-swap max per-frame eye
  step below cut threshold (continuity proof), replay VERIFIED.

## 4. Definition of Done

- [ ] `npm run verify` green (typecheck + lint + tests + build).
- [ ] Gauntlet driver still completes via real inputs, 0 deaths, replay
  VERIFIED; ReplayV1 unchanged; golden fixture intact.
- [ ] Lava reads as moving/glowing/viscous in screenshots AND across
  frames (no dead orange block).
- [ ] Chomper reads as the reference: magma ball, huge maw, block teeth,
  square eyes, lava chain + cube.
- [ ] Spider swap has no cut: pose-continuous, zero initial velocity,
  framing rules + Floor/Ceiling parity intact.
- [ ] M8.2 goods preserved (wall-lane, ship tunnel, death, portal bounds).
- [ ] Browser M8 slice green + zero console/page errors with `m83-*`
  evidence.
- [ ] Docs: this spec, ROADMAP, ARCHITECTURE, GAME_DESIGN §7.5 creature
  description. No human approval claimed.
