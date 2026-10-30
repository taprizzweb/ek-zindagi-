import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent, AuditSink } from '@/lib/audit/audit';
import {
  retryDueDeliveries,
  sendViaCloudApi,
  type CloudClaim,
  type CloudDeps,
  type CloudPorts,
} from '@/lib/delivery/cloud';
import type { SendCandidate } from '@/lib/delivery/bridge';
import { WhatsAppClient, type WhatsAppConfig } from '@/lib/delivery/whatsapp/client';
import { AppError } from '@/lib/errors';
import {
  API_VERSION,
  PHONE_NUMBER_ID,
  metaError,
  startFakeWhatsApp,
  withHeaders,
  type FakeWhatsApp,
} from './fake-whatsapp';

let wa: FakeWhatsApp;
let cfg: WhatsAppConfig;
beforeAll(async () => {
  wa = await startFakeWhatsApp();
  cfg = {
    baseUrl: wa.baseUrl,
    apiVersion: API_VERSION,
    phoneNumberId: PHONE_NUMBER_ID,
    token: 'test-token',
    templateName: 'ek_zindagi_certificate',
    templateLanguage: 'en',
  };
});
afterAll(async () => {
  await wa.close();
});

interface Row {
  officerId: string;
  status: string;
  retryable: boolean;
  attempts: number;
  nextRetryAt: Date | null;
  errorCode: string | null;
  messageId: string | null;
  statusChangedAt: Date;
  purged: boolean;
  phoneE164: string | null;
  phoneHash: string | null;
  personName: string | null;
  pdfPath: string | null;
}

/** In-memory stand-in for the database functions, with the same rules as claim_send / complete_send / fail_send. */
class Memory implements CloudPorts {
  rows = new Map<string, Row>();
  optedOut = new Set<string>();
  limited = false;
  pdfFails = 0;
  clock = new Date('2026-10-30T10:00:00Z');
  claims = 0;

  add(id = 'e1', over: Partial<Row> = {}) {
    this.rows.set(id, {
      officerId: 'officer-1',
      status: 'ready',
      retryable: false,
      attempts: 0,
      nextRetryAt: null,
      errorCode: null,
      messageId: null,
      statusChangedAt: this.clock,
      purged: false,
      phoneE164: '+919876543210',
      phoneHash: 'h'.repeat(64),
      personName: 'Ravi Kumar',
      pdfPath: `${id}.pdf`,
      ...over,
    });
    return id;
  }
  async loadForSend(id: string): Promise<SendCandidate | null> {
    const r = this.rows.get(id);
    return r
      ? {
          officerId: r.officerId,
          status: r.status,
          purged: r.purged,
          phoneE164: r.phoneE164,
          phoneHash: r.phoneHash,
          personName: r.personName,
          violation: 'helmet',
          certCode: 'EKZ-JPR-4ZK7MQ9',
          pdfPath: r.pdfPath,
        }
      : null;
  }
  async isOptedOut(hash: string) {
    return this.optedOut.has(hash);
  }
  async rateLimit() {
    return !this.limited;
  }
  async claim(id: string): Promise<CloudClaim | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    this.claims++;
    let claimed = false;
    if (
      !r.purged &&
      r.pdfPath &&
      (r.status === 'ready' || (r.status === 'failed' && r.retryable))
    ) {
      Object.assign(r, {
        status: 'sending',
        attempts: r.attempts + 1,
        errorCode: null,
        nextRetryAt: null,
        retryable: false,
        statusChangedAt: this.clock,
      });
      claimed = true;
    }
    return {
      claimed,
      status: r.status,
      purged: r.purged,
      officerId: r.officerId,
      phoneE164: r.phoneE164,
      phoneHash: r.phoneHash,
      personName: r.personName,
      violation: 'helmet',
      certCode: 'EKZ-JPR-4ZK7MQ9',
      pdfPath: r.pdfPath,
      attempts: r.attempts,
    };
  }
  async downloadPdf(path: string) {
    if (this.pdfFails > 0) {
      this.pdfFails--;
      throw new AppError('internal', 500);
    }
    return Buffer.from(`%PDF-${path}`);
  }
  async complete(id: string, messageId: string) {
    const r = this.rows.get(id)!;
    if (r.status !== 'sending') return false;
    Object.assign(r, { status: 'sent', messageId, retryable: false, nextRetryAt: null });
    return true;
  }
  async fail(id: string, code: string, retryable: boolean, next: Date | null) {
    const r = this.rows.get(id)!;
    if (r.status !== 'sending') return false;
    Object.assign(r, {
      status: 'failed',
      errorCode: code,
      retryable,
      nextRetryAt: retryable ? next : null,
    });
    return true;
  }
  async dueRetries(limit: number, max: number) {
    return [...this.rows.entries()]
      .filter(
        ([, r]) =>
          r.status === 'failed' &&
          r.retryable &&
          r.nextRetryAt &&
          r.nextRetryAt <= this.clock &&
          r.attempts < max &&
          !r.purged,
      )
      .slice(0, limit)
      .map(([id]) => id);
  }
  async markStale(minutes: number) {
    let n = 0;
    for (const r of this.rows.values()) {
      if (
        r.status === 'sending' &&
        this.clock.getTime() - r.statusChangedAt.getTime() > minutes * 60_000
      ) {
        Object.assign(r, {
          status: 'failed',
          errorCode: 'ambiguous_stale',
          retryable: false,
          nextRetryAt: null,
        });
        n++;
      }
    }
    return n;
  }
}
class Audit implements AuditSink {
  events: AuditEvent[] = [];
  async record(e: AuditEvent) {
    this.events.push(e);
  }
}

