import * as THREE from 'three';
import type { GameSimulation } from '../game/GameSimulation';
import { ChaseCamera, CAMERA_TUNING } from '../camera/ChaseCamera';
import { LevelView } from './LevelView';
import { PlayerView } from './PlayerView';
import { EnvironmentView } from './EnvironmentView';
import { DebugView } from '../debug/DebugView';
import { lerp } from '../core/math';
import { PALETTE } from '../visuals/palette';

/**
 * RendererHost — THE ONLY module allowed to own WebGLRenderer and apply
 * simulation state to Three.js objects.
 *
 * Responsibilities:
 * - create renderer/camera/lights/scene content,
 * - per rendered frame: interpolate visual transforms between simulation's
 *   previous and current state (gameplay itself never interpolates),
 * - advance the pure-math ChaseCamera with render dt,
 * - expose renderer.info for QA/performance observation.
 */
export interface RendererStatsSnapshot {
  calls: number;
  triangles: number;
}

export class RendererHost {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly scene: THREE.Scene;
  public readonly chaseCamera: ChaseCamera;

  private readonly levelView: LevelView;
  public get playerView(): Readonly<PlayerView> {
    return this.playerViewInternal;
  }

  public setPlayerVisible(visible: boolean): void {
    this.playerViewInternal.setVisible(visible);
  }

  private readonly playerViewInternal: PlayerView;
  private readonly debugView: DebugView;
  private readonly lights: THREE.Group = new THREE.Group();

  /** Scratch interpolated position (avoid per-frame allocations). */
  private readonly interpPos = { x: 0, y: 0, z: 0 };

  constructor(
    container: HTMLElement,
    private readonly simulation: GameSimulation,
  ) {
    // Cap DPR at 1.5 for perf headroom (spec §28); still crisp on HiDPI laptops.
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_TUNING.fov,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      400,
    );

    const env = new EnvironmentView(simulation.level.def.finishZ + 20);
    this.scene = env.scene;

    this.levelView = new LevelView(simulation.level);
    this.scene.add(this.levelView.group);

    this.playerViewInternal = new PlayerView();
    this.scene.add(this.playerViewInternal.group);

    this.debugView = new DebugView();
    this.debugView.buildColliders(simulation.level.world);
    this.scene.add(this.debugView.group);

    // Lights: hemisphere + one directional; cheap.
    const hemi = new THREE.HemisphereLight(0x9d7bff, 0x140a24, 0.9);
    const dir = new THREE.DirectionalLight(0xb9a5ff, 1.15);
    dir.position.set(-14, 26, -10);
    this.lights.add(hemi, dir);
    this.scene.add(this.lights);

    // Finish gate marker at finishZ.
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(16, 9, 0.35),
      new THREE.MeshBasicMaterial({
        color: PALETTE.finishGate,
        transparent: true,
        opacity: 0.32,
      }),
    );
    gate.position.set(0, 4.5, simulation.level.def.finishZ);
    this.scene.add(gate);

    this.chaseCamera = new ChaseCamera();
    this.applyFrame(0, 0);
  }

  /** Per rendered frame: interpolate visuals only. */
  public applyFrame(alpha: number, renderDtSeconds: number): void {
    const sim = this.simulation;
    const p = sim.player.position;
    const prev = sim.prevPosition;
    const ip = this.interpPos;
    ip.x = lerp(prev.x, p.x, alpha);
    ip.y = lerp(prev.y, p.y, alpha);
    ip.z = lerp(prev.z, p.z, alpha);

    this.playerView.updateFromSimulation(ip, sim.player.grounded, renderDtSeconds);
    this.debugView.updatePlayerBox(p, sim.halfExtents);

    this.chaseCamera.update(p, 0, renderDtSeconds);
    const camPos = this.chaseCamera.currentPosition;
    const look = this.chaseCamera.currentLookTarget;
    this.camera.position.set(camPos.x, camPos.y, camPos.z);
    this.camera.up.set(0, 1, 0); // never rolls
    this.camera.lookAt(look.x, look.y, look.z);
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public setDebugCollidersVisible(visible: boolean): void {
    this.debugView.setCollidersVisible(visible);
  }

  public setDebugPlayerBoxVisible(visible: boolean): void {
    this.debugView.setPlayerBoxVisible(visible);
  }

  public get stats(): RendererStatsSnapshot {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose(): void {
    this.renderer.dispose();
    this.levelView.dispose();
    this.playerViewInternal.dispose();
    this.debugView.dispose();
    this.renderer.domElement.remove();
  }
}
