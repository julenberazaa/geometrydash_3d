import { MaterialLibrary } from '../../src/rendering/MaterialLibrary';
import { PRODUCTION_THEME } from '../../src/visuals/productionTheme';

/**
 * Test-only visual helper (NOT a *.test.ts module — reusable support code
 * per AGENTS.md §9). Builds a production MaterialLibrary for structural
 * rendering tests. Three.js materials/geometries construct fine in the node
 * test environment (no DOM/WebGL needed); only WebGLRenderer/composer paths
 * stay browser-only.
 */
export const makeTestLibrary = (): MaterialLibrary =>
  new MaterialLibrary({ ...PRODUCTION_THEME });
