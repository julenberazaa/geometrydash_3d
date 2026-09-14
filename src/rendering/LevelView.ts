import * as THREE from 'three';
import type { LoadedLevel } from '../level/levelRuntime';
import type { MaterialLibrary } from './MaterialLibrary';
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
 * Level view: builds Three.js representations from level data.
 * Shared library geometries + shared library materials (M6A material
 * ownership: this view creates Meshes only — never materials/geometries).
 * Colliders remain the gameplay truth; these meshes are visuals only.
 */
export class LevelView {
  public readonly group: THREE.Group;

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
   * M8A authored lava (gameplay-lethal volumes with sourced visuals).
   *
   * Every volume renders from its role — never a floating slab:
   * - `pool`: a bright molten surface slab riding at the lethal box top +
   *   a darker deep body filling the box below it (the basin solids in
   *   level data visibly contain it; see `validateLavaAuthoring`).
   * - `fall`: a dense blocky core column plus a short stack of wider
   *   stepped rings (authored dense-flow read, zero simulation).
   * - `source`: a dark rock collar (route body) with a glowing molten
   *   mouth inset, attached to the neighboring solid geometry.
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
    const rock = this.library.routeBody;
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
        continue;
      }
      if (l.role === 'fall') {
        // Dense core column (60% footprint) + stepped flow rings: three
        // wider collars spaced along the drop, each overhanging the core
        // so the stream reads as thick blocky liquid, not a laser.
        const coreMesh = new THREE.Mesh(unitBox, core);
        coreMesh.scale.set(w * 0.6, h, d * 0.6);
        coreMesh.position.set(l.center.x, l.center.y, l.center.z);
        this.group.add(coreMesh);
        const steps = 3;
        for (let i = 0; i < steps; i++) {
          const t = (i + 0.5) / steps;
          const ring = new THREE.Mesh(unitBox, i % 2 === 0 ? deep : core);
          ring.scale.set(w * 0.92, Math.max(0.12, h * 0.1), d * 0.92);
          ring.position.set(
            l.center.x,
            l.center.y + l.halfExtents.y - t * h,
            l.center.z,
          );
          this.group.add(ring);
        }
        continue;
      }
      // Source: rock collar block with a glowing mouth on its lower face.
      const collar = new THREE.Mesh(unitBox, rock);
      collar.scale.set(w, h, d);
      collar.position.set(l.center.x, l.center.y, l.center.z);
      this.group.add(collar);
      const mouth = new THREE.Mesh(unitBox, core);
      mouth.scale.set(Math.max(0.1, w * 0.7), 0.08, Math.max(0.1, d * 0.7));
      mouth.position.set(l.center.x, l.center.y - l.halfExtents.y - 0.01, l.center.z);
      this.group.add(mouth);
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

  public dispose(): void {
    // Meshes only — materials/geometries belong to the MaterialLibrary.
    this.group.clear();
  }
}
