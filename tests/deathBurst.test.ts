import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { DeathBurstView, DEATH_BURST_LIFETIME } from '../src/rendering/DeathBurstView';

/**
 * M8A death-burst contract: much stronger (32 fragments, core flash +
 * shock ring, 0.65 s matching the 78-tick hold) while staying bounded —
 * one fixed pool, shared resources, zero post-construction allocation.
 * M8.1: mode voxel palettes + avatar ghost shell (32 fragments + core +
 * ring + ghost = 35 children), chunks hold size for the burst's first half.
 */
describe('death burst presentation (M8A)', () => {
  it('carries a bigger fragment pool than the M7.3 effect', () => {
    const burst = new DeathBurstView();
    // 32 pooled fragments + core flash + shock ring + ghost shell = 35.
    expect(burst.group.children.length).toBe(35);
    burst.dispose();
  });

  it('plays visibly then clears deterministically', () => {
    const burst = new DeathBurstView();
    expect(burst.isActive).toBe(false);
    expect(burst.group.visible).toBe(false);
    burst.play({ x: 0, y: 1, z: 10 });
    expect(burst.isActive).toBe(true);
    expect(burst.group.visible).toBe(true);
    // Advance past the lifetime: the burst hides itself.
    burst.update(DEATH_BURST_LIFETIME + 0.1);
    expect(burst.isActive).toBe(false);
    expect(burst.group.visible).toBe(false);
    burst.dispose();
  });

  it('stays bounded: no growth across repeated deaths', () => {
    const burst = new DeathBurstView();
    for (let i = 0; i < 10; i++) {
      burst.play({ x: i, y: 1, z: 10 });
      burst.update(0.1);
      burst.clear();
    }
    expect(burst.group.children.length).toBe(35);
    expect(burst.isActive).toBe(false);
    burst.dispose();
  });
});

describe('death burst presentation (M8.1 mode breakup)', () => {
  it('tints voxels and scales the ghost shell per active mode', () => {
    const burst = new DeathBurstView();
    burst.play({ x: 0, y: 1, z: 10 }, 'ship');
    // Ship ghost: flattened dart (0.9 x 0.6 x 1.9 over the 0.26 unit box).
    const ghost = burst.group.children[burst.group.children.length - 1];
    expect(ghost?.visible).toBe(true);
    expect(ghost?.scale.x).toBeCloseTo(0.9 / 0.26, 5);
    expect(ghost?.scale.z).toBeCloseTo(1.9 / 0.26, 5);
    // Ship palette carries the sky-cyan + flame-orange read.
    const firstMesh = burst.group.children[0] as unknown as THREE.Mesh;
    const firstMat = firstMesh.material as THREE.MeshBasicMaterial;
    expect(firstMat.color.getHex()).toBe(0x4fd8ff);
    burst.clear();
    burst.play({ x: 0, y: 1, z: 10 }, 'spider');
    const spiderGhost = burst.group.children[burst.group.children.length - 1];
    expect(spiderGhost?.scale.y).toBeCloseTo(0.5 / 0.26, 5);
    burst.dispose();
  });

  it('holds chunk size through the first half, then breaks down', () => {
    const burst = new DeathBurstView();
    burst.play({ x: 0, y: 1, z: 10 }, 'cube');
    const first = burst.group.children[0];
    burst.update(DEATH_BURST_LIFETIME * 0.4);
    expect(first?.scale.x).toBe(1);
    burst.update(DEATH_BURST_LIFETIME * 0.4);
    expect(first?.scale.x).toBeLessThan(1);
    burst.update(DEATH_BURST_LIFETIME);
    expect(burst.isActive).toBe(false);
    burst.dispose();
  });

  it('ghost shell lets go inside the first third of the burst', () => {
    const burst = new DeathBurstView();
    burst.play({ x: 0, y: 1, z: 10 }, 'cube');
    const ghost = burst.group.children[burst.group.children.length - 1];
    expect(ghost?.visible).toBe(true);
    burst.update(0.4);
    expect(ghost?.visible).toBe(false);
    expect(burst.isActive).toBe(true);
    burst.dispose();
  });
});
