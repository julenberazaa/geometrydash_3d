import { FixedStepLoop } from '../core/FixedStepLoop';
import { SIMULATION_DT, SIMULATION_HZ } from '../core/constants';
import { InputSystem } from '../input/InputSystem';
import { PerfProfiler, type PerfSnapshot } from '../debug/perfProfiler';
import { GameSimulation } from './GameSimulation';
import { RendererHost, type RendererOptions } from '../rendering/RendererHost';
import { DeathSfx } from '../audio/deathSfx';
import { MusicDirector } from '../audio/MusicDirector';
import { targetMusicTime } from '../audio/musicTrack';
import { gridForAudioPath } from '../audio/zenithTrack';
import { Hud } from '../ui/Hud';
import { DebugOverlay } from '../debug/DebugOverlay';
import { TEST_LEVEL } from '../content/levels/testLevel01';
import { ReplayCoordinator, type ReplayVerification } from '../replay/ReplayCoordinator';
import { RunModeController, type AttemptKind, type RunMode } from './runModeController';
import { PauseMenuView } from '../ui/PauseMenuView';
import type { LevelDefinition } from '../level/levelDefinition';

/**
 * M9.4 re-export: the run-mode vocabulary lives in `runModeController.ts`
 * (single owner); existing importers keep working.
 */
export type { RunMode };
export type { AttemptKind };

/** M6D Game-level options (presentation/QA only — never gameplay). */
export interface GameOptions {
  /** Enable the DEBUG frame profiler (`?perf=1`). Default off. */
  perfEnabled?: boolean;
  /** M9: music transport on/off (`?music=off` disables). Default on. */
  musicEnabled?: boolean;
  /**
   * M9.1 QA slow-motion: override the fixed-step catch-up budget
   * (`?stepcap=N`, clamped 1..8). Fewer steps per frame = finer input
   * delivery quantum for precision QA on slow software renderers, at the
   * cost of sim-vs-wall speed. The tick ORDER, count and physics are
   * identical — replays verify across cap values. Default: engine budget.
   */
  maxCatchUpSteps?: number;
}

/**
 * M9.4 session config (menu/app scope — the chosen level+mode enter here).
 */
export interface GameSessionConfig {
  /**
   * Run mode the session starts in (menu selection or `?mode=`). Default
   * classic. The session always opens a FRESH attempt in this mode.
   */
  startMode?: RunMode;
  /**
   * True when an app-level menu already chose level+mode: the Game skips
   * its own mode-selector gate UI (the START gesture still unlocks audio).
   */
  menuManaged?: boolean;
  /** M9.4 MAIN MENU from the pause menu (the AppController disposes). */
  onExitToMenu?: () => void;
}

/**
 * Game: composition root. Wires input -> simulation -> renderer -> UI.
 * All gameplay runs inside GameSimulation via the FixedStepLoop; this class
 * contains no gameplay logic.
 *
 * M9.4: a Game instance owns exactly ONE selected LevelDefinition for one
 * session. It owns the run mode + practice taint (via RunModeController —
 * the sim owns only the snapshot mechanics), applies mode switches onto
 * the sim flag + crystal visibility + HUD + replay lifecycle, and offers
 * the pause menu (resume / live mode switch / full restart / exit).
 */
export class Game {
  private readonly loop: FixedStepLoop;
  private readonly input = new InputSystem();
  private readonly simulation: GameSimulation;
  private readonly replay: ReplayCoordinator;
  private readonly rendererHost: RendererHost;
  private readonly deathSfx: DeathSfx;
  private readonly hud: Hud;
  private readonly debugOverlay: DebugOverlay;
  /**
   * M9 music transport (presentation-owned). Present ONLY when the level
   * declares `musicTrack` and music is enabled — other levels start
   * immediately and stay silent (no behavior change).
   */
  private readonly music: MusicDirector | null;
  private readonly trackOffset: number;
  /** M9 start gate: tick-0 hold for the first-gesture audio unlock. */
  private readonly startGated: boolean;
  /**
   * M9.2 mode selector: true when the level authors checkpoints. The gate
   * then offers CLASSIC vs CHECKPOINT (one click = mode + audio unlock +
   * start); it also gates `?music=off` checkpoint runs (no audio path —
   * the click starts immediately in the chosen mode).
   */
  private readonly modeSelect: boolean;
  /**
   * M9.4 session mode + practice taint (single owner for the officiality
   * question; the sim owns only the snapshot mechanics). `attemptKind`
   * answers whether the current attempt may complete officially.
   */
  private readonly mode = new RunModeController();
  private readonly sessionConfig: GameSessionConfig;
  private readonly pauseMenu: PauseMenuView;
  private started = false;
  private gatePending = false;
  /**
   * M9.1 fail-loud gate: audio failure NEVER auto-starts gameplay. The
   * gate latches failed (loop stays paused, failure overlay visible) until
   * the human retries (gesture) or explicitly starts silent (N).
   */
  private gateFailed = false;
  /** Explicit human silent start after a failure (audible gate declined). */
  private silentStart = false;
  private prevStatus: string | null = null;

