import * as THREE from 'three';
import type { ChomperDef } from '../level/levelDefinition';
import type { ChomperState } from '../game/chomperSystem';
import type { MaterialLibrary } from './MaterialLibrary';

/**
 * ChomperView (M8D) — presentation for the deterministic lava chompers.
 * Owned by `RendererHost`; observes `GameSimulation.chomperStates` and the
 * level's `chompers` defs. Never writes gameplay state.
 *
 * Original lava-predator language (no licensed geometry): dark basalt
 * sphere body + molten crack band + bright mouth core facing the lunge
 * direction + twin ignition eyes + lower jaw that hangs open while
 * lunging + a 5-link energy chain stretching back to the authored anchor.
 *
 * Bounded: at most MAX_CHOMPERS groups × (body + band + mouth + jaw +
 * 2 eyes + 5 links) meshes, all shared library geometries/materials.
 * Zero per-frame allocation (one scratch Vector3); render-dt driven so
 * pause freezes the menace with everything else.
 */
export const CHOMPER_CHAIN_LINKS = 5;
export const MAX_CHOMPERS = 8;

interface ChomperNodes {
  group: THREE.Group;
  jaw: THREE.Mesh;
  eyeL: THREE.Mesh;
  eyeR: THREE.Mesh;
  mouth: THREE.Mesh;
  links: THREE.Mesh[];
  anchor: THREE.Vector3;
  lungeDir: number;
}

export class ChomperView {
  public readonly group = new THREE.Group();
  private readonly nodes: ChomperNodes[] = [];
  private readonly scratch = new THREE.Vector3();
  private time = 0;

  constructor(
    chompers: readonly ChomperDef[],
    library: MaterialLibrary,
  ) {
    const count = Math.min(chompers.length, MAX_CHOMPERS);
    for (let i = 0; i < count; i++) {
      const def = chompers[i];
      if (def === undefined) continue;
      const h = def.halfExtents;
      const g = new THREE.Group();

      // Body: basalt sphere bound to the gameplay hitbox (diameter = 2×half).
      const body = new THREE.Mesh(library.orbSphere, library.chomperShell);
      body.scale.set((h.x * 2) / 0.84, (h.y * 2) / 0.84, (h.z * 2) / 0.84);
      g.add(body);

      // Molten crack band around the equator (lunge-axis ring).
      const band = new THREE.Mesh(library.orbHalo, library.chomperGlow);
      const bandR = Math.max(h.x, h.y, 1) * 1.02;
      band.scale.set(bandR / 0.62, bandR / 0.62, bandR / 0.62);
      band.rotation.y = Math.PI / 2; // ring plane ⊥ X (the lunge axis)
      g.add(band);

      // Mouth core: bright maw on the lunge-leading face.
      const mouth = new THREE.Mesh(library.orbSphere, library.chomperCore);
      mouth.scale.setScalar(0.55);
      mouth.position.set(def.lungeDirection * h.x * 0.85, -h.y * 0.25, 0);
      g.add(mouth);

      // Lower jaw: dark slab under the maw, drops open while lunging.
      const jaw = new THREE.Mesh(library.unitBox, library.chomperShell);
      jaw.scale.set(h.x * 0.9, h.y * 0.28, h.z * 1.1);
      jaw.position.set(
        def.lungeDirection * h.x * 0.7,
        -h.y * 0.85,
        0,
      );
      g.add(jaw);

      // Twin ignition eyes on top (ignite = telegraph read).
      const eyeL = new THREE.Mesh(library.orbSphere, library.chomperGlow);
      eyeL.scale.setScalar(0.32);
      eyeL.position.set(def.lungeDirection * h.x * 0.3, h.y * 0.75, h.z * 0.45);
      const eyeR = new THREE.Mesh(library.orbSphere, library.chomperGlow);
      eyeR.scale.setScalar(0.32);
      eyeR.position.set(def.lungeDirection * h.x * 0.3, h.y * 0.75, -h.z * 0.45);
      g.add(eyeL, eyeR);

      // Energy chain: fixed links from the anchor to the body.
      const anchor = new THREE.Vector3(
        def.chainAnchor?.x ?? def.dormant.x,
        def.chainAnchor?.y ?? def.dormant.y,
        def.chainAnchor?.z ?? def.dormant.z,
      );
      const links: THREE.Mesh[] = [];
      for (let l = 0; l < CHOMPER_CHAIN_LINKS; l++) {
        const link = new THREE.Mesh(library.unitBox, library.chomperChain);
        link.scale.set(0.28, 0.28, 0.28);
        g.add(link);
        links.push(link);
        this.group.add(link);
      }
      // NOTE: links live in view space (not the Chomper group) so the
      // telegraph pulse scale never stretches the chain.
      this.group.add(g);
      this.nodes.push({ group: g, jaw, eyeL, eyeR, mouth, links, anchor, lungeDir: def.lungeDirection });
    }
  }

  /** Per rendered frame: pose every Chomper from sim state. */
  public update(
    states: readonly ChomperState[],
    renderDtSeconds: number,
  ): void {
    this.time += renderDtSeconds;
    const n = Math.min(this.nodes.length, states.length);
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i];
      const st = states[i];
      if (node === undefined || st === undefined) continue;
      node.group.position.set(st.x, st.y, st.z);
      // Telegraph: rapid anticipation pulse (scale shiver + eye flare via
      // scale — shared materials can never change per-instance).
      if (st.phase === 'telegraph') {
        const pulse = 1 + 0.09 * Math.sin(this.time * 22 + i * 1.7);
        node.group.scale.setScalar(pulse);
        const eye = 0.32 * (1 + 0.5 * Math.sin(this.time * 22));
        node.eyeL.scale.setScalar(Math.max(0.2, eye));
        node.eyeR.scale.setScalar(Math.max(0.2, eye));
      } else {
        node.group.scale.setScalar(1);
        node.eyeL.scale.setScalar(st.phase === 'dormant' ? 0.22 : 0.32);
        node.eyeR.scale.setScalar(st.phase === 'dormant' ? 0.22 : 0.32);
      }
      // Jaw: hangs open while lunging, closed otherwise.
      const jawDrop = st.phase === 'lunging' ? 0.45 : st.phase === 'telegraph' ? 0.2 : 0;
      node.jaw.rotation.z = node.lungeDir * jawDrop * 0.9;
      // Mouth breathe (lunge = wide open read).
      node.mouth.scale.setScalar(st.phase === 'lunging' ? 0.8 : 0.55);
      // Chain: links lerp anchor -> body (straight energy tether).
      this.scratch.set(st.x, st.y, st.z);
      for (let l = 0; l < node.links.length; l++) {
        const link = node.links[l];
        if (link === undefined) continue;
        const t = (l + 1) / (node.links.length + 1);
        link.position.set(
          node.anchor.x + (this.scratch.x - node.anchor.x) * t,
          node.anchor.y + (this.scratch.y - node.anchor.y) * t,
          node.anchor.z + (this.scratch.z - node.anchor.z) * t,
        );
        link.rotation.y = this.time * 1.5 + l;
      }
      node.group.visible = true;
    }
  }

  public dispose(): void {
    this.group.clear();
    this.nodes.length = 0;
  }
}
