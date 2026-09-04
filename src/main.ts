import { Game } from './game/Game';
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

const requestedLevelId = new URLSearchParams(window.location.search).get('level');
const resolution = resolveLevel(requestedLevelId);

const game = new Game(container, resolution.level);
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
      gravityMode: () => 'floor' | 'ceiling';
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
      lethalInfo: () => {
        colliderId: string | null;
        normal: { x: number; y: number; z: number };
        preVel: { x: number; y: number; z: number };
      };
      rendererStats: () => { calls: number; triangles: number };
      sceneChildren: () => number;
      burstActive: () => boolean;
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
  lethalInfo: () => ({
    colliderId: game['simulation'].lastLethalColliderId,
    normal: { ...game['simulation'].lastContactNormal },
    preVel: { ...game['simulation'].lastPreImpactVelocity },
  }),
  rendererStats: () => ({ ...game['rendererHost'].stats }),
  sceneChildren: () => game['rendererHost'].sceneChildren,
  burstActive: () => game['rendererHost'].deathBurstActive,
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
