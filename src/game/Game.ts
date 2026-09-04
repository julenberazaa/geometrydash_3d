import { FixedStepLoop } from '../core/FixedStepLoop';
import { SIMULATION_DT, SIMULATION_HZ } from '../core/constants';
import { InputSystem } from '../input/InputSystem';
import { GameSimulation } from './GameSimulation';
import { RendererHost } from '../rendering/RendererHost';
import { DeathSfx } from '../audio/deathSfx';
import { Hud } from '../ui/Hud';
import { DebugOverlay } from '../debug/DebugOverlay';
import { TEST_LEVEL } from '../content/levels/testLevel01';
import { ReplayCoordinator, type ReplayVerification } from '../replay/ReplayCoordinator';
import type { LevelDefinition } from '../level/levelDefinition';

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

  private paused = false;
  private debugInfoVisible = false;
  /** Total jumps initiated this session (QA observability; gameplay never reads it). */
  private jumpCount = 0;

  /** Render FPS estimate (exponential moving average of frame times). */
  private fpsEma = 60;
  private lastFrameTimeMs = performance.now();
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    levelDef: LevelDefinition = TEST_LEVEL,
  ) {
    this.deathSfx = new DeathSfx();
    this.simulation = new GameSimulation(levelDef, {
      onJump: () => {
        this.jumpCount++;
      },
      onDeath: () => {
        this.hud.setMessage('');
        this.deathSfx.play();
      },
      onFinish: () => {
        this.hud.setMessage('LEVEL COMPLETE — press R to run again');
      },
    });
    // Replay orchestration lives ABOVE the simulation: the coordinator picks
    // the live-vs-tape input source each fixed tick and verifies playback.
    // GameSimulation never knows replay exists.
    this.replay = new ReplayCoordinator(this.simulation);
    this.rendererHost = new RendererHost(container, this.simulation);
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
      { stepDt: SIMULATION_DT },
    );

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    this.input.attach(window);
  }

  public start(): void {
    this.input.setEnabled(true);
    this.loop.start();
  }

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
    this.rendererHost.dispose();
    this.deathSfx.dispose();
    this.hud.setVisible(false);
    this.debugOverlay.setVisible(false);
  }

  private onResize = (): void => {
    this.rendererHost.resize(this.container.clientWidth, this.container.clientHeight);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    // First gesture unlocks the (guarded, optional) death blip.
    this.deathSfx.ensure();
    switch (event.code) {
      case 'KeyR':
        // Manual restart ends the current context: abort an active playback,
        // otherwise discard the partial live tape, then restart the attempt.
        if (this.replay.isPlaying) this.replay.abortReplay();
        else this.replay.discardRecording();
        this.simulation.restart();
        this.hud.setMessage('');
        break;
      case 'KeyP':
        this.paused = !this.paused;
        this.loop.setPaused(this.paused);
        this.input.setEnabled(!this.paused);
        this.hud.setMessage(this.paused ? 'PAUSED' : '');
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
        const last = this.replay.lastReplay;
        if (last !== null) {
          const started = this.replay.startReplay(last);
          if (!started.ok) this.hud.setMessage(`REPLAY REJECTED — ${started.reason}`);
          else this.hud.setMessage('');
        }
        break;
      }
      default:
        break;
    }
  };

  private debugCollidersOn = false;
  private debugPlayerBoxOn = false;

  /** Render-side frame work; gameplay state is only READ here. */
  private frameRender(alpha: number, renderDtSeconds: number): void {
    // FPS EMA.
    const nowMs = performance.now();
    const measuredDt = nowMs - this.lastFrameTimeMs;
    this.lastFrameTimeMs = nowMs;
    if (measuredDt > 0 && measuredDt < 1000) {
      this.fpsEma += (1000 / measuredDt - this.fpsEma) * 0.05;
    }

    this.rendererHost.applyFrame(alpha, renderDtSeconds);
    this.rendererHost.render();

    // DOM overlays follow the render freeze so frozen QA frames (and their
    // screenshots) show death-moment HUD/debug state, not live respawn state.
    if (this.rendererHost.debugFreezeFrame) return;

    this.hud.update({
      displayName: this.simulation.level.def.displayName,
      progress: this.simulation.progress,
      attempts: this.simulation.attempts,
    });
    this.hud.setReplayBadge(this.replay.hudBadge);

    if (this.debugInfoVisible) {
      this.updateDebugOverlay();
    }
  }

  private updateDebugOverlay(): void {
    const sim = this.simulation;
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
      `portal: ${sim.lastPortalId ?? '—'} | flips: ${sim.portalTransitionCount}`,
      `speed: ${sim.speedMultiplier}x (${sim.currentForwardSpeed.toFixed(1)} u/s) | pads: ${sim.padActivationCount} | orbs: ${sim.orbActivationCount} | speedPortals: ${sim.speedPortalCount} | last: ${sim.lastInteractionId ?? '—'}`,
      `status: ${sim.status} | attempt: ${sim.attempts} | progress: ${(sim.progress * 100).toFixed(1)}%`,
      `death: cause=${sim.lastDeathCause ?? '—'} | lethal=${sim.lastDeathLethalId ?? '—'} | holdTicks=${sim.deathHoldTicksLeft} | status=${sim.status}`,
      `replay: mode=${this.replay.mode} | tick=${this.replay.replayTick} | frames=${this.replay.replayFrameCount ?? this.replay.lastReplay?.frameCount ?? '—'} | hasReplay=${this.replay.lastReplay !== null} | verify=${formatVerification(this.replay.verification)}`,
      `replayLevel: ${this.replay.lastReplay?.levelId ?? this.simulation.level.def.id} | fp=${this.replay.levelFingerprint.slice(0, 8)} | hash=${this.replay.lastStateHash?.slice(0, 8) ?? '—'} | hz=${SIMULATION_HZ}`,
      `contactN: (${sim.lastContactNormal.x.toFixed(1)}, ${sim.lastContactNormal.y.toFixed(1)}, ${sim.lastContactNormal.z.toFixed(1)}) | preVel: (${sim.lastPreImpactVelocity.x.toFixed(1)}, ${sim.lastPreImpactVelocity.y.toFixed(1)}, ${sim.lastPreImpactVelocity.z.toFixed(1)})`,
      `draw calls: ${stats.calls} | tris: ${stats.triangles}`,
    ]);
  }
}

/** Compact one-line replay verification state for the F1 overlay. */
const formatVerification = (v: ReplayVerification): string => {
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
