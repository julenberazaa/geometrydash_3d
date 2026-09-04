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
 *   solids, hazards, id.
 *
 * Explicitly EXCLUDED (not gameplay-relevant):
 *   displayName (UX label) and hazard `visual` hints + theme (renderer-only).
 * Changing renderer-only data therefore keeps old replays compatible.
 */

import { DeterministicHasher } from './hash';
import type {
  GravityOrbDef,
  GravityPortalDef,
  JumpOrbDef,
  JumpPadDef,
  LevelDefinition,
  LevelHazard,
  LevelSolid,
  SpeedPortalDef,
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

const writeGravityMode = (h: DeterministicHasher, mode: 'floor' | 'ceiling' | undefined): void => {
  h.writeInt32(mode === 'ceiling' ? 1 : 0);
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

const writeSolid = (h: DeterministicHasher, s: LevelSolid): void => {
  writeVec3(h, s.center);
  writeVec3(h, s.halfExtents);
};

const writeHazard = (h: DeterministicHasher, hz: LevelHazard): void => {
  // `visual` is a renderer hint — excluded deliberately.
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

  h.writeInt32(def.solids.length);
  for (const s of def.solids) writeSolid(h, s);
  h.writeInt32(def.hazards.length);
  for (const hz of def.hazards) writeHazard(h, hz);

  return h.digest();
};