const actor = { id: 'officer-1', officerCode: 'JP-0001' };
let mem: Memory;
let audit: Audit;
let sleeps: number[];
let paused = false;
const deps = (over: Partial<CloudDeps> = {}, timeoutMs = 3000): CloudDeps => ({
  ports: mem,
  audit,
  wa: new WhatsAppClient(cfg, fetch, timeoutMs),
  paused: () => paused,
  maxPerOfficerHour: 60,
  inlineAttempts: 3,
  maxTotalAttempts: 5,
  sleep: async (ms) => void sleeps.push(ms),
  now: () => mem.clock,
  ...over,
});
const messages = () => wa.requests.filter((r) => r.endpoint === 'messages');
const send = (id = 'e1', d = deps()) => sendViaCloudApi(d, id, actor, 'officer-1');

beforeEach(() => {
  wa.reset();
  mem = new Memory();
  audit = new Audit();
  sleeps = [];
  paused = false;
});

describe('a normal send', () => {
  it('uploads the PDF, sends the template to the right number, and records the message id', async () => {
    mem.add();
    const r = await send();
    expect(r).toEqual({ status: 'sent', alreadySent: false });
    expect(wa.requests.map((x) => x.endpoint)).toEqual(['media', 'messages']);
    expect(wa.requests[0]!.body.toString('latin1')).toContain('%PDF-e1.pdf'); // the stored PDF, not anything else
    const payload = messages()[0]!.json as {
      to: string;
      template: { components: { parameters: { text?: string; document?: { id: string } }[] }[] };
    };
    expect(payload.to).toBe('919876543210');
    expect(payload.template.components[0]!.parameters[0]!.document!.id).toMatch(/^media-/);
    expect(payload.template.components[1]!.parameters.map((p) => p.text)).toEqual([
      'Ravi Kumar',
      'हेलमेट पहनें। घर पर कोई आपका इंतज़ार कर रहा है। / Wear your helmet. Someone is waiting for you at home.',
      'EKZ-JPR-4ZK7MQ9',
    ]);
    expect(mem.rows.get('e1')).toMatchObject({
      status: 'sent',
      attempts: 1,
      messageId: expect.stringMatching(/^wamid\.FAKE/),
    });
  });

  it('audits it without a number, a name or a code', async () => {
    mem.add();
    await send();
    expect(audit.events).toEqual([
      {
        action: 'delivery_sent',
        actorId: 'officer-1',
        actorCode: 'JP-0001',
        entryId: 'e1',
        meta: { attempts: 1 },
      },
    ]);
    expect(JSON.stringify(audit.events)).not.toMatch(/Ravi|9876543210|EKZ-JPR/);
  });

  it('puts the safety line in Hindi and English together, on one line', async () => {
    mem.add();
    await send();
    const p = (
      messages()[0]!.json as { template: { components: { parameters: { text?: string }[] }[] } }
    ).template.components[1]!.parameters;
    expect(p[1]!.text).toMatch(/[\u0900-\u097F]/);
    expect(p[1]!.text).toContain(' / Wear your helmet. Someone is waiting for you at home.');
    expect(p[1]!.text).not.toContain('\n');
  });
});

