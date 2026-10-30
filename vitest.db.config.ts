import { defineConfig } from 'vitest/config';

// Database tests: need a reachable Postgres (TEST_DATABASE_URL). See README.
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
