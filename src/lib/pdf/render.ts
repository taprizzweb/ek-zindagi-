import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
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

/** A4 landscape: the certificate canvas (1123 x 794 px) is 297 x 210 mm at 96 dpi. */
const CANVAS = { width: 1123, height: 794 } as const;

async function withPage<T>(html: string, use: (page: Page) => Promise<T>): Promise<T> {
  await acquire();
  let browser: Browser | null = null;
  try {
    browser = await launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    await page.setViewport({ ...CANVAS, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url === 'about:blank') void req.continue();
      else void req.abort();
    });
    await page.setContent(html, { waitUntil: 'load' });
    // The page's own script waits for the fonts and fits the text, then sets this flag.
    await page.waitForSelector('body[data-fit-done]');
    return await use(page);
  } catch {
    throw new AppError('pdf_failed', 502);
  } finally {
    await browser?.close().catch(() => undefined);
    release();
  }
}

/** HTML to an A4 landscape PDF. Anything that is not an inline data: URL is blocked, so a render never touches the network. */
export function renderPdf(html: string): Promise<Buffer> {
  return withPage(html, async (page) =>
    Buffer.from(
      await page.pdf({
        width: `${CANVAS.width}px`,
        height: `${CANVAS.height}px`,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    ),
  );
}

/** HTML to a PNG of the certificate (2x, for "Download image"). Same offline rules as the PDF. */
export function renderPng(html: string): Promise<Buffer> {
  return withPage(html, async (page) => {
    await page.setViewport({ ...CANVAS, deviceScaleFactor: 2 });
    return Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...CANVAS } }));
  });
}