describe('once and only once', () => {
  it('sending again after success does nothing and says it was already sent', async () => {
    mem.add();
    await send();
    expect(await send()).toEqual({ status: 'sent', alreadySent: true });
    expect(messages()).toHaveLength(1);
  });

  it.each(['sent', 'delivered', 'read'])(
    'an entry that is already %s is never sent again',
    async (status) => {
      mem.add('e1', { status, messageId: 'wamid.OLD' });
      expect(await send()).toEqual({ status, alreadySent: true });
      expect(wa.requests).toHaveLength(0);
    },
  );

  it('five simultaneous taps send exactly one message', async () => {
    mem.add();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => send()));
    expect(messages()).toHaveLength(1);
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
      alreadySent: boolean;
    }>[];
    expect(ok.filter((r) => !r.value.alreadySent)).toHaveLength(1); // one real send
    for (const r of results) {
      if (r.status === 'rejected') expect((r.reason as AppError).code).toBe('busy');
    }
  });

  it('a send that is in progress answers "busy" and sends nothing', async () => {
    mem.add('e1', { status: 'sending' });
    await expect(send()).rejects.toMatchObject({ code: 'busy', status: 409 });
    expect(wa.requests).toHaveLength(0);
  });
});

describe('transient failures: retried, and still only one message', () => {
  it('retries inside the request, with waits, and the message goes out once', async () => {
    mem.add();
    wa.script('messages', metaError(503, 131016), metaError(503, 131016));
    expect(await send()).toEqual({ status: 'sent', alreadySent: false });
    expect(messages()).toHaveLength(3); // two refused, one accepted
    expect(sleeps).toEqual([1000, 3000]);
    expect(mem.rows.get('e1')!.attempts).toBe(1); // one claim covers the inline retries
  });

  it('waits as long as WhatsApp says (Retry-After), up to ten seconds inline', async () => {
    mem.add();
    wa.script('messages', withHeaders(metaError(429, 130429), { 'retry-after': '7' }));
    await send();
    expect(sleeps).toEqual([7000]);
  });

  it('a failed upload is retried too (it cannot double-send)', async () => {
    mem.add();
    wa.script('media', 'destroy');
    await send();
    expect(wa.requests.map((r) => r.endpoint)).toEqual(['media', 'media', 'messages']);
  });

  it('a storage hiccup while reading the PDF is retried', async () => {
    mem.add();
    mem.pdfFails = 1;
    await send();
    expect(messages()).toHaveLength(1);
  });

  it('after the inline tries it gives up for now, marks the entry failed and retryable, and tells the officer it will retry', async () => {
    mem.add();
    wa.script('messages', metaError(503, 131016), metaError(503, 131016), metaError(503, 131016));
    await expect(send()).rejects.toMatchObject({ code: 'send_retrying', status: 502 });
    expect(mem.rows.get('e1')).toMatchObject({
      status: 'failed',
      retryable: true,
      errorCode: 'wa_131016',
      attempts: 1,
    });
    expect(mem.rows.get('e1')!.nextRetryAt!.toISOString()).toBe('2026-10-30T10:05:00.000Z'); // five minutes later
    expect(audit.events[0]).toMatchObject({
      action: 'delivery_failed',
      meta: { code: 'wa_131016', kind: 'transient', retry: true, attempts: 1 },
    });
  });
});

