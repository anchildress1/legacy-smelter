import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/firestore.rules.integration.test.ts'],
    environment: 'node',
  },
});