  private paused = false;
  private debugInfoVisible = false;
  /** Total jumps initiated this session (QA observability; gameplay never reads it). */
  private jumpCount = 0;

  /** Render FPS estimate (exponential moving average of frame times). */
  private fpsEma = 60;
  private lastFrameTimeMs = performance.now();
  private disposed = false;
  /** M6D DEBUG profiler switch (branch only when off). */
  private readonly perfEnabled: boolean;
  /** M6D bounded frame profiler (records only when enabled). */
  private readonly perf = new PerfProfiler();

  constructor(
    private readonly container: HTMLElement,
    levelDef: LevelDefinition = TEST_LEVEL,
    rendererOptions: RendererOptions = {},
    gameOptions: GameOptions = {},
    session: GameSessionConfig = {},
  ) {
    this.sessionConfig = session;
    // M6D frame profiler (DEBUG/PERF-only, above gameplay): off by default
    // (`?perf=1` enables) — one branch per frame when disabled.
    this.perfEnabled = gameOptions.perfEnabled ?? false;
    this.deathSfx = new DeathSfx();
    // M9: bind music transport to levels that declare a track (opt-out via
    // `?music=off`). Eager byte preload; decode + context wait for the
    // first gesture (autoplay policy).
    const musicEnabled = gameOptions.musicEnabled ?? true;
    const track = musicEnabled ? levelDef.musicTrack ?? null : null;
    this.trackOffset = track?.trackOffset ?? 0;
    this.music = track !== null ? new MusicDirector(track.audioPath) : null;
    this.modeSelect = (levelDef.checkpoints?.length ?? 0) > 0;
    this.startGated = this.music !== null || this.modeSelect;
    // Non-gated levels are "started" from tick 0 (legacy immediate start).
    this.started = !this.startGated;
    // M9.4: the session opens a FRESH attempt in the selected mode (menu
    // choice or `?mode=`; default classic). The sim flag + crystal
    // visibility mirror it from tick 0.
    const startMode = session.startMode ?? 'classic';
    this.mode.beginAttempt(startMode);
    this.pendingMode = startMode;
    this.music?.preload();
    this.simulation = new GameSimulation(levelDef, {
      onJump: () => {
        this.jumpCount++;
        // M6B: bridge the REAL jump event to presentation (one signal =
        // one visual burst). Composition-root wiring only — the sim is
        // untouched and never knows the renderer exists.
        this.rendererHost.notifyJump();
      },
      onDeath: () => {
        this.hud.setMessage('');
        this.deathSfx.play();
      },
      onFinish: () => {
        // M9.4: practice-tainted attempts are NEVER official clean runs —
        // the partial tape is discarded (F4 stays clean-classic-only) and
        // the banner says PRACTICE COMPLETE.
        if (this.mode.attemptKind === 'practice') {
          this.replay.discardRecording();
          this.hud.setMessage('PRACTICE COMPLETE — press R to run again');
        } else {
          this.hud.setMessage('LEVEL COMPLETE — press R to run again');
        }
      },
    });
    if (this.mode.runMode === 'checkpoint') this.simulation.setCheckpointRespawnEnabled(true);
    // Replay orchestration lives ABOVE the simulation: the coordinator picks
    // the live-vs-tape input source each fixed tick and verifies playback.
    // GameSimulation never knows replay exists.
    this.replay = new ReplayCoordinator(this.simulation);
    this.rendererHost = new RendererHost(container, this.simulation, rendererOptions);
    this.rendererHost.setCheckpointsVisible(startMode === 'checkpoint');
    this.hud = new Hud(container);
    this.debugOverlay = new DebugOverlay(container);
    this.pauseMenu = new PauseMenuView(container, {
      onResume: () => {
        if (this.started) this.setPausedState(false);
      },
      onModeSelect: (mode) => {
        this.setRunMode(mode);
        if (this.paused) this.pauseMenu.refresh(this.mode.runMode, this.mode.practiceTainted);
      },
      onRestart: () => {
        if (!this.started) return;
        this.fullRestart();
        this.setPausedState(false);
      },
      onExitToMenu: () => {
        this.sessionConfig.onExitToMenu?.();
      },
    });

    this.loop = new FixedStepLoop(
      {
        update: (_dt) => {
          // M5 replay protocol, same order as the headless test helpers:
          // arm recording -> pick live-vs-tape input -> simulate -> verify.
          // input.sample() is ALWAYS consumed so live edges can never leak
          // across a replay (keyboard input during playback is dropped).
          this.replay.beforeSimTick();
          const liveInput = this.input.sample();
          this.simulation.update(this.replay.getInputForTick(liveInput));
          this.replay.afterSimTick();
        },
        render: (alpha: number, renderDt: number) => {
          this.frameRender(alpha, renderDt);
        },
      },
      { stepDt: SIMULATION_DT, maxCatchUpSteps: gameOptions.maxCatchUpSteps },
    );

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    this.input.attach(window);
    // M9.6 pointer primary action (click/tap = Space-equivalent press).
    // UI controls opt out inside InputSystem (button targets ignored).
    this.input.attachPointer(this.container);
    this.container.addEventListener('click', this.onClick);
    // M9.2 mode selector: the button clicks are the audio gesture (they
    // stopPropagation, so bare container clicks fall through to the pending
    // mode). Skipped when an app-level menu already chose the mode.
    this.hud.onModeSelect = (mode): void => {
      this.startRun(mode);
    };
    // M9.4.1 corner MENU button: opens the pause menu (same as ESC/P).
    // Ignored before the run starts and while paused (the pause menu owns
    // RESUME there) — a menu click is never gameplay input.
    this.hud.onMenuRequest = (): void => {
      if (this.started && !this.paused && !this.gatePending) this.setPausedState(true);
    };
    if (this.startGated) {
      // M9 start gate: the level renders frozen at tick 0 under the
      // press-to-start overlay — gameplay and music begin together on the
      // first gesture, never seconds apart.
      this.loop.setPaused(true);
      if (this.modeSelect && !session.menuManaged) {
        this.hud.setModeSelector(`${levelDef.displayName} — SELECT RUN`);
      } else if (!session.menuManaged) {
        this.hud.setStartGate('PRESS SPACE / CLICK TO START');
      }
      // Menu-managed sessions show no gate text: the menu overlay covers
      // the frozen tick-0 scene until the START gesture starts the run.
    }
    this.refreshModePresentation();
  }