describe('background retries', () => {
  async function failOnce() {
    mem.add();
    wa.script('messages', metaError(503, 131016), metaError(503, 131016), metaError(503, 131016));
    await expect(send()).rejects.toMatchObject({ code: 'send_retrying' });
    wa.reset();
  }

  it('does nothing before the retry time, then sends once when it is due, and never again', async () => {
    await failOnce();
    expect(await retryDueDeliveries(deps())).toEqual({
      staleMarked: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
    });
    expect(wa.requests).toHaveLength(0);

    mem.clock = new Date('2026-10-30T10:06:00Z');
    expect(await retryDueDeliveries(deps())).toEqual({
      staleMarked: 0,
      attempted: 1,
      sent: 1,
      failed: 0,
    });
    expect(messages()).toHaveLength(1);
    expect(mem.rows.get('e1')).toMatchObject({ status: 'sent', attempts: 2 });
    audit.events.length = 0;

    expect(await retryDueDeliveries(deps())).toMatchObject({ attempted: 0 });
    expect(messages()).toHaveLength(1);
  });

  it('backs off longer each time (5, 15, 60 minutes) and stops after the attempt limit', async () => {
    mem.add();
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      wa.script('messages', metaError(503, 131016), metaError(503, 131016), metaError(503, 131016));
      mem.clock = new Date(mem.clock.getTime() + 24 * 3_600_000);
      const before = mem.clock.getTime();
      if (attempt === 1) await send().catch(() => undefined);
      else await retryDueDeliveries(deps());
      const r = mem.rows.get('e1')!;
      if (r.nextRetryAt) delays.push((r.nextRetryAt.getTime() - before) / 60_000);
      wa.reset();
    }
    expect(delays.slice(0, 3)).toEqual([5, 15, 60]);
    const r = mem.rows.get('e1')!;
    expect(r).toMatchObject({ status: 'failed', retryable: false, attempts: 5 }); // final: shown to a supervisor
    mem.clock = new Date(mem.clock.getTime() + 48 * 3_600_000);
    expect(await retryDueDeliveries(deps())).toMatchObject({ attempted: 0 });
  });

  it('a retry that meets a permanent failure stops there', async () => {
    await failOnce();
    mem.clock = new Date('2026-10-30T10:06:00Z');
    wa.script('messages', metaError(400, 131026));
    expect(await retryDueDeliveries(deps())).toMatchObject({ attempted: 1, sent: 0, failed: 1 });
    expect(mem.rows.get('e1')).toMatchObject({
      status: 'failed',
      retryable: false,
      errorCode: 'wa_131026',
    });
  });

  it('gives up on a send stuck "sending" for over fifteen minutes and does NOT resend it', async () => {
    mem.add('e1', { status: 'sending', statusChangedAt: new Date('2026-10-30T10:00:00Z') });
    mem.clock = new Date('2026-10-30T10:20:00Z');
    expect(await retryDueDeliveries(deps())).toEqual({
      staleMarked: 1,
      attempted: 0,
      sent: 0,
      failed: 0,
    });
    expect(mem.rows.get('e1')).toMatchObject({
      status: 'failed',
      errorCode: 'ambiguous_stale',
      retryable: false,
    });
    expect(wa.requests).toHaveLength(0);
  });

  it('leaves a fresh "sending" alone', async () => {
    mem.add('e1', { status: 'sending', statusChangedAt: new Date('2026-10-30T09:58:00Z') });
    mem.clock = new Date('2026-10-30T10:00:00Z');
    expect(await retryDueDeliveries(deps())).toMatchObject({ staleMarked: 0 });
    expect(mem.rows.get('e1')!.status).toBe('sending');
  });
});

