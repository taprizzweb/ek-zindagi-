import { spawn, type ChildProcess } from 'node:child_process';
import { expect } from '@playwright/test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { APP_PORT, APP_URL, FAKE_SUPABASE_PORT, appEnv } from './env';
import { ADMIN, startFakeSupabase } from './fake-supabase';

/** Team links: no password for officers, one link per station, revocable by the admin. Real browser, production build. */
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

async function newPage(): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    locale: 'en-IN',
  });
  contexts.push(context);
  return context.newPage();
}

async function adminPage(): Promise<Page> {
  const page = await newPage();
  await page.goto(`${APP_URL}/login`);
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', ADMIN.password);
  await page.getByRole('button', { name: /Log in/ }).click();
  await page.waitForURL('**/admin');
  return page;
}

/** The admin makes a team and returns its link. */
async function makeTeam(admin: Page, label = 'Mansarovar Thana'): Promise<string> {
  await admin.goto(`${APP_URL}/admin/teams`);
  await admin.fill('#label', label);
  await admin.getByRole('button', { name: /Make link/ }).click();
  const link = await admin.getByTestId('team-link').innerText();
  expect(link).toMatch(new RegExp(`^${APP_URL}/go/[A-Za-z0-9_-]{22}$`));
  return link;
}

describe('making a team', () => {
  it('the admin gets a link once; only its hash is stored, and the team has no password anybody knows', async () => {
    const admin = await adminPage();
    const link = await makeTeam(admin);
    const token = link.split('/go/')[1]!;
    expect(fake.state.accessLinks).toHaveLength(1);
    expect(fake.state.accessLinks[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(fake.state)).not.toContain(token);
    const team = fake.state.profiles.find((p) => p.id === fake.state.accessLinks[0]!.profile_id)!;
    expect(team).toMatchObject({
      role: 'officer',
      active: true,
      must_change_password: false,
      display_name: 'Mansarovar Thana',
    });
    expect(fake.state.audit.map((a) => a.action)).toContain('team_created');
    // the link is not shown again after reload
    await admin.reload();
    await expect(admin.getByTestId('team-link')).toHaveCount(0);
    await expect(admin.getByText('Mansarovar Thana')).toBeVisible();
  });

  it('only an admin can make or change a team', async () => {
    const page = await newPage();
    const status = (method: string, url: string, body: unknown) =>
      page.evaluate(
        async ([m, u, b]) =>
          (
            await fetch(u as string, {
              method: m as string,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(b),
            })
          ).status,
        [method, url, body] as const,
      );
    await page.goto(`${APP_URL}/login`);
    expect(await status('POST', '/api/admin/teams', { label: 'Nope' })).toBe(401);
    expect(
      await status('PATCH', '/api/admin/teams/00000000-0000-4000-8000-000000000001', {
        action: 'disable',
      }),
    ).toBe(401);
    expect(fake.state.accessLinks).toEqual([]);
  });
});

describe('a team phone', () => {
  it('opens the link and lands on the form, signed in with no password and no sign-out button', async () => {
    const admin = await adminPage();
    const link = await makeTeam(admin);

    const phone = await newPage();
    await phone.goto(link);
    await phone.waitForURL('**/new');
    await expect(phone.locator('#name')).toBeVisible();
    await expect(phone.getByRole('button', { name: /Log out/ })).toHaveCount(0);

    const cookie = (await phone.context().cookies()).find((c) => c.name === 'ekz_team')!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
    expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 86400); // stays on the phone for a year
    expect(fake.state.accessLinks[0]!.last_used_at).toBeTruthy();

    await phone.reload();
    await expect(phone.locator('#name')).toBeVisible(); // still signed in
    await phone.goto(`${APP_URL}/admin`);
    expect(new URL(phone.url()).pathname).toBe('/officer'); // not an admin
    await expect(phone.getByRole('link', { name: /New entry/ })).toBeVisible();
  });

  it('can make entries as its team, and cannot use any admin call', async () => {
    const admin = await adminPage();
    const link = await makeTeam(admin);
    const phone = await newPage();
    await phone.goto(link);
    await phone.waitForURL('**/new');
    const result = await phone.evaluate(async () => {
      const f = new FormData();
      f.set(
        'data',
        JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          name: 'Ravi Kumar',
          phone: '9876543210',
          violation: 'helmet',
          location: { source: 'manual', areaName: 'Sindhi Camp' },
          photoSource: 'none',
          consentChecked: false,
        }),
      );
      const created = await fetch('/api/entries', { method: 'POST', body: f });
      const denied: number[] = [];
      for (const [m, u] of [
        ['POST', '/api/admin/teams'],
        ['PUT', '/api/admin/settings'],
        ['POST', '/api/campaign/pause'],
        ['GET', '/api/supervisor/stats?range=week'],
        ['POST', '/api/requests/opt-out'],
      ] as const) {
        denied.push(
          (
            await fetch(u, {
              method: m,
              headers: { 'Content-Type': 'application/json' },
              body: m === 'GET' ? undefined : '{}',
            })
          ).status,
        );
      }
      return { created: created.status, denied };
    });
    expect(result.created).toBe(201);
    expect(result.denied).toEqual([403, 403, 403, 403, 403]);
    expect(fake.state.entries[0]!.officer_id).toBe(fake.state.accessLinks[0]!.profile_id);
  });

  it('a made-up, malformed or forged link gets nothing', async () => {
    const page = await newPage();
    for (const path of [
      '/go/AAAAAAAAAAAAAAAAAAAAAA',
      '/go/short',
      '/go/' + 'x'.repeat(40),
      '/go/%00',
    ]) {
      await page.goto(`${APP_URL}${path}`);
      expect(new URL(page.url()).pathname, path).toBe('/login');
      await expect(page.getByText('This link is not active')).toBeVisible();
    }
    expect((await page.context().cookies()).some((c) => c.name === 'ekz_team')).toBe(false);
    await page
      .context()
      .addCookies([{ name: 'ekz_team', value: 'Zm9yZ2Vk.Zm9yZ2Vk', url: APP_URL }]);
    await page.goto(`${APP_URL}/new`);
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  it('guessing links is limited', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 45; i++)
      codes.push(
        (await fetch(`${APP_URL}/go/${'A'.repeat(21)}${i % 10}`, { redirect: 'manual' })).status,
      );
    expect(codes.slice(0, 40).every((c) => c === 302)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('ending access', () => {
  it('a new link stops the old link and every phone that used it, at once', async () => {
    const admin = await adminPage();
    const oldLink = await makeTeam(admin);
    const phone = await newPage();
    await phone.goto(oldLink);
    await phone.waitForURL('**/new');

    await admin.goto(`${APP_URL}/admin/teams`);
    await admin.getByRole('button', { name: /New link/ }).click();
    await admin.getByRole('button', { name: /Yes/ }).click();
    const newLink = await admin.getByTestId('team-link').innerText();
    expect(newLink).not.toBe(oldLink);
    expect(fake.state.audit.map((a) => a.action)).toContain('team_link_changed');

    await phone.goto(`${APP_URL}/new`);
    expect(new URL(phone.url()).pathname).toBe('/login'); // the phone that had the old link
    const other = await newPage();
    await other.goto(oldLink);
    expect(new URL(other.url()).pathname).toBe('/login'); // the old link itself
    const fresh = await newPage();
    await fresh.goto(newLink);
    await fresh.waitForURL('**/new');
  });

  it('switching a team off stops its phones; switching on brings them back', async () => {
    const admin = await adminPage();
    const link = await makeTeam(admin);
    const phone = await newPage();
    await phone.goto(link);
    await phone.waitForURL('**/new');

    await admin.goto(`${APP_URL}/admin/teams`);
    await admin.getByRole('button', { name: /Switch off/ }).click();
    await admin.getByRole('button', { name: /Yes/ }).click();
    await expect(admin.getByText(/Off$/)).toBeVisible();
    await phone.goto(`${APP_URL}/new`);
    expect(new URL(phone.url()).pathname).toBe('/login');
    const stranger = await newPage();
    await stranger.goto(link);
    expect(new URL(stranger.url()).pathname).toBe('/login');

    await admin.getByRole('button', { name: /Switch on/ }).click();
    await expect(admin.getByText(/On$/)).toBeVisible();
    await phone.goto(`${APP_URL}/new`);
    await expect(phone.locator('#name')).toBeVisible();
  });
});

describe('installing on the phone', () => {
  it('serves a manifest that makes it an app-like icon that opens the form', async () => {
    const res = await fetch(`${APP_URL}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    const m = (await res.json()) as {
      start_url: string;
      display: string;
      icons: { src: string; sizes: string }[];
    };
    expect([m.start_url, m.display]).toEqual(['/new', 'standalone']);
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const i of m.icons) expect((await fetch(`${APP_URL}${i.src}`)).status).toBe(200);
  });
});
