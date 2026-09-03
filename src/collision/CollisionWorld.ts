import { type Aabb, type Collider, colliderToAabb, aabbOverlap } from './collider';

/**
 * Spatial hash broadphase over X/Z (the plane the player travels through).
 * Colliders are registered once at level load; queries are per simulation step.
 * No allocations in hot paths where practical; query results go into
 * caller-owned arrays.
 */
export class CollisionWorld {
  private readonly cellSize: number;
  private readonly cells: Map<string, Collider[]> = new Map();
  private readonly allColliders: Collider[] = [];

  constructor(cellSize: number = 8) {
    this.cellSize = cellSize;
  }

  /** Register one collider. Call at level load only (no dynamic removal in M1). */
  public add(collider: Collider): void {
    this.allColliders.push(collider);
    const minIX = this.floorIndex(collider.center.x - collider.halfExtents.x);
    const maxIX = this.floorIndex(collider.center.x + collider.halfExtents.x);
    const minIZ = this.floorIndex(collider.center.z - collider.halfExtents.z);
    const maxIZ = this.floorIndex(collider.center.z + collider.halfExtents.z);
    for (let ix = minIX; ix <= maxIX; ix++) {
      for (let iz = minIZ; iz <= maxIZ; iz++) {
        const key = `${ix}:${iz}`;
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(collider);
      }
    }
  }

  public addAll(colliders: readonly Collider[]): void {
    for (const c of colliders) this.add(c);
  }

  public get colliderCount(): number {
    return this.allColliders.length;
  }

  public colliders(): readonly Collider[] {
    return this.allColliders;
  }

  /** Collect distinct candidate colliders overlapping the given query box. Caller owns `out`. */
  public queryBox(box: Readonly<Aabb>, out: Collider[]): number {
    out.length = 0;
    const minIX = this.floorIndex(box.minX);
    const maxIX = this.floorIndex(box.maxX);
    const minIZ = this.floorIndex(box.minZ);
    const maxIZ = this.floorIndex(box.maxZ);
    // Small levels: dedupe via a Set of ids is fine; typical candidate count is tiny.
    const seen = new Set<string>();
    for (let ix = minIX; ix <= maxIX; ix++) {
      for (let iz = minIZ; iz <= maxIZ; iz++) {
        const list = this.cells.get(`${ix}:${iz}`);
        if (!list) continue;
        for (const c of list) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          if (aabbOverlap(box, colliderToAabb(c))) out.push(c);
        }
      }
    }
    return out.length;
  }

  private floorIndex(v: number): number {
    return Math.floor(v / this.cellSize);
  }
}
