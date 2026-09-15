import * as THREE from 'three';
import type { ProductionTheme } from '../visuals/productionTheme';

/**
 * MaterialLibrary (M6A) — SOLE owner of shared Three.js materials and
 * shared geometries for the gameplay views.
 *
 * Contract:
 * - Visually-equivalent surfaces share ONE material instance (fewer state
 *   changes, fewer programs, bounded resource counts).
 * - Zero per-frame creation: views hold references acquired at build time.
 * - Correct disposal: `dispose()` releases everything the library created;
 *   views dispose nothing they did not create (views own only Meshes).
 * - No HMR/restart/replay leaks: the library lives and dies with the
 *   RendererHost (one per Game); counts are observable for QA guards.
 *
 * Theme-driven: constructed from the resolved ProductionTheme, so a theme
 * change is a library rebuild — never a gameplay change.
 */
export class MaterialLibrary {
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly tierMaterials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly ringPool: THREE.MeshBasicMaterial[] = [];

  // --- Route ---
  public readonly routeBody: THREE.MeshStandardMaterial;
  public readonly routeTop: THREE.MeshStandardMaterial;
  public readonly routeUnder: THREE.MeshStandardMaterial;
  public readonly routeEdge: THREE.MeshStandardMaterial;
  // --- Hazards ---
  public readonly hazard: THREE.MeshStandardMaterial;
  // --- Player ---
  public readonly playerBody: THREE.MeshStandardMaterial;
  public readonly playerFace: THREE.MeshStandardMaterial;
  public readonly playerEdge: THREE.LineBasicMaterial;
  // --- Portals / interactions ---
  public readonly portalUp: THREE.MeshStandardMaterial;
  public readonly portalDown: THREE.MeshStandardMaterial;
  public readonly portalPaneUp: THREE.MeshBasicMaterial;
  public readonly portalPaneDown: THREE.MeshBasicMaterial;
  public readonly padJump: THREE.MeshStandardMaterial;
  public readonly orbJump: THREE.MeshStandardMaterial;
  public readonly orbGravity: THREE.MeshStandardMaterial;
  /** M7.2 teleport gate: violet spatial-energy frame + pale pane. */
  public readonly teleportFrame: THREE.MeshStandardMaterial;
  public readonly teleportPane: THREE.MeshBasicMaterial;
  /**
   * M8A lava family (shared, bounded): bright molten core + darker deep
   * flow. Pulsed in place by `setLavaPulse` (M8.3 deeper swing — living
   * heat read) while `LevelView.updateLava` convects the crust plates
   * and descends the fall segments (no fluid simulation, no per-frame
   * allocation).
   */
  public readonly lavaSurface: THREE.MeshStandardMaterial;
  public readonly lavaDeep: THREE.MeshStandardMaterial;
  /**
   * M8C mode-portal family: sky-cyan Ship rings + mint-green Spider rings
   * (distinct from yellow jump, blue gravity, violet teleport and tier
   * speed colors by construction).
   */
  public readonly modeShip: THREE.MeshStandardMaterial;
  public readonly modeSpider: THREE.MeshStandardMaterial;
  /**
   * M8D Chomper family (shared, bounded): molten-glow body, hot mouth
   * core, lava-hot chain, white-hot eye squares. M8.3 reference match —
   * language — no licensed geometry.
   */
  public readonly chomperShell: THREE.MeshStandardMaterial;
  public readonly chomperGlow: THREE.MeshStandardMaterial;
  public readonly chomperCore: THREE.MeshBasicMaterial;
  public readonly chomperChain: THREE.MeshStandardMaterial;
  public readonly chomperEyeWhite: THREE.MeshBasicMaterial;
  public readonly interactionDim: THREE.MeshBasicMaterial;
  public readonly finishGate: THREE.MeshBasicMaterial;

