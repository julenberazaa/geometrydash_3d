import type { Game } from '../game/Game';
import type { GravityMode, PlayerMode } from '../player/playerState';
import { parseReplay } from '../replay/replayFormat';

// Expose for QA harnesses (evidence-capture sidecars read plain data from this).
declare global {
  interface Window {
    __gd3d?: {
      /** M9.4 app screen: 'menu' (selector) or 'game' (active session). */
      screen: () => string;
      status: () => string;
      progress: () => number;
      attempts: () => number;
      jumps: () => number;
      grounded: () => boolean;
      laneIndex: () => number;
      playerPosition: () => { x: number; y: number; z: number };
      playerVelocity: () => { x: number; y: number; z: number };
      gravityMode: () => GravityMode;
      playerMode: () => PlayerMode;
      modeTransitionCount: () => number;
      chompers: () => { phase: string; x: number; y: number; z: number; aimX: number }[];
      platforms: () => { id: string; x: number; y: number; z: number }[];
      /** QA-only: deterministic moving-platform clock (ticks since respawn). */
      platformTick: () => number;
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
      /** QA-only: the ideal (pre-occlusion) camera eye (M8.6 visibility). */
      cameraIdealEye: () => { x: number; y: number; z: number };
      /** QA-only: pull-in active this frame (M8.6 visibility). */
      cameraOccluded: () => boolean;
      /** QA-only: blockers on the ideal sight segment (M8.6 visibility). */
      cameraOccluderCount: () => number;
      /** QA-only: smoothed pull-in distance (M8.6 visibility). */
      cameraPullInDistance: () => number;
      /** QA-only: meshes held faded by the last-resort fallback (M8.6). */
      cameraFadedOccluders: () => number;
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
      /** M9.3 island-contact pulse probes (presentation only). */
      contactPulseCount: () => number;
      lastContactPulseId: () => string | null;
      contactPulseIntensity: () => number;
      fxResets: () => number;
      burstActive: () => boolean;
      /** QA-only: Spider-swap camera glides armed (M8.2 smoothing proof). */
      swapGlideCount: () => number;
      /** M9.6 spider-snap observability (sim-owned, presentation/QA only). */
      spiderSnapCount: () => number;
      lastSpiderSnap: () => { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } } | null;
      spiderRejectCount: () => number;
      lastSpiderRejectReason: () => string | null;
      /** M9.6 spider-beam presentation probes (never gameplay). */
      spiderBeamActive: () => boolean;
      spiderBeamPlays: () => number;
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
      // M9 rhythm-pulse observability (presentation only).
      rhythmBeat: () => number;
      rhythmDownbeat: () => number;
      rhythmDrop: () => number;
      rhythmSection: () => string;
      // M6D performance observability (presentation only).
      perfEnabled: () => boolean;
      /** M9.1 QA slow-motion: effective per-frame catch-up budget. */
      stepCap: () => number;      perfSnapshot: () => {
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
      levelId: () => string;      levelDisplayName: () => string;
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
      // M9 music-transport observability (presentation only).
      awaitingStart: () => boolean;
      startGatePending: () => boolean;
      /** M9.1 fail-loud gate: latched while audio failure holds gameplay. */
      startGateFailed: () => boolean;
      simSteps: () => number;      musicState: () => string;
      musicTargetTime: () => number;
      musicActualTime: () => number;
      musicDriftMs: () => number;
      musicPlaying: () => boolean;
      musicMuted: () => boolean;
      /** M9.1 audio-evidence probes (proves real state, not assumptions). */
      musicBufferDuration: () => number;
      musicContextState: () => string;
      musicVolume: () => number;
      musicGain: () => number;
      /** M9.2 graph-structure probes (source→gain→destination wiring). */
      musicSourceCreated: () => boolean;
      musicSourceConnected: () => boolean;
      musicGainConnected: () => boolean;
      musicEffectiveGain: () => number;
      musicGraphReady: () => boolean;
      /** M9.2 checkpoint practice-mode probes (presentation only). */
      runMode: () => string;
      /** M9.4 officiality of the current attempt (classic/practice taint). */
      attemptKind: () => string;
      /** M9.4 QA-only: live mode switch (same path as the pause menu). */
      setRunMode: (mode: 'classic' | 'checkpoint') => void;
      checkpointCount: () => number;
      activeCheckpointId: () => string | null;
      checkpointProgress: () => { activeIndex: number; total: number };
      hasCheckpointEvent: () => boolean;
      checkpointEventCount: () => number;
      lastCheckpointId: () => string | null;
      isCheckpointActivated: (id: string) => boolean;
      checkpointBurstsActive: () => number;
      /** M9.4 crystal visibility follows the current run mode. */
      checkpointsVisible: () => boolean;
      /** M9.2 QA-only: arm/disarm checkpoint auto-respawn without the gate. */
      setCheckpointRespawnEnabled: (enabled: boolean) => void;
      /** M9.2 QA-only: full origin restart (Shift+R path). */
      restartRun: () => void;
    };
  }
}

