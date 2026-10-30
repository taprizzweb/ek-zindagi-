import { spawn, type ChildProcess } from 'node:child_process';
import { expect } from '@playwright/test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { APP_PORT, APP_URL, FAKE_SUPABASE_PORT, appEnv } from './env';
import { ADMIN, OFFICER, SUPERVISOR, startFakeSupabase } from './fake-supabase';

/**
 * Supervisor and admin screens, the kill switch and the retention job, in a real browser against the
 * production build. Supabase is the in-memory fake; nothing here is mocked in the app itself.
 */
let fake: Awaited<ReturnType<typeof startFakeSupabase>>;
let app: ChildProcess;
let browser: Browser;
const contexts: BrowserContext[] = [];

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
      stdio: process.env.E2E_APP_LOGS ? 'inherit' : 'ignore',
    },
  );
  await waitForApp();
  browser = await chromium.launch();
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

type Who = typeof OFFICER | typeof SUPERVISOR | typeof ADMIN;

async function signIn(who: Who, home: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    locale: 'en-IN',
  });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${APP_URL}/login`);
  await page.fill('#email', who.email);
  await page.fill('#password', who.password);
  await page.getByRole('button', { name: /Log in/ }).click();
  await page.waitForURL(`**${home}`);
  return page;
}

let seq = 0;
/** A row like the app stores it. `ago` is in minutes. */
function seed(over: Record<string, unknown> = {}, agoMinutes = 5) {
  const id = `90000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const at = new Date(Date.now() - agoMinutes * 60_000).toISOString();
  fake.state.entries.push({
    id,
    cert_code: `EKZ-JPR-OPS${String(seq).padStart(4, '0')}`,
    officer_id: OFFICER.id,
    violation: 'helmet',
    location_source: 'gps',
    photo_source: 'camera',
    consent_checked: true,
    reviewed: false,
    status: 'ready',
    created_at: at,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    person_name: 'Ravi Kumar',
    phone_e164: '+919876543210',
    phone_hash: String(seq).padStart(64, '0'),
    photo_path: null,
    pdf_path: null,
    sent_at: null,
    delivered_at: null,
    read_at: null,
    link_opened_at: null,
    purged_at: null,
    error_code: null,
    send_attempts: 0,
    retryable: false,
    next_retry_at: null,
    ...over,
  });
  return id;
}

const PERSONAL = /Ravi Kumar|9876543210/;

describe('who can see what', () => {
  it('an officer is sent away from the supervisor and admin pages', async () => {
    const page = await signIn(OFFICER, '/officer');
    await page.goto(`${APP_URL}/supervisor`);
    expect(new URL(page.url()).pathname).toBe('/officer');
    await page.goto(`${APP_URL}/admin/settings`);
    expect(new URL(page.url()).pathname).toBe('/officer');
    await page.goto(`${APP_URL}/admin/audit`);
    expect(new URL(page.url()).pathname).toBe('/officer');
  });

  it('only a supervisor or admin may use the new endpoints', async () => {
    const page = await signIn(OFFICER, '/officer');
    const id = seed({ status: 'failed', photo_source: 'gallery' });
    const call = (method: string, url: string, body?: unknown) =>
      page.evaluate(
        async ([m, u, b]) => {
          const r = await fetch(u as string, {
            method: m as string,
            headers: { 'Content-Type': 'application/json' },
            body: b ? JSON.stringify(b) : undefined,
          });
          return r.status;
        },
        [method, url, body] as const,
      );
    expect(await call('POST', '/api/campaign/pause', { paused: true })).toBe(403);
    expect(await call('PUT', '/api/admin/settings', { key: 'campaign_paused', value: true })).toBe(
      403,
    );
    expect(await call('POST', `/api/entries/${id}/review`)).toBe(403);
    expect(await call('POST', `/api/entries/${id}/retry`)).toBe(403);
    expect(await call('GET', '/api/supervisor/stats?range=week')).toBe(403);
    expect(fake.state.settings).toEqual([]);
  });

  it('a supervisor cannot change settings', async () => {
    const page = await signIn(SUPERVISOR, '/supervisor');
    const status = await page.evaluate(async () => {
      const r = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'retention_hours', value: 1 }),
      });
      return r.status;
    });
    expect(status).toBe(403);
    await page.goto(`${APP_URL}/admin/settings`);
    expect(new URL(page.url()).pathname).toBe('/supervisor');
  });
});