  // --- Shared geometries (unit shapes, scaled per-instance by views) ---
  public readonly unitBox: THREE.BoxGeometry;
  public readonly spikeCone: THREE.ConeGeometry;
  public readonly orbSphere: THREE.SphereGeometry;
  public readonly orbHalo: THREE.TorusGeometry;
  public readonly chevron: THREE.ConeGeometry;
  public readonly playerBox: THREE.BoxGeometry;
  public readonly playerFacePlane: THREE.PlaneGeometry;
  public readonly playerEdges: THREE.EdgesGeometry;

  constructor(private readonly theme: ProductionTheme) {
    const track = <T extends THREE.Material>(m: T): T => {
      this.materials.push(m);
      return m;
    };
    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };

    // Route body: dark, mostly rough with a touch of metalness so the
    // directional light models the surface plane without specular noise.
    this.routeBody = track(
      new THREE.MeshStandardMaterial({
        color: theme.routeBody,
        roughness: theme.routeRoughness,
        metalness: theme.routeMetalness,
      }),
    );
    // Playable surface plane: slightly lifted tone, same response family.
    // A faint self-emissive keeps the route readable as a plane under any
    // light angle (sci-fi floor language) — far below the bloom threshold.
    this.routeTop = track(
      new THREE.MeshStandardMaterial({
        color: theme.routeTop,
        roughness: theme.routeRoughness,
        metalness: theme.routeMetalness,
        emissive: theme.routeTop,
        emissiveIntensity: 0.35,
      }),
    );
    // Ceiling run surface: unlit-appearing panel matching routeTop
    // luminance (down-facing faces get no key light; emissive carries it).
    // Free-face parity with the floor top inset is deliberate (M3.3).
    this.routeUnder = track(
      new THREE.MeshStandardMaterial({
        color: theme.routeUnder,
        roughness: 1,
        metalness: 0,
        emissive: theme.routeUnder,
        emissiveIntensity: 0.7,
      }),
    );
    // Edge-rail language: the ONE controlled bloom contributor on the route.
    this.routeEdge = track(
      new THREE.MeshStandardMaterial({
        color: theme.routeEdge,
        roughness: 0.4,
        metalness: 0,
        emissive: theme.routeEdge,
        emissiveIntensity: theme.routeEdgeEmissiveIntensity,
      }),
    );
    // Hazards: warm emissive silhouette — bright enough to read at 2×
    // against floor AND ceiling backgrounds, below white-clipping.
    this.hazard = track(
      new THREE.MeshStandardMaterial({
        color: theme.hazard,
        roughness: 0.45,
        metalness: 0,
        emissive: theme.hazard,
        emissiveIntensity: theme.hazardEmissiveIntensity,
      }),
    );
    // Player: dark cyan metal body (depth) + bright free-face accents.
    this.playerBody = track(
      new THREE.MeshStandardMaterial({
        color: theme.playerBody,
        roughness: theme.playerBodyRoughness,
        metalness: theme.playerBodyMetalness,
      }),
    );
    this.playerFace = track(
      new THREE.MeshStandardMaterial({
        color: theme.playerFace,
        roughness: 0.3,
        metalness: 0,
        emissive: theme.playerFace,
        emissiveIntensity: theme.playerFaceEmissiveIntensity,
      }),
    );
    this.playerEdge = track(new THREE.LineBasicMaterial({ color: theme.playerEdge }));

