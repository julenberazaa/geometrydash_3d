import * as THREE from 'three';
import type { LoadedLevel } from '../level/levelRuntime';
import type { MaterialLibrary } from './MaterialLibrary';
import { lavaFeedsFallTop, lavaReceivesFallBottom } from '../level/lavaAuthoring';
import {
  GRAVITY_GATE_RADIUS,
  MODE_GATE_RADIUS,
  TELEPORT_GATE_RADIUS,
  TELEPORT_MAW_GATE_RADIUS,
} from '../level/portalAuthoring';

/** Solids shorter than this carry no face trims (markers, thin inlays). */
const FACE_TRIM_MIN_HEIGHT = 0.8;
/** Faces narrower than this get no center seam (small faces read via frame). */
const FACE_SEAM_MIN_WIDTH = 6.0;
/**
 * Bottom-face trims (underside rails) apply only to undersides exposed in
 * open air well above the void reference (world-space heuristic — the same
 * axis the gameplay frame uses). Ground-resting or buried bottoms are skipped:
 * their rails would either poke through a host solid's top face or never be
 * seen, and the M3.2 audit measured that only elevated undersides (ceiling run
 * surfaces) need them — see specs/milestones/M3_2_CEILING_VIEW_PARITY.md.
 */
const UNDER_RAIL_MIN_BOTTOM_Y = 2.0;
// NOTE: every face trim below rides ~0.04 proud of its host face (applique).
// Fully embedded trims are invisible inside the opaque solid (M1.2 lesson).

/**
 * M8.3 lava motion node (+ M8.4 conveyor kinds): a build-time lava mesh
 * animated per frame by `LevelView.updateLava`. Base transform +
 * deterministic phase are captured at build; the update mutates
 * position/scale in place — zero per-frame allocation.
 *
 * M8.4 conveyor nodes (`core`, `crustFlow`, `pulse`) ride a build-time
 * path: the upstream start (baseX, baseZ) plus (dirX, dirZ, travel);
 * progress wraps 0..1 in render-clock. `slot` stays the pattern/segment
 * index.
 */
interface LavaAnimNode {
  mesh: THREE.Mesh;
  kind: 'crust' | 'fall' | 'splash' | 'drip' | 'mouth' | 'core' | 'crustFlow' | 'pulse';
  baseX: number;
  baseY: number;
  baseZ: number;
  baseSX: number;
  baseSY: number;
  baseSZ: number;
  /** Segment index down the fall (fall) or pattern slot (crust/core). */
  slot: number;
  phase: number;
  /** M8.4 conveyor path: unit-ish XZ direction + travel length. */
  dirX: number;
  dirZ: number;
  travel: number;
}

/**
 * Level view: builds Three.js representations from level data.
 * Shared library geometries + shared library materials (M6A material
 * ownership: this view creates Meshes only — never materials/geometries).
 * Colliders remain the gameplay truth; these meshes are visuals only.
 */
export class LevelView {
  public readonly group: THREE.Group;
  /** M8.3 lava motion registry (cleared on dispose). */
  private readonly lavaAnim: LavaAnimNode[] = [];
  /** M8.3 lava clock (render seconds; pause freezes the flow). */
  private lavaTime = 0;

  constructor(
    level: LoadedLevel,
    private readonly library: MaterialLibrary,
  ) {
    this.group = new THREE.Group();

    const box = library.unitBox;
    const spike = library.spikeCone;

    const bodyMat = library.routeBody;
    const topMat = library.routeTop;
    const underMat = library.routeUnder;
    const edgeMat = library.routeEdge;
    const hazardMat = library.hazard;

    for (const solid of level.def.solids) {
      const mesh = new THREE.Mesh(box, bodyMat);
      mesh.scale.set(
        solid.halfExtents.x * 2,
        solid.halfExtents.y * 2,
        solid.halfExtents.z * 2,
      );
      mesh.position.set(solid.center.x, solid.center.y, solid.center.z);
      this.group.add(mesh);

      // Emissive top surface inset slightly (readable walkable area).
      const top = new THREE.Mesh(box, topMat);
      top.scale.set(
        solid.halfExtents.x * 2 - 0.12,
        0.02,
        solid.halfExtents.z * 2 - 0.12,
      );
      top.position.set(
        solid.center.x,
        solid.center.y + solid.halfExtents.y + 0.011,
        solid.center.z,
      );
      this.group.add(top);

      // Exposed-face edge treatment (M1.1 corners + M1.2 faces): thin unlit
      // boxes in the shared edge material framing each solid so slabs read
      // as volumes and gap/drop faces glow instead of vanishing into holes.
      //
      // Hard lesson (M1.2 root cause): trims fully INSIDE the solid footprint
      // are invisible — an opaque box hides anything behind its faces. Every
      // face trim therefore rides PROUD of its host face (applique): each
      // piece protrudes ~0.04 beyond the face plane while staying embedded
      // enough to anchor. Intersecting trims use staggered depths
      // (5 mm plane separations) so no two faces are ever coplanar.
      // Restrained: markers/inlays (< 0.8 tall) stay quiet; orange spike
      // hazards are never trimmed and remain visually distinct.
      const solidHeight = solid.halfExtents.y * 2;
      const solidWidth = solid.halfExtents.x * 2;
      const bottomY = solid.center.y - solid.halfExtents.y;
      const frontZ = solid.center.z - solid.halfExtents.z; // faces the camera

      // M3.1: underside inset, same visual language as the top inset — this
      // is the RUN SURFACE of ceiling-gravity sections. A down-facing face
      // receives only the near-black hemisphere ground light, so the ceiling
      // underside used to render as a void and the attached Cube read as
      // floating. A dim UNLIT panel (rides 0.011 proud below the face) keeps
      // the surface readable from the corridor below. On floor content the
      // bottom faces are buried or void-facing, so this changes nothing there.
      if (solidHeight >= FACE_TRIM_MIN_HEIGHT) {
        const under = new THREE.Mesh(box, underMat);
        under.scale.set(
          solid.halfExtents.x * 2 - 0.12,
          0.02,
          solid.halfExtents.z * 2 - 0.12,
        );
        under.position.set(solid.center.x, bottomY - 0.011, solid.center.z);
        this.group.add(under);

        // M3.2: underside edge rails — the mirror of the top-edge strips
        // below, for exposed undersides only (see UNDER_RAIL_MIN_BOTTOM_Y).
        // Evidence (M3.2 audit): every neon rail previously lived on top
        // faces, so the ceiling run surface had zero edge structure while the
        // floor track glowed with it; and the below-focus camera makes the
        // Cube's own silhouette occlude the ceiling surface ~4..16 u ahead —
        // the LATERAL edges beside that silhouette are the only viable
        // forward cue. Rails mark the corridor boundaries and the lethal gap
        // edges with the same visual language the floor already has.
        if (bottomY >= UNDER_RAIL_MIN_BOTTOM_Y) {
          for (const side of [-1, 1]) {
            const strip = new THREE.Mesh(box, edgeMat);
            strip.scale.set(solidWidth + 0.1, 0.055, 0.1);
            strip.position.set(
              solid.center.x,
              bottomY - 0.01,
              solid.center.z + side * (solid.halfExtents.z - 0.01),
            );
            this.group.add(strip);
            const stripSide = new THREE.Mesh(box, edgeMat);
            stripSide.scale.set(0.1, 0.055, solid.halfExtents.z * 2 + 0.1);
            stripSide.position.set(
              solid.center.x + side * (solid.halfExtents.x - 0.01),
              bottomY - 0.01,
              solid.center.z,
            );
            this.group.add(stripSide);
          }
        }

        // Four corner posts, outboard of the solid so each shows on BOTH
        // adjacent faces (front/back + sides share the corners).
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const post = new THREE.Mesh(box, edgeMat);
            post.scale.set(0.09, solidHeight, 0.09);
            post.position.set(
              solid.center.x + sx * (solid.halfExtents.x + 0.005),
              solid.center.y - 0.02,
              solid.center.z + sz * (solid.halfExtents.z + 0.005),
            );
            this.group.add(post);
          }
        }
        // Front-face bottom strip: completes the glowing rectangle with the
        // existing top strip + corner posts. Gap landing faces read as
        // framed portals instead of dark holes.
        const sill = new THREE.Mesh(box, edgeMat);
        sill.scale.set(solidWidth + 0.1, 0.055, 0.1);
        sill.position.set(solid.center.x, bottomY + 0.03, frontZ);
        this.group.add(sill);
        // M7.3: rear-face bottom strip — the mirror of the front sill.
        // Drop/takeoff faces on the far side previously ended in an open
        // dark edge once the camera passed them; both gap faces now read
        // as closed glowing frames from either side.
        const backZ = solid.center.z + solid.halfExtents.z; // faces away
        const backSill = new THREE.Mesh(box, edgeMat);
        backSill.scale.set(solidWidth + 0.1, 0.055, 0.1);
        backSill.position.set(solid.center.x, bottomY + 0.03, backZ);
        this.group.add(backSill);
        // Front-face center seam on wide solids: breaks up the dark face
        // center where the player actually looks when crossing gaps.
        if (solidWidth >= FACE_SEAM_MIN_WIDTH) {
          const seam = new THREE.Mesh(box, edgeMat);
          seam.scale.set(0.09, solidHeight, 0.09);
          seam.position.set(solid.center.x, solid.center.y - 0.02, frontZ + 0.005);
          this.group.add(seam);
        }
      }

