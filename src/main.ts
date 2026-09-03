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
      playerPosition: () => { x: number; y: number; z: number };
      toggleDebug: () => void;
    };
  }
}

window.__gd3d = {
  status: () => game['simulation'].status,
  progress: () => game['simulation'].progress,
  attempts: () => game['simulation'].attempts,
  jumps: () => game.totalJumps,
  playerPosition: () => ({ ...game['simulation'].player.position }),
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
