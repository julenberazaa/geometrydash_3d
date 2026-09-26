import * as THREE from 'three';
import type { ProductionTheme } from '../visuals/productionTheme';
import type { LevelDefinition } from '../level/levelDefinition';
import { mulberry32 } from '../core/math';
import { BIOME_BODY, BIOME_GLOW, placeBiomeDressing, routeGroundAt, type DressInstance } from '../level/biomeDressing';

interface StaticBoxInstance {
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  color: number | THREE.Color;
  ry?: number; rz?: number;
}

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
  /** Directional face contrast and world-space stone grain for actual 3D
   * props. Uses instance transforms, so every chunk shares one program and
   * no repeatable image tile or extra draw call is needed. */
  private static voxelMaterial(motionTime?: { value: number }): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nvarying vec3 vVoxelWorld;\nvarying vec3 vVoxelNormal;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec4 voxelPosition = vec4(transformed, 1.0);
        vec3 voxelNormal = normal;
        #ifdef USE_INSTANCING
          voxelPosition = instanceMatrix * voxelPosition;
          voxelNormal = mat3(instanceMatrix) * voxelNormal;
        #endif
        vVoxelWorld = (modelMatrix * voxelPosition).xyz;
        vVoxelNormal = normalize(mat3(modelMatrix) * voxelNormal);
      `);
      if (motionTime !== undefined) {
        shader.uniforms.uLeafTime = motionTime;
        shader.vertexShader = shader.vertexShader.replace('#include <common>',
          '#include <common>\nuniform float uLeafTime;');
        shader.vertexShader = shader.vertexShader.replace('vec4 voxelPosition = vec4(transformed, 1.0);', `
          #ifdef USE_INSTANCING_COLOR
            if (instanceColor.g > instanceColor.b * 1.2 && instanceColor.g > instanceColor.r * 1.15) {
              transformed.x += sin(uLeafTime * 1.7 + instanceMatrix[3].z * 0.5) * 0.06;
              transformed.y += cos(uLeafTime * 1.1 + instanceMatrix[3].x) * 0.03;
            }
          #endif
          vec4 voxelPosition = vec4(transformed, 1.0);
        `);
      }
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        varying vec3 vVoxelWorld;
        varying vec3 vVoxelNormal;
        float voxelHash(vec3 p) {
          return fract(sin(dot(p, vec3(17.17, 57.43, 113.91))) * 43758.5453);
        }
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec3 voxelCell = floor(vVoxelWorld * 1.35);
        float voxelGrain = voxelHash(voxelCell) * 0.18;
        float voxelLarge = voxelHash(floor(vVoxelWorld * 0.22)) * 0.15;
        float voxelMicro = voxelHash(floor(vVoxelWorld * 6.0));
        float voxelPore = smoothstep(0.87, 0.99, voxelMicro);
        float voxelFace = 0.55 + max(vVoxelNormal.y, 0.0) * 0.34
          + max(vVoxelNormal.z, 0.0) * 0.16 + max(-vVoxelNormal.x, 0.0) * 0.12;
        diffuseColor.rgb *= voxelFace * (0.73 + voxelGrain + voxelLarge
          + voxelMicro * 0.24) * (1.0 - voxelPore * 0.28);
      `);
    };
    material.customProgramCacheKey = () => motionTime === undefined ? 'biome-voxel-world-v1' : 'biome-voxel-leaf-v1';
    return material;
  }
  /** Cold-built 96-unit chunks keep off-camera voxel instances off the GPU.
   * One shared geometry/material per layer; no per-frame work or allocation. */
  private static chunkBoxes(
    unitBox: THREE.BufferGeometry,
    material: THREE.Material,
    instances: readonly StaticBoxInstance[],
    chunkSize = 96,
  ): THREE.InstancedMesh[] {
    const groups = new Map<number, StaticBoxInstance[]>();
    for (const instance of instances) {
      const key = Number.isFinite(chunkSize) ? Math.floor(instance.z / chunkSize) : 0;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [instance]);
      else group.push(instance);
    }
    const meshes: THREE.InstancedMesh[] = [];
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    for (const group of groups.values()) {
      const mesh = new THREE.InstancedMesh(unitBox, material, group.length);
      for (let i = 0; i < group.length; i++) {
        const inst = group[i];
        if (inst === undefined) continue;
        dummy.position.set(inst.x, inst.y, inst.z);
        dummy.rotation.set(0, inst.ry ?? 0, inst.rz ?? 0);
        dummy.scale.set(inst.sx, inst.sy, inst.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (typeof inst.color === 'number') tint.setHex(inst.color);
        else tint.copy(inst.color);
        mesh.setColorAt(i, tint);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      meshes.push(mesh);
    }
    return meshes;
  }
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
  // Architecture layer: cold-built cullable chunks of large-scale biome forms
  // (towers, focal gate-arches, flanking walls, overhead canopies, bridges,
  // columns) filling the black void so the world reads as PLACES, not
  // platforms in emptiness. Static (built once, deterministic PRNG), one
  // shared material, per-instance biome colors baked by z (zero hot writes).
  // Everything sits off-route (|x| ≥ 8 or y ≥ 13 — never landable-looking,
  // never colliders) and fogged for foreground/midground/background depth.
  private readonly archMeshes: THREE.InstancedMesh[];
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
   * into culled chunks (solid silhouettes, glow accents and animated
   * fall strands), with shared unit-box geometry and material families.
   * Absent when the level declares no rows — other levels keep
   * their exact look, exact draw counts, exact materials.
   */
  private static buildBiomeDressing(
    unitBox: THREE.BoxGeometry,
    def?: LevelDefinition,
    fallTime?: { value: number },
  ): {
    solid: THREE.InstancedMesh[];
    glow: THREE.InstancedMesh[];
    flow: THREE.InstancedMesh[];
    solidMat: THREE.Material | null;
    glowMat: THREE.Material | null;
    flowMat: THREE.Material | null;
    count: number;
  } {
    const empty: {
      solid: THREE.InstancedMesh[];
      glow: THREE.InstancedMesh[];
      flow: THREE.InstancedMesh[];
      solidMat: THREE.Material | null;
      glowMat: THREE.Material | null;
      flowMat: THREE.Material | null;
      count: number;
    } = { solid: [], glow: [], flow: [], solidMat: null, glowMat: null, flowMat: null, count: 0 };
    const rows = def?.visualDressing;
    if (rows === undefined || rows.length === 0 || def === undefined) return empty;
    const instances = placeBiomeDressing(rows, (z) => routeGroundAt(def.solids, z));
    if (instances.length === 0) return empty;
    // Each anchor is a small voxel assembly. Batching the pieces into the
    // same shared chunks gives material/shape identity without per-prop draws.
    const pieces = EnvironmentView.expandBiomeDressing(instances);
    const solids = pieces.filter((inst) => !inst.glow);
    const glows = pieces.filter((inst) => inst.glow && inst.prop !== 'fall');
    const flows = pieces.filter((inst) => inst.glow && inst.prop === 'fall');
    const solidMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.9, metalness: 0.15, fog: true,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const solid = EnvironmentView.chunkBoxes(unitBox, solidMat, solids, 48);
    const glow = EnvironmentView.chunkBoxes(unitBox, glowMat, glows);
    let flowMat: THREE.MeshBasicMaterial | null = null;
    let flow: THREE.InstancedMesh[] = [];
    if (flows.length > 0 && fallTime !== undefined) {
      flowMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      flowMat.onBeforeCompile = (shader) => {
        shader.uniforms.uFallTime = fallTime;
        shader.vertexShader = shader.vertexShader.replace('#include <common>',
          '#include <common>\nvarying float vFallY;');
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvFallY = position.y;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
          '#include <common>\nuniform float uFallTime;\nvarying float vFallY;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
          #include <color_fragment>
          float fallBand = fract(vFallY * 5.0 + uFallTime * 2.4);
          diffuseColor.rgb *= 0.54 + 0.46 * smoothstep(0.0, 0.35, fallBand);
        `);
      };
      flowMat.customProgramCacheKey = () => 'biome-fall-motion-v1';
      flow = EnvironmentView.chunkBoxes(unitBox, flowMat, flows);
    }
    return { solid, glow, flow, solidMat, glowMat, flowMat, count: instances.length };
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
      // Bound the rotated box, not merely its anchor. Leaves/roots may
      // lean toward the route but never occupy its readable footprint.
      const plant = (a.biome === 'garden' || a.biome === 'temple')
        && (a.prop === 'foliage' || a.prop === 'strand' || a.prop === 'slab');
      const extent = (Math.abs(Math.cos(ry) * Math.cos(rz)) * sx
        + Math.abs(Math.cos(ry) * Math.sin(rz)) * sy + Math.abs(Math.sin(ry)) * sz) * 0.5;
      const hot = a.biome === 'foundry' || a.biome === 'crag';
      const x = plant || hot ? Math.sign(a.x) * Math.max(Math.abs(a.x + dx), 5.55 + extent) : a.x + dx;
      pieces.push({ ...a, x, y: a.y + dy, z: a.z + dz,
        sx, sy, sz, color, glow, ry, rz });
    };
    for (const a of anchors) {
      const body = BIOME_BODY[a.biome];
      const light = BIOME_GLOW[a.biome];
      if (a.prop === 'fall') {
        // Lava has an actual spill lip, a stepped curtain and a receiving
        // pool. Camera-facing detail lives on -Z, not behind the stream.
        if (a.biome !== 'garden') {
          const top = a.sy * 0.5;
          const bottom = -a.sy * 0.5;
          add(a, 0, top + 0.25, 0.6, a.sx * 1.7, 0.7, 1.7, 0x302c2b);
          add(a, 0, top + 0.63, 0.3, a.sx * 1.35, 0.12, 1.3, 0xff7118, true);
          for (let j = 0; j < 4; j++) {
            const y = top - (j + 0.5) * a.sy / 4;
            const dx = Math.sin(a.z + j * 1.7) * a.sx * 0.13;
            add(a, dx, y, -0.12 - j * 0.12,
              a.sx * (0.94 - j * 0.09), a.sy / 4 + 0.12, 0.55 + j * 0.1, 0xad3810);
            add(a, dx - a.sx * 0.15, y + 0.08, -0.48 - j * 0.17,
              a.sx * 0.32, a.sy / 4 + 0.16, 0.18, j % 2 ? 0xffb62e : 0xff7716, true);
            add(a, a.sx * 0.7, y, 0.12, a.sx * 0.4, a.sy / 4 * 0.85,
              1.15, j % 2 ? 0x443630 : 0x2b2928, false, j * 0.09);
          }
          add(a, 0, bottom - 0.28, -0.65, a.sx * 2.2, 0.65, 2.6, 0x342a25);
          add(a, 0, bottom + 0.08, -0.75, a.sx * 1.8, 0.13, 2.1, 0xff6712, true);
          for (let j = 0; j < 3; j++) add(a, (j - 1) * a.sx * 0.55,
            bottom + 0.23, -0.9 + (j % 2) * 0.6, a.sx * 0.38, 0.18, 0.65,
            j === 1 ? 0xffbc37 : 0x4a3025, j === 1, j * 0.15);
          continue;
        }
        add(a, 0, 0, 0, a.sx, a.sy, a.sz, 0x124d66);
        for (let j = 0; j < 4; j++) {
          const x = (j - 1.5) * a.sx * 0.23;
          add(a, x, (j % 2) * 0.5 - 0.25, a.sz * 0.55,
            a.sx * 0.11, a.sy * (0.83 + j * 0.03), 0.08,
            0x56dfff, true);
        }
        add(a, 0, -a.sy * 0.5, a.sz * 0.8,
          a.sx * 1.7, 0.16, a.sz * 2, 0x276b79);
        add(a, 0, -a.sy * 0.5 + 0.1, a.sz * 1.15,
          a.sx * 1.4, 0.05, a.sz * 1.2, 0x4bbbd7, true);
        continue;
      }
      if (a.prop !== 'foliage' && !(a.prop === 'strand'
        && (a.biome === 'garden' || a.biome === 'temple'))) pieces.push(a);
      switch (a.prop) {
        case 'foliage': {
          const base = -a.sy * 0.5;
          const crown = a.sy * 0.26;
          add(a, 0, base + a.sy * 0.38, 0, 0.24, a.sy * 0.76, 0.28, 0x51452c,
            false, a.ry, 0.12 * Math.sign(a.x));
          // Buttress roots visibly join the narrow stem to its bank.
          for (let j = 0; j < 3; j++) {
            const angle = a.z * 0.17 + j * 2.1;
            add(a, Math.cos(angle) * 0.48, base + 0.18, Math.sin(angle) * 0.48,
              0.17, 0.24, 1.2, 0x655237, false, -angle, 0.14);
          }
          // Individually folded leaves: thick midrib/lobe and a tapered,
          // drooping tip. Irregular radial tiers leave gaps in the crown.
          for (let j = 0; j < 7; j++) {
            const angle = a.ry + j * 2.399;
            const reach = 0.65 + (j % 3) * 0.25;
            const dx = Math.cos(angle) * reach;
            const dz = Math.sin(angle) * reach;
            const y = crown - (j % 3) * 0.27;
            add(a, dx, y, dz, 0.55 + (j % 2) * 0.21, 0.18, 1.55,
              j % 3 === 0 ? 0x638d3e : j % 2 ? 0x315f38 : 0x427a3c,
              false, Math.PI * 0.5 - angle, (j % 2 ? -1 : 1) * 0.22);
            add(a, dx * 1.62, y - 0.24, dz * 1.62, 0.28, 0.12, 0.88,
              0x376c36, false, Math.PI * 0.5 - angle, 0.38);
          }
          break;
        }
        case 'strand': {
          const vine = a.biome === 'garden' || a.biome === 'temple';
          for (let j = 0; j < 3; j++) {
            if (!vine) {
              add(a, (j - 1) * 0.38, (j - 1) * 0.45, (j % 2) * 0.32,
                0.13, a.sy * (0.5 + j * 0.11), 0.13, 0x385c69);
              continue;
            }
            const length = a.sy * (0.65 + j * 0.12);
            for (let k = 0; k < 4; k++) {
              const bend = Math.sin(k * 1.1 + j + a.z) * 0.23;
              const y = a.sy * 0.5 - (k + 0.5) * length / 4;
              add(a, (j - 1) * 0.43 + bend, y, (j % 2) * 0.32,
                0.09, length / 4 + 0.1, 0.1, 0x4a5931, false, 0, bend * 0.3);
              if (k % 2 === j % 2) add(a, (j - 1) * 0.43 + bend + 0.17,
                y - 0.08, 0.22, 0.38, 0.16, 0.57, 0x4c813c,
                false, j * 0.8, 0.48);
            }
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
          const moss = a.biome === 'garden' || a.biome === 'temple';
          for (let j = -1; j <= 1; j++) {
            add(a, j * a.sx * 0.26, a.sy * 0.53, (j % 2) * a.sz * 0.2,
              a.sx * 0.22, moss ? 0.18 + (j + 1) * 0.05 : 0.1, a.sz * 0.55,
              moss ? (j === 0 ? 0x638b42 : 0x3e6b39) :
                a.biome === 'crag' ? 0x79503a : 0x716656,
              false, j * 0.17);
            if (moss) {
              add(a, j * a.sx * 0.27, -a.sy * 0.15, -a.sz * 0.52,
                0.17, a.sy * 0.8 + 0.65, 0.22, 0x3c6537, false, 0, j * 0.13);
              add(a, j * a.sx * 0.27 + 0.15, -a.sy * 0.3, -a.sz * 0.55,
                0.44, 0.15, 0.53, 0x55823d, false, j * 0.7, 0.35);
            }
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
  private readonly moteWrapLow: Float32Array | null;
  private readonly moteWrapHigh: Float32Array | null;
  private static readonly MOTE_COUNT = 240;
  /**
   * M9.6.1 biome dressing (route-adjacent midground): TWO static
   * InstancedMeshes (solid silhouettes + glow accents, per-instance
   * colors, zero per-frame work, 2 draws) built once from the level's
   * `visualDressing` rows. Absent when the level declares none (other
   * levels keep their exact look). Never in the corridor (|x| ≥ 7),
   * never colliders, never landable-looking.
   */
  private readonly dressSolid: THREE.InstancedMesh[];
  private readonly dressGlow: THREE.InstancedMesh[];
  private readonly dressFlow: THREE.InstancedMesh[];
  private readonly fallTime = { value: 0 };
  private readonly organicMeshes: THREE.InstancedMesh[];
  private readonly dressCount: number;
  private readonly surfaceMeshes: THREE.InstancedMesh[];

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
    this.archMeshes = arch.meshes;
    for (const mesh of arch.meshes) this.scene.add(mesh);
    if (arch.material !== null) this.disposables.push(arch.material);
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
      this.moteWrapLow = motes.wrapLow;
      this.moteWrapHigh = motes.wrapHigh;
    } else {
      this.moteGeo = null;
      this.motePos = null;
      this.moteSpeed = null;
      this.moteWrapLow = null;
      this.moteWrapHigh = null;
    }
    // M9.6.1 biome dressing (opt-in per level, static, 2 draws).
    const dressing = EnvironmentView.buildBiomeDressing(pillarGeo, def, this.fallTime);
    this.dressSolid = dressing.solid;
    this.dressGlow = dressing.glow;
    this.dressCount = dressing.count;
    for (const mesh of dressing.solid) this.scene.add(mesh);
    for (const mesh of dressing.glow) this.scene.add(mesh);
    this.dressFlow = dressing.flow;
    for (const mesh of dressing.flow) this.scene.add(mesh);
    if (dressing.solidMat !== null) this.disposables.push(dressing.solidMat);
    if (dressing.glowMat !== null) this.disposables.push(dressing.glowMat);
    if (dressing.flowMat !== null) this.disposables.push(dressing.flowMat);
    const organic = EnvironmentView.buildOrganicForms(def, this.fallTime);
    this.organicMeshes = organic.meshes;
    for (const mesh of organic.meshes) this.scene.add(mesh);
    if (organic.geometry !== null) this.disposables.push(organic.geometry);
    if (organic.material !== null) this.disposables.push(organic.material);
    const surface = EnvironmentView.buildBiomeSurfaces(pillarGeo, def);
    this.surfaceMeshes = surface.meshes;
    for (const mesh of surface.meshes) this.scene.add(mesh);
    if (surface.material !== null) this.disposables.push(surface.material);
  }

  /** QA observability: total biome dressing instances (0 when absent). */
  public get dressInstances(): number {
    return this.dressCount;
  }

  /** A second, genuinely volumetric primitive breaks the all-box skyline.
   * Sparse leaf/moss lobes and mineral shards are authored off-route; one
   * low-poly geometry and one shader/material are shared across the level. */
  private static buildOrganicForms(def?: LevelDefinition, motionTime?: { value: number }): {
    meshes: THREE.InstancedMesh[];
    geometry: THREE.OctahedronGeometry | null;
    material: THREE.MeshBasicMaterial | null;
  } {
    if (def?.visualDressing === undefined) return { meshes: [], geometry: null, material: null };
    const instances: StaticBoxInstance[] = [];
    const rand = mulberry32(260926);
    for (const row of def.visualDressing) {
      const plant = row.biome === 'garden' || row.biome === 'temple';
      const mineral = row.biome === 'cavern' || row.biome === 'crag';
      if (!plant && !mineral) continue;
      for (let z = row.z0 + 12; z < row.z1 - 9; z += 14 + rand() * 12) {
        for (const side of [-1, 1]) {
          const x = side * (8.8 + rand() * 1.6);
          const height = plant ? 1.1 + rand() * 4.5 : -0.8 + rand() * 4.5;
          if (plant) {
            for (let j = 0; j < 5; j++) {
              const angle = rand() * Math.PI * 2;
              const length = 1.3 + rand() * 1.1;
              const outward = Math.cos(angle);
              const depth = Math.sin(angle);
              for (let k = 0; k < 3; k++) {
                const reach = 0.35 + k * length * 0.38;
                const sx = k === 0 ? 0.1 : k === 1 ? 0.48 : 0.23;
                const sz = k === 0 ? 0.55 : length * (k === 1 ? 0.65 : 0.4);
                const sy = k === 0 ? 0.1 : 0.12;
                // A bounding sphere is conservative for every rotation.
                const extent = Math.hypot(sx, sy, sz);
                const leafX = x + outward * reach;
                instances.push({
                  x: side * Math.max(Math.abs(leafX), 5.55 + extent),
                  y: height + j * 0.22 - k * 0.18, z: z + depth * reach,
                  sx, sy, sz, color: k === 0 ? 0x586238 : j % 2 ? 0x40763d : 0x648e42,
                  ry: Math.PI * 0.5 - angle, rz: (j % 2 ? -1 : 1) * (0.16 + k * 0.15),
                });
              }
            }
            continue;
          }
          for (let j = 0; j < 4; j++) {
            const dx = (rand() - 0.5) * 1.9;
            const dz = (rand() - 0.5) * 2.8;
            const radius = 0.45 + rand() * 0.6;
            instances.push({
              x: x + dx, y: height + (rand() - 0.5) * 1.7,
              z: z + dz,
              sx: radius * 0.58,
              sy: radius * (1.8 + rand() * 1.3),
              sz: radius * 0.65,
              color: row.biome === 'cavern' ? (j % 2 === 0 ? 0x4ba4b4 : 0x315d78)
                  : (j % 2 === 0 ? 0x694336 : 0x3e2b28),
              ry: rand() * Math.PI,
              rz: (rand() - 0.5) * 0.35,
            });
          }
        }
      }
    }
    if (instances.length === 0) return { meshes: [], geometry: null, material: null };
    // Eight faces keep the pointed leaf/crystal profile. An icosahedron
    // spent 20 faces on every tiny petiole without visible silhouette gain.
    const geometry = new THREE.OctahedronGeometry(1, 0);
    const material = EnvironmentView.voxelMaterial(motionTime);
    const meshes = EnvironmentView.chunkBoxes(geometry, material, instances, 48);
    for (const mesh of meshes) if (mesh.boundingSphere !== null) mesh.boundingSphere.radius += 0.2;
    return { meshes, geometry, material };
  }

  /** A single thin voxel facade on existing route solids. No topology or
   * gameplay geometry is created; tiles sit flush against their host face. */
  private static buildBiomeSurfaces(
    unitBox: THREE.BoxGeometry,
    def?: LevelDefinition,
  ): { meshes: THREE.InstancedMesh[]; material: THREE.Material | null } {
    if (def?.visualDressing === undefined) return { meshes: [], material: null };
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
      if (hz < 0.7 || (hx < 0.7 && biome !== 'works')) continue;
      const base = BIOME_BODY[biome];
      const accent = biome === 'garden' || biome === 'temple' ? 0x3e7544
        : biome === 'cavern' ? 0x355d75
          : biome === 'crag' || biome === 'foundry' ? 0x70432e
            : biome === 'works' ? 0x3e6962 : 0x544966;
      const palette = [base, accent, base, accent, base];
      const machinery = biome === 'works' || biome === 'core';
      // A sealed reactor shell hides the exterior machines. Put actual
      // service panels and conduits on its inward face, beyond the ±5.4
      // playable footprint. These belong to the same surface batch; they
      // never cross a lane or create apparent landing surfaces.
      const innerWall = Math.abs(solid.center.x) - hx;
      if (biome === 'works' && innerWall >= 5.8 && innerWall <= 8 && hz > 12 && hy > 3) {
        const side = Math.sign(solid.center.x);
        const faceX = side * (innerWall - 0.16);
        for (let station = z - hz + 7; station < z + hz - 5; station += 15 + rand() * 4) {
          const panelY = solid.center.y + (Math.floor(station) % 2 ? 1.8 : -1.7);
          tiles.push({ x: faceX, y: panelY, z: station,
            sx: 0.22, sy: 1.8, sz: 1.9, color: 0x283e48 });
          for (let rib = 0; rib < 3; rib++) tiles.push({
            x: faceX - side * 0.14, y: panelY - 0.52 + rib * 0.5, z: station,
            sx: 0.07, sy: 0.13, sz: 1.45, color: rib === 1 ? 0x5da08c : 0x486572,
          });
          for (const offset of [-3.6, 3.6]) {
            tiles.push({ x: faceX, y: solid.center.y + offset, z: station,
              sx: 0.24, sy: 0.26, sz: 8.3, color: 0x4b727b });
            tiles.push({ x: faceX - side * 0.03, y: solid.center.y + offset, z: station - 3.5,
              sx: 0.3, sy: 0.48, sz: 0.38, color: 0x8a9c95 });
          }
        }
      }
      // Front facing block face: inset patches form irregular stone/metal
      // courses. A gap around every patch exposes the original material.
      if (hy >= 0.35) {
        const cols = machinery ? Math.min(7, Math.max(3, Math.floor(hx * 1.65)))
          : Math.min(5, Math.max(2, Math.floor(hx * 1.2)));
        const width = (hx * 1.82) / cols;
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < cols; col++) {
            if (!machinery && rand() < 0.4) continue;
            const px = solid.center.x - hx * 0.91 + width * (col + 0.5 + (row % 2) * 0.12);
            const py = solid.center.y + (machinery ? (row === 0 ? -0.42 : 0.42)
              : (rand() - 0.5) * 1.15) * hy;
            tiles.push({ x: px, y: py, z: z - hz - 0.018,
              sx: width * (machinery ? 0.79 : 0.42 + rand() * 0.4),
              sy: Math.min(hy * 0.66, machinery ? 0.46 : 0.12 + rand() * 0.4), sz: 0.025,
              color: palette[Math.floor(rand() * palette.length)] ?? base });
          }
        }
      }
      // Sparse top-face chips remain low profile and dark: they are surface
      // texture, never an apparent obstacle or landing platform.
      if (hy <= 1.5 && hx >= 1.3 && hz >= 1.3) {
        for (let j = 0; j < (machinery ? 6 : 3); j++) {
          tiles.push({
            x: solid.center.x + (machinery ? ((j % 3) - 1) * 0.52 : (rand() - 0.5) * 1.3) * hx,
            y: solid.center.y + hy + 0.033,
            z: z + (machinery ? (j < 3 ? -0.45 : 0.45) : (rand() - 0.5) * 1.5) * hz,
            sx: Math.min(hx * (machinery ? 0.43 : 0.15 + rand() * 0.25), 1.25), sy: 0.012,
            sz: Math.min(hz * (machinery ? 0.67 : 0.15 + rand() * 0.25), 1.25),
            color: j === 0 && biome === 'garden' ? 0x3c703c : palette[(j + 1) % palette.length] ?? base,
          });
        }
      }
    }
    if (tiles.length === 0) return { meshes: [], material: null };
    const material = EnvironmentView.voxelMaterial();
    return { meshes: EnvironmentView.chunkBoxes(unitBox, material, tiles), material };
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
   * Shared box geometry and material; cullable InstancedMesh chunks.
   */
  private static buildArchitecture(
    unitBox: THREE.BoxGeometry,
    levelLengthZ: number,
    def?: LevelDefinition,
  ): { meshes: THREE.InstancedMesh[]; material: THREE.MeshBasicMaterial | null } {
    interface ArchItem {
      x: number;
      y: number;
      z: number;
      sx: number;
      sy: number;
      sz: number;
      color: THREE.Color;
      ry?: number;
      rz?: number;
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
    const push = (x: number, y: number, z: number, sx: number, sy: number, sz: number,
      hex: number, mul: number, ry = 0, rz = 0): void => {
      const biome = def?.visualDressing?.find((row) => z >= row.z0 && z < row.z1)?.biome;
      if (biome === 'foundry' || biome === 'crag') {
        const extent = (Math.abs(Math.cos(ry) * Math.cos(rz)) * sx
          + Math.abs(Math.cos(ry) * Math.sin(rz)) * sy + Math.abs(Math.sin(ry)) * sz) * 0.5;
        x = (x < 0 ? -1 : 1) * Math.max(Math.abs(x), 5.55 + extent);
      }
      items.push({ x, y, z, sx, sy, sz, color: new THREE.Color(hex).multiplyScalar(mul), ry, rz });
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
      if (z < -10 || z > levelLengthZ + 10) continue;
      const biome = def?.visualDressing?.find((row) => z >= row.z0 && z < row.z1)?.biome;
      // The old every-6-u full-width portal frames closed down the chase
      // view. Keep their rhythm in Rift; Descent uses spaced side landmarks.
      if (z - lastArchZ < (biome === undefined ? 6 : 26)) continue;
      lastArchZ = z;
      impactTick++;
      const accent = accentAtZ(z);
      const hot = impactTick % 7 === 0;
      if (biome === undefined) {
        push(-7.5, 5.5, z, 1.2, 11, 1.2, accent, hot ? 0.8 : 0.35);
        push(7.5, 5.5, z, 1.2, 11, 1.2, accent, hot ? 0.8 : 0.35);
        push(0, 11.6, z, 16.2, 1.2, 1.2, accent, hot ? 1.0 : 0.55);
        continue;
      }
      for (const side of [-1, 1]) {
        const x = side * 10.4;
        if (biome !== 'garden' && biome !== 'temple') {
          push(x, 3.2, z, 2.3, 6.4, 2.2, BIOME_BODY[biome], 1.1);
          push(x, 6.5, z, 3.2, 0.45, 2.8, BIOME_BODY[biome], 1.25);
        }
        if (biome === 'garden' || biome === 'temple') {
          for (let j = 0; j < 4; j++) {
            push(x + side * (j % 2) * 0.28, 0.9 + j * 1.35, z + (j % 3) * 0.25,
              1.65 - j * 0.15, 1.2, 1.9, 0x53604b, 0.85 + j * 0.06, j * 0.08);
            push(x + side * 0.4, 1.5 + j * 1.35, z - 0.65,
              0.7, 0.22, 0.85, 0x527c3b, 0.8, j * 0.23);
          }
        } else if (biome === 'crag' || biome === 'foundry') {
          push(side * 9.2, 2.7, z + 0.9, 0.2, 5.1, 0.16,
            biome === 'crag' ? 0xff5b18 : 0xff9631, 0.7);
        } else if (biome === 'cavern' || biome === 'void' || biome === 'core') {
          push(side * 10.2, 7.8, z, 0.45, 2.1, 0.65, BIOME_GLOW[biome], 0.42,
            0, side * 0.25);
        } else if (biome === 'works') {
          push(side * 9.2, 4.6, z + 0.9, 0.14, 4, 0.16, 0x73cbb1, 0.55);
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
      const overgrown = biome === 'garden' || biome === 'temple';
      const volcanic = biome === 'foundry' || biome === 'crag';
      if (volcanic) {
        if (sx > 12) return; // Keep the hazard sightline open; no decorative roof.
        if (sz > 10 || (sx >= 3 && sy >= 8)) {
          // Replace the smooth monolith itself with separated, deep strata.
          // Deterministic offsets do not perturb other biomes' scatter seed.
          const bands = sz > 10 ? 5 : 4;
          for (let j = 0; j < bands; j++) {
            const n = Math.sin(z * 0.31 + j * 2.1);
            push(x + Math.sign(x) * n * 0.45,
              sz > 10 ? y + n * 0.8 : y - sy * 0.5 + (j + 0.5) * sy / bands,
              sz > 10 ? z - sz * 0.5 + (j + 0.5) * sz / bands : z + n * 0.6,
              sx * (0.8 + Math.abs(n) * 0.18),
              sz > 10 ? sy * (0.7 + Math.abs(n) * 0.25) : sy / bands * 0.88,
              sz > 10 ? sz / bands * 0.86 : sz * (0.75 + Math.abs(n) * 0.2),
              j % 2 ? 0x3b3432 : 0x27292b, 0.95, n * 0.1, n * 0.04);
          }
        } else push(x, y, z, sx, sy, sz, 0x36302d, 0.95);
      } else if (overgrown && sy >= 8 && sx >= 3) {
        for (let j = 0; j < 4; j++) {
          items.push({ x: x + (j % 2 ? 0.4 : -0.3),
            y: y - sy * 0.5 + (j + 0.5) * sy * 0.24,
            z: z + (j % 3) * 0.45, sx: sx * (0.92 - j * 0.1),
            sy: sy * 0.22, sz: sz * (0.94 - j * 0.08), color: c,
            ry: (j - 1.5) * 0.08 });
        }
      } else if (overgrown && sx <= 2 && sz <= 2 && sy > 12) {
        for (let j = 0; j < 3; j++) {
          push(x + (j - 1) * 0.24, y - sy / 3 + j * sy / 3, z + j * 0.18,
            0.28, sy / 3 + 0.2, 0.34, 0x564b33, 0.9, 0, (j - 1) * 0.07);
        }
      } else if (!(overgrown && sx > 12)) {
        // Jungle overhead slabs hid the sky and read as a green ceiling.
        items.push({ x, y, z, sx, sy, sz, color: c });
      }
      if (biome === null) return;
      // Large formerly flat towers gain a readable block silhouette and
      // material-specific facade. All details share this architecture batch.
      if (sx >= 3 && sy >= 8) {
        const faceZ = z - sz * 0.51;
        // Rough block faces project toward the approaching camera. These
        // are actual ledges/crevices; changing only the base hue left large
        // pillars looking like smooth rectangular placeholders.
        if (volcanic) {
          for (let j = 0; j < 8; j++) {
            const n = Math.sin(z + j * 2.4);
            const blockY = y + sy * ((j % 4) / 4 - 0.38);
            push(x + (j % 2 ? -1 : 1) * sx * 0.25, blockY,
              faceZ - 0.5 - Math.abs(n) * 0.6,
              sx * 0.42, sy * 0.16, 1.1 + Math.abs(n),
              j % 2 ? 0x403833 : 0x292c2e, 1.0, n * 0.12, n * 0.06);
            if (j % 3 === 0) push(x + (j % 2 ? -1 : 1) * sx * 0.25,
              blockY - sy * 0.085, faceZ - 1.1,
              sx * 0.34, 0.12, 0.16, 0xff6815, 0.95, n * 0.12);
          }
        } else if (biome !== 'works' && biome !== 'core' && biome !== 'void') {
          for (let j = 0; j < (overgrown ? 8 : 18); j++) {
            const moss = (biome === 'garden' || biome === 'temple') && j % 3 === 0;
            push(x + (rand() - 0.5) * sx * 0.88,
              y + (rand() - 0.5) * sy * 0.86,
              faceZ - rand() * 0.38,
              sx * (0.12 + rand() * 0.19),
              moss ? 0.25 + rand() * 0.35 : 0.6 + rand() * 1.6,
              0.28 + rand() * 0.6,
              moss ? 0x507f3c : BIOME_BODY[biome], moss ? 1.1 : 0.85 + rand() * 0.5);
          }
        }
        for (let j = -1; j <= 1; j++) {
          const inset = (j % 2) * sx * 0.12;
          push(x + j * sx * 0.28 + inset, y + sy * (0.21 + j * 0.05), faceZ,
            sx * 0.22, sy * 0.1, 0.12, BIOME_BODY[biome], 1.55);
        }
        if (biome === 'garden' || biome === 'temple') {
          for (let j = -1; j <= 1; j++) {
            push(x + j * sx * 0.23, y + sy * 0.42, z - sz * 0.15,
              sx * 0.28, 0.3 + (j + 1) * 0.12, sz * 0.65, 0x4a783c, 0.8, j * 0.21);
            for (let k = 0; k < 3; k++) {
              const bend = Math.sin(k * 1.3 + j) * 0.28;
              const rootY = y + sy * (0.4 - k * 0.105);
              push(x + j * sx * 0.24 + bend, rootY, faceZ - 0.22,
                0.12, sy * 0.11, 0.13, 0x4e6234, 0.8, 0, bend * 0.22);
              if (k % 2 === 0) push(x + j * sx * 0.24 + bend + 0.17,
                rootY - 0.3, faceZ - 0.35, 0.4, 0.16, 0.66, 0x57833d, 0.85, j * 0.65, 0.4);
            }
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
          push(x, y + sy * 0.05, faceZ - 0.08,
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
    // Visible side channels live just beyond the route footprint. The old
    // deep bed (y=-4.5) disappeared behind the slab in the chase camera.
    for (const row of def?.visualDressing ?? []) {
      if (row.biome !== 'garden' && row.biome !== 'crag' && row.biome !== 'foundry') continue;
      const water = row.biome === 'garden';
      for (let z = row.z0 + 8; z < row.z1 - 8; z += 15 + rand() * 7) {
        for (const side of [-1, 1]) {
          push(side * 13.8, water ? -2.5 : -3.8, z,
            12.5, 0.25, 17.9, water ? 0x0d465f : 0x63200e, 0.82);
          push(side * 11.5, water ? -1.25 : -2.2, z,
            7.1, 0.18, 17.6, water ? 0x167eac : 0xc7440d, 0.96);
          for (let j = 0; j < 4; j++) {
            push(side * (9.0 + j * 1.6), water ? -1.11 : -2.06,
              z + (j - 1.5) * 3.3, 0.2, 0.035, 4.7,
              water ? 0x8ce9ee : 0xffa22b, 0.58);
          }
        }
      }
      if (water) {
        for (let z = row.z0 + 10; z < row.z1 - 10; z += 24 + rand() * 8) {
          for (const side of [-1, 1]) {
            const x = side * (12.4 + (Math.floor(z / 20) % 2) * 1.2);
            for (let j = 0; j < 3; j++) {
              push(x + side * j * 0.16, 0.3 + j * 2.5, z + j * 0.12,
                0.32 - j * 0.04, 2.65, 0.36, 0x594b32, 0.9, 0, -side * 0.065);
              push(x + side * (j - 1) * 0.75, -0.75, z + j * 0.42,
                0.2, 0.28, 1.7, 0x655333, 0.85, j * 0.8, 0.2);
            }
            for (let j = 0; j < 4; j++) {
              const angle = j * 2.399 + z;
              const dx = Math.cos(angle);
              const dz = Math.sin(angle);
              push(x + dx, 6.7 - (j % 3) * 0.4, z + dz,
                0.68, 0.18, 2.1, j % 2 ? 0x497c38 : 0x315f36, 0.88,
                Math.PI * 0.5 - angle, 0.25);
              push(x + dx * 1.8, 6.35 - (j % 3) * 0.4, z + dz * 1.8,
                0.32, 0.12, 1.1, 0x50873d, 0.82, Math.PI * 0.5 - angle, 0.4);
            }
          }
        }
        for (let z = row.z0 + 18; z < row.z1 - 12; z += 30 + rand() * 12) {
          for (const side of [-1, 1]) {
            const x = side * 7.85;
            push(x, 2.35, z, 1.35, 7.1, 0.34, 0x228db4, 0.86);
            for (let j = -1; j <= 1; j++) {
              push(x + j * 0.52, 2.35 + j * 0.18, z + 0.22,
                0.23, 6.8, 0.09, 0xb4f5f2, 0.68);
              push(x + j * 0.57, -1.0, z + 0.8 + j * 0.33,
                0.4, 0.12, 0.55, 0xc4f9f1, 0.62);
            }
            push(side * 9.2, 5.95, z - 0.25, 3.4, 0.45, 2.0, 0x466c4c, 0.9);
          }
        }
      } else {
        const sites = row.biome === 'foundry' ? [0.12, 0.47, 0.82] : [0.21, 0.68];
        for (let i = 0; i < sites.length; i++) {
          const z = row.z0 + (row.z1 - row.z0) * (sites[i] ?? 0.5);
          const side = (i + row.seed) % 2 === 0 ? 1 : -1;
          const x = side * (9.0 + i * 0.65);
          const top = 5.8 + i * 1.1;
          // Medium-depth fractured cliff surrounds a foreground spill.
          for (let j = 0; j < 7; j++) {
            const dx = side * (1.8 + (j % 3) * 1.1);
            const height = 2.7 + (j % 4) * 1.25;
            push(x + dx, height * 0.5, z + (j - 3) * 1.0,
              1.6 + (j % 2) * 0.6, height, 1.6 + (j % 3) * 0.3,
              j % 2 ? 0x3b3430 : 0x26282b, 0.95, j * 0.11, (j % 2 ? -1 : 1) * 0.06);
            if (j % 2 === 0) push(x + dx - side * 0.65, height * 0.62,
              z + (j - 3) * 1.0 - 0.9, 0.12, height * 0.45, 0.18, 0xff6815, 0.85, 0, 0.14);
          }
          push(x, top, z + 0.7, 3.1, 0.65, 2.2, 0x332c29, 0.95);
          push(x, top + 0.36, z + 0.5, 2.4, 0.12, 1.8, 0xff861c, 0.95);
          for (let j = 0; j < 4; j++) {
            const y = top - (j + 0.5) * (top + 1.6) / 4;
            const dx = Math.sin(j * 1.5 + i) * 0.23;
            push(x + dx, y, z - j * 0.2, 1.85 - j * 0.2,
              (top + 1.6) / 4 + 0.15, 0.75 + j * 0.18, 0xcb410d, 0.95);
            push(x + dx - side * 0.26, y + 0.05, z - 0.48 - j * 0.29,
              0.6, (top + 1.6) / 4 + 0.18, 0.18, j % 2 ? 0xffae27 : 0xff7416, 1.0);
          }
          push(x, -1.95, z - 1.0, 4.2, 0.85, 4.5, 0x362a25, 0.95);
          push(x, -1.49, z - 1.15, 3.7, 0.16, 4.0, 0xf55d10, 0.9);
          for (let j = 0; j < 4; j++) {
            push(x + side * ((j % 2) * 1.8 - 0.9), -1.25 + (j % 2) * 0.25,
              z - 2.4 + j * 0.85, 1.0, 0.4, 0.9, j === 1 ? 0xffa323 : 0x382d28,
              0.9, j * 0.2);
          }
        }
      }
    }
    // Authored physical silhouettes beside the track. These share the
    // architecture geometry/material and remain outside the ±5.4 route;
    // the density is fixed by act rather than randomized every frame.
    for (const row of def?.visualDressing ?? []) {
      const side = row.seed % 2 === 0 ? 1 : -1;
      if (row.biome === 'garden' || row.biome === 'temple') {
        for (let z = row.z0 + 12; z < row.z1 - 8; z += 32 + rand() * 10) {
          for (const s of [-1, 1]) {
            const x = s * (7.9 + rand() * 1.2);
            // Broken banks carry roots and moss, not tree-sized green boxes.
            // x >= 9.2 leaves room for every rotated leaf/root outside ±5.4.
            const bankX = s * Math.max(Math.abs(x), 9.2);
            for (let j = 0; j < 3; j++) {
              push(bankX + s * (j - 1) * 0.7, 0.4 + j * 0.42, z + (j % 2) * 0.7,
                1.65, 0.8, 2.1, 0x4a5844, 0.85, j * 0.19, 0.07);
              push(bankX + s * (j - 1) * 0.65, 0.88 + j * 0.42, z + 0.4,
                1.1, 0.18, 1.35, j % 2 ? 0x63863d : 0x426c36, 0.9, j * 0.25);
            }
            push(bankX, 2.3, z, 0.22, 3.2, 0.24, 0x5d5033, 0.85, 0, s * 0.13);
            for (let j = 0; j < 4; j++) {
              const angle = j * 2.399 + z * 0.13;
              const dx = Math.cos(angle);
              const dz = Math.sin(angle);
              push(bankX + dx * 0.95, 3.9 - (j % 3) * 0.35, z + dz,
                0.6, 0.16, 1.9, j % 2 ? 0x426e37 : 0x608b3e, 0.9,
                Math.PI * 0.5 - angle, 0.25);
              push(bankX + dx * 1.65, 3.55 - (j % 3) * 0.35, z + dz * 1.65,
                0.26, 0.11, 0.95, 0x3d7338, 0.85, Math.PI * 0.5 - angle, 0.4);
              if (j < 2) for (let k = 0; k < 3; k++) {
                const bend = Math.sin(k + j) * 0.21;
                push(bankX + s * (j - 0.5) * 0.85 + bend,
                  3.1 - k * 0.72, z - 0.85, 0.1, 0.8, 0.12, 0x486635, 0.8, 0, bend * 0.3);
              }
            }
          }
        }
      } else if (row.biome === 'foundry' || row.biome === 'works') {
        const stations = [0.18, 0.53, 0.84];
        for (let i = 0; i < stations.length; i++) {
          const z = row.z0 + (row.z1 - row.z0) * (stations[i] ?? 0.5);
          for (const s of [-1, 1]) {
            const x = s * (9.7 + (i === 1 ? 1.3 : 0));
            const hot = row.biome === 'foundry';
            // Each station has a different machine silhouette. The conduit
            // connects to the volume instead of being an isolated stripe.
            push(x, 4.0, z, 1.0, 1.0, 17, hot ? 0x4f4038 : 0x3e6260, 1.0);
            push(x - s * 0.2, 4.0, z, 0.18, 0.18, 16.3,
              hot ? 0xff6c19 : 0x60d8c0, 0.66);
            for (const dz of [-6, 0, 6]) push(x, 4.0, z + dz,
              1.35, 1.35, 0.36, hot ? 0x6b5243 : 0x618077, 0.9);
            if (i === 0) {
              push(x + s * 2.0, 4.0, z, 3.1, 7.5, 3.1,
                hot ? 0x3c3433 : 0x354b4d, 0.9);
              push(x + s * 2.0, 7.9, z, 3.8, 0.36, 3.8,
                hot ? 0x82624c : 0x71948c, 0.8);
            } else if (i === 1) {
              push(x + s * 1.1, 4.7, z, 4.8, 5.0, 1.2,
                hot ? 0x3d302d : 0x324e51, 0.85);
              push(x + s * 1.1, 4.7, z + 0.7, 3.4, 0.35, 0.2,
                hot ? 0xff7828 : 0x67e0d2, 0.5, 0, 0.55);
              push(x + s * 1.1, 4.7, z + 0.7, 3.4, 0.35, 0.2,
                hot ? 0xff7828 : 0x67e0d2, 0.5, 0, -0.55);
            } else {
              for (let j = -1; j <= 1; j++) {
                push(x + s * (1.7 + j * 1.1), 3.9 + Math.abs(j) * 0.7,
                  z + j * 1.5, 0.9, 5.2 + Math.abs(j), 1.0,
                  hot ? 0x493a31 : 0x415e5d, 0.9);
              }
            }
          }
        }
      } else if (row.biome === 'cavern') {
        for (let z = row.z0 + 15; z < row.z1 - 8; z += 20 + rand() * 10) {
          for (const s of [-1, 1]) {
            const x = s * 9.4;
            push(x, 5.4, z, 3.1, 9.8, 4.5, 0x2c4758, 0.9);
            for (let j = -2; j <= 2; j++) {
              push(x + s * j * 0.65, 10.0 - Math.abs(j) * 0.5,
                z + j * 0.6, 0.56, 3.1 + (j + 2) * 0.52, 0.7,
                j % 2 === 0 ? 0x44778c : 0x263f50, 0.9,
                0, j * 0.1);
            }
            push(x - s * 1.2, 2.6, z + 1.8, 0.55, 3.4, 0.68, 0x63c4df, 0.35,
              0, s * 0.22);
          }
        }
      } else if (row.biome === 'void' || row.biome === 'core') {
        const sites = row.biome === 'void' ? [0.23, 0.69] : [0.16, 0.51, 0.88];
        for (let i = 0; i < sites.length; i++) {
          const z = row.z0 + (row.z1 - row.z0) * (sites[i] ?? 0.5);
          const x = side * (11.2 + i * 1.8);
          // Fractured orbital rings: several separated masses at different
          // depth/height, with a thin luminous spine in the core only.
          for (let j = -2; j <= 2; j++) {
            const y = 4.2 + (2 - Math.abs(j)) * 1.7;
            push(x + side * j * 1.45, y, z + j * 1.9,
              2.7 - Math.abs(j) * 0.35, 1.0 + (j + 2) * 0.21,
              3.1 - Math.abs(j) * 0.3,
              row.biome === 'void' ? 0x444566 : 0x66465e, 0.72,
              j * 0.16, 0.12 * j);
          }
          push(x + side * 1.5, 8.3, z + 2.5, 0.3, 5.0, 0.3,
            BIOME_GLOW[row.biome], row.biome === 'core' ? 0.5 : 0.2);
        }
      }
    }
    // Close midground formations give each act a physical boundary. The
    // distant towers alone left a flat sky behind the track. Broken banks
    // stay beside the playable footprint; gaps and asymmetric depths avoid
    // turning them into another repeated tunnel stamp.
    for (const row of def?.visualDressing ?? []) {
      if (row.biome === 'void' || row.biome === 'core') continue;
      const organic = row.biome === 'garden' || row.biome === 'temple';
      const volcanic = row.biome === 'foundry' || row.biome === 'crag';
      const tech = row.biome === 'works';
      const stone = volcanic ? 0x3a2b24 : organic ? 0x465345
        : tech ? 0x304d52 : row.biome === 'cavern' ? 0x2c4657 : 0x42364e;
      for (let z = row.z0 + 6; z < row.z1 - 6; z += 22 + rand() * 13) {
        for (const side of [-1, 1]) {
          const baseX = side * (8.3 + rand() * 1.1);
          const tiers = organic ? 3 : 5;
          for (let tier = 0; tier < tiers; tier++) {
            for (let column = 0; column < 3; column++) {
              // The upper tiers taper into separated fingers, leaving sky
              // between clusters and never extending across the route.
              if (tier >= 3 && column === (Math.floor(z) % 3)) continue;
              const width = 1.6 + rand() * 0.65;
              const depth = 2.6 + rand() * 1.8;
              const px = baseX + side * (tier * 0.25 + rand() * 0.4);
              const py = -0.8 + tier * 1.85 + rand() * 0.35;
              const pz = z + (column - 1) * 3.05 + rand() * 0.45;
              push(px, py, pz, width, 1.65 + rand() * 0.25, depth,
                stone, 0.82 + rand() * 0.3);
              if (organic && tier === tiers - 1) {
                push(px - side * 0.22, py + 0.94, pz,
                  width * 1.2, 0.18, depth * 1.12, 0x52723a, 0.95);
                for (let root = 0; root < 3; root++) {
                  const bend = Math.sin(root * 1.6 + z) * 0.16;
                  push(px - side * (width * 0.5 + 0.08) + bend,
                    py + 0.7 - root * 0.82, pz - depth * 0.28,
                    0.13, 0.92, 0.18, 0x3f6232, 0.92, 0, bend * 0.35);
                  if (root === 1) push(px - side * (width * 0.5 + 0.24),
                    py - 0.35, pz - depth * 0.28,
                    0.38, 0.13, 0.55, 0x648b3f, 0.88, 0.3);
                }
              } else if (volcanic && column === 1 && tier % 2 === 0) {
                push(px - side * (width * 0.5 + 0.03), py, pz,
                  0.07, 1.2, depth * 0.48, 0xff6918, 0.9);
              } else if (tech && tier % 2 === 0) {
                push(px - side * (width * 0.5 + 0.05), py, pz,
                  0.08, 0.14, depth * 0.8, 0x73c0ac, 0.8);
              }
            }
          }
        }
      }
    }
    if (items.length === 0) return { meshes: [], material: null };
    const material = EnvironmentView.voxelMaterial();
    return {
      meshes: EnvironmentView.chunkBoxes(unitBox, material, items,
        def?.visualDressing === undefined ? Infinity : 48),
      material,
    };
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
    wrapLow: Float32Array;
    wrapHigh: Float32Array;
  } | null {
    const n = EnvironmentView.MOTE_COUNT;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const speeds = new Float32Array(n);
    const wrapLow = new Float32Array(n);
    const wrapHigh = new Float32Array(n);
    const rand = mulberry32(60521);
    const c = new THREE.Color();
    const garden = def?.visualDressing?.find((row) => row.biome === 'garden');
    const crag = def?.visualDressing?.find((row) => row.biome === 'crag');
    for (let i = 0; i < n; i++) {
      const spray = garden !== undefined && i < 72;
      const ash = crag !== undefined && i >= 72 && i < 116;
      const row = spray ? garden : ash ? crag : undefined;
      const x = row === undefined ? (rand() - 0.5) * 56
        : (rand() < 0.5 ? -1 : 1) * (8.2 + rand() * 6);
      const y = row === undefined ? -10 + rand() * 24
        : spray ? -1.1 + rand() * 4.6 : -2 + rand() * 7;
      const z = row === undefined ? -30 + rand() * (levelLengthZ + 90)
        : row.z0 + rand() * (row.z1 - row.z0);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      c.setHex(spray ? 0xb5f6f2 : ash ? 0xff7923 : EnvironmentView.accentAtZ(def, z))
        .multiplyScalar(row === undefined ? 0.55 + rand() * 0.45 : 0.45 + rand() * 0.4);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      speeds[i] = row === undefined ? 0.4 + rand() * 1.1 : 0.45 + rand() * 0.7;
      wrapLow[i] = spray ? -1.1 : ash ? -2 : -10;
      wrapHigh[i] = spray ? 4.0 : ash ? 6 : 14;
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
    return { points, geometry, material, positions, speeds, wrapLow, wrapHigh };
  }

  /**
   * M9.2 mote drift (render-dt, in place): slow rise with vertical wrap
   * (embers/motes/sparks float up out of frame and re-enter below).
   * Pause freezes (dt 0); zero allocation on the hot path.
   */
  public updateMotes(renderDt: number): void {
    const pos = this.motePos;
    const speeds = this.moteSpeed;
    const wrapLow = this.moteWrapLow;
    const wrapHigh = this.moteWrapHigh;
    const geo = this.moteGeo;
    if (renderDt > 0) this.fallTime.value = (this.fallTime.value + renderDt) % 512;
    if (pos === null || speeds === null || wrapLow === null || wrapHigh === null || geo === null || renderDt <= 0) return;
    for (let i = 0; i < speeds.length; i++) {
      const speed = speeds[i] ?? 0;
      const y0 = pos[i * 3 + 1] ?? -10;
      let y = y0 + speed * renderDt;
      if (y > (wrapHigh[i] ?? 14)) y = wrapLow[i] ?? -10;
      pos[i * 3 + 1] = y;
    }
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  public dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const mesh of this.archMeshes) mesh.dispose();
    for (const mesh of this.dressSolid) mesh.dispose();
    for (const mesh of this.dressGlow) mesh.dispose();
    for (const mesh of this.dressFlow) mesh.dispose();
    for (const mesh of this.organicMeshes) mesh.dispose();
    for (const mesh of this.surfaceMeshes) mesh.dispose();
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