  public start(): void {
    this.input.setEnabled(true);
    this.loop.start();
  }

  /** M9 QA observability: true while the press-to-start gate is holding. */
  public get awaitingStart(): boolean {
    return this.startGated && !this.started;
  }

  /** M9 QA observability: true while the start-gate audio handoff is pending. */
  public get startGatePending(): boolean {
    return this.gatePending;
  }

  /** M9.1 QA observability: true while the fail-loud gate holds on audio failure. */
  public get startGateFailed(): boolean {
    return this.gateFailed;
  }

  /** QA observability: fixed steps executed (pause-freeze proof). */
  public get simSteps(): number {
    return this.loop.totalSteps;
  }

  /** M9.1 QA observability: effective per-frame catch-up budget (stepcap proof). */
  public get stepCap(): number {
    return this.loop.stepsBudget;
  }

  public get musicDirector(): MusicDirector | null {
    return this.music;
  }

  /** M9.2 active run mode (QA observability). */
  public get activeRunMode(): RunMode {
    return this.mode.runMode;
  }

  /** M9.4 officiality of the current attempt (QA observability + HUD). */
  public get attemptKind(): AttemptKind {
    return this.mode.attemptKind;
  }

  /**
   * M9.4 menu-gesture start: the app-level START click already chose
   * (level, mode) — this performs the audio unlock + run start inside that
   * same user gesture (autoplay policy), like the legacy gate buttons.
   */
  public startFromMenuGesture(): void {
    this.startRun(this.mode.runMode);
  }

