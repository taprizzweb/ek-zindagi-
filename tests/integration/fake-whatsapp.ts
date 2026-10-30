/**
 * TEST-ONLY stand-in for the WhatsApp Cloud API (media upload and template messages). It records every
 * request and can be scripted to fail in the ways the real API does. It is the only thing the delivery
 * tests mock; everything else runs for real.
 */
import { createServer, type Server } from 'node:http';

export interface Recorded {
  endpoint: 'media' | 'messages' | 'other';
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  json: Record<string, unknown> | null;
}

export type Behaviour =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | 'hang' // never answers: the client's timeout fires
  | 'destroy'; // closes the connection without an answer

export interface FakeWhatsApp {
  baseUrl: string;
  requests: Recorded[];
  /** Queue behaviours for the next calls to one endpoint; after the queue is empty it answers 200. */
  script(endpoint: 'media' | 'messages', ...behaviours: Behaviour[]): void;
  reset(): void;
  close(): Promise<void>;
}

export const PHONE_NUMBER_ID = '10987654321';
export const API_VERSION = 'v21.0';

export function metaError(
  status: number,
  code: number,
  extra: Record<string, unknown> = {},
): Behaviour {
  return {
    status,
    body: {
      error: {
        message: 'redacted by the fake',
        type: 'OAuthException',
        code,
        fbtrace_id: 'x',
        ...extra,
      },
    },
  };
}

/** The same behaviour with extra response headers (for example Retry-After). */
export function withHeaders(b: Behaviour, headers: Record<string, string>): Behaviour {
  return typeof b === 'string' ? b : { ...b, headers: { ...b.headers, ...headers } };
}

export async function startFakeWhatsApp(): Promise<FakeWhatsApp> {
  const state = {
    requests: [] as Recorded[],
    queues: { media: [] as Behaviour[], messages: [] as Behaviour[] },
    n: 0,
  };
  const open = new Set<import('node:net').Socket>();

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const path = req.url ?? '';
      const endpoint = path.endsWith('/media')
        ? 'media'
        : path.endsWith('/messages')
          ? 'messages'
          : 'other';
      let json: Record<string, unknown> | null = null;
      if ((req.headers['content-type'] ?? '').includes('json')) {
        try {
          json = JSON.parse(body.toString()) as Record<string, unknown>;
        } catch {
          json = null;
        }
      }
      state.requests.push({
        endpoint,
        method: req.method ?? '',
        path,
        headers: req.headers,
        body,
        json,
      });
      if (endpoint === 'other' || path !== `/${API_VERSION}/${PHONE_NUMBER_ID}/${endpoint}`) {
        res
          .writeHead(404, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: { code: 100, message: 'unknown path' } }));
        return;
      }
      if (req.headers.authorization !== 'Bearer test-token') {
        res
          .writeHead(401, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: { code: 190, message: 'bad token' } }));
        return;
      }
      const next = state.queues[endpoint].shift();
      if (next === 'hang') return;
      if (next === 'destroy') {
        req.socket.destroy();
        return;
      }
      const n = ++state.n;
      const status = next?.status ?? 200;
      const payload =
        next?.body !== undefined
          ? next.body
          : endpoint === 'media'
            ? { id: `media-${n}` }
            : {
                messaging_product: 'whatsapp',
                contacts: [{ wa_id: 'x' }],
                messages: [{ id: `wamid.FAKE${n}`, message_status: 'accepted' }],
              };
      res
        .writeHead(status, { 'content-type': 'application/json', ...(next?.headers ?? {}) })
        .end(JSON.stringify(payload));
    });
  });
  server.on('connection', (s) => {
    open.add(s);
    s.on('close', () => open.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests: state.requests,
    script(endpoint, ...b) {
      state.queues[endpoint].push(...b);
    },
    reset() {
      state.requests.length = 0;
      state.queues.media.length = 0;
      state.queues.messages.length = 0;
    },
    close: () =>
      new Promise<void>((r) => {
        for (const s of open) s.destroy();
        server.close(() => r());
      }),
  };
}
