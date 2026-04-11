import path from 'node:path';
import { defineConfig } from 'vitest/config';

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
