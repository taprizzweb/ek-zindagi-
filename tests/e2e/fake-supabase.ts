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

export const SUPERVISOR = {
  id: '00000000-0000-4000-8000-0000000000b1',
  email: 'supervisor@example.org',
  password: 'correct-horse-battery',
  displayName: 'Test Supervisor',
  officerCode: 'JP-S001',
};

export const ADMIN = {
  id: '00000000-0000-4000-8000-0000000000a1',
  email: 'admin@example.org',
  password: 'correct-horse-battery',
  displayName: 'Test Admin',
  officerCode: null as string | null,
};

const USERS = [OFFICER, SUPERVISOR, ADMIN];

type Row = Record<string, unknown>;

export interface FakeState {
  profiles: Row[];
  entries: Row[];
  optOuts: string[];
  audit: Row[];
  settings: Row[];
  uploads: { path: string; bytes: Buffer }[];
  pdfs: { path: string; bytes: Buffer }[];
  links: Row[];
  pendingStatuses: Row[];
  webhookHashes: string[];
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

function userJson(user: { id: string; email: string } = OFFICER) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
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
    if (
      op === 'in' &&
      !value
        .replace(/^\(|\)$/g, '')
        .split(',')
        .includes(String(actual))
    )
      return false;
    if (op === 'gte' && !(String(actual) >= value)) return false;
    if (op === 'lt' && !(String(actual) < value)) return false;
  }
  return true;
}