describe('supervisor screen', () => {
  it('shows counts by officer and violation without any personal data', async () => {
    seed({ status: 'sent', sent_at: new Date().toISOString() });
    seed({
      status: 'delivered',
      sent_at: new Date().toISOString(),
      delivered_at: new Date().toISOString(),
    });
    seed({ status: 'failed', error_code: 'wa_131026' });
    seed({ violation: 'seatbelt', status: 'ready' });
    const page = await signIn(SUPERVISOR, '/supervisor');
    const byOfficer = page.getByRole('table', { name: /by officer/ });
    const row = byOfficer.getByRole('row', { name: new RegExp(OFFICER.officerCode) });
    await expect(row.getByRole('cell').nth(0)).toHaveText('4'); // created
    await expect(row.getByRole('cell').nth(1)).toHaveText('2'); // sent
    await expect(row.getByRole('cell').nth(2)).toHaveText('1'); // delivered
    await expect(row.getByRole('cell').nth(4)).toHaveText('1'); // failed
    await expect(page.getByRole('table', { name: /by violation/ })).toContainText(/seatbelt/i);
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(PERSONAL);
  });

  it('lists failures with a readable reason, and no retry button in bridge mode', async () => {
    seed({ status: 'failed', error_code: 'wa_131026', pdf_path: 'x.pdf' });
    seed({ status: 'failed', error_code: 'ambiguous_network', pdf_path: 'y.pdf' });
    const page = await signIn(SUPERVISOR, '/supervisor');
    const failures = page.getByRole('region', { name: /Failures/ });
    await expect(failures).toContainText('Number is not on WhatsApp');
    await expect(failures).toContainText('Unknown whether the message was sent');
    await expect(failures.getByRole('button', { name: /Retry/ })).toHaveCount(0);
  });

  it('the review list shows the reasons, and "Mark reviewed" removes the entry and is audited', async () => {
    const id = seed({ photo_source: 'gallery' });
    seed({ location_source: 'manual' });
    seed({}); // nothing to review
    const page = await signIn(SUPERVISOR, '/supervisor');
    const review = page.getByRole('region', { name: /Review list/ });
    await expect(review.getByRole('listitem')).toHaveCount(2);
    await expect(review).toContainText('Photo from gallery');
    await expect(review).toContainText('Location typed by hand');
    await review
      .getByRole('listitem')
      .first()
      .getByRole('button', { name: /Mark reviewed/ })
      .click();
    await expect(review.getByRole('listitem')).toHaveCount(1);
    const done = fake.state.entries.filter((e) => e.reviewed === true);
    expect(done).toHaveLength(1);
    expect(done[0]!.reviewed_by).toBe(SUPERVISOR.id);
    expect(
      fake.state.audit.some((a) => a.action === 'entry_reviewed' && a.entry_id === done[0]!.id),
    ).toBe(true);
    expect(id).toBeTruthy();
  });

  it('downloads the counts as CSV, counts only', async () => {
    seed({ status: 'sent', sent_at: new Date().toISOString() });
    const page = await signIn(SUPERVISOR, '/supervisor');
    const get = (range: string) =>
      page.evaluate(async (r) => {
        const res = await fetch(`/api/supervisor/stats?range=${r}`);
        return {
          status: res.status,
          type: res.headers.get('content-type') ?? '',
          disposition: res.headers.get('content-disposition') ?? '',
          text: await res.text(),
        };
      }, range);
    const res = await get('week');
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/csv');
    expect(res.disposition).toContain('attachment');
    const csv = res.text;
    const [header, line] = csv.trim().split('\n');
    expect(header).toBe(
      'date,officer_code,violation,created,sent,delivered,read,failed,link_opened',
    );
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2},JP-0001,helmet,1,1,0,0,0,0$/);
    expect(csv).not.toMatch(PERSONAL);
    expect((await get('year')).status).toBe(400);
  });
});

