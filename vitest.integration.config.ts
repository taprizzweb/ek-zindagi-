import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Integration tests: real services of ours against the only thing mocked, the WhatsApp API.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