describe('failures that are never retried', () => {
  it.each([
    ['the number is not on WhatsApp', metaError(400, 131026), 'wa_131026', 'permanent'],
    ['the ecosystem engagement limit', metaError(400, 131049), 'wa_131049', 'permanent'],
    ['the template does not exist', metaError(404, 132001), 'wa_132001', 'config'],
    ['the access token expired', metaError(401, 190), 'wa_190', 'config'],
  ])('%s: one request, final, a supervisor sees it', async (_label, behaviour, code, kind) => {
    mem.add();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    wa.script('messages', behaviour);
    await expect(send()).rejects.toMatchObject({ code: 'send_failed', status: 502 });
    expect(messages()).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(mem.rows.get('e1')).toMatchObject({
      status: 'failed',
      retryable: false,
      errorCode: code,
    });
    expect(audit.events[0]).toMatchObject({
      action: 'delivery_failed',
      meta: { code, kind, retry: false },
    });
    expect(warn.mock.calls.length > 0).toBe(kind === 'config'); // a setup problem is made noticeable in the logs
    warn.mockRestore();
    expect(await retryDueDeliveries(deps())).toMatchObject({ attempted: 0 });
  });

  it.each([
    ['times out', 'hang' as const],
    ['drops the connection', 'destroy' as const],
  ])(
    'the AMBIGUOUS case, WhatsApp %s: exactly one request and never an automatic retry',
    async (_label, behaviour) => {
      mem.add();
      wa.script('messages', behaviour);
      await expect(send('e1', deps({}, 300))).rejects.toMatchObject({ code: 'send_failed' });
      expect(messages()).toHaveLength(1);
      expect(mem.rows.get('e1')).toMatchObject({
        status: 'failed',
        retryable: false,
        errorCode: 'ambiguous_network',
      });
      expect(audit.events[0]).toMatchObject({ meta: { kind: 'ambiguous', retry: false } });
      mem.clock = new Date('2026-10-31T10:00:00Z');
      expect(await retryDueDeliveries(deps())).toMatchObject({ attempted: 0 });
      expect(messages()).toHaveLength(1);
    },
  );

  it('an answer of "200" with no message id is ambiguous too', async () => {
    mem.add();
    wa.script('messages', { status: 200, body: { messages: [] } });
    await expect(send()).rejects.toMatchObject({ code: 'send_failed' });
    expect(mem.rows.get('e1')).toMatchObject({ status: 'failed', retryable: false });
    expect(messages()).toHaveLength(1);
  });

  it('the officer cannot force a resend of an entry that failed for good', async () => {
    mem.add('e1', { status: 'failed', retryable: false, errorCode: 'wa_131026', attempts: 1 });
    await expect(send()).rejects.toMatchObject({ code: 'send_failed', status: 409 });
    expect(wa.requests).toHaveLength(0);
  });

  it('the officer CAN tap Send again on a transient failure that is waiting for a retry', async () => {
    mem.add('e1', {
      status: 'failed',
      retryable: true,
      nextRetryAt: new Date('2026-10-30T11:00:00Z'),
      attempts: 1,
      errorCode: 'wa_131016',
    });
    expect(await send()).toEqual({ status: 'sent', alreadySent: false });
    expect(messages()).toHaveLength(1);
  });
});

describe('the kill switch', () => {
  it('stops a send before anything is claimed or sent', async () => {
    mem.add();
    paused = true;
    await expect(send()).rejects.toMatchObject({ code: 'campaign_paused', status: 503 });
    expect(mem.claims).toBe(0);
    expect(wa.requests).toHaveLength(0);
    expect(mem.rows.get('e1')!.status).toBe('ready');
  });

  it('stops the background retries, and stops them part-way through a run', async () => {
    mem.add('a', {
      status: 'failed',
      retryable: true,
      nextRetryAt: new Date('2026-10-30T09:00:00Z'),
      attempts: 1,
    });
    mem.add('b', {
      status: 'failed',
      retryable: true,
      nextRetryAt: new Date('2026-10-30T09:00:00Z'),
      attempts: 1,
    });
    paused = true;
    await expect(retryDueDeliveries(deps())).rejects.toMatchObject({ code: 'campaign_paused' });
    expect(wa.requests).toHaveLength(0);

    paused = false;
    let calls = 0;
    const d = deps({ paused: () => calls++ >= 2 }); // pauses after the first entry
    const r = await retryDueDeliveries(d);
    expect(r.attempted).toBe(1);
    expect(messages()).toHaveLength(1);
  });

  it('resumes when the switch is turned off', async () => {
    mem.add();
    paused = true;
    await send().catch(() => undefined);
    paused = false;
    expect(await send()).toMatchObject({ status: 'sent' });
  });
});