describe('kill switch', () => {
  it('a supervisor pauses everything, and an officer cannot send until it is resumed', async () => {
    const sup = await signIn(SUPERVISOR, '/supervisor');
    await sup.getByRole('button', { name: /Pause campaign/ }).click();
    await sup.getByRole('button', { name: /Yes, pause everything/ }).click();
    await expect(sup.getByText(/PAUSED/)).toBeVisible();
    expect(fake.state.settings).toMatchObject([{ key: 'campaign_paused', value: true }]);
    expect(fake.state.audit.map((a) => a.action)).toContain('campaign_paused');

    const id = seed({ status: 'ready', pdf_path: 'p.pdf' });
    const officer = await signIn(OFFICER, '/officer');
    const send = () =>
      officer.evaluate(async (i) => {
        const r = await fetch(`/api/entries/${i}/send`, { method: 'POST' });
        return { status: r.status, body: (await r.json()) as { error?: { code: string } } };
      }, id);
    const blocked = await send();
    expect([blocked.status, blocked.body.error?.code]).toEqual([503, 'campaign_paused']);

    await sup.getByRole('button', { name: /Resume sending/ }).click();
    await expect(sup.getByText(/Running/)).toBeVisible();
    expect(fake.state.audit.map((a) => a.action)).toContain('campaign_resumed');
    expect((await send()).status).toBe(200);
  });
});

describe('admin screens', () => {
  it('changes the gallery fallback and the retention time, with an audit entry for each', async () => {
    const page = await signIn(ADMIN, '/admin');
    await page.goto(`${APP_URL}/admin/settings`);
    await page.getByRole('button', { name: /On: turn off/ }).click();
    await expect(page.getByRole('button', { name: /Off: turn on/ })).toBeVisible();
    await page.fill('#retention', '6');
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByRole('status')).toContainText('Saved');
    expect(fake.state.settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'allow_gallery_fallback', value: false }),
        expect.objectContaining({ key: 'retention_hours', value: 6 }),
      ]),
    );
    const changes = fake.state.audit.filter((a) => a.action === 'settings_changed');
    expect(changes.map((c) => c.meta)).toEqual([
      { key: 'allow_gallery_fallback', value: false },
      { key: 'retention_hours', value: 6 },
    ]);
  });

  it('refuses a bad retention time on the server too', async () => {
    const page = await signIn(ADMIN, '/admin');
    const status = (value: unknown) =>
      page.evaluate(async (v) => {
        const r = await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'retention_hours', value: v }),
        });
        return r.status;
      }, value);
    expect(await status(0)).toBe(400);
    expect(await status(169)).toBe(400);
    expect(await status('24')).toBe(400);
    expect(await status(1.5)).toBe(400);
    expect(fake.state.settings).toEqual([]);
  });

  it('with the gallery fallback off, the officer form no longer offers it', async () => {
    fake.state.settings.push({ key: 'allow_gallery_fallback', value: false });
    const officer = await signIn(OFFICER, '/officer');
    await officer.goto(`${APP_URL}/new`);
    await expect(officer.getByRole('button', { name: /Open camera/ })).toBeVisible();
    await expect(officer.getByRole('button', { name: /Camera not working/ })).toHaveCount(0);
  });

  it('shows the server settings as read-only', async () => {
    const page = await signIn(ADMIN, '/admin');
    await page.goto(`${APP_URL}/admin/settings`);
    await expect(page.getByText('DELIVERY_MODE')).toBeVisible();
    await expect(page.getByText('SHOW_POLICE_BRANDING')).toBeVisible();
    await expect(page.locator('input')).toHaveCount(1); // only the retention hours
  });

  it('the audit log can be filtered, and holds nothing personal', async () => {
    const page = await signIn(ADMIN, '/admin');
    fake.state.audit.push(
      {
        id: 100,
        at: new Date().toISOString(),
        action: 'entry_created',
        actor_code: 'JP-0001',
        entry_id: null,
        meta: {},
      },
      {
        id: 101,
        at: new Date().toISOString(),
        action: 'retention_run',
        actor_code: null,
        entry_id: null,
        meta: { purged: 7 },
      },
    );
    await page.goto(`${APP_URL}/admin/audit`);
    await expect(page.getByRole('cell', { name: 'entry_created' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'retention_run' })).toBeVisible();
    await page.selectOption('select[name=action]', 'retention_run');
    await page.getByRole('button', { name: /Filter/ }).click();
    await expect(page.getByRole('cell', { name: 'retention_run' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'entry_created' })).toHaveCount(0);
    await page.goto(`${APP_URL}/admin/audit?action=%27%3Bdrop`); // an unknown filter value is ignored
    await expect(page.getByRole('cell', { name: 'entry_created' })).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(PERSONAL);
  });
});

