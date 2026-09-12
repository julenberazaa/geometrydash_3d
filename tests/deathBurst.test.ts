import { describe, expect, it } from 'vitest';
import { DeathBurstView, DEATH_BURST_LIFETIME } from '../src/rendering/DeathBurstView';

/**
 * M7.3 death-burst contract: bigger and stronger (24 fragments, larger
 * chunks, faster spray, longer life) while staying bounded — one fixed
 * pool, shared resources, zero post-construction allocation.
 */
describe('death burst presentation (M7.3)', () => {
  it('carries a bigger fragment pool than the M2 original', () => {
    const burst = new DeathBurstView();
    // 24 pooled fragments (was 14): one mesh per fragment, nothing else.
    expect(burst.group.children.length).toBe(24);
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
    expect(burst.group.children.length).toBe(24);
    expect(burst.isActive).toBe(false);
    burst.dispose();
  });
});
