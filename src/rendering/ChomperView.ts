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
 * sphere body + TWO molten crack bands + armored snout + brow ridge +
 * dorsal heat-spikes + bright maw with upper fangs and jaw-riding lower
 * teeth + twin ignition eyes + a chomping lower jaw (chews while
 * telegraphing, gapes while lunging) + a 5-link energy chain stretching
 * back to the authored anchor.
 *
 * Bounded: at most MAX_CHOMPERS groups × 22 meshes (body + 2 bands +
 * snout + brow + 3 spikes + mouth + 3 fangs + jaw + 2 teeth + 2 eyes +
 * 5 links), all shared library geometries/materials. Zero per-frame
 * allocation (one scratch Vector3); render-dt driven so pause freezes
 * the menace with everything else.
 */
export const CHOMPER_CHAIN_LINKS = 5;
export const MAX_CHOMPERS = 8;

interface ChomperNodes {
  group: THREE.Group;
  jaw: THREE.Mesh;
  jawBaseY: number;
  eyeL: THREE.Mesh;
  eyeR: THREE.Mesh;
  mouth: THREE.Mesh;
  lowerTeeth: THREE.Mesh[];
  lowerTeethBaseY: number[];
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

      // Snout: armored muzzle jutting toward the lunge direction — the
      // head reads as a head, not a ball. The maw sits on its front face.
      const snout = new THREE.Mesh(library.unitBox, library.chomperShell);
      snout.scale.set(h.x * 0.75, h.y * 0.55, h.z * 0.9);
      snout.position.set(def.lungeDirection * h.x * 0.95, -h.y * 0.2, 0);
      g.add(snout);

      // Brow ridge over the eyes: aggression read from every angle.
      const brow = new THREE.Mesh(library.unitBox, library.chomperShell);
      brow.scale.set(h.x * 0.7, h.y * 0.22, h.z * 1.15);
      brow.position.set(def.lungeDirection * h.x * 0.35, h.y * 0.62, 0);
      g.add(brow);

      // Dorsal heat-spikes: three glowing cones along the spine (shared
      // chevron geometry, heat-glow material — lava creature, not rock).
      for (let s = 0; s < 3; s++) {
        const spike = new THREE.Mesh(library.chevron, library.chomperGlow);
        spike.scale.setScalar(0.55 + (s === 1 ? 0.2 : 0));
        spike.position.set(
          def.lungeDirection * h.x * (0.25 - s * 0.35),
          h.y * (0.95 + (s === 1 ? 0.15 : 0)),
          0,
        );
        spike.rotation.z = -def.lungeDirection * 0.25;
        g.add(spike);
      }

      // Second crack band (vertical): molten light wrapping the body on
      // both axes, so the heat read survives every camera angle.
      const bandV = new THREE.Mesh(library.orbHalo, library.chomperGlow);
      bandV.scale.set(bandR / 0.62, bandR / 0.62, bandR / 0.62);
      g.add(bandV);

      // Mouth core: bright maw on the snout's leading face.
      const mouth = new THREE.Mesh(library.orbSphere, library.chomperCore);
      mouth.scale.setScalar(0.55);
      mouth.position.set(def.lungeDirection * h.x * 1.32, -h.y * 0.25, 0);
      g.add(mouth);

      // Upper fangs: three heat-bright teeth hanging from the snout.
      // (Shared cone geometry + mouth-core material — hot teeth.)
      for (let f = 0; f < 3; f++) {
        const fang = new THREE.Mesh(library.chevron, library.chomperCore);
        fang.scale.setScalar(0.42);
        fang.rotation.x = Math.PI; // cone tip -> down
        fang.position.set(
          def.lungeDirection * h.x * (1.05 + (f === 1 ? 0.22 : 0)),
          -h.y * 0.52,
          (f - 1) * h.z * 0.42,
        );
        g.add(fang);
      }

      // Lower jaw: dark slab under the maw, drops open while lunging.
      const jaw = new THREE.Mesh(library.unitBox, library.chomperShell);
      jaw.scale.set(h.x * 0.9, h.y * 0.28, h.z * 1.1);
      const jawBaseY = -h.y * 0.85;
      jaw.position.set(
        def.lungeDirection * h.x * 0.7,
        jawBaseY,
        0,
      );
      g.add(jaw);

      // Lower teeth: two cones riding the jaw (group children, NOT jaw
      // children — jaw scale would squash them; the update loop drops
      // them with the chomp instead).
      const lowerTeeth: THREE.Mesh[] = [];
      const lowerTeethBaseY: number[] = [];
      for (let f = 0; f < 2; f++) {
        const tooth = new THREE.Mesh(library.chevron, library.chomperCore);
        tooth.scale.setScalar(0.36);
        const baseY = -h.y * 0.62;
        tooth.position.set(
          def.lungeDirection * h.x * (0.85 + f * 0.3),
          baseY,
          (f === 0 ? 1 : -1) * h.z * 0.3,
        );
        g.add(tooth);
        lowerTeeth.push(tooth);
        lowerTeethBaseY.push(baseY);
      }

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
      this.nodes.push({
        group: g, jaw, jawBaseY, eyeL, eyeR, mouth,
        lowerTeeth, lowerTeethBaseY, links,
        anchor, lungeDir: def.lungeDirection,
      });
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
      // Chomp cycle: the jaw chews while telegraphing (fast, shallow)
      // and gapes while lunging (slow, wide); dormant/spent rest closed.
      // Lower teeth ride the jaw drop; the maw pulses with the bite.
      let chomp = 0;
      if (st.phase === 'lunging') {
        chomp = 0.55 + 0.45 * Math.sin(this.time * 9 + i * 2.1);
      } else if (st.phase === 'telegraph') {
        chomp = 0.3 + 0.25 * Math.sin(this.time * 14 + i * 1.3);
      }
      node.jaw.rotation.z = node.lungeDir * chomp * 0.9;
      node.jaw.position.y = node.jawBaseY - chomp * 0.28;
      for (let f = 0; f < node.lowerTeeth.length; f++) {
        const tooth = node.lowerTeeth[f];
        const baseY = node.lowerTeethBaseY[f];
        if (tooth === undefined || baseY === undefined) continue;
        tooth.position.y = baseY - chomp * 0.42;
        tooth.rotation.z = node.lungeDir * chomp * 0.5;
      }
      node.mouth.scale.setScalar(0.55 + chomp * 0.35);
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
