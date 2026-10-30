import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startFakeWhatsApp, type FakeWhatsApp, metaError } from '../integration/fake-whatsapp';
import { FAKE_SUPABASE_PORT, appEnv } from './env';
import { OFFICER, SUPERVISOR, startFakeSupabase } from './fake-supabase';

/**
 * The real app in cloud_api mode (production build), talking to the fake Supabase and the fake
 * WhatsApp API. No browser: these are the server-to-server paths (send, webhook, cron).
 */
const PORT = 3198;
const URL_ = `http://127.0.0.1:${PORT}`;
const APP_SECRET = 'e2e-wa-app-secret';
const VERIFY_TOKEN = 'e2e-verify-token';
const CRON_SECRET = 'e2e-cron-secret-0123456789-abcdefghij';
const PHONE = '+919876543210';
const phoneHash = createHmac('sha256', appEnv.PHONE_HASH_SECRET).update(PHONE).digest('hex');

let fake: Awaited<ReturnType<typeof startFakeSupabase>>;
let wa: FakeWhatsApp;
let app: ChildProcess;
let cookie = '';

async function waitForApp() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${URL_}/login`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('app did not start');
}

async function login(who: { email: string; password: string } = OFFICER): Promise<string> {
  const res = await fetch(`${URL_}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: URL_ },
    body: JSON.stringify({ email: who.email, password: who.password }),
  });
  expect([res.status, await res.clone().text()]).toEqual([200, expect.any(String)]);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function seedEntry(over: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const pdfPath = `${OFFICER.id}/${id}.pdf`;
  fake.state.entries.push({
    id,
    officer_id: OFFICER.id,
    officer_code: OFFICER.officerCode,
    client_request_id: crypto.randomUUID(),
    cert_code: 'EKZ-JPR-4ZK7MQ9',
    status: 'ready',
    violation: 'helmet',
    person_name: 'Ravi Kumar',
    phone_e164: PHONE,
    phone_hash: phoneHash,
    pdf_path: pdfPath,
    area_name: 'Malviya Nagar',
    created_at: new Date().toISOString(),
    purged_at: null,
    wa_message_id: null,
    send_attempts: 0,
    retryable: false,
    next_retry_at: null,
    ...over,
  });
  fake.state.pdfs.push({ path: pdfPath, bytes: Buffer.from('%PDF-1.7 fake') });
  return id;
}

const send = (id: string) =>
  fetch(`${URL_}/api/entries/${id}/send`, {
    method: 'POST',
    headers: { origin: URL_, cookie },
  });
const entry = (id: string) => fake.state.entries.find((e) => e.id === id)!;

function signed(body: unknown, secret = APP_SECRET) {
  const raw = JSON.stringify(body);
  return {
    raw,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
    },
  };
}
const statusBody = (id: string, status: string, ts = 1_760_000_000) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            statuses: [{ id, status, timestamp: String(ts), recipient_id: '919876543210' }],
          },
        },
      ],
    },
  ],
});
const stopBody = (text: string) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            messages: [
              { from: '919876543210', type: 'text', text: { body: text }, id: 'wamid.in1' },
            ],
          },
        },
      ],
    },
  ],
});
const post = (b: { raw: string; headers: Record<string, string> }) =>
  fetch(`${URL_}/api/webhooks/whatsapp`, { method: 'POST', headers: b.headers, body: b.raw });

beforeAll(async () => {
  fake = await startFakeSupabase(FAKE_SUPABASE_PORT);
  wa = await startFakeWhatsApp();
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
    env: {
      ...process.env,
      ...appEnv,
      NODE_ENV: 'production',
      APP_BASE_URL: URL_,
      DELIVERY_MODE: 'cloud_api',
      CRON_SECRET,
      WHATSAPP_PHONE_NUMBER_ID: '10987654321',
      WHATSAPP_TOKEN: 'test-token',
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      WHATSAPP_TEMPLATE_NAME: 'ek_zindagi_certificate',
      WHATSAPP_API_BASE: wa.baseUrl,
    },
    stdio: process.env.E2E_APP_LOGS ? 'inherit' : 'ignore',
  });
  await waitForApp();
  cookie = await login();
});

