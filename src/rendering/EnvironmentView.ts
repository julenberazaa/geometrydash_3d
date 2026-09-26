import * as THREE from 'three';
import type { ProductionTheme } from '../visuals/productionTheme';
import type { LevelDefinition } from '../level/levelDefinition';
import { mulberry32 } from '../core/math';
import { BIOME_BODY, BIOME_GLOW, placeBiomeDressing, routeGroundAt, type DressInstance } from '../level/biomeDressing';

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
  /**
   * M9.6.1 biome dressing build (cold, deterministic): route-adjacent
   * midground props from the level's `visualDressing` rows, baked once
   * into TWO static InstancedMeshes (dark solid silhouettes in the act
   * accent + additive glow accents in biome signatures, per-instance
   * colors, shared unit-box geometry, zero per-frame work, 2 draws).
   * Absent (nulls) when the level declares no rows — other levels keep
   * their exact look, exact draw counts, exact materials.
   */
  private static buildBiomeDressing(
    unitBox: THREE.BoxGeometry,
    def?: LevelDefinition,
  ): {
    solid: THREE.InstancedMesh | null;
    glow: THREE.InstancedMesh | null;
    solidMat: THREE.Material | null;
    glowMat: THREE.Material | null;
    count: number;
  } {
    const empty: {
      solid: THREE.InstancedMesh | null;
      glow: THREE.InstancedMesh | null;
      solidMat: THREE.Material | null;
      glowMat: THREE.Material | null;
      count: number;
    } = { solid: null, glow: null, solidMat: null, glowMat: null, count: 0 };
    const rows = def?.visualDressing;
    if (rows === undefined || rows.length === 0 || def === undefined) return empty;
    const instances = placeBiomeDressing(rows, (z) => routeGroundAt(def.solids, z));
    if (instances.length === 0) return empty;
    // Each anchor is a small voxel assembly. Batching the pieces into the
    // same two meshes gives material/shape identity without per-prop draws.
    const pieces = EnvironmentView.expandBiomeDressing(instances);
    const solids = pieces.filter((inst) => !inst.glow);
    const glows = pieces.filter((inst) => inst.glow);
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const fill = (
      list: typeof instances,
      material: THREE.Material,
    ): THREE.InstancedMesh | null => {
      if (list.length === 0) return null;
      const mesh = new THREE.InstancedMesh(unitBox, material, list.length);
      for (let i = 0; i < list.length; i++) {
        const inst = list[i];
        if (inst === undefined) continue;
        dummy.position.set(inst.x, inst.y, inst.z);
        dummy.rotation.set(0, inst.ry, inst.rz);
        dummy.scale.set(inst.sx, inst.sy, inst.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, tint.setHex(inst.color));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      return mesh;
    };
    const solidMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.9, metalness: 0.15, fog: true,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const solid = fill(solids, solidMat);
    const glow = fill(glows, glowMat);
    return { solid, glow, solidMat, glowMat, count: instances.length };
  }

  /** Cold-only voxel assemblies. Details stay beside the track and below
   * route-edge luminance; none has a collider or modifies level data. */
  private static expandBiomeDressing(anchors: readonly DressInstance[]): DressInstance[] {
    const pieces: DressInstance[] = [];
    const add = (
      a: DressInstance, dx: number, dy: number, dz: number,
      sx: number, sy: number, sz: number, color: number,
      glow = false, ry = 0, rz = 0,
    ): void => {
      pieces.push({ ...a, x: a.x + dx, y: a.y + dy, z: a.z + dz,
        sx, sy, sz, color, glow, ry, rz });
    };
    for (const a of anchors) {
      const body = BIOME_BODY[a.biome];
      const light = BIOME_GLOW[a.biome];
      if (a.prop === 'fall') {
        // Segmented cascade / lava fall, with a dark basin and thin bright
        // moving-water-looking streaks. Render-only: no fast-lane promise.
        const water = a.biome === 'garden';
        add(a, 0, 0, 0, a.sx, a.sy, a.sz, water ? 0x124d66 : 0x642615);
        for (let j = 0; j < 4; j++) {
          const x = (j - 1.5) * a.sx * 0.23;
          add(a, x, (j % 2) * 0.5 - 0.25, a.sz * 0.55,
            a.sx * 0.11, a.sy * (0.83 + j * 0.03), 0.08,
            water ? 0x56dfff : 0xff9d25, true);
        }
        add(a, 0, -a.sy * 0.5, a.sz * 0.8,
          a.sx * 1.7, 0.16, a.sz * 2, water ? 0x276b79 : 0x7f2c14);
        add(a, 0, -a.sy * 0.5 + 0.1, a.sz * 1.15,
          a.sx * 1.4, 0.05, a.sz * 1.2, water ? 0x4bbbd7 : 0xff661b, true);
        continue;
      }
      pieces.push(a);
      switch (a.prop) {
        case 'foliage': {
          // A thick block trunk with a broad stepped leaf crown; staggered
          // cubes read as leaves rather than yet another column.
          add(a, 0, a.sy * 0.4, 0, a.sx * 1.4, 0.35, a.sz * 1.3, 0x346f35);
          for (let j = 0; j < 4; j++) {
            const side = j % 2 === 0 ? -1 : 1;
            add(a, side * a.sx * (0.43 + (j >> 1) * 0.25), a.sy * (0.3 - (j >> 1) * 0.08),
              (j < 2 ? -1 : 1) * a.sz * 0.35,
              a.sx * 0.65, 0.24, a.sz * 0.7, j % 2 ? 0x598937 : 0x407c38);
          }
          break;
        }
        case 'strand': {
          // Hanging roots in garden/temple; mineral drips in the cavern.
          const vine = a.biome === 'garden' || a.biome === 'temple';
          for (let j = 0; j < 3; j++) {
            add(a, (j - 1) * 0.38, (j - 1) * 0.45, (j % 2) * 0.32,
              0.13, a.sy * (0.5 + j * 0.11), 0.13,
              vine ? 0x508438 : 0x385c69);
            if (vine) add(a, (j - 1) * 0.38 + 0.22, -a.sy * 0.12 + j * 0.7, 0.22,
              0.48, 0.15, 0.22, 0x6b9d43);
          }
          break;
        }
        case 'pillar':
        case 'archPost': {
          const brick = a.biome === 'garden' || a.biome === 'temple' || a.biome === 'ruins';
          add(a, 0, -a.sy * 0.48, 0, a.sx * 1.35, 0.35, a.sz * 1.3, body);
          add(a, 0, a.sy * 0.48, 0, a.sx * 1.25, 0.3, a.sz * 1.2, body);
          for (let j = 0; j < 3; j++) {
            const y = -a.sy * 0.3 + j * a.sy * 0.27;
            add(a, 0, y, a.sz * 0.51, a.sx * 0.82, 0.08, 0.08,
              brick ? 0x63715a : 0x5a4c42);
          }
          if (brick) {
            add(a, 0, 0, a.sz * 0.57, a.sx * 0.24, a.sy * 0.11, 0.09,
              a.biome === 'temple' ? 0xae9d46 : 0x6f8062);
            if (a.biome !== 'ruins') add(a, a.sx * 0.43, a.sy * 0.33, a.sz * 0.45,
              0.2, a.sy * 0.33, 0.18, 0x387640);
          } else if (a.biome === 'crag' || a.biome === 'foundry') {
            add(a, 0, -a.sy * 0.12, a.sz * 0.54,
              a.sx * 0.13, a.sy * 0.58, 0.08, 0xff5f19, true);
          } else if (a.biome === 'works') {
            add(a, 0, 0, a.sz * 0.54, a.sx * 0.23, a.sy * 0.65, 0.08, 0x54bca3, true);
          }
          break;
        }
        case 'rock': {
          // Jagged stepped shelf, moss cap in jungle, fractured basalt in lava.
          add(a, -a.sx * 0.36, -a.sy * 0.3, 0.2, a.sx * 0.7, a.sy * 0.6, a.sz * 0.75, body);
          add(a, a.sx * 0.28, a.sy * 0.24, -a.sz * 0.2,
            a.sx * 0.65, a.sy * 0.55, a.sz * 0.7, body);
          if (a.biome === 'garden') add(a, 0, a.sy * 0.5, 0,
            a.sx * 1.05, 0.15, a.sz * 1.05, 0x4d883e);
          if (a.biome === 'crag') add(a, 0, a.sy * 0.5, a.sz * 0.15,
            a.sx * 0.5, 0.08, a.sz * 0.56, 0xff6818, true);
          break;
        }
        case 'crystal': {
          add(a, -a.sx * 0.68, -a.sy * 0.18, 0,
            a.sx * 0.5, a.sy * 0.7, a.sz * 0.5, light, true, 0, -0.27);
          add(a, a.sx * 0.62, -a.sy * 0.22, a.sz * 0.2,
            a.sx * 0.43, a.sy * 0.55, a.sz * 0.43, light, true, 0, 0.35);
          break;
        }
        case 'duct':
        case 'vent': {
          const metal = a.biome === 'works' ? 0x55716a : 0x684a36;
          for (let j = -1; j <= 1; j++) {
            add(a, 0, a.prop === 'vent' ? j * a.sy * 0.25 : 0,
              a.prop === 'duct' ? j * a.sz * 0.32 : a.sz * 0.53,
              a.sx * 1.23, a.prop === 'vent' ? 0.14 : a.sy * 1.23,
              a.prop === 'duct' ? 0.15 : 0.12, metal);
          }
          add(a, 0, a.sy * 0.48, a.sz * 0.52,
            a.sx * 0.6, 0.12, 0.08, light, true);
          break;
        }
        case 'slab':
        case 'lintel': {
          for (let j = -1; j <= 1; j++) {
            add(a, j * a.sx * 0.26, a.sy * 0.53, 0,
              a.sx * 0.22, 0.1, a.sz * 0.8,
              a.biome === 'garden' ? 0x437e4a :
                a.biome === 'crag' ? 0x79503a : 0x716656);
          }
          break;
        }
        case 'cell':
          add(a, 0, 0, 0, a.sx * 1.7, a.sy * 1.7, a.sz * 1.7, body);
          break;
      }
    }
    return pieces;
  }

  // M9.2 biome motes (ONE Points cloud, 1 draw): slow-rising ambient
  // particles tinted per biome by z (forge embers, island mint, maze
  // violet, cathedral cyan, reactor sparks, temple gold, void indigo,
  // core magenta). Render-dt drift with in-place wrap (zero allocation,
  // pause freezes with dt 0) — subordinate to gameplay juice by size.
  private readonly moteGeo: THREE.BufferGeometry | null;
  private readonly motePos: Float32Array | null;
  private readonly moteSpeed: Float32Array | null;
  private static readonly MOTE_COUNT = 240;
  /**
   * M9.6.1 biome dressing (route-adjacent midground): TWO static
   * InstancedMeshes (solid silhouettes + glow accents, per-instance
   * colors, zero per-frame work, 2 draws) built once from the level's
   * `visualDressing` rows. Absent when the level declares none (other
   * levels keep their exact look). Never in the corridor (|x| ≥ 7),
   * never colliders, never landable-looking.
   */
  private readonly dressSolid: THREE.InstancedMesh | null;
  private readonly dressGlow: THREE.InstancedMesh | null;
  private readonly dressCount: number;
  private readonly surfaceMesh: THREE.InstancedMesh | null;

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
    // M9.6.1 biome dressing (opt-in per level, static, 2 draws).
    const dressing = EnvironmentView.buildBiomeDressing(pillarGeo, def);
    this.dressSolid = dressing.solid;
    this.dressGlow = dressing.glow;
    this.dressCount = dressing.count;
    if (dressing.solid !== null) this.scene.add(dressing.solid);
    if (dressing.glow !== null) this.scene.add(dressing.glow);
    if (dressing.solidMat !== null) this.disposables.push(dressing.solidMat);
    if (dressing.glowMat !== null) this.disposables.push(dressing.glowMat);
    const surface = EnvironmentView.buildBiomeSurfaces(pillarGeo, def);
    this.surfaceMesh = surface.mesh;
    if (surface.mesh !== null) this.scene.add(surface.mesh);
    if (surface.material !== null) this.disposables.push(surface.material);
  }

  /** QA observability: total biome dressing instances (0 when absent). */
  public get dressInstances(): number {
    return this.dressCount;
  }

  /** A single thin voxel facade on existing route solids. No topology or
   * gameplay geometry is created; tiles sit flush against their host face. */
  private static buildBiomeSurfaces(
    unitBox: THREE.BoxGeometry,
    def?: LevelDefinition,
  ): { mesh: THREE.InstancedMesh | null; material: THREE.Material | null } {
    if (def?.visualDressing === undefined) return { mesh: null, material: null };
    const tiles: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; color: number }> = [];
    const rand = mulberry32(88472);
    const rows = def.visualDressing;
    for (const solid of def.solids) {
      const z = solid.center.z;
      const biome = rows.find((row) => z >= row.z0 && z < row.z1)?.biome;
      if (biome === undefined) continue;
      const hx = solid.halfExtents.x;
      const hy = solid.halfExtents.y;
      const hz = solid.halfExtents.z;
      if (hx < 0.7 || hz < 0.7) continue;
      const base = BIOME_BODY[biome];
      const accent = biome === 'garden' || biome === 'temple' ? 0x3e7544
        : biome === 'cavern' ? 0x355d75
          : biome === 'crag' || biome === 'foundry' ? 0x70432e
            : biome === 'works' ? 0x3e6962 : 0x544966;
      const palette = [base, accent, base, accent, base];
      // Front facing block face: inset patches form irregular stone/metal
      // courses. A gap around every patch exposes the original material.
      if (hy >= 0.35) {
        const cols = Math.min(7, Math.max(3, Math.floor(hx * 1.65)));
        const width = (hx * 1.82) / cols;
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < cols; col++) {
            const px = solid.center.x - hx * 0.91 + width * (col + 0.5 + (row % 2) * 0.12);
            const py = solid.center.y + (row === 0 ? -0.42 : 0.42) * hy;
            tiles.push({ x: px, y: py, z: z - hz - 0.018,
              sx: width * 0.79, sy: Math.min(hy * 0.66, 0.46), sz: 0.025,
              color: palette[Math.floor(rand() * palette.length)] ?? base });
          }
        }
      }
      // Sparse top-face chips remain low profile and dark: they are surface
      // texture, never an apparent obstacle or landing platform.
      if (hy <= 1.5 && hx >= 1.3 && hz >= 1.3) {
        for (let j = 0; j < 6; j++) {
          tiles.push({
            x: solid.center.x + ((j % 3) - 1) * hx * 0.52,
            y: solid.center.y + hy + 0.033,
            z: z + (j < 3 ? -0.45 : 0.45) * hz,
            sx: Math.min(hx * 0.43, 1.25), sy: 0.012,
            sz: Math.min(hz * 0.67, 1.25),
            color: j === 0 && biome === 'garden' ? 0x3c703c : palette[(j + 1) % palette.length] ?? base,
          });
        }
      }
    }
    if (tiles.length === 0) return { mesh: null, material: null };
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    const mesh = new THREE.InstancedMesh(unitBox, material, tiles.length);
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      if (tile === undefined) continue;
      dummy.position.set(tile.x, tile.y, tile.z);
      dummy.scale.set(tile.sx, tile.sy, tile.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tint.setHex(tile.color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    return { mesh, material };
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
      const biome = def?.visualDressing?.find((row) => z >= row.z0 && z < row.z1)?.biome;
      const hot = impactTick % 7 === 0;
      const frame = biome === undefined ? accent : BIOME_BODY[biome];
      const postMul = biome === undefined ? (hot ? 0.8 : 0.35) : 1.2;
      const lintelMul = biome === undefined ? (hot ? 1.0 : 0.55) : 1.35;
      push(-7.5, 5.5, z, 1.2, 11, 1.2, frame, postMul);
      push(7.5, 5.5, z, 1.2, 11, 1.2, frame, postMul);
      push(0, 11.6, z, 16.2, 1.2, 1.2, frame, lintelMul);
      if (biome === 'garden' || biome === 'temple') {
        push(0, 12.35, z, 17.2, 0.35, 2.4, 0x4f943e, 0.9);
        for (const side of [-1, 1]) {
          push(side * 8.2, 7.8, z + 0.7, 0.28, 5.5, 0.3, 0x569949, 0.8);
          push(side * 8.5, 4.3, z + 0.75, 1.1, 0.22, 0.6, 0x70a94b, 0.7);
          if (biome === 'garden') {
            push(side * 9.7, 2.4, z + 3, 1.3, 8, 0.3, 0x36b8d6, 0.6);
            push(side * 9.7, -1.7, z + 3.3, 2.5, 0.2, 1.4, 0x4fc8db, 0.55);
          }
        }
      } else if (biome === 'ruins' || biome === 'cavern') {
        for (const side of [-1, 1]) {
          push(side * 7.5, 7.5, z + 0.68, 0.9, 0.14, 0.14,
            biome === 'ruins' ? 0x85728a : 0x62b8cd, 0.7);
          push(side * 7.5, 3.5, z + 0.68, 0.9, 0.14, 0.14,
            biome === 'ruins' ? 0x85728a : 0x62b8cd, 0.7);
          if (biome === 'cavern') push(side * 7.3, 12.7, z,
            0.45, 2.2, 0.55, 0x5acef2, 0.5);
        }
      } else if (biome === 'crag' || biome === 'foundry') {
        for (const side of [-1, 1]) {
          push(side * 7.5, 5.5, z + 0.66, 0.14, 7.5, 0.15,
            biome === 'crag' ? 0xff5b18 : 0xff9631, 0.62);
        }
      } else if (biome === 'works') {
        push(0, 11.6, z + 0.68, 15.5, 0.12, 0.12, 0x73cbb1, 0.55);
        for (const side of [-1, 1]) {
          push(side * 7.5, 5.5, z + 0.68, 0.12, 8, 0.12, 0x73cbb1, 0.55);
        }
      }
    }
    // Towers / walls / canopies / bridges / columns (seeded variety).
    const rand = mulberry32(918273);
    const fogHex = def?.theme.fogColor ?? 0x0b3a5c;
    const fogCol = new THREE.Color(fogHex);
    const biomeAt = (z: number): DressInstance['biome'] | null => {
      for (const row of def?.visualDressing ?? []) {
        if (z >= row.z0 && z < row.z1) return row.biome;
      }
      return null;
    };
    const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
      const biome = biomeAt(z);
      const c = biome === null
        ? new THREE.Color(accentAtZ(z)).multiplyScalar(0.22 + rand() * 0.14).lerp(fogCol, 0.25 + rand() * 0.25)
        : new THREE.Color(BIOME_BODY[biome]).multiplyScalar(0.83 + rand() * 0.32).lerp(fogCol, 0.1);
      items.push({ x, y, z, sx, sy, sz, color: c });
      if (biome === null) return;
      // Large formerly flat towers gain a readable block silhouette and
      // material-specific facade. All details share this architecture batch.
      if (sx >= 3 && sy >= 8) {
        const faceZ = z + sz * 0.51;
        for (let j = -1; j <= 1; j++) {
          const inset = (j % 2) * sx * 0.12;
          push(x + j * sx * 0.28 + inset, y + sy * (0.21 + j * 0.05), faceZ,
            sx * 0.22, sy * 0.1, 0.12, BIOME_BODY[biome], 1.55);
        }
        if (biome === 'garden' || biome === 'temple') {
          push(x, y + sy * 0.51, z, sx * 1.24, 0.65, sz * 1.15, 0x4a8a3c, 0.8);
          for (let j = -1; j <= 1; j++) {
            push(x + j * sx * 0.31, y + sy * 0.33, faceZ,
              0.25, sy * (0.24 + (j + 1) * 0.06), 0.2, 0x5a9d48, 0.65);
          }
        } else if (biome === 'crag' || biome === 'foundry') {
          push(x + sx * 0.27, y, faceZ, sx * 0.13, sy * 0.68, 0.12,
            biome === 'crag' ? 0xff5a0b : 0xff9228, 0.8);
        } else if (biome === 'cavern' || biome === 'void' || biome === 'core') {
          for (let j = -1; j <= 1; j++) {
            push(x + j * sx * 0.28, y + sy * 0.53, z,
              sx * 0.12, 1.5 + (j + 1) * 0.9, sz * 0.15,
              BIOME_GLOW[biome], 0.45);
          }
        } else if (biome === 'works') {
          push(x, y + sy * 0.05, faceZ,
            sx * 0.68, sy * 0.47, 0.12, 0x6aa198, 0.42);
          push(x, y + sy * 0.05, faceZ + 0.08,
            sx * 0.09, sy * 0.5, 0.1, 0x85ffd2, 0.32);
        } else {
          push(x, y + sy * 0.5, z,
            sx * 1.16, 0.5, sz * 1.14, 0x81786c, 0.65);
        }
      } else if (sx <= 2 && sz > 10) {
        // Side walls receive repeated seams at a much darker value than the
        // neon track border; they cannot impersonate route edges.
        for (let j = -2; j <= 2; j++) {
          push(x, y + sy * 0.2, z + j * sz * 0.18,
            sx * 1.08, sy * 0.58, 0.13, BIOME_BODY[biome], 1.4);
        }
      }
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
    // Continuous, off-route material beds make the island and volcanic acts
    // read as water and magma instead of differently tinted empty space.
    // Staggered voxel courses imply flow without a costly animated material.
    for (const row of def?.visualDressing ?? []) {
      if (row.biome !== 'garden' && row.biome !== 'crag') continue;
      const water = row.biome === 'garden';
      for (let z = row.z0 + 8; z < row.z1 - 8; z += 18) {
        for (const side of [-1, 1]) {
          push(side * 13, water ? -4.5 : -7, z,
            9, 0.22, 17.6, water ? 0x147ca0 : 0x9d3415, 0.75);
          for (let j = 0; j < 3; j++) {
            push(side * (10.3 + j * 2.1), water ? -4.3 : -6.8,
              z + (j - 1) * 3.7, 0.26, 0.04, 5.2,
              water ? 0x55d8e8 : 0xff8b22, 0.5);
          }
        }
      }
      if (water) {
        for (let z = row.z0 + 12; z < row.z1 - 10; z += 25) {
          const side = Math.floor(z / 25) % 2 === 0 ? -1 : 1;
          const x = side * 13.2;
          push(x, 3.2, z, 0.85, 8.5, 0.85, 0x35553a, 0.9);
          push(x, 8.2, z, 5.6, 1.35, 3.7, 0x4c913f, 0.8);
          push(x + side * 2.2, 7.4, z - 0.8, 3.1, 0.75, 3.4, 0x65a94c, 0.75);
          push(x - side * 1.8, 5.9, z + 1.2, 0.25, 4.1, 0.25, 0x5e9d48, 0.65);
        }
      }
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
    this.dressSolid?.dispose();
    this.dressGlow?.dispose();
    this.surfaceMesh?.dispose();
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
