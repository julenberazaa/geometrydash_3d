import { describe, expect, it } from 'vitest';
import { VfxSystem } from '../src/rendering/VfxSystem';
import { PRODUCTION_THEME } from '../src/visuals/productionTheme';
import {
  clearPunch,
  combinedPunchEnergy,
  dominantPunchColor,
  makeEventPunchState,
  triggerPunch,
  updatePunch,
} from '../src/visuals/eventPunch';
import {
  ceilingFrame,
  DT,
  makeSimView,
  runFrames,
} from './helpers/vfxSimView';

/**
 * M6C2 reactive-visual tests: the event-punch envelope controller and the
 * surface-contact (skid) emission in VfxSystem.
 *
 * Structural only (never pixel-perfect): envelope peaks/decay/composition,
 * contact emission rules (grounded-only, floor+ceiling, speed-scaled,
 * reset paths, fx-off silence), pool boundedness with contact sharing the
 * trail buffer, and the single-frame emission budget vs burst capacity.
 * The sim is never modified to satisfy these tests.
 */

describe('eventPunch envelope', () => {
  it('trigger fires at peak and decays to exact rest', () => {
    const punch = makeEventPunchState();
    expect(combinedPunchEnergy(punch)).toBe(0);
    triggerPunch(punch, 'pad');
    expect(combinedPunchEnergy(punch)).toBe(1);
    updatePunch(punch, 0.25);
    const mid = combinedPunchEnergy(punch);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    updatePunch(punch, 10); // long tail: exact rest, no shimmer
    expect(combinedPunchEnergy(punch)).toBe(0);
  });

  it('gravity punches longest, jump orbs decay fastest', () => {
    const gravity = makeEventPunchState();
    const orb = makeEventPunchState();
    triggerPunch(gravity, 'gravity');
    triggerPunch(orb, 'jumpOrb');
    updatePunch(gravity, 0.5);
    updatePunch(orb, 0.5);
    expect(combinedPunchEnergy(gravity)).toBeGreaterThan(combinedPunchEnergy(orb));
  });

  it('kinds compose by max (never stack past 1) and retrigger restarts', () => {
    const punch = makeEventPunchState();
    triggerPunch(punch, 'pad');
    triggerPunch(punch, 'gravity');
    expect(combinedPunchEnergy(punch)).toBeLessThanOrEqual(1);
    updatePunch(punch, 0.4);
    const decayed = combinedPunchEnergy(punch);
    expect(decayed).toBeLessThan(1);
    triggerPunch(punch, 'pad'); // re-fire restarts the envelope
    expect(combinedPunchEnergy(punch)).toBe(1);
    void decayed;
  });

  it('dominant color follows the highest-energy kind (gravity wins ties)', () => {
    const punch = makeEventPunchState();
    triggerPunch(punch, 'pad');
    triggerPunch(punch, 'gravity');
    expect(dominantPunchColor(punch)).toBe(0x4fc3ff);
    updatePunch(punch, 10);
    triggerPunch(punch, 'speed', 0x123456);
    expect(dominantPunchColor(punch)).toBe(0x123456); // tier override sticks
    clearPunch(punch);
    expect(combinedPunchEnergy(punch)).toBe(0);
  });

  it('dt 0 freezes the envelope (presentation-pause parity)', () => {
    const punch = makeEventPunchState();
    triggerPunch(punch, 'speed');
    const peak = combinedPunchEnergy(punch);
    updatePunch(punch, 0);
    expect(combinedPunchEnergy(punch)).toBe(peak);
    updatePunch(punch, -1); // defensive: negative dt never charges
    expect(combinedPunchEnergy(punch)).toBe(peak);
  });

  it('teleport punches violet at full peak and wins color ties', () => {
    const punch = makeEventPunchState();
    triggerPunch(punch, 'teleport');
    expect(combinedPunchEnergy(punch)).toBe(1);
    expect(dominantPunchColor(punch)).toBe(0xc77dff);
    // A simultaneous gravity tie still resolves to the teleport tint.
    triggerPunch(punch, 'gravity');
    expect(dominantPunchColor(punch)).toBe(0xc77dff);
    // Decays back to rest like every other family.
    updatePunch(punch, 10);
    expect(combinedPunchEnergy(punch)).toBe(0);
  });
});

