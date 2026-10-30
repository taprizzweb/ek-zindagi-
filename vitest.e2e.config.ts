import { defineConfig } from 'vitest/config';

// Browser tests: real Chromium at phone size, fake camera and GPS, app built and started locally,
// Supabase replaced by tests/e2e/fake-supabase.ts. Run with `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    globalSetup: ['tests/e2e/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