  /**
   * M9.4 LIVE mode switch (pause menu / QA): toggles checkpoint mode
   * mid-attempt without reloading. Arming checkpoint mode taints the
   * attempt as PRACTICE (permanent until a full restart); disarming never
   * un-taints. Position, music and camera are untouched — only the sim
   * flag, crystal visibility, HUD and replay eligibility change. Earned
   * checkpoint snapshots stay cached in the sim (retention rule) but are
   * unusable while classic is active. Ignored before start, during the
   * audio handoff, and during replay playback.
   */
  public setRunMode(mode: RunMode): void {
    if (!this.started || this.gatePending || this.replay.isPlaying) return;
    const changed = this.mode.setMode(mode);
    const checkpoint = this.mode.runMode === 'checkpoint';
    this.simulation.setCheckpointRespawnEnabled(checkpoint);
    this.rendererHost.setCheckpointsVisible(checkpoint);
    if (changed && checkpoint) {
      // The attempt is now practice: the in-progress partial tape must
      // never finalize into a hybrid classic+practice recording.
      this.replay.discardRecording();
    }
    this.refreshModePresentation();
  }

  /**
   * M9.4 FULL restart from the origin in the CURRENTLY selected mode
   * (Shift+R / pause RESTART LEVEL): clears checkpoint progress, clears
   * the practice taint, and opens a fresh attempt. Classic restarts clean;
   * checkpoint restarts practice.
   */
  public fullRestart(): void {
    if (this.replay.isPlaying) this.replay.abortReplay();
    else this.replay.discardRecording();
    this.simulation.restartRun();
    const mode = this.mode.runMode;
    this.mode.beginAttempt(mode);
    this.simulation.setCheckpointRespawnEnabled(mode === 'checkpoint');
    this.rendererHost.setCheckpointsVisible(mode === 'checkpoint');
    if (!this.silentStart) this.music?.restart();
    this.refreshModePresentation();
    this.hud.setMessage('');
  }

  /**
   * M9.2 run start (fail-loud contract): mode select + audio gesture +
   * game start in ONE user gesture. Bare clicks/keys default to classic
   * (legacy QA + muscle memory); the CHECKPOINT button (or C/2) arms
   * practice mode. Audio failure NEVER starts gameplay silently — the
   * gate latches failed with a loud overlay until the human retries
   * (gesture) or explicitly starts without music (N). `?music=off`
   * levels without checkpoints never enter this path (no gate at all).
   */
  private startRun(mode: RunMode): void {
    if (!this.startGated || this.started || this.gatePending) return;
    // Remember the request for the silent-start fallback (N).
    this.pendingMode = mode;
    // A latched failure retries on every fresh gesture (same path).
    this.gatePending = true;
    this.gateFailed = false;
    this.hud.setStartGate('LOADING MUSIC…');
    // Synchronous user-activation edge: the AudioContext must be created/
    // resumed inside the gesture handler (autoplay policy), never from a
    // promise microtask.
    this.music?.beginGesture();
    // Flush the gesture press edge so the unlocking Space never jumps.
    this.input.sample();
    const director = this.music;
    if (director === null) {
      // No-music selector path (`?music=off` + checkpoints): the mode
      // click starts immediately in the chosen mode, no audio involved.
      this.applyRunMode(mode);
      this.started = true;
      this.silentStart = true;
      this.gatePending = false;
      this.hud.setModeSelector(null);
      this.hud.setStartGate(null);
      this.loop.setPaused(false);
      return;
    }
    void Promise.resolve()
      .then(() => director.ensure())
      .then((ready) => {
        if (this.disposed) return;
        if (ready && director.restart()) {
          this.applyRunMode(mode);
          this.started = true;
          this.gatePending = false;
          this.hud.setModeSelector(null);
          this.hud.setStartGate(null);
          // M9.6: flush presses accumulated during the async music handoff
          // so they cannot fire as a stale tick-0 jump/spider edge.
          this.input.sample();
          this.loop.setPaused(false);
        } else {
          // LOUD failure: loop stays paused, overlay demands action.
          this.gatePending = false;
          this.gateFailed = true;
          this.hud.setStartGate('MUSIC LOAD FAILED — CLICK TO RETRY / PRESS N TO START WITHOUT MUSIC');
        }
      });
  }

