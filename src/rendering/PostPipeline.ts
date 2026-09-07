import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ProductionTheme } from '../visuals/productionTheme';

/**
 * PostPipeline (M6A) — controlled bloom foundation.
 *
 * RenderPass → UnrealBloomPass → OutputPass, owned by the RendererHost.
 * - Parameters come ONLY from the resolved ProductionTheme (bloom contract
 *   enforced at the theme layer); no magic constants here.
 * - Resize-safe: `resize()` forwards to the composer (which sizes every
 *   pass); pixel ratio follows the renderer.
 * - Disposable: render targets released, passes disposed, no duplicate
 *   passes across resize/HMR (exactly one composer per pipeline).
 * - Fallback: `setEnabled(false)` (or `?post=off`) bypasses the composer —
 *   the game renders direct and stays fully playable with zero post cost.
 * - Gameplay-independent: pure presentation, never reads simulation state.
 */
export class PostPipeline {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private enabled: boolean;
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly theme: ProductionTheme,
    enabled: boolean,
  ) {
    this.enabled = enabled;
    if (enabled) this.build();
  }

  private build(): void {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      this.theme.bloomStrength,
      this.theme.bloomRadius,
      this.theme.bloomThreshold,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  /** Number of composer passes (QA observability: exactly 3 when enabled). */
  public get passCount(): number {
    return this.composer?.passes.length ?? 0;
  }

  public get isEnabled(): boolean {
    return this.enabled && this.composer !== null;
  }

  public get liveBloomParams(): { strength: number; radius: number; threshold: number } | null {
    if (this.bloomPass === null) return null;
    return {
      strength: this.bloomPass.strength,
      radius: this.bloomPass.radius,
      threshold: this.bloomPass.threshold,
    };
  }

  /** Toggle the composer path at runtime (debug/QA; gameplay untouched). */
  public setEnabled(enabled: boolean): void {
    if (this.disposed || enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled && this.composer === null) {
      this.build();
    }
  }

  /** Present one frame: composer when enabled, else direct render. */
  public render(): void {
    if (this.enabled && this.composer !== null) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public resize(width: number, height: number): void {
    if (this.composer !== null) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.composer !== null) {
      for (const pass of this.composer.passes) pass.dispose();
      this.composer.dispose();
      this.composer = null;
      this.bloomPass = null;
    }
  }
}
