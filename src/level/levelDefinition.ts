import type { ColliderKind } from '../collision/collider';
import type { GravityMode, PlayerMode } from '../player/playerState';
import type { RhythmCue } from '../visuals/rhythmCues';
import type { Vec3 } from '../core/math';

/**
 * Declarative level content. Engine behavior lives in code; THIS is data.
 * A future level = a new file here + zero engine changes (spec §21).
 */

/**
 * Gravity transition portal (M3): a deterministic forward-crossing plane at
 * world Z spanning the route. When the player's Z crosses `z` in the forward
 * direction, gravity switches to `target`. One-shot per attempt by
 * construction (forward motion never revisits a plane; respawn re-arms it).
 */
export interface GravityPortalDef {
  /** Stable identifier (debug/QA). */
  id: string;
  /** World Z of the crossing plane. */
  z: number;
  /** Gravity mode to switch to when crossed. */
  target: GravityMode;
}

/**
 * Player-mode portal (M8C): switches cube/ship/spider on forward crossing.
 */
export interface PlayerModePortalDef {
  /** Stable identifier (debug/QA). */
  id: string;
  /** World Z of the crossing plane. */
  z: number;
  /** Player mode to switch to when crossed. */
  target: PlayerMode;
}

/**
 * Speed tier portal (M4): a deterministic forward-crossing plane at world Z.
 * Crossing it forward sets the authoritative speed multiplier — no teleport,
 * no impulse. Exactly-once per attempt by construction (forward motion never
 * revisits a plane; respawn re-arms it).
 */
export interface SpeedPortalDef {
  /** Stable identifier (debug/QA). */
  id: string;
  /** World Z of the crossing plane. */
  z: number;
  /** Speed multiplier tier applied when crossed (content tiers: 0.5/1/2/3/4). */
  multiplier: number;
}

/**
 * Support surface for mounted gameplay/rendering objects (M8B): the
 * surface a pad/spike is attached to. Impulse/launch direction is ALWAYS
 * the surface normal (away from the support): floor +Y, ceiling −Y,
 * leftWall −X (away from the +X wall), rightWall +X.
 */
export type MountSurface = 'floor' | 'ceiling' | 'leftWall' | 'rightWall';

/**
 * Jump pad (M4): a PASSIVE trigger volume mounted on a gravity surface.
 * Contacting/crossing the volume replaces the player's velocity component
 * along the pad's surface normal with `impulse`. Never reads input; one
 * activation per attempt.
 */
export interface JumpPadDef {
  /** Stable identifier (debug/QA). */
  id: string;
  /** Trigger volume center in world space. */
  center: Vec3;
  /** Trigger volume half extents. */
  halfExtents: Vec3;
  /** Which surface the pad is mounted on (fixes the impulse direction). */
  surface: MountSurface;
  /** Launch speed along the surface normal, units/s (explicit per-pad tuning). */
  impulse: number;
}

/**
 * Shared shape of the ACTIVE interaction windows (jump orb, gravity orb):
  * activating requires a press edge of the logical jump action during a fixed
 * step whose swept path overlaps the window. One-shot per attempt.
 */
export interface InteractionOrbDef {
  /** Stable identifier (debug/QA). */
  id: string;
  /** Activation window center in world space. */
  center: Vec3;
  /** Activation window half extents (AABB; visuals stay slightly smaller). */
  halfExtents: Vec3;
}

/** Jump orb (M4): press edge inside the window → impulse away from the
 *  CURRENT gravity surface along its normal; works airborne. */
export interface JumpOrbDef extends InteractionOrbDef {
  /** Launch speed along the current surface normal, units/s. */
  impulse: number;
}

/** Gravity orb (M4): press edge inside the window → Floor ↔ Ceiling flip
 *  through the SAME transition semantics as M3 gravity portals (position and
 *  all velocity preserved, support cleared). Structurally identical to the
 *  shared orb window shape; a distinct alias keeps level data self-describing. */
export type GravityOrbDef = InteractionOrbDef;

