import * as THREE from 'three';
import type { MovingPlatformDef } from '../level/levelDefinition';
import type { MovingPlatformState } from '../game/movingPlatformSystem';
import type { MaterialLibrary } from './MaterialLibrary';

/**
 * MovingPlatformView (M8.6) — presentation for deterministic moving
 * platforms. Owned by `RendererHost`; observes
 * `GameSimulation.platformStates` and the level's `movingPlatforms` defs.
 * Never writes gameplay state.
 *
 * Platforms read as playable route: shared `routeBody` box + shared
 * `routeTop` ride-surface plate (the same two-material language as static
 * slabs, so the section accent retints ferries automatically). Bounded:
 * at most 8 groups × 2 meshes, zero new materials, zero new library
 * geometries. Zero per-frame allocation (interpolated prev→current pose,
 * like every other view).
 */
export const MAX_PLATFORM_VIEW = 8;

interface PlatformNodes {
  group: THREE.Group;
}

export class MovingPlatformView {
  public readonly group = new THREE.Group();
  private readonly nodes: PlatformNodes[] = [];

  constructor(
    platforms: readonly MovingPlatformDef[],
    library: MaterialLibrary,
  ) {
    const count = Math.min(platforms.length, MAX_PLATFORM_VIEW);
    for (let i = 0; i < count; i++) {
      const def = platforms[i];
      if (def === undefined) continue;
      const h = def.halfExtents;
      const g = new THREE.Group();
      // Body: shared route material on the shared unit box (gameplay box
      // scaled ×1.02 so the ferry reads against static slabs).
      const body = new THREE.Mesh(library.unitBox, library.routeBody);
      body.scale.set(h.x * 2.04, h.y * 2.04, h.z * 2.04);
      g.add(body);
      // Ride surface: thin shared-top-material plate proud of the top
      // face (the ferry's landing surface reads like every slab top).
      const plate = new THREE.Mesh(library.unitBox, library.routeTop);
      plate.scale.set(h.x * 1.9, 0.06, h.z * 1.9);
      plate.position.set(0, h.y * 1.02 + 0.03, 0);
      g.add(plate);
      g.position.set(def.base.x, def.base.y, def.base.z);
      this.group.add(g);
      this.nodes.push({ group: g });
    }
  }

  /** Per rendered frame: interpolate every platform prev→current pose. */
  public update(states: readonly MovingPlatformState[], alpha: number): void {
    const n = Math.min(this.nodes.length, states.length);
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i];
      const st = states[i];
      if (node === undefined || st === undefined) continue;
      node.group.position.set(
        st.px + (st.x - st.px) * alpha,
        st.py + (st.y - st.py) * alpha,
        st.pz + (st.z - st.pz) * alpha,
      );
      node.group.visible = true;
    }
  }

  public dispose(): void {
    this.group.clear();
    this.nodes.length = 0;
  }
}