export function freshState(): FakeState {
  return {
    profiles: [
      [OFFICER, 'officer'],
      [SUPERVISOR, 'supervisor'],
      [ADMIN, 'admin'],
    ].map(([u, role]) => ({
      id: (u as typeof OFFICER).id,
      email: (u as typeof OFFICER).email,
      display_name: (u as typeof OFFICER).displayName,
      role,
      officer_code: (u as typeof OFFICER).officerCode,
      active: true,
      must_change_password: false,
    })),
    entries: [],
    optOuts: [],
    audit: [],
    settings: [],
    uploads: [],
    pdfs: [],
    links: [],
    pendingStatuses: [],
    webhookHashes: [],
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
      const user = USERS.find((u) => u.email === email && u.password === password);
      if (user) {
        return send(200, {
          access_token: jwt(user.id, 'authenticated'),
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: `fake-refresh-${user.id}`,
          user: userJson(user),
        });
      }
      return send(400, {
        code: 400,
        error_code: 'invalid_credentials',
        msg: 'Invalid login credentials',
      });
    }
    if (path === '/auth/v1/user') {
      const sub =
        bearer.split('.').length === 3 &&
        bearer.endsWith('.fakesig') &&
        bearer !== 'e2e-anon-key-000000000000'
          ? (
              JSON.parse(Buffer.from(bearer.split('.')[1]!, 'base64url').toString()) as {
                sub: string;
              }
            ).sub
          : null;
      const user = USERS.find((u) => u.id === sub);
      return user
        ? send(200, userJson(user))
        : send(401, { code: 401, error_code: 'no_authorization', msg: 'no session' });
    }
    if (path === '/auth/v1/logout') return send(204);

    // ---- PostgREST
    if (path === '/rest/v1/rpc/rate_limit_hit') return send(200, true);
    if (path === '/rest/v1/rpc/open_certificate_link') {
      // Mirrors public.open_certificate_link in the migration (tested for real in tests/db).
      const { p_token_hash } = JSON.parse(body.toString()) as { p_token_hash: string };
      const l = st.links.find((x) => x.token_hash === p_token_hash);
      if (!l) return send(200, []);
      if (new Date(String(l.expires_at)).getTime() <= Date.now())
        return send(200, [{ status: 'expired', pdf_path: null }]);
      const e = st.entries.find((x) => x.id === l.entry_id);
      if (!e || e.purged_at || !e.pdf_path) return send(200, [{ status: 'gone', pdf_path: null }]);
      l.open_count = Number(l.open_count ?? 0) + 1;
      e.link_opened_at ??= new Date().toISOString();
      return send(200, [{ status: 'ok', pdf_path: e.pdf_path }]);
    }
    if (path === '/rest/v1/cert_links' && method === 'POST') {
      const row = JSON.parse(body.toString()) as Row;
      st.links.push({ ...row, created_at: new Date().toISOString(), open_count: 0 });
      return send(201);
    }
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
    if (path === '/rest/v1/opt_outs' && method === 'POST') {
      const { phone_hash } = JSON.parse(body.toString()) as { phone_hash: string };
      if (!st.optOuts.includes(phone_hash)) st.optOuts.push(phone_hash);
      return send(201);
    }
    // Cloud API delivery (migration 5). These mirror the SQL functions, which tests/db runs for real.
    if (path === '/rest/v1/rpc/claim_send') {
      const { p_entry_id } = JSON.parse(body.toString()) as { p_entry_id: string };
      const e = st.entries.find((r) => r.id === p_entry_id);
      if (!e) return send(200, []);
      const claimable =
        !e.purged_at &&
        e.pdf_path &&
        (e.status === 'ready' || (e.status === 'failed' && e.retryable === true));
      if (claimable) {
        e.status = 'sending';
        e.send_attempts = Number(e.send_attempts ?? 0) + 1;
        e.retryable = false;
        e.next_retry_at = null;
      }
      return send(200, [
        {
          claimed: Boolean(claimable),
          status: e.status,
          purged: Boolean(e.purged_at),
          officer_id: e.officer_id,
          phone_e164: e.phone_e164 ?? null,
          phone_hash: e.phone_hash ?? null,
          person_name: e.person_name ?? null,
          violation: e.violation,
          cert_code: e.cert_code,
          pdf_path: e.pdf_path ?? null,
          attempts: Number(e.send_attempts ?? 0),
        },
      ]);
    }
    if (path === '/rest/v1/rpc/complete_send') {
      const a = JSON.parse(body.toString()) as {
        p_entry_id: string;
        p_message_id: string;
        p_category: string | null;
      };
      const e = st.entries.find((r) => r.id === a.p_entry_id);
      if (!e || e.status !== 'sending') return send(200, false);
      Object.assign(e, {
        status: 'sent',
        wa_message_id: a.p_message_id,
        wa_category: a.p_category,
        sent_at: new Date().toISOString(),
        delivery_mode: 'cloud_api',
        error_code: null,
      });
      const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
      for (const p of st.pendingStatuses.filter((x) => x.message_id === a.p_message_id)) {
        if ((rank[String(p.status)] ?? 0) > (rank[String(e.status)] ?? 0)) e.status = p.status;
      }
      st.pendingStatuses = st.pendingStatuses.filter((x) => x.message_id !== a.p_message_id);
      return send(200, true);
    }
    if (path === '/rest/v1/rpc/fail_send') {
      const a = JSON.parse(body.toString()) as {
        p_entry_id: string;
        p_error: string;
        p_retryable: boolean;
        p_next_retry: string | null;
      };
      const e = st.entries.find((r) => r.id === a.p_entry_id);
      if (!e || e.status !== 'sending') return send(200, false);
      Object.assign(e, {
        status: 'failed',
        error_code: a.p_error,
        retryable: a.p_retryable,
        next_retry_at: a.p_next_retry,
      });
      return send(200, true);
    }
    if (path === '/rest/v1/rpc/apply_wa_status') {
      const a = JSON.parse(body.toString()) as {
        p_message_id: string;
        p_status: string;
        p_error: string | null;
      };
      const e = st.entries.find((r) => r.wa_message_id === a.p_message_id);
      if (!e) {
        st.pendingStatuses.push({ message_id: a.p_message_id, status: a.p_status });
        return send(200, 'pending');
      }
      const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
      if (a.p_status === 'failed') {
        if (e.status === 'delivered' || e.status === 'read') return send(200, 'ignored');
        Object.assign(e, { status: 'failed', error_code: a.p_error, retryable: false });
        return send(200, 'applied');
      }
      if ((rank[a.p_status] ?? 0) <= (rank[String(e.status)] ?? 0)) return send(200, 'ignored');
      e.status = a.p_status;
      return send(200, 'applied');
    }
    if (path === '/rest/v1/rpc/register_webhook') {
      const { p_hash } = JSON.parse(body.toString()) as { p_hash: string };
      if (st.webhookHashes.includes(p_hash)) return send(200, false);
      st.webhookHashes.push(p_hash);
      return send(200, true);
    }
    if (path === '/rest/v1/rpc/due_retries') {
      const { p_limit, p_max_attempts } = JSON.parse(body.toString()) as {
        p_limit: number;
        p_max_attempts: number;
      };
      const due = st.entries
        .filter(
          (e) =>
            e.status === 'failed' &&
            e.retryable === true &&
            !e.purged_at &&
            Number(e.send_attempts ?? 0) < p_max_attempts &&
            (!e.next_retry_at || new Date(String(e.next_retry_at)).getTime() <= Date.now()),
        )
        .slice(0, p_limit)
        .map((e) => e.id);
      return send(200, due);
    }
    if (path === '/rest/v1/rpc/mark_stale_sends') return send(200, 0);
    // Retention, review and counts (migration 6). Mirrors the SQL functions, which tests/db runs for real.
    if (path === '/rest/v1/rpc/due_for_purge') {
      const { p_limit } = JSON.parse(body.toString()) as { p_limit: number };
      const due = st.entries
        .filter((e) => {
          if (e.purged_at) return false;
          const exp = new Date(
            String(e.expires_at ?? new Date(String(e.created_at)).getTime() + 86_400_000),
          ).getTime();
          return exp <= Date.now();
        })
        .slice(0, p_limit)
        .map((e) => ({ id: e.id, photo_path: e.photo_path ?? null, pdf_path: e.pdf_path ?? null }));
      return send(200, due);
    }
    if (path === '/rest/v1/rpc/finish_purge') {
      const { p_ids } = JSON.parse(body.toString()) as { p_ids: string[] };
      let n = 0;
      for (const e of st.entries.filter((r) => p_ids.includes(String(r.id)) && !r.purged_at)) {
        Object.assign(e, {
          person_name: null,
          phone_e164: null,
          other_text: null,
          photo_path: null,
          pdf_path: null,
          purged_at: new Date().toISOString(),
        });
        n++;
      }
      st.links = st.links.filter((l) => !p_ids.includes(String(l.entry_id)));
      return send(200, n);
    }
    if (path === '/rest/v1/rpc/housekeeping') return send(200, { links: 0 });
    if (path === '/rest/v1/rpc/retention_leftovers') {
      const overdue = st.entries.filter(
        (e) =>
          !e.purged_at && new Date(String(e.expires_at ?? 0)).getTime() <= Date.now() - 7_200_000,
      ).length;
      return send(200, [{ overdue, dirty: 0 }]);
    }
    if (path === '/rest/v1/rpc/requeue_failed') {
      const { p_entry_id } = JSON.parse(body.toString()) as { p_entry_id: string };
      const e = st.entries.find((r) => r.id === p_entry_id);
      if (!e || e.status !== 'failed' || e.purged_at || !e.pdf_path) return send(200, false);
      Object.assign(e, {
        status: 'ready',
        retryable: false,
        next_retry_at: null,
        error_code: null,
      });
      return send(200, true);
    }
    if (path === '/rest/v1/rpc/mark_reviewed') {
      const { p_entry_id, p_by } = JSON.parse(body.toString()) as {
        p_entry_id: string;
        p_by: string;
      };
      const e = st.entries.find((r) => r.id === p_entry_id);
      if (!e || e.reviewed) return send(200, false);
      Object.assign(e, {
        reviewed: true,
        reviewed_by: p_by,
        reviewed_at: new Date().toISOString(),
      });
      return send(200, true);
    }
    if (path === '/rest/v1/rpc/review_list') {
      const rows = st.entries
        .filter((e) => !e.reviewed)
        .map((e) => ({
          e,
          reasons: [
            e.photo_source === 'gallery' ? 'gallery' : null,
            e.location_source === 'manual' ? 'manual_location' : null,
            e.consent_checked === false ? 'no_consent' : null,
            e.phone_hash && st.entries.filter((o) => o.phone_hash === e.phone_hash).length > 1
              ? 'repeated_number'
              : null,
          ].filter(Boolean),
        }))
        .filter((r) => r.reasons.length > 0)
        .map(({ e, reasons }) => ({
          id: e.id,
          cert_code: e.cert_code,
          officer_id: e.officer_id,
          violation: e.violation,
          status: e.status,
          created_at: e.created_at,
          reasons,
        }));
      return send(200, rows);
    }
    if (path === '/rest/v1/rpc/entry_stats') {
      const a = JSON.parse(body.toString()) as { p_since: string; p_until: string };
      const groups = new Map<string, Record<string, unknown>>();
      for (const e of st.entries) {
        const t = new Date(String(e.created_at)).getTime();
        if (t < new Date(a.p_since).getTime() || t >= new Date(a.p_until).getTime()) continue;
        const day = new Date(t + 330 * 60_000).toISOString().slice(0, 10);
        const k = `${day}|${e.officer_id}|${e.violation}`;
        const g = groups.get(k) ?? {
          day,
          officer_id: e.officer_id,
          violation: e.violation,
          created: 0,
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          link_opened: 0,
        };
        g.created = Number(g.created) + 1;
        if (e.sent_at) g.sent = Number(g.sent) + 1;
        if (e.delivered_at) g.delivered = Number(g.delivered) + 1;
        if (e.read_at) g.read = Number(g.read) + 1;
        if (e.status === 'failed') g.failed = Number(g.failed) + 1;
        if (e.link_opened_at) g.link_opened = Number(g.link_opened) + 1;
        groups.set(k, g);
      }
      return send(200, [...groups.values()]);
    }
    if (path === '/rest/v1/settings') {
      if (method === 'POST') {
        const row = JSON.parse(body.toString()) as Row;
        const i = st.settings.findIndex((r) => r.key === row.key);
        if (i >= 0) st.settings[i] = row;
        else st.settings.push(row);
        return send(201);
      }
      return send(200, st.settings);
    }
    if (path === '/rest/v1/audit_log' && method === 'GET') {
      const p = url.searchParams;
      const rows = st.audit
        .filter((r) => matches({ ...r }, p))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)) || Number(b.id) - Number(a.id));
      const off = Number(p.get('offset') ?? 0);
      const lim = Number(p.get('limit') ?? rows.length);
      return send(200, rows.slice(off, off + lim));
    }
    if (path === '/rest/v1/audit_log' && method === 'POST') {
      st.audit.push({
        id: st.audit.length + 1,
        at: new Date().toISOString(),
        ...(JSON.parse(body.toString()) as Row),
      });
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
        // Like Postgres, every column exists: the ones nobody has set yet are null.
        st.entries.push({
          person_name: null,
          phone_e164: null,
          other_text: null,
          photo_path: null,
          pdf_path: null,
          error_code: null,
          wa_message_id: null,
          sent_at: null,
          delivery_mode: null,
          send_attempts: 0,
          retryable: false,
          next_retry_at: null,
          wa_category: null,
          link_opened_at: null,
          reviewed: false,
          purged_at: null,
          ...row,
          created_at,
        });
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
    if (object && method === 'GET') {
      const list = object[1] === 'photos' ? st.uploads : st.pdfs;
      const found = list.find((u) => u.path === decodeURIComponent(object[2]!));
      if (!found) return send(404, { message: 'not found' });
      res.writeHead(200, {
        'content-type': object[1] === 'pdfs' ? 'application/pdf' : 'image/jpeg',
      });
      return res.end(found.bytes);
    }
    const removal = /^\/storage\/v1\/object\/(photos|pdfs)$/.exec(path);
    if (removal && method === 'DELETE') {
      const { prefixes } = JSON.parse(body.toString()) as { prefixes: string[] };
      st.deleted.push(...prefixes);
      if (removal[1] === 'photos')
        st.uploads = st.uploads.filter((u) => !prefixes.includes(u.path));
      else st.pdfs = st.pdfs.filter((u) => !prefixes.includes(u.path));
      return send(200, []);
    }
    if (object && method === 'HEAD') {
      const list = object[1] === 'photos' ? st.uploads : st.pdfs;
      const found = list.some((u) => u.path === decodeURIComponent(object[2]!));
      res.writeHead(found ? 200 : 404);
      return res.end();
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
