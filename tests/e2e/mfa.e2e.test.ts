import { spawn, type ChildProcess } from 'node:child_process';
import { expect } from '@playwright/test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { counterAt, totpAt } from '../../src/lib/auth/totp';
import { APP_PORT, APP_URL, FAKE_SUPABASE_PORT, appEnv } from './env';
import { ADMIN, OFFICER, SUPERVISOR, startFakeSupabase } from './fake-supabase';
import { currentCode, secretFor, seedMfa } from './mfa-helpers';

/** The second sign-in step for supervisors and admins, in a real browser against the production build. */
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

async function newPage(): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    locale: 'en-IN',
  });
  contexts.push(context);
  return context.newPage();
}

/** Password step only. */
async function passwordLogin(page: Page, who: Who) {
  await page.goto(`${APP_URL}/login`);
  await page.fill('#email', who.email);
  await page.fill('#password', who.password);
  await page.getByRole('button', { name: /Log in/ }).click();
}

const codeStep = async (page: Page, code: string) => {
  await page.fill('#code', code);
  await page.getByRole('button', { name: /Verify/ }).click();
};

/** A code that is refused: the form clears itself when the answer arrives, so wait for that before typing again. */
const refusedCode = async (page: Page, code: string) => {
  await codeStep(page, code);
  await expect(page.locator('[role=alert]:not(#__next-route-announcer__)')).toBeVisible();
  await expect(page.locator('#code')).toHaveValue('');
  await expect(page.getByRole('button', { name: /Verify/ })).toBeDisabled(); // empty field, not busy
};

describe('first sign-in: set-up', () => {
  it('shows the QR and key, refuses a wrong code, and a right code finishes the set-up', async () => {
    const page = await newPage();
    await passwordLogin(page, SUPERVISOR);
    await page.waitForURL('**/mfa');
    await expect(page.getByAltText('QR code')).toBeVisible();
    const shown = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
    expect(shown).toMatch(/^[A-Z2-7]{32}$/);

    await refusedCode(page, '000000');
    await expect(page.locator('[role=alert]:not(#__next-route-announcer__)')).toContainText(
      'The code is wrong or was already used',
    );
    expect(new URL(page.url()).pathname).toBe('/mfa');
    expect(fake.state.totp[0]).toMatchObject({ confirmed: false });

    await codeStep(page, totpAt(shown, counterAt(Date.now())));
    await page.waitForURL('**/supervisor');
    expect(fake.state.totp[0]).toMatchObject({ profile_id: SUPERVISOR.id, confirmed: true });
    const actions = fake.state.audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['mfa_failed', 'mfa_enrolled']));
    // The database holds the secret encrypted, never as shown to the person.
    expect(String(fake.state.totp[0]!.secret_enc)).toMatch(/^v1\./);
    expect(JSON.stringify(fake.state)).not.toContain(shown);
  });

  it('shows the same key again if the person leaves and comes back before finishing', async () => {
    const page = await newPage();
    await passwordLogin(page, ADMIN);
    await page.waitForURL('**/mfa');
    const first = await page.getByTestId('totp-secret').innerText();
    await page.goto(`${APP_URL}/mfa`);
    expect(await page.getByTestId('totp-secret').innerText()).toBe(first);
  });
});

