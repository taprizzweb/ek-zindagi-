import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  WhatsAppClient,
  WhatsAppError,
  sanitizeTemplateParam,
  type WhatsAppConfig,
} from '@/lib/delivery/whatsapp/client';
import {
  classifyHttpFailure,
  classifyNetworkFailure,
  failureCode,
} from '@/lib/delivery/whatsapp/errors';
import {
  API_VERSION,
  PHONE_NUMBER_ID,
  metaError,
  withHeaders,
  startFakeWhatsApp,
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
beforeEach(() => wa.reset());

const client = (timeoutMs = 3000) => new WhatsAppClient(cfg, fetch, timeoutMs);
const input = {
  toE164: '+919876543210',
  mediaId: 'media-1',
  filename: 'EK-ZINDAGI-certificate.pdf',
  bodyParams: ['Ravi Kumar', 'Helmet pehniye.', 'EKZ-JPR-4ZK7MQ9'],
};

async function failure(p: Promise<unknown>): Promise<WhatsAppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(WhatsAppError);
    return e as WhatsAppError;
  }
  throw new Error('expected a failure');
}

describe('uploadPdf', () => {
  it('posts the PDF as multipart form data with the token, and returns the media id', async () => {
    const id = await client().uploadPdf(Buffer.from('%PDF-1.7 test'), 'EK-ZINDAGI-certificate.pdf');
    expect(id).toBe('media-1');
    const r = wa.requests[0]!;
    expect([r.method, r.path]).toEqual(['POST', `/${API_VERSION}/${PHONE_NUMBER_ID}/media`]);
    expect(r.headers.authorization).toBe('Bearer test-token');
    expect(r.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    const text = r.body.toString('latin1');
    expect(text).toContain('name="messaging_product"');
    expect(text).toContain('whatsapp');
    expect(text).toContain('name="type"');
    expect(text).toContain('application/pdf');
    expect(text).toContain('filename="EK-ZINDAGI-certificate.pdf"');
    expect(text).toContain('%PDF-1.7 test');
  });

  it('treats a network failure as safe to retry (an upload cannot double-send anything)', async () => {
    wa.script('media', 'destroy');
    expect((await failure(client().uploadPdf(Buffer.from('x'), 'a.pdf'))).kind).toBe('transient');
  });

  it('fails if the API gives no media id', async () => {
    wa.script('media', { status: 200, body: {} });
    expect((await failure(client().uploadPdf(Buffer.from('x'), 'a.pdf'))).kind).toBe('transient');
  });
});

describe('sendTemplate', () => {
  it('sends the approved template with the PDF as the document header and the three body values', async () => {
    const r = await client().sendTemplate(input);
    expect(r.messageId).toMatch(/^wamid\.FAKE\d+$/);
    const sent = wa.requests[0]!;
    expect(sent.path).toBe(`/${API_VERSION}/${PHONE_NUMBER_ID}/messages`);
    expect(sent.json).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210', // digits only, no plus
      type: 'template',
      template: {
        name: 'ek_zindagi_certificate',
        language: { code: 'en' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'document',
                document: { id: 'media-1', filename: 'EK-ZINDAGI-certificate.pdf' },
              },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Ravi Kumar' },
              { type: 'text', text: 'Helmet pehniye.' },
              { type: 'text', text: 'EKZ-JPR-4ZK7MQ9' },
            ],
          },
        ],
      },
    });
  });

  it('never puts a name or a number in the filename it asks for', async () => {
    await client().sendTemplate(input);
    const components = (
      wa.requests[0]!.json as {
        template: { components: { parameters: { document?: { filename: string } }[] }[] };
      }
    ).template.components;
    const filename = components[0]!.parameters[0]!.document!.filename;
    expect(filename).toBe('EK-ZINDAGI-certificate.pdf');
    expect(filename).not.toMatch(/\d{6,}|Ravi|Kumar/);
  });

  it('uses the language and template name from the configuration', async () => {
    await new WhatsAppClient({
      ...cfg,
      templateName: 'other_template',
      templateLanguage: 'hi',
    }).sendTemplate(input);
    const t = (wa.requests[0]!.json as { template: { name: string; language: { code: string } } })
      .template;
    expect([t.name, t.language.code]).toEqual(['other_template', 'hi']);
  });

  it('answers a wrong token with a configuration failure (not retryable)', async () => {
    const bad = new WhatsAppClient({ ...cfg, token: 'expired' }, fetch, 3000);
    const e = await failure(bad.sendTemplate(input));
    expect([e.kind, e.code, e.httpStatus]).toEqual(['config', 'wa_190', 401]);
  });

  it.each([
    ['a server error', 503, 0, 'transient', 'wa_http_503'],
    ['throughput reached', 429, 130429, 'transient', 'wa_130429'],
    ['pair rate limit', 400, 131056, 'transient', 'wa_131056'],
    ['not on WhatsApp', 400, 131026, 'permanent', 'wa_131026'],
    ['ecosystem engagement limit', 400, 131049, 'permanent', 'wa_131049'],
    ['template does not exist', 404, 132001, 'config', 'wa_132001'],
    ['template parameters wrong', 400, 132000, 'config', 'wa_132000'],
    ['template paused', 400, 132015, 'config', 'wa_132015'],
    ['access token expired', 401, 190, 'config', 'wa_190'],
  ])('classifies %s', async (_label, status, code, kind, stored) => {
    wa.script('messages', code === 0 ? { status } : metaError(status, code));
    const e = await failure(client().sendTemplate(input));
    expect([e.kind, e.code]).toEqual([kind, code === 0 ? stored : stored]);
  });

  it('reads Retry-After (in seconds, capped at five minutes)', async () => {
    wa.script('messages', withHeaders(metaError(429, 130429), { 'retry-after': '7' }));
    expect((await failure(client().sendTemplate(input))).retryAfterMs).toBe(7000);
    wa.script('messages', withHeaders(metaError(429, 130429), { 'retry-after': '99999' }));
    expect((await failure(client().sendTemplate(input))).retryAfterMs).toBe(300_000);
  });

  it('treats a timeout as AMBIGUOUS (the message may have been sent): never to be retried automatically', async () => {
    wa.script('messages', 'hang');
    const e = await failure(client(300).sendTemplate(input));
    expect([e.kind, e.code]).toEqual(['ambiguous', 'network']);
  });

  it('treats a connection dropped after sending as AMBIGUOUS', async () => {
    wa.script('messages', 'destroy');
    expect((await failure(client().sendTemplate(input))).kind).toBe('ambiguous');
  });

  it('treats a 200 without a message id as AMBIGUOUS', async () => {
    wa.script('messages', { status: 200, body: { messages: [] } });
    expect((await failure(client().sendTemplate(input))).kind).toBe('ambiguous');
  });

  it('treats "connection refused" as safe to retry: the request cannot have arrived', async () => {
    // A port that was open a moment ago and is now closed. (fetch refuses a few low ports outright.)
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const dead = new WhatsAppClient({ ...cfg, baseUrl: `http://127.0.0.1:${port}` }, fetch, 3000);
    expect((await failure(dead.sendTemplate(input))).kind).toBe('transient');
  });

  it('puts neither the recipient nor the text into the error', async () => {
    wa.script(
      'messages',
      metaError(400, 131026, { message: 'Message to 919876543210 undeliverable' }),
    );
    const e = await failure(client().sendTemplate(input));
    expect(JSON.stringify({ m: e.message, c: e.code, s: e.stack?.split('\n')[0] })).not.toMatch(
      /9876543210|Ravi|undeliverable/,
    );
  });
});

