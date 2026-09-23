import { FixedStepLoop } from '../core/FixedStepLoop';
import { SIMULATION_DT, SIMULATION_HZ } from '../core/constants';
import { InputSystem } from '../input/InputSystem';
import { PerfProfiler, type PerfSnapshot } from '../debug/perfProfiler';
import { GameSimulation } from './GameSimulation';
import { RendererHost, type RendererOptions } from '../rendering/RendererHost';
import { DeathSfx } from '../audio/deathSfx';
import { MusicDirector } from '../audio/MusicDirector';
import { beatAtTime, sectionAtTime, targetMusicTime } from '../audio/musicTrack';
import { Hud } from '../ui/Hud';
import { DebugOverlay } from '../debug/DebugOverlay';
import { TEST_LEVEL } from '../content/levels/testLevel01';
import { ReplayCoordinator, type ReplayVerification } from '../replay/ReplayCoordinator';
import type { LevelDefinition } from '../level/levelDefinition';

/**
 * M9.2 run mode (presentation/session scope — never gameplay physics).
 * CLASSIC: death restarts from the level origin (current behavior).
 * CHECKPOINT: practice — death auto-respawns from the latest activated
 * crystal (GameSimulation snapshot), with music re-seeking to the
 * checkpoint time. Checkpoint runs are never official ReplayV1
 * completions. One concept, one owner: Game owns the MODE, the sim owns
 * the snapshot mechanics.
 */
export type RunMode = 'classic' | 'checkpoint';

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
 * Game: composition root. Wires input -> simulation -> renderer -> UI.
 * All gameplay runs inside GameSimulation via the FixedStepLoop; this class
 * contains no gameplay logic.
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
  /** M9.2 active run mode (chosen at the gate; classic until chosen). */
  private runMode: RunMode = 'classic';
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
  ) {
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
        // M9.2: checkpoint-mode completions are PRACTICE, never official
        // clean runs — the partial tape is discarded (F4 stays classic).
        if (this.runMode === 'checkpoint') {
          this.replay.discardRecording();
          this.hud.setMessage('PRACTICE COMPLETE — press R to run again');
        } else {
          this.hud.setMessage('LEVEL COMPLETE — press R to run again');
        }
      },
    });
    // Replay orchestration lives ABOVE the simulation: the coordinator picks
    // the live-vs-tape input source each fixed tick and verifies playback.
    // GameSimulation never knows replay exists.
    this.replay = new ReplayCoordinator(this.simulation);
    this.rendererHost = new RendererHost(container, this.simulation, rendererOptions);
    this.hud = new Hud(container);
    this.debugOverlay = new DebugOverlay(container);

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
    this.container.addEventListener('click', this.onClick);
    // M9.2 mode selector: the button clicks are the audio gesture (they
    // stopPropagation, so bare container clicks fall through to classic).
    this.hud.onModeSelect = (mode): void => {
      this.startRun(mode);
    };
    if (this.startGated) {
      // M9 start gate: THE DESCENT renders frozen at tick 0 under the
      // press-to-start overlay — gameplay and music begin together on the
      // first gesture, never seconds apart.
      this.loop.setPaused(true);
      if (this.modeSelect) {
        // Crystals stay hidden until a checkpoint run is actually chosen
        // (classic keeps the clean look, zero confusion).
        this.rendererHost.setCheckpointsVisible(false);
        this.hud.setModeSelector('THE DESCENT — SELECT RUN');
      } else {
        this.hud.setStartGate('PRESS SPACE / CLICK TO START');
      }
    }
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
    return this.runMode;
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
   * M9.2: apply the chosen run mode (sim flag + crystal visibility + HUD).
   * Single owner for mode application — gate, silent and music-off paths
   * all converge here.
   */
  private applyRunMode(mode: RunMode): void {
    this.runMode = mode;
    const checkpoint = mode === 'checkpoint';
    this.simulation.setCheckpointRespawnEnabled(checkpoint);
    this.rendererHost.setCheckpointsVisible(checkpoint);
    this.hud.setModeBadge(checkpoint ? 'CHECKPOINT MODE · R checkpoint · SHIFT+R full restart' : null);
    if (!checkpoint) this.hud.setCheckpointProgress(null);
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
    if (this.runMode === 'checkpoint') {
      director.startAt(targetMusicTime(this.simulation.elapsedSimTime, this.trackOffset));
    } else {
      director.restart();
    }
  }

  private onClick = (): void => {
    this.deathSfx.ensure();
    this.startRun('classic');
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
    this.rendererHost.dispose();
    this.deathSfx.dispose();
    this.music?.dispose();
    this.hud.setVisible(false);
    this.debugOverlay.setVisible(false);
  }

  private onResize = (): void => {
    this.rendererHost.resize(this.container.clientWidth, this.container.clientHeight);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    // First gesture unlocks the (guarded, optional) death blip.
    this.deathSfx.ensure();
    // M9.2: the unlocking press only starts audio + sim (the edge is
    // flushed in startRun so it never becomes gameplay input). Space picks
    // CLASSIC (legacy); C / 2 picks CHECKPOINT RUN. N is the EXPLICIT
    // silent start, honored only from the latched failure state.
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'Digit1') {
      this.startRun('classic');
    }
    if (event.code === 'KeyC' || event.code === 'Digit2') this.startRun('checkpoint');
    if (event.code === 'KeyN') this.startWithoutMusic();
    if (this.gatePending) return;
    switch (event.code) {
      case 'KeyR':
        // The start gate owns pre-start input (no restart before tick 0).
        if (!this.started) break;
        // Manual restart ends the current context: abort an active playback,
        // otherwise discard the partial live tape, then restart the attempt.
        if (this.replay.isPlaying) this.replay.abortReplay();
        else this.replay.discardRecording();
        if (event.shiftKey && this.runMode === 'checkpoint') {
          // M9.2 Shift+R: full origin restart, checkpoint progress cleared.
          this.simulation.restartRun();
          if (!this.silentStart) this.music?.restart();
        } else {
          // R restarts from the latest checkpoint in checkpoint mode
          // (sim routes it), from the origin in classic.
          this.simulation.restart();
          // R-from-running produces no dead→running edge, so restart music
          // explicitly (checkpoint-aware: re-seeks to the checkpoint time).
          this.restartMusicForSimTime();
        }
        this.hud.setMessage('');
        break;
      case 'KeyP':
        if (!this.started) break;
        this.paused = !this.paused;
        if (this.paused) this.music?.pause();
        this.loop.setPaused(this.paused);
        // Resume audio BEFORE the sim so both continue from the same
        // deterministic position (residual drift self-corrects below).
        if (!this.paused) this.music?.resume();
        this.input.setEnabled(!this.paused);
        this.hud.setMessage(this.paused ? 'PAUSED' : '');
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
        // M9.2: checkpoint runs are practice, never official completions —
        // F4 stays a classic-run feature (a restore discontinuity is not
        // an input and could never verify anyway).
        if (this.runMode === 'checkpoint') {
          this.hud.setMessage('CHECKPOINT RUNS ARE PRACTICE — REPLAY DISABLED');
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
    if (this.runMode === 'checkpoint') {
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
    const section = sectionAtTime(target);
    const beat = beatAtTime(target);
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