describe('nothing opens before the code', () => {
  it('every supervisor and admin page goes to the code page, and their APIs say a code is needed', async () => {
    const page = await newPage();
    await passwordLogin(page, ADMIN);
    await page.waitForURL('**/mfa');
    for (const path of [
      '/admin',
      '/admin/officers',
      '/admin/settings',
      '/admin/audit',
      '/requests',
      '/officer',
      '/supervisor',
      '/new',
    ]) {
      await page.goto(`${APP_URL}${path}`);
      expect(new URL(page.url()).pathname, path).toBe('/mfa');
    }
    const calls = await page.evaluate(async () => {
      const out: Record<string, { status: number; code?: string }> = {};
      for (const [method, url] of [
        ['POST', '/api/campaign/pause'],
        ['PUT', '/api/admin/settings'],
        ['GET', '/api/supervisor/stats?range=week'],
        ['POST', '/api/requests/opt-out'],
        ['POST', '/api/admin/officers'],
        ['POST', '/api/entries'],
      ] as const) {
        const r = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: method === 'GET' ? undefined : '{}',
        });
        out[url] = {
          status: r.status,
          code: ((await r.json()) as { error?: { code: string } }).error?.code,
        };
      }
      return out;
    });
    for (const [url, r] of Object.entries(calls))
      expect(r, url).toEqual({ status: 403, code: 'mfa_required' });
    expect(fake.state.settings).toEqual([]);
  });

  it('a forged, borrowed or stale cookie does not count', async () => {
    const page = await newPage();
    await passwordLogin(page, SUPERVISOR);
    await page.waitForURL('**/mfa');
    for (const value of ['1', 'garbage.garbage', 'eHh4.eHh4']) {
      await page.context().addCookies([{ name: 'ekz_mfa', value, url: APP_URL }]);
      await page.goto(`${APP_URL}/supervisor`);
      expect(new URL(page.url()).pathname, value).toBe('/mfa');
    }
    // A genuine cookie of ANOTHER account (the admin's) is no use to the supervisor.
    const adminPage = await newPage();
    seedMfa(fake, ADMIN.id);
    await passwordLogin(adminPage, ADMIN);
    await adminPage.waitForURL('**/mfa');
    await codeStep(adminPage, currentCode(fake, ADMIN.id));
    await adminPage.waitForURL('**/admin');
    const adminCookie = (await adminPage.context().cookies()).find((c) => c.name === 'ekz_mfa')!;
    await page.context().addCookies([{ name: 'ekz_mfa', value: adminCookie.value, url: APP_URL }]);
    await page.goto(`${APP_URL}/supervisor`);
    expect(new URL(page.url()).pathname).toBe('/mfa');
  });

  it('an officer is never asked for a code, and the code page sends them home', async () => {
    const page = await newPage();
    await passwordLogin(page, OFFICER);
    await page.waitForURL('**/officer');
    await page.goto(`${APP_URL}/mfa`);
    expect(new URL(page.url()).pathname).toBe('/officer');
    expect(fake.state.totp).toEqual([]);
  });
});

describe('later sign-ins', () => {
  it('need a code every time; a code that was already used is refused; the next one works', async () => {
    seedMfa(fake, SUPERVISOR.id);
    const secret = secretFor(SUPERVISOR.id);
    const page = await newPage();
    await passwordLogin(page, SUPERVISOR);
    await page.waitForURL('**/mfa');
    await expect(page.getByAltText('QR code')).toHaveCount(0); // set-up is done: no key on show
    const c = counterAt(Date.now());
    await codeStep(page, totpAt(secret, c));
    await page.waitForURL('**/supervisor');

    // sign out, sign in again: the same code is a replay
    await page.getByRole('button', { name: /Log out|Sign out|लॉग आउट/ }).click();
    await page.waitForURL('**/login');
    await passwordLogin(page, SUPERVISOR);
    await page.waitForURL('**/mfa');
    await refusedCode(page, totpAt(secret, c));
    expect(new URL(page.url()).pathname).toBe('/mfa');
    await codeStep(page, totpAt(secret, c + 1)); // the next 30-second code is inside the allowed drift
    await page.waitForURL('**/supervisor');
    const verified = fake.state.audit.filter((a) => a.action === 'mfa_verified');
    expect(verified).toHaveLength(2);
  });

  it('six wrong codes lock the code step, even for the right code', async () => {
    seedMfa(fake, SUPERVISOR.id);
    const page = await newPage();
    await passwordLogin(page, SUPERVISOR);
    await page.waitForURL('**/mfa');
    for (let i = 0; i < 6; i++) await refusedCode(page, '000000');
    await codeStep(page, currentCode(fake, SUPERVISOR.id));
    await expect(page.locator('[role=alert]:not(#__next-route-announcer__)')).toContainText(
      /Too many|बहुत/,
    );
    expect(new URL(page.url()).pathname).toBe('/mfa');
  });

  it('only the code step may be reached with a password alone, and the code is checked on the server', async () => {
    seedMfa(fake, SUPERVISOR.id);
    const page = await newPage();
    await passwordLogin(page, SUPERVISOR);
    await page.waitForURL('**/mfa');
    const status = await page.evaluate(async () => {
      const bad = ['12345', '1234567', 'abcdef', '', null];
      const out: number[] = [];
      for (const code of bad) {
        out.push(
          (
            await fetch('/api/auth/mfa', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code }),
            })
          ).status,
        );
      }
      out.push(
        (
          await fetch('/api/auth/mfa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: '123456', extra: 1 }),
          })
        ).status,
      );
      return out;
    });
    expect(status).toEqual([400, 400, 400, 400, 400, 400]);
  });
});

