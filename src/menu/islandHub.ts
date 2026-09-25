import * as THREE from 'three';

/**
 * IslandHub (M9.6) — the 3D level-select hub scene.
 *
 * The menu is no longer a flat web page: two animated islands float in the
 * game's visual language (dark void, neon accents, lava warmth) with a
 * visible travel connection between them. THE DESCENT (teal, waterfall +
 * pool + floating-rock path) reads clean/adventurous; GRAVITY RIFT
 * (basalt, lava cracks, spike ring, angular skull-abstract) reads
 * dangerous. Five stepping stones arc between the islands with flow pulses
 * traveling toward the SELECTED destination, which also carries the bright
 * beacon + orbit ring while the other island idles dim.
 *
 * Presentation only, zero gameplay state: selection lives in
 * `LevelSelectView` (plain TS); the hub only mirrors it via
 * `setSelected()` and reports island picks via `onPick`. Owned by
 * `AppController` (menu XOR session canvas — never two renderers alive).
 * Bounded scene (~50 draws, no post), own materials/geometries, rAF owned
 * here (start/stop), fully disposed on session start.
 */
export class IslandHub {
  /** Island pick callback (wired to the menu selection by AppController). */
  public onPick: ((levelId: string) => void) | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = { last: 0, time: 0 };
  private rafId = 0;
  private running = false;
  private disposed = false;
  private readonly onResize: () => void;
  private readonly onCanvasClick: (event: MouseEvent) => void;

  private readonly levelIds: readonly [string, string];
  private selected: string;
  /** Per-island animated rig (beacon/ring/flow state). */
  private readonly islands: {
    levelId: string;
    group: THREE.Group;
    beacon: THREE.Mesh;
    beaconMat: THREE.MeshBasicMaterial;
    ring: THREE.Mesh;
    beaconLevel: number;
    baseY: number;
    phase: number;
  }[] = [];
  private readonly stones: THREE.Mesh[] = [];
  private readonly stoneBaseY: number[] = [];
  private flowPos: Float32Array = new Float32Array(0);
  private flowGeo: THREE.BufferGeometry | null = null;
  private flowMat: THREE.PointsMaterial | null = null;
  private motePos: Float32Array = new Float32Array(0);
  private moteGeo: THREE.BufferGeometry | null = null;
  private foamPos: Float32Array = new Float32Array(0);
  private foamGeo: THREE.BufferGeometry | null = null;
  private fallMats: THREE.MeshBasicMaterial[] = [];
  private poolMat: THREE.MeshBasicMaterial | null = null;
  private lavaMats: THREE.MeshBasicMaterial[] = [];
  private yaw = 0;
  private yawTarget = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pickProxies: THREE.Mesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly scratchV = new THREE.Vector2();

