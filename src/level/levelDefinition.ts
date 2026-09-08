import type { ColliderKind } from '../collision/collider';
import type { GravityMode } from '../player/playerState';
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
 * Jump pad (M4): a PASSIVE trigger volume mounted on a gravity surface.
 * Contacting/crossing the volume replaces the player's velocity component
 * along the pad's surface normal (+Y floor / −Y ceiling) with `impulse`.
 * Never reads input; one activation per attempt.
 */
export interface JumpPadDef {
  /** Stable identifier (debug/QA). */
  id: string;
  /** Trigger volume center in world space. */
  center: Vec3;
  /** Trigger volume half extents. */
  halfExtents: Vec3;
  /** Which surface the pad is mounted on (fixes the impulse direction). */
  surface: GravityMode;
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
}
