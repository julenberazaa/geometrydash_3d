import * as THREE from 'three';
import type { ProductionTheme } from '../visuals/productionTheme';
import type { BiomeId } from '../level/biomeDressing';

/** Reference-style lethal pyramids: volcanic/stone/metal faces, neon edges.
 * Edge energy is HDR for bloom, without making the dark core luminous. */
const SPIKE_BIOMES: Record<BiomeId, { core: number; edge: number; roughness: number; metalness: number }> = {
  foundry: { core: 0x241b18, edge: 0xffa32a, roughness: 0.88, metalness: 0.12 },
  garden: { core: 0x182418, edge: 0xbaff32, roughness: 0.94, metalness: 0.02 },
  ruins: { core: 0x24271c, edge: 0xa4ff48, roughness: 0.96, metalness: 0.02 },
  cavern: { core: 0x1c2033, edge: 0xcf9dff, roughness: 0.38, metalness: 0.18 },
  crag: { core: 0x241816, edge: 0xff942e, roughness: 0.98, metalness: 0.04 },
  works: { core: 0x172728, edge: 0x9dffb5, roughness: 0.32, metalness: 0.68 },
  temple: { core: 0x25291a, edge: 0xd4ff62, roughness: 0.72, metalness: 0.28 },
  void: { core: 0x1e182d, edge: 0xc29aff, roughness: 0.46, metalness: 0.26 },
  core: { core: 0x2b1929, edge: 0xff94d8, roughness: 0.3, metalness: 0.58 },
};

export interface BiomeSpikeStyle {
  readonly material: THREE.MeshStandardMaterial;
  readonly edge: THREE.Color;
  readonly socket: THREE.MeshStandardMaterial;
}

const ROUTE_BIOMES: Record<BiomeId, { stone: number; light: number; dark: number; mark: number; style: number }> = {
  foundry: { stone: 0x514846, light: 0x776158, dark: 0x24272b, mark: 0xc46b33, style: 0 },
  garden: { stone: 0x677466, light: 0x9aaa87, dark: 0x34483f, mark: 0x468895, style: 1 },
  ruins: { stone: 0x81766d, light: 0xb19d86, dark: 0x454b4b, mark: 0xa3886b, style: 2 },
  cavern: { stone: 0x45576a, light: 0x718597, dark: 0x273746, mark: 0x5aa7bd, style: 3 },
  crag: { stone: 0x64483d, light: 0x936352, dark: 0x33262a, mark: 0xd45a33, style: 4 },
  works: { stone: 0x53636b, light: 0x83969b, dark: 0x293b42, mark: 0x57b0a1, style: 5 },
  temple: { stone: 0x84795c, light: 0xb2a376, dark: 0x4b5145, mark: 0xbba05a, style: 7 },
  void: { stone: 0x35384c, light: 0x5a5d7c, dark: 0x1c1e30, mark: 0x8677ae, style: 6 },
  core: { stone: 0x505067, light: 0x82809b, dark: 0x292a40, mark: 0xb879a2, style: 8 },
};

const shaderColor = (hex: number): string => {
  const linear = new THREE.Color(hex);
  return `vec3(${linear.r}, ${linear.g}, ${linear.b})`;
};

/** World coordinates and per-cell hashes give every surface a stable but
 * non-repeating pattern. The style changes its structure, not just its hue. */