afterAll(async () => {
  app?.kill('SIGTERM');
  await wa?.close();
  await fake?.close();
});

afterEach(() => {
  fake.reset();
  wa.reset();
});

describe('send (cloud_api)', () => {
  it('uploads the PDF, sends the template once and records the message id', async () => {
    const id = seedEntry();
    const res = await send(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: 'cloud_api', status: 'sent' });
    expect(wa.requests.map((r) => r.endpoint)).toEqual(['media', 'messages']);
    expect(entry(id)).toMatchObject({ status: 'sent', delivery_mode: 'cloud_api' });
    expect(entry(id).wa_message_id).toMatch(/^wamid\./);
    // Sending again does not send a second message.
    const again = await send(id);
    expect(await again.json()).toMatchObject({ alreadySent: true });
    expect(wa.requests.filter((r) => r.endpoint === 'messages')).toHaveLength(1);
  });

  it('five taps at once produce one message', async () => {
    const id = seedEntry();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => send(id)));
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(wa.requests.filter((r) => r.endpoint === 'messages')).toHaveLength(1);
  });

  it('a permanent failure is final and nothing sensitive is audited', async () => {
    wa.script('messages', metaError(400, 131026));
    const id = seedEntry();
    const res = await send(id);
    expect(res.status).toBe(502);
    expect(entry(id)).toMatchObject({
      status: 'failed',
      retryable: false,
      error_code: 'wa_131026',
    });
    expect(JSON.stringify(fake.state.audit)).not.toMatch(/9876543210|Ravi/);
  });

  it('refuses a number that has opted out', async () => {
    fake.state.optOuts.push(phoneHash);
    const id = seedEntry();
    const res = await send(id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(wa.requests).toHaveLength(0);
  });

  it('needs a signed-in officer', async () => {
    const id = seedEntry();
    const res = await fetch(`${URL_}/api/entries/${id}/send`, {
      method: 'POST',
      headers: { origin: URL_ },
    });
    expect(res.status).toBe(401);
    expect(wa.requests).toHaveLength(0);
  });
});

