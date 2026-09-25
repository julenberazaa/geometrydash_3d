import { describe, it, expect } from 'vitest';
import { InputSystem } from '../src/input/InputSystem';

/**
 * M9.6 pointer primary-action + listener-hygiene contract.
 *
 * Audit root causes (see the M9.6 spec):
 * - C1: clicks/taps had NO gameplay path (keyboard-only). Pointer contacts
 *   now drive the same `space` edge state as keyboard Space — the universal
 *   primary action — with zero replay-codec change.
 * - C4: the window `blur` listener was an anonymous closure, never removed
 *   by `detach()` (cross-session leak).
 *
 * The fake root below implements just the EventTarget surface `attach`
 * needs, so the whole path is testable without a browser.
 */

interface RecordedCall {
  type: string;
  listener: (event: never) => void;
}

class FakeRoot {
  public added: RecordedCall[] = [];
  public removed: RecordedCall[] = [];
  private readonly listeners = new Map<string, Set<(event: never) => void>>();

  public addEventListener = (type: string, listener: (event: never) => void): void => {
    this.added.push({ type, listener });
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  };

  public removeEventListener = (type: string, listener: (event: never) => void): void => {
    this.removed.push({ type, listener });
    this.listeners.get(type)?.delete(listener);
  };

  public dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }

  public listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** Pointer event on the scene (not on a UI control). */
const scenePointer = (pointerId: number): unknown => ({
  pointerId,
  target: { closest: (_sel: string): null => null },
  preventDefault: (): void => {},
});

/** Pointer event starting on (or inside) a button — a UI gesture. */
const buttonPointer = (pointerId: number): unknown => ({
  pointerId,
  target: { closest: (_sel: string): object => ({}) },
  preventDefault: (): void => {},
});

const asHtmlElement = (root: FakeRoot): HTMLElement => root as unknown as HTMLElement;
const asWindow = (root: FakeRoot): Window => root as unknown as Window;

