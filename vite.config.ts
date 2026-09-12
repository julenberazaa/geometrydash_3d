import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // M6D.1: the perf-gate harness lib + its tests live in scripts/ (plain
    // node ESM, no GPU required). tsc/eslint ignore scripts/ by config.
    include: ['tests/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
