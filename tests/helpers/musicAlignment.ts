import { GameSimulation } from '../../src/game/GameSimulation';
import type { LevelDefinition } from '../../src/level/levelDefinition';
import type { PhysicalInputSnapshot } from '../../src/input/InputSystem';
import { interpretPhysicalInput } from '../../src/input/InputSystem';
import { beatAtTime, beatTime } from '../../src/audio/musicTrack';

/**
 * M9 music-alignment telemetry (test-side only — pure observation, no
 * engine changes). Drives a scripted run and records timestamped gameplay
 * events (pads, orbs, gravity/speed/mode portals, teleports, Chomper
 * lunges, Spider snaps, major jumps, finish) so the authored
 * gameplay↔music alignment can be measured against the Gravity Lessons
 * beat grid. Gameplay never reads beats; this only REPORTS how well the
 * authored positions land on them.
 */

export type MusicEventType =
  | 'jump'
  | 'spiderSnap'
  | 'pad'
  | 'jumpOrb'
  | 'gravityOrb'
  | 'gravityPortal'
  | 'speedPortal'
  | 'modePortal'
  | 'teleport'
  | 'chomperLunge'
  | 'finish';

export interface MusicEvent {
  tick: number;
  /** Deterministic sim seconds (== music target when offset is 0). */
  time: number;
  z: number;
  type: MusicEventType;
  id: string;
}

export interface AlignedEvent extends MusicEvent {
  nearestBeat: number;
  /** eventTime − beatTime(nearestBeat), seconds (signed). */
  beatError: number;
  authoredBeat: number | null;
  /** eventTime − beatTime(authoredBeat), null when unmapped. */
  authoredError: number | null;
}

export const collectMusicEvents = (
  def: LevelDefinition,
  inputFor: (z: number, sim: GameSimulation) => Readonly<PhysicalInputSnapshot>,
  opts: { maxTicks?: number; trackOffset?: number } = {},
): { events: MusicEvent[]; ticks: number; status: string } => {
  const sim = new GameSimulation(def);
  const maxTicks = opts.maxTicks ?? 30000;
  const events: MusicEvent[] = [];
  // One-shot per id per run: bounded trigger volumes overlap the swept
  // path for several ticks (the sim re-fires counts while inside), but
  // musically each portal/pad/orb/teleport/chomper is ONE authored moment.
  const fired = new Set<string>();
  const fireOnce = (type: MusicEventType, id: string, tick: number, time: number, z: number): void => {
    const key = `${type}:${id}`;
    if (fired.has(key)) return;
    fired.add(key);
    events.push({ tick, time, z, type, id });
  };
  let lastPortal = sim.portalTransitionCount;
  let lastSpeed = sim.speedPortalCount;
  let lastMode = sim.modeTransitionCount;
  let lastTeleport = sim.teleportEventCount;
  let lastPads = sim.padActivationCount;
  let lastOrbs = sim.orbActivationCount;
  const chomperPhases = sim.chomperStates.map((s) => s.phase);
  let tick = 0;
  for (; tick < maxTicks; tick++) {
    if (sim.status !== 'running') break;
    const z = sim.player.position.z;
    const time = tick / 120 + (opts.trackOffset ?? 0);
    const input = inputFor(z, sim);
    const logical = interpretPhysicalInput(input, sim.gravityMode);
    if (logical.jump.pressedThisStep) {
      events.push({
        tick, time, z,
        type: sim.playerMode === 'spider' ? 'spiderSnap' : 'jump',
        id: `jump@${z.toFixed(1)}`,
      });
    }
    if (sim.portalTransitionCount !== lastPortal) {
      lastPortal = sim.portalTransitionCount;
      fireOnce('gravityPortal', sim.lastPortalId ?? 'portal?', tick, time, z);
    }
    if (sim.speedPortalCount !== lastSpeed) {
      lastSpeed = sim.speedPortalCount;
      fireOnce('speedPortal', sim.lastSpeedPortalId ?? 'speed?', tick, time, z);
    }
    if (sim.modeTransitionCount !== lastMode) {
      lastMode = sim.modeTransitionCount;
      fireOnce('modePortal', sim.lastModePortalId ?? 'mode?', tick, time, z);
    }
    if (sim.teleportEventCount !== lastTeleport) {
      lastTeleport = sim.teleportEventCount;
      fireOnce('teleport', sim.lastTeleportId ?? 'teleport?', tick, time, z);
    }
    if (sim.padActivationCount !== lastPads) {
      lastPads = sim.padActivationCount;
      fireOnce('pad', sim.lastInteraction.id, tick, time, z);
    }
    if (sim.orbActivationCount !== lastOrbs) {
      lastOrbs = sim.orbActivationCount;
      const kind = sim.lastInteraction.kind;
      fireOnce(kind === 'gravityOrb' ? 'gravityOrb' : 'jumpOrb', sim.lastInteraction.id, tick, time, z);
    }
    for (let i = 0; i < sim.chomperStates.length; i++) {
      const st = sim.chomperStates[i];
      if (st !== undefined && st.phase === 'lunging' && chomperPhases[i] !== 'lunging') {
        fireOnce('chomperLunge', sim.level.chompers[i]?.id ?? `chomper-${String(i)}`, tick, time, z);
      }
      chomperPhases[i] = st?.phase ?? 'dormant';
    }
    sim.update(input);
  }
  if (sim.status === 'finished') {
    events.push({
      tick, time: tick / 120 + (opts.trackOffset ?? 0),
      z: sim.player.position.z, type: 'finish', id: 'finish',
    });
  }
  return { events, ticks: tick, status: sim.status };
};

/**
 * Align events to the beat grid. `authoredBeats` maps event id (or
 * `${type}:${id}`) to the intended beat index; events without a mapping
 * report the nearest-beat error only (diagnostic, never a contract).
 */
export const alignEvents = (
  events: readonly MusicEvent[],
  authoredBeats: Readonly<Record<string, number>> = {},
): AlignedEvent[] =>
  events.map((e) => {
    const nearestBeat = beatAtTime(e.time);
    const authoredBeat = authoredBeats[e.id] ?? authoredBeats[`${e.type}:${e.id}`] ?? null;
    return {
      ...e,
      nearestBeat,
      beatError: e.time - beatTime(nearestBeat),
      authoredBeat,
      authoredError: authoredBeat === null ? null : e.time - beatTime(authoredBeat),
    };
  });

export interface AlignmentSummary {
  count: number;
  medianAbsError: number;
  maxAbsError: number;
}

export const summarizeAlignment = (errors: readonly number[]): AlignmentSummary => {
  const abs = errors.map((e) => Math.abs(e)).sort((a, b) => a - b);
  if (abs.length === 0) return { count: 0, medianAbsError: 0, maxAbsError: 0 };
  const mid = Math.floor(abs.length / 2);
  const median =
    abs.length % 2 === 1
      ? (abs[mid] as number)
      : ((abs[mid - 1] as number) + (abs[mid] as number)) / 2;
  return { count: abs.length, medianAbsError: median, maxAbsError: abs[abs.length - 1] as number };
};
