/**
 * Deterministic level fingerprint (M5): binds a replay to the exact
 * gameplay-authoritative level content it was recorded against.
 *
 * Hashed content (exact Float64 binary encodings, fixed field order, arrays
 * in definition order — array order IS gameplay-authoritative because
 * collider ids and collision tie-breaks derive from it):
 *   start, startLaneIndex, laneCenters, baseForwardSpeed,
 *   startSpeedMultiplier, finishZ, deathY, deathYMax, startGravityMode,
 *   gravityPortals, speedPortals, jumpPads, jumpOrbs, gravityOrbs,
 *   teleportPortals (M7.2, only when present — absent writes zero bytes),
 *   lava (M8A, only when present — absent writes zero bytes),
 *   modePortals (M8C, only when present — absent writes zero bytes),
 *   chompers (M8D, only when present — absent writes zero bytes),
 *   solids, hazards, id.
 *
 * Explicitly EXCLUDED (not gameplay-relevant):
 *   displayName (UX label), hazard `visual` + `mount` hints, teleport
 *   `style`, visualSetpieces, theme, visualSequence, rhythmCues
 *   (all renderer-only).
 * Changing renderer-only data therefore keeps old replays compatible.
 */

import { DeterministicHasher } from './hash';
import type { GravityMode } from '../player/playerState';
import type {
  ChomperDef,
  GravityOrbDef,
  GravityPortalDef,
  JumpOrbDef,
  JumpPadDef,
  LavaVolumeDef,
  LevelDefinition,
  LevelHazard,
  LevelSolid,
  PlayerModePortalDef,
  SpeedPortalDef,
  TeleportPortalDef,
} from '../level/levelDefinition';
interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const writeVec3 = (h: DeterministicHasher, v: Vec3Like): void => {
  h.writeFloat64(v.x);
  h.writeFloat64(v.y);
  h.writeFloat64(v.z);
};

const writeGravityMode = (h: DeterministicHasher, mode: GravityMode | undefined): void => {
  // M8B four-way codes: floor 0 / ceiling 1 (unchanged) + leftWall 2 /
  // rightWall 3 (appended) — pre-M8B levels hash byte-identically.
  h.writeInt32(mode === 'ceiling' ? 1 : mode === 'leftWall' ? 2 : mode === 'rightWall' ? 3 : 0);
};

const writePortal = (h: DeterministicHasher, p: GravityPortalDef): void => {
  h.writeString(p.id);
  h.writeFloat64(p.z);
  writeGravityMode(h, p.target);
};

const writeSpeedPortal = (h: DeterministicHasher, p: SpeedPortalDef): void => {
  h.writeString(p.id);
  h.writeFloat64(p.z);
  h.writeFloat64(p.multiplier);
};

const writePad = (h: DeterministicHasher, p: JumpPadDef): void => {
  h.writeString(p.id);
  writeVec3(h, p.center);
  writeVec3(h, p.halfExtents);
  writeGravityMode(h, p.surface);
  h.writeFloat64(p.impulse);
};

const writeOrb = (h: DeterministicHasher, o: GravityOrbDef): void => {
  h.writeString(o.id);
  writeVec3(h, o.center);
  writeVec3(h, o.halfExtents);
};

const writeJumpOrb = (h: DeterministicHasher, o: JumpOrbDef): void => {
  writeOrb(h, o);
  h.writeFloat64(o.impulse);
};

const writeTeleport = (h: DeterministicHasher, t: TeleportPortalDef): void => {
  // Gameplay discontinuity: id + entry plane + exit + lane handoff.
  // Presentation-only `style` is deliberately excluded (restyling a gate
  // keeps old replays compatible — same pattern as hazard visual/mount).
  // M8A bounded entry volumes are gameplay (they change the trigger), so
  // they ARE fingerprinted — conditionally, so volume-less teleports hash
  // exactly as before.
  h.writeString(t.id);
  h.writeFloat64(t.entryZ);
  const hasVolume = t.entryCenter !== undefined && t.entryHalfExtents !== undefined;
  h.writeBoolean(hasVolume);
  if (hasVolume) {
    writeVec3(h, t.entryCenter ?? { x: 0, y: 0, z: 0 });
    writeVec3(h, t.entryHalfExtents ?? { x: 0, y: 0, z: 0 });
  }
  writeVec3(h, t.exit);
  h.writeInt32(t.exitLaneIndex);
};

const writeLava = (h: DeterministicHasher, l: LavaVolumeDef): void => {
  h.writeString(l.id);
  writeVec3(h, l.center);
  writeVec3(h, l.halfExtents);
  h.writeInt32(l.role === 'pool' ? 0 : l.role === 'fall' ? 1 : 2);
};

const writeChomper = (h: DeterministicHasher, c: ChomperDef): void => {
  h.writeString(c.id);
  writeVec3(h, c.dormant);
  h.writeFloat64(c.triggerZ);
  h.writeInt32(c.lungeDirection);
  h.writeFloat64(c.lungeDistance);
  h.writeInt32(c.telegraphTicks);
  h.writeInt32(c.lungeTicks);
  writeVec3(h, c.halfExtents);
};

const writeModePortal = (h: DeterministicHasher, m: PlayerModePortalDef): void => {
  h.writeString(m.id);
  h.writeFloat64(m.z);
  h.writeInt32(m.target === 'cube' ? 0 : m.target === 'ship' ? 1 : 2);
};

