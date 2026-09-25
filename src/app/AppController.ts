import { Game, type GameOptions, type RunMode } from '../game/Game';
import type { RendererOptions } from '../rendering/RendererHost';
import { DEFAULT_CARD_LEVEL_ID, PRODUCTION_LEVEL_CARDS } from '../content/levelMetadata';
import { getLevel, resolveLevel } from '../content/levelRegistry';
import { LevelSelectView } from '../ui/LevelSelectView';
import { IslandHub } from '../menu/islandHub';
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
  /** M9.6 3D island hub (alive exactly while the menu is shown). */
  private hub: IslandHub | null = null;
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
    this.stopHub();
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
    const cardIds = entries.map((e) => e.meta.levelId);
    this.menu = new LevelSelectView(
      this.container,
      entries,
      { levelId: this.lastLevelId, mode: this.lastMode },
    );
    // M9.6 3D hub behind the menu (menu XOR session canvas — the hub is
    // built fresh on every menu entry and disposed on every START).
    this.startHub(cardIds, this.lastLevelId);
    publishMenuProbes(cardIds, this.hub, this.menu);
    this.menu.onSelectionChange = (levelId, mode): void => {
      this.lastLevelId = levelId;
      this.lastMode = mode;
      this.hub?.setSelected(levelId);
    };
    this.menu.onStart = (levelId, mode): void => {
      if (this.game !== null) return;
      this.lastLevelId = levelId;
      this.lastMode = mode;
      this.stopHub();
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
      // Rebuild the hub (it was disposed on START — menu XOR session).
      this.startHub(
        PRODUCTION_LEVEL_CARDS.map((c) => c.levelId),
        this.lastLevelId,
      );
      publishMenuProbes(
        PRODUCTION_LEVEL_CARDS.map((c) => c.levelId),
        this.hub,
        this.menu,
      );
      this.menu.show();
    }
  }

  /**
   * M9.6 hub lifecycle (single owner): build + start a fresh hub behind
   * the menu, wired to the live selection. Stopped + disposed on START
   * and on controller disposal — exactly one canvas alive at a time.
   */
  private startHub(cardIds: readonly string[], selectedLevelId: string): void {
    this.stopHub();
    if (cardIds.length < 2) return;
    const hub = new IslandHub(
      this.container,
      [cardIds[0] ?? '', cardIds[1] ?? ''],
      selectedLevelId,
    );
    hub.onPick = (levelId): void => {
      this.menu?.select(levelId);
    };
    hub.start();
    this.hub = hub;
  }

  private stopHub(): void {
    this.hub?.dispose();
    this.hub = null;
  }
}