/**
 * M9.4 menu-screen probes: just enough for QA harnesses to detect the
 * selector (screen + cards). Game sessions replace this with the full
 * probe set via `publishGameProbes`.
 */
export const publishMenuProbes = (cardLevelIds: readonly string[]): void => {
  (window as unknown as { __gd3d?: unknown }).__gd3d = {
    screen: () => 'menu',
    levelId: () => null,
    menuCards: () => [...cardLevelIds],
  };
};

/** Publish the full session probe set for an active `Game` (M5–M9.4). */
export const publishGameProbes = (game: Game): void => {
  window.__gd3d = {
    screen: () => 'game',
    status: () => game['simulation'].status,
    progress: () => game['simulation'].progress,
    attempts: () => game['simulation'].attempts,
    jumps: () => game.totalJumps,
    grounded: () => game['simulation'].player.grounded,
    laneIndex: () => game['simulation'].player.targetLaneIndex,
    playerPosition: () => ({ ...game['simulation'].player.position }),
    playerVelocity: () => ({ ...game['simulation'].player.velocity }),
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
    platforms: () =>
      game['simulation'].platformStates.map((s, i) => ({
        id: game['simulation'].level.movingPlatforms[i]?.id ?? `platform-${String(i)}`,
        x: s.x,
        y: s.y,
        z: s.z,
      })),
    platformTick: () => game['simulation'].platformTick,
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
    cameraEye: () => ({ ...game['rendererHost'].cameraResolvedEye }),
    cameraLook: () => ({ ...game['rendererHost'].cameraResolvedLook }),
    /** QA-only: the ideal (pre-occlusion) camera eye (M8.6 visibility proof). */
    cameraIdealEye: () => ({ ...game['rendererHost'].cameraIdealEye }),
    /** QA-only: pull-in active this frame (M8.6 visibility proof). */
    cameraOccluded: () => game['rendererHost'].cameraOccluded,
    /** QA-only: blockers on the ideal sight segment (M8.6 visibility proof). */
    cameraOccluderCount: () => game['rendererHost'].cameraOccluderCount,
    /** QA-only: smoothed pull-in distance (M8.6 visibility proof). */
    cameraPullInDistance: () => game['rendererHost'].cameraPullInDistance,
    /** QA-only: meshes held faded by the last-resort fallback (M8.6). */
    cameraFadedOccluders: () => game['rendererHost'].fadedOccluderCount,
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
    contactPulseCount: () => game['rendererHost'].contactPulseCount,
    lastContactPulseId: () => game['rendererHost'].lastContactPulseId,
    contactPulseIntensity: () => game['rendererHost'].contactPulseIntensity,
    fxResets: () => game['rendererHost'].fxResets,
    burstActive: () => game['rendererHost'].deathBurstActive,
    swapGlideCount: () => game['rendererHost'].swapGlideCount,
    spiderSnapCount: () => game['simulation'].spiderSnapEventCount,
    lastSpiderSnap: () => {
      const sim = game['simulation'];
      if (sim.spiderSnapEventCount === 0) return null;
      return {
        from: { ...sim.lastSpiderSnapFrom },
        to: { ...sim.lastSpiderSnapTo },
      };
    },
    spiderRejectCount: () => game['simulation'].spiderRejectCount,
    lastSpiderRejectReason: () => game['simulation'].lastSpiderRejectReason,
    spiderBeamActive: () => game['rendererHost'].spiderBeamActive,
    spiderBeamPlays: () => game['rendererHost'].spiderBeamPlays,
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
    // M9 rhythm-pulse probes (deterministic sim-time envelopes).
    rhythmBeat: () => game['rendererHost'].rhythmBeat,
    rhythmDownbeat: () => game['rendererHost'].rhythmDownbeat,
    rhythmDrop: () => game['rendererHost'].rhythmDrop,
    rhythmSection: () => game['rendererHost'].rhythmSection,
    // M6D probes: bounded profiler + real-GPU identity (cold path).
    perfEnabled: () => game.isPerfEnabled,
    stepCap: () => game.stepCap,
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
    // M9 music probes (presentation only — the sim clock stays authoritative).
    awaitingStart: (): boolean => game.awaitingStart,
    startGatePending: (): boolean => game.startGatePending,
    startGateFailed: (): boolean => game.startGateFailed,
    simSteps: (): number => game.simSteps,
    musicState: (): string => game.musicDirector?.probe().state ?? 'none',
    musicTargetTime: (): number => game.musicDirector?.probe().targetTime ?? -1,
    musicActualTime: (): number => game.musicDirector?.probe().actualTime ?? -1,
    musicDriftMs: (): number => game.musicDirector?.probe().driftMs ?? 0,
    musicPlaying: (): boolean => game.musicDirector?.probe().playing ?? false,
    musicMuted: (): boolean => game.musicDirector?.probe().muted ?? false,
    musicBufferDuration: (): number => game.musicDirector?.bufferDuration() ?? -1,
    musicContextState: (): string => game.musicDirector?.audioContextState() ?? 'none',
    musicVolume: (): number => game.musicDirector?.probe().volume ?? -1,
    musicGain: (): number => game.musicDirector?.probe().gain ?? -1,
    musicSourceCreated: (): boolean => game.musicDirector?.probe().sourceCreated ?? false,
    musicSourceConnected: (): boolean => game.musicDirector?.probe().sourceConnected ?? false,
    musicGainConnected: (): boolean => game.musicDirector?.probe().gainConnected ?? false,
    musicEffectiveGain: (): number => game.musicDirector?.probe().effectiveGain ?? -1,
    musicGraphReady: (): boolean => game.musicDirector?.graphReady() ?? false,
    runMode: (): string => game.activeRunMode,
    attemptKind: (): string => game.attemptKind,
    setRunMode: (mode: 'classic' | 'checkpoint'): void => {
      game.setRunMode(mode);
    },
    checkpointCount: (): number => game.gameSimulation.level.checkpoints.length,
    activeCheckpointId: (): string | null => game.gameSimulation.activeCheckpointId,
    checkpointProgress: (): { activeIndex: number; total: number } => game.gameSimulation.checkpointProgress(),
    hasCheckpointEvent: (): boolean => game.gameSimulation.hasCheckpointEvent,
    checkpointEventCount: (): number => game.gameSimulation.checkpointEventCount,
    lastCheckpointId: (): string | null => game.gameSimulation.lastCheckpointId,
    isCheckpointActivated: (id: string): boolean => game.gameSimulation.isCheckpointActivated(id),
    checkpointBurstsActive: (): number => game['rendererHost'].checkpointBurstsActive,
    /** M9.4 crystal visibility follows the current run mode. */
    checkpointsVisible: (): boolean => game['rendererHost'].areCheckpointsVisible,
    setCheckpointRespawnEnabled: (enabled: boolean): void => {
      game.gameSimulation.setCheckpointRespawnEnabled(enabled);
      game['rendererHost'].setCheckpointsVisible(enabled);
    },
    restartRun: (): void => {
      game.gameSimulation.restartRun();
    },
  };
};