describe('who and when', () => {
  it('refuses a number that has replied STOP, before claiming anything', async () => {
    mem.add();
    mem.optedOut.add('h'.repeat(64));
    await expect(send()).rejects.toMatchObject({ code: 'opted_out', status: 409 });
    expect(mem.claims).toBe(0);
    expect(wa.requests).toHaveLength(0);
  });

  it('a STOP that arrives while a retry waits stops that retry for good', async () => {
    mem.add('e1', {
      status: 'failed',
      retryable: true,
      nextRetryAt: new Date('2026-10-30T09:00:00Z'),
      attempts: 1,
    });
    mem.optedOut.add('h'.repeat(64));
    expect(await retryDueDeliveries(deps())).toMatchObject({ attempted: 1, sent: 0, failed: 1 });
    expect(wa.requests).toHaveLength(0);
    expect(mem.rows.get('e1')).toMatchObject({
      status: 'failed',
      retryable: false,
      errorCode: 'opted_out',
    });
  });

  it("answers 'not found' for someone else's entry and does nothing", async () => {
    mem.add('e1', { officerId: 'officer-2' });
    await expect(send()).rejects.toMatchObject({ status: 404 });
    expect(mem.claims).toBe(0);
    await expect(send('nope')).rejects.toMatchObject({ status: 404 });
  });

  it.each([['saved'], ['generating']])(
    'refuses an entry whose certificate is %s',
    async (status) => {
      mem.add('e1', { status, pdfPath: null });
      await expect(send()).rejects.toMatchObject({ code: 'not_ready', status: 409 });
      expect(wa.requests).toHaveLength(0);
    },
  );

  it('refuses an entry whose data was deleted', async () => {
    mem.add('e1', { purged: true, phoneE164: null, personName: null, pdfPath: null });
    await expect(send()).rejects.toMatchObject({ code: 'gone', status: 410 });
  });

  it('is rate limited per officer', async () => {
    mem.add();
    mem.limited = true;
    await expect(send()).rejects.toMatchObject({ status: 429 });
    expect(mem.claims).toBe(0);
  });

  it('server-side runs (cron) work without an officer', async () => {
    mem.add('e1', {
      status: 'failed',
      retryable: true,
      nextRetryAt: new Date('2026-10-30T09:00:00Z'),
      attempts: 1,
    });
    await retryDueDeliveries(deps());
    expect(audit.events[0]).toMatchObject({
      action: 'delivery_sent',
      actorId: null,
      actorCode: 'system',
    });
  });
});

describe('what leaves our system', () => {
  it('sends the person only their name, one safety line and the code, with the PDF; no officer data, no coordinates, no violation text', async () => {
    mem.add();
    await send();
    const json = JSON.stringify(messages()[0]!.json);
    expect(json).not.toContain('JP-0001'); // no officer code
    expect(json).not.toMatch(/"(lat|lng|officer\w*|area\w*|place|violation)"/i); // no such fields
    expect(json).not.toContain('Chauraha'); // no place
    const text = (
      messages()[0]!.json as { template: { components: { parameters: { text?: string }[] }[] } }
    ).template.components[1]!.parameters.map((p) => p.text).join(' ');
    expect(text).not.toMatch(/\b(challan|fine|penalty|offence|violation)\b/i);
  });
});
