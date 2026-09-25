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
 * M9.6: release button focus on activation (see Hud.blurButton — a focused
 * button re-fires on Space keyup, which reads as dropped gameplay input).
 */
const blurButton = (event: Event): void => {
  const target = event.currentTarget;
  if (target instanceof HTMLButtonElement) target.blur();
};

/**
 * M9.4 level/mode start screen (presentation only — `AppController` owns
 * the session lifecycle). One coherent screen: SELECT LEVEL (cards) →
 * SELECT MODE (classic/checkpoint) → START. The START gesture is the
 * audio unlock; it must not leak gameplay input (the Game flushes it).
 *
 * M9.6: the screen floats over the 3D island hub (`IslandHub`): the cards
 * are destination panels for the two islands (same DOM hooks, so legacy
 * QA keeps working), the mode buttons live inside an animated slider, and
 * island picks from the 3D scene select through the same state.
 */
export class LevelSelectView {
  public onStart: ((levelId: string, mode: RunMode) => void) | null = null;
  /** Mirrors every selection change into the 3D hub (AppController wires). */
  public onSelectionChange: ((levelId: string, mode: RunMode) => void) | null = null;

  private readonly root: HTMLElement;
  private readonly cardButtons: HTMLButtonElement[] = [];
  private readonly modeSlider: HTMLElement;
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

    for (const entry of entries) {
      const card = document.createElement('button');
      // M9.6: destination panel for a hub island. The legacy `m94-card`
      // hook stays (browser gates), the island styling rides alongside.
      card.className = 'm94-card m96-island-panel';
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
      // M9.6 destination marker: visible only on the selected panel.
      const dest = document.createElement('div');
      dest.className = 'm96-destination-tag';
      dest.textContent = '◆ ACTIVE DESTINATION';
      card.append(tag, name, sub, meta, blurb, dest);
      card.addEventListener('click', (event) => {
        event.stopPropagation();
        blurButton(event);
        this.selectLevel(entry.meta.levelId);
      });
      this.cardButtons.push(card);
    }

    const modeLabel = document.createElement('div');
    modeLabel.className = 'm94-menu-label';
    modeLabel.textContent = 'SELECT MODE';

    const modes = document.createElement('div');
    // M9.6 animated run-mode slider: the two legacy mode buttons ride
    // inside it (same hooks + same semantics), a sliding thumb shows the
    // active side. Classic left, checkpoint right.
    modes.className = 'm94-modes m96-mode-slider';
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Run mode');
    const thumb = document.createElement('div');
    thumb.className = 'm96-mode-thumb';
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
      blurButton(event);
      this.selectMode('classic');
    });
    checkpointButton.addEventListener('click', (event) => {
      event.stopPropagation();
      blurButton(event);
      this.selectMode('checkpoint');
    });
    modes.append(thumb, classicButton, checkpointButton);

    const start = document.createElement('button');
    start.className = 'm94-start-button';
    start.textContent = 'START';
    start.addEventListener('click', (event) => {
      event.stopPropagation();
      blurButton(event);
      this.onStart?.(this.selectedLevelId, this.selectedMode);
    });

    // M9.6 hub staging: the 3D vista owns the upper stage; the controls
    // dock in a bottom bar (island panel | mode slider + start | island
    // panel). Legacy hooks/queries are class-based, so the regrouping is
    // invisible to the browser gates. The empty `.m94-cards` shell stays
    // out of the tree (panels are direct bottom-bar children).
    const stage = document.createElement('div');
    stage.className = 'm96-stage';
    const bottomBar = document.createElement('div');
    bottomBar.className = 'm96-bottombar';
    const mid = document.createElement('div');
    mid.className = 'm96-mid';
    mid.append(modeLabel, modes, start);
    const firstCard = this.cardButtons[0];
    const secondCard = this.cardButtons[1];
    if (firstCard !== undefined) bottomBar.appendChild(firstCard);
    bottomBar.appendChild(mid);
    if (secondCard !== undefined) bottomBar.appendChild(secondCard);
    levelLabel.textContent = 'CHOOSE YOUR DESTINATION — CLICK AN ISLAND OR A PANEL';
    root.append(title, levelLabel, stage, bottomBar);
    // Menu clicks are UI gestures, never gameplay input.
    root.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    container.appendChild(root);

    this.root = root;
    this.modeSlider = modes;
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
    if (this.selectedLevelId === levelId) return;
    this.selectedLevelId = levelId;
    this.refresh();
    this.onSelectionChange?.(this.selectedLevelId, this.selectedMode);
  }

  /**
   * M9.6 public selection path for 3D island picks (same state + same
   * hub mirror as card clicks).
   */
  public select(levelId: string): void {
    this.selectLevel(levelId);
  }

  private selectMode(mode: RunMode): void {
    if (this.selectedMode === mode) return;
    this.selectedMode = mode;
    this.refresh();
    this.onSelectionChange?.(this.selectedLevelId, this.selectedMode);
  }

  private refresh(): void {
    for (const card of this.cardButtons) {
      card.classList.toggle('m94-selected', card.dataset.levelId === this.selectedLevelId);
    }
    this.classicButton.classList.toggle('m94-selected', this.selectedMode === 'classic');
    this.checkpointButton.classList.toggle('m94-selected', this.selectedMode === 'checkpoint');
    // M9.6 slider thumb: right side while checkpoint is armed.
    this.modeSlider.classList.toggle('m96-checkpoint', this.selectedMode === 'checkpoint');
  }
}
