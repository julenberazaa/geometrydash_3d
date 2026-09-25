import { Game, type GameOptions, type RunMode } from '../game/Game';
import type { RendererOptions } from '../rendering/RendererHost';
import { DEFAULT_CARD_LEVEL_ID, PRODUCTION_LEVEL_CARDS } from '../content/levelMetadata';
import { getLevel, resolveLevel } from '../content/levelRegistry';
import { LevelSelectView } from '../ui/LevelSelectView';
import { publishGameProbes, publishMenuProbes } from './gameProbes';

/**
 * M9.4 application-level coordinator (menu ↔ session lifecycle).
 *
 * - Bare URL → level/mode selector menu (no auto-start; the START gesture
 *   is the audio unlock).
 * - `?level=<id>` → direct entry into that level (legacy developer/debug
 *   behavior: tick-0 gate + press-to-start overlay).
 * - `?mode=classic|checkpoint` → preselects the mode on both paths.
 *
 * One `Game` owns exactly one selected `LevelDefinition`. Level changes
 * NEVER hot-swap content inside an active session: returning to the menu
 * disposes the session (music, renderer, listeners, loop, HUD, replay)
 * and the next START creates a fresh `Game`.
 */
export interface AppControllerOptions {
  levelId: string | null;
  mode: string | null;
  rendererOptions: RendererOptions;
  gameOptions: GameOptions;
}

export class AppController {
  private game: Game | null = null;
  private menu: LevelSelectView | null = null;
  private lastLevelId: string = DEFAULT_CARD_LEVEL_ID;
  private lastMode: RunMode = 'classic';
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: AppControllerOptions,
  ) {}

  public start(): void {
    const requested = this.options.levelId;
    if (requested !== null && requested !== '') {
      const resolution = resolveLevel(requested);
      if (!resolution.ok) {
        // Explicit fallback: visible in the console (never silent).
        console.warn(`[level] ${resolution.reason ?? 'unknown level requested'}`);
      }
      this.lastLevelId = resolution.level.id;
      this.lastMode = this.parseMode();
      this.game = this.startSession(this.lastLevelId, this.lastMode, false);
      return;
    }
    this.lastMode = this.parseMode();
    this.showMenu();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.game?.dispose();
    this.game = null;
    this.menu?.dispose();
    this.menu = null;
  }

  private parseMode(): RunMode {
    return this.options.mode === 'checkpoint' ? 'checkpoint' : 'classic';
  }

  /** Show the level/mode selector (fresh view, last selection kept). */
  private showMenu(): void {
    const entries = PRODUCTION_LEVEL_CARDS.map((meta) => ({
      meta,
      displayName: getLevel(meta.levelId)?.displayName ?? meta.levelId,
    }));
    publishMenuProbes(entries.map((e) => e.meta.levelId));
    this.menu = new LevelSelectView(
      this.container,
      entries,
      { levelId: this.lastLevelId, mode: this.lastMode },
    );
    this.menu.onStart = (levelId, mode): void => {
      if (this.game !== null) return;
      this.lastLevelId = levelId;
      this.lastMode = mode;
      this.menu?.hide();
      // The START click IS the audio gesture: create the session and start
      // it synchronously inside the click (autoplay policy), like the
      // legacy gate buttons.
      this.game = this.startSession(levelId, mode, true);
      this.game.startFromMenuGesture();
    };
  }

  /** Create + publish a fresh session for the selected level/mode. */
  private startSession(levelId: string, mode: RunMode, menuManaged: boolean): Game {
    const resolution = resolveLevel(levelId);
    const game = new Game(
      this.container,
      resolution.level,
      this.options.rendererOptions,
      this.options.gameOptions,
      {
        startMode: mode,
        menuManaged,
        onExitToMenu: (): void => {
          this.returnToMenu();
        },
      },
    );
    game.start();
    publishGameProbes(game);
    return game;
  }

  /** MAIN MENU from the pause menu: dispose the session, show the menu. */
  private returnToMenu(): void {
    this.game?.dispose();
    this.game = null;
    if (this.menu === null) {
      this.showMenu();
    } else {
      publishMenuProbes(PRODUCTION_LEVEL_CARDS.map((c) => c.levelId));
      this.menu.show();
    }
  }
}