const routeSurfaceShader = (style: number, seed: number, palette: typeof ROUTE_BIOMES[BiomeId]): string => `
  vec2 q = routeUv;
  float broad = routeNoise(q * 0.16 + ${seed}.0);
  float grain = routeNoise(q * 1.35 + ${seed}.0);
  vec3 stone = ${shaderColor(palette.stone)};
  vec3 light = ${shaderColor(palette.light)};
  vec3 dark = ${shaderColor(palette.dark)};
  vec3 mark = ${shaderColor(palette.mark)};
  vec3 surface = mix(dark, stone, 0.48 + broad * 0.42);
  ${style === 0 ? `
    // Foundry: angular clinker courses, not the cavern's wavy vein motif.
    float course = floor(q.y / 1.85);
    vec2 clinker = vec2((q.x + routeHash(vec2(course, ${seed}.0)) * 3.8)
      / (2.0 + routeHash(vec2(course, 31.0)) * 1.3), q.y / 1.85);
    vec2 local = fract(clinker);
    float split = min(min(local.x, 1.0-local.x), min(local.y, 1.0-local.y));
    surface = mix(surface, light, routeHash(floor(clinker) + ${seed}.0) * 0.22);
    surface = mix(surface, dark, (1.0-smoothstep(0.02,0.09,split)) * 0.82);
    surface = mix(surface, mark, (1.0-smoothstep(0.007,0.025,split))
      * step(0.7, routeHash(floor(clinker) + 13.0)) * 0.45);
  ` : style === 1 ? `
    // Garden: broad moss colonies and irregular wet runnels; no grid.
    float moss = routeNoise(q * 0.36 + vec2(broad * 2.0, grain));
    surface = mix(surface, vec3(0.19, 0.39, 0.16), smoothstep(0.44, 0.73, moss) * 0.67);
    float wet = abs(sin(q.x * 0.48 + routeNoise(q * 0.12) * 8.0));
    surface = mix(surface, mark, (1.0 - smoothstep(0.02, 0.11, wet)) * 0.38);
    surface = mix(surface, light, smoothstep(0.75, 0.95, grain) * 0.12);
  ` : style === 2 ? `
    // Ruins: staggered blocks with cell-specific width and wear.
    float row = floor(q.y / 2.6);
    float offset = routeHash(vec2(row, ${seed}.0)) * 2.1;
    vec2 blockUv = vec2((q.x + offset) / 3.4, q.y / 2.6);
    vec2 cell = floor(blockUv);
    vec2 local = fract(blockUv);
    float joint = 1.0 - smoothstep(0.018, 0.055, min(min(local.x, 1.0-local.x), min(local.y, 1.0-local.y)));
    surface = mix(surface, light, routeHash(cell + ${seed}.0) * 0.18);
    surface = mix(surface, dark, joint * 0.62);
    float glyph = abs(length(local - vec2(0.5)) - 0.23);
    surface = mix(surface, mark, (1.0-smoothstep(0.02,0.06,glyph)) * step(0.78,routeHash(cell+17.0)) * 0.25);
  ` : style === 3 ? `
    // Cavern: veined mineral, broad dark pockets, no masonry grid.
    float vein = abs(routeNoise(q * vec2(0.44, 0.81) + broad * 3.1) - 0.5);
    surface = mix(surface, dark, smoothstep(0.56, 0.76, broad) * 0.35);
    surface = mix(surface, mark, (1.0-smoothstep(0.008, 0.045, vein)) * 0.38);
    surface = mix(surface, light, smoothstep(0.86, 0.98, grain) * 0.12);
  ` : style === 4 ? `
    // Volcanic crag: branching magma cracks in irregular basalt.
    float lava = abs(routeNoise(q * 0.62 + vec2(grain, broad) * 1.5) - 0.49);
    surface = mix(surface, dark, smoothstep(0.35, 0.7, grain) * 0.34);
    surface = mix(surface, mark, (1.0-smoothstep(0.012, 0.07, lava)) * 0.65);
  ` : style === 5 ? `
    // Works: engineered plates of varied widths, recessed conductors.
    float row = floor(q.y / 3.6);
    float offset = routeHash(vec2(row, ${seed}.0)) * 2.8;
    vec2 panel = vec2((q.x + offset) / 4.8, q.y / 3.6);
    vec2 cell = floor(panel);
    vec2 local = fract(panel);
    float seam = 1.0-smoothstep(0.008,0.035,min(min(local.x,1.0-local.x),min(local.y,1.0-local.y)));
    surface = mix(surface, light, routeHash(cell + ${seed}.0) * 0.26);
    surface = mix(surface, dark, seam * 0.82);
    float conductor = 1.0-smoothstep(0.012,0.05,abs(local.y-0.53));
    surface = mix(surface, mark, conductor * step(0.58,routeHash(cell+11.0)) * 0.36);
  ` : style === 6 ? `
    // Void: separated slate fragments and sparse stellar inclusions.
    vec2 shard = floor(q * vec2(0.48, 0.31));
    vec2 local = fract(q * vec2(0.48, 0.31));
    float cut = abs(local.x - local.y * (0.4 + routeHash(shard) * 0.8));
    surface = mix(dark, surface, 0.48 + routeHash(shard + ${seed}.0) * 0.4);
    surface = mix(surface, mark, (1.0-smoothstep(0.005,0.025,cut)) * 0.24);
    float fleck = step(0.96, routeHash(floor(q * 3.2) + 29.0));
    surface = mix(surface, light, fleck * 0.4);
  ` : style === 7 ? `
    // Temple: carved sandstone bands, angular glyphs and moss pockets.
    vec2 carving = vec2(q.x / 2.2, q.y / 4.1);
    vec2 cell = floor(carving);
    vec2 local = fract(carving);
    float border = min(min(local.x,1.0-local.x),min(local.y,1.0-local.y));
    float chevron = abs(abs(local.x-0.5) + (local.y-0.32)*0.7 - 0.25);
    surface = mix(surface, light, routeHash(cell + ${seed}.0) * 0.32);
    surface = mix(surface, dark, (1.0-smoothstep(0.015,0.07,border)) * 0.55);
    surface = mix(surface, mark, (1.0-smoothstep(0.015,0.055,chevron))
      * step(0.6,routeHash(cell+7.0)) * 0.4);
    surface = mix(surface, vec3(0.08,0.18,0.07), smoothstep(0.62,0.86,broad)*0.4);
  ` : `
    // Core: segmented circuit rails with cross-links, not reactor plates.
    vec2 circuit = vec2(q.x / 1.7, q.y / 5.2);
    vec2 cell = floor(circuit);
    vec2 local = fract(circuit);
    float rail = 1.0-smoothstep(0.012,0.045,abs(local.x-0.5));
    float cross = (1.0-smoothstep(0.012,0.04,abs(local.y-0.3)))
      * step(0.55,routeHash(cell+${seed}.0));
    surface = mix(surface, dark, step(0.7,routeHash(cell+19.0))*0.22);
    surface = mix(surface, mark, max(rail,cross)*0.42);
    surface = mix(surface, light, step(0.9,grain)*0.1);
  `}
  diffuseColor.rgb *= surface;
`;

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
  private readonly checkpointBurstPool: THREE.MeshBasicMaterial[] = [];
  private readonly biomeRoute = new Map<BiomeId, THREE.MeshStandardMaterial>();
  private readonly biomeSpikes = new Map<BiomeId, BiomeSpikeStyle>();

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
  /** M8.5 merged edge-line material (vertex-colored, view-owned geometry). */
  public readonly routeEdgeLine: THREE.LineBasicMaterial;
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
   * flow. Steady hot baseline from `setLavaPulse` (continuous glow,
   * faint ripple only) while `LevelView.updateLava` convects the crust plates
   * and descends the fall segments (no fluid simulation, no per-frame
   * allocation).
   */
  public readonly lavaSurface: THREE.MeshStandardMaterial;
  public readonly lavaDeep: THREE.MeshStandardMaterial;
  /** M8.4 small-area flow accents (traveling cores, pulses, lips). */
  public readonly lavaCore: THREE.MeshBasicMaterial;
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
  /**
   * M9.2 checkpoint-crystal family (shared, bounded): one translucent
   * idle gem + one bright activated core + one halo material for ALL
   * crystals (biome identity arrives through the burst tint + surrounding
   * section, never per-crystal materials). Activation bursts reuse the
   * pooled-ring pattern with their own fixed 4-material set (the
   * interaction pool's materials animate opacity individually and cannot
   * be shared across views).
   */
  public readonly checkpointIdle: THREE.MeshStandardMaterial;
  public readonly checkpointActive: THREE.MeshStandardMaterial;
  public readonly checkpointHalo: THREE.MeshBasicMaterial;

  // --- Shared geometries (unit shapes, scaled per-instance by views) ---
  public readonly unitBox: THREE.BoxGeometry;
  public readonly spikeCone: THREE.ConeGeometry;
  public readonly orbSphere: THREE.SphereGeometry;
  public readonly orbHalo: THREE.TorusGeometry;
  public readonly checkpointGem: THREE.OctahedronGeometry;
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
    // M8.5 neon edge-line pass: ONE merged LineSegments per level (see
    // LevelView.buildEdgeLines) shares this single vertex-colored line
    // material — route solids tint with the section accent, spike pyramids
    // retain authored biome colors or warm fallback. Bounded: +1 material,
    // +1 draw call, zero per-frame
    // allocation (re-tints are change-guarded in LevelView.setEdgeAccent).
    this.routeEdgeLine = track(new THREE.LineBasicMaterial({ vertexColors: true }));

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
    // M8.4: base lifted slightly (1.7 -> 1.85, still cream-safe — the
    // hotter read comes from the small-area lavaCore accents below).
    // M8.4 glow fix (human playtest on real GPU): the lava NEVER bloomed.
    // HDR math: surface 0xff5a00 @ 2.4 x exposure 1.15 -> luma ~0.79,
    // cores 0xffd166 flat -> luma ~0.78 — BOTH sat just UNDER the 0.8
    // bloom threshold, so on a real GPU the lava rendered as flat matte
    // plastic while trail/rails/portals carried halos (SwiftShader QA has
    // no bloom, which is why the stills hid it). Fix: push lava HDR luma
    // clearly PAST the threshold with margin, hue kept orange by holding
    // the red channel dominant and blue at 0 (ACES can't go white
    // without blue). No new meshes, no new draws.
    this.lavaSurface = track(
      new THREE.MeshStandardMaterial({
        color: 0xf15400,
        roughness: 0.55,
        metalness: 0,
        emissive: 0xff4a00,
        emissiveIntensity: 3.5,
      }),
    );
    // M8.4 flow core: small-area white-hot accents (traveling flow
    // cores, pour pulses, spill lips). Unlit basic material with an HDR
    // working-space color (values > 1): luma ~1.6 x exposure, so the
    // traveling bands bloom HARD on a real GPU and tone-map to
    // white-gold — genuine hot spots inside the orange body. NEVER large
    // areas (cream-clip rule).
    // M8.4 follow-up: hotter gold (the old amber subpixel-blended into
    // the surface at chase distance instead of reading as hot spots).
    this.lavaCore = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.25, 0.35) }));
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
    // M9.2 checkpoint crystals: pale diamond idle (translucent, gentle
    // emissive — reads as glass, never as a portal/orb/hazard family) +
    // hot bright core once activated (instant CHECKPOINT SAVED read).
    // Halo: unlit white-cyan ring, distinct from every portal language.
    this.checkpointIdle = track(
      new THREE.MeshStandardMaterial({
        color: 0x9fd8e8,
        roughness: 0.15,
        metalness: 0.1,
        emissive: 0x3d9db8,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.62,
      }),
    );
    this.checkpointActive = track(
      new THREE.MeshStandardMaterial({
        color: 0xcff6ff,
        roughness: 0.2,
        metalness: 0,
        emissive: 0x2fc4e8,
        emissiveIntensity: 1.7,
      }),
    );
    this.checkpointHalo = track(
      new THREE.MeshBasicMaterial({
        color: 0xbdf3ff,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      }),
    );
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
    // Keep the 36-segment ring silhouette; the tiny tube needs six faces,
    // not eight. Saves 144 triangles on every visible halo/rim across
    // portals and interaction rings without removing biome geometry.
    this.orbHalo = trackGeo(new THREE.TorusGeometry(0.62, 0.045, 6, 36));
    this.checkpointGem = trackGeo(new THREE.OctahedronGeometry(0.55));
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
    // M9.2 checkpoint-burst pool (same pattern, separate set — the
    // interaction pool is owned by InteractionView's animation).
    for (let i = 0; i < 4; i++) {
      this.checkpointBurstPool.push(
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

  /** Pooled ring materials for checkpoint bursts (fixed set, reused). */
  public checkpointBurstMaterials(): readonly THREE.MeshBasicMaterial[] {
    return this.checkpointBurstPool;
  }

  /** Cached only for authored spike bands; legacy hazards keep `hazard`.
   * Two materials per biome; socket meshes use static trim instancing.
   * No extra texture, shader, light or per-frame palette work. */
  public spikeBiome(biome: BiomeId): BiomeSpikeStyle {
    const cached = this.biomeSpikes.get(biome);
    if (cached !== undefined) return cached;
    const palette = SPIKE_BIOMES[biome];
    const material = new THREE.MeshStandardMaterial({
      color: palette.core,
      emissive: palette.core,
      emissiveIntensity: 0.18,
      roughness: palette.roughness,
      metalness: palette.metalness,
      flatShading: true,
    });
    const socket = new THREE.MeshStandardMaterial({
      color: ROUTE_BIOMES[biome].stone,
      roughness: palette.roughness, metalness: palette.metalness,
      emissive: palette.edge, emissiveIntensity: 0.12,
      flatShading: true,
    });
    const style = { material, socket, edge: new THREE.Color(palette.edge).multiplyScalar(2.5) };
    this.materials.push(material);
    this.materials.push(socket);
    this.biomeSpikes.set(biome, style);
    return style;
  }

  /** Opt-in Descent route skin. World-space coordinates avoid UV stretching
   * and tile repetition; each act uses a distinct procedural structure. */
  public routeBiome(biome: BiomeId): THREE.MeshStandardMaterial {
    const cached = this.biomeRoute.get(biome);
    if (cached !== undefined) return cached;
    const palette = ROUTE_BIOMES[biome];
    const seed = Object.keys(ROUTE_BIOMES).indexOf(biome) * 19 + 7;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: biome === 'garden' ? 0.7 : biome === 'works' ? 0.48 : 0.86,
      metalness: biome === 'works' || biome === 'core' ? 0.3 : 0.04,
      emissive: biome === 'void' ? 0x11101c : 0x0b0d0d,
      emissiveIntensity: 0.28,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nvarying vec3 vRouteWorldPos;\nvarying vec3 vRouteWorldNormal;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
         `#include <begin_vertex>
         vec4 routePosition = vec4(transformed, 1.0);
         vec3 routeNormal = objectNormal;
         #ifdef USE_INSTANCING
           routePosition = instanceMatrix * routePosition;
           routeNormal = mat3(instanceMatrix) * routeNormal;
         #endif
         vRouteWorldPos = (modelMatrix * routePosition).xyz;
         vRouteWorldNormal = normalize(mat3(modelMatrix) * routeNormal);`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
        `#include <common>
         varying vec3 vRouteWorldPos;
         varying vec3 vRouteWorldNormal;
         float routeHash(vec2 p) {
           return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
         }
         float routeNoise(vec2 p) {
           vec2 i = floor(p);
           vec2 f = fract(p);
           f = f * f * (3.0 - 2.0 * f);
           return mix(mix(routeHash(i), routeHash(i + vec2(1.0, 0.0)), f.x),
                      mix(routeHash(i + vec2(0.0, 1.0)), routeHash(i + vec2(1.0, 1.0)), f.x), f.y);
         }`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        vec3 routeN = abs(vRouteWorldNormal);
        vec2 routeUv = routeN.y > routeN.x && routeN.y > routeN.z
          ? vRouteWorldPos.xz : routeN.z > routeN.x ? vRouteWorldPos.xy : vRouteWorldPos.zy;
        ${routeSurfaceShader(palette.style, seed, palette)}
      `);
    };
    mat.customProgramCacheKey = () => `biome-route-world-v2-${biome}`;
    this.materials.push(mat);
    this.biomeRoute.set(biome, mat);
    return mat;
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
   * M8A lava glow: STABLE base emissive on the SHARED lava materials
   * (phase in [0,1), driven by sim time — pausing freezes it like every
   * other presentation clock). M8.4 follow-up: the old global breathing
   * swing (surface 1.9..2.6, deep 0.85..1.35, all meshes in lockstep)
   * read as the whole river flashing on/off, so it is gone — replaced by
   * a continuous hot baseline (surface 3.45..3.6 HDR, deep 1.0..1.1)
   * with only a faint ripple. Surface HDR luma ~1.0, always past the
   * 0.8 bloom threshold with margin — the lava genuinely blooms on a
   * real GPU instead of rendering matte. Motion comes from the
   * in `LevelView.updateLava` (flow cores, shear crust, pour pulses,
   * fall waves), not from brightness. In-place emissive retune only:
   * zero allocation, zero new draws, fully reversible.
   */
  public setLavaPulse(phase01: number): void {
    const wave = 0.5 + 0.5 * Math.sin(phase01 * Math.PI * 2);
    // Continuous-glow baselines: the lava NEVER has a dim phase and
    // NEVER sits under the bloom threshold — surface floor luma ~1.0
    // (threshold 0.8) so the whole body carries a real halo at all
    // times; the deeper red emissive (green/blue near 0) keeps ACES in
    // hot-orange territory instead of cream.
    this.lavaSurface.emissiveIntensity = 3.45 + wave * 0.15;
    this.lavaDeep.emissiveIntensity = 1.0 + wave * 0.1;
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
    this.biomeRoute.clear();
    this.biomeSpikes.clear();
    this.ringPool.length = 0;
  }
}