    const portalMat = (color: number): THREE.MeshStandardMaterial =>
      track(
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.4,
          metalness: 0,
          emissive: color,
          emissiveIntensity: 1.0,
        }),
      );
    const portalPane = (color: number): THREE.MeshBasicMaterial =>
      track(
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.1,
          side: THREE.DoubleSide,
        }),
      );
    this.portalUp = portalMat(theme.portalUp);
    this.portalDown = portalMat(theme.portalDown);
    this.portalPaneUp = portalPane(theme.portalUp);
    this.portalPaneDown = portalPane(theme.portalDown);
    const accent = (color: number): THREE.MeshStandardMaterial =>
      track(
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.4,
          metalness: 0,
          emissive: color,
          emissiveIntensity: 1.1,
        }),
      );
    this.padJump = accent(theme.padJump);
    this.orbJump = accent(theme.orbJump);
    this.orbGravity = accent(theme.orbGravity);
    // M7.2 teleport language: violet frame (below white-clip, crisp under
    // bloom) + faint pale pane. Distinct from cyan/warm gravity portals,
    // tier-colored speed gates and yellow/blue orbs by construction.
    this.teleportFrame = track(
      new THREE.MeshStandardMaterial({
        color: 0xc77dff,
        roughness: 0.4,
        metalness: 0,
        emissive: 0xc77dff,
        emissiveIntensity: 1.2,
      }),
    );
    this.teleportPane = track(
      new THREE.MeshBasicMaterial({
        color: 0xe8d8ff,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
      }),
    );
    // M8A lava: hot orange/red core with a strong emissive (the brightest
    // warm surface in the scene besides the hazard identity it shares the
    // family with) + a darker crusted flow tone for falls/pool bodies.
    // M8.3: saturated red-orange emissive that survives tone mapping as
    // ORANGE (never clipping to cream) yet stays above the bloom
    // threshold, plus a deeper pulse swing — living heat, not a slab.
    this.lavaSurface = track(
      new THREE.MeshStandardMaterial({
        color: 0xf15400,
        roughness: 0.55,
        metalness: 0,
        emissive: 0xff5000,
        emissiveIntensity: 1.7,
      }),
    );
    this.lavaDeep = track(
      new THREE.MeshStandardMaterial({
        color: 0x7a1e00,
        roughness: 0.8,
        metalness: 0,
        emissive: 0xc22a00,
        emissiveIntensity: 0.9,
      }),
    );
    // M8C mode portals: sky-cyan Ship + mint-green Spider (crisp under
    // bloom, below white-clip, distinct from every other portal family).
    const modeMat = (color: number): THREE.MeshStandardMaterial =>
      track(
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.4,
          metalness: 0,
          emissive: color,
          emissiveIntensity: 1.2,
        }),
      );
    this.modeShip = modeMat(0x4fd8ff);
    this.modeSpider = modeMat(0x5dff9d);
    // M8D Chomper: near-black crust + orange crack glow + hot core.
    // M8.2: the glow is the BODY now (brighter, more emissive molten
    // orange); the shell survives only as cooling-crust plates/bands.
    // M8.3 (reference match): the chain glows like poured lava and the
    // eyes are white-hot squares with dark pupils — shared, bounded.
    this.chomperShell = track(
      new THREE.MeshStandardMaterial({
        color: 0x1a0d08,
        roughness: 0.85,
        metalness: 0.15,
        emissive: 0x531a00,
        emissiveIntensity: 0.35,
      }),
    );
    this.chomperGlow = track(
      new THREE.MeshStandardMaterial({
        color: 0xff7a1a,
        roughness: 0.45,
        metalness: 0,
        emissive: 0xff5500,
        emissiveIntensity: 2.2,
      }),
    );
    this.chomperCore = track(
      new THREE.MeshBasicMaterial({ color: 0xffb03a }),
    );
    this.chomperChain = track(
      new THREE.MeshStandardMaterial({
        color: 0xff7a1a,
        roughness: 0.5,
        metalness: 0.1,
        emissive: 0xff5a00,
        emissiveIntensity: 1.4,
      }),
    );
    // M8.3 reference eyes: white-hot square (MeshBasic — always full
    // bright, never shaded into the body); pupils reuse chomperShell.
    this.chomperEyeWhite = track(
      new THREE.MeshBasicMaterial({ color: 0xfff6e8 }),
    );
    this.interactionDim = track(new THREE.MeshBasicMaterial({ color: theme.interactionDim }));
    this.finishGate = track(
      new THREE.MeshBasicMaterial({
        color: theme.finishGate,
        transparent: true,
        opacity: 0.32,
      }),
    );

    // Shared geometries (scaled per-instance; never mutated per-frame).
    this.unitBox = trackGeo(new THREE.BoxGeometry(1, 1, 1));
    this.spikeCone = trackGeo(new THREE.ConeGeometry(0.5, 1, 4));
    this.orbSphere = trackGeo(new THREE.SphereGeometry(0.42, 18, 14));
    this.orbHalo = trackGeo(new THREE.TorusGeometry(0.62, 0.045, 8, 36));
    this.chevron = trackGeo(new THREE.ConeGeometry(0.26, 0.55, 4));
    const playerSize = 1.24; // visual edge; gameplay collider stays 1.1
    this.playerBox = trackGeo(new THREE.BoxGeometry(playerSize, playerSize, playerSize));
    this.playerFacePlane = trackGeo(new THREE.PlaneGeometry(playerSize * 0.52, playerSize * 0.52));
    this.playerEdges = trackGeo(new THREE.EdgesGeometry(this.playerBox));

    // Pooled activation-ring materials (one per ring: opacity animates
    // individually; allocated once here, never per-frame).
    for (let i = 0; i < 8; i++) {
      this.ringPool.push(
        track(
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
        ),
      );
    }
  }

  /** Per-speed-tier material (rare objects; cached by tier, shared by parts). */
  public speedTier(multiplier: number): THREE.MeshStandardMaterial {
    const cached = this.tierMaterials.get(multiplier);
    if (cached !== undefined) return cached;
    const color = this.theme.speedTierColors[String(multiplier)] ?? 0xffffff;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0,
      emissive: color,
      emissiveIntensity: 1.1,
    });
    this.materials.push(mat);
    this.tierMaterials.set(multiplier, mat);
    return mat;
  }

  /** Pooled ring materials for the activation VFX (fixed set, reused). */
  public ringMaterials(): readonly THREE.MeshBasicMaterial[] {
    return this.ringPool;
  }

  /**
   * M6C1 timeline hook: retint the EXISTING shared route materials in
   * place (body color, surface color + self-emissive, edge color +
   * emissive). Zero allocation, zero new materials, fully reversible via
   * `resetRouteToTheme`. Player / hazard / portal / interaction materials
   * are NEVER touched here (semantic identities stay stable by structure).
   * `routeUnder` (ceiling run panel) is deliberately NOT modulated: its
   * luminance is calibrated to the M3.3 free-face parity, not themed.
   */
  public applyRouteState(routeBody: number, routeSurface: number, routeAccent: number): void {
    this.routeBody.color.setHex(routeBody);
    this.routeTop.color.setHex(routeSurface);
    this.routeTop.emissive.setHex(routeSurface);
    this.routeEdge.color.setHex(routeAccent);
    this.routeEdge.emissive.setHex(routeAccent);
  }

  /** Restore the exact theme route treatment (triggers-off === base). */
  public resetRouteToTheme(): void {
    this.applyRouteState(this.theme.routeBody, this.theme.routeTop, this.theme.routeEdge);
  }

  /**
   * M8A lava pulse: dense-liquid shimmer on the SHARED lava materials
   * (phase in [0,1), driven by sim time — pausing freezes it like every
   * other presentation clock). M8.3: deeper swing (surface 1.4..2.0,
   * deep 0.6..1.1) so the heat visibly breathes. In-place emissive
   * retune only: zero allocation, zero new draws, fully reversible.
   */
  public setLavaPulse(phase01: number): void {
    const wave = 0.5 + 0.5 * Math.sin(phase01 * Math.PI * 2);
    this.lavaSurface.emissiveIntensity = 1.4 + wave * 0.6;
    this.lavaDeep.emissiveIntensity = 0.6 + wave * 0.5;
  }

  /** Live material count (QA/resource-guard observability). */
  public get materialCount(): number {
    return this.materials.length;
  }

  /** Live geometry count (QA/resource-guard observability). */
  public get geometryCount(): number {
    return this.geometries.length;
  }

  public dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.materials.length = 0;
    this.geometries.length = 0;
    this.tierMaterials.clear();
    this.ringPool.length = 0;
  }
}
