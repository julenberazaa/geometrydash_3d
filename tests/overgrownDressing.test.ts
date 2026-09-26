import { describe, expect, it } from 'vitest';
import { placeBiomeDressing, type DressingRow } from '../src/level/biomeDressing';

const garden: DressingRow = {
  z0: 170, z1: 430, biome: 'garden', density: 0.6, seed: 22,
  accent: 0x2dffc4, baseY: 0,
};
const temple: DressingRow = {
  z0: 1330, z1: 1510, biome: 'temple', density: 0.6, seed: 77,
  accent: 0xffd23d,
};

describe('overgrown biome landmarks', () => {
  it('places three waterfall banks at irregular positions on both sides', () => {
    const instances = placeBiomeDressing([garden], () => 0);
    const falls = instances.filter((inst) => inst.prop === 'fall' && Math.abs(inst.x) === 9);
    expect(falls).toHaveLength(3);
    expect(falls.some((inst) => inst.x < 0)).toBe(true);
    expect(falls.some((inst) => inst.x > 0)).toBe(true);
    const z = falls.map((inst) => inst.z).sort((a, b) => a - b);
    const [first, second, third] = z;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('Missing waterfall landmark');
    }
    expect(second - first).not.toBeCloseTo(third - second, 1);
    for (const inst of instances) {
      if (inst.prop !== 'lintel') expect(Math.abs(inst.x) - inst.sx / 2).toBeGreaterThan(7);
    }
    expect(placeBiomeDressing([garden], () => 0)).toEqual(instances);
  });

  it('groups mossy temple stone with roots and foliage without adding water', () => {
    const instances = placeBiomeDressing([temple], () => 0);
    expect(instances.filter((inst) => inst.prop === 'pillar').length).toBeGreaterThanOrEqual(2);
    expect(instances.filter((inst) => inst.prop === 'foliage').length).toBeGreaterThanOrEqual(2);
    expect(instances.filter((inst) => inst.prop === 'strand').length).toBeGreaterThanOrEqual(2);
    expect(instances.some((inst) => inst.prop === 'fall')).toBe(false);
  });

  it('does not invent landmarks in an empty or terrainless act', () => {
    expect(placeBiomeDressing([{ ...garden, density: 0 }], () => 0)).toEqual([]);
    expect(placeBiomeDressing([{ ...temple, baseY: undefined }], () => null)).toEqual([]);
  });
});