      // Neon edge strips along the two long top edges (X direction edges).
      // M7.3 corner closure: strips run the FULL slab width and sit almost
      // flush with the outboard corner posts (ends tuck under the posts),
      // so the top frame reads as one continuous closed rectangle instead
      // of four near-touching segments.
      for (const side of [-1, 1]) {
        const strip = new THREE.Mesh(box, edgeMat);
        strip.scale.set(solid.halfExtents.x * 2 + 0.1, 0.055, 0.1);
        strip.position.set(
          solid.center.x,
          solid.center.y + solid.halfExtents.y + 0.01,
          solid.center.z + side * (solid.halfExtents.z - 0.01),
        );
        this.group.add(strip);
        const stripSide = new THREE.Mesh(box, edgeMat);
        stripSide.scale.set(0.1, 0.055, solid.halfExtents.z * 2 + 0.1);
        stripSide.position.set(
          solid.center.x + side * (solid.halfExtents.x - 0.01),
          solid.center.y + solid.halfExtents.y + 0.01,
          solid.center.z,
        );
        this.group.add(stripSide);
      }

      // M8.1 tunnel-wall mid-band: tall thin freestanding walls (corridor
      // and tunnel sides — e.g. the Ship tunnel) otherwise render as tall
      // unlit black masses, because their broad side faces catch almost no
      // hemisphere or directional light. One neon bead at mid-height along
      // BOTH side faces breaks the mass with the route's edge language and
      // gives enclosed corridors a longitudinal structure cue. Purely
      // geometric (height ≥ 5 with a horizontal half ≤ 0.6 — the same
      // precedent as the 0.8 trim rule and the y ≥ 2 underside-rail rule),
      // shared edge material, two meshes per wall, zero per-frame work.
      // The 0.07 section deliberately differs from the 0.055 rail stock so
      // rail-parity probes keep measuring exactly what they pinned.
      const minHorizontalHalf = Math.min(solid.halfExtents.x, solid.halfExtents.z);
      if (solidHeight >= 5 && minHorizontalHalf <= 0.6) {
        // Bead runs along the wall's LONG horizontal axis, riding proud
        // of each narrow face (tunnel walls are X-thin/Z-long; a Z-thin
        // cross-wall gets the mirrored treatment).
        const thinX = solid.halfExtents.x <= solid.halfExtents.z;
        for (const side of [-1, 1]) {
          const bead = new THREE.Mesh(box, edgeMat);
          if (thinX) {
            bead.scale.set(0.07, 0.07, solid.halfExtents.z * 2 + 0.1);
            bead.position.set(
              solid.center.x + side * (solid.halfExtents.x + 0.005),
              solid.center.y,
              solid.center.z,
            );
          } else {
            bead.scale.set(solid.halfExtents.x * 2 + 0.1, 0.07, 0.07);
            bead.position.set(
              solid.center.x,
              solid.center.y,
              solid.center.z + side * (solid.halfExtents.z + 0.005),
            );
          }
          this.group.add(bead);
        }
      }