describe('lost phone', () => {
  it("an admin clears a supervisor's set-up; the supervisor sets up again with a NEW key", async () => {
    seedMfa(fake, SUPERVISOR.id);
    seedMfa(fake, ADMIN.id);
    const adminPage = await newPage();
    await passwordLogin(adminPage, ADMIN);
    await adminPage.waitForURL('**/mfa');
    await codeStep(adminPage, currentCode(fake, ADMIN.id));
    await adminPage.waitForURL('**/admin');
    await adminPage.goto(`${APP_URL}/admin/officers`);
    await adminPage.getByRole('button', { name: /Reset security code/ }).click();
    await adminPage.getByRole('button', { name: /Clear set-up/ }).click();
    await expect
      .poll(() => fake.state.totp.some((f) => f.profile_id === SUPERVISOR.id))
      .toBe(false);
    expect(fake.state.totp.some((f) => f.profile_id === ADMIN.id)).toBe(true);
    expect(fake.state.audit.map((a) => a.action)).toContain('mfa_reset');

    const supPage = await newPage();
    await passwordLogin(supPage, SUPERVISOR);
    await supPage.waitForURL('**/mfa');
    const fresh = (await supPage.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
    expect(fresh).not.toBe(secretFor(SUPERVISOR.id));
  });

  it('only an admin can do it, and not to an officer or to themselves', async () => {
    seedMfa(fake, SUPERVISOR.id);
    const sup = await newPage();
    await passwordLogin(sup, SUPERVISOR);
    await sup.waitForURL('**/mfa');
    await codeStep(sup, currentCode(fake, SUPERVISOR.id));
    await sup.waitForURL('**/supervisor');
    const patch = (page: Page, id: string) =>
      page.evaluate(
        async (i) =>
          (
            await fetch(`/api/admin/officers/${i}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'reset_mfa' }),
            })
          ).status,
        id,
      );
    expect(await patch(sup, SUPERVISOR.id)).toBe(403);

    seedMfa(fake, ADMIN.id);
    const admin = await newPage();
    await passwordLogin(admin, ADMIN);
    await admin.waitForURL('**/mfa');
    await codeStep(admin, currentCode(fake, ADMIN.id));
    await admin.waitForURL('**/admin');
    expect(await patch(admin, ADMIN.id)).toBe(403); // not on themselves
    expect(await patch(admin, OFFICER.id)).toBe(403); // officers have none
    expect(fake.state.totp.some((f) => f.profile_id === SUPERVISOR.id)).toBe(true);
  });
});

describe('password guessing', () => {
  const attempt = (email: string, password: string) =>
    fetch(`${APP_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ email, password }),
    });

  it('one account is throttled after ten tries, even from a fresh start; other accounts are not', async () => {
    for (let i = 0; i < 10; i++)
      expect((await attempt(OFFICER.email, `wrong-${i}`)).status).toBe(401);
    const blocked = await attempt(OFFICER.email, OFFICER.password); // the right password, too late
    expect(blocked.status).toBe(429);
    expect(blocked.headers.getSetCookie().some((c) => c.startsWith('sb-'))).toBe(false);
    expect((await attempt(SUPERVISOR.email, SUPERVISOR.password)).status).toBe(200);
    expect(
      fake.state.audit.some(
        (a) =>
          a.action === 'login_failed' &&
          (a.meta as { reason?: string }).reason === 'account_throttled',
      ),
    ).toBe(true);
  });
});
