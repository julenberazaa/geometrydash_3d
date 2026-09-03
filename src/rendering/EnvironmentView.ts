import * as THREE from 'three';
import { PALETTE } from '../visuals/palette';
import { mulberry32 } from '../core/math';

/**
 * Cheap original environment: fog, gradient sky, starfield points, a few
 * emissive pillars for parallax. No expensive effects; all shared materials.
 */
export class EnvironmentView {
  public readonly scene: THREE.Scene;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(levelLengthZ: number) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.background);
    this.scene.fog = new THREE.Fog(PALETTE.fog, 30, 130);

    // --- Star points (single Points object, deterministic layout) ---
    const rand = mulberry32(20260826);
    const starCount = 420;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      // Spread around/above the track corridor.
      positions[i * 3] = (rand() - 0.5) * 160;
      positions[i * 3 + 1] = rand() * 60 + 4;
      positions[i * 3 + 2] = -40 + rand() * (levelLengthZ + 120);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      color: PALETTE.starField,
      size: 0.55,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
      fog: false,
    });
    this.disposables.push(starGeo, starMat);
    this.scene.add(new THREE.Points(starGeo, starMat));

    // --- Distant emissive pillars (parallax dressing, both sides) ---
    const pillarGeo = new THREE.BoxGeometry(1, 1, 1);
    const pillarMat = new THREE.MeshBasicMaterial({ color: 0x1b1038 });
    const windowMat = new THREE.MeshBasicMaterial({ color: 0x3c1f66 });
    this.disposables.push(pillarGeo, pillarMat, windowMat);
    const randP = mulberry32(7777);
    for (let i = 0; i < 26; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -30 + randP() * (levelLengthZ + 90);
      const h = 12 + randP() * 34;
      const w = 3 + randP() * 5;
      const mesh = new THREE.Mesh(pillarGeo, pillarMat);
      mesh.scale.set(w, h, w * (0.7 + randP()));
      mesh.position.set(side * (26 + randP() * 26), h / 2 - 6, z);
      this.scene.add(mesh);
      if (randP() > 0.45) {
        const win = new THREE.Mesh(pillarGeo, windowMat);
        win.scale.set(w * 0.82, h * 0.06, 0.05);
        win.position.set(mesh.position.x, h / 2 - 6 + h * 0.18, mesh.position.z + w * 0.51);
        this.scene.add(win);
      }
    }
  }

  public dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
