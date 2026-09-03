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

    const help = document.createElement('div');
    help.className = 'hud-help';
    help.textContent =
      'SPACE/↑ jump · ←/→ lanes · ↓ fast-fall · R restart · P pause · F1 debug info · F2 colliders · F3 player hitbox';

    root.appendChild(top);
    root.appendChild(message);
    root.appendChild(help);
    container.appendChild(root);

    this.els = { root, name, progressFill: fill, progressText, attempts, message };
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

  public setVisible(visible: boolean): void {
    this.els.root.style.display = visible ? 'block' : 'none';
  }
}
