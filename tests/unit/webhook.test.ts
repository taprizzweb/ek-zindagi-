import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent, AuditSink } from '@/lib/audit/audit';
import { hashPhone } from '@/lib/domain/phone-hash';
import {
  MAX_WEBHOOK_BYTES,
  handleWebhook,
  isStopMessage,
  parseWebhook,
  verifyChallenge,
  verifySignature,
  type ParsedStatus,
  type WebhookDeps,
  type WebhookPorts,
} from '@/lib/delivery/whatsapp/webhook';

const SECRET = 'app-secret-0123456789';
const PHONE_SECRET = 'p'.repeat(32);
const sign = (body: Buffer | string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const bodyOf = (o: unknown) => Buffer.from(JSON.stringify(o));

const statusPayload = (statuses: unknown[]) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '1',
      changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses } }],
    },
  ],
});
const inboundPayload = (messages: unknown[]) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field: 'messages', value: { messages } }] }],
});

class Ports implements WebhookPorts {
  seen = new Set<string>();
  applied: ParsedStatus[] = [];
  optOuts: string[] = [];
  result: 'applied' | 'ignored' | 'pending' = 'applied';
  async registerBody(h: string) {
    if (this.seen.has(h)) return false;
    this.seen.add(h);
    return true;
  }
  async applyStatus(s: ParsedStatus) {
    this.applied.push(s);
    return this.result;
  }
  async addOptOut(h: string) {
    this.optOuts.push(h);
  }
}
class Audit implements AuditSink {
  events: AuditEvent[] = [];
  async record(e: AuditEvent) {
    this.events.push(e);
  }
}
let ports: Ports;
let audit: Audit;
const deps = (): WebhookDeps => ({
  ports,
  audit,
  appSecret: SECRET,
  hashPhone: (e) => hashPhone(e, PHONE_SECRET),
  expectedCategory: 'UTILITY',
});
const run = (payload: unknown, signature?: string | null) => {
  const raw = bodyOf(payload);
  return handleWebhook(deps(), raw, signature === undefined ? sign(raw) : signature);
};
beforeEach(() => {
  ports = new Ports();
  audit = new Audit();
});

describe('signature', () => {
  const raw = Buffer.from('{"a":1}');
  it('accepts the right HMAC-SHA256 of the raw body', () => {
    expect(verifySignature(raw, sign(raw), SECRET)).toBe(true);
  });
  it('accepts upper-case hex and surrounding spaces', () => {
    expect(
      verifySignature(raw, ` ${sign(raw).toUpperCase().replace('SHA256=', 'sha256=')} `, SECRET),
    ).toBe(true);
  });
  it.each([
    ['a different secret', sign(raw, 'other-secret-0123456789')],
    ['a tampered body', sign(Buffer.from('{"a":2}'))],
    ['no prefix', sign(raw).replace('sha256=', '')],
    ['the wrong algorithm', sign(raw).replace('sha256=', 'sha1=')],
    ['an empty header', ''],
    ['a truncated signature', sign(raw).slice(0, -2)],
    ['an extra character', `${sign(raw)}0`],
    ['garbage', 'sha256=zzzz'],
  ])('refuses %s', (_l, header) => {
    expect(verifySignature(raw, header, SECRET)).toBe(false);
  });
  it('refuses a missing header and an empty secret', () => {
    expect(verifySignature(raw, null, SECRET)).toBe(false);
    expect(verifySignature(raw, sign(raw, ''), '')).toBe(false);
  });
  it('is checked on the raw bytes, not on re-serialised JSON', () => {
    const spaced = Buffer.from('{ "a" : 1 }');
    expect(verifySignature(spaced, sign(raw), SECRET)).toBe(false);
    expect(verifySignature(spaced, sign(spaced), SECRET)).toBe(true);
  });
});