/**
 * Teleport portal (M7.2): a deterministic paired spatial discontinuity.
 * Crossing the entry plane in the forward direction instantly relocates the
 * Cube to the authored `exit` — same gravity mode, same speed multiplier,
 * lateral velocity preserved for flow, vertical velocity zeroed for a clean
 * re-entry, lane intent set to `exitLaneIndex`, grounded/support cleared.
 * Exactly once per attempt (respawn re-arms); a lethal step always wins over
 * the teleport (lethal checks precede it); the skipped world-space interval
 * is NEVER interpreted as traversed (no crossed-interval portal firing).
 */
export interface TeleportPortalDef {
  /** Stable identifier (debug/QA). */
  id: string;
  /** World Z of the entry crossing plane. */
  entryZ: number;
  /**
   * OPTIONAL bounded entry volume (M8A). When present, the teleport fires
   * only when the swept step path overlaps this box — flying past the
   * visual ring without passing through it can NOT trigger it. When
   * absent, the legacy forward entry-plane crossing applies (pre-M8A
   * content stays compatible). New content must use the bounded volume.
   */
  entryCenter?: Vec3;
  /** Half extents of the bounded entry volume (required with entryCenter). */
  entryHalfExtents?: Vec3;
  /** Authored destination (hitbox center after the jump). */
  exit: Vec3;
  /** Lane intent after the jump (explicit authored handoff). */
  exitLaneIndex: number;
  /**
   * Presentation-only visual variant (renderer-only like hazard `visual`:
   * `computeLevelFingerprint()` never reads it, so restyling a gate keeps
   * old replays compatible). Omitted = default violet gate.
   */
  style?: 'gate' | 'maw';
}

/**
 * Authored lava gameplay volume (M8A): LAVA IS GAMEPLAY — touching any lava
 * volume is instant death (cause `lava`, same swept-path CCD as hazards).
 *
 * Visual role vocabulary (Minecraft-like physical logic, authored — never a
 * fluid simulation):
 * - `source`: a glowing vent/opening visibly attached to solid geometry.
 * - `fall`: a dense blocky downward stream from a source into a pool (or
 *   continuing below the lethal world bounds).
 * - `pool`: a contained basin surface bounded by surrounding solid geometry.
 *
 * Every composition must obey the sourced/contained contract enforced by
 * `validateLavaAuthoring` (see `src/level/lavaAuthoring.ts`): no floating
 * slabs. Registered as lethal hazard colliders (`lava-<id>`) by
 * `levelRuntime`; fingerprinted conditionally (levels without lava hash
 * byte-identically to before).
 */
export interface LavaVolumeDef {
  /** Stable identifier (debug/QA; collider id becomes `lava-<id>`). */
  id: string;
  /** Lethal gameplay box center in world space. */
  center: Vec3;
  /** Lethal gameplay box half extents. */
  halfExtents: Vec3;
  /** Visual/physical role in the source → fall → pool chain. */
  role: 'pool' | 'fall' | 'source';
}

/**
 * Presentation-only decorative setpiece (M7.2, e.g. a monster-like guardian
 * silhouette around a teleport gate; M7.3 adds lava). NEVER gameplay: no
 * collision, no AI, no movement, no trigger. Renderer-only: excluded from
 * the gameplay fingerprint and from replays. If it looks landable it must
 * BE landable — setpieces live outside the route corridor (see
 * GAME_DESIGN.md) or below it (lava reads as void dressing).
 *
 * M8A: lava setpieces remain the POOL SURFACE presentation; lethality now
 * lives in `LavaVolumeDef` gameplay boxes (see above).
 */
export interface VisualSetpieceDef {
  /** Stable identifier (debug/QA). */
  id: string;
  /**
   * Setpiece vocabulary (presentation-only):
   * - `guardian`: dark creature silhouette with warm eyes (M7.2), now with
   *   a jaw, teeth and trailing chain links (M7.3 chain-chomp read).
   * - `lava`: glowing hazard-orange basin/river surface marking void
   *   danger (M7.3). Lives below the route; falling in still dies through
   *   the normal void bound — no gameplay, pure environmental menace.
   */
  kind: 'guardian' | 'lava';
  /** World-space center of the silhouette volume. */
  center: Vec3;
  /** Silhouette half extents (eyes derive from these — no extra fields). */
  halfExtents: Vec3;
}

/** Visual theme values consumed by the rendering layer only. */
export interface LevelTheme {
  background: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  platform: number;
  platformTop: number;
  edge: number;
  hazard: number;
}

