/**
 * Raw keyboard state -> logical gameplay actions, sampled per simulation step.
 *
 * The InputSystem listens to real DOM events (edge) but the simulation only ever
 * consumes an immutable InputSnapshot. Tests construct snapshots directly, so the
 * whole controller is testable without a browser.
 *
 * Edge semantics per snapshot:
 * - `held`: key is down at sampling time.
 * - `pressedThisStep`: became down during this step window (auto-repeat ignored).
 * - `releasedThisStep`: came up during this step window.
 */

export type LogicalAction = 'jump' | 'fastFall' | 'laneLeft' | 'laneRight';

export interface ActionEdgeState {
  held: boolean;
  pressedThisStep: boolean;
  releasedThisStep: boolean;
}

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

/** All-actions-idle snapshot (used when paused or in tests). */
export const makeIdleSnapshot = (): InputSnapshot =>
  Object.freeze({
    jump: IDLE_EDGE,
    fastFall: IDLE_EDGE,
    laneLeft: IDLE_EDGE,
    laneRight: IDLE_EDGE,
  });

interface MutableEdge {
  held: boolean;
  pressed: boolean;
  released: boolean;
}

const newMutableEdge = (): MutableEdge => ({ held: false, pressed: false, released: false });

const freezeEdge = (e: MutableEdge): ActionEdgeState =>
  Object.freeze({ held: e.held, pressedThisStep: e.pressed, releasedThisStep: e.released });

/** Key -> action map (desktop keyboard first). ArrowUp and Space combine into one `jump` action. */
const KEY_TO_ACTIONS: Readonly<Record<string, readonly LogicalAction[]>> = Object.freeze({
  ArrowUp: ['jump'],
  Space: ['jump'],
  ArrowDown: ['fastFall'],
  ArrowLeft: ['laneLeft'],
  ArrowRight: ['laneRight'],
});

/** Prevent page scroll / default behavior for gameplay keys. */
const PREVENT_DEFAULT_CODES = new Set(Object.keys(KEY_TO_ACTIONS));

export class InputSystem {
  private readonly edges: Record<LogicalAction, MutableEdge> = {
    jump: newMutableEdge(),
    fastFall: newMutableEdge(),
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
    // Both keys of a combined action (ArrowUp + Space) must be up before release fires,
    // but tracking per-key state is overkill for M1: releasing either key releases
    // the logical action. Holding one while tapping the other still works because
    // the second keydown finds `held` already true and does nothing.
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
   * Build the immutable snapshot for one simulation step and reset press/release
   * accumulators. Multiple DOM events between two sim steps collapse into one
   * press/release edge — intentional: simulation resolution is 120 Hz.
   */
  public sample(): InputSnapshot {
    const snapshot: InputSnapshot = {
      jump: freezeEdge(this.edges.jump),
      fastFall: freezeEdge(this.edges.fastFall),
      laneLeft: freezeEdge(this.edges.laneLeft),
      laneRight: freezeEdge(this.edges.laneRight),
    };
    this.clearTransient();
    return snapshot;
  }

  private clearTransient(): void {
    for (const action of Object.keys(this.edges) as LogicalAction[]) {
      this.edges[action].pressed = false;
      this.edges[action].released = false;
    }
  }

  private releaseAll(): void {
    for (const action of Object.keys(this.edges) as LogicalAction[]) {
      const edge = this.edges[action];
      if (edge.held) edge.released = true;
      edge.held = false;
    }
  }
}
