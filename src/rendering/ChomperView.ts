import * as THREE from 'three';
import type { ChomperDef } from '../level/levelDefinition';
import type { ChomperState } from '../game/chomperSystem';
import type { MaterialLibrary } from './MaterialLibrary';

/**
 * ChomperView (M8D) — presentation for the deterministic lava chompers.
 * Owned by `RendererHost`; observes `GameSimulation.chomperStates` and the
 * level's `chompers` defs. Never writes gameplay state.
 *
 * M8.3 voxel lava chain-chomp language (human reference: bright
 * lava-orange voxel ball whose front IS a huge dark mouth): ONE mottled
 * magma head-ball (molten-glow body + hot-yellow voxel mottle cubes +
 * dark cooling-crust plates, square silhouette) with a LARGE dark mouth
 * cavity across the lunge face, FOUR chunky upper block-teeth + three jaw
 * block-teeth, white-hot SQUARE eyes with dark pupils flanking the mouth
 * (side read, never ears-on-top), a chunky lava-hot chain stretching back
 * to the authored anchor, and a lava cube weight riding the anchor end.
 * The lower jaw chews while telegraphing and gapes while lunging.
 *
 * Bounded: at most MAX_CHOMPERS groups × 26 meshes (head + 4 mottle +
 * 2 crust + mouth + 4 upper teeth + jaw + 3 lower teeth + 2 eyes +
 * 2 pupils + 5 links + 1 weight), all shared library geometries/materials
 * (one new shared eye-white material; geometry count unchanged). Zero
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
  /** Base (unflared) eye scales — the telegraph flare multiplies these. */
  eyeBaseL: THREE.Vector3;
  eyeBaseR: THREE.Vector3;
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
      const dir = def.lungeDirection;

      // Head-ball: ONE mottled magma mass (the face AND the body — the
      // reference reads as a single voxel ball, not a body + head).
      // Slightly larger than the gameplay hitbox so the threat reads.
      const head = new THREE.Mesh(library.unitBox, library.chomperGlow);
      head.scale.set(h.x * 1.7, h.y * 1.7, h.z * 1.7);
      head.position.set(dir * h.x * 0.15, h.y * 0.1, 0);
      g.add(head);
      const faceX = dir * h.x * (0.15 + 0.85);

      // Voxel mottle: hot-yellow cubes proud of the magma surface (the
      // reference's mottled yellow-orange read, zero textures).
      const mottle: Array<[number, number, number]> = [
        [dir * h.x * 0.1, h.y * 1.0, 0],
        [dir * h.x * -0.4, h.y * 0.45, h.z * 0.75],
        [dir * h.x * -0.4, h.y * 0.45, -h.z * 0.75],
        [dir * h.x * -0.75, h.y * 0.1, 0],
      ];
      for (const [mx, my, mz] of mottle) {
        const cube = new THREE.Mesh(library.unitBox, library.chomperCore);
        cube.scale.setScalar(Math.max(0.2, h.y * 0.55));
        cube.position.set(mx, my, mz);
        g.add(cube);
      }

      // Cooling-crust plates: dark slabs on the magma (top + back) —
      // lava cooling into rock.
      const crustT = new THREE.Mesh(library.unitBox, library.chomperShell);
      crustT.scale.set(h.x * 1.1, h.y * 0.22, h.z * 1.0);
      crustT.position.set(dir * h.x * -0.1, h.y * 1.0, 0);
      g.add(crustT);
      const crustB = new THREE.Mesh(library.unitBox, library.chomperShell);
      crustB.scale.set(h.x * 0.35, h.y * 1.1, h.z * 1.2);
      crustB.position.set(dir * h.x * -0.75, h.y * 0.1, 0);
      g.add(crustB);

      // Mouth cavity: a LARGE dark maw across the lunge face (the front
      // IS the mouth — ~60% of the face height, wider than tall).
      const mouth = new THREE.Mesh(library.unitBox, library.chomperShell);
      mouth.scale.set(h.x * 0.4, h.y * 1.05, h.z * 1.25);
      mouth.position.set(faceX, -h.y * 0.18, 0);
      g.add(mouth);
      const mouthTopY = -h.y * 0.18 + h.y * 0.525;

      // Upper block-teeth: FOUR chunky hot boxes hanging from the mouth's
      // top edge (reference teeth are blocks, never cones).
      for (let f = 0; f < 4; f++) {
        const tooth = new THREE.Mesh(library.unitBox, library.chomperCore);
        tooth.scale.set(h.x * 0.34, h.y * 0.34, h.z * 0.24);
        tooth.position.set(
          faceX + dir * h.x * 0.08,
          mouthTopY - h.y * 0.12,
          (f - 1.5) * h.z * 0.3,
        );
        g.add(tooth);
      }

      // Lower jaw: a square molten slab under the maw, drops open while
      // lunging (the bite glows, not just the upper teeth).
      const jaw = new THREE.Mesh(library.unitBox, library.chomperGlow);
      jaw.scale.set(h.x * 1.1, h.y * 0.3, h.z * 1.35);
      const jawBaseY = -h.y * 0.95;
      jaw.position.set(
        dir * h.x * 0.95,
        jawBaseY,
        0,
      );
      g.add(jaw);

      // Lower block-teeth: three chunky boxes riding the jaw (group
      // children, NOT jaw children — jaw scale would squash them; the
      // update loop drops them with the chomp instead).
      const lowerTeeth: THREE.Mesh[] = [];
      const lowerTeethBaseY: number[] = [];
      for (let f = 0; f < 3; f++) {
        const tooth = new THREE.Mesh(library.unitBox, library.chomperCore);
        tooth.scale.set(h.x * 0.32, h.y * 0.34, h.z * 0.24);
        const baseY = -h.y * 0.62;
        tooth.position.set(
          dir * h.x * (0.8 + f * 0.28),
          baseY,
          (f - 1) * h.z * 0.32,
        );
        g.add(tooth);
        lowerTeeth.push(tooth);
        lowerTeethBaseY.push(baseY);
      }

      // Reference eyes: white-hot SQUARES on the face flanking the mouth
      // with dark pupils (side read — never ears-on-top). Pupils are eye
      // children so the telegraph flare carries them for free.
      const mkEye = (zSide: number): THREE.Mesh => {
        const eye = new THREE.Mesh(library.unitBox, library.chomperEyeWhite);
        eye.scale.set(h.x * 0.25, h.y * 0.52, h.z * 0.4);
        eye.position.set(faceX + dir * h.x * 0.05, h.y * 0.52, zSide * h.z * 0.78);
        const pupil = new THREE.Mesh(library.unitBox, library.chomperShell);
        pupil.scale.setScalar(0.45);
        pupil.position.set(dir * 0.6, 0, 0);
        eye.add(pupil);
        return eye;
      };
      const eyeL = mkEye(1);
      const eyeR = mkEye(-1);
      g.add(eyeL, eyeR);

      // Lava chain: chunky hot links from the anchor to the body + a
      // lava cube weight riding the anchor end (reference ball-and-chain).
      const anchor = new THREE.Vector3(
        def.chainAnchor?.x ?? def.dormant.x,
        def.chainAnchor?.y ?? def.dormant.y,
        def.chainAnchor?.z ?? def.dormant.z,
      );
      const links: THREE.Mesh[] = [];
      for (let l = 0; l < CHOMPER_CHAIN_LINKS; l++) {
        const link = new THREE.Mesh(library.unitBox, library.chomperChain);
        link.scale.set(0.4, 0.4, 0.4);
        g.add(link);
        links.push(link);
        this.group.add(link);
      }
      const weight = new THREE.Mesh(library.unitBox, library.chomperGlow);
      weight.scale.setScalar(0.55);
      weight.position.copy(anchor);
      this.group.add(weight);
      // NOTE: links + weight live in view space (not the Chomper group)
      // so the telegraph pulse scale never stretches the chain.
      this.group.add(g);
      this.nodes.push({
        group: g, jaw, jawBaseY, mouthBaseY: h.y * 1.05, eyeL, eyeR,
        eyeBaseL: eyeL.scale.clone(), eyeBaseR: eyeR.scale.clone(),
        mouth, lowerTeeth, lowerTeethBaseY, links,
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
      // Telegraph: rapid anticipation pulse (scale shiver + eye flare —
      // the flare multiplies the stored base scales so the square eyes
      // stay square; shared materials can never change per-instance).
      const flare = (k: number, base: THREE.Vector3, eye: THREE.Mesh): void => {
        eye.scale.set(base.x * k, base.y * k, base.z * k);
      };
      if (st.phase === 'telegraph') {
        const pulse = 1 + 0.09 * Math.sin(this.time * 22 + i * 1.7);
        node.group.scale.setScalar(pulse);
        const eye = 1 + 0.5 * Math.sin(this.time * 22);
        flare(Math.max(0.6, eye), node.eyeBaseL, node.eyeL);
        flare(Math.max(0.6, eye), node.eyeBaseR, node.eyeR);
      } else {
        node.group.scale.setScalar(1);
        const rest = st.phase === 'dormant' ? 0.75 : 1;
        flare(rest, node.eyeBaseL, node.eyeL);
        flare(rest, node.eyeBaseR, node.eyeR);
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