  /**
   * M9.4: apply the chosen run mode for a FRESH attempt (sim flag +
   * crystal visibility + HUD). Single owner for fresh-attempt mode
   * application — gate, silent and music-off paths all converge here.
   * (Mid-attempt switches go through `setRunMode`, never here.)
   */
  private applyRunMode(mode: RunMode): void {
    this.mode.beginAttempt(mode);
    this.simulation.setCheckpointRespawnEnabled(mode === 'checkpoint');
    this.rendererHost.setCheckpointsVisible(mode === 'checkpoint');
    this.refreshModePresentation();
  }

  /**
   * M9.4 HUD mode presentation (single owner): checkpoint runs show the
   * checkpoint badge; clean classic shows nothing; practice-tainted
   * classic shows an honest PRACTICE banner so it can never be mistaken
   * for an official run.
   */
  private refreshModePresentation(): void {
    if (this.mode.runMode === 'checkpoint') {
      this.hud.setModeBadge('CHECKPOINT MODE · R checkpoint · SHIFT+R full restart');
    } else if (this.mode.practiceTainted) {
      this.hud.setModeBadge('CLASSIC CONTROLS — PRACTICE RUN');
      this.hud.setCheckpointProgress(null);
    } else {
      this.hud.setModeBadge(null);
      this.hud.setCheckpointProgress(null);
    }
  }

  /**
   * M9.1 explicit silent start: ONLY from the latched failure state, ONLY
   * via a deliberate keypress. Never automatic, never a timeout. Starts
   * in the last selected mode (classic until a mode button is pressed).
   */
  private startWithoutMusic(): void {
    if (!this.startGated || this.started || !this.gateFailed) return;
    this.applyRunMode(this.pendingMode);
    this.started = true;
    this.silentStart = true;
    this.gateFailed = false;
    this.hud.setModeSelector(null);
    this.hud.setStartGate(null);
    this.hud.setMessage('STARTED WITHOUT MUSIC');
    this.input.sample();
    this.loop.setPaused(false);
  }

  /** Last mode requested at the gate (silent-start fallback). */
  private pendingMode: RunMode = 'classic';

  /**
   * M9.2 music restart boundary: classic restarts at the track origin;
   * checkpoint restarts (death auto-respawn, R) re-seek to the deterministic
   * checkpoint sim time so the world and the song stay aligned. Silent runs
   * have no transport to restart.
   */
  private restartMusicForSimTime(): void {
    const director = this.music;
    if (director === null || this.silentStart) return;
    if (this.mode.runMode === 'checkpoint') {
      director.restartAt(targetMusicTime(this.simulation.elapsedSimTime, this.trackOffset));
    } else {
      director.restart();
    }
  }

  private onClick = (): void => {
    this.deathSfx.ensure();
    this.startRun(this.pendingMode);
  };

  public get totalJumps(): number {
    return this.jumpCount;
  }

  /** Replay observability for main.ts probes, HUD and debug overlay. */
  public get replayCoordinator(): ReplayCoordinator {
    return this.replay;
  }

  public get gameSimulation(): GameSimulation {
    return this.simulation;
  }

  public get gameRendererHost(): RendererHost {
    return this.rendererHost;
  }

  public stop(): void {
    this.loop.stop();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.input.detach(window);
    this.container.removeEventListener('click', this.onClick);
    this.pauseMenu.dispose();
    this.rendererHost.dispose();
    this.deathSfx.dispose();
    this.music?.dispose();
    // M9.4.1: remove session DOM (no hidden HUD/debug residue across
    // menu returns — the next START builds a fresh Hud + DebugOverlay).
    this.hud.dispose();
    this.debugOverlay.dispose();
  }

