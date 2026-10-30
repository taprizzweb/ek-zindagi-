import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// PDF tests: real headless Chromium renders the certificate; Poppler (pdftotext, pdftoppm,
// pdfinfo, pdffonts) inspects the result. Run with `npm run test:pdf`.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/pdf/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/pdf/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
