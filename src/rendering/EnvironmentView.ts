import * as THREE from 'three';
import type { ProductionTheme } from '../visuals/productionTheme';
import type { LevelDefinition } from '../level/levelDefinition';
import { mulberry32 } from '../core/math';

/**
 * Production environment (M6A): fog, near-black gradient backdrop, a
 * deterministic starfield and distant emissive pillars for parallax.
 *
 * Lowest gameplay priority by design: dim silhouettes that reinforce motion
 * and depth without competing with the player/hazard/route hierarchy. No
 * expensive effects; library-independent shared materials owned here and
 * disposed with the view (the environment is per-RendererHost, built once —
 * no per-frame allocation, no restart/replay growth).
 *
 * Fog + background come from the resolved ProductionTheme (per-level route
 * identity flows through; the shared production mood stays constant).
 */
export class EnvironmentView {
  public readonly scene: THREE.Scene;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly theme: ProductionTheme;
  // M6C1 timeline handles (pre-existing objects + property modulation —
  // never create/destroy scene content per section).
  private readonly starMat: THREE.PointsMaterial;
  private readonly pillarMat: THREE.MeshBasicMaterial;
  private readonly windowMat: THREE.MeshBasicMaterial;
  private readonly starBaseOpacity: number;
  private readonly pillarBase: THREE.Color;
  private readonly windowBase: THREE.Color;
  // M7.1 background energy rays: a FIXED set of additive beams (bounded —
  // 12 meshes sharing one geometry + one material, zero per-frame
  // allocation, no gameplay collision). Driven by the existing visual state
  // (section energy) + the event-punch envelope (ray bursts on gravity / pad
  // / speed moments); silenced by the same reset path as everything else.
  private readonly rayMat: THREE.MeshBasicMaterial;
  private static readonly RAY_COUNT = 12;
  // M9.1 architecture layer: ONE InstancedMesh of large-scale biome forms
  // (towers, focal gate-arches, flanking walls, overhead canopies, bridges,
  // columns) filling the black void so the world reads as PLACES, not
  // platforms in emptiness. Static (built once, deterministic PRNG), one
  // draw, per-instance biome colors baked by z (zero per-frame cost).
  // Everything sits off-route (|x| ≥ 8 or y ≥ 13 — never landable-looking,
  // never colliders) and fogged for foreground/midground/background depth.
  private readonly archMesh: THREE.InstancedMesh | null;
  // M9.1 lightning: ONE pooled LineSegments of jagged energy bolts
  // (localized, thin, additive) flashed by strong rhythm levels only
  // (thresholded — beats alone never trip it). One draw, zero per-frame
  // allocation, safe (no fullscreen flash, no strobe timing).
  private readonly boltMat: THREE.LineBasicMaterial | null;
  private static readonly BOLT_COUNT = 14;
  private static readonly BOLT_SEGMENTS = 8;
  /**
   * M9.2 abyss floor (ONE static mesh, 1 draw): a dark biome-tinted bed
   * far below the route (y = −13.5, just above the void death plane) so
   * falls and low framings read rock instead of black nothing. Vertex
   * colors follow the section backgrounds (darkened); fog does the rest.
   * Pure dressing — never a collider, never landable-looking (it sits
   * below the lethal bound).
   */
  // M9.2 biome motes (ONE Points cloud, 1 draw): slow-rising ambient
  // particles tinted per biome by z (forge embers, island mint, maze
  // violet, cathedral cyan, reactor sparks, temple gold, void indigo,
  // core magenta). Render-dt drift with in-place wrap (zero allocation,
  // pause freezes with dt 0) — subordinate to gameplay juice by size.
  private readonly moteGeo: THREE.BufferGeometry | null;
  private readonly motePos: Float32Array | null;
  private readonly moteSpeed: Float32Array | null;
  private static readonly MOTE_COUNT = 240;