  /**
   * M9.4 pause with menu (single owner for the paused state): freezes the
   * sim loop, music, input and camera smoothing; the mode choice happens
   * frozen and RESUME continues at identical elapsedSimTime.
   */
  private setPausedState(paused: boolean): void {
    this.paused = paused;
    this.loop.setPaused(paused);
    if (paused) {
      this.music?.pause();
      this.pauseMenu.show(this.mode.runMode, this.mode.practiceTainted);
    } else {
      // Resume audio BEFORE the sim so both continue from the same
      // deterministic position (residual drift self-corrects below).
      this.pauseMenu.hide();
      this.music?.resume();
    }
    this.input.setEnabled(!paused);
    this.hud.setMessage(paused ? 'PAUSED' : '');
  }

  private onResize = (): void => {
    this.rendererHost.resize(this.container.clientWidth, this.container.clientHeight);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    // First gesture unlocks the (guarded, optional) death blip.
    this.deathSfx.ensure();
    // M9.4: the unlocking press only starts audio + sim (the edge is
    // flushed in startRun so it never becomes gameplay input). Space picks
    // the pending mode (classic default, `?mode=` preselect); C / 2 picks
    // CHECKPOINT RUN. N is the EXPLICIT silent start, honored only from
    // the latched failure state.
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'Digit1') {
      this.startRun(this.pendingMode);
    }
    if (event.code === 'KeyC' || event.code === 'Digit2') this.startRun('checkpoint');
    if (event.code === 'KeyN') this.startWithoutMusic();
    if (this.gatePending) return;
    switch (event.code) {
      case 'KeyR':
        // The start gate owns pre-start input (no restart before tick 0).
        if (!this.started) break;
        if (event.shiftKey) {
          // M9.4 Shift+R (both modes): FULL origin restart in the CURRENT
          // mode — progress cleared, practice taint cleared, fresh attempt.
          this.fullRestart();
        } else {
          // Manual restart ends the current context: abort an active
          // playback, otherwise discard the partial live tape, then restart
          // the attempt.
          if (this.replay.isPlaying) this.replay.abortReplay();
          else this.replay.discardRecording();
          // R restarts from the latest checkpoint in checkpoint mode
          // (sim routes it), from the origin in classic.
          this.simulation.restart();
          // R-from-running produces no dead→running edge, so restart music
          // explicitly (checkpoint-aware: re-seeks to the checkpoint time).
          this.restartMusicForSimTime();
          this.hud.setMessage('');
        }
        break;
      case 'KeyP':
      case 'Escape':
        if (!this.started) break;
        this.setPausedState(!this.paused);
        break;
      case 'KeyM':
        // M9 presentation-only music mute toggle (gameplay untouched).
        if (this.music !== null) this.music.setMuted(!this.music.isMuted);
        break;
      case 'F1':
        event.preventDefault();
        this.debugInfoVisible = !this.debugInfoVisible;
        this.debugOverlay.setVisible(this.debugInfoVisible);
        break;
      case 'F2':
        event.preventDefault();
        this.debugCollidersOn = !this.debugCollidersOn;
        this.rendererHost.setDebugCollidersVisible(this.debugCollidersOn);
        break;
      case 'F3':
        event.preventDefault();
        this.debugPlayerBoxOn = !this.debugPlayerBoxOn;
        this.rendererHost.setDebugPlayerBoxVisible(this.debugPlayerBoxOn);
        break;
      case 'F4': {
        // Minimal replay control: replay the last completed attempt.
        // Ignored while a playback is already active.
        event.preventDefault();
        if (!this.started) break;
        // M9.4: practice-tainted attempts are never official completions —
        // F4 stays a clean-classic feature (a restore discontinuity is not
        // an input and could never verify anyway).
        if (this.mode.attemptKind === 'practice') {
          this.hud.setMessage('PRACTICE ATTEMPT — REPLAY DISABLED');
          break;
        }
        const last = this.replay.lastReplay;
        if (last !== null) {
          const started = this.replay.startReplay(last);
          if (!started.ok) this.hud.setMessage(`REPLAY REJECTED — ${started.reason}`);
          else {
            // F4 playback follows replay sim time from the origin.
            this.music?.restart();
            this.hud.setMessage('');
          }
        }
        break;
      }
      default:
        break;
    }
  };

  private debugCollidersOn = false;
  private debugPlayerBoxOn = false;

  /** M6D rolling frame-delivery statistics (cold QA path; zeros when off). */
  public perfSnapshot(): PerfSnapshot {
    return this.perf.snapshot();
  }

  /** M6D discard profiler warmup (cold QA path; the harness calls this
   *  after load/shader warmup, before the measured window). */
  public perfBeginSampling(): void {
    this.perf.beginSampling();
  }

  public get isPerfEnabled(): boolean {
    return this.perfEnabled;
  }

  /** Render-side frame work; gameplay state is only READ here. */
  private frameRender(alpha: number, renderDtSeconds: number): void {
    // FPS EMA.
    const nowMs = performance.now();
    if (this.perfEnabled) this.perf.recordFrame(nowMs);
    const measuredDt = nowMs - this.lastFrameTimeMs;
    this.lastFrameTimeMs = nowMs;
    if (measuredDt > 0 && measuredDt < 1000) {
      this.fpsEma += (1000 / measuredDt - this.fpsEma) * 0.05;
    }

    // Presentation pause freeze (M6B): while paused the sim takes no
    // steps AND visuals take no render time — trail, particles, rings,
    // burst, tumble and camera smoothing all freeze instead of drifting on
    // wall-clock dt. Simulation pause behavior is untouched.
    this.rendererHost.applyFrame(alpha, this.paused ? 0 : renderDtSeconds);
    this.rendererHost.render();
    // M9 music lifecycle edges + drift follow (presentation-only — the
    // sim clock is the master, audio output follows it):
    // running→dead cuts during the hold; dead→running restarts at the
    // origin on respawn; finish cuts (the tail rings out); every frame
    // the transport chases the deterministic target (dead-band/resync).
    this.updateMusic();
    // DOM overlays follow the render freeze so frozen QA frames (and their
    // screenshots) show death-moment HUD/debug state, not live respawn state.
    if (this.rendererHost.debugFreezeFrame) return;

    this.hud.update({
      displayName: this.simulation.level.def.displayName,
      progress: this.simulation.progress,
      attempts: this.simulation.attempts,
    });
    this.hud.setReplayBadge(this.replay.hudBadge);
    // M9.2 checkpoint progress readout (checkpoint runs only).
    if (this.mode.runMode === 'checkpoint') {
      const { activeIndex, total } = this.simulation.checkpointProgress();
      const activeId = this.simulation.activeCheckpointId;
      const label =
        activeId !== null
          ? (this.simulation.level.checkpoints.find((c) => c.id === activeId)?.displayName ?? activeId)
          : 'START';
      this.hud.setCheckpointProgress(`CHECKPOINT ${activeIndex}/${total} — ${label}`);
    }

    if (this.debugInfoVisible) {
      this.updateDebugOverlay();
    }
  }

  private updateMusic(): void {
    const director = this.music;
    if (director === null) {
      this.prevStatus = this.simulation.status;
      return;
    }
    const status = this.simulation.status;
    if (this.prevStatus === 'running' && status === 'dead') director.cut();
    // M9.2: checkpoint auto-respawn re-seeks to the checkpoint time
    // (world + song stay aligned); classic restarts at the origin.
    else if (this.prevStatus === 'dead' && status === 'running') this.restartMusicForSimTime();
    else if (this.prevStatus !== 'finished' && status === 'finished') director.cut();
    this.prevStatus = status;
    if (this.started && !this.paused && !this.gatePending) {
      director.syncToTarget(targetMusicTime(this.simulation.elapsedSimTime, this.trackOffset));
    }
  }

  /** M9 F1 line: deterministic target vs audible transport vs drift. */
  private musicStatusLine(): string {
    const director = this.music;
    if (director === null) return 'music: — (level declares no track)';
    const probe = director.probe();
    const target = targetMusicTime(this.simulation.elapsedSimTime, this.trackOffset);
    // M9.5: section/beat resolve on the level's own track grid (Gravity
    // default keeps Rift output identical; Zenith names its own sections).
    const grid = gridForAudioPath(this.simulation.level.def.musicTrack?.audioPath);
    const section = grid.sectionAtTime(target);
    const beat = grid.beatAtTime(target);
    return (
      `music: ${probe.state}${probe.muted ? ' muted' : ''} | target ${target.toFixed(2)}s` +
      ` | actual ${probe.actualTime.toFixed(2)}s | drift ${probe.driftMs.toFixed(0)}ms` +
      ` | ${section.id} beat ${beat}`
    );
  }

  private updateDebugOverlay(): void {    const sim = this.simulation;
    const p = sim.player;
    const stats = this.rendererHost.stats;
    const frame = sim.gameplayFrame;
    const laneCount = sim.level.def.laneCenters.length;
    this.debugOverlay.update([
      `sim: ${SIMULATION_HZ} Hz | render fps ~${this.fpsEma.toFixed(1)} | steps/frame ${this.loop.stepsLastFrame} | discarded ms ${this.loop.discardedMsLastFrame.toFixed(2)} | alpha ${this.loop.interpolationAlpha.toFixed(3)}`,
      `pos: (${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)})`,
      `vel: (${p.velocity.x.toFixed(2)}, ${p.velocity.y.toFixed(2)}, ${p.velocity.z.toFixed(2)})`,
      `lane target: ${p.targetLaneIndex} / ${laneCount} | x: ${p.position.x.toFixed(3)} | vx: ${p.velocity.x.toFixed(2)}`,
      `grounded: ${String(p.grounded)} | support: ${p.supportColliderId ?? '—'}`,
      `gravity: ${sim.gravityMode} | g: (${frame.gravityVector.x},${frame.gravityVector.y},${frame.gravityVector.z}) | N: (${frame.surfaceNormal.x},${frame.surfaceNormal.y},${frame.surfaceNormal.z}) | laneAxis: (${frame.laneAxis.x},${frame.laneAxis.y},${frame.laneAxis.z})`,
      `portal: ${sim.lastPortalId ?? '—'} | flips: ${sim.portalTransitionCount} | mode: ${sim.playerMode} (${sim.lastModePortalId ?? '—'}/${sim.modeTransitionCount})`,
      `speed: ${sim.speedMultiplier}x (${sim.currentForwardSpeed.toFixed(1)} u/s) | pads: ${sim.padActivationCount} | orbs: ${sim.orbActivationCount} | speedPortals: ${sim.speedPortalCount} | last: ${sim.lastInteractionId ?? '—'}`,
      `status: ${sim.status} | attempt: ${sim.attempts} | progress: ${(sim.progress * 100).toFixed(1)}%`,
      `death: cause=${sim.lastDeathCause ?? '—'} | lethal=${sim.lastDeathLethalId ?? '—'} | holdTicks=${sim.deathHoldTicksLeft} | status=${sim.status}`,
      `replay: mode=${this.replay.mode} | tick=${this.replay.replayTick} | frames=${this.replay.replayFrameCount ?? this.replay.lastReplay?.frameCount ?? '—'} | hasReplay=${this.replay.lastReplay !== null} | verify=${formatVerification(this.replay.verification)}`,
      `replayLevel: ${this.replay.lastReplay?.levelId ?? this.simulation.level.def.id} | fp=${this.replay.levelFingerprint.slice(0, 8)} | hash=${this.replay.lastStateHash?.slice(0, 8) ?? '—'} | hz=${SIMULATION_HZ}`,
      `contactN: (${sim.lastContactNormal.x.toFixed(1)}, ${sim.lastContactNormal.y.toFixed(1)}, ${sim.lastContactNormal.z.toFixed(1)}) | preVel: (${sim.lastPreImpactVelocity.x.toFixed(1)}, ${sim.lastPreImpactVelocity.y.toFixed(1)}, ${sim.lastPreImpactVelocity.z.toFixed(1)})`,
      `draw calls: ${stats.calls} | tris: ${stats.triangles}`,
      this.musicStatusLine(),
    ]);
  }
}

/** Compact one-line replay verification state for the F1 overlay. */const formatVerification = (v: ReplayVerification): string => {
  switch (v.kind) {
    case 'idle':
      return 'idle';
    case 'running':
      return 'running';
    case 'pass':
      return 'pass';
    case 'rejected':
      return `rejected(${v.reason})`;
    case 'diverged':
      return `diverged@tick${v.tick}`;
  }
};
