import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { violationByKey } from '../../src/config/violations';
import { pdfInfo, pdfText } from '../pdf/helpers';
import { APP_PORT, APP_URL, FAKE_SUPABASE_PORT, appEnv } from './env';
import { OFFICER, startFakeSupabase } from './fake-supabase';

let fake: Awaited<ReturnType<typeof startFakeSupabase>>;
let app: ChildProcess;
let browser: Browser;
const contexts: BrowserContext[] = [];
const cspViolations: string[] = [];

async function waitForApp() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${APP_URL}/login`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('app did not start');
}

beforeAll(async () => {
  fake = await startFakeSupabase(FAKE_SUPABASE_PORT);
  app = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT)],
    {
      env: { ...process.env, ...appEnv, NODE_ENV: 'production' },
      stdio: 'ignore',
    },
  );
  await waitForApp();
  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
});

afterAll(async () => {
  await browser?.close();
  app?.kill('SIGTERM');
  await fake?.close();
});

afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  fake.reset();
});

/** A phone-sized context. `gps: false` leaves location permission off. */
async function phone(opts: { gps?: boolean; camera?: boolean } = {}): Promise<Page> {
  const { gps = true, camera = true } = opts;
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    locale: 'en-IN',
    geolocation: gps ? { latitude: 26.912345, longitude: 75.787654 } : undefined,
    permissions: [...(gps ? ['geolocation'] : []), ...(camera ? ['camera'] : [])],
  });
  contexts.push(context);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) cspViolations.push(m.text());
  });
  // wa.me is not reachable from the tests: answer it with a stub page and let tests read the address.
  await page.route('https://wa.me/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><p>wa.me stub</p>',
    }),
  );
  return page;
}

/** Error and notice boxes (not Next's hidden route announcer, which is also role=alert). */
const alertBox = (page: Page) => page.locator('[role=alert]:not(#__next-route-announcer__)');
/** The certificate that is on screen (the form stays mounted but hidden once the certificate is made). */
const cert = (page: Page) => page.locator('[data-testid=certificate]:visible');

async function login(page: Page) {
  await page.goto(`${APP_URL}/login`);
  await page.fill('#email', OFFICER.email);
  await page.fill('#password', OFFICER.password);
  await page.getByRole('button', { name: /Log in/ }).click();
  await page.waitForURL('**/officer');
}

async function openForm(page: Page) {
  await login(page);
  await page.getByRole('link', { name: /New entry/ }).click();
  await page.waitForURL('**/new');
}

async function fillForm(
  page: Page,
  over: { name?: string; phone?: string; place?: string; violation?: string } = {},
) {
  await page.fill('#name', over.name ?? 'Ravi Kumar');
  await page.fill('#phone', over.phone ?? '9876543210');
  await page.selectOption('#violation', over.violation ?? 'helmet');
  const place = page.locator('#place');
  await place.waitFor();
  if (over.place !== undefined || (await place.inputValue()) === '') {
    await place.fill(over.place ?? 'Sample Chauraha, Jaipur');
  }
}

async function takePhoto(page: Page) {
  await page.getByRole('button', { name: /Open camera/ }).click();
  const capture = page.getByRole('button', { name: /Capture/ });
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(page.getByAltText(/Captured photo/)).toBeVisible();
}

async function generate(page: Page) {
  await page.getByRole('button', { name: /Generate certificate/ }).click();
  // The very first render of a run starts Chromium cold, so allow more than the default 5 seconds.
  try {
    await expect(page.getByText('Certificate ready')).toBeVisible({ timeout: 30_000 });
  } catch (err) {
    const alerts = await alertBox(page).allInnerTexts();
    const status = await page.getByRole('status').allInnerTexts();
    process.stderr.write(
      `\ncertificate not ready. alerts: ${JSON.stringify(alerts)} status: ${JSON.stringify(status)}\n`,
    );
    throw err;
  }
}

async function exifJpeg(): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'ekz-')), 'gallery.jpg');
  const buf = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#778' },
  })
    .withExif({ IFD0: { Copyright: 'SECRET-OWNER' } })
    .jpeg()
    .toBuffer();
  writeFileSync(file, buf);
  return file;
}

const BANNED =
  /\b(challan|e-challan|fine|fines|penalty|penalties|deceased|rip|late)\b|चालान|जुर्माना/i;
const LINK_RE = /(http:\/\/127\.0\.0\.1:\d+\/c\/[A-Za-z0-9_-]{22})/;

describe('login and access', () => {
  it('sends a signed-out visitor to the login page and refuses a wrong password', async () => {
    const page = await phone();
    await page.goto(`${APP_URL}/new`);
    await page.waitForURL('**/login');
    await page.fill('#email', OFFICER.email);
    await page.fill('#password', 'wrong-password-123');
    await page.getByRole('button', { name: /Log in/ }).click();
    await expect(alertBox(page)).toContainText('Email or password is not correct');
    expect(page.url()).toContain('/login');
  });

  it('serves pages with the security headers and no CSP violations, including the certificate preview', async () => {
    const page = await phone();
    const res = await page.goto(`${APP_URL}/login`);
    const h = res!.headers();
    expect(h['content-security-policy']).toMatch(
      /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
    );
    expect(h['strict-transport-security']).toContain('max-age');
    expect(h['x-frame-options']).toBe('DENY');
    await openForm(page);
    await expect(cert(page)).toBeVisible();
    await fillForm(page);
    await takePhoto(page);
    await page.check('#consent');
    await generate(page);
    expect(cspViolations).toEqual([]);
  });
});

describe('officer form: live preview', () => {
  it('shows the certificate on the same screen, with sample text until something is typed', async () => {
    const page = await phone();
    await openForm(page);
    await expect(cert(page)).toBeVisible();
    await expect(cert(page).locator('.c-head')).toHaveText('ONE MISTAKE AWAY');
    await expect(cert(page).locator('.c-name')).toHaveText('Sample Name');
    await expect(cert(page).locator('.opt.sel')).toHaveCount(0); // no violation chosen yet
    await expect(cert(page).locator('.disc')).toContainText(
      'Awareness campaign illustration. Not a legal document, accident report or police notice.',
    );
    await expect(cert(page).locator('.stamp')).toContainText('FOR AWARENESS');
    await expect(cert(page).locator('.stamp')).not.toContainText(/hypothetical/i);
    await expect(cert(page).locator('.wm')).toHaveText('AWARENESS ONLY');
  });

  it('at 360 px wide: new certificate wording, cracked glass, watermark and bar, no police logo, a long name and place overlap nothing', async () => {
    const page = await phone();
    await openForm(page);
    await page.locator('#name').fill('Ramachandran Venkataraghavan Subramaniam Iyer');
    await page.selectOption('#violation', 'other');
    const place = page.locator('#place');
    await place.waitFor();
    await place.fill('Near Jawahar Circle Garden Gate No 3, Malviya Nagar, Jaipur Rajasthan India');
    const c = cert(page);
    await expect(c.locator('.c-head')).toHaveText('ONE MISTAKE AWAY');
    await expect(c.locator('.c-sub')).toHaveText('Certificate of recklessness on road');
    await expect(c.locator('.last')).toHaveText('was caught on camera on');
    await expect(c.locator('.bc')).toHaveText('This could have been your last ride.');
    await expect(c.locator('.br')).toHaveText('Road Safety Awareness Campaign');
    await expect(c.locator('.disc')).toContainText(
      'Not a legal document, accident report or police notice',
    );
    await expect(c.locator('.wm')).toHaveText('AWARENESS ONLY');
    await expect(c.locator('.c-logo')).toHaveCount(0); // no police logo
    expect(await c.locator('svg.c-art polyline').count()).toBeGreaterThan(10); // the cracks
    expect(await c.locator('svg.c-art image').count()).toBe(0); // no garland picture, no frame picture
    // Nothing overlaps: measured in the certificate's own pixels (the preview scales it down).
    const boxes = await c.evaluate((root) => {
      const r = (sel: string) => {
        const b = root.querySelector(sel)!.getBoundingClientRect();
        const o = root.getBoundingClientRect();
        const k = 1123 / o.width;
        return {
          top: (b.top - o.top) * k,
          bottom: (b.bottom - o.top) * k,
          right: (b.right - o.left) * k,
        };
      };
      return {
        name: r('.c-name'),
        last: r('.last'),
        date: r('.c-datebox'),
        loc: r('.c-locbox .big'),
        committing: r('.committing'),
        disc: r('.disc'),
        credit: r('.credit'),
        bc: r('.bc'),
      };
    });
    expect(boxes.name.bottom).toBeLessThanOrEqual(boxes.last.top + 4);
    expect(boxes.loc.bottom).toBeLessThanOrEqual(boxes.committing.top);
    expect(boxes.bc.bottom).toBeLessThanOrEqual(boxes.credit.top + 2);
    expect(boxes.credit.bottom).toBeLessThanOrEqual(boxes.disc.top + 1);
    expect(boxes.name.right).toBeLessThanOrEqual(1070);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  it('updates as the officer types and chooses, without pressing anything', async () => {
    const page = await phone();
    await openForm(page);
    await page.locator('#name').pressSequentially('Ravi Kumar');
    await expect(cert(page).locator('.c-name')).toHaveText('Ravi Kumar');
    await page.selectOption('#violation', 'seatbelt');
    await expect(cert(page).locator('.opt.sel')).toHaveCount(1);
    await expect(cert(page).locator('.opt.sel span')).toHaveText('Driver without seatbelt');
    await page.selectOption('#violation', 'child_helmet');
    await expect(cert(page).locator('.opt.sel span')).toHaveText('Child without helmet on scooter');
    await page.locator('#place').fill('Station Road, Jaipur');
    await expect(cert(page).locator('.c-locbox .big')).toHaveText('Station Road, Jaipur');
    await expect(cert(page).locator('.c-datebox .big')).toContainText(
      /\d{2} \w+ \d{4}\s*\d{2}:\d{2} (AM|PM)/,
    );
    expect(fake.state.entries).toHaveLength(0); // nothing saved while typing
  });

  it('shows the photo in the frame as soon as it is taken, and the silhouette again after removing it', async () => {
    const page = await phone();
    await openForm(page);
    await expect(cert(page).locator('image')).toHaveCount(0); // the frame is drawn, not a picture
    await takePhoto(page);
    await expect(cert(page).locator('image')).toHaveCount(1);
    await page.getByRole('button', { name: /Remove photo/ }).click();
    await expect(cert(page).locator('image')).toHaveCount(0);
  });

  it('shrinks long text to fit, as the PDF does', async () => {
    const page = await phone();
    await openForm(page);
    const size = async (sel: string) =>
      Number.parseFloat(
        await cert(page)
          .locator(sel)
          .evaluate((e) => getComputedStyle(e).fontSize),
      );
    await expect.poll(() => size('.c-name')).toBe(46);
    await page.fill('#name', 'W'.repeat(40));
    await expect.poll(() => size('.c-name')).toBeLessThan(40);
    await page
      .locator('#place')
      .fill(
        'Plot 14 Sector 9 Mansarovar Extension Near Old Water Tank Opposite Government School Jaipur',
      );
    await expect.poll(() => size('.c-locbox .big')).toBeLessThan(30);
  });

  it('is scaled to fit the phone screen without sideways scrolling', async () => {
    const page = await phone();
    await openForm(page);
    const box = await page.locator('[data-testid=certificate-preview]').first().boundingBox();
    expect(box!.width).toBeLessThanOrEqual(360);
    expect(box!.width).toBeGreaterThan(300);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

describe('officer form: camera first, gallery as backup', () => {
  it('offers the camera as the main action and the gallery only as a secondary link below it', async () => {
    const page = await phone();
    await openForm(page);
    const camera = page.getByRole('button', { name: /Open camera/ });
    const gallery = page.getByRole('button', { name: /Camera not working\? Use gallery/ });
    await expect(camera).toBeVisible();
    await expect(gallery).toBeVisible();
    const [cb, gb] = [await camera.boundingBox(), await gallery.boundingBox()];
    expect(gb!.y).toBeGreaterThan(cb!.y + cb!.height - 1); // below the camera button
    // The camera is a bordered button; the gallery is plain link-style text, with no file picker until chosen.
    expect(await camera.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('2px');
    expect(await gallery.evaluate((e) => getComputedStyle(e).textDecorationLine)).toContain(
      'underline',
    );
    expect(await gallery.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('0px');
    await expect(page.locator('input[type=file]')).toHaveCount(0);
  });

  it('camera photos are compressed to at most 1200 px and stored without metadata', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await takePhoto(page);
    await page.check('#consent');
    await generate(page);
    const meta = await sharp(fake.state.uploads[0]!.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1200);
    expect(fake.state.entries[0]).toMatchObject({ photo_source: 'camera', consent_checked: true });
  });

  it('gallery photos go through the same compression, with a reason, and are flagged', async () => {
    const page = await phone();
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    await openForm(page);
    await fillForm(page);
    await page.getByRole('button', { name: /Open camera/ }).click();
    await expect(alertBox(page).filter({ hasText: 'Camera permission was denied' })).toBeVisible();
    await page.getByRole('button', { name: /Camera not working\? Use gallery/ }).click();
    await expect(page.locator('#galleryReason')).toHaveValue('permission_denied'); // pre-selected from the camera error
    await page.setInputFiles('input[type=file]', await exifJpeg());
    await expect(page.getByAltText(/Captured photo/)).toBeVisible();
    await page.check('#consent');
    await generate(page);
    expect(fake.state.entries[0]).toMatchObject({
      photo_source: 'gallery',
      gallery_reason: 'permission_denied',
      consent_checked: true,
    });
    const meta = await sharp(fake.state.uploads[0]!.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(fake.state.uploads[0]!.bytes.toString('latin1')).not.toContain('SECRET-OWNER');
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1200);
  });

  it('needs a reason before a gallery photo can be chosen', async () => {
    const page = await phone();
    await openForm(page);
    await page.getByRole('button', { name: /Camera not working\? Use gallery/ }).click();
    await expect(page.getByRole('button', { name: /Choose photo/ })).toBeDisabled();
    await page.selectOption('#galleryReason', 'no_camera');
    await expect(page.getByRole('button', { name: /Choose photo/ })).toBeEnabled();
  });

  it('lets the officer retake or remove the photo', async () => {
    const page = await phone();
    await openForm(page);
    await takePhoto(page);
    await page.getByRole('button', { name: /Retake/ }).click();
    await page.getByRole('button', { name: /Capture/ }).click();
    await expect(page.getByAltText(/Captured photo/)).toBeVisible();
    await page.getByRole('button', { name: /Remove photo/ }).click();
    await expect(page.getByAltText(/Captured photo/)).toHaveCount(0);
    await expect(page.locator('#consent')).toHaveCount(0);
  });
});

describe('officer form: generate, download', () => {
  it('saves the entry and makes the PDF, with the right content, and the entry becomes ready', async () => {
    const page = await phone();
    await openForm(page);
    await expect(page.getByText('Location confirmed')).toBeVisible();
    await fillForm(page);
    await takePhoto(page);
    await page.check('#consent');
    expect(fake.state.entries).toHaveLength(0);
    await generate(page);

    const entry = fake.state.entries[0]!;
    expect(entry).toMatchObject({
      officer_id: OFFICER.id,
      person_name: 'Ravi Kumar',
      phone_e164: '+919876543210',
      violation: 'helmet',
      area_name: 'Sample Chauraha, Jaipur',
      location_source: 'gps',
      lat: 26.912,
      lng: 75.788,
      photo_source: 'camera',
      consent_checked: true,
      status: 'ready',
      pdf_path: `${entry.id}.pdf`,
    });
    expect(String(entry.phone_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(fake.state.pdfs).toHaveLength(1);
    const pdf = fake.state.pdfs[0]!.bytes;
    expect(pdf.length).toBeLessThan(1.5 * 1024 * 1024);
    expect(pdfInfo(pdf).Pages).toBe('1');
    expect(pdfInfo(pdf).Title).toContain(String(entry.cert_code));
    const text = pdfText(pdf).toUpperCase();
    for (const s of [
      'ONE MISTAKE AWAY',
      'RAVI KUMAR',
      'SAMPLE CHAURAHA, JAIPUR',
      'RIDER WITHOUT HELMET',
      String(entry.cert_code).toUpperCase(),
    ]) {
      expect(text, s).toContain(s);
    }
    expect(text.replace(/[^A-Z]/g, '')).toContain('NOTALEGALDOCUMENT');
    expect(text.replace(/[^A-Z]/g, '')).toContain('AWARENESSONLY');
    expect(pdfText(pdf)).not.toMatch(BANNED);
    // The audit trail has no personal data.
    expect(fake.state.audit.map((a) => a.action)).toEqual([
      'login',
      'entry_created',
      'certificate_generated',
    ]);
    expect(JSON.stringify(fake.state.audit)).not.toMatch(/Ravi|9876543210|Chauraha/);
  });

  it('shows the server-recorded certificate number once it is made', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await generate(page);
    const code = String(fake.state.entries[0]!.cert_code);
    await expect(cert(page).locator('.bl')).toContainText(`Certificate No. ${code}`);
  });

  it('works without a photo and shows no consent box', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await expect(page.locator('#consent')).toHaveCount(0);
    await generate(page);
    expect(fake.state.entries[0]).toMatchObject({
      photo_source: 'none',
      consent_checked: false,
      photo_path: null,
    });
    expect(fake.state.uploads).toHaveLength(0);
  });

  it('offers Download PDF and Download image, owner only, and records each download', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await generate(page);
    const id = String(fake.state.entries[0]!.id);
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');

    const pdfLink = page.getByRole('link', { name: /Download PDF/ });
    const imgLink = page.getByRole('link', { name: /Download image/ });
    await expect(pdfLink).toHaveAttribute('href', `/api/entries/${id}/certificate/pdf`);
    await expect(imgLink).toHaveAttribute('href', `/api/entries/${id}/certificate/image`);

    const pdfRes = await fetch(`${APP_URL}${await pdfLink.getAttribute('href')}`, {
      headers: { cookie },
    });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    expect(pdfRes.headers.get('content-disposition')).toContain(
      'attachment; filename="EK-ZINDAGI-',
    );
    expect(Buffer.from(await pdfRes.arrayBuffer()).equals(fake.state.pdfs[0]!.bytes)).toBe(true);

    const imgRes = await fetch(`${APP_URL}${await imgLink.getAttribute('href')}`, {
      headers: { cookie },
    });
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get('content-type')).toBe('image/png');
    const meta = await sharp(Buffer.from(await imgRes.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 2246, 1588]);

    expect(
      fake.state.audit
        .filter((a) => a.action === 'certificate_downloaded')
        .map((a) => (a.meta as { format: string }).format),
    ).toEqual(['pdf', 'image']);

    // Somebody else's entry, an unknown id and a request with no session are all refused.
    fake.state.entries.push({
      id: '22222222-2222-4222-8222-222222222222',
      officer_id: 'someone-else',
      status: 'ready',
      pdf_path: 'x.pdf',
      cert_code: 'X',
    });
    const get = (path: string, withCookie = true) =>
      fetch(`${APP_URL}${path}`, { headers: withCookie ? { cookie } : {}, redirect: 'manual' });
    expect(
      (await get('/api/entries/22222222-2222-4222-8222-222222222222/certificate/pdf')).status,
    ).toBe(404);
    expect(
      (await get('/api/entries/11111111-1111-4111-8111-111111111111/certificate/image')).status,
    ).toBe(404);
    expect((await get(`/api/entries/${id}/certificate/pdf`, false)).status).not.toBe(200);
  });

  it('a lost response never creates a second entry, and a failed certificate request can be retried', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);

    // The server stores the entry, but the answer never reaches the phone.
    let first = true;
    await page.route('**/api/entries', async (route) => {
      if (first && route.request().method() === 'POST') {
        first = false;
        await route.fetch();
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(alertBox(page)).toContainText('No network');
    await expect(page.locator('#name')).toHaveValue('Ravi Kumar'); // nothing lost
    expect(fake.state.entries).toHaveLength(1);

    // Now the certificate request fails once.
    let failCert = true;
    await page.route('**/api/entries/*/certificate', async (route) => {
      if (failCert) {
        failCert = false;
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(alertBox(page)).toContainText('No network');
    await expect(page.getByRole('button', { name: /Try again/ })).toBeVisible();
    expect(fake.state.entries).toHaveLength(1);
    expect(fake.state.pdfs).toHaveLength(0);

    await page.getByRole('button', { name: /Try again/ }).click();
    await expect(page.getByText('Certificate ready')).toBeVisible();
    expect(fake.state.entries).toHaveLength(1);
    expect(fake.state.pdfs).toHaveLength(1);
    expect(fake.state.audit.filter((a) => a.action === 'entry_created')).toHaveLength(1);
  });
});

describe('officer form: validation', () => {
  it('shows what is wrong, focuses the first problem, and keeps what was typed', async () => {
    const page = await phone();
    await openForm(page);
    await expect(page.getByText('Location confirmed')).toBeVisible();
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(page.locator('#name')).toBeFocused();
    await expect(alertBox(page).filter({ hasText: 'Enter a name' })).toBeVisible();
    await expect(alertBox(page).filter({ hasText: '10-digit mobile number' })).toBeVisible();
    await expect(alertBox(page).filter({ hasText: 'Choose the violation' })).toBeVisible();

    await page.fill('#name', 'Ravi Kumar');
    await page.fill('#phone', '1234567890'); // starts with 1
    await page.selectOption('#violation', 'helmet');
    await page.locator('#place').fill('Station Road, Jaipur');
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(page.locator('#phone')).toBeFocused();
    expect(fake.state.entries).toHaveLength(0);
  });

  it('only lets digits into the number field, at most ten', async () => {
    const page = await phone();
    await openForm(page);
    await page.locator('#phone').pressSequentially('98a76-54321099');
    await expect(page.locator('#phone')).toHaveValue('9876543210');
  });

  it('refuses names in a script the certificate cannot print', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page, { name: 'அருண்' });
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(page.locator('#name')).toBeFocused();
    expect(fake.state.entries).toHaveLength(0);
  });

  it('accepts a Hindi name and place, and prints them', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page, { name: 'प्रियंका शर्मा', place: 'मालवीय नगर, जयपुर' });
    await expect(cert(page).locator('.c-name')).toHaveText('प्रियंका शर्मा');
    await generate(page);
    const text = pdfText(fake.state.pdfs[0]!.bytes).replace(/\s/g, '');
    expect(text).toContain('प्रियंका शर्मा'.replace(/\s/g, ''));
    expect(text).toContain('मालवीय नगर, जयपुर'.replace(/\s/g, ''));
  });

  it('needs the type and the text under "Other"', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await page.selectOption('#violation', 'other');
    await expect(cert(page).locator('.opt.sel span')).toHaveText('Other traffic violation');
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(page.locator('#otherChoice')).toBeFocused();
    await page.selectOption('#otherChoice', 'typed');
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(page.locator('#otherTyped')).toBeFocused();
    await page.fill('#otherTyped', 'No indicator');
    await generate(page);
    expect(fake.state.entries[0]).toMatchObject({ violation: 'other', other_text: 'No indicator' });
  });

  it('will not continue with a photo until consent is ticked', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await takePhoto(page);
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(page.locator('#consent')).toBeFocused();
    await expect(alertBox(page).filter({ hasText: 'Confirm consent' })).toBeVisible();
    await page.check('#consent');
    await generate(page);
  });
});

describe('officer form: GPS denied', () => {
  it('falls back to a typed place and records the entry as manual', async () => {
    const page = await phone({ gps: false });
    await openForm(page);
    await expect(page.getByText('Location is not available')).toBeVisible();
    await fillForm(page, { place: 'Station Road, Jaipur' });
    await generate(page);
    expect(fake.state.entries[0]).toMatchObject({
      location_source: 'manual',
      lat: null,
      lng: null,
      area_name: 'Station Road, Jaipur',
    });
  });

  it('will not continue without a place name', async () => {
    const page = await phone({ gps: false });
    await openForm(page);
    await expect(page.getByText('Location is not available')).toBeVisible();
    await fillForm(page, { place: '' });
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(page.locator('#place')).toBeFocused();
  });
});

describe('send on WhatsApp (bridge mode)', () => {
  /** Taps "Send on WhatsApp" and returns the wa.me address the phone is sent to. */
  async function sendAndCaptureWaUrl(page: Page): Promise<URL> {
    const waRequest = page.waitForRequest((r) => r.url().startsWith('https://wa.me/'));
    await page.getByRole('button', { name: /Send on WhatsApp/ }).click();
    return new URL((await waRequest).url());
  }

  it('asks to confirm the number in large digits before anything is sent', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await generate(page);
    await expect(page.getByText('Is this number correct?')).toBeVisible();
    await expect(page.getByText('+91 98765 43210')).toBeVisible();
    const size = await page
      .getByText('+91 98765 43210')
      .evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
    expect(size).toBeGreaterThanOrEqual(32);
    expect(fake.state.links).toHaveLength(0); // nothing prepared yet
    await expect(page.getByRole('button', { name: /Send on WhatsApp/ })).toBeVisible();
  });

  it('shows the message the person will get, in Hindi and English together, with no challan, fine or penalty wording', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page, { violation: 'overspeed' });
    await generate(page);
    const text = await page.getByTestId('message-preview').innerText();
    expect(text).toContain('नमस्ते Ravi Kumar जी / Hello Ravi Kumar');
    expect(text).toContain('Jaipur road safety awareness camp (Project EK ZINDAGI)');
    expect(text).toContain('जयपुर सड़क सुरक्षा जागरूकता शिविर');
    expect(text).toContain('काल्पनिक चित्रण');
    expect(text).toContain('hypothetical illustration');
    expect(text).toContain(violationByKey('overspeed').lineHi);
    expect(text).toContain(violationByKey('overspeed').lineEn);
    expect(text).toContain('*STOP*');
    expect(text).not.toMatch(BANNED);
    expect(text).not.toMatch(/violation|offence|offense|ticket|court/i);
  });

  it('opens WhatsApp for that number with the message and a link that serves the PDF', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await generate(page);
    const url = await sendAndCaptureWaUrl(page);

    expect(url.origin + url.pathname).toBe('https://wa.me/919876543210');
    const message = url.searchParams.get('text')!;
    expect(message).toContain('नमस्ते Ravi Kumar जी / Hello Ravi Kumar');
    expect(message).not.toMatch(BANNED);
    const link = LINK_RE.exec(message)![1]!;

    // The record: a link that expires in 24 hours, a hash and not the token, status "sent" without claiming delivery.
    expect(fake.state.links).toHaveLength(1);
    const l = fake.state.links[0]!;
    const token = link.split('/c/')[1]!;
    expect(l.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(fake.state.links)).not.toContain(token);
    const hours = (new Date(String(l.expires_at)).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    expect(fake.state.entries[0]).toMatchObject({ status: 'sent', delivery_mode: 'bridge' });
    expect(fake.state.audit.map((a) => a.action)).toContain('delivery_prepared');
    expect(JSON.stringify(fake.state.audit)).not.toContain(token);

    // The link works without a login, and serves exactly this certificate.
    const res = await fetch(link);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(Buffer.from(await res.arrayBuffer()).equals(fake.state.pdfs[0]!.bytes)).toBe(true);
    expect(fake.state.entries[0]!.link_opened_at).toBeTruthy();
  });

  it('the link stops working after 24 hours (410), is not guessable (404), and never lists other files', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await generate(page);
    const url = await sendAndCaptureWaUrl(page);
    const link = LINK_RE.exec(url.searchParams.get('text')!)![1]!;
    expect((await fetch(link)).status).toBe(200);

    // 24 hours pass.
    fake.state.links[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    const expired = await fetch(link);
    expect(expired.status).toBe(410);
    expect(expired.headers.get('content-type')).toContain('text/html');
    expect(await expired.text()).toContain('no longer works');

    // Unknown or malformed tokens: 404, with no file and no listing.
    for (const bad of [
      'A'.repeat(22),
      'short',
      '..%2f..%2fetc%2fpasswd',
      'x'.repeat(200),
      `${fake.state.entries[0]!.id}.pdf`,
    ]) {
      const r = await fetch(`${APP_URL}/c/${bad}`);
      expect([404, 400]).toContain(r.status);
      expect(r.headers.get('content-type')).not.toContain('application/pdf');
    }
    for (const dir of ['/c', '/c/']) {
      const r = await fetch(`${APP_URL}${dir}`, { redirect: 'manual' });
      expect(r.headers.get('content-type') ?? '').not.toContain('application/pdf');
      expect(r.status).not.toBe(200);
    }
  });

  it("a link serves only its own entry's PDF", async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await generate(page);
    const url = await sendAndCaptureWaUrl(page);
    const link = LINK_RE.exec(url.searchParams.get('text')!)![1]!;
    fake.state.pdfs.push({ path: 'other-entry.pdf', bytes: Buffer.from('%PDF-OTHER') }); // another entry's file
    const res = await fetch(link);
    expect(Buffer.from(await res.arrayBuffer()).equals(fake.state.pdfs[0]!.bytes)).toBe(true);
  });

  it('"Wrong number?" brings the form back as it was and makes a fresh entry for the new number', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await takePhoto(page);
    await page.check('#consent');
    await generate(page);
    await page.getByRole('button', { name: /Wrong number\?/ }).click();
    await expect(page.locator('#name')).toHaveValue('Ravi Kumar');
    await expect(page.locator('#phone')).toBeFocused();
    await expect(page.getByAltText(/Captured photo/)).toBeVisible(); // photo kept
    await page.fill('#phone', '9876543299');
    await generate(page);
    await expect(page.getByText('+91 98765 43299')).toBeVisible();
    expect(fake.state.entries).toHaveLength(2);
    expect(fake.state.links).toHaveLength(0); // nothing was ever prepared for the wrong number
    await sendAndCaptureWaUrl(page);
    expect(fake.state.links).toHaveLength(1);
    expect(fake.state.links[0]!.entry_id).toBe(fake.state.entries[1]!.id);
  });

  it('refuses to send a number that has opted out since the entry was made', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await generate(page);
    fake.state.optOuts.push(
      createHmac('sha256', appEnv.PHONE_HASH_SECRET).update('+919876543210').digest('hex'),
    );
    await page.getByRole('button', { name: /Send on WhatsApp/ }).click();
    await expect(alertBox(page)).toContainText('asked not to receive messages');
    expect(fake.state.links).toHaveLength(0);
  });

  it('says clearly that wa.me cannot attach a file', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await generate(page);
    await expect(page.getByText(/wa\.me cannot attach a file/)).toBeVisible();
  });
});

describe('officer form: protections', () => {
  it('refuses a second certificate to the same number within 24 hours', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await generate(page);
    await page.getByRole('button', { name: /New entry/ }).click();
    await expect(page.getByText('Location confirmed')).toBeVisible();
    await fillForm(page, { name: 'Someone Else' });
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(alertBox(page)).toContainText('already sent to this number in the last 24 hours');
    expect(fake.state.entries).toHaveLength(1);
  });

  it('refuses a number on the opt-out list', async () => {
    fake.state.optOuts.push(
      createHmac('sha256', appEnv.PHONE_HASH_SECRET).update('+919876543210').digest('hex'),
    );
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(alertBox(page)).toContainText('asked not to receive messages');
    expect(fake.state.entries).toHaveLength(0);
  });

  it("refuses requests from another site, and requests for entries that are not the officer's", async () => {
    const page = await phone();
    await openForm(page);
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const other = '22222222-2222-4222-8222-222222222222';
    fake.state.entries.push({
      id: other,
      officer_id: 'someone-else',
      status: 'ready',
      pdf_path: 'x.pdf',
      cert_code: 'X',
    });
    const post = (path: string, origin: string | null = APP_URL) =>
      fetch(`${APP_URL}${path}`, {
        method: 'POST',
        headers: { cookie, ...(origin ? { origin } : {}) },
      });
    for (const path of [`/api/entries/${other}/certificate`, `/api/entries/${other}/send`]) {
      expect((await post(path)).status, path).toBe(404);
      expect((await post(path, 'https://evil.example')).status, path).toBe(403);
      expect((await post(path, null)).status, path).toBe(403);
    }
    expect((await post('/api/entries/not-a-uuid/send')).status).toBe(404);
    expect(fake.state.links).toHaveLength(0);
  });
});

describe('accessibility basics on the officer screen', () => {
  async function audit(page: Page) {
    return page.evaluate(() => {
      const issues: string[] = [];
      const visible = (e: Element) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const inCertificate = (e: Element) => !!e.closest('[data-testid=certificate-preview]');

      // 1. Every control has an accessible name from a label (or aria-label).
      for (const el of document.querySelectorAll<HTMLInputElement>(
        'input:not([type=hidden]):not([type=file]), select, textarea',
      )) {
        if (!visible(el)) continue;
        const named =
          (el.labels && el.labels.length > 0) ||
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby');
        if (!named) issues.push(`no label: #${el.id || el.name}`);
      }
      // 2. Tap targets of at least 44 px (a checkbox counts through its label).
      for (const el of document.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type=hidden]):not([type=file]), select',
      )) {
        if (!visible(el) || inCertificate(el)) continue;
        const target =
          el instanceof HTMLInputElement && el.type === 'checkbox' ? (el.labels?.[0] ?? el) : el;
        const r = target.getBoundingClientRect();
        if (r.height < 43.5 || r.width < 43.5) {
          issues.push(
            `small target ${Math.round(r.width)}x${Math.round(r.height)}: ${el.tagName} ${(el.textContent || (el as HTMLInputElement).id || '').trim().slice(0, 30)}`,
          );
        }
      }
      // 3. Text contrast of at least 4.5:1 (3:1 for large text), outside the certificate graphic.
      // Tailwind colours come back as oklch(...): let a canvas turn any CSS colour into RGBA.
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const parse = (c: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return [r!, g!, b!, a! / 255];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const bgOf = (e: Element | null): number[] => {
        for (let n: Element | null = e; n; n = n.parentElement) {
          const [r, g, b, a = 1] = parse(getComputedStyle(n).backgroundColor);
          if (a > 0.5) return [r!, g!, b!];
        }
        return [255, 255, 255];
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set<Element>();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (
          !el ||
          seen.has(el) ||
          !n.textContent?.trim() ||
          !visible(el) ||
          inCertificate(el) ||
          el.closest('script,style,.sr-only')
        )
          continue;
        seen.add(el);
        const s = getComputedStyle(el);
        const [r, g, b] = parse(s.color);
        const [l1, l2] = [lum([r!, g!, b!]), lum(bgOf(el))].sort((a, c) => c - a);
        const ratio = (l1! + 0.05) / (l2! + 0.05);
        const size = Number.parseFloat(s.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5))
          issues.push(`low contrast ${ratio.toFixed(2)}: "${n.textContent.trim().slice(0, 30)}"`);
        if (size < 14) issues.push(`tiny text ${size}px: "${n.textContent.trim().slice(0, 30)}"`);
      }
      // 4. The basics of the page.
      if (!document.documentElement.lang) issues.push('no html lang');
      if (document.querySelectorAll('h1').length < 1) issues.push('no h1');
      if (!document.title) issues.push('no title');
      return issues;
    });
  }

  it('the form: labelled controls, 44 px targets, readable contrast', async () => {
    const page = await phone();
    await openForm(page);
    await expect(page.getByText('Location confirmed')).toBeVisible();
    await takePhoto(page); // shows the consent box too
    expect(await audit(page), 'accessibility problems').toEqual([]);
  });

  it('the form with errors showing', async () => {
    const page = await phone();
    await openForm(page);
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(alertBox(page).first()).toBeVisible();
    expect(await audit(page), 'accessibility problems').toEqual([]);
  });

  it('the certificate-ready screen with the number check and the message', async () => {
    const page = await phone();
    await openForm(page);
    await fillForm(page);
    await generate(page);
    expect(await audit(page), 'accessibility problems').toEqual([]);
  });

  it('shows a visible focus ring, and errors are announced as alerts', async () => {
    const page = await phone();
    await openForm(page);
    await page.locator('#name').focus();
    const outline = await page.locator('#name').evaluate((e) => getComputedStyle(e).outlineWidth);
    expect(Number.parseFloat(outline)).toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: /Generate certificate/ }).click();
    await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
    await expect(alertBox(page).first()).toBeVisible();
  });
});