      // M7.3 mini-island under-glow: narrow (single-lane-class) slabs carry
      // a full bottom-edge frame mirroring the top frame, so small aerial
      // platforms glow as floating volumes instead of dark chips. Shared
      // edge material, zero new resources; wide recovery slabs stay quiet.
      // Exposure-gated like the underside rails: bottoms resting in
      // (-0.5, 0.5) sit ON other geometry (a glow frame there would embed
      // invisibly inside the host solid — M1.2 lesson), so only floating
      // (<= -0.5) or clearly elevated (>= 0.5) narrow bottoms glow.
      const islandBottomY = solid.center.y - solid.halfExtents.y;
      const bottomExposed = islandBottomY >= 0.5 || islandBottomY <= -0.5;
      if (solidHeight >= FACE_TRIM_MIN_HEIGHT && solid.halfExtents.x <= 1.4 && bottomExposed) {
        for (const side of [-1, 1]) {
          const glow = new THREE.Mesh(box, edgeMat);
          glow.scale.set(solid.halfExtents.x * 2 + 0.1, 0.055, 0.1);
          glow.position.set(
            solid.center.x,
            islandBottomY - 0.01,
            solid.center.z + side * (solid.halfExtents.z - 0.01),
          );
          this.group.add(glow);
          const glowSide = new THREE.Mesh(box, edgeMat);
          glowSide.scale.set(0.1, 0.055, solid.halfExtents.z * 2 + 0.1);
          glowSide.position.set(
            solid.center.x + side * (solid.halfExtents.x - 0.01),
            islandBottomY - 0.01,
            solid.center.z,
          );
          this.group.add(glowSide);
        }
      }
    }

    // Hazard spikes orient relative to their declared support surface (M7.1
    // general rule — no level-id branches, no coordinate heuristics): the
    // base attaches to the support and the tip points AWAY from it (floor:
    // tip +Y; ceiling: tip −Y). Gameplay colliders are untouched — only the
    // presentation mesh flips and re-seats. Omitted `mount` = 'floor', so
    // every pre-M7.1 level renders byte-identically.
    for (const hazard of level.def.hazards) {
      // M7.3 frontal-kill walls (kind `killFront` / visual `block`): solid
      // hazard-orange blocks at EXACTLY the collider size with a neon edge
      // frame, so maze walls read as lethal fronts immediately. Frontal
      // kill semantics live in the simulation (contact normal + approach);
      // this branch only chooses the presentation mesh — kind-based, never
      // level-id-based.
      if (hazard.kind === 'killFront' || hazard.visual === 'block') {
        const wall = new THREE.Mesh(box, hazardMat);
        wall.scale.set(
          hazard.halfExtents.x * 2,
          hazard.halfExtents.y * 2,
          hazard.halfExtents.z * 2,
        );
        wall.position.set(hazard.center.x, hazard.center.y, hazard.center.z);
        this.group.add(wall);
        // Glowing front plate on the camera-facing face: the lethal front
        // reads immediately (slightly larger than the wall, riding proud
        // so no faces are ever coplanar).
        const face = new THREE.Mesh(box, edgeMat);
        face.scale.set(hazard.halfExtents.x * 2 + 0.06, hazard.halfExtents.y * 2 + 0.06, 0.06);
        face.position.set(
          hazard.center.x,
          hazard.center.y,
          hazard.center.z - hazard.halfExtents.z - 0.005,
        );
        this.group.add(face);
        continue;
      }
      const mesh = new THREE.Mesh(spike, hazardMat);
      const mount = hazard.mount ?? 'floor';
      // M8B: the tip points AWAY from the support along the surface
      // normal on all four surfaces (floor +Y, ceiling −Y, leftWall −X,
      // rightWall +X). The cone carries its tip at local +height/2;
      // scale is applied in local space (height stays local Y) and the
      // Z-roll lays it onto ±X for walls.
      const alongX = mount === 'leftWall' || mount === 'rightWall';
      const visualHeight = (alongX ? hazard.halfExtents.x : hazard.halfExtents.y) * 3.4;
      mesh.scale.set(
        alongX ? hazard.halfExtents.y * 2.2 : hazard.halfExtents.x * 2.2,
        visualHeight,
        hazard.halfExtents.z * 2.2,
      );
      if (mount === 'leftWall') {
        // Base on the +X support face, tip −X (away from the wall).
        mesh.position.set(
          hazard.center.x + hazard.halfExtents.x - visualHeight / 2,
          hazard.center.y,
          hazard.center.z,
        );
        mesh.rotation.z = Math.PI / 2;
      } else if (mount === 'rightWall') {
        // Base on the −X support face, tip +X.
        mesh.position.set(
          hazard.center.x - hazard.halfExtents.x + visualHeight / 2,
          hazard.center.y,
          hazard.center.z,
        );
        mesh.rotation.z = -Math.PI / 2;
      } else {
        const ceilingMount = mount === 'ceiling';
        mesh.position.set(
          hazard.center.x,
          ceilingMount
            ? hazard.center.y + hazard.halfExtents.y - visualHeight / 2
            : hazard.center.y - hazard.halfExtents.y + visualHeight / 2,
          hazard.center.z,
        );
        mesh.rotation.x = ceilingMount ? Math.PI : 0;
      }
      mesh.rotation.y = Math.PI / 4;
      this.group.add(mesh);
    }

    this.buildGravityPortals(level);
    this.buildTeleportPortals(level);
    this.buildModePortals(level);
    this.buildLavaVolumes(level);
    this.buildSetpieces(level);
  }

  /**
   * M8A gravity portal visuals: COMPACT professional ring gates on the
   * route line — one circular mouth per portal (outer halo + inner rim +
   * energy disc + a direction chevron pointing along the pull of the
   * TARGET gravity). The wall-sized pane gateway language is retired:
   * portals read as holes to fly through, never architecture. Ring center
   * sits on the approach surface (low for floor approaches, high for
   * ceiling approaches); wall-gravity targets offset toward their wall
   * (see M8B). Purely presentational — triggering lives in the
   * simulation, never here. Shared halo/box/chevron geometries + the two
   * direction materials; zero per-frame work.
   */
  private buildGravityPortals(level: LoadedLevel): void {
    if (level.gravityPortals.length === 0) return;
    for (const portal of level.gravityPortals) {
      const toCeiling = portal.target === 'ceiling';
      const toFloor = portal.target === 'floor';
      const frameMat = toCeiling ? this.library.portalUp : this.library.portalDown;
      const paneMat = toCeiling ? this.library.portalPaneUp : this.library.portalPaneDown;
      // Gate center: M8.1 bounded portals render ON their trigger volume
      // (the ring marks the opening the sim actually tests — volume and
      // visual can never disagree). Legacy volume-less portals keep the
      // approach-side convention (low for floor approaches, high for
      // ceiling approaches, wall targets offset toward their wall).
      const vc = portal.triggerCenter;
      const cy = vc !== undefined ? vc.y : toCeiling ? 1.7 : toFloor ? 4.9 : 2.6;
      const cx =
        vc !== undefined
          ? vc.x
          : portal.target === 'leftWall'
            ? 3.4
            : portal.target === 'rightWall'
              ? -3.4
              : 0;
      // Gate opening radius is owned by portalAuthoring (the trigger
      // validator enforces volume ≈ this opening — visual/sim agreement).
      this.buildPortalRing(cx, cy, portal.z, GRAVITY_GATE_RADIUS, frameMat, paneMat);
      // Direction glyph: chevron along the target gravity pull (up = away
      // from floor, down = away from ceiling, sideways for walls).
      const glyph = new THREE.Mesh(this.library.chevron, frameMat);
      glyph.scale.setScalar(0.9);
      glyph.position.set(cx, cy, portal.z);
      if (portal.target === 'leftWall') {
        glyph.rotation.z = -Math.PI / 2;
      } else if (portal.target === 'rightWall') {
        glyph.rotation.z = Math.PI / 2;
      } else {
        glyph.rotation.x = toCeiling ? Math.PI : 0;
      }
      this.group.add(glyph);
    }
  }

  /**
   * Shared compact ring-gate builder (M8A portal family): outer halo +
   * bright inner rim + faint energy disc, all facing the camera. One
   * readable threshold per portal type — gravity, speed (via
   * InteractionView), teleport and mode portals share this language with
   * per-family colors and glyphs.
   */
  private buildPortalRing(
    x: number,
    y: number,
    z: number,
    radius: number,
    frameMat: THREE.Material,
    paneMat: THREE.Material,
  ): void {
    const ring = new THREE.Mesh(this.library.orbHalo, frameMat);
    ring.scale.setScalar(radius / 0.62);
    ring.position.set(x, y, z);
    this.group.add(ring);
    const rim = new THREE.Mesh(this.library.orbHalo, paneMat);
    rim.scale.setScalar((radius * 0.72) / 0.62);
    rim.position.set(x, y, z);
    this.group.add(rim);
    // M8.1: thinner energy disc (radius * 1.2, was 1.5) — the gate reads
    // as a ring to fly through, never a wall pane.
    const disc = new THREE.Mesh(this.library.unitBox, paneMat);
    disc.scale.set(radius * 1.2, radius * 1.2, 0.02);
    disc.position.set(x, y, z);
    this.group.add(disc);
  }

  /**
   * M7.3 teleport visuals: compact ROUND ring gates — one circular mouth
   * at the entry plane, one smaller ring at the authored exit — sharing a
   * single violet language (frame + pale pane), visually distinct from the
   * rectangular cyan/warm gravity portals, tier-colored speed gates and
   * yellow/blue orbs. Smaller and rounder than the M7.2 wall-sized gates:
   * the ring reads as a hole to fly through, with a bright inner rim for
   * line-of-travel clarity. Purely presentational: activation lives in the
   * simulation (entry-plane crossing), never here. Shared halo/box
   * geometries + the two shared teleport materials; zero per-frame work.
   *
   * Short-hop pairs (exit close behind entry) render both rings in the
   * same readable space — one connected moment, never a map cut.
   */
  private buildTeleportPortals(level: LoadedLevel): void {
    if (level.teleportPortals.length === 0) return;
    const frameMat = this.library.teleportFrame;
    const paneMat = this.library.teleportPane;

    for (const portal of level.teleportPortals) {
      if (portal.style === 'maw') {
        // Maw entry: a toothed mouth ring centered on the corridor — the
        // guardian's bite. M8.1 radius 1.85 (was 2.2) with a hazard-orange
        // tooth crown (shared chevron geometry) so the entry reads as a
        // creature mouth, not architecture.
        this.buildPortalRing(0, 2.4, portal.entryZ, TELEPORT_MAW_GATE_RADIUS, frameMat, paneMat);
        for (let i = 0; i < 8; i++) {
          const tooth = new THREE.Mesh(this.library.chevron, this.library.hazard);
          const a = (i / 8) * Math.PI * 2;
          tooth.scale.setScalar(0.8);
          tooth.position.set(Math.cos(a) * TELEPORT_MAW_GATE_RADIUS, 2.4 + Math.sin(a) * TELEPORT_MAW_GATE_RADIUS, portal.entryZ);
          // Teeth point inward (cone tip toward the mouth center).
          tooth.rotation.z = a + Math.PI / 2;
          this.group.add(tooth);
        }
      } else {
        // Short-hop entry: compact ring on the route line.
        this.buildPortalRing(0, 1.6, portal.entryZ, TELEPORT_GATE_RADIUS, frameMat, paneMat);
      }
      // Exit: a smaller doorway ring at the authored destination — the
      // entry/exit pair reads as one connected moment in the same scene.
      const exitR = portal.style === 'maw' ? 1.2 : 1.05;
      this.buildPortalRing(portal.exit.x, portal.exit.y + 0.4, portal.exit.z, exitR, frameMat, paneMat);
    }
  }

  /**
   * M8C player-mode portals: compact ring gates in the family language —
   * sky-cyan Ship rings with a forward-dart glyph, mint-green Spider rings
   * with a surface-switch (down) chevron. Same shared geometries as every
   * other portal; triggering lives in the simulation, never here.
   */
  private buildModePortals(level: LoadedLevel): void {
    if (level.modePortals.length === 0) return;
    for (const portal of level.modePortals) {
      const isShip = portal.target === 'ship';
      const mat = isShip ? this.library.modeShip : this.library.modeSpider;
      // M8.1: radius 1.35 (was 1.6), centered on the trigger volume when
      // the portal carries one (same volume/visual agreement as gravity).
      const vc = portal.triggerCenter;
      const gx = vc?.x ?? 0;
      const gy = vc?.y ?? 1.7;
      this.buildPortalRing(gx, gy, portal.z, MODE_GATE_RADIUS, mat, mat);
      const glyph = new THREE.Mesh(this.library.chevron, mat);
      glyph.scale.setScalar(0.85);
      glyph.position.set(gx, gy, portal.z);
      // Ship: dart pointing +Z (forward flight); Spider: chevron pointing
      // down (surface-switch read).
      glyph.rotation.x = isShip ? Math.PI / 2 : 0;
      this.group.add(glyph);
    }
  }

  /**
   * M8A authored lava (gameplay-lethal volumes with sourced visuals),
   * M8.2 viscous-flow read — still blocky, still zero simulation:
   * - `pool`: bright molten surface + dark body + DARK CRUST PLATES
   *   riding on the surface (deterministic per-pool pattern), so the
   *   basin reads as cooling lava with bright cracks, never a flat
   *   orange slab.
   * - `fall`: a stepped zigzag stream (alternating widths/offsets —
   *   thick blocky liquid), bright at the vent grading darker downward
   *   (cools as it falls), plus a bright impact splash where it meets
   *   its pool.
   * - `source`: rock collar + glowing mouth + a short bright drip
   *   joining the mouth to the fed fall below (one continuous pour).
   *
   * Shared unit-box geometry + the two shared lava materials; zero
   * per-frame work (the shimmer is an in-place material pulse owned by
   * MaterialLibrary). Gameplay truth stays in the collider the runtime
   * registers — these meshes are visuals only.
   */
  private buildLavaVolumes(level: LoadedLevel): void {
    const lava = level.def.lava ?? [];
    if (lava.length === 0) return;
    const unitBox = this.library.unitBox;
    const core = this.library.lavaSurface;
    const deep = this.library.lavaDeep;
    const flowCore = this.library.lavaCore;
    const rock = this.library.routeBody;
    // M8.4 directed-flow prepass (same predicates the validator enforces):
    // hinted pools drive conveyor features; a fall touching a hinted pool
    // (fed above or received below) earns a descending pour pulse.
    const flowPools = lava.filter(
      (l) => l.role === 'pool' && l.flow !== undefined && (l.flow.x !== 0 || l.flow.z !== 0),
    );
    const pulseFallIds = new Set<string>();
    for (const f of lava) {
      if (f.role !== 'fall') continue;
      const linked = flowPools.some((p) => lavaFeedsFallTop(f, p) || lavaReceivesFallBottom(f, p));
      if (linked) pulseFallIds.add(f.id);
    }
    // Upstream start of a hinted pool's conveyor (flow-tail edge center)
    // from the pool's full width/depth and unit-ish hint direction.
    const flowStart = (
      cx: number, cz: number, w: number, d: number, fx: number, fz: number,
    ): { x: number; z: number; travel: number; dx: number; dz: number } => {
      const len = Math.hypot(fx, fz) || 1;
      const dx = fx / len;
      const dz = fz / len;
      const travel = Math.max(0.5, Math.abs(dx) * w + Math.abs(dz) * d - 1.2);
      return { x: cx - dx * (travel / 2), z: cz - dz * (travel / 2), travel, dx, dz };
    };
    // Conveyor phase from a build position (t = 0 resumes the build pose).
    const flowPhase = (
      x: number, z: number, s: { x: number; z: number; travel: number; dx: number; dz: number },
    ): number => {
      const off = (x - s.x) * s.dx + (z - s.z) * s.dz;
      const p = (off / s.travel) % 1;
      return p < 0 ? p + 1 : p;
    };
    // Pool tops first (falls splash onto them; static, deterministic).
    const poolTops: { x: number; topY: number; z: number; hx: number; hz: number }[] = [];
    for (const l of lava) {
      if (l.role !== 'pool') continue;
      poolTops.push({
        x: l.center.x,
        topY: l.center.y + l.halfExtents.y,
        z: l.center.z,
        hx: l.halfExtents.x,
        hz: l.halfExtents.z,
      });
    }
    let poolIndex = 0;
    for (const l of lava) {
      const w = l.halfExtents.x * 2;
      const h = l.halfExtents.y * 2;
      const d = l.halfExtents.z * 2;
      if (l.role === 'pool') {
        // Deep body: fills the lethal box (dark crust read at the edges).
        const body = new THREE.Mesh(unitBox, deep);
        body.scale.set(w, h, d);
        body.position.set(l.center.x, l.center.y, l.center.z);
        this.group.add(body);
        // Molten surface: thin bright slab at the lethal top, inset
        // slightly so the dark body rims it like cooling crust.
        const topY = l.center.y + l.halfExtents.y;
        const surface = new THREE.Mesh(unitBox, core);
        surface.scale.set(Math.max(0.1, w - 0.3), 0.1, Math.max(0.1, d - 0.3));
        surface.position.set(l.center.x, topY + 0.051, l.center.z);
        this.group.add(surface);
        // M8.2 crust plates: dark cooling chunks floating on the bright
        // surface (fixed pattern from the pool index — deterministic).
        // Bright cracks stay visible between them: no flat orange slab.
        // M8.4: on flow-hinted pools the plates RIDE the current
        // (conveyor + wrap at the pour zone); elsewhere ambient bob.
        const pi = poolIndex++;
        const flow = l.flow;
        const conv = flow !== undefined && (flow.x !== 0 || flow.z !== 0)
          ? flowStart(l.center.x, l.center.z, Math.max(0.6, w - 0.3), Math.max(0.6, d - 0.3), flow.x, flow.z)
          : null;
        for (let c = 0; c < 3; c++) {
          const plate = new THREE.Mesh(unitBox, deep);
          const fx = [-0.28, 0.1, 0.34][c] as number;
          const fz = c % 2 === 0 ? -0.2 : 0.22;
          plate.scale.set(Math.max(0.1, w * 0.2), 0.06, Math.max(0.1, d * 0.3));
          plate.position.set(
            l.center.x + fx * w + (pi % 2 === 0 ? 0.1 : -0.1),
            topY + 0.13,
            l.center.z + fz * d,
          );
          this.group.add(plate);
          // M8.3 convection: plates drift + bob on the bright surface.
          // M8.4 conveyor bases are the BUILD pose; (prog - phase) is the
          // delta from build, so t = 0 resumes exactly and wrap recycles.
          this.lavaAnim.push({
            mesh: plate, kind: conv !== null ? 'crustFlow' : 'crust',
            baseX: plate.position.x,
            baseY: plate.position.y,
            baseZ: plate.position.z,
            baseSX: plate.scale.x, baseSY: plate.scale.y, baseSZ: plate.scale.z,
            slot: c, phase: conv !== null
              ? flowPhase(plate.position.x, plate.position.z, conv)
              : pi * 2.1 + c * 1.3,
            dirX: conv !== null ? conv.dx : 0, dirZ: conv !== null ? conv.dz : 0,
            travel: conv !== null ? conv.travel : 0,
          });
        }
        if (conv !== null) {
          // M8.4 traveling flow cores: small near-white-hot blocks riding
          // the surface from the pour zone to the lip (the visible
          // current). Spaced thirds; t = 0 resumes the build pose.
          const cross = Math.abs(conv.dz) * w + Math.abs(conv.dx) * d;
          for (let c = 0; c < 3; c++) {
            const block = new THREE.Mesh(unitBox, flowCore);
            block.scale.set(
              Math.abs(conv.dx) * 0.5 + Math.abs(conv.dz) * Math.max(0.2, cross * 0.55),
              0.1,
              Math.abs(conv.dz) * 0.5 + Math.abs(conv.dx) * Math.max(0.2, cross * 0.55),
            );
            const prog = (c + 0.5) / 3;
            block.position.set(
              conv.x + prog * conv.travel * conv.dx,
              topY + 0.08,
              conv.z + prog * conv.travel * conv.dz,
            );
            this.group.add(block);
            this.lavaAnim.push({
              mesh: block, kind: 'core',
              baseX: block.position.x, baseY: block.position.y, baseZ: block.position.z,
              baseSX: block.scale.x, baseSY: block.scale.y, baseSZ: block.scale.z,
              slot: c, phase: prog,
              dirX: conv.dx, dirZ: conv.dz, travel: conv.travel,
            });
          }
        }
        continue;
      }
      if (l.role === 'fall') {
        // M8.2 viscous steps: four stacked blocks with alternating
        // widths and sideways offsets (blocky zigzag pour), bright at
        // the vent (top) grading to crusted deep at the basin (bottom).
        const segs = 4;
        for (let i = 0; i < segs; i++) {
          const seg = new THREE.Mesh(unitBox, i < 2 ? core : deep);
          const wide = i % 2 === 1;
          const segH = h / segs;
          seg.scale.set(w * (wide ? 0.74 : 0.58), segH + 0.02, d * (wide ? 0.74 : 0.58));
          seg.position.set(
            l.center.x + (i % 2 === 0 ? 1 : -1) * w * 0.07,
            l.center.y + l.halfExtents.y - segH * (i + 0.5),
            l.center.z + (i % 2 === 0 ? -1 : 1) * d * 0.07,
          );
          this.group.add(seg);
          // M8.3 descent: segments fatten in sequence top -> bottom.
          this.lavaAnim.push({
            mesh: seg, kind: 'fall',
            baseX: seg.position.x, baseY: seg.position.y, baseZ: seg.position.z,
            baseSX: seg.scale.x, baseSY: seg.scale.y, baseSZ: seg.scale.z,
            slot: i, phase: l.center.z * 0.35 + l.center.x * 0.21,
            dirX: 0, dirZ: 0, travel: 0,
          });
        }
        // Impact splash: bright spread disc where the stream meets its
        // pool surface (skipped for void-continuing falls — no pool).
        const bottomY = l.center.y - l.halfExtents.y;
        const pool = poolTops.find(
          (p) =>
            Math.abs(p.topY - bottomY) < 0.9 &&
            Math.abs(l.center.x - p.x) <= p.hx &&
            Math.abs(l.center.z - p.z) <= p.hz,
        );
        if (pool !== undefined) {
          const splash = new THREE.Mesh(unitBox, core);
          splash.scale.set(Math.max(0.2, w * 1.15), 0.08, Math.max(0.2, d * 1.15));
          splash.position.set(l.center.x, pool.topY + 0.12, l.center.z);
          this.group.add(splash);
          // M8.3 impact breathing (fed by the descending pulse above).
          this.lavaAnim.push({
            mesh: splash, kind: 'splash',
            baseX: splash.position.x, baseY: splash.position.y, baseZ: splash.position.z,
            baseSX: splash.scale.x, baseSY: splash.scale.y, baseSZ: splash.scale.z,
            slot: 0, phase: l.center.z * 0.35,
            dirX: 0, dirZ: 0, travel: 0,
          });
        }
        if (pulseFallIds.has(l.id)) {
          // M8.4 pour pulse: a hot blocky chunk descending the fall
          // (the visible downward current). Wraps at the pour zone
          // above and inside the catch below — both masked by motion.
          const pulse = new THREE.Mesh(unitBox, flowCore);
          const topY = l.center.y + l.halfExtents.y;
          pulse.scale.set(Math.min(0.55, w * 0.6), 0.5, Math.min(0.55, d * 0.6));
          pulse.position.set(l.center.x, topY - 0.25, l.center.z);
          this.group.add(pulse);
          this.lavaAnim.push({
            mesh: pulse, kind: 'pulse',
            baseX: pulse.position.x, baseY: pulse.position.y, baseZ: pulse.position.z,
            baseSX: pulse.scale.x, baseSY: pulse.scale.y, baseSZ: pulse.scale.z,
            slot: 0, phase: 0,
            dirX: 0, dirZ: 0, travel: Math.max(0.5, h - 0.3),
          });
          // Spill lip: where a hinted pool pours over the edge into this
          // fall, a hot lip slab bridges the joint (breathing catch).
          const feeder = flowPools.find((p) => lavaFeedsFallTop(l, p));
          if (feeder !== undefined) {
            const lipY = feeder.center.y + feeder.halfExtents.y;
            const lip = new THREE.Mesh(unitBox, flowCore);
            lip.scale.set(Math.max(0.2, w * 1.35), 0.08, Math.max(0.2, d * 1.35));
            lip.position.set(l.center.x, lipY + 0.12, l.center.z);
            this.group.add(lip);
            this.lavaAnim.push({
              mesh: lip, kind: 'splash',
              baseX: lip.position.x, baseY: lip.position.y, baseZ: lip.position.z,
              baseSX: lip.scale.x, baseSY: lip.scale.y, baseSZ: lip.scale.z,
              slot: 0, phase: l.center.z * 0.35,
              dirX: 0, dirZ: 0, travel: 0,
            });
          }
        }
        continue;
      }
      // Source: rock collar block with a glowing mouth on its lower face.
      // M8.4: wider mouth + thicker drip (vents must read at 20 u chase
      // distance); flow-fed vents stack a rock chimney above the collar.
      const collar = new THREE.Mesh(unitBox, rock);
      collar.scale.set(w, h, d);
      collar.position.set(l.center.x, l.center.y, l.center.z);
      this.group.add(collar);
      const mouthY = l.center.y - l.halfExtents.y - 0.01;
      const mouth = new THREE.Mesh(unitBox, core);
      mouth.scale.set(Math.max(0.1, w * 0.85), 0.1, Math.max(0.1, d * 0.85));
      mouth.position.set(l.center.x, mouthY, l.center.z);
      this.group.add(mouth);
      // M8.3 vent breathing (the pour source visibly works).
      this.lavaAnim.push({
        mesh: mouth, kind: 'mouth',
        baseX: mouth.position.x, baseY: mouth.position.y, baseZ: mouth.position.z,
        baseSX: mouth.scale.x, baseSY: mouth.scale.y, baseSZ: mouth.scale.z,
        slot: 0, phase: l.center.x * 0.53 + l.center.z * 0.29,
        dirX: 0, dirZ: 0, travel: 0,
      });
      // M8.2 vent drip: a short bright lip joining the mouth to the fed
      // fall below (one continuous pour instead of vent + separate jet).
      const fedFall = lava.find(
        (o) =>
          o.role === 'fall' &&
          l.center.x >= o.center.x - o.halfExtents.x &&
          l.center.x <= o.center.x + o.halfExtents.x &&
          l.center.z >= o.center.z - o.halfExtents.z &&
          l.center.z <= o.center.z + o.halfExtents.z &&
          mouthY - (o.center.y + o.halfExtents.y) >= -0.3 &&
          mouthY - (o.center.y + o.halfExtents.y) <= 1.2,
      );
      if (fedFall !== undefined) {
        const drip = new THREE.Mesh(unitBox, core);
        drip.scale.set(0.44, 0.7, 0.44);
        drip.position.set(l.center.x, mouthY - 0.2, l.center.z);
        this.group.add(drip);
        // M8.3 pour stretch (joins the mouth to the falling pulse).
        this.lavaAnim.push({
          mesh: drip, kind: 'drip',
          baseX: drip.position.x, baseY: drip.position.y, baseZ: drip.position.z,
          baseSX: drip.scale.x, baseSY: drip.scale.y, baseSZ: drip.scale.z,
          slot: 0, phase: l.center.x * 0.53 + l.center.z * 0.29,
          dirX: 0, dirZ: 0, travel: 0,
        });
        if (pulseFallIds.has(fedFall.id)) {
          // Flow-fed vent: a rock chimney stacks the collar (the source
          // works harder where the river runs — static, shared rock).
          const chimney = new THREE.Mesh(unitBox, rock);
          chimney.scale.set(w * 0.85, h * 0.7, d * 0.85);
          chimney.position.set(l.center.x, l.center.y + h * 0.85, l.center.z);
          this.group.add(chimney);
        }
      }
    }
  }

  /**
   * M7.2 presentation setpieces (monster-like, NO gameplay) + M7.3 lava:
   * static silhouettes built from level data with shared library
   * meshes/materials only — zero new materials, zero new geometries.
   * No collision, no AI, no movement, no trigger: the simulation never
   * reads them. Setpieces live outside the route corridor (or below it
   * for lava) so they can never read as landable geometry.
   *
   * - `guardian`: dark creature body with glowing eyes (M7.2), now with a
   *   M7.3 chain-chomp read — an open jaw with a tooth crown and heavy
   *   chain links trailing off into the dark, all from shared geometries.
   * - `lava` (M7.3): a glowing hazard-orange basin surface with a darker
   *   crust frame — void-danger dressing under gaps and beside furnaces.
   */
  private buildSetpieces(level: LoadedLevel): void {
    const setpieces = level.def.visualSetpieces ?? [];
    if (setpieces.length === 0) return;
    const unitBox = this.library.unitBox;
    const sphere = this.library.orbSphere;
    for (const piece of setpieces) {
      if (piece.kind === 'lava') {
        // Molten surface: hazard-orange glow slab + a darker crust rim
        // slightly larger beneath it (route body material, shared).
        const crust = new THREE.Mesh(unitBox, this.library.routeBody);
        crust.scale.set(piece.halfExtents.x * 2 + 0.6, 0.3, piece.halfExtents.z * 2 + 0.6);
        crust.position.set(piece.center.x, piece.center.y - 0.2, piece.center.z);
        this.group.add(crust);
        const surface = new THREE.Mesh(unitBox, this.library.hazard);
        surface.scale.set(piece.halfExtents.x * 2, 0.12, piece.halfExtents.z * 2);
        surface.position.set(piece.center.x, piece.center.y, piece.center.z);
        this.group.add(surface);
        continue;
      }
      // Only 'guardian' otherwise (the kind field reserves the vocabulary
      // for future setpieces without changing the renderer).
      const body = new THREE.Mesh(unitBox, this.library.routeBody);
      body.scale.set(piece.halfExtents.x * 2, piece.halfExtents.y * 2, piece.halfExtents.z * 2);
      body.position.set(piece.center.x, piece.center.y, piece.center.z);
      this.group.add(body);
      // Open jaw: a second dark slab below the front, jutting toward the
      // corridor so the mouth reads open around the teleport entry.
      const jaw = new THREE.Mesh(unitBox, this.library.routeBody);
      jaw.scale.set(piece.halfExtents.x * 1.2, piece.halfExtents.y * 0.28, piece.halfExtents.z * 1.1);
      jaw.position.set(
        piece.center.x,
        piece.center.y - piece.halfExtents.y * 0.75,
        piece.center.z - piece.halfExtents.z * 0.4,
      );
      this.group.add(jaw);
      // Tooth crown along the jaw front (shared chevron geometry, warm
      // hazard material — the bite read).
      const teeth = 6;
      for (let i = 0; i < teeth; i++) {
        const tooth = new THREE.Mesh(this.library.chevron, this.library.hazard);
        tooth.scale.setScalar(0.8);
        tooth.position.set(
          piece.center.x - piece.halfExtents.x * 0.5 + (i / (teeth - 1)) * piece.halfExtents.x,
          piece.center.y - piece.halfExtents.y * 0.55,
          piece.center.z - piece.halfExtents.z * 0.95,
        );
        this.group.add(tooth);
      }
      // Two glowing eyes on the corridor-facing side, derived from the
      // silhouette extents (no extra data fields): symmetrically offset,
      // riding proud of the front face so they read at distance.
      const eyeR = Math.min(piece.halfExtents.x, piece.halfExtents.y) * 0.22;
      const frontZ = piece.center.z - piece.halfExtents.z - 0.2;
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(sphere, this.library.hazard);
        eye.scale.setScalar(Math.max(0.4, eyeR / 0.42));
        eye.position.set(
          piece.center.x + sx * piece.halfExtents.x * 0.35,
          piece.center.y + piece.halfExtents.y * 0.3,
          frontZ,
        );
        this.group.add(eye);
      }
      // Chain: heavy dark links trailing from the body into the dark
      // (shared halo geometry, route body material) — the chain-chomp
      // anchor. Count derives from the silhouette size; capped small.
      const links = Math.min(5, 2 + Math.floor(piece.halfExtents.x / 3));
      for (let i = 0; i < links; i++) {
        const link = new THREE.Mesh(this.library.orbHalo, this.library.routeBody);
        link.scale.setScalar(2.2);
        link.position.set(
          piece.center.x + piece.halfExtents.x + 1.2 + i * 1.1,
          piece.center.y + piece.halfExtents.y * 0.5 - i * 0.35,
          piece.center.z + 0.5,
        );
        link.rotation.y = (i % 2 === 0) ? 0 : Math.PI / 2;
        this.group.add(link);
      }
    }
  }

  /**
   * M8.3 QA observability: rounded checksum of the animated lava node
   * transforms (presentation only — proves the flow actually advances
   * in-page and freezes on pause). Empty string when no lava animates.
   */
  public sampleLavaMotion(): string {
    if (this.lavaAnim.length === 0) return '';
    let hash = 0;
    for (let i = 0; i < this.lavaAnim.length; i++) {
      const n = this.lavaAnim[i];
      if (n === undefined) continue;
      const p = n.mesh.position;
      const s = n.mesh.scale;
      const parts = [p.x, p.y, s.x, s.y, s.z];
      for (let k = 0; k < parts.length; k++) {
        const q = Math.round((parts[k] as number) * 1000);
        hash = (hash * 31 + q) | 0;
      }
    }
    return `${this.lavaAnim.length}:${(hash >>> 0).toString(16)}`;
  }

  /**
   * M8.3 lava motion (+ M8.4 conveyors): convect the crust plates,
   * descend a width pulse down each fall, breathe the splash/drip/mouth —
   * and ride the directed current on hinted pools (traveling cores,
   * current-borne crust, descending pour pulses). Viscous blocky flow
   * with zero simulation and zero per-frame allocation (in-place
   * position/scale retunes from build-time bases). Render-dt driven so
   * pause freezes the flow with everything else; dt = 0 is a no-op.
   */
  public updateLava(renderDtSeconds: number): void {
    if (renderDtSeconds <= 0 || this.lavaAnim.length === 0) return;
    this.lavaTime += renderDtSeconds;
    const t = this.lavaTime;
    for (let i = 0; i < this.lavaAnim.length; i++) {
      const n = this.lavaAnim[i];
      if (n === undefined) continue;
      switch (n.kind) {
        case 'crust': {
          // Slow convection drift + bob (never leaves the bright surface).
          // M8.4: t = 0 resumes the build pose (no first-frame pop).
          n.mesh.position.x = n.baseX + 0.12 * (Math.sin(t * 0.9 + n.phase) - Math.sin(n.phase));
          n.mesh.position.y = n.baseY + 0.03 * (Math.sin(t * 1.7 + n.phase * 1.6) - Math.sin(n.phase * 1.6));
          break;
        }
        case 'fall': {
          // A fattening wave travels top -> bottom (dense descent).
          // M8.4: oscillates around the build pose (t = 0 continuous).
          const s = 1 + 0.13 * (Math.sin(t * 4.2 - n.slot * 1.1 + n.phase) - Math.sin(-n.slot * 1.1 + n.phase));
          n.mesh.scale.x = n.baseSX * s;
          n.mesh.scale.z = n.baseSZ * s;
          // M8.4: lateral sway resumes the build pose at t = 0.
          n.mesh.position.x =
            n.baseX + 0.05 * (Math.sin(t * 2.1 + n.slot + n.phase) - Math.sin(n.slot + n.phase));
          break;
        }
        case 'splash': {
          // M8.4: breathes around the build pose (t = 0 continuous).
          const s = 1 + 0.16 * (Math.sin(t * 5 + n.phase) - Math.sin(n.phase));
          n.mesh.scale.x = n.baseSX * s;
          n.mesh.scale.z = n.baseSZ * s;
          break;
        }
        case 'drip': {
          n.mesh.scale.y = n.baseSY * (1 + 0.2 * (Math.sin(t * 3.4 + n.phase) - Math.sin(n.phase)));
          break;
        }
        case 'mouth': {
          const s = 1 + 0.1 * (Math.sin(t * 3.4 + n.phase) - Math.sin(n.phase));
          n.mesh.scale.x = n.baseSX * s;
          n.mesh.scale.z = n.baseSZ * s;
          break;
        }
        case 'core': {
          // The visible current: rigid blocky travel, pour zone -> lip.
          // Viscous pace (0.55 u/s); phases space thirds at build.
          // Delta-from-build form: t = 0 is the build pose, wrap recycles.
          const prog = (((t * 0.55) / n.travel + n.phase) % 1 + 1) % 1;
          const delta = (prog - n.phase) * n.travel;
          n.mesh.position.x = n.baseX + delta * n.dirX;
          n.mesh.position.z = n.baseZ + delta * n.dirZ;
          break;
        }
        case 'crustFlow': {
          // Crust rides the same current SLOWER (viscous shear against
          // the bright flow) with a faint bob; wraps under the pour.
          const prog = (((t * 0.32) / n.travel + n.phase) % 1 + 1) % 1;
          const delta = (prog - n.phase) * n.travel;
          n.mesh.position.x = n.baseX + delta * n.dirX;
          n.mesh.position.z = n.baseZ + delta * n.dirZ;
          n.mesh.position.y = n.baseY + 0.02 * (Math.sin(t * 1.7 + n.phase * 6.28) - Math.sin(n.phase * 6.28));
          break;
        }
        case 'pulse': {
          // A hot chunk descending the fall (one traverse ~2.5 s — dense,
          // never frantic); fattens mid-fall like a surging pour.
          const prog = (((t / 2.5) + n.phase) % 1 + 1) % 1;
          n.mesh.position.y = n.baseY - prog * n.travel;
          const s = 1 + 0.25 * Math.sin(prog * Math.PI);
          n.mesh.scale.x = n.baseSX * s;
          n.mesh.scale.z = n.baseSZ * s;
          break;
        }
      }
    }
  }

  public dispose(): void {
    // Meshes only — materials/geometries belong to the MaterialLibrary.
    this.group.clear();
    this.lavaAnim.length = 0;
  }
}
