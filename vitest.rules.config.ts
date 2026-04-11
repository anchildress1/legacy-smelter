import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['scripts/firestore.rules.integration.test.ts'],
      exclude: ['**/node_modules/**'],
      environment: 'node',
      setupFiles: [],
    },
  }),
);