describe('M9.6 pointer primary action (InputSystem)', () => {
  it('pointerdown on the scene presses the shared space edge', () => {
    const input = new InputSystem();
    const root = new FakeRoot();
    input.attachPointer(asHtmlElement(root));
    root.dispatch('pointerdown', scenePointer(1));
    const snap = input.sample();
    expect(snap.space.held).toBe(true);
    expect(snap.space.pressedThisStep).toBe(true);
    expect(snap.space.releasedThisStep).toBe(false);
    // Untouched actions stay idle.
    expect(snap.up.pressedThisStep).toBe(false);
    expect(snap.laneLeft.pressedThisStep).toBe(false);
  });

  it('the press edge clears on the next sample while held (keyboard parity)', () => {
    const input = new InputSystem();
    const root = new FakeRoot();
    input.attachPointer(asHtmlElement(root));
    root.dispatch('pointerdown', scenePointer(1));
    input.sample();
    const second = input.sample();
    expect(second.space.held).toBe(true);
    expect(second.space.pressedThisStep).toBe(false);
  });

  it('pointerup releases the shared space edge', () => {
    const input = new InputSystem();
    const root = new FakeRoot();
    input.attachPointer(asHtmlElement(root));
    root.dispatch('pointerdown', scenePointer(1));
    input.sample();
    root.dispatch('pointerup', scenePointer(1));
    const snap = input.sample();
    expect(snap.space.held).toBe(false);
    expect(snap.space.releasedThisStep).toBe(true);
    expect(snap.space.pressedThisStep).toBe(false);
  });

  it('pointercancel releases like pointerup (touch interrupt)', () => {
    const input = new InputSystem();
    const root = new FakeRoot();
    input.attachPointer(asHtmlElement(root));
    root.dispatch('pointerdown', scenePointer(7));
    input.sample();
    root.dispatch('pointercancel', scenePointer(7));
    const snap = input.sample();
    expect(snap.space.held).toBe(false);
    expect(snap.space.releasedThisStep).toBe(true);
  });

  it('contacts starting on a button are UI gestures, never gameplay input', () => {
    const input = new InputSystem();
    const root = new FakeRoot();
    input.attachPointer(asHtmlElement(root));
    root.dispatch('pointerdown', buttonPointer(1));
    const snap = input.sample();
    expect(snap.space.held).toBe(false);
    expect(snap.space.pressedThisStep).toBe(false);
    // A release with no matching press is a no-op (no stuck state).
    root.dispatch('pointerup', buttonPointer(1));
    const after = input.sample();
    expect(after.space.releasedThisStep).toBe(false);
  });

  it('multi-touch: first contact presses, last release releases', () => {
    const input = new InputSystem();
    const root = new FakeRoot();
    input.attachPointer(asHtmlElement(root));
    root.dispatch('pointerdown', scenePointer(1));
    const first = input.sample();
    expect(first.space.pressedThisStep).toBe(true);
    // Second finger: held already — no duplicate edge (auto-repeat parity).
    root.dispatch('pointerdown', scenePointer(2));
    const second = input.sample();
    expect(second.space.held).toBe(true);
    expect(second.space.pressedThisStep).toBe(false);
    // First finger lifts: still held, no release edge.
    root.dispatch('pointerup', scenePointer(1));
    const third = input.sample();
    expect(third.space.held).toBe(true);
    expect(third.space.releasedThisStep).toBe(false);
    // Last finger lifts: release.
    root.dispatch('pointerup', scenePointer(2));
    const fourth = input.sample();
    expect(fourth.space.held).toBe(false);
    expect(fourth.space.releasedThisStep).toBe(true);
  });

  it('pointer input is dropped while disabled (pause parity with keyboard)', () => {
    const input = new InputSystem();
    const root = new FakeRoot();
    input.attachPointer(asHtmlElement(root));
    input.setEnabled(false);
    root.dispatch('pointerdown', scenePointer(1));
    const snap = input.sample();
    expect(snap.space.held).toBe(false);
    expect(snap.space.pressedThisStep).toBe(false);
  });

  it('keyboard Space still drives the same edge (shared state)', () => {
    const input = new InputSystem();
    const win = new FakeRoot();
    input.attach(asWindow(win));
    win.dispatch('keydown', { code: 'Space', preventDefault: (): void => {} });
    const snap = input.sample();
    expect(snap.space.held).toBe(true);
    expect(snap.space.pressedThisStep).toBe(true);
    win.dispatch('keyup', { code: 'Space', preventDefault: (): void => {} });
    const after = input.sample();
    expect(after.space.held).toBe(false);
    expect(after.space.releasedThisStep).toBe(true);
    input.detach(asWindow(win));
  });

  it('detachPointer stops recording and removes every pointer listener', () => {
    const input = new InputSystem();
    const root = new FakeRoot();
    input.attachPointer(asHtmlElement(root));
    expect(root.listenerCount('pointerdown')).toBe(1);
    input.detachPointer();
    expect(root.listenerCount('pointerdown')).toBe(0);
    expect(root.listenerCount('pointerup')).toBe(0);
    expect(root.listenerCount('pointercancel')).toBe(0);
    const removed = root.removed.map((c) => c.type).sort();
    expect(removed).toEqual(['pointercancel', 'pointerdown', 'pointerup']);
    // Post-detach contacts are ignored (no cross-session leakage).
    root.dispatch('pointerdown', scenePointer(1));
    const snap = input.sample();
    expect(snap.space.pressedThisStep).toBe(false);
  });

  it('detach removes the window blur listener (C4 leak fix)', () => {
    const input = new InputSystem();
    const win = new FakeRoot();
    input.attach(asWindow(win));
    expect(win.listenerCount('blur')).toBe(1);
    input.detach(asWindow(win));
    expect(win.listenerCount('blur')).toBe(0);
    expect(win.removed.map((c) => c.type).sort()).toEqual(['blur', 'keydown', 'keyup']);
  });
});
