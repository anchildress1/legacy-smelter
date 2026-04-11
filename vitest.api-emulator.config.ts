import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * Emulator-backed integration suite config. Inherits `resolve.alias` from the
 * base config but replaces `test.include` outright — vitest's `mergeConfig`
 * concatenates arrays, which would otherwise pull in every unit test from
 * the base include list and run them under `environment: 'node'`.
 */
export default defineConfig({
  resolve: baseConfig.resolve,
  test: {
    include: [
      'scripts/server.analyze.emulator.integration.test.ts',
      'functions/sanction.integration.test.js',
    ],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    // Both suites in this config share the same Firestore emulator instance
    // and write to the same `legacy-smelter` database. Running them in
    // parallel (the default) causes the sanction integration suite's seeded
    // `incident_logs` docs to leak into the analyze suite's "empty after
    // rejected request" assertions, and vice versa. Force a single file at
    // a time so each suite's `beforeEach` `purgeCollection` hands the
    // emulator a clean slate.
    fileParallelism: false,
    pool: 'forks',
    forks: {
      singleFork: true,
    },
  },
});
