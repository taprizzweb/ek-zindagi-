import { join } from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { AppError } from '@/lib/errors';

/**
 * The Chromium build (brotli files). The path is spelled out with a literal so the file tracer ships the
 * folder with the function; the package's own default path is computed at run time and is not traced.
 */
const CHROMIUM_BIN = join(process.cwd(), 'node_modules', '@sparticuz', 'chromium', 'bin');

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
    executablePath: await chromium.executablePath(CHROMIUM_BIN),
    headless: 'shell',
    args: chromium.args,
  });
}

/** A4 landscape: the certificate canvas (1123 x 794 px) is 297 x 210 mm at 96 dpi. */
const CANVAS = { width: 1123, height: 794 } as const;

/**
 * One Chromium is kept for the life of the server instance: starting it is the slow part (several seconds on a
 * cold function), a page inside a running one takes about a second. If it died, the next render starts a new one.
 */
let shared: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (shared) {
    const existing = await shared.catch(() => null);
    if (existing?.connected) return existing;
    shared = null;
  }
  const started = launch();
  shared = started;
  started.catch(() => {
    if (shared === started) shared = null;
  });
  return started;
}

/** Shuts the shared Chromium (tests, or after a failure); the next render starts a fresh one. */
export async function closeBrowser(): Promise<void> {
  const old = shared;
  shared = null;
  await old?.then((b) => b.close()).catch(() => undefined);
}

/** Starts Chromium ahead of the first certificate (the form calls this while the officer is typing). */
export async function warmUp(): Promise<void> {
  await getBrowser();
}

async function withPage<T>(html: string, run: (page: Page) => Promise<T>): Promise<T> {
  await acquire();
  let page: Page | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
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
    return await run(page);
  } catch (err) {
    // Only the technical reason is logged (no entry data), so a deploy problem is visible in the host logs.
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.error('pdf render failed:', reason);
    void closeBrowser(); // do not trust this browser for the next render
    throw new AppError('pdf_failed', 502, reason);
  } finally {
    await page?.close().catch(() => undefined);
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
