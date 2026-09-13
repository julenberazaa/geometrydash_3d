import type { InteractionKind, SimulationStatus } from '../../src/game/GameSimulation';
import type { VfxSystem } from '../../src/rendering/VfxSystem';

/**
 * Shared M6C2 VFX test harness (non-test support per AGENTS.md §9).
 *
 * Minimal structural stand-in for the VfxSimView surface: real tests drive
 * the REAL VfxSystem with this fake sim view (same pattern as
 * tests/motionVfx.test.ts, factored here so new suites reuse one owner
 * instead of duplicating the fixture).
 */

export interface MutableVec {
  x: number;
  y: number;
  z: number;
}

export interface MutableSimView {
  status: SimulationStatus;
  attempts: number;
  deathId: number;
  player: { position: MutableVec; velocity: MutableVec; grounded: boolean };
  gameplayFrame: { surfaceNormal: MutableVec; gravityVector: MutableVec };
  speedMultiplier: number;
  portalTransitionCount: number;
  speedPortalCount: number;
  interactionEventCount: number;
  lastInteraction: { kind: InteractionKind; x: number; y: number; z: number };
  teleportEventCount: number;
  lastTeleport: MutableVec;
  modeTransitionCount: number;
  playerMode: string;
}

export const floorFrame = (): MutableSimView['gameplayFrame'] => ({
  surfaceNormal: { x: 0, y: 1, z: 0 },
  gravityVector: { x: 0, y: -1, z: 0 },
});

export const ceilingFrame = (): MutableSimView['gameplayFrame'] => ({
  surfaceNormal: { x: 0, y: -1, z: 0 },
  gravityVector: { x: 0, y: 1, z: 0 },
});

export const makeSimView = (): MutableSimView => ({
  status: 'running',
  attempts: 1,
  deathId: 0,
  player: {
    position: { x: 0, y: 0.55, z: 10 },
    velocity: { x: 0, y: 0, z: 14 },
    grounded: true,
  },
  gameplayFrame: floorFrame(),
  speedMultiplier: 1,
  portalTransitionCount: 0,
  speedPortalCount: 0,
  interactionEventCount: 0,
  lastInteraction: { kind: 'pad', x: 0, y: 0, z: 0 },
  teleportEventCount: 0,
  lastTeleport: { x: 0, y: 0, z: 0 },
  modeTransitionCount: 0,
  playerMode: 'cube',
});

export const DT = 1 / 60;

/** Run N render frames with optional per-frame mutation (render-time evolution). */
export const runFrames = (
  vfx: VfxSystem,
  sim: MutableSimView,
  frames: number,
  mutate?: (frame: number) => void,
): void => {
  for (let i = 0; i < frames; i++) {
    mutate?.(i);
    // The trail follows forward motion like the real rendered cube.
    sim.player.position.z += sim.player.velocity.z * DT;
    vfx.update(DT, sim, sim.player.position);
  }
};
