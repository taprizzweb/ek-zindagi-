import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_PORT, APP_URL, FAKE_SUPABASE_PORT, appEnv } from './env';
import { OFFICER, startFakeSupabase } from './fake-supabase';

/**
 * Security checks on the production build: headers, cookies, every API route refusing strangers,
 * no secrets in the browser bundle, and no personal data in the server's logs.
 */
let fake: Awaited<ReturnType<typeof startFakeSupabase>>;
let app: ChildProcess;
let logs = '';

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
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  app.stdout?.on('data', (d: Buffer) => (logs += d.toString()));
  app.stderr?.on('data', (d: Buffer) => (logs += d.toString()));
  await waitForApp();
});

afterAll(async () => {
  app?.kill('SIGTERM');
  await fake?.close();
});

const origin = { origin: APP_URL };

describe('headers', () => {
  it('every page and answer carries the security headers, a nonce CSP, no-store and noindex', async () => {
    for (const path of ['/login', '/api/entries', '/c/not-a-token']) {
      const res = await fetch(`${APP_URL}${path}`, { redirect: 'manual' });
      const h = res.headers;
      expect(h.get('strict-transport-security'), path).toMatch(/max-age=\d{7,}/);
      expect(h.get('x-content-type-options'), path).toBe('nosniff');
      expect(h.get('x-frame-options'), path).toBe('DENY');
      expect(h.get('referrer-policy'), path).toBe('no-referrer');
      expect(h.get('x-robots-tag'), path).toContain('noindex');
      expect(h.get('x-powered-by'), path).toBeNull();
      expect(h.get('cache-control'), path).toContain('no-store');
      if (path.startsWith('/api/')) continue; // JSON answers: the CSP belongs to pages
      const csp = h.get('content-security-policy') ?? '';
      expect(csp, path).toContain("default-src 'self'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).toContain("object-src 'none'");
      expect(csp, path).not.toContain('unsafe-inline');
      expect(csp, path).not.toContain('unsafe-eval');
    }
  });

  it('the CSP nonce is different on every request', async () => {
    const nonce = async () =>
      /'nonce-([^']+)'/.exec(
        (await fetch(`${APP_URL}/login`)).headers.get('content-security-policy') ?? '',
      )?.[1];
    const [a, b] = [await nonce(), await nonce()];
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('robots.txt keeps every crawler out', async () => {
    const res = await fetch(`${APP_URL}/robots.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/User-Agent: \*\s+Disallow: \//i);
  });
});

describe('session cookies', () => {
  it('are HttpOnly, Secure and SameSite, and a wrong password sets none', async () => {
    const bad = await fetch(`${APP_URL}/api/auth/login`, {
      method: 'POST',
      headers: { ...origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: OFFICER.email, password: 'wrong-password-xyz' }),
    });
    expect(bad.status).toBe(401);
    expect(bad.headers.getSetCookie().filter((c) => /^(sb-|ekz_)/.test(c)).length).toBe(0);

    const ok = await fetch(`${APP_URL}/api/auth/login`, {
      method: 'POST',
      headers: { ...origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: OFFICER.email, password: OFFICER.password }),
    });
    expect(ok.status).toBe(200);
    const cookies = ok.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThanOrEqual(2);
    for (const c of cookies) {
      expect(c, c.split('=')[0]).toMatch(/;\s*HttpOnly/i);
      expect(c, c.split('=')[0]).toMatch(/;\s*Secure/i);
      expect(c, c.split('=')[0]).toMatch(/;\s*SameSite=Lax/i);
    }
  });
});

/** Every route.ts under src/app/api, found on disk, so a new route cannot be forgotten. */
function apiRoutes(): { file: string; url: string }[] {
  const root = join(process.cwd(), 'src', 'app', 'api');
  const out: { file: string; url: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'route.ts') {
        const rel = relative(join(process.cwd(), 'src', 'app'), dir)
          .split(sep)
          .join('/');
        out.push({
          file: rel,
          url: `/${rel}`.replace(/\[[^\]]+\]/g, '00000000-0000-4000-8000-000000000000'),
        });
      }
    }
  };
  walk(root);
  return out;
}

describe('every API route refuses a stranger', () => {
  // Public on purpose, each with its own credential. Anything not listed must answer 401 with no session.
  const OWN_CREDENTIAL: Record<string, number[]> = {
    'api/auth/login': [400, 403, 401, 405],
    'api/auth/logout': [200, 204, 401, 403, 405],
    'api/webhooks/whatsapp': [404, 405], // bridge mode: not served; cloud mode checks the signature
    'api/cron/delivery-retry': [404, 405],
    'api/cron/retention': [401, 405],
  };

  it('finds the routes it is meant to test', () => {
    const files = apiRoutes().map((r) => r.file);
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files).toContain('api/entries');
    expect(files).toContain('api/requests/purge');
  });

  it("answers 401 to GET, POST, PUT and DELETE without a session (or the route's own credential)", async () => {
    const failures: string[] = [];
    for (const r of apiRoutes()) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const res = await fetch(`${APP_URL}${r.url}`, {
          method,
          headers: { ...origin, 'content-type': 'application/json' },
          body: method === 'GET' ? undefined : '{}',
        });
        const allowed = OWN_CREDENTIAL[r.file] ?? [401];
        if (!allowed.includes(res.status)) failures.push(`${method} ${r.url} -> ${res.status}`);
        if (res.status === 200 && !OWN_CREDENTIAL[r.file])
          failures.push(`${method} ${r.url} gave data`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('the pages for each role send a stranger to the login page', async () => {
    for (const path of [
      '/officer',
      '/supervisor',
      '/admin',
      '/admin/officers',
      '/admin/teams',
      '/admin/settings',
      '/admin/audit',
      '/new',
      '/requests',
    ]) {
      const res = await fetch(`${APP_URL}${path}`, { redirect: 'manual' });
      expect([307, 308], path).toContain(res.status);
      expect(res.headers.get('location'), path).toContain('/login');
    }
  });
});

describe('the browser bundle', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const f = join(dir, n);
      return statSync(f).isDirectory() ? files(f) : [f];
    });
  }
  it('holds no secret, and no secret setting names', () => {
    const forbidden = [
      appEnv.SUPABASE_SERVICE_ROLE_KEY,
      appEnv.PHONE_HASH_SECRET,
      appEnv.CRON_SECRET,
      appEnv.COOKIE_SECRET,
      'COOKIE_SECRET',
      'SUPABASE_SERVICE_ROLE_KEY',
      'PHONE_HASH_SECRET',
      'CRON_SECRET',
      'WHATSAPP_TOKEN',
      'WHATSAPP_APP_SECRET',
      'GOOGLE_MAPS_API_KEY',
    ];
    const hits: string[] = [];
    const list = files(join(process.cwd(), '.next', 'static')).filter((f) =>
      /\.(js|css|html|json|map)$/.test(f),
    );
    expect(list.length).toBeGreaterThan(5);
    for (const f of list) {
      const text = readFileSync(f, 'utf8');
      for (const s of forbidden)
        if (text.includes(s))
          hits.push(`${relative(process.cwd(), f)} contains ${s.slice(0, 12)}…`);
    }
    expect(hits).toEqual([]);
  });
});

describe('server logs', () => {
  it('hold no name, number, place, password, token or secret after a full round of normal and failing requests', async () => {
    const NAME = 'Zzyzx Qwerty';
    const PHONE = '9812345678';
    const PLACE = 'Quasimodo Chowk';
    const login = await fetch(`${APP_URL}/api/auth/login`, {
      method: 'POST',
      headers: { ...origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: OFFICER.email, password: OFFICER.password }),
    });
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const call = (path: string, init: RequestInit = {}) =>
      fetch(`${APP_URL}${path}`, {
        ...init,
        headers: { ...origin, cookie, ...(init.headers ?? {}) },
      });

    const form = (data: unknown) => {
      const f = new FormData();
      f.set('data', typeof data === 'string' ? data : JSON.stringify(data));
      return f;
    };
    const entry = {
      clientRequestId: crypto.randomUUID(),
      name: NAME,
      phone: PHONE,
      violation: 'helmet',
      location: { source: 'manual', areaName: PLACE },
      photoSource: 'none',
      consentChecked: false,
    };
    const created = await call('/api/entries', { method: 'POST', body: form(entry) });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // normal path
    expect((await call(`/api/entries/${id}/certificate`, { method: 'POST' })).status).toBe(200);
    const sent = await call(`/api/entries/${id}/send`, { method: 'POST' });
    expect(sent.status).toBe(200);
    const { waUrl } = (await sent.json()) as { waUrl: string };
    const token = /\/c\/([A-Za-z0-9_-]{22})/.exec(decodeURIComponent(waUrl))?.[1];
    expect(token).toBeTruthy();
    expect((await fetch(`${APP_URL}/c/${token}`)).status).toBe(200);

    // failing paths, with personal data in the request
    await call('/api/entries', {
      method: 'POST',
      body: form(`{"name":"${NAME}","phone":"${PHONE}"`),
    }); // broken JSON
    await call('/api/entries', {
      method: 'POST',
      body: form({ ...entry, clientRequestId: crypto.randomUUID(), phone: '12345', extra: PLACE }),
    });
    await call('/api/entries', {
      method: 'POST',
      body: form({ ...entry, clientRequestId: crypto.randomUUID() }),
    }); // duplicate number
    await call(`/api/entries/00000000-0000-4000-8000-000000000000/send`, { method: 'POST' });
    await fetch(`${APP_URL}/c/${'x'.repeat(22)}`);
    await fetch(`${APP_URL}/api/auth/login`, {
      method: 'POST',
      headers: { ...origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: OFFICER.email, password: 'wrong-password-xyz' }),
    });
    await new Promise((r) => setTimeout(r, 500));

    const secrets = [
      NAME,
      'Qwerty',
      PHONE,
      `91${PHONE}`,
      PLACE,
      'wrong-password-xyz',
      OFFICER.password,
      token!,
      appEnv.SUPABASE_SERVICE_ROLE_KEY,
      appEnv.PHONE_HASH_SECRET,
      appEnv.CRON_SECRET,
      appEnv.COOKIE_SECRET,
    ];
    for (const s of secrets) expect(logs, `logs contain ${s.slice(0, 6)}…`).not.toContain(s);
  }, 90_000);
});
