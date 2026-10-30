import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import { expect } from '@playwright/test';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { APP_PORT, APP_URL, FAKE_SUPABASE_PORT, appEnv } from './env';
import { pdfInfo, pdfText } from '../pdf/helpers';
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
  return page;
}

/** Error and notice boxes (not Next's hidden route announcer, which is also role=alert). */
const alertBox = (page: Page) => page.locator('[role=alert]:not(#__next-route-announcer__)');

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

async function fillBasics(
  page: Page,
  over: { name?: string; phone?: string; place?: string } = {},
) {
  await page.fill('#name', over.name ?? 'Ravi Kumar');
  await page.fill('#phone', over.phone ?? '9876543210');
  await page.selectOption('#violation', 'helmet');
  {
    const place = page.locator('#place');
    await place.waitFor();
    if (over.place !== undefined || (await place.inputValue()) === '')
      await place.fill(over.place ?? 'Sample Chauraha, Jaipur, Rajasthan');
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

  it('serves the page with the security headers and no CSP violations', async () => {
    const page = await phone();
    const res = await page.goto(`${APP_URL}/login`);
    const h = res!.headers();
    expect(h['content-security-policy']).toMatch(
      /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
    );
    expect(h['strict-transport-security']).toContain('max-age');
    expect(h['x-frame-options']).toBe('DENY');
    await login(page);
    expect(cspViolations).toEqual([]);
  });
});

describe('officer form: happy path with the live camera', () => {
  it('fills the form, takes a photo, confirms the number and saves', async () => {
    const page = await phone();
    await openForm(page);

    await expect(page.getByText('Location confirmed')).toBeVisible();
    await fillBasics(page);
    await page.getByRole('button', { name: /Open camera/ }).click();
    const capture = page.getByRole('button', { name: /Capture/ });
    await expect(capture).toBeEnabled();
    await capture.click();
    await expect(page.getByAltText(/Captured photo/)).toBeVisible();
    await page.check('#consent');
    await page.getByRole('button', { name: /Next/ }).click();

    // The number is shown back in large digits before anything is sent.
    await expect(page.getByText('Is this number correct?')).toBeVisible();
    await expect(page.getByText('+91 98765 43210')).toBeVisible();
    expect(fake.state.entries).toHaveLength(0);

    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(page.getByText('Entry saved')).toBeVisible();
    await expect(page.getByText('Certificate ready')).toBeVisible();
    await expect(page.getByText(/^EKZ-JPR-[2-9A-HJKMNP-Z]{7}$/)).toBeVisible();

    expect(fake.state.entries).toHaveLength(1);
    const e = fake.state.entries[0]!;
    expect(e).toMatchObject({
      officer_id: OFFICER.id,
      person_name: 'Ravi Kumar',
      phone_e164: '+919876543210',
      violation: 'helmet',
      area_name: 'Sample Chauraha, Jaipur, Rajasthan',
      location_source: 'gps',
      lat: 26.912,
      lng: 75.788,
      photo_source: 'camera',
      consent_checked: true,
      status: 'ready',
      pdf_path: `${e.id}.pdf`,
    });
    expect(e.phone_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(e.phone_hash)).not.toContain('9876543210');

    // The stored photo is a fresh JPEG with no metadata.
    expect(fake.state.uploads).toHaveLength(1);
    const meta = await sharp(fake.state.uploads[0]!.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1200);

    // The audit trail has no personal data.
    expect(fake.state.audit.map((a) => a.action)).toContain('entry_created');
    const auditText = JSON.stringify(fake.state.audit);
    for (const secret of ['Ravi', '9876543210', 'Sample Chauraha'])
      expect(auditText).not.toContain(secret);

    expect(cspViolations).toEqual([]);
  });

  it('lists the entry on the officer home screen afterwards', async () => {
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(page.getByText('Entry saved')).toBeVisible();
    await expect(page.getByText('Certificate ready')).toBeVisible();
    await page.goto(`${APP_URL}/officer`);
    await expect(page.getByText(/EKZ-JPR-/)).toBeVisible();
    await expect(page.getByText(/Ready to send/)).toBeVisible();
    await expect(page.getByText('Ravi')).toHaveCount(0);
    await expect(page.getByText('9876543210')).toHaveCount(0);
  });

  it('works without a photo and shows no consent box', async () => {
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await expect(page.locator('#consent')).toHaveCount(0);
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(page.getByText('Entry saved')).toBeVisible();
    await expect(page.getByText('Certificate ready')).toBeVisible();
    expect(fake.state.entries[0]).toMatchObject({
      photo_source: 'none',
      consent_checked: false,
      photo_path: null,
    });
    expect(fake.state.uploads).toHaveLength(0);
  });
});