describe('error classification table', () => {
  it('http status alone', () => {
    expect(classifyHttpFailure(500, undefined)).toBe('transient');
    expect(classifyHttpFailure(502, undefined)).toBe('transient');
    expect(classifyHttpFailure(429, undefined)).toBe('transient');
    expect(classifyHttpFailure(401, undefined)).toBe('config');
    expect(classifyHttpFailure(403, undefined)).toBe('config');
    expect(classifyHttpFailure(400, undefined)).toBe('permanent');
    expect(classifyHttpFailure(404, undefined)).toBe('permanent');
  });
  it('the Meta code wins over the status', () => {
    expect(classifyHttpFailure(400, 131056)).toBe('transient');
    expect(classifyHttpFailure(500, 132001)).toBe('config');
    expect(classifyHttpFailure(400, '131026')).toBe('permanent');
  });
  it('stored codes carry no text', () => {
    expect(failureCode(400, 131026)).toBe('wa_131026');
    expect(failureCode(503, undefined)).toBe('wa_http_503');
  });
  it('network failures: only a request that could not have arrived, or an upload, may be retried', () => {
    expect(classifyNetworkFailure({ cause: { code: 'ECONNREFUSED' } }, 'send')).toBe('transient');
    expect(classifyNetworkFailure({ cause: { code: 'ENOTFOUND' } }, 'send')).toBe('transient');
    expect(classifyNetworkFailure({ cause: { code: 'ECONNRESET' } }, 'send')).toBe('ambiguous');
    expect(classifyNetworkFailure(new Error('timeout'), 'send')).toBe('ambiguous');
    expect(classifyNetworkFailure(new Error('timeout'), 'upload')).toBe('transient');
  });
});

describe('sanitizeTemplateParam', () => {
  it('removes newlines, tabs and long runs of spaces, and never returns an empty value', () => {
    expect(sanitizeTemplateParam('a\nb\tc')).toBe('a b c');
    expect(sanitizeTemplateParam('a      b')).toBe('a   b');
    expect(sanitizeTemplateParam('   ')).toBe('-');
    expect(sanitizeTemplateParam('x'.repeat(900))).toHaveLength(500);
  });
});