describe('retention job', () => {
  const run = (token?: string) =>
    fetch(`${APP_URL}/api/cron/retention`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('needs the cron secret', async () => {
    expect((await run()).status).toBe(401);
    expect((await run('wrong')).status).toBe(401);
  });

  it('deletes expired files and clears the personal fields, and leaves entries that are not due', async () => {
    const expired = seed(
      {
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        photo_path: 'o/expired.jpg',
        pdf_path: 'o/expired.pdf',
      },
      60 * 25,
    );
    const fresh = seed({ photo_path: 'o/fresh.jpg', pdf_path: 'o/fresh.pdf' });
    for (const p of ['o/expired.jpg', 'o/fresh.jpg'])
      fake.state.uploads.push({ path: p, bytes: Buffer.from('x') });
    for (const p of ['o/expired.pdf', 'o/fresh.pdf'])
      fake.state.pdfs.push({ path: p, bytes: Buffer.from('%PDF') });
    fake.state.links.push({
      entry_id: expired,
      token_hash: 'a'.repeat(64),
      expires_at: new Date().toISOString(),
    });

    const res = await run(appEnv.CRON_SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ purged: 1, failed: 0 });

    const e = fake.state.entries.find((r) => r.id === expired)!;
    expect(e).toMatchObject({
      person_name: null,
      phone_e164: null,
      photo_path: null,
      pdf_path: null,
    });
    expect(e.purged_at).toBeTruthy();
    expect(fake.state.uploads.map((u) => u.path)).toEqual(['o/fresh.jpg']);
    expect(fake.state.pdfs.map((u) => u.path)).toEqual(['o/fresh.pdf']);
    expect(fake.state.links).toEqual([]);
    expect(fake.state.entries.find((r) => r.id === fresh)).toMatchObject({
      person_name: 'Ravi Kumar',
    });
    const run1 = fake.state.audit.find((a) => a.action === 'retention_run');
    expect(run1?.meta).toMatchObject({ purged: 1, failed: 0 });
    expect(JSON.stringify(fake.state.audit)).not.toMatch(/expired|Ravi|9876543210/);
    // The code, hash and counts stay.
    expect(e).toMatchObject({ cert_code: expect.stringMatching(/^EKZ-/), violation: 'helmet' });
  });

  it('the supervisor screen reports when the job has not run, and what it deleted afterwards', async () => {
    const page = await signIn(SUPERVISOR, '/supervisor');
    await expect(page.getByRole('region', { name: /Data deletion/ })).toContainText(
      'has not run yet',
    );
    expect((await run(appEnv.CRON_SECRET)).status).toBe(200);
    await page.reload();
    await expect(page.getByRole('region', { name: /Data deletion/ })).toContainText('Last run');
  });

  it('flags leftovers: an entry long overdue shows up in the self-check', async () => {
    seed(
      { expires_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), photo_path: 'o/stuck.jpg' },
      60 * 30,
    );
    fake.state.uploads.push({ path: 'o/stuck.jpg', bytes: Buffer.from('x') });
    // Make the fake's storage refuse this deletion, so the entry stays and is reported.
    const original = fake.state.uploads;
    Object.defineProperty(fake.state, 'uploads', {
      configurable: true,
      get: () => original,
      set: () => {
        /* deletion "fails": the list is not changed */
      },
    });
    const res = await (await run(appEnv.CRON_SECRET)).json();
    expect(res).toMatchObject({ purged: 0, failed: 1 });
    expect(fake.state.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['retention_run', 'retention_leftover']),
    );
  });
});