  constructor(levelLengthZ: number, theme: ProductionTheme, def?: LevelDefinition) {
    this.theme = theme;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(theme.background);
    this.scene.fog = new THREE.Fog(theme.fogColor, theme.fogNear, theme.fogFar);

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
      color: theme.starField,
      size: 0.55,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.6,
      fog: false,
    });
    this.starMat = starMat;
    this.starBaseOpacity = starMat.opacity;
    this.disposables.push(starGeo, starMat);
    this.scene.add(new THREE.Points(starGeo, starMat));

    // --- Distant emissive pillars (parallax dressing, both sides) ---
    // Kept deliberately darker than the route edge language: silhouettes,
    // not light sources. Below the bloom threshold by construction.
    const pillarGeo = new THREE.BoxGeometry(1, 1, 1);
    const pillarMat = new THREE.MeshBasicMaterial({ color: 0x181031 });
    const windowMat = new THREE.MeshBasicMaterial({ color: 0x352063 });
    this.pillarMat = pillarMat;
    this.windowMat = windowMat;
    this.pillarBase = pillarMat.color.clone();
    this.windowBase = windowMat.color.clone();
    this.disposables.push(pillarGeo, pillarMat, windowMat);
    // Energy rays share the pillar box geometry (no new geometry) and one
    // fixed additive material (no per-ray materials). Deterministic layout
    // from a fixed seed — background dressing only, far outside the corridor
    // (|x| 14..44) so they can never read as route or hazard.
    const rayMat = new THREE.MeshBasicMaterial({
      color: 0x4fd2ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.rayMat = rayMat;
    this.disposables.push(rayMat);
    const randR = mulberry32(4242);
    for (let i = 0; i < EnvironmentView.RAY_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const ray = new THREE.Mesh(pillarGeo, rayMat);
      const h = 24 + randR() * 30;
      ray.scale.set(0.35 + randR() * 0.5, h, 0.35 + randR() * 0.5);
      ray.position.set(
        side * (14 + randR() * 30),
        6 + randR() * 16,
        -30 + randR() * (levelLengthZ + 90),
      );
      this.scene.add(ray);
    }
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
    // M9.1 architecture + lightning (bounded set dressing, cold build).
    const arch = EnvironmentView.buildArchitecture(pillarGeo, levelLengthZ, def);
    this.archMesh = arch.mesh;
    if (arch.mesh !== null) {
      this.scene.add(arch.mesh);
      if (arch.material !== null) this.disposables.push(arch.material);
    }
    const bolts = EnvironmentView.buildLightning(levelLengthZ, def);
    if (bolts !== null) {
      this.scene.add(bolts.lines);
      this.disposables.push(bolts.geometry, bolts.material);
      this.boltMat = bolts.material;
    } else {
      this.boltMat = null;
    }
    // M9.2 abyss floor + biome motes (bounded dressing, cold build).
    const abyss = EnvironmentView.buildAbyssFloor(levelLengthZ, def);
    if (abyss !== null) {
      this.scene.add(abyss.mesh);
      this.disposables.push(abyss.geometry, abyss.material);
    }
    const motes = EnvironmentView.buildMotes(levelLengthZ, def);
    if (motes !== null) {
      this.scene.add(motes.points);
      this.disposables.push(motes.geometry, motes.material);
      this.moteGeo = motes.geometry;
      this.motePos = motes.positions;
      this.moteSpeed = motes.speeds;
    } else {
      this.moteGeo = null;
      this.motePos = null;
      this.moteSpeed = null;
    }
  }

  /** Section background at z (biome identity for cold-built dressing). */
  private static bgAtZ(def: LevelDefinition | undefined, z: number): number {
    const sections = def?.visualSequence?.sections;
    let bg: number | undefined;
    if (sections !== undefined) {
      for (const s of sections) {
        if (s.startZ <= z) bg = s.overrides.background ?? bg;
        else break;
      }
    }
    return bg ?? def?.theme.background ?? 0x07040f;
  }

  /** Section route accent at z (biome identity for cold-built dressing). */
  private static accentAtZ(def: LevelDefinition | undefined, z: number): number {
    const sections = def?.visualSequence?.sections;
    let accent: number | undefined;
    if (sections !== undefined) {
      for (const s of sections) {
        if (s.startZ <= z) accent = s.overrides.routeAccent ?? accent;
        else break;
      }
    }
    return accent ?? def?.theme.edge ?? 0x35c8ff;
  }

  /**
   * M9.1 architecture builder (cold, deterministic): focal gate-arches at
   * gameplay moments (portals/orbs/teleports/chomper triggers/door walls —
   * composition points the eye at the next required action) plus towers,
   * flanking walls, overhead canopies, bridges and columns filling the void.
   * Per-instance biome colors (section accent at the instance z, darkened
   * into silhouettes; every 7th burns with a brightened impact tint).
   * Shared box geometry (no new buffers); one material; one InstancedMesh.
   */
  private static buildArchitecture(
    unitBox: THREE.BoxGeometry,
    levelLengthZ: number,
    def?: LevelDefinition,
  ): { mesh: THREE.InstancedMesh | null; material: THREE.MeshBasicMaterial | null } {
    interface ArchItem {
      x: number;
      y: number;
      z: number;
      sx: number;
      sy: number;
      sz: number;
      color: THREE.Color;
    }
    const items: ArchItem[] = [];
    const accentAtZ = (z: number): number => {
      const sections = def?.visualSequence?.sections;
      let accent: number | undefined;
      if (sections !== undefined) {
        for (const s of sections) {
          if (s.startZ <= z) accent = s.overrides.routeAccent ?? accent;
          else break;
        }
      }
      return accent ?? def?.theme.edge ?? 0x35c8ff;
    };
    const push = (x: number, y: number, z: number, sx: number, sy: number, sz: number, hex: number, mul: number): void => {
      items.push({ x, y, z, sx, sy, sz, color: new THREE.Color(hex).multiplyScalar(mul) });
    };
    // Focal gate-arches (posts + lintel framing each gameplay moment).
    const focal: number[] = [];
    if (def !== undefined) {
      for (const p of def.gravityPortals ?? []) focal.push(p.z);
      for (const p of def.speedPortals ?? []) focal.push(p.z);
      for (const p of def.modePortals ?? []) focal.push(p.z);
      for (const o of def.jumpOrbs ?? []) focal.push(o.center.z);
      for (const o of def.gravityOrbs ?? []) focal.push(o.center.z);
      for (const t of def.teleportPortals ?? []) focal.push(t.entryZ);
      for (const c of def.chompers ?? []) focal.push(c.triggerZ);
      for (const h of def.hazards) {
        if (h.kind === 'killFront' && h.center.y < 4) focal.push(h.center.z);
      }
    }
    focal.sort((a, b) => a - b);
    let lastArchZ = -100;
    let impactTick = 0;
    for (const z of focal) {
      if (z < -10 || z > levelLengthZ + 10 || z - lastArchZ < 6) continue;
      lastArchZ = z;
      impactTick++;
      const accent = accentAtZ(z);
      const hot = impactTick % 7 === 0;
      const postMul = hot ? 0.8 : 0.35;
      const lintelMul = hot ? 1.0 : 0.55;
      push(-7.5, 5.5, z, 1.2, 11, 1.2, accent, postMul);
      push(7.5, 5.5, z, 1.2, 11, 1.2, accent, postMul);
      push(0, 11.6, z, 16.2, 1.2, 1.2, accent, lintelMul);
    }
    // Towers / walls / canopies / bridges / columns (seeded variety).
    const rand = mulberry32(918273);
    const fogHex = def?.theme.fogColor ?? 0x0b3a5c;
    const fogCol = new THREE.Color(fogHex);
    const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
      const accent = new THREE.Color(accentAtZ(z));
      const c = accent.clone().multiplyScalar(0.22 + rand() * 0.14).lerp(fogCol, 0.25 + rand() * 0.25);
      items.push({ x, y, z, sx, sy, sz, color: c });
    };
    for (let i = 0; i < 44; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -30 + rand() * (levelLengthZ + 90);
      const h = 20 + rand() * 22;
      const w = 4 + rand() * 5;
      put(side * (18 + rand() * 24), h / 2 - 6, z, w, h, w * (0.7 + rand() * 0.6));
    }
    for (let i = 0; i < 28; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -20 + rand() * (levelLengthZ + 60);
      put(side * (10 + rand() * 4), 1 + rand() * 2, z, 1.5, 7 + rand() * 3, 12 + rand() * 18);
    }
    for (let i = 0; i < 14; i++) {
      const z = -10 + rand() * (levelLengthZ + 40);
      put((rand() - 0.5) * 6, 14 + rand() * 5, z, 16 + rand() * 8, 1.5, 8 + rand() * 8);
    }
    for (let i = 0; i < 12; i++) {
      const z = -20 + rand() * (levelLengthZ + 60);
      const high = rand() > 0.5;
      put((rand() - 0.5) * 10, high ? 13 : -6, z, 22 + rand() * 14, 2, 3 + rand() * 3);
    }
    for (let i = 0; i < 12; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -20 + rand() * (levelLengthZ + 60);
      put(side * (8 + rand() * 4), 3 + rand() * 3, z, 1.5, 18 + rand() * 6, 1.5);
    }
    if (items.length === 0) return { mesh: null, material: null };
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    const mesh = new THREE.InstancedMesh(unitBox, material, items.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it === undefined) continue;
      dummy.position.set(it.x, it.y, it.z);
      dummy.scale.set(it.sx, it.sy, it.sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, it.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    return { mesh, material };
  }

  /**
   * M9.1 lightning bolts (cold, deterministic): jagged vertical energy
   * paths at seeded positions (never in the corridor). One LineSegments,
   * one additive material; opacity flashed by strong rhythm only.
   * M9.2: per-vertex biome tint (section accent at the bolt z, material
   * color stays white) + 10 → 14 bolts.
   */
  private static buildLightning(
    levelLengthZ: number,
    def?: LevelDefinition,
  ): { lines: THREE.LineSegments; geometry: THREE.BufferGeometry; material: THREE.LineBasicMaterial } | null {
    const segs = EnvironmentView.BOLT_COUNT * EnvironmentView.BOLT_SEGMENTS;
    const positions = new Float32Array(segs * 2 * 3);
    const colors = new Float32Array(segs * 2 * 3);
    const rand = mulberry32(31337);
    const tint = new THREE.Color();
    let v = 0;
    for (let b = 0; b < EnvironmentView.BOLT_COUNT; b++) {
      let x = (rand() > 0.5 ? 1 : -1) * (10 + rand() * 20);
      let y = rand() * 6;
      const z = rand() * (levelLengthZ + 40) - 20;
      tint.setHex(EnvironmentView.accentAtZ(def, z));
      for (let s = 0; s < EnvironmentView.BOLT_SEGMENTS; s++) {
        const nx = x + (rand() - 0.5) * 3;
        const ny = y + 2 + rand() * 2.5;
        positions[v * 3] = x;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = z;
        colors[v * 3] = tint.r;
        colors[v * 3 + 1] = tint.g;
        colors[v * 3 + 2] = tint.b;
        v++;
        positions[v * 3] = nx;
        positions[v * 3 + 1] = ny;
        positions[v * 3 + 2] = z;
        colors[v * 3] = tint.r;
        colors[v * 3 + 1] = tint.g;
        colors[v * 3 + 2] = tint.b;
        v++;
        x = nx;
        y = ny;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    return { lines, geometry, material };
  }

  /**
   * M9.2 abyss floor (cold, deterministic): one long dark bed under the
   * route with per-band biome colors (section background darkened into
   * rock, never competing with the route). 1 draw, static forever.
   */
  private static buildAbyssFloor(
    levelLengthZ: number,
    def?: LevelDefinition,
  ): { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial } | null {
    const bands = 96;
    const geometry = new THREE.PlaneGeometry(130, levelLengthZ + 120, 1, bands);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    // The mesh sits at z = levelLengthZ / 2 − 10: local z maps to world.
    const meshZ = levelLengthZ / 2 - 10;
    for (let i = 0; i < pos.count; i++) {
      const worldZ = pos.getZ(i) + meshZ;
      c.setHex(EnvironmentView.bgAtZ(def, worldZ)).multiplyScalar(0.32);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, -13.5, levelLengthZ / 2 - 10);
    mesh.frustumCulled = false;
    return { mesh, geometry, material };
  }

  /**
   * M9.2 biome motes (cold, deterministic): one rising ambient particle
   * field tinted per biome by z. Positions + speeds are caller-owned
   * arrays mutated in place by `updateMotes` (zero allocation).
   */
  private static buildMotes(
    levelLengthZ: number,
    def?: LevelDefinition,
  ): {
    points: THREE.Points;
    geometry: THREE.BufferGeometry;
    material: THREE.PointsMaterial;
    positions: Float32Array;
    speeds: Float32Array;
  } | null {
    const n = EnvironmentView.MOTE_COUNT;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const speeds = new Float32Array(n);
    const rand = mulberry32(60521);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = (rand() - 0.5) * 56;
      const y = -10 + rand() * 24;
      const z = -30 + rand() * (levelLengthZ + 90);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      c.setHex(EnvironmentView.accentAtZ(def, z)).multiplyScalar(0.55 + rand() * 0.45);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      speeds[i] = 0.4 + rand() * 1.1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.28,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return { points, geometry, material, positions, speeds };
  }

  /**
   * M9.2 mote drift (render-dt, in place): slow rise with vertical wrap
   * (embers/motes/sparks float up out of frame and re-enter below).
   * Pause freezes (dt 0); zero allocation on the hot path.
   */
  public updateMotes(renderDt: number): void {
    const pos = this.motePos;
    const speeds = this.moteSpeed;
    const geo = this.moteGeo;
    if (pos === null || speeds === null || geo === null || renderDt <= 0) return;
    for (let i = 0; i < speeds.length; i++) {
      const speed = speeds[i] ?? 0;
      const y0 = pos[i * 3 + 1] ?? -10;
      let y = y0 + speed * renderDt;
      if (y > 14) y = -10;
      pos[i * 3 + 1] = y;
    }
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.archMesh?.dispose();
  }

  /**
   * M6C1 timeline hook: modulate PRE-EXISTING environment properties in
   * place (background + fog envelope + dressing intensity). Dressing
   * intensity scales pillar/window colors toward black and star opacity —
   * no transparency flags change, no objects created or destroyed, fully
   * reversible via `resetToTheme`. Clamped 0..2 (0 = void-black calm).
   */
  public applyVisualState(
    background: number,
    fogColor: number,
    fogNear: number,
    fogFar: number,
    environmentIntensity: number,
  ): void {
    (this.scene.background as THREE.Color).setHex(background);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog !== null) {
      fog.color.setHex(fogColor);
      fog.near = fogNear;
      fog.far = fogFar;
    }
    const k = Math.min(2, Math.max(0, environmentIntensity));
    this.starMat.opacity = this.starBaseOpacity * k;
    this.pillarMat.color.copy(this.pillarBase).multiplyScalar(Math.min(1, k));
    this.windowMat.color.copy(this.windowBase).multiplyScalar(Math.min(1, k));
  }

  /** Restore the exact theme environment (triggers-off === base). */
  public resetToTheme(): void {
    const t = this.theme;
    this.applyVisualState(t.background, t.fogColor, t.fogNear, t.fogFar, 1);
    this.setEnergyRays(0, t.fogColor);
    if (this.boltMat !== null) this.boltMat.opacity = 0;
  }

  /**
   * M7.1 ray drive (renderer-only, cold per-frame writes): `level` 0..1
   * sets the shared beam opacity (0 = invisible, peak 0.38 — thin additive
   * beams stay subordinate to player/hazard/route by construction);
   * `color` retints the shared material (section accent at rest, punch
   * family tint during events). Absolute writes, no accumulation.
   */
  public setEnergyRays(level: number, color: number): void {
    const k = level < 0 ? 0 : level > 1 ? 1 : level;
    this.rayMat.opacity = 0.38 * k;
    this.rayMat.color.setHex(color);
    // Lightning answers strong rhythm only (thresholded — the bolt field
    // stays dark through groove/quiet sections and flashes on downbeats,
    // drops and impacts; smooth level in, smooth opacity out).
    if (this.boltMat !== null) {
      const flash = Math.min(1, Math.max(0, (k - 0.45) * 2.2));
      this.boltMat.opacity = 0.65 * flash;
    }
  }

  /** Live ray opacity (cold QA path only). */
  public liveRayOpacity(): number {
    return this.rayMat.opacity;
  }

  /**
   * M6C2 punch-flash observability (cold QA path only): the LIVE applied
   * background/fog hexes (timeline base + punch flash), as opposed to the
   * timeline-resolved section values. Lets browser QA prove the flash is
   * applied to the scene and fully restored at rest.
   */
  public liveBackgroundHex(): number {
    return (this.scene.background as THREE.Color).getHex();
  }

  public liveFogHex(): number {
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog === null) return 0x000000;
    return fog.color.getHex();
  }
}
