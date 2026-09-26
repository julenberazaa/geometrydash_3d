import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CameraOccluderFade } from '../src/rendering/CameraOccluderFade';
import { makeTestLibrary } from './helpers/visuals';

describe('camera fade with authored biome materials', () => {
  it('preserves the procedural shader and restores shared material ownership', () => {
    const library = makeTestLibrary();
    const shared = library.routeBiome('garden');
    const sharedDispose = vi.spyOn(shared, 'dispose');
    const mesh = new THREE.Mesh(library.unitBox, shared);
    const fade = new CameraOccluderFade();
    fade.update(mesh, 1 / 60);
    const clone = mesh.material;
    const cloneDispose = vi.spyOn(clone, 'dispose');
    expect(clone).not.toBe(shared);
    // Compare identities; neither method is extracted for an unbound call.
    expect(clone.onBeforeCompile === shared.onBeforeCompile).toBe(true);
    expect(clone.customProgramCacheKey()).toBe(shared.customProgramCacheKey());
    expect(clone.transparent).toBe(true);
    expect(clone.depthWrite).toBe(false);
    expect(shared.transparent).toBe(false);
    expect(shared.opacity).toBe(1);
    for (let frame = 0; frame < 10; frame++) fade.update(mesh, 1 / 60);
    expect(mesh.material).toBe(clone);
    expect(fade.fadedCount).toBe(1);
    fade.releaseAll();
    expect(mesh.material).toBe(shared);
    expect(cloneDispose).toHaveBeenCalledTimes(1);
    expect(sharedDispose).not.toHaveBeenCalled();
    library.dispose();
  });
});