describe('handleWebhook: what is refused', () => {
  it.each([null, 'sha256=00', sign('other')])(
    'a bad signature (%s) is refused with 401 and nothing is read, stored or applied',
    async (sig) => {
      await expect(run(statusPayload([{ id: 'w1', status: 'read' }]), sig)).rejects.toMatchObject({
        status: 401,
      });
      expect(ports.seen.size).toBe(0);
      expect(ports.applied).toHaveLength(0);
      expect(audit.events).toHaveLength(0);
    },
  );
  it('a body over one megabyte is refused before the signature is even computed', async () => {
    await expect(
      handleWebhook(deps(), Buffer.alloc(MAX_WEBHOOK_BYTES + 1), 'x'),
    ).rejects.toMatchObject({ status: 413 });
  });
  it('a correctly signed body that is not JSON is a 400 (and was registered, so it is not reprocessed)', async () => {
    const raw = Buffer.from('not json');
    await expect(handleWebhook(deps(), raw, sign(raw))).rejects.toMatchObject({ status: 400 });
  });
});

describe('replay protection', () => {
  it('the same signed body is processed once', async () => {
    const p = statusPayload([{ id: 'w1', status: 'delivered', timestamp: '1788000000' }]);
    expect(await run(p)).toMatchObject({ replay: false, statuses: 1 });
    expect(await run(p)).toMatchObject({ replay: true, statuses: 0 });
    expect(await run(p)).toMatchObject({ replay: true });
    expect(ports.applied).toHaveLength(1);
  });
  it('a different body is processed', async () => {
    await run(statusPayload([{ id: 'w1', status: 'delivered' }]));
    await run(statusPayload([{ id: 'w1', status: 'read' }]));
    expect(ports.applied.map((s) => s.status)).toEqual(['delivered', 'read']);
  });
});

describe('status reports', () => {
  it('passes each known status on, with its time', async () => {
    await run(
      statusPayload([
        { id: 'w1', status: 'sent', timestamp: '1788000000', recipient_id: '919876543210' },
        { id: 'w1', status: 'delivered', timestamp: '1788000005' },
        { id: 'w1', status: 'read', timestamp: '1788000010' },
      ]),
    );
    expect(ports.applied.map((s) => [s.messageId, s.status, s.at.toISOString()])).toEqual([
      [
        'w1',
        'sent',
        '2026-08-30T08:00:00.000Z'.replace(
          '2026-08-30T08:00:00',
          new Date(1788000000 * 1000).toISOString().slice(0, 19),
        ),
      ],
      ['w1', 'delivered', new Date(1788000005 * 1000).toISOString()],
      ['w1', 'read', new Date(1788000010 * 1000).toISOString()],
    ]);
  });
  it('turns a failure into our error code, from the first error only, and never keeps the API text', async () => {
    await run(
      statusPayload([
        {
          id: 'w2',
          status: 'failed',
          errors: [{ code: 131026, title: 'Message undeliverable to 919876543210', message: 'x' }],
        },
      ]),
    );
    expect(ports.applied[0]).toMatchObject({ status: 'failed', errorCode: 'wa_131026' });
    expect(JSON.stringify(ports.applied)).not.toContain('undeliverable');
  });
  it('a failure with no error list still becomes "failed"', async () => {
    await run(statusPayload([{ id: 'w2', status: 'failed' }]));
    expect(ports.applied[0]).toMatchObject({ status: 'failed', errorCode: 'wa_failed' });
  });
  it.each(['deleted', 'warning', 'unknown', 'pending'])(
    'ignores the status word "%s"',
    async (word) => {
      await run(statusPayload([{ id: 'w3', status: word }]));
      expect(ports.applied).toHaveLength(0);
    },
  );
  it('ignores entries without a message id, and non-objects', async () => {
    await run(
      statusPayload([
        { status: 'read' },
        null,
        'x',
        7,
        { id: '', status: 'read' },
        { id: 5, status: 'read' },
      ]),
    );
    expect(ports.applied).toHaveLength(0);
  });
  it('counts only the reports that changed something', async () => {
    ports.result = 'ignored';
    expect(await run(statusPayload([{ id: 'w1', status: 'read' }]))).toMatchObject({ statuses: 0 });
  });
  it('a missing or nonsense timestamp falls back to now', async () => {
    const before = Date.now();
    await run(
      statusPayload([
        { id: 'w1', status: 'read', timestamp: 'abc' },
        { id: 'w2', status: 'read', timestamp: '-5' },
      ]),
    );
    for (const s of ports.applied) expect(Math.abs(s.at.getTime() - before)).toBeLessThan(5000);
  });
});

