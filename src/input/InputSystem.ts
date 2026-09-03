/**
 * Raw keyboard state -> PHYSICAL input actions, sampled per simulation step.
 *
 * The InputSystem listens to real DOM events (edge) but the simulation only ever
 * consumes an immutable snapshot. Tests construct snapshots directly, so the
 * whole controller is testable without a browser.
 *
 * M3 contract: this layer is GRAVITY-AGNOSTIC. It exposes which physical keys
 * are down (Space / ArrowUp / ArrowDown / lane keys) with per-key edge
 * semantics; the gravity-relative interpretation into gameplay actions
 * (jump / fastFall) happens inside the simulation, which owns the
 * authoritative gravity mode. The DOM layer must never know the player's
 * gravity state.
 *
 * Edge semantics per snapshot:
 * - `held`: key is down at sampling time.
 * - `pressedThisStep`: became down during this step window (auto-repeat ignored).
 * - `releasedThisStep`: came up during this step window.
 */

import type { GravityMode } from '../player/playerState';

export type PhysicalAction = 'space' | 'up' | 'down' | 'laneLeft' | 'laneRight';

export interface ActionEdgeState {
  held: boolean;
  pressedThisStep: boolean;
  releasedThisStep: boolean;
}

/** Physical, per-key snapshot: raw keyboard truth, no gameplay meaning. */
export interface PhysicalInputSnapshot {
  readonly space: Readonly<ActionEdgeState>;
  readonly up: Readonly<ActionEdgeState>;
  readonly down: Readonly<ActionEdgeState>;
  readonly laneLeft: Readonly<ActionEdgeState>;
  readonly laneRight: Readonly<ActionEdgeState>;
}

/**
 * Logical, gravity-relative gameplay actions consumed by the CubeController.
 * `jump` merges Space with the gravity-appropriate directional key exactly the
 * way the pre-M3 InputSystem merged ArrowUp + Space.
 */
export interface InputSnapshot {
  readonly jump: Readonly<ActionEdgeState>;
  readonly fastFall: Readonly<ActionEdgeState>;
  readonly laneLeft: Readonly<ActionEdgeState>;
  readonly laneRight: Readonly<ActionEdgeState>;
}

export const IDLE_EDGE: Readonly<ActionEdgeState> = Object.freeze({
  held: false,
  pressedThisStep: false,
  releasedThisStep: false,
});

const edge = (
  held: boolean,
  pressed: boolean,
  released: boolean,
): Readonly<ActionEdgeState> => Object.freeze({ held, pressedThisStep: pressed, releasedThisStep: released });

const mergeEdges = (a: Readonly<ActionEdgeState>, b: Readonly<ActionEdgeState>): Readonly<ActionEdgeState> =>
  edge(a.held || b.held, a.pressedThisStep || b.pressedThisStep, a.releasedThisStep || b.releasedThisStep);

/** All-actions-idle physical snapshot (used when paused or in tests). */
export const makeIdlePhysicalSnapshot = (): PhysicalInputSnapshot =>
  Object.freeze({
    space: IDLE_EDGE,
    up: IDLE_EDGE,
    down: IDLE_EDGE,
    laneLeft: IDLE_EDGE,
    laneRight: IDLE_EDGE,
  });

/**
 * Gravity-relative interpretation of physical input (pure, deterministic).
 *
 * Floor: ArrowUp or Space = jump; ArrowDown = fast-fall.
 * Ceiling: ArrowDown or Space = jump (away from the ceiling); ArrowUp = fast-fall
 * (back toward the ceiling). Space is ALWAYS the universal jump key.
 *
 * Merge semantics for the jump action match the historical ArrowUp+Space
 * behavior: held/pressed/released each OR-combined across the merged keys.
 * Contradictory input (directional jump key AND opposite fast-fall key held
 * together) simply yields both logical actions — the controller's fixed step
 * order resolves it deterministically, as it always has.
 */
