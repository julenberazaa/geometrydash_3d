import { Game } from './game/Game';
import type { GravityMode, PlayerMode } from './player/playerState';
import { resolveLevel } from './content/levelRegistry';
import { parseReplay } from './replay/replayFormat';

/**
 * Entry point. Owns the canvas container and the Game lifecycle.
 * No gameplay logic here.
 *
 * Level selection is data-driven through the level registry:
 * `?level=<id>` (e.g. `?level=validation-02`). A missing id plays the
 * default level; an unknown id falls back explicitly with a logged reason
 * and a HUD notice — content is never silently substituted.
 */
const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container missing from DOM');
}

const gameParams = new URLSearchParams(window.location.search);
const requestedLevelId = gameParams.get('level');
const resolution = resolveLevel(requestedLevelId);

// M6A post fallback: `?post=off` forces the direct-render path (same scene,
// no composer passes) — the game stays fully playable without post.
const postParam = gameParams.get('post');
// M6B FX fallback: `?fx=off` disables the motion-juice layer only (trail,
// bursts, streaks) — same scene, same gameplay, M6A foundation intact.
const fxParam = gameParams.get('fx');
// M6C1 trigger fallback: `?triggers=off` resolves the scene to the exact
// M6A+M6B baseline (no section state) — same scene, same gameplay.
const triggersParam = gameParams.get('triggers');
// M6D perf profiler: `?perf=1` enables the DEBUG frame profiler (bounded
// ring buffer, off by default, zero gameplay effect).
const perfParam = gameParams.get('perf');
const game = new Game(container, resolution.level, {
  postEnabled: postParam === null ? undefined : postParam !== 'off',
  fxEnabled: fxParam === null ? undefined : fxParam !== 'off',
  triggersEnabled: triggersParam === null ? undefined : triggersParam !== 'off',
}, {
  perfEnabled: perfParam === '1',
});
game.start();

if (!resolution.ok) {
  // Explicit fallback: visible in the console AND the HUD so QA screenshots
  // capture it (a silent substitution would hide content bugs).
  console.warn(`[level] ${resolution.reason ?? 'unknown level requested'}`);
}

