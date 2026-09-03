import { Game } from './game/Game';

/**
 * Entry point. Owns the canvas container and the Game lifecycle.
 * No gameplay logic here.
 */
const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container missing from DOM');
}

const game = new Game(container);
game.start();

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
};

// Hot Module Acceptance for Vite dev server.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}