describe('officer form: validation', () => {
  it('shows what is wrong, focuses the first problem, and keeps what was typed', async () => {
    const page = await phone();
    await openForm(page);
    await expect(page.getByText('Location confirmed')).toBeVisible();
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.locator('#name')).toBeFocused();
    await expect(alertBox(page).filter({ hasText: 'Enter a name' })).toBeVisible();
    await expect(alertBox(page).filter({ hasText: '10-digit mobile number' })).toBeVisible();
    await expect(alertBox(page).filter({ hasText: 'Choose the violation' })).toBeVisible();

    await page.fill('#name', 'Ravi Kumar');
    await page.fill('#phone', '1234567890'); // starts with 1
    await page.selectOption('#violation', 'helmet');
    await page.locator('#place').fill('Station Road, Jaipur');
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.locator('#phone')).toBeFocused();
    expect(page.url()).toContain('/new');
    expect(fake.state.entries).toHaveLength(0);
  });

  it('only lets digits into the number field, at most ten', async () => {
    const page = await phone();
    await openForm(page);
    await page.locator('#phone').pressSequentially('98a76-54321099');
    await expect(page.locator('#phone')).toHaveValue('9876543210');
  });

  it('keeps the data when the officer goes back from the confirm screen to fix the number', async () => {
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Edit/ }).click();
    await expect(page.locator('#name')).toHaveValue('Ravi Kumar');
    await page.fill('#phone', '9876543299');
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.getByText('+91 98765 43299')).toBeVisible();
  });

  it('needs the type and the text under "Other"', async () => {
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await page.selectOption('#violation', 'other');
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.locator('#otherChoice')).toBeFocused();
    await page.selectOption('#otherChoice', 'typed');
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.locator('#otherTyped')).toBeFocused();
    await page.fill('#otherTyped', 'No indicator');
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(page.getByText('Entry saved')).toBeVisible();
    await expect(page.getByText('Certificate ready')).toBeVisible();
    expect(fake.state.entries[0]).toMatchObject({ violation: 'other', other_text: 'No indicator' });
  });

  it('will not continue with a photo until consent is ticked', async () => {
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await page.getByRole('button', { name: /Open camera/ }).click();
    await page.getByRole('button', { name: /Capture/ }).click();
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.locator('#consent')).toBeFocused();
    await expect(alertBox(page).filter({ hasText: 'Confirm consent' })).toBeVisible();
    await page.check('#consent');
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.getByText('Is this number correct?')).toBeVisible();
  });

  it('lets the officer retake or remove the photo', async () => {
    const page = await phone();
    await openForm(page);
    await page.getByRole('button', { name: /Open camera/ }).click();
    await page.getByRole('button', { name: /Capture/ }).click();
    await expect(page.getByAltText(/Captured photo/)).toBeVisible();
    await page.getByRole('button', { name: /Retake/ }).click();
    await page.getByRole('button', { name: /Capture/ }).click();
    await expect(page.getByAltText(/Captured photo/)).toBeVisible();
    await page.getByRole('button', { name: /Remove photo/ }).click();
    await expect(page.getByAltText(/Captured photo/)).toHaveCount(0);
    await expect(page.locator('#consent')).toHaveCount(0);
  });
});

