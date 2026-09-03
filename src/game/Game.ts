import { FixedStepLoop } from '../core/FixedStepLoop';
import { SIMULATION_DT, SIMULATION_HZ } from '../core/constants';
import { InputSystem } from '../input/InputSystem';
import { GameSimulation } from './GameSimulation';
import { RendererHost } from '../rendering/RendererHost';
import { Hud } from '../ui/Hud';
import { DebugOverlay } from '../debug/DebugOverlay';
import { TEST_LEVEL } from '../content/levels/testLevel01';
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
  private readonly rendererHost: RendererHost;
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
    this.simulation = new GameSimulation(levelDef, {
      onJump: () => {
        this.jumpCount++;
      },
      onDeath: () => {
        this.hud.setMessage('');
      },
      onFinish: () => {
        this.hud.setMessage('LEVEL COMPLETE — press R to run again');
      },
    });
    this.rendererHost = new RendererHost(container, this.simulation);
    this.hud = new Hud(container);
    this.debugOverlay = new DebugOverlay(container);

    this.loop = new FixedStepLoop(
      {
        update: (_dt) => {
          this.simulation.update(this.input.sample());
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
    this.hud.setVisible(false);
    this.debugOverlay.setVisible(false);
  }

  private onResize = (): void => {
    this.rendererHost.resize(this.container.clientWidth, this.container.clientHeight);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    switch (event.code) {
      case 'KeyR':
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

    if (this.simulation.status === 'dead') {
      this.rendererHost.playerView.setVisible(false);
    } else {
      this.rendererHost.playerView.setVisible(true);
    }

    this.rendererHost.applyFrame(alpha, renderDtSeconds);
    this.rendererHost.render();

    this.hud.update({
      displayName: this.simulation.level.def.displayName,
      progress: this.simulation.progress,
      attempts: this.simulation.attempts,
    });

    if (this.debugInfoVisible) {
      this.updateDebugOverlay();
    }
  }

  private updateDebugOverlay(): void {
    const sim = this.simulation;
    const p = sim.player;
    const stats = this.rendererHost.stats;
    const g = sim.level.def;
    this.debugOverlay.update([
      `sim: ${SIMULATION_HZ} Hz | render fps ~${this.fpsEma.toFixed(1)} | steps/frame ${this.loop.stepsLastFrame} | discarded ms ${this.loop.discardedMsLastFrame.toFixed(2)} | alpha ${this.loop.interpolationAlpha.toFixed(3)}`,
      `pos: (${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)})`,
      `vel: (${p.velocity.x.toFixed(2)}, ${p.velocity.y.toFixed(2)}, ${p.velocity.z.toFixed(2)})`,
      `lane target: ${p.targetLaneIndex} / ${g.laneCenters.length} | x: ${p.position.x.toFixed(3)} | vx: ${p.velocity.x.toFixed(2)}`,
      `grounded: ${String(p.grounded)} | support: ${p.supportColliderId ?? '—'} | gravity: (0,-1,0)`,
      `status: ${sim.status} | attempt: ${sim.attempts} | progress: ${(sim.progress * 100).toFixed(1)}%`,
      `draw calls: ${stats.calls} | tris: ${stats.triangles}`,
    ]);
  }
}