  constructor(container: HTMLElement, levelIds: readonly [string, string], initialLevelId: string) {
    this.levelIds = levelIds;
    this.selected = initialLevelId;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'm96-hub-canvas';
    container.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07040f);
    this.scene.fog = new THREE.Fog(0x07040f, 30, 90);
    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      200,
    );
    this.camera.position.set(0, 12, 26);

    const hemi = new THREE.HemisphereLight(0x8fb8dd, 0x0a0616, 0.9);
    const dir = new THREE.DirectionalLight(0xcfe9ff, 1.1);
    dir.position.set(6, 14, 8);
    this.scene.add(hemi, dir);

    this.buildWater();
    this.buildDescentIsland();
    this.buildRiftIsland();
    this.buildStones();
    this.buildMotes();
    this.setSelected(initialLevelId);

    this.onResize = (): void => {
      if (this.disposed) return;
      const w = container.clientWidth;
      const h = Math.max(1, container.clientHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this.onResize);
    this.onCanvasClick = (event: MouseEvent): void => {
      const picked = this.pick(event.clientX, event.clientY);
      if (picked !== null) this.onPick?.(picked);
    };
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
  }

  // --- construction (cold path only) ---

  private track<T extends THREE.BufferGeometry | THREE.Material>(owned: T): T {
    if (owned instanceof THREE.BufferGeometry) this.geometries.push(owned);
    else this.materials.push(owned);
    return owned;
  }

  private box(
    w: number, h: number, d: number,
    mat: THREE.Material, x: number, y: number, z: number,
    parent: THREE.Group,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  private buildWater(): void {
    const mat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x06283a, roughness: 0.35, metalness: 0.6 }),
    );
    const water = new THREE.Mesh(this.track(new THREE.PlaneGeometry(220, 220)), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -2.2;
    this.scene.add(water);
  }

  /** THE DESCENT: teal rock tiers + waterfall + pool + floating-rock path. */
  private buildDescentIsland(): void {
    const group = new THREE.Group();
    group.position.set(-10.5, 1.2, 0);
    group.scale.setScalar(1.3);
    const rock = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1e4049, roughness: 0.9, metalness: 0.15 }),
    );
    const rim = this.track(
      new THREE.MeshBasicMaterial({ color: 0x2dffc4 }),
    );
    // Rock tiers (wide base → grassy top).
    const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(4.4, 5.6, 3.4, 7)), rock);
    base.position.y = -1.2;
    const mid = new THREE.Mesh(this.track(new THREE.CylinderGeometry(3.1, 4.2, 2.6, 7)), rock);
    mid.position.y = 1.8;
    const top = new THREE.Mesh(this.track(new THREE.CylinderGeometry(2.2, 3.0, 2.0, 7)), rock);
    top.position.y = 4.0;
    group.add(base, mid, top);
    // Teal rim glow on the top tier.
    this.box(4.6, 0.12, 0.12, rim, 0, 5.0, 2.1, group);
    this.box(4.6, 0.12, 0.12, rim, 0, 5.0, -2.1, group);
    this.box(0.12, 0.12, 4.2, rim, 2.2, 5.0, 0, group);
    this.box(0.12, 0.12, 4.2, rim, -2.2, 5.0, 0, group);
    // Waterfall: two phase-offset translucent sheets + foam Points at base.
    for (let i = 0; i < 2; i++) {
      const fallMat = this.track(
        new THREE.MeshBasicMaterial({
          color: 0x7df9ff, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      this.fallMats.push(fallMat);
      const sheet = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.4, 5.6)), fallMat);
      sheet.position.set(2.9 + i * 0.5, 1.6, 0.6 - i * 1.1);
      group.add(sheet);
    }
    this.poolMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0x19e6ff, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    const pool = new THREE.Mesh(this.track(new THREE.CircleGeometry(2.0, 24)), this.poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(3.4, -2.05, 0);
    group.add(pool);
    const foamCount = 20;
    this.foamPos = new Float32Array(foamCount * 3);
    for (let i = 0; i < foamCount; i++) {
      this.foamPos[i * 3] = 3.4 + ((i * 37) % 20) / 10 - 1;
      this.foamPos[i * 3 + 1] = -2.0 + ((i * 53) % 10) / 10;
      this.foamPos[i * 3 + 2] = ((i * 71) % 20) / 10 - 1;
    }
    this.foamGeo = this.track(new THREE.BufferGeometry());
    this.foamGeo.setAttribute('position', new THREE.BufferAttribute(this.foamPos, 3));
    const foam = new THREE.Points(
      this.foamGeo,
      this.track(new THREE.PointsMaterial({
        color: 0xbdf3ff, size: 0.14, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })),
    );
    foam.frustumCulled = false;
    group.add(foam);
    // Floating-rock path toward the island (3 bobbing rocks).
    const floatRock = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1a3038, roughness: 0.85, metalness: 0.2 }),
    );
    for (let i = 0; i < 3; i++) {
      const rockMesh = new THREE.Mesh(this.track(new THREE.DodecahedronGeometry(0.55 - i * 0.1)), floatRock);
      rockMesh.position.set(5.4 + i * 1.7, 0.4 + (i % 2) * 0.7, 1.6 - i * 1.2);
      rockMesh.userData['floatPhase'] = i * 1.3;
      group.add(rockMesh);
    }
    this.scene.add(group);
    this.addIslandRig(group, this.levelIds[0], 0x2dffc4, 0);
  }

  /** GRAVITY RIFT: basalt + lava cracks + spike ring + skull-abstract. */
  private buildRiftIsland(): void {
    const group = new THREE.Group();
    group.position.set(10.5, 1.2, 0);
    group.scale.setScalar(1.3);
    const basalt = this.track(
      new THREE.MeshStandardMaterial({ color: 0x2e2028, roughness: 0.95, metalness: 0.1 }),
    );
    const lavaMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff5a00 }));
    this.lavaMats.push(lavaMat);
    const lavaHot = this.track(new THREE.MeshBasicMaterial({ color: 0xffc44f }));
    this.lavaMats.push(lavaHot);
    const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(4.6, 5.8, 3.8, 7)), basalt);
    base.position.y = -1.2;
    const spire = new THREE.Mesh(this.track(new THREE.CylinderGeometry(1.4, 2.6, 5.2, 6)), basalt);
    spire.position.y = 3.0;
    group.add(base, spire);
    // Lava cracks on the base rim.
    this.box(3.4, 0.14, 0.14, lavaMat, 0, 0.75, 3.9, group);
    this.box(0.14, 0.14, 3.2, lavaHot, 3.6, 0.75, 0.4, group);
    this.box(2.2, 0.14, 0.14, lavaMat, -1.2, 0.75, -3.7, group);
    // Spike ring (hazard-orange, game-spike language).
    const spikeMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xff9d00, roughness: 0.5, metalness: 0.3, emissive: 0x903c00 }),
    );
    const spikeGeo = this.track(new THREE.ConeGeometry(0.42, 1.5, 5));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      spike.position.set(Math.cos(a) * 3.6, 1.2, Math.sin(a) * 3.6);
      group.add(spike);
    }
    // Skull-abstract: dark brow + glowing eyes + teeth (original angular
    // construct — menace without licensed geometry).
    const bone = this.track(
      new THREE.MeshStandardMaterial({ color: 0x241a20, roughness: 0.8, metalness: 0.2 }),
    );
    this.box(2.6, 1.1, 0.7, bone, 0, 6.4, 0.2, group);
    const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    this.lavaMats.push(eyeMat);
    this.box(0.55, 0.55, 0.2, eyeMat, -0.65, 6.4, 0.78, group);
    this.box(0.55, 0.55, 0.2, eyeMat, 0.65, 6.4, 0.78, group);
    for (let i = -1; i <= 1; i++) {
      const tooth = new THREE.Mesh(this.track(new THREE.ConeGeometry(0.16, 0.6, 4)), bone);
      tooth.position.set(i * 0.6, 5.6, 0.5);
      tooth.rotation.x = Math.PI;
      group.add(tooth);
    }
    // Lava pool at the base (contained menace, game-lava language).
    const pool = new THREE.Mesh(this.track(new THREE.CircleGeometry(1.6, 20)), lavaMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(-3.2, -2.0, -1.4);
    group.add(pool);
    this.scene.add(group);
    this.addIslandRig(group, this.levelIds[1], 0xb44dff, 2.1);
  }

  /** Selection rig per island: beacon beam + orbit ring + click proxy. */
  private addIslandRig(group: THREE.Group, levelId: string, accent: number, phase: number): void {
    const beaconMat = this.track(
      new THREE.MeshBasicMaterial({
        color: accent, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    const beacon = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.28, 0.5, 11, 8, 1, true)), beaconMat);
    beacon.position.y = 6;
    group.add(beacon);
    const ring = new THREE.Mesh(
      this.track(new THREE.TorusGeometry(5.4, 0.09, 8, 48)),
      this.track(new THREE.MeshBasicMaterial({
        color: accent, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.6;
    group.add(ring);
    const proxy = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(12, 12, 10)),
      this.track(new THREE.MeshBasicMaterial({ visible: false })),
    );
    proxy.position.y = 2;
    proxy.userData['levelId'] = levelId;
    group.add(proxy);
    this.pickProxies.push(proxy);
    this.islands.push({
      levelId, group, beacon, beaconMat, ring, beaconLevel: 0.5, baseY: group.position.y, phase,
    });
  }

  /** Stepping-stone arc between the islands + travel flow pulses. */
  private buildStones(): void {
    const stoneMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.85, metalness: 0.25 }),
    );
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const stone = new THREE.Mesh(this.track(new THREE.DodecahedronGeometry(0.7)), stoneMat);
      const x = -4.6 + t * 9.2;
      const y = -0.7 - Math.sin(t * Math.PI) * 0.5;
      stone.position.set(x, y, 2.6 - Math.sin(t * Math.PI) * 1.4);
      stone.userData['floatPhase'] = t * 2.2;
      this.scene.add(stone);
      this.stones.push(stone);
      this.stoneBaseY.push(y);
    }
    const flowCount = 12;
    this.flowPos = new Float32Array(flowCount * 3);
    this.flowGeo = this.track(new THREE.BufferGeometry());
    this.flowGeo.setAttribute('position', new THREE.BufferAttribute(this.flowPos, 3));
    this.flowMat = this.track(new THREE.PointsMaterial({
      color: 0x7df9ff, size: 0.22, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const flow = new THREE.Points(this.flowGeo, this.flowMat);
    flow.frustumCulled = false;
    this.scene.add(flow);
  }

  private buildMotes(): void {
    const count = 60;
    this.motePos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.motePos[i * 3] = ((i * 137) % 60) - 30;
      this.motePos[i * 3 + 1] = ((i * 89) % 16) - 3;
      this.motePos[i * 3 + 2] = ((i * 53) % 40) - 18;
    }
    this.moteGeo = this.track(new THREE.BufferGeometry());
    this.moteGeo.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3));
    const mat = this.track(new THREE.PointsMaterial({
      color: 0x4f8fb8, size: 0.12, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const motes = new THREE.Points(this.moteGeo, mat);
    motes.frustumCulled = false;
    this.scene.add(motes);
  }

  // --- runtime ---

  public start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.clock.last = performance.now();
    const frame = (now: number): void => {
      if (!this.running || this.disposed) return;
      const dt = Math.min(0.1, Math.max(0, (now - this.clock.last) / 1000));
      this.clock.last = now;
      this.clock.time += dt;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  public stop(): void {
    this.running = false;
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Mirror the menu selection (beacon/ring/camera/flow follow it). */
  public setSelected(levelId: string): void {
    this.selected = levelId;
    const descentFirst = this.levelIds[0] === levelId;
    this.yawTarget = descentFirst ? -0.22 : 0.22;
    for (const island of this.islands) {
      island.beaconLevel = island.levelId === levelId ? 1.0 : 0.28;
    }
    if (this.flowMat !== null) {
      this.flowMat.color.setHex(descentFirst ? 0x2dffc4 : 0xb44dff);
    }
  }

  /** Currently mirrored selection (QA observability). */
  public get selectedLevelId(): string {
    return this.selected;
  }

  /** Selection weight 0..1 per island (QA: the selected pick is obvious). */
  public beaconLevel(levelId: string): number {
    for (const island of this.islands) {
      if (island.levelId === levelId) return island.beaconLevel;
    }
    return -1;
  }

  /** Raycast an island pick (client coords) — null when clicking void. */
  public pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }
    this.scratchV.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.scratchV, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickProxies, false);
    const first = hits[0];
    if (first === undefined) return null;
    const id = (first.object.userData['levelId'] as string | undefined) ?? null;
    return id;
  }

  private update(dt: number): void {
    const t = this.clock.time;
    // Camera: slow drift + eased framing toward the selected island.
    this.yaw += (this.yawTarget + Math.sin(t * 0.12) * 0.06 - this.yaw) * Math.min(1, dt * 1.6);
    this.camera.position.set(Math.sin(this.yaw) * 27, 13.5 + Math.sin(t * 0.2) * 0.5, Math.cos(this.yaw) * 27);
    this.camera.lookAt(0, 3.2, 0);
    // Islands: beacons breathe toward their level; rings orbit the pick.
    for (const island of this.islands) {
      const target = island.beaconLevel * (0.55 + 0.2 * Math.sin(t * 1.7 + island.phase));
      island.beaconMat.opacity += (target - island.beaconMat.opacity) * Math.min(1, dt * 4);
      const picked = island.levelId === this.selected;
      island.ring.visible = picked;
      island.ring.rotation.z += dt * (picked ? 0.5 : 0.1);
      island.group.position.y = island.baseY + Math.sin(t * 0.5 + island.phase) * 0.12;
    }
    // Waterfall sheets alternate opacity (falling read, no textures).
    for (let i = 0; i < this.fallMats.length; i++) {
      const mat = this.fallMats[i];
      if (mat !== undefined) mat.opacity = 0.28 + 0.18 * Math.sin(t * 3.2 + i * Math.PI);
    }
    if (this.poolMat !== null) this.poolMat.opacity = 0.42 + 0.14 * Math.sin(t * 2.1);
    // Foam churn at the waterfall base (wrap in place).
    const foamCount = this.foamPos.length / 3;
    for (let i = 0; i < foamCount; i++) {
      const y = (this.foamPos[i * 3 + 1] ?? -2) + dt * (0.5 + (i % 3) * 0.25);
      this.foamPos[i * 3 + 1] = y > -1.2 ? -2.0 : y;
    }
    if (this.foamGeo !== null) {
      (this.foamGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // Stones bob; flow pulses travel center → selected island.
    for (let i = 0; i < this.stones.length; i++) {
      const stone = this.stones[i];
      const baseY = this.stoneBaseY[i] ?? 0;
      const phase = (stone?.userData['floatPhase'] as number | undefined) ?? 0;
      if (stone !== undefined) {
        stone.position.y = baseY + Math.sin(t * 0.9 + phase) * 0.18;
        stone.rotation.y += dt * 0.15;
      }
    }
    const descentFirst = this.levelIds[0] === this.selected;
    const flowCount = this.flowPos.length / 3;
    for (let i = 0; i < flowCount; i++) {
      const p = (t * 0.14 + i / flowCount) % 1;
      // Toward the selected island: descent = -x side, rift = +x side.
      const dir = descentFirst ? -1 : 1;
      const x = dir * p * 8.5;
      this.flowPos[i * 3] = x;
      this.flowPos[i * 3 + 1] = -0.4 - Math.sin(p * Math.PI) * 0.5 + Math.sin(t * 2 + i) * 0.08;
      this.flowPos[i * 3 + 2] = 2.6 - Math.sin(p * Math.PI) * 1.4;
    }
    if (this.flowGeo !== null) {
      (this.flowGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // Motes rise slowly, wrap in place.
    const moteCount = this.motePos.length / 3;
    for (let i = 0; i < moteCount; i++) {
      const y = (this.motePos[i * 3 + 1] ?? 0) + dt * 0.25;
      this.motePos[i * 3 + 1] = y > 13 ? -3 : y;
    }
    if (this.moteGeo !== null) {
      (this.moteGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
    this.renderer.domElement.remove();
    this.renderer.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.scene.clear();
  }
}