describe('webhook', () => {
  it('answers the setup handshake only with the right token', async () => {
    const ok = await fetch(
      `${URL_}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
    );
    expect([ok.status, await ok.text()]).toEqual([200, '12345']);
    const bad = await fetch(
      `${URL_}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345`,
    );
    expect(bad.status).toBe(403);
  });

  it('rejects a wrong or missing signature before touching anything', async () => {
    const b = signed(statusBody('wamid.x', 'delivered'), 'wrong-secret');
    expect((await post(b)).status).toBe(401);
    expect(
      (await fetch(`${URL_}/api/webhooks/whatsapp`, { method: 'POST', body: b.raw })).status,
    ).toBe(401);
    expect(fake.state.webhookHashes).toHaveLength(0);
  });

  it('moves a message forward through delivered and read, never backwards, and ignores a replay', async () => {
    const id = seedEntry();
    await send(id);
    const mid = String(entry(id).wa_message_id);
    expect((await post(signed(statusBody(mid, 'read', 1_760_000_100)))).status).toBe(200);
    expect(entry(id).status).toBe('read');
    expect((await post(signed(statusBody(mid, 'delivered', 1_760_000_050)))).status).toBe(200);
    expect(entry(id).status).toBe('read');
    const replay = signed(statusBody(mid, 'read', 1_760_000_100));
    expect((await post(replay)).status).toBe(200);
    expect(await (await post(replay)).json()).toMatchObject({ ok: true });
  });

  it('a STOP reply opts the number out, and the next entry for it is refused', async () => {
    expect((await post(signed(stopBody('STOP')))).status).toBe(200);
    expect(fake.state.optOuts).toContain(phoneHash);
    const id = seedEntry();
    const res = await send(id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(wa.requests).toHaveLength(0);
  });

  it('an ordinary reply does not opt anyone out', async () => {
    expect((await post(signed(stopBody('thank you')))).status).toBe(200);
    expect(fake.state.optOuts).toHaveLength(0);
  });
});

describe('cron', () => {
  const cron = (token?: string) =>
    fetch(`${URL_}/api/cron/delivery-retry`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('needs the cron secret', async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron('wrong')).status).toBe(401);
    expect((await cron(CRON_SECRET)).status).toBe(200);
  });

  it('retries a transient failure that is due, once', async () => {
    const id = seedEntry({
      status: 'failed',
      retryable: true,
      send_attempts: 1,
      next_retry_at: new Date(Date.now() - 1000).toISOString(),
      error_code: 'wa_http_503',
    });
    expect((await cron(CRON_SECRET)).status).toBe(200);
    expect(entry(id).status).toBe('sent');
    expect(wa.requests.filter((r) => r.endpoint === 'messages')).toHaveLength(1);
    await cron(CRON_SECRET);
    expect(wa.requests.filter((r) => r.endpoint === 'messages')).toHaveLength(1);
  });
});

describe('supervisor retry', () => {
  const retry = (id: string, as = supervisorCookie) =>
    fetch(`${URL_}/api/entries/${id}/retry`, {
      method: 'POST',
      headers: { origin: URL_, cookie: as },
    });
  let supervisorCookie = '';

  it('sends a failed message again, once, and audits it', async () => {
    supervisorCookie = await login(SUPERVISOR);
    wa.script('messages', metaError(400, 131026));
    const id = seedEntry();
    expect((await send(id)).status).toBe(502); // permanent failure, now in the failures list
    expect(entry(id).status).toBe('failed');
    wa.reset();
    const res = await retry(id, supervisorCookie);
    expect(res.status).toBe(200);
    expect(entry(id)).toMatchObject({ status: 'sent', delivery_mode: 'cloud_api' });
    expect(wa.requests.filter((r) => r.endpoint === 'messages')).toHaveLength(1);
    expect(fake.state.audit.map((a) => a.action)).toContain('delivery_retried');
    // A second click does not send a second message.
    expect((await retry(id, supervisorCookie)).status).toBe(409);
    expect(wa.requests.filter((r) => r.endpoint === 'messages')).toHaveLength(1);
  });

  it('an officer cannot use it', async () => {
    const id = seedEntry({ status: 'failed' });
    expect((await retry(id, cookie)).status).toBe(403);
    expect(entry(id).status).toBe('failed');
    expect(wa.requests).toHaveLength(0);
  });

  it('nothing to send once the data is deleted', async () => {
    supervisorCookie = await login(SUPERVISOR);
    const id = seedEntry({
      status: 'failed',
      pdf_path: null,
      purged_at: new Date().toISOString(),
      person_name: null,
      phone_e164: null,
    });
    expect((await retry(id, supervisorCookie)).status).toBe(409);
    expect(wa.requests).toHaveLength(0);
  });

  it('while the campaign is paused the entry stays in the failures list', async () => {
    supervisorCookie = await login(SUPERVISOR);
    fake.state.settings.push({ key: 'campaign_paused', value: true });
    const id = seedEntry({ status: 'failed' });
    const res = await retry(id, supervisorCookie);
    expect(res.status).toBe(503);
    expect(entry(id).status).toBe('failed');
    expect(wa.requests).toHaveLength(0);
  });

  it('the pause setting also stops a normal send and the background job', async () => {
    fake.state.settings.push({ key: 'campaign_paused', value: true });
    const id = seedEntry();
    expect((await send(id)).status).toBe(503);
    const cronRes = await fetch(`${URL_}/api/cron/delivery-retry`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(cronRes.status).toBe(503);
    expect(wa.requests).toHaveLength(0);
  });
});