describe('officer form: GPS denied', () => {
  it('falls back to a typed place and records the entry as manual', async () => {
    const page = await phone({ gps: false });
    await openForm(page);
    await expect(page.getByText('Location is not available')).toBeVisible();
    await fillBasics(page, { place: 'Station Road, Jaipur' });
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(page.getByText('Entry saved')).toBeVisible();
    await expect(page.getByText('Certificate ready')).toBeVisible();
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
    await fillBasics(page, { place: '' });
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.locator('#place')).toBeFocused();
  });
});

describe('officer form: gallery fallback', () => {
  async function denyCamera(page: Page) {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
  }

  it('explains the camera problem, asks for a reason and flags the entry', async () => {
    const page = await phone();
    await denyCamera(page);
    await openForm(page);
    await fillBasics(page);
    await page.getByRole('button', { name: /Open camera/ }).click();
    await expect(alertBox(page).filter({ hasText: 'Camera permission was denied' })).toBeVisible();

    await page.getByRole('button', { name: /Camera not working\? Use gallery/ }).click();
    await expect(page.locator('#galleryReason')).toHaveValue('permission_denied'); // pre-selected
    await page.setInputFiles('input[type=file]', await exifJpeg());
    await expect(page.getByAltText(/Captured photo/)).toBeVisible();
    await page.check('#consent');
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(page.getByText('Entry saved')).toBeVisible();
    await expect(page.getByText('Certificate ready')).toBeVisible();

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
});

describe('officer form: bad network', () => {
  it('keeps everything on screen, and sending again does not create a second entry', async () => {
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await page.getByRole('button', { name: /Next/ }).click();

    // The server receives and stores the entry, but the answer never reaches the phone.
    let first = true;
    await page.route('**/api/entries', async (route) => {
      if (first) {
        first = false;
        await route.fetch();
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(alertBox(page)).toContainText('No network');
    await expect(page.getByText('+91 98765 43210')).toBeVisible();
    expect(fake.state.entries).toHaveLength(1);

    await page.getByRole('button', { name: /Send again/ }).click();
    await expect(page.getByText('Entry saved')).toBeVisible();
    await expect(page.getByText('Certificate ready')).toBeVisible();
    expect(fake.state.entries).toHaveLength(1);
    expect(fake.state.audit.filter((a) => a.action === 'entry_created')).toHaveLength(1);
  });
});

describe('officer form: protections', () => {
  it('refuses a second certificate to the same number within 24 hours', async () => {
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(page.getByText('Entry saved')).toBeVisible();
    await expect(page.getByText('Certificate ready')).toBeVisible();

    await page.getByRole('button', { name: /New entry/ }).click();
    await expect(page.getByText('Location confirmed')).toBeVisible();
    await fillBasics(page, { name: 'Someone Else' });
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(alertBox(page)).toContainText('already sent to this number in the last 24 hours');
    expect(fake.state.entries).toHaveLength(1);
  });

  it('refuses a number on the opt-out list', async () => {
    const { createHmac } = await import('node:crypto');
    fake.state.optOuts.push(
      createHmac('sha256', appEnv.PHONE_HASH_SECRET).update('+919876543210').digest('hex'),
    );
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(alertBox(page)).toContainText('asked not to receive messages');
    expect(fake.state.entries).toHaveLength(0);
  });

  it('refuses a cross-origin submission, and a same-origin one with no valid data', async () => {
    const page = await phone();
    await openForm(page);
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const post = (origin: string) => {
      const fd = new FormData();
      fd.set('data', '{}');
      return fetch(`${APP_URL}/api/entries`, {
        method: 'POST',
        headers: { cookie, origin },
        body: fd,
      });
    };
    expect((await post('https://evil.example')).status).toBe(403);
    expect((await post(APP_URL)).status).toBe(400); // same origin, but invalid data: refused, not a crash
    expect(fake.state.entries).toHaveLength(0);
  });
});

describe('certificate PDF', () => {
  it('is created after the entry is saved, with the right content, and the entry becomes ready', async () => {
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await page.getByRole('button', { name: /Open camera/ }).click();
    await page.getByRole('button', { name: /Capture/ }).click();
    await page.check('#consent');
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(page.getByText('Certificate ready')).toBeVisible();

    const entry = fake.state.entries[0]!;
    expect(entry).toMatchObject({ status: 'ready', pdf_path: `${entry.id}.pdf`, error_code: null });
    expect(fake.state.pdfs).toHaveLength(1);
    const pdf = fake.state.pdfs[0]!.bytes;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeLessThan(1.5 * 1024 * 1024);
    expect(pdfInfo(pdf).Pages).toBe('1');
    expect(pdfInfo(pdf).Title).toContain(String(entry.cert_code));
    const text = pdfText(pdf);
    for (const s of [
      'RAVI KUMAR',
      'Riding without a helmet',
      'Sample Chauraha, Jaipur, Rajasthan',
      String(entry.cert_code),
      'Wear your helmet. Someone is waiting for you at home.',
      'Disclaimer:',
    ]) {
      expect(text, s).toContain(s);
    }
    // The rotated stamp and watermark extract letter by letter; compare letters only.
    const letters = text.replace(/[^A-Za-z]/g, '').toUpperCase();
    expect(letters).toContain('NOTALEGALDOCUMENT');
    expect(letters).toContain('FORAWARENESSPURPOSEONLYHYPOTHETICAL');
    expect(text).not.toMatch(/police/i);
    expect(fake.state.audit.map((a) => a.action)).toEqual([
      'login',
      'entry_created',
      'certificate_generated',
    ]);
    expect(JSON.stringify(fake.state.audit)).not.toMatch(/Ravi|9876543210|Chauraha/);
  });

  it('asking again does not create a second PDF', async () => {
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(page.getByText('Certificate ready')).toBeVisible();
    const id = String(fake.state.entries[0]!.id);
    const again = await page.evaluate(async (entryId) => {
      const r = await fetch(`/api/entries/${entryId}/certificate`, { method: 'POST' });
      return { status: r.status, body: await r.json() };
    }, id);
    expect(again).toEqual({ status: 200, body: { status: 'ready' } });
    expect(fake.state.audit.filter((a) => a.action === 'certificate_generated')).toHaveLength(1);
  });

  it('offers to try again if the certificate request fails, and the entry is not lost', async () => {
    const page = await phone();
    await openForm(page);
    await fillBasics(page);
    await page.getByRole('button', { name: /Next/ }).click();
    let first = true;
    await page.route('**/api/entries/*/certificate', async (route) => {
      if (first) {
        first = false;
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    await page.getByRole('button', { name: /Send certificate/ }).click();
    await expect(page.getByText('Entry saved')).toBeVisible();
    await expect(alertBox(page)).toContainText('No network');
    expect(fake.state.entries).toHaveLength(1);
    expect(fake.state.pdfs).toHaveLength(0);
    await page.getByRole('button', { name: /Try again/ }).click();
    await expect(page.getByText('Certificate ready')).toBeVisible();
    expect(fake.state.pdfs).toHaveLength(1);
    expect(fake.state.entries[0]).toMatchObject({ status: 'ready' });
  });

  it("refuses someone else's, unknown and malformed entry ids, and a request from another site", async () => {
    const page = await phone();
    await openForm(page);
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const post = (id: string, origin: string | null = APP_URL) =>
      fetch(`${APP_URL}/api/entries/${id}/certificate`, {
        method: 'POST',
        headers: { cookie, ...(origin ? { origin } : {}) },
      });
    const other = '22222222-2222-4222-8222-222222222222';
    fake.state.entries.push({
      id: other,
      officer_id: 'someone-else',
      status: 'saved',
      cert_code: 'X',
    });
    expect((await post('not-a-uuid')).status).toBe(404);
    expect((await post('11111111-1111-4111-8111-111111111111')).status).toBe(404);
    expect((await post(other)).status).toBe(404);
    expect(fake.state.entries[0]!.status).toBe('saved'); // not touched
    expect((await post(other, 'https://evil.example')).status).toBe(403);
    expect((await post(other, null)).status).toBe(403);
  });
});
