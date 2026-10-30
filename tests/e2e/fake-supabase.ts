/**
 * TEST-ONLY stand-in for the few Supabase endpoints the app calls (Auth, PostgREST, Storage),
 * so the browser tests can run without a Supabase project. It keeps everything in memory and
 * exposes what the app stored so tests can assert on it. It is not used by the application.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';

export const OFFICER = {
  id: '00000000-0000-4000-8000-0000000000c1',
  email: 'officer@example.org',
  password: 'correct-horse-battery',
  displayName: 'Test Officer',
  officerCode: 'JP-0001',
};

type Row = Record<string, unknown>;

export interface FakeState {
  profiles: Row[];
  entries: Row[];
  optOuts: string[];
  audit: Row[];
  uploads: { path: string; bytes: Buffer }[];
  pdfs: { path: string; bytes: Buffer }[];
  deleted: string[];
  requests: string[];
}

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

function jwt(sub: string, role: string): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, role, aud: 'authenticated', exp })}.fakesig`;
}

function userJson() {
  return {
    id: OFFICER.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: OFFICER.email,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns'].includes(key)) continue;
    const [op, ...rest] = raw.split('.');
    const value = rest.join('.');
    const actual = row[key];
    if (op === 'eq' && String(actual) !== value) return false;
    if (op === 'gte' && !(String(actual) >= value)) return false;
  }
  return true;
}

export function freshState(): FakeState {
  return {
    profiles: [
      {
        id: OFFICER.id,
        email: OFFICER.email,
        display_name: OFFICER.displayName,
        role: 'officer',
        officer_code: OFFICER.officerCode,
        active: true,
        must_change_password: false,
      },
    ],
    entries: [],
    optOuts: [],
    audit: [],
    uploads: [],
    pdfs: [],
    deleted: [],
    requests: [],
  };
}

export async function startFakeSupabase(
  port: number,
): Promise<{ state: FakeState; reset(): void; close(): Promise<void> }> {
  const holder = { state: freshState() };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const body = await readBody(req);
    const st = holder.state;
    st.requests.push(`${method} ${path}`);

    const send = (code: number, obj?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(obj === undefined ? undefined : JSON.stringify(obj));
    };
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');

    // ---- Auth
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = JSON.parse(body.toString() || '{}') as {
        email?: string;
        password?: string;
      };
      if (email === OFFICER.email && password === OFFICER.password) {
        return send(200, {
          access_token: jwt(OFFICER.id, 'authenticated'),
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'fake-refresh',
          user: userJson(),
        });
      }
      return send(400, {
        code: 400,
        error_code: 'invalid_credentials',
        msg: 'Invalid login credentials',
      });
    }
    if (path === '/auth/v1/user') {
      return bearer.split('.').length === 3 &&
        bearer.endsWith('.fakesig') &&
        bearer !== 'e2e-anon-key-000000000000'
        ? send(200, userJson())
        : send(401, { code: 401, error_code: 'no_authorization', msg: 'no session' });
    }
    if (path === '/auth/v1/logout') return send(204);

    // ---- PostgREST
    if (path === '/rest/v1/rpc/rate_limit_hit') return send(200, true);
    if (path === '/rest/v1/rpc/claim_certificate') {
      // Mirrors public.claim_certificate in the migration (tested for real in tests/db).
      const { p_entry_id } = JSON.parse(body.toString()) as { p_entry_id: string };
      const e = st.entries.find((r) => r.id === p_entry_id);
      if (!e) return send(200, []);
      const claimable = !e.purged_at && (e.status === 'saved' || e.status === 'failed');
      if (claimable) e.status = 'generating';
      return send(200, [
        {
          claimed: claimable,
          status: e.status,
          purged: Boolean(e.purged_at),
          officer_id: e.officer_id,
          cert_code: e.cert_code,
          person_name: e.person_name ?? null,
          area_name: e.area_name ?? null,
          violation: e.violation,
          other_text: e.other_text ?? null,
          photo_path: e.photo_path ?? null,
          created_at: e.created_at,
        },
      ]);
    }
    if (path === '/rest/v1/audit_log' && method === 'POST') {
      st.audit.push(JSON.parse(body.toString()) as Row);
      return send(201);
    }
    if (path === '/rest/v1/profiles' && method === 'GET') {
      return send(
        200,
        st.profiles.filter((r) => matches(r, url.searchParams)),
      );
    }
    if (path === '/rest/v1/opt_outs' && method === 'GET') {
      return send(
        200,
        st.optOuts
          .filter((h) => url.searchParams.get('phone_hash') === `eq.${h}`)
          .map((h) => ({ phone_hash: h })),
      );
    }
    if (path === '/rest/v1/entries') {
      if (method === 'POST') {
        const row = JSON.parse(body.toString()) as Row;
        const dup = st.entries.some(
          (e) => e.officer_id === row.officer_id && e.client_request_id === row.client_request_id,
        );
        if (dup)
          return send(409, {
            code: '23505',
            message: 'duplicate key value violates unique constraint "entries_officer_request_key"',
          });
        const created_at = new Date().toISOString();
        st.entries.push({ ...row, created_at });
        return send(201, { created_at });
      }
      const rows = st.entries.filter((r) => matches(r, url.searchParams));
      if (method === 'PATCH') {
        const patch = JSON.parse(body.toString()) as Row;
        for (const r of rows) Object.assign(r, patch);
        return send(204);
      }
      if (method === 'HEAD') {
        res.writeHead(200, { 'content-range': `*/${rows.length}` });
        return res.end();
      }
      const sorted = [...rows].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      );
      return send(200, sorted);
    }

    // ---- Storage
    const object = /^\/storage\/v1\/object\/(photos|pdfs)\/(.+)$/.exec(path);
    if (object && method === 'POST') {
      const [, bucket, name] = object;
      const file = {
        path: decodeURIComponent(name!),
        bytes: extractFile(body, req.headers['content-type'] ?? ''),
      };
      const list = bucket === 'photos' ? st.uploads : st.pdfs;
      const i = list.findIndex((u) => u.path === file.path);
      if (i >= 0 && req.headers['x-upsert'] !== 'true') return send(409, { message: 'exists' });
      if (i >= 0) list.splice(i, 1);
      list.push(file);
      return send(200, { Id: 'x', Key: `${bucket}/${name}` });
    }
    if (object && method === 'GET' && object[1] === 'photos') {
      const found = st.uploads.find((u) => u.path === decodeURIComponent(object[2]!));
      if (!found) return send(404, { message: 'not found' });
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(found.bytes);
    }
    if (path === '/storage/v1/object/photos' && method === 'DELETE') {
      const { prefixes } = JSON.parse(body.toString()) as { prefixes: string[] };
      st.deleted.push(...prefixes);
      st.uploads = st.uploads.filter((u) => !prefixes.includes(u.path));
      return send(200, []);
    }

    return send(404, { message: `fake-supabase: no handler for ${method} ${path}` });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    get state() {
      return holder.state;
    },
    reset: () => {
      holder.state = freshState();
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** supabase-js sends uploads as multipart form data; pull the file part's bytes out. */
function extractFile(body: Buffer, contentType: string): Buffer {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) return body;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1 && part.subarray(0, headerEnd).toString().includes('filename')) {
      return part.subarray(headerEnd + 4, part.length - 2); // drop the CRLF before the next boundary
    }
    start = next;
  }
  return body;
}