// Expose for QA harnesses (evidence-capture sidecars read plain data from this).
declare global {
  interface Window {
    __gd3d?: {
      status: () => string;
      progress: () => number;
      attempts: () => number;
      jumps: () => number;
      grounded: () => boolean;
      laneIndex: () => number;
      playerPosition: () => { x: number; y: number; z: number };
      gravityMode: () => GravityMode;
      playerMode: () => PlayerMode;
      modeTransitionCount: () => number;
      chompers: () => { phase: string; x: number; y: number; z: number; aimX: number }[];
      lastPortalId: () => string | null;
      portalTransitionCount: () => number;
      speedMultiplier: () => number;
      currentForwardSpeed: () => number;
      interactionCounts: () => {
        pads: number;
        orbs: number;
        speedPortals: number;
        events: number;
      };
      lastInteraction: () => { kind: string; id: string } | null;
      isInteractionUsed: (id: string) => boolean;
      interactionRingsActive: () => number;
      supportId: () => string | null;
      cameraUpY: () => number;
      cameraEye: () => { x: number; y: number; z: number };
      cameraLook: () => { x: number; y: number; z: number };
      screenPoint: (x: number, y: number, z: number) => {
        ndcX: number; ndcY: number; px: number; py: number; behind: boolean;
      };
      debugTeleport: (x: number, y: number, z: number) => void;
      deathCause: () => string | null;
      /** QA-only: the sim pause flag (explicit pause-sync for staging). */
      paused: () => boolean;
      lethalInfo: () => {
        colliderId: string | null;
        normal: { x: number; y: number; z: number };
        preVel: { x: number; y: number; z: number };
      };
      rendererStats: () => { calls: number; triangles: number };
      sceneChildren: () => number;
      // M6A visual-foundation observability (presentation only).
      materialCount: () => number;
      geometryCount: () => number;
      postEnabled: () => boolean;
      postPassCount: () => number;
      bloomParams: () => { strength: number; radius: number; threshold: number } | null;
      setPostEnabled: (enabled: boolean) => void;
      // M6B motion-juice observability (presentation only).
      fxEnabled: () => boolean;
      setFxEnabled: (enabled: boolean) => void;
      activeParticles: () => number;
      trailSamples: () => number;
      activeStreaks: () => number;
      fxCounters: () => { jump: number; landing: number; gravity: number; speed: number; pad: number; jumpOrb: number; gravityOrb: number; teleport: number };
      teleportEventCount: () => number;
      lastTeleportId: () => string | null;
      lastLandingIntensity: () => number;
      fxResets: () => number;
      burstActive: () => boolean;
      /** QA-only: Spider-swap camera glides armed (M8.2 smoothing proof). */
      swapGlideCount: () => number;
      /** QA-only: lava-motion checksum (M8.3 flow proof). */
      lavaMotion: () => string;
      // M6C1 visual-trigger observability (presentation only).
      visualSectionId: () => string;
      visualSectionProgress: () => number;
      visualTriggersEnabled: () => boolean;
      setVisualTriggersEnabled: (enabled: boolean) => void;
      visualExposure: () => number;
      visualVfxIntensity: () => number;
      visualBackground: () => number;
      visualFogColor: () => number;
      visualRouteAccent: () => number;
      visualPlayerColor: () => number;
      visualHazardColor: () => number;
      // M7.1 beat-ready cue observability (presentation only).
      rhythmCue: () => string | null;
      energyRays: () => number;
      // M6D performance observability (presentation only).
      perfEnabled: () => boolean;
      perfSnapshot: () => {
        frames: number; fps: number; p50: number; p95: number; p99: number;
        max: number; over25: number; over33: number; over50: number; capacity: number;
      };
      perfBeginSampling: () => void;
      gpuIdentity: () => {
        version: string; vendor: string; renderer: string;
        devicePixelRatio: number; renderPixelRatio: number;
      };
      // M6C2 reactive-visual observability (presentation only).
      eventPunchEnergy: () => number;
      eventPunchColor: () => number;
      visualLiveBackground: () => number;
      visualLiveFog: () => number;
      contactSamples: () => number;
      debugFreezeFrame: (frozen: boolean) => void;
      debugReplayBurst: () => void;
      toggleDebug: () => void;
      // M5 replay observability (read-only unless noted).
      levelId: () => string;
      levelDisplayName: () => string;
      hasReplay: () => boolean;
      replayMode: () => 'live' | 'replay';
      replayTick: () => number;
      replayFrameCount: () => number | null;
      replayVerification: () => { kind: string; tick?: number; reason?: string };
      replayLevelId: () => string | null;
      replayLevelFingerprint: () => string;
      replayBadge: () => string | null;
      replayLastHash: () => string | null;
      startReplay: () => boolean;
      exportLastReplay: () => string | null;
      /** QA-only: parse + start an arbitrary serialized tape (cross-level rejection proof). */
      debugStartReplayJson: (json: string) => { ok: boolean; reason?: string };
    };
  }
}

