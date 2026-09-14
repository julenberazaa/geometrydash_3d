import * as THREE from 'three';
import type { ChomperDef } from '../level/levelDefinition';
import type { ChomperState } from '../game/chomperSystem';
import type { MaterialLibrary } from './MaterialLibrary';

/**
 * ChomperView (M8D) — presentation for the deterministic lava chompers.
 * Owned by `RendererHost`; observes `GameSimulation.chomperStates` and the
 * level's `chompers` defs. Never writes gameplay state.
 *
 * M8.2 lava-chomper language (no licensed geometry — the M8.1 round dark
 * body read as a mouse): a BRIGHT molten-orange BLOCKY body (emissive
 * glow, square silhouette) with dark cooling-crust plates, a BIG square
 * head (wider/taller than the body) with a wide hot maw, FOUR large
 * upper fangs + three jaw teeth, brow-shaded ignition eyes (aggression,
 * not ears), dorsal heat-spikes, dark crust bands, and a chomping lower
 * jaw (chews while telegraphing, gapes while lunging) + a 5-link energy
 * chain stretching back to the authored anchor.
 *
 * Bounded: at most MAX_CHOMPERS groups × 26 meshes (body + 2 crust +
 * head + brow + maw + 4 fangs + jaw + 3 teeth + 2 eyes + 3 spikes +
 * 2 bands + 5 links), all shared library geometries/materials. Zero
 * per-frame allocation (one scratch Vector3); render-dt driven so pause
 * freezes the menace with everything else.
 */
export const CHOMPER_CHAIN_LINKS = 5;
export const MAX_CHOMPERS = 8;

interface ChomperNodes {
  group: THREE.Group;
  jaw: THREE.Mesh;
  jawBaseY: number;
  mouthBaseY: number;
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

      // Body: BRIGHT molten block (emissive glow) bound to the gameplay
      // hitbox — the heat is the body now, not the trim. Square read.
      const body = new THREE.Mesh(library.unitBox, library.chomperGlow);
      body.scale.set(h.x * 1.4, h.y * 1.1, h.z * 1.3);
      body.position.set(-def.lungeDirection * h.x * 0.3, 0, 0);
      g.add(body);

      // Cooling-crust plates: dark shell slabs on the molten body (top +
      // back) — lava cooling into rock, not a rodent pelt.
      const crustT = new THREE.Mesh(library.unitBox, library.chomperShell);
      crustT.scale.set(h.x * 1.0, h.y * 0.22, h.z * 0.9);
      crustT.position.set(-def.lungeDirection * h.x * 0.4, h.y * 0.62, 0);
      g.add(crustT);
      const crustB = new THREE.Mesh(library.unitBox, library.chomperShell);
      crustB.scale.set(h.x * 0.35, h.y * 0.9, h.z * 1.1);
      crustB.position.set(-def.lungeDirection * h.x * 1.0, 0, 0);
      g.add(crustB);

      // HEAD: big square molten skull at the lunge front — wider and
      // taller than the body, the dominant silhouette from every angle.
      const head = new THREE.Mesh(library.unitBox, library.chomperGlow);
      head.scale.set(h.x * 1.0, h.y * 1.35, h.z * 1.55);
      head.position.set(def.lungeDirection * h.x * 0.85, h.y * 0.12, 0);
      g.add(head);

      // Brow plate: dark armor slab over the eyes — aggression read.
      const brow = new THREE.Mesh(library.unitBox, library.chomperShell);
      brow.scale.set(h.x * 0.8, h.y * 0.25, h.z * 1.6);
      brow.position.set(def.lungeDirection * h.x * 0.9, h.y * 0.78, 0);
      g.add(brow);

      // Dorsal heat-spikes: three large glowing cones along the spine
      // (shared chevron geometry — bigger, hotter than M8.1).
      for (let s = 0; s < 3; s++) {
        const spike = new THREE.Mesh(library.chevron, library.chomperGlow);
        spike.scale.setScalar(0.7 + (s === 1 ? 0.25 : 0));
        spike.position.set(
          -def.lungeDirection * h.x * (0.1 + s * 0.4),
          h.y * (1.0 + (s === 1 ? 0.2 : 0)),
          0,
        );
        spike.rotation.z = def.lungeDirection * 0.25;
        g.add(spike);
      }

