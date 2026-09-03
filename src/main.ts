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
