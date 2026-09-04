/**
 * Replay input codec (M5): PHYSICAL input snapshots <-> compact numeric
 * per-tick frames.
 *
 * The tape records the EXACT physical input semantics GameSimulation consumes
 * each fixed step — all five physical actions with their full held /
 * pressedThisStep / releasedThisStep edge state — so a press+release inside
 * one sampling interval survives encoding (recording only `held` would lose
 * it).
 *
 * Encoding: one integer bitfield per fixed tick,
 *   bit = actionIndex * 3 + edgeIndex
 * with actions [space, up, down, laneLeft, laneRight] and edges
 * [held, pressedThisStep, releasedThisStep]. Valid frames are integers in
 * [0, 32767]. No heap object per tick.
 */

import type { ActionEdgeState, PhysicalAction, PhysicalInputSnapshot } from '../input/InputSystem';

/** Fixed physical action order of the encoding (never reorder — breaks tapes). */
export const REPLAY_ACTIONS: readonly PhysicalAction[] = Object.freeze([
  'space',
  'up',
  'down',
  'laneLeft',
  'laneRight',
] as const);

const EDGE_COUNT = 3; // held | pressedThisStep | releasedThisStep
export const MIN_REPLAY_FRAME = 0;
export const MAX_REPLAY_FRAME = (1 << (REPLAY_ACTIONS.length * EDGE_COUNT)) - 1;

export const isValidReplayFrame = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) &&
  value >= MIN_REPLAY_FRAME && value <= MAX_REPLAY_FRAME;

/** Encode one physical input snapshot into a single numeric frame. */
export const encodeReplayFrame = (snapshot: Readonly<PhysicalInputSnapshot>): number => {
  let frame = 0;
  for (let a = 0; a < REPLAY_ACTIONS.length; a++) {
    const action = REPLAY_ACTIONS[a] ?? 'space';
    const edge: ActionEdgeState = snapshot[action];
    const base = a * EDGE_COUNT;
    if (edge.held) frame |= 1 << base;
    if (edge.pressedThisStep) frame |= 1 << (base + 1);
    if (edge.releasedThisStep) frame |= 1 << (base + 2);
  }
  return frame;
};

const frozenEdge = (held: boolean, pressed: boolean, released: boolean): ActionEdgeState =>
  Object.freeze({ held, pressedThisStep: pressed, releasedThisStep: released });

/**
 * Decode one numeric frame back into an immutable physical input snapshot
 * with identical held/pressed/released semantics. Every bit combination is a
 * legal snapshot (edges are raw keyboard truth; interpretation is the
 * simulation's job).
 */
export const decodeReplayFrame = (frame: number): PhysicalInputSnapshot => {
  if (!isValidReplayFrame(frame)) {
    throw new Error(`invalid replay input frame: ${String(frame)}`);
  }
  const snapshot: { -readonly [K in PhysicalAction]: ActionEdgeState } = {
    space: frozenEdge(false, false, false),
    up: frozenEdge(false, false, false),
    down: frozenEdge(false, false, false),
    laneLeft: frozenEdge(false, false, false),
    laneRight: frozenEdge(false, false, false),
  };
  for (let a = 0; a < REPLAY_ACTIONS.length; a++) {
    const action = REPLAY_ACTIONS[a] ?? 'space';
    const base = a * EDGE_COUNT;
    snapshot[action] = frozenEdge(
      (frame & (1 << base)) !== 0,
      (frame & (1 << (base + 1))) !== 0,
      (frame & (1 << (base + 2))) !== 0,
    );
  }
  return Object.freeze(snapshot);
};