const writeSolid = (h: DeterministicHasher, s: LevelSolid): void => {
  writeVec3(h, s.center);
  writeVec3(h, s.halfExtents);
};

const writeHazard = (h: DeterministicHasher, hz: LevelHazard): void => {
  // `visual` and `mount` are renderer hints — excluded deliberately (the
  // spike orientation fix and any restyling keep old replays compatible).
  h.writeInt32(hz.kind === 'hazard' ? 0 : 1);
  writeVec3(h, hz.center);
  writeVec3(h, hz.halfExtents);
};

const hasher = new DeterministicHasher();

/**
 * Canonical fingerprint of the gameplay-authoritative level content
 * (16 hex chars). Pure: same LevelDefinition -> same string, always.
 */
export const computeLevelFingerprint = (def: LevelDefinition): string => {
  const h = hasher;
  h.reset();

  h.writeString(def.id);
  writeVec3(h, def.start);
  h.writeInt32(def.startLaneIndex);
  h.writeInt32(def.laneCenters.length);
  for (const lane of def.laneCenters) h.writeFloat64(lane);
  h.writeFloat64(def.baseForwardSpeed);
  h.writeFloat64(def.startSpeedMultiplier ?? 1);
  h.writeFloat64(def.finishZ);
  h.writeFloat64(def.deathY);
  if (def.deathYMax === undefined) {
    h.writeBoolean(false);
  } else {
    h.writeBoolean(true);
    h.writeFloat64(def.deathYMax);
  }
  // M8B side death bounds + wall lanes (optional, level-owned): bytes are
  // written ONLY when present (domain-separated), so pre-M8B levels hash
  // byte-identically and the golden fixture stays green.
  if (def.deathXMin !== undefined || def.deathXMax !== undefined) {
    h.writeString('sideBounds:v1');
    h.writeBoolean(def.deathXMin !== undefined);
    if (def.deathXMin !== undefined) h.writeFloat64(def.deathXMin);
    h.writeBoolean(def.deathXMax !== undefined);
    if (def.deathXMax !== undefined) h.writeFloat64(def.deathXMax);
  }
  if (def.wallLaneCenters !== undefined) {
    h.writeString('wallLanes:v1');
    h.writeInt32(def.wallLaneCenters.length);
    for (const lane of def.wallLaneCenters) h.writeFloat64(lane);
  }
  writeGravityMode(h, def.startGravityMode);

  const gravityPortals = def.gravityPortals ?? [];
  h.writeInt32(gravityPortals.length);
  for (const p of gravityPortals) writePortal(h, p);
  const speedPortals = def.speedPortals ?? [];
  h.writeInt32(speedPortals.length);
  for (const p of speedPortals) writeSpeedPortal(h, p);
  const jumpPads = def.jumpPads ?? [];
  h.writeInt32(jumpPads.length);
  for (const p of jumpPads) writePad(h, p);
  const jumpOrbs = def.jumpOrbs ?? [];
  h.writeInt32(jumpOrbs.length);
  for (const o of jumpOrbs) writeJumpOrb(h, o);
  const gravityOrbs = def.gravityOrbs ?? [];
  h.writeInt32(gravityOrbs.length);
  for (const o of gravityOrbs) writeOrb(h, o);
  // M7.2 teleport portals: gameplay discontinuity. Conditionally extended
  // (bytes are written ONLY when teleports exist, behind a domain
  // separator): levels without teleports hash byte-identically to before,
  // so every pre-M7.2 replay stays compatible (golden fixture pinned).
  const teleports = def.teleportPortals ?? [];
  if (teleports.length > 0) {
    h.writeString('teleports:v1');
    h.writeInt32(teleports.length);
    for (const t of teleports) writeTeleport(h, t);
  }
  // M8A lethal lava: gameplay volumes. Conditionally extended (bytes are
  // written ONLY when lava exists, behind a domain separator): levels
  // without lava hash byte-identically to before, so every pre-M8A replay
  // stays compatible (golden fixture pinned).
  const lava = def.lava ?? [];
  if (lava.length > 0) {
    h.writeString('lava:v1');
    h.writeInt32(lava.length);
    for (const l of lava) writeLava(h, l);
  }
  // M8C mode portals: gameplay transitions. Same conditional pattern.
  const modePortals = def.modePortals ?? [];
  if (modePortals.length > 0) {
    h.writeString('modes:v1');
    h.writeInt32(modePortals.length);
    for (const m of modePortals) writeModePortal(h, m);
  }
  // M8D chompers: gameplay hazards. Same conditional pattern (gameplay
  // fields only — chainAnchor is visual-only and excluded).
  const chompers = def.chompers ?? [];
  if (chompers.length > 0) {
    h.writeString('chompers:v1');
    h.writeInt32(chompers.length);
    for (const c of chompers) writeChomper(h, c);
  }
  // visualSetpieces: presentation-only, never fingerprinted (like theme /
  // visualSequence / rhythmCues / hazard visual+mount / teleport style).

  h.writeInt32(def.solids.length);
  for (const s of def.solids) writeSolid(h, s);
  h.writeInt32(def.hazards.length);
  for (const hz of def.hazards) writeHazard(h, hz);

  return h.digest();
};
