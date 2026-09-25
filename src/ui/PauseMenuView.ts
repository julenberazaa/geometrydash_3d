import type { RunMode } from '../game/runModeController';

/**
 * M9.4 in-game pause menu (presentation only — `Game` owns the semantics).
 * Compact overlay: RUN MODE [CLASSIC | CHECKPOINT] switching without a
 * page reload, plus RESUME / RESTART LEVEL / MAIN MENU.
 */
export interface PauseMenuCallbacks {
  onResume: () => void;
  onModeSelect: (mode: RunMode) => void;
  onRestart: () => void;
  onExitToMenu: () => void;
}

export class PauseMenuView {
  private readonly root: HTMLElement;
  private readonly classicButton: HTMLButtonElement;
  private readonly checkpointButton: HTMLButtonElement;
  private readonly taintNote: HTMLElement;
  private readonly callbacks: PauseMenuCallbacks;
  private visible = false;

  constructor(container: HTMLElement, callbacks: PauseMenuCallbacks) {
    this.callbacks = callbacks;
    const root = document.createElement('div');
    root.className = 'm94-pause-menu';
    root.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'm94-pause-title';
    title.textContent = 'PAUSED';

    const modeLabel = document.createElement('div');
    modeLabel.className = 'm94-pause-label';
    modeLabel.textContent = 'RUN MODE';

    const modeRow = document.createElement('div');
    modeRow.className = 'm94-pause-row';
    const classicButton = document.createElement('button');
    classicButton.className = 'm94-pause-mode-button';
    classicButton.textContent = 'CLASSIC';
    classicButton.title = 'Deaths restart from the origin. Official runs only.';
    const checkpointButton = document.createElement('button');
    checkpointButton.className = 'm94-pause-mode-button m94-pause-mode-checkpoint';
    checkpointButton.textContent = 'CHECKPOINT';
    checkpointButton.title = 'Crystals save progress. Practice runs only.';
    classicButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.callbacks.onModeSelect('classic');
    });
    checkpointButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.callbacks.onModeSelect('checkpoint');
    });
    modeRow.appendChild(classicButton);
    modeRow.appendChild(checkpointButton);

    const taintNote = document.createElement('div');
    taintNote.className = 'm94-pause-note';
    taintNote.textContent = 'Checkpoint use marks this attempt PRACTICE until a full restart.';

    const actionRow = document.createElement('div');
    actionRow.className = 'm94-pause-row';
    const resumeButton = document.createElement('button');
    resumeButton.className = 'm94-pause-action-button';
    resumeButton.textContent = 'RESUME';
    const restartButton = document.createElement('button');
    restartButton.className = 'm94-pause-action-button';
    restartButton.textContent = 'RESTART LEVEL';
    const menuButton = document.createElement('button');
    menuButton.className = 'm94-pause-action-button';
    menuButton.textContent = 'MAIN MENU';
    menuButton.title = 'Stop this run and return to level + mode select.';
    resumeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.callbacks.onResume();
    });
    restartButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.callbacks.onRestart();
    });
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.callbacks.onExitToMenu();
    });
    actionRow.appendChild(resumeButton);
    actionRow.appendChild(restartButton);
    actionRow.appendChild(menuButton);

    root.appendChild(title);
    root.appendChild(modeLabel);
    root.appendChild(modeRow);
    root.appendChild(taintNote);
    root.appendChild(actionRow);
    // Clicks on the overlay must never reach the canvas container gesture
    // (a mode click is not a jump / lane / spider input).
    root.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    container.appendChild(root);

    this.root = root;
    this.classicButton = classicButton;
    this.checkpointButton = checkpointButton;
    this.taintNote = taintNote;
  }

  public get isVisible(): boolean {
    return this.visible;
  }

  /** Show the menu with the current mode highlighted. */
  public show(mode: RunMode, practiceTainted: boolean): void {
    this.visible = true;
    this.root.style.display = 'block';
    this.refresh(mode, practiceTainted);
  }

  public hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  /** Refresh selection highlight + taint note while open. */
  public refresh(mode: RunMode, practiceTainted: boolean): void {
    this.classicButton.classList.toggle('m94-selected', mode === 'classic');
    this.checkpointButton.classList.toggle('m94-selected', mode === 'checkpoint');
    this.taintNote.textContent =
      mode === 'checkpoint' || practiceTainted
        ? 'PRACTICE ATTEMPT — a full restart opens a fresh run in the selected mode.'
        : 'Checkpoint use marks this attempt PRACTICE until a full restart.';
  }

  public dispose(): void {
    this.root.remove();
  }
}
