import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Base Vitest config used by the default unit-test sweep. The integration
 * configs (`vitest.api-emulator.config.ts`, `vitest.rules.config.ts`) extend
 * this file via `mergeConfig` so the alias and base options stay in a single
 * source of truth.
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