/**
 * Presentation-only per-field overrides for ONE visual timeline section
 * (M6C1). Every field is optional; absent fields inherit the resolved
 * production base theme. There is deliberately NO player / hazard entry:
 * the cyan player anchor and the warm hazard identity stay stable across
 * every section (structural prohibition, pinned by test).
 *
 * Renderer-only like LevelTheme: `computeLevelFingerprint()` never reads
 * this, so authoring proof sections keeps committed replays compatible.
 */
export interface VisualSectionOverride {
  background?: number;
  fogColor?: number;
  fogNear?: number;
  fogFar?: number;
  routeBody?: number;
  /** Playable surface plane accent (route top inset). */
  routeSurface?: number;
  /** Neon edge-rail language. */
  routeAccent?: number;
  /** Environment dressing multiplier (0..2, 1 = base). */
  environmentIntensity?: number;
  /** Bloom overrides — always re-clamped through BLOOM_CONTRACT. */
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  /** Tone-mapping exposure override (clamped 0.5..2 like the theme). */
  exposure?: number;
  /** M6B juice multipliers (0..2, 1 = base; pool capacities untouched). */
  vfxIntensity?: number;
  streakIntensity?: number;
}

/**
 * ONE presentation section of a level's visual timeline (M6C1).
 * Identity is purely positional: the active section is the last one with
 * `startZ <= playerZ` (forward-only motion + respawn-to-start make this
 * robust; `endZ` documents intent and drives section progress). No clocks,
 * no frame counts — the same gameplay location always resolves the same
 * section on every machine.
 */
export interface VisualSection {
  /** Stable identifier (debug/QA probes). */
  id: string;
  /** World Z where this section takes over. */
  startZ: number;
  /** World Z where this section conceptually ends (progress + docs). */
  endZ: number;
  /** Blend distance in world units from startZ (default 10). */
  blendIn?: number;
  overrides: VisualSectionOverride;
}

/**
 * A level's visual timeline (M6C1): an ordered list of presentation
 * sections. Optional per level; absent = the M6A+M6B baseline everywhere.
 * Presentation-only: excluded from the level fingerprint (like `theme`).
 */
export interface VisualSequenceDefinition {
  sections: VisualSection[];
}

/** One declarative solid box. */
export interface LevelSolid {
  kind?: Extract<ColliderKind, 'solid'>;
  center: Vec3;
  halfExtents: Vec3;
}

/** One declarative hazard box. */
export interface LevelHazard {
  kind: Extract<ColliderKind, 'hazard' | 'killFront'>;
  center: Vec3;
  halfExtents: Vec3;
  /** Visual style hint consumed by rendering (e.g. spike vs block). */
  visual?: 'spike' | 'block';
  /**
   * Presentation-only support surface for the hazard visual (M7.1,
   * extended M8B): the base attaches to the support and the tip points
   * AWAY from it along the surface normal (floor +Y, ceiling −Y,
   * leftWall −X, rightWall +X). Renderer-only like `visual`:
   * `computeLevelFingerprint()` never reads it and gameplay colliders
   * are unchanged, so annotating old replays' levels keeps them
   * compatible. Omitted = 'floor' (existing content renders
   * byte-identically).
   */
  mount?: MountSurface;
}