      // Crust bands: TWO dark shell rings wrapping the bright body (the
      // M8.1 glow bands inverted — cooling cracks on magma, readable
      // from every camera angle).
      const bandR = Math.max(h.x, h.y, 1) * 1.02;
      const band = new THREE.Mesh(library.orbHalo, library.chomperShell);
      band.scale.set(bandR / 0.62, bandR / 0.62, bandR / 0.62);
      band.rotation.y = Math.PI / 2; // ring plane ⊥ X (the lunge axis)
      band.position.x = -def.lungeDirection * h.x * 0.3;
      g.add(band);
      const bandV = new THREE.Mesh(library.orbHalo, library.chomperShell);
      bandV.scale.set(bandR / 0.62, bandR / 0.62, bandR / 0.62);
      bandV.position.x = -def.lungeDirection * h.x * 0.3;
      g.add(bandV);

      // Maw: a WIDE hot mouth box across the head's leading face.
      const mouth = new THREE.Mesh(library.unitBox, library.chomperCore);
      mouth.scale.set(h.x * 0.35, h.y * 0.55, h.z * 1.15);
      mouth.position.set(def.lungeDirection * h.x * 1.38, -h.y * 0.28, 0);
      g.add(mouth);

      // Upper fangs: FOUR large heat-bright teeth across the maw
      // (shared cone geometry + mouth-core material — hot teeth).
      for (let f = 0; f < 4; f++) {
        const fang = new THREE.Mesh(library.chevron, library.chomperCore);
        fang.scale.setScalar(0.62);
        fang.rotation.x = Math.PI; // cone tip -> down
        fang.position.set(
          def.lungeDirection * h.x * (1.3 + (f % 2 === 0 ? 0.18 : -0.05)),
          -h.y * 0.5,
          (f - 1.5) * h.z * 0.34,
        );
        g.add(fang);
      }

      // Lower jaw: a square molten slab under the maw, drops open while
      // lunging (glow jaw — the bite glows, not just the upper teeth).
      const jaw = new THREE.Mesh(library.unitBox, library.chomperGlow);
      jaw.scale.set(h.x * 1.1, h.y * 0.3, h.z * 1.35);
      const jawBaseY = -h.y * 0.9;
      jaw.position.set(
        def.lungeDirection * h.x * 0.95,
        jawBaseY,
        0,
      );
      g.add(jaw);

      // Lower teeth: three cones riding the jaw (group children, NOT jaw
      // children — jaw scale would squash them; the update loop drops
      // them with the chomp instead).
      const lowerTeeth: THREE.Mesh[] = [];
      const lowerTeethBaseY: number[] = [];
      for (let f = 0; f < 3; f++) {
        const tooth = new THREE.Mesh(library.chevron, library.chomperCore);
        tooth.scale.setScalar(0.5);
        const baseY = -h.y * 0.62;
        tooth.position.set(
          def.lungeDirection * h.x * (0.8 + f * 0.28),
          baseY,
          (f - 1) * h.z * 0.36,
        );
        g.add(tooth);
        lowerTeeth.push(tooth);
        lowerTeethBaseY.push(baseY);
      }

      // Twin ignition eyes tucked UNDER the brow plate (hooded aggression
      // read — never ears-on-top). Bigger and hotter than M8.1.
      const eyeL = new THREE.Mesh(library.orbSphere, library.chomperCore);
      eyeL.scale.setScalar(0.42);
      eyeL.position.set(def.lungeDirection * h.x * 0.95, h.y * 0.52, h.z * 0.5);
      const eyeR = new THREE.Mesh(library.orbSphere, library.chomperCore);
      eyeR.scale.setScalar(0.42);
      eyeR.position.set(def.lungeDirection * h.x * 0.95, h.y * 0.52, -h.z * 0.5);
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
        group: g, jaw, jawBaseY, mouthBaseY: h.y * 0.55, eyeL, eyeR, mouth,
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
        const eye = 0.42 * (1 + 0.5 * Math.sin(this.time * 22));
        node.eyeL.scale.setScalar(Math.max(0.26, eye));
        node.eyeR.scale.setScalar(Math.max(0.26, eye));
      } else {
        node.group.scale.setScalar(1);
        node.eyeL.scale.setScalar(st.phase === 'dormant' ? 0.3 : 0.42);
        node.eyeR.scale.setScalar(st.phase === 'dormant' ? 0.3 : 0.42);
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
      // Maw gape: the box mouth stretches vertically with the bite
      // (relative to its authored scale — never setScalar on a box).
      node.mouth.scale.y = node.mouthBaseY * (1 + chomp * 0.45);
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
