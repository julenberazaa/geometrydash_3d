import { describe, it, expect } from 'vitest';
import {
  groupDoorBlocks,
  findDoorGaps,
  DOOR_GAP_MIN_WIDTH,
  type DoorBlockInput,
} from '../src/level/doorGaps';

/**
 * M9.6.1 door-gap detection contract (pure geometry — the renderer frames
 * these openings and the auditor watches them).
 */

const block = (x: number, y: number, z: number, hx: number, hy: number, hz: number): DoorBlockInput => ({
  center: { x, y, z },
  halfExtents: { x: hx, y: hy, z: hz },
});

/** First element or test failure (avoids non-null assertions). */
const first = <T>(arr: readonly T[]): T => {
  const v = arr[0];
  if (v === undefined) throw new Error('expected a non-empty list');
  return v;
};

describe('door-gap detection', () => {
  it('groups coplanar overlapping blocks, splits on z and height', () => {
    const gates = groupDoorBlocks([
      block(1.3, 6, 599, 2.6, 1.5, 0.5),
      block(-2.6, 6, 610, 1.3, 1.5, 0.5),
      block(2.6, 6, 610, 1.3, 1.5, 0.5),
      block(1.3, 1.5, 600, 2.6, 1.5, 0.5),
    ]);
    expect(gates.map((g) => g.z)).toEqual([599, 600, 610]);
  });

  it('finds the A1 66 opening (lane 2) across the corridor span', () => {
    const gates = groupDoorBlocks([
      block(0, 6, 66, 1.3, 1.5, 0.5),
      block(3.35, 6, 66, 2.05, 1.5, 0.5),
    ]);
    expect(gates.length).toBe(1);
    const gaps = findDoorGaps(first(gates), 5.4);
    expect(gaps.length).toBe(1);
    expect(first(gaps).x0).toBeCloseTo(-5.4, 9);
    expect(first(gaps).x1).toBeCloseTo(-1.3, 9);
    expect(first(gaps).y0).toBeCloseTo(4.5, 9);
    expect(first(gaps).y1).toBeCloseTo(7.5, 9);
  });

  it('finds the center opening flanked by two blocks (610 style)', () => {
    const gates = groupDoorBlocks([
      block(2.6, 6, 610, 1.3, 1.5, 0.5),
      block(-2.6, 6, 610, 1.3, 1.5, 0.5),
    ]);
    const gaps = findDoorGaps(first(gates), 5.4);
    expect(gaps.length).toBe(1);
    expect(first(gaps).x0).toBeCloseTo(-1.3, 9);
    expect(first(gaps).x1).toBeCloseTo(1.3, 9);
  });

  it('ignores slivers below the committable width', () => {
    expect(DOOR_GAP_MIN_WIDTH).toBeGreaterThanOrEqual(2.0);
    const gates = groupDoorBlocks([block(0, 6, 100, 5.0, 1.5, 0.5)]);
    const gaps = findDoorGaps(first(gates), 5.4);
    // Covered -5..5 of the ±5.4 span: 0.4 slivers on each side — dropped.
    expect(gaps.length).toBe(0);
  });

  it('drops deck-edge slivers while keeping the lane opening (610 style)', () => {
    const gates = groupDoorBlocks([
      block(2.6, 6, 610, 1.3, 1.5, 0.5),
      block(-2.6, 6, 610, 1.3, 1.5, 0.5),
    ]);
    const gaps = findDoorGaps(first(gates), 5.4);
    // Only the 2.6 u center opening counts — the 1.5 u deck-edge slivers
    // (±3.9..±5.4) teeter into falls and are not committable lanes.
    expect(gaps.length).toBe(1);
    expect(first(gaps).x0).toBeCloseTo(-1.3, 9);
    expect(first(gaps).x1).toBeCloseTo(1.3, 9);
  });

  it('merges overlapping covered intervals before gapping', () => {
    const gates = groupDoorBlocks([
      block(0, 6, 200, 2.0, 1.5, 0.5),
      block(1.0, 6, 200, 2.0, 1.5, 0.5),
    ]);
    expect(gates.length).toBe(1);
    expect(first(gates).covered).toEqual([{ x0: -2, x1: 3 }]);
  });
});
