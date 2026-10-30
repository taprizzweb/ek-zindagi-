import { chromium } from 'playwright';

/**
 * Uses CHROMIUM_EXECUTABLE_PATH if given, otherwise the Chromium Playwright installed.
 * PDF_TEST_SERVERLESS=1 leaves it unset, so the tests run against the bundled serverless
 * Chromium (@sparticuz/chromium), the build used on Vercel.
 */
export default function setup() {
  if (process.env.PDF_TEST_SERVERLESS === '1') {
    delete process.env.CHROMIUM_EXECUTABLE_PATH;
    return;
  }
  process.env.CHROMIUM_EXECUTABLE_PATH ||= chromium.executablePath();
}
