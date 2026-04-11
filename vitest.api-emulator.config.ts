import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/server.analyze.emulator.integration.test.ts',
      'functions/sanction.integration.test.js',
    ],
    environment: 'node',
    // Both suites in this config share the same Firestore emulator
    // instance and write to the same `legacy-smelter` database. Running
    // them in parallel (the default) causes the sanction integration
    // suite's seeded `incident_logs` docs to leak into the analyze
    // suite's "empty after rejected request" assertions, and vice versa.
    // Force a single file at a time so each suite's `beforeEach`
    // `purgeCollection` hands the emulator a clean slate.
    fileParallelism: false,
    pool: 'forks',
    forks: {
      singleFork: true,
    },
  },
});