describe('STOP replies', () => {
  it.each([
    'STOP',
    'stop',
    'Stop',
    ' STOP ',
    'stop.',
    'Stop!',
    '*STOP*',
    'S T O P'.replace(/ /g, ''),
    'UNSUBSCRIBE',
    'बंद',
    'बंद करें',
    'बंद करो',
    'रोकें',
    'band karo',
    'Band Karo',
    'STOP sending me this',
    'stop please',
    'unsubscribe me',
    'cancel',
  ])('recognises %j', (text) => {
    expect(isStopMessage(text)).toBe(true);
  });
  it.each([
    '',
    '   ',
    'thanks',
    'hello',
    'ok',
    'Please do not stop',
    'I will stop by tomorrow to collect it and see the officer',
    'bandh',
    'स्टॉप',
    '123',
    'stopping',
    'non-stop',
  ])('does not treat %j as an opt-out', (text) => {
    expect(isStopMessage(text)).toBe(false);
  });

  it('adds the sender to the opt-out list by HMAC hash, never the number', async () => {
    const r = await run(
      inboundPayload([
        { from: '919876543210', id: 'wamid.in1', type: 'text', text: { body: 'STOP' } },
      ]),
    );
    expect(r.optOuts).toBe(1);
    expect(ports.optOuts).toEqual([hashPhone('+919876543210', PHONE_SECRET)]);
    expect(ports.optOuts[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ports.optOuts)).not.toContain('9876543210');
  });
  it('is matched to the same hash the entry form stores, so later sends are refused', async () => {
    // The form normalises "9876543210" to +919876543210 and hashes that; the webhook receives 919876543210.
    await run(inboundPayload([{ from: '919876543210', type: 'text', text: { body: 'बंद' } }]));
    expect(ports.optOuts[0]).toBe(hashPhone('+919876543210', PHONE_SECRET));
  });
  it('works for a tapped quick-reply button', async () => {
    await run(
      inboundPayload([
        { from: '919876543210', type: 'button', button: { text: 'STOP', payload: 'x' } },
      ]),
    );
    expect(ports.optOuts).toHaveLength(1);
  });
  it('audits it without the number or the text', async () => {
    await run(inboundPayload([{ from: '919876543210', type: 'text', text: { body: 'STOP' } }]));
    expect(audit.events).toEqual([{ action: 'opt_out_recorded', meta: {} }]);
  });
  it('handles several in one delivery, and ignores other messages', async () => {
    const r = await run(
      inboundPayload([
        { from: '919876543210', type: 'text', text: { body: 'STOP' } },
        { from: '919812345678', type: 'text', text: { body: 'thanks' } },
        { from: '919800000001', type: 'text', text: { body: 'band karo' } },
      ]),
    );
    expect(r.optOuts).toBe(2);
  });
  it('ignores a sender that is not an Indian mobile number, and malformed senders', async () => {
    await run(
      inboundPayload([
        { from: '14155550100', type: 'text', text: { body: 'STOP' } },
        { from: 'abc', type: 'text', text: { body: 'STOP' } },
        { type: 'text', text: { body: 'STOP' } },
        { from: '911234567890', type: 'text', text: { body: 'STOP' } },
      ]),
    );
    expect(ports.optOuts).toHaveLength(0);
  });
  it('ignores messages that are not text (images, location)', async () => {
    await run(inboundPayload([{ from: '919876543210', type: 'image', image: { id: 'x' } }]));
    expect(ports.optOuts).toHaveLength(0);
  });
});

