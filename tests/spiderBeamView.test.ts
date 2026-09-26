import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SPIDER_BEAM_LIFETIME, SpiderBeamView } from '../src/rendering/SpiderBeamView';

function slot(view: SpiderBeamView, index = 0) {
  const children = view.group.children.slice(index * 7, index * 7 + 7);
  const [halo, beam, arcs, packet, head, tail, spray] = children;
  if (!(halo instanceof THREE.Mesh) || !(beam instanceof THREE.Mesh)
    || !(arcs instanceof THREE.InstancedMesh) || !(packet instanceof THREE.Mesh)
    || !(head instanceof THREE.Mesh) || !(tail instanceof THREE.Mesh)
    || !(spray instanceof THREE.Points)) throw new Error('Spider beam slot layout changed');
  return { halo, beam, arcs, packet, head, tail, spray };
}

describe('SpiderBeamView', () => {
  it('connects exact anchors with a core, halo, two jagged strands and a traveling packet', () => {
    const view = new SpiderBeamView();
    const from = { x: 2, y: 1, z: 8 };
    const to = { x: 2, y: 9, z: 8 };
    view.fire(from, to);
    view.update(0);
    const fx = slot(view);
    expect(view.playCount).toBe(1);
    expect(fx.beam.visible && fx.halo.visible && fx.arcs.visible).toBe(true);
    expect(fx.beam.position.toArray()).toEqual([2, 5, 8]);
    expect(fx.beam.scale.y).toBe(8);
    expect(fx.head.position.toArray()).toEqual([2, 9, 8]);
    expect(fx.tail.position.toArray()).toEqual([2, 1, 8]);
    expect(fx.arcs.count).toBe(16);
    const matrix = new THREE.Matrix4();
    const endpoint = new THREE.Vector3();
    fx.arcs.getMatrixAt(0, matrix);
    endpoint.set(0, -0.5, 0).applyMatrix4(matrix);
    expect(endpoint.distanceTo(new THREE.Vector3(2, 1, 8))).toBeLessThan(0.0001);
    fx.arcs.getMatrixAt(7, matrix);
    endpoint.set(0, 0.5, 0).applyMatrix4(matrix);
    expect(endpoint.distanceTo(new THREE.Vector3(2, 9, 8))).toBeLessThan(0.0001);
    view.update(0.045);
    expect(fx.packet.position.y).toBeCloseTo(5);
    view.update(0.045);
    expect(fx.packet.visible).toBe(false);
    view.dispose();
  });

  it('freezes on zero render dt, overlaps two snaps, and clears at expiry or reset', () => {
    const view = new SpiderBeamView();
    view.fire({ x: 0, y: 1, z: 0 }, { x: 0, y: 9, z: 0 });
    view.update(0.04);
    const first = slot(view);
    const opacity = (first.beam.material as THREE.MeshBasicMaterial).opacity;
    const packetY = first.packet.position.y;
    view.update(0);
    expect((first.beam.material as THREE.MeshBasicMaterial).opacity).toBe(opacity);
    expect(first.packet.position.y).toBe(packetY);
    view.fire({ x: -2, y: 4, z: 1 }, { x: 3, y: 4, z: 1 });
    view.update(0);
    expect(view.activeCount).toBe(2);
    expect(slot(view, 1).arcs.count).toBe(16);
    view.update(SPIDER_BEAM_LIFETIME);
    expect(view.activeCount).toBe(0);
    expect(first.beam.visible).toBe(false);
    view.fire({ x: 0, y: 0, z: 0 }, { x: 0, y: 8, z: 0 });
    view.clear();
    expect(view.activeCount).toBe(0);
    expect(slot(view).packet.visible).toBe(false);
    view.dispose();
  });

  it('keeps degenerate snaps finite and uses endpoint flashes only', () => {
    const view = new SpiderBeamView();
    view.fire({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 });
    view.update(0);
    const fx = slot(view);
    expect(fx.beam.visible).toBe(false);
    expect(fx.arcs.visible).toBe(false);
    expect(fx.head.visible && fx.tail.visible).toBe(true);
    expect(fx.packet.visible).toBe(false);
    view.dispose();
  });
});
