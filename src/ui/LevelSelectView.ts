import type { RunMode } from '../game/runModeController';
import type { LevelCardMeta } from '../content/levelMetadata';

/** One selectable card: declarative metadata + resolved display name. */
export interface LevelCardEntry {
  meta: LevelCardMeta;
  displayName: string;
}

/** Initial selection (defaults: latest level, classic mode). */
export interface LevelSelectInitial {
  levelId: string;
  mode: RunMode;
}

/**
 * M9.4 level/mode start screen (presentation only — `AppController` owns
 * the session lifecycle). One coherent screen: SELECT LEVEL (cards) →
 * SELECT MODE (classic/checkpoint) → START. The START gesture is the
 * audio unlock; it must not leak gameplay input (the Game flushes it).
 */
export class LevelSelectView {
  public onStart: ((levelId: string, mode: RunMode) => void) | null = null;

  private readonly root: HTMLElement;
  private readonly cardButtons: HTMLButtonElement[] = [];
  private readonly classicButton: HTMLButtonElement;
  private readonly checkpointButton: HTMLButtonElement;
  private selectedLevelId: string;
  private selectedMode: RunMode;

  constructor(
    container: HTMLElement,
    entries: readonly LevelCardEntry[],
    initial: LevelSelectInitial,
  ) {
    this.selectedLevelId = initial.levelId;
    this.selectedMode = initial.mode;

    const root = document.createElement('div');
    root.className = 'm94-menu';

    const title = document.createElement('div');
    title.className = 'm94-menu-title';
    title.textContent = 'GEOMETRY DASH 3D';

    const levelLabel = document.createElement('div');
    levelLabel.className = 'm94-menu-label';
    levelLabel.textContent = 'SELECT LEVEL';

    const cards = document.createElement('div');
    cards.className = 'm94-cards';
    for (const entry of entries) {
      const card = document.createElement('button');
      card.className = 'm94-card';
      card.style.setProperty('--m94-accent', entry.meta.accentCss);
      card.dataset.levelId = entry.meta.levelId;

      const tag = document.createElement('div');
      tag.className = 'm94-card-tag';
      tag.textContent = entry.meta.tag;
      const name = document.createElement('div');
      name.className = 'm94-card-title';
      name.textContent = entry.displayName;
      const sub = document.createElement('div');
      sub.className = 'm94-card-subtitle';
      sub.textContent = entry.meta.subtitle;
      const meta = document.createElement('div');
      meta.className = 'm94-card-meta';
      meta.textContent = `${entry.meta.difficulty} · ${entry.meta.durationLabel}`;
      const blurb = document.createElement('div');
      blurb.className = 'm94-card-blurb';
      blurb.textContent = entry.meta.blurb;
      card.append(tag, name, sub, meta, blurb);
      card.addEventListener('click', (event) => {
        event.stopPropagation();
        this.selectLevel(entry.meta.levelId);
      });
      cards.appendChild(card);
      this.cardButtons.push(card);
    }

    const modeLabel = document.createElement('div');
    modeLabel.className = 'm94-menu-label';
    modeLabel.textContent = 'SELECT MODE';

    const modes = document.createElement('div');
    modes.className = 'm94-modes';
    const classicButton = document.createElement('button');
    classicButton.className = 'm94-mode-button';
    classicButton.title = 'No checkpoint respawns. Official replay-enabled run.';
    const checkpointButton = document.createElement('button');
    checkpointButton.className = 'm94-mode-button m94-mode-checkpoint';
    checkpointButton.title = 'Crystals save progress. Deaths resume from the latest crystal. Practice run.';
    const classicTitle = document.createElement('div');
    classicTitle.className = 'm94-mode-title';
    classicTitle.textContent = 'CLASSIC';
    const classicDesc = document.createElement('div');
    classicDesc.className = 'm94-mode-desc';
    classicDesc.textContent = 'No checkpoint respawns. Official replay-enabled run.';
    classicButton.append(classicTitle, classicDesc);
    const checkpointTitle = document.createElement('div');
    checkpointTitle.className = 'm94-mode-title';
    checkpointTitle.textContent = 'CHECKPOINT';
    const checkpointDesc = document.createElement('div');
    checkpointDesc.className = 'm94-mode-desc';
    checkpointDesc.textContent = 'Crystals save progress. Practice run.';
    checkpointButton.append(checkpointTitle, checkpointDesc);
    classicButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.selectMode('classic');
    });
    checkpointButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.selectMode('checkpoint');
    });
    modes.append(classicButton, checkpointButton);

    const start = document.createElement('button');
    start.className = 'm94-start-button';
    start.textContent = 'START';
    start.addEventListener('click', (event) => {
      event.stopPropagation();
      this.onStart?.(this.selectedLevelId, this.selectedMode);
    });

    root.append(title, levelLabel, cards, modeLabel, modes, start);
    // Menu clicks are UI gestures, never gameplay input.
    root.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    container.appendChild(root);

    this.root = root;
    this.classicButton = classicButton;
    this.checkpointButton = checkpointButton;
    this.refresh();
  }

  public get selection(): { levelId: string; mode: RunMode } {
    return { levelId: this.selectedLevelId, mode: this.selectedMode };
  }

  public show(): void {
    this.root.style.display = 'flex';
  }

  public hide(): void {
    this.root.style.display = 'none';
  }

  public dispose(): void {
    this.root.remove();
  }

  private selectLevel(levelId: string): void {
    this.selectedLevelId = levelId;
    this.refresh();
  }

  private selectMode(mode: RunMode): void {
    this.selectedMode = mode;
    this.refresh();
  }

  private refresh(): void {
    for (const card of this.cardButtons) {
      card.classList.toggle('m94-selected', card.dataset.levelId === this.selectedLevelId);
    }
    this.classicButton.classList.toggle('m94-selected', this.selectedMode === 'classic');
    this.checkpointButton.classList.toggle('m94-selected', this.selectedMode === 'checkpoint');
  }
}
