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

/** M9.2 run-mode selection (presentation only — Game owns the semantics). */
export type RunModeSelect = 'classic' | 'checkpoint';

export class Hud {
  public readonly els: HudElements;
  private readonly replayBadge: HTMLElement;
  /** M9 press-to-start gate overlay (music levels only). */
  private readonly startGate: HTMLElement;
  /** M9.2 mode badge (checkpoint runs) + checkpoint progress line. */
  private readonly modeBadge: HTMLElement;
  private readonly checkpointLine: HTMLElement;
  /** M9.2 mode selector buttons (built once, shown only at the gate). */
  private readonly modeButtons: HTMLElement;
  /** Wired by Game: button clicks select the run mode (audio gesture). */
  public onModeSelect: ((mode: RunModeSelect) => void) | null = null;
  /** Wired by Game: the corner MENU button requests the pause menu. */
  public onMenuRequest: (() => void) | null = null;

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
      'SPACE/↑ jump · ←/→ lanes · ↓ fast-fall · R restart · P/ESC pause · M mute music · F1 debug info · F2 colliders · F3 player hitbox · F4 replay last attempt';

    // M9 start gate: minimal press-to-start overlay for music levels (the
    // first gesture unlocks audio + starts the sim from tick 0 together).
    const startGate = document.createElement('div');
    startGate.className = 'hud-start-gate';
    startGate.style.display = 'none';

    // M9.2 mode badge + checkpoint progress (checkpoint runs only).
    const modeBadge = document.createElement('div');
    modeBadge.className = 'hud-mode-badge';
    modeBadge.style.display = 'none';
    const checkpointLine = document.createElement('div');
    checkpointLine.className = 'hud-checkpoint-line';
    checkpointLine.style.display = 'none';

    // M9.2 mode selector: two buttons inside the start gate (one click =
    // mode select + audio unlock + run start, same gesture).
    const modeButtons = document.createElement('div');
    modeButtons.className = 'hud-mode-buttons';
    modeButtons.style.display = 'none';
    const classicButton = document.createElement('button');
    classicButton.className = 'hud-mode-button';
    classicButton.textContent = 'CLASSIC RUN';
    classicButton.title = 'Start from the beginning after every death.';
    const checkpointButton = document.createElement('button');
    checkpointButton.className = 'hud-mode-button hud-mode-button-checkpoint';
    checkpointButton.textContent = 'CHECKPOINT RUN';
    checkpointButton.title = 'Activated crystals save your progress.';
    classicButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onModeSelect?.('classic');
    });
    checkpointButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onModeSelect?.('checkpoint');
    });
    modeButtons.appendChild(classicButton);
    modeButtons.appendChild(checkpointButton);

    // M9.4.1 always-visible menu button (small, top-right, never blocking
    // gameplay): opens the pause menu, same as ESC/P. Keyboard-only pause
    // is undiscoverable, so this is the explicit route to MAIN MENU.
    const menuButton = document.createElement('button');
    menuButton.className = 'hud-menu-button';
    menuButton.textContent = '☰ MENU';
    menuButton.title = 'Open the pause menu (same as ESC)';
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onMenuRequest?.();
    });

    root.appendChild(top);
    root.appendChild(menuButton);
    root.appendChild(message);
    root.appendChild(replayBadge);
    root.appendChild(modeBadge);
    root.appendChild(checkpointLine);
    root.appendChild(help);
    root.appendChild(startGate);
    startGate.appendChild(modeButtons);
    container.appendChild(root);

    this.els = { root, name, progressFill: fill, progressText, attempts, message };
    this.replayBadge = replayBadge;
    this.startGate = startGate;
    this.modeBadge = modeBadge;
    this.checkpointLine = checkpointLine;
    this.modeButtons = modeButtons;
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
    // The mode buttons live INSIDE the gate: update only the leading text
    // node (never clobber the buttons via textContent).
    const first = this.startGate.firstChild;
    if (first !== null && first.nodeType === 3) first.textContent = text;
    else this.startGate.insertBefore(document.createTextNode(text), this.startGate.firstChild);
  }

  /**
   * M9.2 mode selector (null hides the buttons). Shown only when the
   * level authors checkpoints — classic-only levels keep the legacy
   * single-line gate.
   */
  public setModeSelector(title: string | null): void {
    if (title === null) {
      this.modeButtons.style.display = 'none';
      return;
    }
    this.modeButtons.style.display = 'flex';
    this.setStartGate(title);
  }

  /** M9.2 run-mode badge (null hides it). Checkpoint runs only. */
  public setModeBadge(text: string | null): void {
    if (text === null) {
      this.modeBadge.style.display = 'none';
      return;
    }
    this.modeBadge.style.display = 'block';
    if (this.modeBadge.textContent !== text) this.modeBadge.textContent = text;
  }

  /** M9.2 checkpoint progress line (null hides it). Checkpoint runs only. */
  public setCheckpointProgress(text: string | null): void {
    if (text === null) {
      this.checkpointLine.style.display = 'none';
      return;
    }
    this.checkpointLine.style.display = 'block';
    if (this.checkpointLine.textContent !== text) this.checkpointLine.textContent = text;
  }

  public setVisible(visible: boolean): void {
    this.els.root.style.display = visible ? 'block' : 'none';
  }

  /** M9.4.1 session disposal: remove every HUD node (no hidden residue). */
  public dispose(): void {
    this.els.root.remove();
  }
}