window.__gd3d = {
  status: () => game['simulation'].status,
  progress: () => game['simulation'].progress,
  attempts: () => game['simulation'].attempts,
  jumps: () => game.totalJumps,
  grounded: () => game['simulation'].player.grounded,
  laneIndex: () => game['simulation'].player.targetLaneIndex,
  playerPosition: () => ({ ...game['simulation'].player.position }),
  gravityMode: () => game['simulation'].gravityMode,
  playerMode: () => game['simulation'].playerMode,
  modeTransitionCount: () => game['simulation'].modeTransitionCount,
  chompers: () =>
    game['simulation'].chomperStates.map((s) => ({
      phase: s.phase,
      x: s.x,
      y: s.y,
      z: s.z,
      aimX: s.aimX,
    })),
  lastPortalId: () => game['simulation'].lastPortalId,
  portalTransitionCount: () => game['simulation'].portalTransitionCount,
  speedMultiplier: () => game['simulation'].speedMultiplier,
  currentForwardSpeed: () => game['simulation'].currentForwardSpeed,
  interactionCounts: () => ({
    pads: game['simulation'].padActivationCount,
    orbs: game['simulation'].orbActivationCount,
    speedPortals: game['simulation'].speedPortalCount,
    events: game['simulation'].interactionEventCount,
  }),
  lastInteraction: () => {
    const sim = game['simulation'];
    return sim.hasInteractionEvent ? { kind: sim.lastInteraction.kind, id: sim.lastInteraction.id } : null;
  },
  isInteractionUsed: (id: string): boolean => game['simulation'].isInteractionUsed(id),
  interactionRingsActive: () => game['rendererHost'].interactionRingsActive,
  supportId: () => game['simulation'].player.supportColliderId,
  cameraUpY: () => game['rendererHost'].camera.up.y,
  cameraEye: () => ({ ...game['rendererHost'].chaseCamera.currentPosition }),
  cameraLook: () => ({ ...game['rendererHost'].chaseCamera.currentLookTarget }),
  screenPoint: (x: number, y: number, z: number): { ndcX: number; ndcY: number; px: number; py: number; behind: boolean } =>
    game['rendererHost'].projectToScreen(x, y, z),
  // Debug-only QA placement (see GameSimulation.debugPlaceAt).
  debugTeleport: (x: number, y: number, z: number): void => {
    game['simulation'].debugPlaceAt(x, y, z);
  },
  deathCause: () => game['simulation'].deathCause,
  paused: () => game['paused'],
  lethalInfo: () => ({
    colliderId: game['simulation'].lastLethalColliderId,
    normal: { ...game['simulation'].lastContactNormal },
    preVel: { ...game['simulation'].lastPreImpactVelocity },
  }),
  rendererStats: () => ({ ...game['rendererHost'].stats }),
  sceneChildren: () => game['rendererHost'].sceneChildren,
  // M6A visual-foundation observability (presentation only).
  materialCount: () => game['rendererHost'].materialCount,
  geometryCount: () => game['rendererHost'].geometryCount,
  postEnabled: () => game['rendererHost'].postEnabled,
  postPassCount: () => game['rendererHost'].postPassCount,
  bloomParams: () => game['rendererHost'].bloomParams,
  setPostEnabled: (enabled: boolean): void => {
    game['rendererHost'].setPostEnabled(enabled);
  },
  // M6B probes: toggle + boundedness/counter observability (cold path).
  fxEnabled: () => game['rendererHost'].fxEnabled,
  setFxEnabled: (enabled: boolean): void => {
    game['rendererHost'].setFxEnabled(enabled);
  },
  activeParticles: () => game['rendererHost'].activeParticles,
  trailSamples: () => game['rendererHost'].trailSamples,
  activeStreaks: () => game['rendererHost'].activeStreaks,
  fxCounters: () => ({ ...game['rendererHost'].fxCounters }),
  // M7.2 teleport observability (presentation only).
  teleportEventCount: () => game['simulation'].teleportEventCount,
  lastTeleportId: () => game['simulation'].lastTeleportId,
  lastLandingIntensity: () => game['rendererHost'].lastLandingIntensity,
  fxResets: () => game['rendererHost'].fxResets,
  burstActive: () => game['rendererHost'].deathBurstActive,
  swapGlideCount: () => game['rendererHost'].swapGlideCount,
  lavaMotion: () => game['rendererHost'].lavaMotionSample,
  // M6C1 probes: trigger state + resolved presentation (cold path).
  visualSectionId: () => game['rendererHost'].visualSectionId,
  visualSectionProgress: () => game['rendererHost'].visualSectionProgress,
  visualTriggersEnabled: () => game['rendererHost'].visualTriggersEnabled,
  setVisualTriggersEnabled: (enabled: boolean): void => {
    game['rendererHost'].setVisualTriggersEnabled(enabled);
  },
  visualExposure: () => game['rendererHost'].visualExposure,
  visualVfxIntensity: () => game['rendererHost'].visualVfxIntensity,
  visualBackground: () => game['rendererHost'].visualBackground,
  visualFogColor: () => game['rendererHost'].visualFogColor,
  visualRouteAccent: () => game['rendererHost'].visualRouteAccent,
  visualPlayerColor: () => game['rendererHost'].visualPlayerColor,
  visualHazardColor: () => game['rendererHost'].visualHazardColor,
  // M7.1 beat-ready cue id at the current forward position (cold path).
  rhythmCue: () => game['rendererHost'].rhythmCueId,
  // M7.1 background energy-ray opacity (cold path).
  energyRays: () => game['rendererHost'].energyRayOpacity,
  // M6D probes: bounded profiler + real-GPU identity (cold path).
  perfEnabled: () => game.isPerfEnabled,
  perfSnapshot: () => ({ ...game.perfSnapshot() }),
  perfBeginSampling: (): void => {
    game.perfBeginSampling();
  },
  gpuIdentity: () => ({ ...game['rendererHost'].gpuIdentity() }),
  // M6C2 probes: punch envelope + dominant tint + contact skid (cold path).
  eventPunchEnergy: () => game['rendererHost'].eventPunchEnergy,
  eventPunchColor: () => game['rendererHost'].eventPunchColor,
  visualLiveBackground: () => game['rendererHost'].visualLiveBackground,
  visualLiveFog: () => game['rendererHost'].visualLiveFog,
  contactSamples: () => game['rendererHost'].contactSamples,
  // Debug-only freeze for burst photography (see RendererHost.debugFreezeFrame).
  debugFreezeFrame: (frozen: boolean): void => {
    game['rendererHost'].debugFreezeFrame = frozen;
  },
  // Debug-only burst replay at the recorded death position (see RendererHost).
  debugReplayBurst: (): void => {
    game['rendererHost'].debugReplayBurst();
  },
  toggleDebug: () => {
    /* toggled via F1/F2/F3 keyboard events */
  },
  // M5 replay probes. startReplay() replays the last completed attempt
  // (same path as the F4 key); it never touches private sim state.
  levelId: () => game.gameSimulation.level.def.id,
  levelDisplayName: () => game.gameSimulation.level.def.displayName,
  hasReplay: () => game.replayCoordinator.lastReplay !== null,
  replayMode: () => game.replayCoordinator.mode,
  replayTick: () => game.replayCoordinator.replayTick,
  replayFrameCount: () => game.replayCoordinator.replayFrameCount ?? game.replayCoordinator.lastReplay?.frameCount ?? null,
  replayVerification: () => {
    const v = game.replayCoordinator.verification;
    if (v.kind === 'diverged') return { kind: v.kind, tick: v.tick };
    if (v.kind === 'rejected') return { kind: v.kind, reason: v.reason };
    return { kind: v.kind };
  },
  replayLevelId: () => game.replayCoordinator.lastReplay?.levelId ?? null,
  replayLevelFingerprint: () => game.replayCoordinator.levelFingerprint,
  replayBadge: () => game.replayCoordinator.hudBadge,
  replayLastHash: () => game.replayCoordinator.lastStateHash,
  startReplay: (): boolean => {
    const last = game.replayCoordinator.lastReplay;
    if (last === null) return false;
    return game.replayCoordinator.startReplay(last).ok;
  },
  exportLastReplay: () => game.replayCoordinator.exportLastReplay(),
  debugStartReplayJson: (json: string): { ok: boolean; reason?: string } => {
    const parsed = parseReplay(json);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    const started = game.replayCoordinator.startReplay(parsed.replay);
    return started.ok ? { ok: true } : { ok: false, reason: started.reason };
  },
};

// Hot Module Acceptance for Vite dev server.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}