export interface LevelDefinition {
  id: string;
  displayName: string;
  /** World-space player start (hitbox center). */
  start: Vec3;
  /** Initial lane index. */
  startLaneIndex: number;
  /**
   * Lane centers along X, ordered by lane index. Convention (M1.1): index
   * increases toward screen-right (world −X under the +Z chase camera), so
   * index 0 is the screen-left lane. Length defines laneCount; do not
   * hardcode 3 in engine code.
   */
  laneCenters: number[];
  /**
   * Lane centers along world Y for wall-gravity surfaces (M8B), ordered
   * by lane index with the SAME increasing-up convention as the wall
   * laneAxis (+Y) on both walls. Optional: when a level uses wall gravity
   * without declaring these, the runtime mirrors `laneCenters` about the
   * corridor mid-plane (y = 3 − c per center c — the M3.3 mid-plane), so
   * standard 3-lane content gets vertical lanes [0.4, 3, 5.6] for free.
   * Length SHOULD match `laneCenters` (laneCount is still single-owner).
   */
  wallLaneCenters?: number[];
  /** Base forward speed for this level (the 1× tier; M4 speed authority). */
  baseForwardSpeed: number;
  /**
   * Starting speed multiplier tier (M4, default 1). Speed portals mutate the
   * authoritative multiplier during the attempt; respawn restores this.
   */
  startSpeedMultiplier?: number;
  /** Z beyond which the run is complete. */
  finishZ: number;
  /** Death plane relative to world Y; falling below = death. */
  deathY: number;
  /**
   * Upper death bound (M3): rising above this world Y = death. Optional for
   * backward compatibility; required for levels with ceiling gravity so
   * upward void falls terminate fairly. Never an engine hardcoded height.
   */
  deathYMax?: number;
  /**
   * Side death bounds (M8B, optional, level-owned): falling outward past
   * these world X coordinates = death. Needed for wall-gravity content
   * where the outward fall runs along X instead of Y. Absent = unbounded
   * (backward compatible). Never an engine hardcoded width.
   */
  deathXMin?: number;
  deathXMax?: number;
  /**
   * Starting gravity mode for this level (default 'floor' when omitted).
   * Existing levels remain valid unchanged.
   */
  startGravityMode?: GravityMode;
  /**
   * Gravity transition portals (M3), processed in ascending Z order.
   * Optional; levels without portals behave exactly as before.
   */
  gravityPortals?: GravityPortalDef[];
  /**
   * Speed tier portals (M4), processed in ascending Z order (before gravity
   * portals at equal Z — documented tie-break). Optional; levels without
   * speed portals run at the start multiplier forever.
   */
  speedPortals?: SpeedPortalDef[];
  /**
   * Jump pads (M4): passive contact-activated impulse volumes.
   * Optional; levels without pads behave exactly as before.
   */
  jumpPads?: JumpPadDef[];
  /**
   * Jump orbs (M4): press-edge-activated impulse windows, usable airborne.
   * Optional.
   */
  jumpOrbs?: JumpOrbDef[];
  /**
   * Gravity orbs (M4): press-edge-activated Floor ↔ Ceiling flips through the
   * M3 portal transition semantics. Optional.
   */
  gravityOrbs?: GravityOrbDef[];
  /**
   * Teleport portals (M7.2), processed in ascending entryZ order.
   * Optional; levels without teleports behave exactly as before.
   */
  teleportPortals?: TeleportPortalDef[];
  /**
   * Player-mode portals (M8C): a deterministic forward-crossing plane at
   * world Z. Crossing it switches the authoritative player mode
   * (cube/ship/spider) exactly once per attempt: forward flow preserved,
   * grounded/support cleared, velocity along the current gravity axis
   * zeroed for a clean handoff. One-shot per attempt (respawn re-arms).
   * Fingerprinted conditionally (levels without mode portals hash
   * byte-identically to before).
   */
  modePortals?: PlayerModePortalDef[];
  /**
   * Lethal lava gameplay volumes (M8A). Optional; levels without lava
   * behave exactly as before. See `LavaVolumeDef`.
   */
  lava?: LavaVolumeDef[];
  /**
   * Presentation-only decorative setpieces (M7.2). Renderer-only: never
   * read by simulation, collision, replay, or the level fingerprint.
   * Absent = no setpieces.
   */
  visualSetpieces?: VisualSetpieceDef[];
  solids: LevelSolid[];
  hazards: LevelHazard[];
  theme: LevelTheme;
  /**
   * Optional presentation timeline (M6C1): position-driven visual sections
   * (background/fog/route/bloom/exposure/juice modulation). Renderer-only:
   * never read by simulation, collision, replay, or the level fingerprint.
   * Absent = the M6A+M6B baseline for the whole level.
   */
  visualSequence?: VisualSequenceDefinition;
  /**
   * Optional beat-ready rhythm cues (M7.1): semantic music-mapping markers
   * bound to authored forward positions. Presentation-only: never read by
   * simulation, collision, replay, or the level fingerprint; no audio ships.
   * Absent = no cues.
   */
  rhythmCues?: RhythmCue[];
}