describe('requests from citizens', () => {
  const code = 'EKZ-JPR-23456AB'; // replaced below by a code with a valid check character

  it("a supervisor deletes one entry's data by its certificate code, from the screen", async () => {
    const { generateCertCode } = await import('../../src/lib/domain/cert-code');
    const certCode = generateCertCode();
    const id = seed({ cert_code: certCode, photo_path: 'o/r.jpg', pdf_path: 'o/r.pdf' });
    const other = seed({ photo_path: 'o/keep.jpg', pdf_path: 'o/keep.pdf' });
    fake.state.uploads.push(
      { path: 'o/r.jpg', bytes: Buffer.from('x') },
      { path: 'o/keep.jpg', bytes: Buffer.from('x') },
    );
    fake.state.pdfs.push(
      { path: 'o/r.pdf', bytes: Buffer.from('%PDF') },
      { path: 'o/keep.pdf', bytes: Buffer.from('%PDF') },
    );

    const page = await signIn(SUPERVISOR, '/supervisor');
    await page.getByRole('link', { name: /Requests from citizens/ }).click();
    await page.waitForURL('**/requests');
    await page.fill('#cert-code', certCode.toLowerCase());
    await page.getByRole('button', { name: /Delete data now/ }).click();
    await page.getByRole('button', { name: /Yes, delete/ }).click();
    await expect(page.getByRole('status')).toContainText('has been deleted');

    expect(fake.state.entries.find((e) => e.id === id)).toMatchObject({
      person_name: null,
      phone_e164: null,
      pdf_path: null,
    });
    expect(fake.state.entries.find((e) => e.id === other)).toMatchObject({
      person_name: 'Ravi Kumar',
    });
    expect(fake.state.uploads.map((u) => u.path)).toEqual(['o/keep.jpg']);
    expect(fake.state.pdfs.map((u) => u.path)).toEqual(['o/keep.pdf']);
    const a = fake.state.audit.find((x) => x.action === 'entry_purged_early');
    expect(a).toMatchObject({ actor_code: SUPERVISOR.officerCode, entry_id: id });
    expect(JSON.stringify(fake.state.audit)).not.toMatch(/Ravi|9876543210/);
    expect(code).toBeTruthy();
  });

  it('wrong, unknown and repeated codes are answered clearly', async () => {
    const { generateCertCode } = await import('../../src/lib/domain/cert-code');
    const page = await signIn(ADMIN, '/admin');
    const post = (certCode: string) =>
      page.evaluate(async (c) => {
        const r = await fetch('/api/requests/purge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ certCode: c }),
        });
        return { status: r.status, body: (await r.json()) as Record<string, unknown> };
      }, certCode);
    expect((await post('nonsense')).status).toBe(400);
    expect((await post(generateCertCode())).status).toBe(404);
    const known = generateCertCode();
    seed({ cert_code: known });
    expect((await post(known)).body).toMatchObject({ purged: true });
    expect((await post(known)).body).toMatchObject({ alreadyPurged: true });
  });

  it('adds a number to the opt-out list (hash only) and the next entry for it is refused', async () => {
    const page = await signIn(SUPERVISOR, '/supervisor');
    await page.goto(`${APP_URL}/requests`);
    await page.fill('#optout-phone', '98765 43210');
    await page.getByRole('button', { name: /Stop messaging this number/ }).click();
    await expect(page.getByRole('status')).toContainText('will not be messaged again');
    const { createHmac } = await import('node:crypto');
    const hash = createHmac('sha256', appEnv.PHONE_HASH_SECRET)
      .update('+919876543210')
      .digest('hex');
    expect(fake.state.optOuts).toEqual([hash]);
    expect(JSON.stringify(fake.state.audit)).not.toMatch(/9876543210/);
    expect(fake.state.audit.map((a) => a.action)).toContain('opt_out_added');
  });

  it('refuses a bad number, and an officer cannot use any of it', async () => {
    const sup = await signIn(SUPERVISOR, '/supervisor');
    const status = (url: string, body: unknown) =>
      sup.evaluate(
        async ([u, b]) =>
          (
            await fetch(u as string, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(b),
            })
          ).status,
        [url, body] as const,
      );
    expect(await status('/api/requests/opt-out', { phone: '12345' })).toBe(400);
    expect(await status('/api/requests/opt-out', { phone: '9876543210', extra: 1 })).toBe(400);
    const officer = await signIn(OFFICER, '/officer');
    const code403 = await officer.evaluate(async () => {
      const a = await fetch('/api/requests/opt-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9876543210' }),
      });
      const b = await fetch('/api/requests/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certCode: 'EKZ-JPR-AAAAAAA' }),
      });
      return [a.status, b.status];
    });
    expect(code403).toEqual([403, 403]);
    await officer.goto(`${APP_URL}/requests`);
    expect(new URL(officer.url()).pathname).toBe('/officer');
    expect(fake.state.optOuts).toEqual([]);
  });
});
