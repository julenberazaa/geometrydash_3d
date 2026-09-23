/**
 * Minimal HTML/CSS HUD. Real level progress, attempt count, status messages.
 * No fake buttons, no reference-UI reproduction.
 */
export interface HudElements {
  root: HTMLElement;
  name: HTMLElement;
  progressFill: HTMLElement;
  progressText: HTMLElement;
  attempts: HTMLElement;
  message: HTMLElement;
}

export class Hud {
  public readonly els: HudElements;
  private readonly replayBadge: HTMLElement;
  /** M9 press-to-start gate overlay (music levels only). */
  private readonly startGate: HTMLElement;

  constructor(container: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud';

    const top = document.createElement('div');
    top.className = 'hud-top';

    const name = document.createElement('span');
    name.className = 'hud-name';
    name.textContent = '';

    const attempts = document.createElement('span');
    attempts.className = 'hud-attempts';

    const barWrap = document.createElement('div');
    barWrap.className = 'hud-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'hud-bar';
    const fill = document.createElement('div');
    fill.className = 'hud-bar-fill';
    bar.appendChild(fill);
    barWrap.appendChild(bar);

    const progressText = document.createElement('span');
    progressText.className = 'hud-progress-text';

    top.appendChild(name);
    top.appendChild(barWrap);
    top.appendChild(progressText);
    top.appendChild(attempts);

    const message = document.createElement('div');
    message.className = 'hud-message';
    message.textContent = '';

    const replayBadge = document.createElement('div');
    replayBadge.className = 'hud-replay-badge';
    replayBadge.textContent = '';
    replayBadge.style.display = 'none';

    const help = document.createElement('div');
    help.className = 'hud-help';
    help.textContent =
      'SPACE/↑ jump · ←/→ lanes · ↓ fast-fall · R restart · P pause · M mute music · F1 debug info · F2 colliders · F3 player hitbox · F4 replay last attempt';

    // M9 start gate: minimal press-to-start overlay for music levels (the
    // first gesture unlocks audio + starts the sim from tick 0 together).
    const startGate = document.createElement('div');
    startGate.className = 'hud-start-gate';
    startGate.style.display = 'none';

    root.appendChild(top);
    root.appendChild(message);
    root.appendChild(replayBadge);
    root.appendChild(help);
    root.appendChild(startGate);
    container.appendChild(root);

    this.els = { root, name, progressFill: fill, progressText, attempts, message };
    this.replayBadge = replayBadge;
    this.startGate = startGate;
  }

  public update(opts: {
    displayName: string;
    progress: number;
    attempts: number;
  }): void {
    this.els.name.textContent = opts.displayName;
    const pct = Math.round(opts.progress * 100);
    this.els.progressFill.style.width = `${pct}%`;
    this.els.progressText.textContent = `${pct}%`;
    this.els.attempts.textContent = `ATTEMPT ${opts.attempts}`;
  }

  public setMessage(text: string): void {
    this.els.message.textContent = text;
  }

  /** Minimal replay indicator (null hides it). Driven by Game each frame. */
  public setReplayBadge(text: string | null): void {
    if (text === null) {
      this.replayBadge.style.display = 'none';
      return;
    }
    this.replayBadge.style.display = 'block';
    if (this.replayBadge.textContent !== text) this.replayBadge.textContent = text;
  }

  /** M9 start gate (null hides it). Driven by Game exactly once per session. */
  public setStartGate(text: string | null): void {
    if (text === null) {
      this.startGate.style.display = 'none';
      return;
    }
    this.startGate.style.display = 'block';
    if (this.startGate.textContent !== text) this.startGate.textContent = text;
  }

  public setVisible(visible: boolean): void {
    this.els.root.style.display = visible ? 'block' : 'none';
  }
}