describe('template category (cost warning, never a crash)', () => {
  it('records a warning when WhatsApp bills a message as marketing instead of utility', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await run(
      statusPayload([
        { id: 'w1', status: 'sent', pricing: { category: 'marketing', billable: true } },
      ]),
    );
    expect(r.categoryWarnings).toBe(1);
    expect(audit.events).toEqual([
      {
        action: 'template_category_changed',
        meta: { from: 'utility', to: 'marketing', source: 'message' },
      },
    ]);
    expect(ports.applied[0]!.category).toBe('marketing'); // stored on the entry
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('no warning for the approved category', async () => {
    const r = await run(
      statusPayload([{ id: 'w1', status: 'sent', pricing: { category: 'utility' } }]),
    );
    expect(r.categoryWarnings).toBe(0);
    expect(audit.events).toHaveLength(0);
  });
  it('records Meta re-categorising the template itself', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const payload = {
      entry: [
        {
          changes: [
            {
              field: 'template_category_update',
              value: {
                message_template_name: 'ek_zindagi_certificate',
                previous_category: 'UTILITY',
                new_category: 'MARKETING',
              },
            },
          ],
        },
      ],
    };
    const r = await run(payload);
    expect(r.categoryWarnings).toBe(1);
    expect(audit.events).toEqual([
      {
        action: 'template_category_changed',
        meta: { from: 'utility', to: 'marketing', source: 'template' },
      },
    ]);
    warn.mockRestore();
  });
  it('an unknown category word is ignored rather than stored', async () => {
    await run(statusPayload([{ id: 'w1', status: 'sent', pricing: { category: 'weird' } }]));
    expect(ports.applied[0]!.category).toBeNull();
  });
});

describe('payloads we do not understand', () => {
  it.each([
    null,
    'x',
    5,
    [],
    {},
    { entry: 'x' },
    {
      entry: [
        null,
        7,
        { changes: 'x' },
        { changes: [null, { value: 'x' }, { value: { statuses: 'x', messages: 3 } }] },
      ],
    },
  ])('are ignored without an error: %j', async (payload) => {
    const r = await run(payload);
    expect(r).toMatchObject({ statuses: 0, optOuts: 0, categoryWarnings: 0 });
  });
  it('template status updates (approved, rejected) are accepted and ignored', async () => {
    await run({
      entry: [
        {
          changes: [
            {
              field: 'message_template_status_update',
              value: { event: 'REJECTED', message_template_name: 'x' },
            },
          ],
        },
      ],
    });
    expect(ports.applied).toHaveLength(0);
  });
  it('parseWebhook never throws on hostile shapes', () => {
    const evil = JSON.parse(
      '{"entry":[{"changes":[{"field":"messages","value":{"statuses":[{"id":{"toString":1},"status":"read"}],"messages":[{"from":{"x":1},"text":{"body":{}}}]}}]}]}',
    );
    expect(() => parseWebhook(evil)).not.toThrow();
  });
});

describe('verification handshake', () => {
  const params = (o: Record<string, string>) => new URLSearchParams(o);
  it('echoes the challenge when mode and token match', () => {
    expect(
      verifyChallenge(
        params({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'tok-0123456789',
          'hub.challenge': '1158201444',
        }),
        'tok-0123456789',
      ),
    ).toBe('1158201444');
  });
  it.each([
    ['wrong token', { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' }],
    [
      'wrong mode',
      { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok-0123456789', 'hub.challenge': '1' },
    ],
    ['no challenge', { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok-0123456789' }],
    ['no token', { 'hub.mode': 'subscribe', 'hub.challenge': '1' }],
    ['nothing', {}],
  ])('refuses %s', (_l, p) => {
    expect(verifyChallenge(params(p), 'tok-0123456789')).toBeNull();
  });
  it('refuses everything if no verify token is configured', () => {
    expect(
      verifyChallenge(
        params({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }),
        '',
      ),
    ).toBeNull();
  });
});