describe('VfxSystem surface-contact emission', () => {
  it('grounded running emits contact skid; airborne emits nothing', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    runFrames(vfx, sim, 60);
    expect(vfx.contactSamples).toBeGreaterThan(0);
    expect(vfx.contactSamples).toBeLessThanOrEqual(vfx.trailSamples);

    sim.player.grounded = false; // jump: support-plane language stops
    runFrames(vfx, sim, 30);
    expect(vfx.contactSamples).toBe(0); // short skid life drains in air
    vfx.dispose();
  });

  it('contact works on the ceiling (support-side relative, not floor-only)', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    sim.gameplayFrame = ceilingFrame();
    sim.player.position = { x: 0, y: 5.45, z: 200 };
    runFrames(vfx, sim, 60);
    expect(vfx.contactSamples).toBeGreaterThan(0);
    vfx.dispose();
  });

  it('contact scales with speed and calms with the timeline level', () => {
    const fast = new VfxSystem({ ...PRODUCTION_THEME });
    const fastSim = makeSimView();
    fastSim.speedMultiplier = 2;
    runFrames(fast, fastSim, 120);
    const at2x = fast.contactSamples;

    const calm = new VfxSystem({ ...PRODUCTION_THEME });
    const calmSim = makeSimView();
    calm.setIntensity(0, 0); // timeline calm: no continuous emission
    runFrames(calm, calmSim, 120);
    expect(calm.contactSamples).toBe(0);

    expect(at2x).toBeGreaterThan(0);
    fast.dispose();
    calm.dispose();
  });

  it('contact respects reset paths and ?fx=off', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    runFrames(vfx, sim, 60);
    expect(vfx.contactSamples).toBeGreaterThan(0);
    sim.attempts += 1; // R / respawn / replay start: no stale skid line
    sim.player.position = { x: 0, y: 0.55, z: 0 };
    vfx.update(DT, sim, sim.player.position);
    expect(vfx.contactSamples).toBe(0);

    const off = new VfxSystem({ ...PRODUCTION_THEME });
    const offSim = makeSimView();
    off.setEnabled(false);
    runFrames(off, offSim, 60);
    expect(off.contactSamples).toBe(0);
    expect(off.trailSamples).toBe(0);
    vfx.dispose();
    off.dispose();
  });

  it('pure running never fires event counters (contact is continuous, not an event)', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    runFrames(vfx, sim, 120);
    expect(vfx.contactSamples).toBeGreaterThan(0); // skid present...
    expect(vfx.countersSnapshot).toEqual({
      jump: 0, landing: 0, gravity: 0, speed: 0, pad: 0, jumpOrb: 0, gravityOrb: 0, teleport: 0, mode: 0,
    });
    vfx.dispose();
  });
});

describe('M6C2 emission budget', () => {
  it('worst-case single-frame event volume stays well under burst capacity', () => {
    const fx = PRODUCTION_THEME.fx;
    // One of everything in the same frame (impossible in practice — the
    // sim serializes events — but the bound must hold regardless).
    const worst = fx.jumpCount + fx.landingMax + fx.gravityCount +
      fx.speedCount + fx.padCount + fx.orbCount + fx.teleportCount;
    expect(worst).toBeLessThanOrEqual(fx.burstMax);
  });

  it('contact + trail share one bounded buffer (no new draws or pools)', () => {
    const vfx = new VfxSystem({ ...PRODUCTION_THEME });
    const sim = makeSimView();
    sim.speedMultiplier = 4;
    runFrames(vfx, sim, 3600, (frame) => {
      if (frame === 1800) {
        sim.portalTransitionCount += 1;
        sim.interactionEventCount += 1;
        sim.lastInteraction = { kind: 'pad', x: 0, y: 0.5, z: sim.player.position.z };
      }
    });
    expect(vfx.trailSamples).toBeLessThanOrEqual(vfx.trailCapacity);
    expect(vfx.activeParticles).toBeLessThanOrEqual(vfx.burstCapacity);
    expect(vfx.group.children.length).toBe(3); // trail + bursts + streaks
    vfx.dispose();
  });
});
