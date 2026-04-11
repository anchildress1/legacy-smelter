import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * Firestore security-rules suite config. Inherits `resolve.alias` from the
 * base config but replaces `test.include` outright — vitest's `mergeConfig`
 * concatenates arrays, which would otherwise pull in every unit test from
 * the base include list and run them under `environment: 'node'`.
 */
export default defineConfig({
  resolve: baseConfig.resolve,
  test: {
    include: ['scripts/firestore.rules.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
  },
});
