import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser } from 'puppeteer-core';
import { AppError } from '@/lib/errors';

const RENDER_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}
function release(): void {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

async function launch(): Promise<Browser> {
  const local = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (local) {
    return puppeteer.launch({
      executablePath: local,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
  }
  // Serverless (Vercel / AWS Lambda): the bundled Chromium build.
  return puppeteer.launch({
    executablePath: await chromium.executablePath(),
    headless: 'shell',
    args: chromium.args,
  });
}

/** HTML to an A4 PDF. Anything that is not an inline data: URL is blocked, so a render can never fetch from the network. */
export async function renderPdf(html: string): Promise<Buffer> {
  await acquire();
  let browser: Browser | null = null;
  try {
    browser = await launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url === 'about:blank') void req.continue();
      else void req.abort();
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(pdf);
  } catch {
    throw new AppError('pdf_failed', 502);
  } finally {
    await browser?.close().catch(() => undefined);
    release();
  }
}
