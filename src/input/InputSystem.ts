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
 * Ceiling: ArrowDown or Space = jump (away from the ceiling); ArrowUp =
 * fast-fall (back toward the ceiling). Space is ALWAYS the universal jump
 * key; lanes never mirror (ArrowRight is always screen-right).
 *
 * Walls (M8B): the lane axis is vertical, so ArrowUp/ArrowDown drive lane
 * intent (Up = toward higher lanes, Down = toward lower lanes on BOTH
 * walls — never mirrored) while the horizontal arrows work the support:
 * the key pointing AWAY from the wall jumps (Space always does too) and
 * the key pointing INTO the wall fast-falls.
 * - Left wall (support at screen-left/world +X): jump = Space|ArrowRight,
 *   fastFall = ArrowLeft, lanes = Down/Up.
 * - Right wall (support at screen-right/world −X): jump = Space|ArrowLeft,
 *   fastFall = ArrowRight, lanes = Down/Up.
 *
 * Merge semantics for the jump action match the historical ArrowUp+Space
 * behavior: held/pressed/released each OR-combined across the merged keys.
 * Contradictory input simply yields both logical actions — the
 * controller's fixed step order resolves it deterministically.
 */
export function interpretPhysicalInput(
  physical: Readonly<PhysicalInputSnapshot>,
  mode: GravityMode,
): InputSnapshot {
  if (mode === 'leftWall') {
    return {
      jump: mergeEdges(physical.space, physical.laneRight),
      fastFall: physical.laneLeft,
      laneLeft: physical.down,
      laneRight: physical.up,
    };
  }
  if (mode === 'rightWall') {
    return {
      jump: mergeEdges(physical.space, physical.laneLeft),
      fastFall: physical.laneRight,
      laneLeft: physical.down,
      laneRight: physical.up,
    };
  }
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

  /**
   * M9.6 active pointer ids driving the shared `space` edge (multi-touch:
   * first contact presses, last release releases — the same edge contract
   * as keyboard Space, so taps are indistinguishable downstream).
   */
  private readonly pointerIds = new Set<number>();
  /** Track Space separately: pointer and keyboard releases must not disarm each other. */
  private keyboardSpaceHeld = false;
  private pointerRoot: HTMLElement | null = null;

  private enabled = true;
  private attached = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const actions = KEY_TO_ACTIONS[event.code];
    if (!actions) return;
    if (PREVENT_DEFAULT_CODES.has(event.code)) event.preventDefault();
    if (!this.enabled) return;
    for (const action of actions) {
      if (action === 'space') {
        if (this.keyboardSpaceHeld) continue;
        this.keyboardSpaceHeld = true;
      }
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
      if (action === 'space') {
        if (!this.keyboardSpaceHeld) continue;
        this.keyboardSpaceHeld = false;
        if (this.pointerIds.size > 0) continue;
      }
      const edge = this.edges[action];
      if (edge.held) {
        edge.held = false;
        edge.released = true;
      }
    }
  };

  /**
   * M9.6 window-blur release (named so `detach()` removes it — the old
   * anonymous closure leaked across sessions).
   */
  private readonly onBlur = (): void => {
    this.releaseAll();
    this.clearTransient();
  };

  /**
   * M9.6 pointer → primary-action mapping (mouse click / touch tap).
   *
   * Pointer contacts drive the SAME `space` edge state as keyboard Space:
   * first contact presses, last release releases. Gravity interpretation
   * stays inside the simulation (unchanged) — pointer, like Space, is the
   * universal primary action (jump / thrust / surface-switch / orb).
   *
   * Contacts starting on a `button` (or inside one) are UI gestures, never
   * gameplay input — they are ignored here (the button's own click handler
   * owns them, and it blurs itself so Space never re-activates it).
   */
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.isUiTarget(event.target)) return;
    event.preventDefault();
    if (!this.enabled) return;
    if (this.pointerIds.has(event.pointerId)) return;
    if (this.pointerIds.size === 0) {
      const edge = this.edges.space;
      if (!edge.held) {
        edge.held = true;
        edge.pressed = true;
      }
    }
    this.pointerIds.add(event.pointerId);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerIds.has(event.pointerId)) return;
    this.pointerIds.delete(event.pointerId);
    if (this.pointerIds.size > 0) return;
    const edge = this.edges.space;
    if (edge.held && !this.keyboardSpaceHeld) {
      edge.held = false;
      edge.released = true;
    }
  };

  /** Ignore game input entirely (e.g. pause menu open). */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.releaseAll();
      // A press pending when the pause/menu opens must not fire on resume.
      this.clearTransient();
    }
  }

  public attach(target: Window = window): void {
    if (this.attached) return;
    target.addEventListener('keydown', this.onKeyDown, { passive: false });
    target.addEventListener('keyup', this.onKeyUp, { passive: false });
    target.addEventListener('blur', this.onBlur);
    this.attached = true;
  }

  public detach(target: Window = window): void {
    if (!this.attached) return;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
    this.detachPointer();
    this.attached = false;
  }

  /**
   * M9.6 gameplay-pointer root (the session container). Pointer taps on
   * the canvas/scene act as the primary action; UI controls keep their
   * own gestures (see `onPointerDown`). Detached with the session —
   * never a cross-session listener.
   */
  public attachPointer(root: HTMLElement): void {
    if (this.pointerRoot !== null) return;
    this.pointerRoot = root;
    root.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    root.addEventListener('pointerup', this.onPointerUp);
    root.addEventListener('pointercancel', this.onPointerUp);
    root.addEventListener('pointerleave', this.onPointerUp);
  }

  public detachPointer(): void {
    if (this.pointerRoot === null) return;
    this.pointerRoot.removeEventListener('pointerdown', this.onPointerDown);
    this.pointerRoot.removeEventListener('pointerup', this.onPointerUp);
    this.pointerRoot.removeEventListener('pointercancel', this.onPointerUp);
    this.pointerRoot.removeEventListener('pointerleave', this.onPointerUp);
    this.pointerRoot = null;
    this.pointerIds.clear();
    if (!this.keyboardSpaceHeld && this.edges.space.held) {
      this.edges.space.held = false;
      this.edges.space.released = true;
    }
  }

  /** True when the contact started on (or inside) a UI control. */
  private isUiTarget(target: EventTarget | null): boolean {
    if (target === null) return false;
    const elt = target as Partial<HTMLElement>;
    if (typeof elt.closest !== 'function') return false;
    return elt.closest('button') !== null;
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
    // Pointer contacts are re-armed on next contact (blur/pause drops the
    // gesture — the matching release may never arrive while disabled).
    this.pointerIds.clear();
    this.keyboardSpaceHeld = false;
  }
}
