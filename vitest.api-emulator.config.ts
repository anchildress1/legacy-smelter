import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/server.analyze.emulator.integration.test.ts'],
    environment: 'node',
  },
});
