import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Base Vitest config used by the default unit-test sweep. The integration
 * configs (`vitest.api-emulator.config.ts`, `vitest.rules.config.ts`) import
 * this file as `baseConfig` and reuse `baseConfig.resolve` directly rather
 * than calling `mergeConfig` — vitest's merge helper concatenates the
 * `test.include` arrays, which would pull every unit test from the base
 * include list into the integration runs under `environment: 'node'`. The
 * manual reuse keeps `resolve.alias` as the single source of truth while
 * letting each integration config override `test.include` cleanly.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: [
      'src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
      'functions/*.test.js',
      'shared/*.test.js',
    ],
    exclude: [
      '**/node_modules/**',
      'scripts/firestore.rules.integration.test.ts',
      'scripts/server.analyze.emulator.integration.test.ts',
      'functions/sanction.integration.test.js',
    ],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
  },
});
