/**
 * Debug overlay: plain text panel fed by the Game class each frame.
 * Hidden by default; toggled with F1.
 */
export class DebugOverlay {
  private readonly el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.className = 'debug-overlay';
    this.el.style.display = 'none';
    container.appendChild(this.el);
  }

  public setVisible(visible: boolean): void {
    this.el.style.display = visible ? 'block' : 'none';
  }

  public update(lines: string[]): void {
    this.el.textContent = lines.join('\n');
  }
}