export function interpretPhysicalInput(
  physical: Readonly<PhysicalInputSnapshot>,
  mode: GravityMode,
): InputSnapshot {
  const jump = mode === 'ceiling' ? mergeEdges(physical.space, physical.down) : mergeEdges(physical.space, physical.up);
  const fastFall = mode === 'ceiling' ? physical.up : physical.down;
  return {
    jump,
    fastFall,
    laneLeft: physical.laneLeft,
    laneRight: physical.laneRight,
  };
}

interface MutableEdge {
  held: boolean;
  pressed: boolean;
  released: boolean;
}

const newMutableEdge = (): MutableEdge => ({ held: false, pressed: false, released: false });

const freezeEdge = (e: MutableEdge): ActionEdgeState =>
  Object.freeze({ held: e.held, pressedThisStep: e.pressed, releasedThisStep: e.released });

/** Key -> physical action map (desktop keyboard first). One key, one action. */
const KEY_TO_ACTIONS: Readonly<Record<string, readonly PhysicalAction[]>> = Object.freeze({
  Space: ['space'],
  ArrowUp: ['up'],
  ArrowDown: ['down'],
  ArrowLeft: ['laneLeft'],
  ArrowRight: ['laneRight'],
});

/** Prevent page scroll / default behavior for gameplay keys. */
const PREVENT_DEFAULT_CODES = new Set(Object.keys(KEY_TO_ACTIONS));

export class InputSystem {
  private readonly edges: Record<PhysicalAction, MutableEdge> = {
    space: newMutableEdge(),
    up: newMutableEdge(),
    down: newMutableEdge(),
    laneLeft: newMutableEdge(),
    laneRight: newMutableEdge(),
  };

  private enabled = true;
  private attached = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const actions = KEY_TO_ACTIONS[event.code];
    if (!actions) return;
    if (PREVENT_DEFAULT_CODES.has(event.code)) event.preventDefault();
    if (!this.enabled) return;
    for (const action of actions) {
      const edge = this.edges[action];
      if (!edge.held) {
        // First physical press only — OS auto-repeat events are ignored.
        edge.held = true;
        edge.pressed = true;
      }
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const actions = KEY_TO_ACTIONS[event.code];
    if (!actions) return;
    if (PREVENT_DEFAULT_CODES.has(event.code)) event.preventDefault();
    if (!this.enabled) return;
    for (const action of actions) {
      const edge = this.edges[action];
      if (edge.held) {
        edge.held = false;
        edge.released = true;
      }
    }
  };

  /** Ignore game input entirely (e.g. pause menu open). */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  public attach(target: Window = window): void {
    if (this.attached) return;
    target.addEventListener('keydown', this.onKeyDown, { passive: false });
    target.addEventListener('keyup', this.onKeyUp, { passive: false });
    target.addEventListener('blur', () => {
      this.releaseAll();
    });
    this.attached = true;
  }

  public detach(target: Window = window): void {
    if (!this.attached) return;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    this.attached = false;
  }

  /**
   * Build the immutable PHYSICAL snapshot for one simulation step and reset
   * press/release accumulators. Multiple DOM events between two sim steps
   * collapse into one press/release edge — intentional: simulation resolution
   * is 120 Hz. Gravity interpretation happens later, inside the simulation.
   */
  public sample(): PhysicalInputSnapshot {
    const snapshot: PhysicalInputSnapshot = {
      space: freezeEdge(this.edges.space),
      up: freezeEdge(this.edges.up),
      down: freezeEdge(this.edges.down),
      laneLeft: freezeEdge(this.edges.laneLeft),
      laneRight: freezeEdge(this.edges.laneRight),
    };
    this.clearTransient();
    return snapshot;
  }

  private clearTransient(): void {
    for (const action of Object.keys(this.edges) as PhysicalAction[]) {
      this.edges[action].pressed = false;
      this.edges[action].released = false;
    }
  }

  private releaseAll(): void {
    for (const action of Object.keys(this.edges) as PhysicalAction[]) {
      const edgeState = this.edges[action];
      if (edgeState.held) edgeState.released = true;
      edgeState.held = false;
    }
  }
}
