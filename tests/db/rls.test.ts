import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const SUPERVISOR = '00000000-0000-4000-8000-0000000000b1';
const OFFICER1 = '00000000-0000-4000-8000-0000000000c1';
const OFFICER2 = '00000000-0000-4000-8000-0000000000c2';
const DISABLED = '00000000-0000-4000-8000-0000000000c3';
const E_O1_NEW = '10000000-0000-4000-8000-000000000001';
const E_O1_OLD = '10000000-0000-4000-8000-000000000002';
const E_O2_NEW = '10000000-0000-4000-8000-000000000003';
const HASH = 'a'.repeat(64);

type Role = 'authenticated' | 'anon' | 'service_role';
let db: pg.Client;

/** Runs `fn` the way PostgREST would: as `role`, with the JWT subject set, then rolls back. */
async function as<T>(role: Role, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return await fn();
  } finally {
    await db.query('rollback');
  }
}
const q = (sql: string, params: unknown[] = []) => db.query(sql, params);
const denied = (p: Promise<unknown>, re: RegExp = /permission denied/) =>
  expect(p).rejects.toThrow(re);

beforeAll(async () => {
  db = new pg.Client({ connectionString: inject('dbUrl') });
  await db.connect();
  const people: [string, string, string, string, boolean][] = [
    [ADMIN, 'admin@example.org', 'NGO Admin', 'admin', true],
    [SUPERVISOR, 'sup@example.org', 'Supervisor One', 'supervisor', true],
    [OFFICER1, 'o1@example.org', 'Officer One', 'officer', true],
    [OFFICER2, 'o2@example.org', 'Officer Two', 'officer', true],
    [DISABLED, 'o3@example.org', 'Officer Three', 'officer', false],
  ];
  for (const [id, email, name, role, active] of people) {
    await q('insert into auth.users (id, email) values ($1, $2)', [id, email]);
    await q(
      'insert into public.profiles (id, email, display_name, role, active) values ($1,$2,$3,$4,$5)',
      [id, email, name, role, active],
    );
  }
  const entry = (id: string, code: string, officer: string, age: string) =>
    q(
      `insert into public.entries (id, cert_code, officer_id, violation, location_source,
         photo_source, consent_checked, person_name, phone_e164, phone_hash, photo_path, pdf_path,
         other_text, created_at)
       values ($1,$2,$3,'helmet','manual','camera',true,'Ravi Kumar','+919876543210',$4,'p/1.jpg',
         'd/1.pdf','secret note', now() - $5::interval)`,
      [id, code, officer, HASH, age],
    );
  await entry(E_O1_NEW, 'EKZ-T-0001', OFFICER1, '1 hour');
  await entry(E_O1_OLD, 'EKZ-T-0002', OFFICER1, '10 days');
  await entry(E_O2_NEW, 'EKZ-T-0003', OFFICER2, '1 hour');
  await q(
    `insert into storage.objects (bucket_id, name) values ('photos','p/1.jpg'), ('pdfs','d/1.pdf')`,
  );
});

afterAll(async () => {
  await db.end();
});

describe('officer codes and profile integrity', () => {
  it('assigns JP- codes to officers and supervisors, none to admins', async () => {
    const r = await q('select role, officer_code from public.profiles order by created_at, email');
    const byRole = Object.fromEntries(r.rows.map((x) => [x.role, x.officer_code]));
    expect(byRole.admin).toBeNull();
    const codes = r.rows.map((x) => x.officer_code).filter(Boolean) as string[];
    expect(codes.every((c) => /^JP-\d{4,}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('refuses to change role or officer_code, even for the service role', async () => {
    await as('service_role', null, async () => {
      await denied(
        q(`update public.profiles set officer_code = 'JP-9999' where id = $1`, [OFFICER1]),
        /immutable/,
      );
    });
    await as('service_role', null, async () => {
      await denied(
        q(`update public.profiles set role = 'admin' where id = $1`, [OFFICER1]),
        /immutable/,
      );
    });
  });

  it('requires an officer code for non-admin roles (constraint)', async () => {
    await q('insert into auth.users (id, email) values ($1, $2)', [
      '00000000-0000-4000-8000-0000000000d1',
      'x@example.org',
    ]);
    const r = await q(
      `insert into public.profiles (id, email, display_name, role) values ($1,'x@example.org','Extra Officer','officer') returning officer_code`,
      ['00000000-0000-4000-8000-0000000000d1'],
    );
    expect(r.rows[0].officer_code).toMatch(/^JP-\d{4,}$/);
  });
});

describe('profiles RLS', () => {
  it('an officer sees only their own row', async () => {
    const r = await as('authenticated', OFFICER1, () => q('select id from public.profiles'));
    expect(r.rows.map((x) => x.id)).toEqual([OFFICER1]);
  });

  it('nobody but the server can read email or must_change_password', async () => {
    for (const uid of [OFFICER1, SUPERVISOR, ADMIN]) {
      await as('authenticated', uid, () => denied(q('select email from public.profiles')));
      await as('authenticated', uid, () =>
        denied(q('select must_change_password from public.profiles')),
      );
      await as('authenticated', uid, () => denied(q('select * from public.profiles')));
    }
  });

  it('a supervisor sees officers and supervisors but not the admin', async () => {
    const r = await as('authenticated', SUPERVISOR, () => q('select role from public.profiles'));
    const roles = r.rows.map((x) => x.role);
    expect(roles).not.toContain('admin');
    expect(roles.filter((x) => x === 'officer').length).toBeGreaterThanOrEqual(3);
  });

  it('an admin sees every profile', async () => {
    const r = await as('authenticated', ADMIN, () => q('select id from public.profiles'));
    expect(r.rows.length).toBeGreaterThanOrEqual(5);
  });

  it('anon reads nothing', async () => {
    await as('anon', null, () => denied(q('select id from public.profiles')));
  });

  it('browser roles cannot write profiles', async () => {
    for (const uid of [OFFICER1, SUPERVISOR, ADMIN]) {
      await as('authenticated', uid, () =>
        denied(q(`update public.profiles set active = true where id = $1`, [OFFICER1])),
      );
      await as('authenticated', uid, () =>
        denied(q(`update public.profiles set display_name = 'Hacker' where id = $1`, [uid])),
      );
      await as('authenticated', uid, () =>
        denied(q(`delete from public.profiles where id = $1`, [OFFICER2])),
      );
      await as('authenticated', uid, () =>
        denied(
          q(
            `insert into public.profiles (id,email,display_name,role) values (gen_random_uuid(),'z@example.org','Zed Zed','admin')`,
          ),
        ),
      );
    }
  });
});

describe('entries RLS', () => {
  it('an officer sees only their own recent entries', async () => {
    const r = await as('authenticated', OFFICER1, () => q('select id from public.entries'));
    expect(r.rows.map((x) => x.id)).toEqual([E_O1_NEW]);
  });

  it("an officer cannot read another officer's entry by id", async () => {
    const r = await as('authenticated', OFFICER1, () =>
      q('select id from public.entries where id = $1', [E_O2_NEW]),
    );
    expect(r.rows).toHaveLength(0);
  });

  it('a disabled officer sees no entries at all', async () => {
    await q(
      `insert into public.entries (cert_code, officer_id, violation, location_source) values ('EKZ-T-0009', $1, 'helmet', 'manual')`,
      [DISABLED],
    );
    const r = await as('authenticated', DISABLED, () => q('select id from public.entries'));
    expect(r.rows).toHaveLength(0);
  });

  it('supervisors and admins see every entry', async () => {
    for (const uid of [SUPERVISOR, ADMIN]) {
      const r = await as('authenticated', uid, () =>
        q('select id from public.entries where id = any($1)', [[E_O1_NEW, E_O1_OLD, E_O2_NEW]]),
      );
      expect(r.rows).toHaveLength(3);
    }
  });

  it.each(['person_name', 'phone_e164', 'phone_hash', 'photo_path', 'pdf_path', 'other_text'])(
    'no browser role can read %s',
    async (col) => {
      for (const uid of [OFFICER1, SUPERVISOR, ADMIN]) {
        await as('authenticated', uid, () => denied(q(`select ${col} from public.entries`)));
      }
      await as('anon', null, () => denied(q(`select ${col} from public.entries`)));
    },
  );

  it('select * is refused (clients must name non-personal columns)', async () => {
    await as('authenticated', SUPERVISOR, () => denied(q('select * from public.entries')));
  });

  it('browser roles cannot write entries', async () => {
    for (const uid of [OFFICER1, SUPERVISOR, ADMIN]) {
      await as('authenticated', uid, () =>
        denied(
          q(
            `insert into public.entries (cert_code, officer_id, violation, location_source) values ('EKZ-X', $1, 'helmet', 'manual')`,
            [uid],
          ),
        ),
      );
      await as('authenticated', uid, () => denied(q(`update public.entries set reviewed = true`)));
      await as('authenticated', uid, () => denied(q(`delete from public.entries`)));
    }
  });

  it('a purged entry cannot still carry personal data', async () => {
    await as('service_role', null, () =>
      denied(
        q(`update public.entries set purged_at = now() where id = $1`, [E_O1_NEW]),
        /entries_purged_is_clean/,
      ),
    );
    await as('service_role', null, async () => {
      await q(
        `update public.entries set purged_at = now(), person_name = null, phone_e164 = null, other_text = null, photo_path = null, pdf_path = null where id = $1`,
        [E_O1_NEW],
      );
    });
  });

  it('a photo requires the consent flag', async () => {
    await denied(
      q(
        `insert into public.entries (cert_code, officer_id, violation, location_source, photo_source, consent_checked) values ('EKZ-T-0010', $1, 'helmet', 'manual', 'camera', false)`,
        [OFFICER1],
      ),
      /entries_photo_needs_consent/,
    );
  });

  it('rejects malformed phone numbers and stores coordinates at 3 decimals', async () => {
    await denied(
      q(
        `insert into public.entries (cert_code, officer_id, violation, location_source, phone_e164) values ('EKZ-T-0011', $1, 'helmet', 'manual', '+911234567890')`,
        [OFFICER1],
      ),
      /phone_e164/,
    );
    const r = await q(
      `insert into public.entries (cert_code, officer_id, violation, location_source, lat, lng) values ('EKZ-T-0012', $1, 'helmet', 'gps', 26.912345, 75.787654) returning lat, lng`,
      [OFFICER1],
    );
    expect(r.rows[0]).toEqual({ lat: '26.912', lng: '75.788' });
  });
});

describe('audit log', () => {
  it('only an admin can read it', async () => {
    await q(`insert into public.audit_log (action, meta) values ('login', '{}')`);
    for (const uid of [OFFICER1, SUPERVISOR]) {
      const r = await as('authenticated', uid, () => q('select id from public.audit_log'));
      expect(r.rows).toHaveLength(0);
    }
    const r = await as('authenticated', ADMIN, () => q('select id from public.audit_log'));
    expect(r.rows.length).toBeGreaterThan(0);
    await as('anon', null, () => denied(q('select id from public.audit_log')));
  });

  it('the service role can append but not change or remove rows', async () => {
    await as('service_role', null, async () => {
      const r = await q(
        `insert into public.audit_log (action, actor_id, actor_code, meta) values ('officer_created', $1, 'JP-0001', '{"role":"officer"}') returning id`,
        [ADMIN],
      );
      expect(r.rows).toHaveLength(1);
    });
    await as('service_role', null, () => denied(q(`update public.audit_log set action = 'login'`)));
    await as('service_role', null, () => denied(q(`delete from public.audit_log`)));
    await as('service_role', null, () => denied(q(`truncate public.audit_log`)));
  });

  it('even the table owner cannot edit rows (trigger)', async () => {
    await denied(q(`update public.audit_log set action = 'login'`), /append-only/);
    await denied(q(`delete from public.audit_log`), /append-only/);
    await denied(q(`truncate public.audit_log`), /append-only/);
  });

  it('browser roles cannot write', async () => {
    for (const uid of [OFFICER1, ADMIN]) {
      await as('authenticated', uid, () =>
        denied(q(`insert into public.audit_log (action) values ('login')`)),
      );
    }
  });

  it.each(['name', 'person_name', 'phone', 'phone_e164', 'photo', 'password', 'token', 'email'])(
    'rejects a meta object with the personal key "%s"',
    async (key) => {
      await denied(
        q(
          `insert into public.audit_log (action, meta) values ('login', jsonb_build_object($1::text, 'x'))`,
          [key],
        ),
        /audit_meta_no_personal_keys/,
      );
    },
  );
});

describe('private storage', () => {
  it('buckets are private with size and type limits', async () => {
    const r = await q(
      `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id in ('photos','pdfs') order by id`,
    );
    expect(r.rows.map((x) => x.public)).toEqual([false, false]);
    expect(r.rows.every((x) => x.file_size_limit > 0 && x.allowed_mime_types.length === 1)).toBe(
      true,
    );
  });

  it('officers, supervisors, admins and anon see no objects', async () => {
    const seen = await q(
      `select count(*)::int as n from storage.objects where bucket_id in ('photos','pdfs')`,
    );
    expect(seen.rows[0].n).toBe(2);
    for (const [role, uid] of [
      ['authenticated', OFFICER1],
      ['authenticated', SUPERVISOR],
      ['authenticated', ADMIN],
      ['anon', null],
    ] as [Role, string | null][]) {
      const r = await as(role, uid, () => q(`select id from storage.objects`));
      expect(r.rows).toHaveLength(0);
    }
  });

  it('browser roles cannot upload into the private buckets', async () => {
    for (const bucket of ['photos', 'pdfs']) {
      await as('authenticated', OFFICER1, () =>
        denied(
          q(`insert into storage.objects (bucket_id, name) values ($1, 'x/evil')`, [bucket]),
          /row-level security/,
        ),
      );
    }
  });

  it('the service role can read objects', async () => {
    const r = await as('service_role', null, () => q(`select id from storage.objects`));
    expect(r.rows).toHaveLength(2);
  });
});

describe('server-only functions', () => {
  it('rate_limit_hit allows up to the limit, then refuses', async () => {
    const results: boolean[] = [];
    await as('service_role', null, async () => {
      for (let i = 0; i < 4; i++) {
        const r = await q(`select public.rate_limit_hit('login:ip:1.2.3.4', 900, 3) as ok`);
        results.push(r.rows[0].ok);
      }
    });
    expect(results).toEqual([true, true, true, false]);
  });

  it('rate_limit_hit keeps separate counters per key', async () => {
    const r = await as('service_role', null, async () => {
      await q(`select public.rate_limit_hit('k:a', 900, 1)`);
      return q(`select public.rate_limit_hit('k:b', 900, 1) as ok`);
    });
    expect(r.rows[0].ok).toBe(true);
  });

  it('browser roles cannot call rate_limit_hit or revoke_user_sessions', async () => {
    await as('authenticated', OFFICER1, () =>
      denied(q(`select public.rate_limit_hit('x', 60, 1)`)),
    );
    await as('authenticated', ADMIN, () =>
      denied(q(`select public.revoke_user_sessions($1)`, [OFFICER1])),
    );
    await as('anon', null, () => denied(q(`select public.revoke_user_sessions($1)`, [OFFICER1])));
  });

  it("revoke_user_sessions deletes only that user's sessions", async () => {
    await q(`insert into auth.sessions (user_id) values ($1), ($1), ($2)`, [OFFICER1, OFFICER2]);
    const r = await as('service_role', null, async () => {
      await q(`select public.revoke_user_sessions($1)`, [OFFICER1]);
      await q('reset role'); // read back as owner; the function ran as service_role
      return q(`select user_id from auth.sessions`);
    });
    expect(r.rows.map((x) => x.user_id)).toEqual([OFFICER2]);
  });

  it('browser roles cannot touch the rate_limits table', async () => {
    await as('authenticated', ADMIN, () => denied(q(`select * from public.rate_limits`)));
  });
});

describe('intake constraints (migration 2)', () => {
  const base = (cols: string, vals: string, extra: unknown[] = []) =>
    q(
      `insert into public.entries (cert_code, officer_id, violation, ${cols}) values ('EKZ-I-' || substr(md5(random()::text), 1, 8), $1, 'helmet', ${vals})`,
      [OFFICER1, ...extra],
    );

  it('a GPS entry needs coordinates, a manual entry must not have any', async () => {
    await denied(base('location_source', `'gps'`), /entries_location_consistent/);
    await denied(
      base('location_source, lat, lng', `'manual', 26.9, 75.8`),
      /entries_location_consistent/,
    );
    await base('location_source, lat, lng', `'gps', 26.912, 75.787`);
    await base('location_source', `'manual'`);
  });

  it('a gallery photo needs a reason', async () => {
    await denied(
      base('location_source, photo_source, consent_checked', `'manual', 'gallery', true`),
      /entries_gallery_needs_reason/,
    );
    await base(
      'location_source, photo_source, consent_checked, gallery_reason',
      `'manual', 'gallery', true, 'camera_not_working'`,
    );
  });

  it('the same officer cannot reuse a client request id, another officer can', async () => {
    const id = '20000000-0000-4000-8000-000000000001';
    const ins = (officer: string) =>
      q(
        `insert into public.entries (cert_code, officer_id, violation, location_source, client_request_id) values ('EKZ-R-' || substr(md5(random()::text), 1, 8), $1, 'helmet', 'manual', $2)`,
        [officer, id],
      );
    await ins(OFFICER1);
    await denied(ins(OFFICER1), /entries_officer_request_key/);
    await ins(OFFICER2);
  });

  it('client_request_id is not readable by browser roles', async () => {
    await as('authenticated', OFFICER1, () =>
      denied(q('select client_request_id from public.entries')),
    );
  });

  it('opt_outs is server-only and stores hashes only', async () => {
    await as('authenticated', ADMIN, () => denied(q('select * from public.opt_outs')));
    await as('anon', null, () => denied(q('select * from public.opt_outs')));
    await as('authenticated', OFFICER1, () =>
      denied(q(`insert into public.opt_outs (phone_hash) values ('${HASH}')`)),
    );
    await as('service_role', null, async () => {
      await q(`insert into public.opt_outs (phone_hash) values ('${HASH}')`);
      await denied(
        q(`insert into public.opt_outs (phone_hash) values ('+919876543210')`),
        /phone_hash/,
      );
    });
  });

  it('accepts the entry_created audit action', async () => {
    await q(
      `insert into public.audit_log (action, meta) values ('entry_created', '{"violation":"helmet"}')`,
    );
  });
});

describe('certificate lifecycle (migration 3)', () => {
  const E = '50000000-0000-4000-8000-000000000001';
  const ins = (id: string, status = 'saved', extra = '') =>
    q(
      `insert into public.entries (id, cert_code, officer_id, violation, location_source, status, area_name, person_name ${extra ? ', ' + extra.split('=')[0] : ''})
       values ($1::uuid, 'EKZ-C-' || substr(md5($1::text), 1, 8), $2, 'helmet', 'manual', $3, 'Station Road', 'Ravi Kumar' ${extra ? ', ' + extra.split('=')[1] : ''})`,
      [id, OFFICER1, status],
    );
  const claim = (id: string) =>
    as(
      'service_role',
      null,
      async () => (await q('select * from public.claim_certificate($1)', [id])).rows,
    );

  it('claims a saved entry once; a second caller is told it is already being generated', async () => {
    await ins(E);
    const first = await as('service_role', null, async () => {
      const a = (await q('select * from public.claim_certificate($1)', [E])).rows[0];
      const b = (await q('select * from public.claim_certificate($1)', [E])).rows[0];
      return { a, b };
    });
    expect(first.a).toMatchObject({
      claimed: true,
      status: 'generating',
      person_name: 'Ravi Kumar',
      area_name: 'Station Road',
      violation: 'helmet',
      officer_id: OFFICER1,
    });
    expect(first.b).toMatchObject({ claimed: false, status: 'generating' });
  });

  it('is atomic across connections: only one of many simultaneous callers wins', async () => {
    const id = '50000000-0000-4000-8000-000000000002';
    await ins(id);
    const clients = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const c = new pg.Client({ connectionString: inject('dbUrl') });
        await c.connect();
        await c.query('set role service_role');
        return c;
      }),
    );
    try {
      const results = await Promise.all(
        clients.map((c) => c.query('select claimed from public.claim_certificate($1)', [id])),
      );
      expect(results.filter((r) => r.rows[0].claimed).length).toBe(1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it('can claim a failed entry again', async () => {
    const id = '50000000-0000-4000-8000-000000000003';
    await ins(id, 'failed');
    expect((await claim(id))[0]).toMatchObject({ claimed: true });
  });

  it('can take over a render that has been stuck for over two minutes, but not a fresh one', async () => {
    const id = '50000000-0000-4000-8000-000000000004';
    await ins(id, 'generating');
    expect((await claim(id))[0]).toMatchObject({ claimed: false, status: 'generating' });
    await q(
      `update public.entries set status_changed_at = now() - interval '3 minutes' where id = $1`,
      [id],
    );
    const [takeOver, again] = await as('service_role', null, async () => [
      (await q('select * from public.claim_certificate($1)', [id])).rows[0],
      (await q('select * from public.claim_certificate($1)', [id])).rows[0],
    ]);
    expect(takeOver).toMatchObject({ claimed: true });
    expect(again).toMatchObject({ claimed: false }); // the take-over reset the clock
  });

  it('does not touch an entry that is already ready, and reports its status', async () => {
    const id = '50000000-0000-4000-8000-000000000005';
    await ins(id, 'ready', `pdf_path='${id}.pdf'`);
    expect((await claim(id))[0]).toMatchObject({ claimed: false, status: 'ready' });
  });

  it('refuses an entry whose data was already deleted', async () => {
    const id = '50000000-0000-4000-8000-000000000006';
    await q(
      `insert into public.entries (id, cert_code, officer_id, violation, location_source, purged_at) values ($1, 'EKZ-C-purged01', $2, 'helmet', 'manual', now())`,
      [id, OFFICER1],
    );
    expect((await claim(id))[0]).toMatchObject({ claimed: false, purged: true, person_name: null });
  });

  it('returns nothing for an unknown id', async () => {
    expect(await claim('50000000-0000-4000-8000-0000000000ff')).toEqual([]);
  });

  it('browser roles cannot claim', async () => {
    await as('authenticated', OFFICER1, () =>
      denied(q('select * from public.claim_certificate($1)', [E])),
    );
    await as('anon', null, () => denied(q('select * from public.claim_certificate($1)', [E])));
  });

  it('a ready entry must have a PDF (unless purged)', async () => {
    await denied(
      q(
        `insert into public.entries (cert_code, officer_id, violation, location_source, status) values ('EKZ-C-nopdf001', $1, 'helmet', 'manual', 'ready')`,
        [OFFICER1],
      ),
      /entries_ready_has_pdf/,
    );
    for (const s of ['sending', 'sent', 'delivered', 'read']) {
      await denied(
        q(
          `insert into public.entries (cert_code, officer_id, violation, location_source, status) values ('EKZ-C-nopdf002', $1, 'helmet', 'manual', '${s}')`,
          [OFFICER1],
        ),
        /entries_ready_has_pdf/,
      );
    }
  });

  it('records when the status last changed', async () => {
    const id = '50000000-0000-4000-8000-000000000007';
    await ins(id);
    await q(`update public.entries set status_changed_at = '2020-01-01' where id = $1`, [id]);
    await q(`update public.entries set reviewed = true where id = $1`, [id]);
    expect(
      (
        await q(
          "select status_changed_at < now() - interval '1 year' as old from public.entries where id = $1",
          [id],
        )
      ).rows[0].old,
    ).toBe(true);
    await q(`update public.entries set status = 'failed' where id = $1`, [id]);
    expect(
      (
        await q(
          "select status_changed_at > now() - interval '1 minute' as fresh from public.entries where id = $1",
          [id],
        )
      ).rows[0].fresh,
    ).toBe(true);
  });

  it('accepts the new audit actions', async () => {
    await q(
      `insert into public.audit_log (action, meta) values ('certificate_generated', '{"ms": 900, "kb": 120}'), ('certificate_failed', '{"stage": "render"}')`,
    );
  });
});

describe('bridge links (migration 4)', () => {
  const hash = (c: string) => c.repeat(64).slice(0, 64);
  const entry = async (id: string, extra = `, pdf_path = '${id}.pdf'`) => {
    await q(
      `insert into public.entries (id, cert_code, officer_id, violation, location_source, status, pdf_path)
       values ($1::uuid, 'EKZ-L-' || substr(md5($1::text), 1, 8), $2, 'helmet', 'manual', 'ready', $1::text || '.pdf')`,
      [id, OFFICER1],
    );
    void extra;
  };
  const link = (entryId: string, h: string, createdAgo = '0 seconds', ttl = '24 hours') =>
    q(
      `insert into public.cert_links (entry_id, token_hash, created_at, expires_at)
       values ($1, $2, now() - $3::interval, now() - $3::interval + $4::interval)`,
      [entryId, h, createdAgo, ttl],
    );
  const open = (h: string) =>
    as(
      'service_role',
      null,
      async () => (await q('select * from public.open_certificate_link($1)', [h])).rows,
    );

  it('opens a valid link, returns the PDF path and counts the open', async () => {
    const id = '60000000-0000-4000-8000-000000000001';
    await entry(id);
    await link(id, hash('a'));
    const r = await as('service_role', null, async () => {
      const rows = (await q(`select * from public.open_certificate_link($1)`, [hash('a')])).rows;
      await q(`select * from public.open_certificate_link($1)`, [hash('a')]);
      await q('reset role');
      return {
        rows,
        link: (
          await q(
            `select open_count, opened_at is not null as opened from public.cert_links where token_hash = $1`,
            [hash('a')],
          )
        ).rows[0],
        entry: (
          await q(`select link_opened_at is not null as opened from public.entries where id = $1`, [
            id,
          ])
        ).rows[0],
      };
    });
    expect(r.rows).toEqual([{ status: 'ok', pdf_path: `${id}.pdf` }]);
    expect(r.link).toEqual({ open_count: 2, opened: true });
    expect(r.entry.opened).toBe(true);
  });

  it('returns nothing for an unknown token', async () => {
    expect(await open(hash('f'))).toEqual([]);
  });

  it('says expired once 24 hours have passed (and counts nothing)', async () => {
    const id = '60000000-0000-4000-8000-000000000002';
    await entry(id);
    await link(id, hash('b'), '24 hours 1 second');
    const r = await as('service_role', null, async () => {
      const rows = (await q(`select * from public.open_certificate_link($1)`, [hash('b')])).rows;
      await q('reset role');
      return {
        rows,
        n: (await q(`select open_count from public.cert_links where token_hash = $1`, [hash('b')]))
          .rows[0].open_count,
      };
    });
    expect(r.rows).toEqual([{ status: 'expired', pdf_path: null }]);
    expect(r.n).toBe(0);
  });

  it('is still valid just before 24 hours, expired exactly at the limit', async () => {
    const a = '60000000-0000-4000-8000-000000000003';
    const b = '60000000-0000-4000-8000-000000000004';
    await entry(a);
    await entry(b);
    await link(a, hash('c'), '23 hours 59 minutes');
    await link(b, hash('d'), '24 hours');
    expect((await open(hash('c')))[0]).toMatchObject({ status: 'ok' });
    expect((await open(hash('d')))[0]).toMatchObject({ status: 'expired' });
  });

  it('says gone when the data was already deleted, or there is no PDF', async () => {
    const a = '60000000-0000-4000-8000-000000000005';
    await q(
      `insert into public.entries (id, cert_code, officer_id, violation, location_source, purged_at) values ($1, 'EKZ-L-purged1', $2, 'helmet', 'manual', now())`,
      [a, OFFICER1],
    );
    await link(a, hash('e'));
    expect((await open(hash('e')))[0]).toMatchObject({ status: 'gone' });
    const b = '60000000-0000-4000-8000-000000000006';
    await q(
      `insert into public.entries (id, cert_code, officer_id, violation, location_source) values ($1, 'EKZ-L-nopdf01', $2, 'helmet', 'manual')`,
      [b, OFFICER1],
    );
    await link(b, hash('9'));
    expect((await open(hash('9')))[0]).toMatchObject({ status: 'gone' });
  });

  it('refuses a link that would live longer than 24 hours, or that is already expired on creation', async () => {
    const id = '60000000-0000-4000-8000-000000000007';
    await entry(id);
    await denied(link(id, hash('1'), '0 seconds', '25 hours'), /cert_links_max_24h/);
    await denied(link(id, hash('2'), '0 seconds', '24 hours 1 second'), /cert_links_max_24h/);
    await denied(link(id, hash('3'), '0 seconds', '-1 hour'), /cert_links_max_24h/);
    await link(id, hash('4'), '0 seconds', '24 hours');
  });

  it('stores a hash only, and it must look like one', async () => {
    const id = '60000000-0000-4000-8000-000000000008';
    await entry(id);
    await denied(link(id, 'plaintext-token-abc'), /token_hash/);
    await denied(link(id, 'G'.repeat(64)), /token_hash/);
  });

  it('is deleted together with its entry', async () => {
    const id = '60000000-0000-4000-8000-000000000009';
    await entry(id);
    await link(id, hash('7'));
    await q(`delete from public.entries where id = $1`, [id]);
    expect(
      (await q(`select 1 from public.cert_links where entry_id = $1`, [id])).rows,
    ).toHaveLength(0);
  });

  it('browser roles cannot read, write or open links', async () => {
    for (const [role, uid] of [
      ['authenticated', OFFICER1],
      ['authenticated', ADMIN],
      ['anon', null],
    ] as [Role, string | null][]) {
      await as(role, uid, () => denied(q('select * from public.cert_links')));
      await as(role, uid, () =>
        denied(
          q(
            `insert into public.cert_links (entry_id, token_hash, expires_at) values (gen_random_uuid(), $1, now())`,
            [hash('8')],
          ),
        ),
      );
      await as(role, uid, () =>
        denied(q('select * from public.open_certificate_link($1)', [hash('a')])),
      );
    }
  });

  it('accepts the new audit actions', async () => {
    await q(
      `insert into public.audit_log (action, meta) values ('delivery_prepared', '{"mode":"bridge"}'), ('certificate_downloaded', '{"format":"pdf"}')`,
    );
  });
});

describe('cloud API delivery (migration 5)', () => {
  const seq = { n: 0 };
  /** A ready entry, ready to be sent. */
  async function entry(
    over: {
      status?: string;
      retryable?: boolean;
      nextRetry?: string;
      attempts?: number;
      msg?: string;
    } = {},
  ) {
    const id = `70000000-0000-4000-8000-${String(++seq.n).padStart(12, '0')}`;
    await q(
      `insert into public.entries (id, cert_code, officer_id, violation, location_source, status, person_name, phone_e164,
         phone_hash, pdf_path, retryable, next_retry_at, send_attempts, wa_message_id, delivery_mode)
       values ($1::uuid, 'EKZ-W-' || substr(md5($1::text), 1, 8), $2, 'helmet', 'manual', $3::public.entry_status,
         'Ravi Kumar', '+919876543210', $4, $1::text || '.pdf', $5::boolean,
         case when $6::text is null then null else now() + $6::text::interval end, $7::int, $8::text, $9::text)`,
      [
        id,
        OFFICER1,
        over.status ?? 'ready',
        HASH,
        over.retryable ?? false,
        over.nextRetry ?? null,
        over.attempts ?? 0,
        over.msg ?? null,
        over.status && over.status !== 'ready' ? 'cloud_api' : null,
      ],
    );
    return id;
  }

  const svc = <T>(fn: () => Promise<T>) => as('service_role', null, fn);
  const row = async (id: string) =>
    (await q('select * from public.entries where id = $1', [id])).rows[0];

  it('claims a ready entry once; a second caller gets it unclaimed as "sending"', async () => {
    const id = await entry();
    const [a, b] = await svc(async () => [
      (await q('select * from public.claim_send($1)', [id])).rows[0],
      (await q('select * from public.claim_send($1)', [id])).rows[0],
    ]);
    expect(a).toMatchObject({
      claimed: true,
      status: 'sending',
      attempts: 1,
      phone_e164: '+919876543210',
      person_name: 'Ravi Kumar',
      pdf_path: `${id}.pdf`,
    });
    expect(b).toMatchObject({ claimed: false, status: 'sending' });
  });

  it('is atomic across connections: of eight simultaneous callers exactly one wins', async () => {
    const id = await entry();
    const clients = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const c = new pg.Client({ connectionString: inject('dbUrl') });
        await c.connect();
        await c.query('set role service_role');
        return c;
      }),
    );
    try {
      const results = await Promise.all(
        clients.map((c) => c.query('select claimed from public.claim_send($1)', [id])),
      );
      expect(results.filter((r) => r.rows[0].claimed)).toHaveLength(1);
      expect((await row(id)).send_attempts).toBe(1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it.each(['saved', 'generating', 'sent', 'delivered', 'read', 'sending'])(
    'never claims an entry that is %s',
    async (status) => {
      const id =
        status === 'saved' || status === 'generating'
          ? await (async () => {
              const i = `71000000-0000-4000-8000-${String(++seq.n).padStart(12, '0')}`;
              await q(
                `insert into public.entries (id, cert_code, officer_id, violation, location_source, status) values ($1::uuid, 'EKZ-W-' || substr(md5($1::text), 1, 8), $2, 'helmet', 'manual', $3)`,
                [i, OFFICER1, status],
              );
              return i;
            })()
          : await entry({ status, msg: `wamid.${status}${seq.n}` });
      const r = await svc(
        async () => (await q('select * from public.claim_send($1)', [id])).rows[0],
      );
      expect(r.claimed).toBe(false);
      expect(r.status).toBe(status);
    },
  );

  it('claims a failed entry only if it is marked retryable', async () => {
    const yes = await entry({ status: 'failed', retryable: true });
    const no = await entry({ status: 'failed', retryable: false });
    expect(
      (await svc(async () => (await q('select claimed from public.claim_send($1)', [yes])).rows[0]))
        .claimed,
    ).toBe(true);
    expect(
      (await svc(async () => (await q('select claimed from public.claim_send($1)', [no])).rows[0]))
        .claimed,
    ).toBe(false);
  });

  it('refuses an entry whose data was deleted, and one with no PDF; unknown ids return nothing', async () => {
    const id = `72000000-0000-4000-8000-${String(++seq.n).padStart(12, '0')}`;
    await q(
      `insert into public.entries (id, cert_code, officer_id, violation, location_source, purged_at) values ($1::uuid, 'EKZ-W-' || substr(md5($1::text), 1, 8), $2, 'helmet', 'manual', now())`,
      [id, OFFICER1],
    );
    expect(
      await svc(async () => (await q('select * from public.claim_send($1)', [id])).rows[0]),
    ).toMatchObject({ claimed: false, purged: true, person_name: null });
    expect(
      await svc(
        async () =>
          (await q('select * from public.claim_send($1)', ['72000000-0000-4000-8000-0000000000ff']))
            .rows,
      ),
    ).toEqual([]);
  });

  /** Runs the steps as the service role in ONE transaction, then reads the entries back as the owner. */
  const flow = (steps: () => Promise<unknown>, ids: string[]) =>
    svc(async () => {
      const out = await steps();
      await q('reset role');
      const rows = (await q('select * from public.entries where id = any($1::uuid[])', [ids])).rows;
      return {
        out,
        e: Object.fromEntries(rows.map((r) => [r.id, r])) as Record<
          string,
          Record<string, unknown>
        >,
      };
    });
  const one = async (sql: string, params: unknown[] = []) => (await q(sql, params)).rows[0];

  it('complete_send stores the message id and moves to sent, once, and only from sending', async () => {
    const id = await entry();
    const r = await flow(async () => {
      await q('select * from public.claim_send($1)', [id]);
      const a = (await one(`select public.complete_send($1, 'wamid.A1', 'utility') as ok`, [id]))
        .ok;
      const b = (await one(`select public.complete_send($1, 'wamid.A2', 'utility') as ok`, [id]))
        .ok;
      return { a, b };
    }, [id]);
    expect(r.out).toEqual({ a: true, b: false });
    expect(r.e[id]).toMatchObject({
      status: 'sent',
      wa_message_id: 'wamid.A1',
      wa_category: 'utility',
      retryable: false,
    });
  });

  it('refuses a message id that another entry already has (unique)', async () => {
    await entry({ status: 'sent', msg: 'wamid.DUP' });
    const b = await entry();
    await svc(async () => {
      await q('select * from public.claim_send($1)', [b]);
      await denied(
        q(`select public.complete_send($1, 'wamid.DUP', null)`, [b]),
        /entries_wa_message_id_key/,
      );
    });
  });

  it('fail_send records a retryable failure with a retry time, or a permanent one without', async () => {
    const a = await entry();
    const b = await entry();
    const r = await flow(async () => {
      await q('select * from public.claim_send($1)', [a]);
      await q('select * from public.claim_send($1)', [b]);
      await q(`select public.fail_send($1, 'wa_503', true, now() + interval '5 minutes')`, [a]);
      await q(`select public.fail_send($1, 'wa_131026', false, now() + interval '5 minutes')`, [b]);
    }, [a, b]);
    expect(r.e[a]).toMatchObject({ status: 'failed', error_code: 'wa_503', retryable: true });
    expect(r.e[a]!.next_retry_at).not.toBeNull();
    expect(r.e[b]).toMatchObject({
      status: 'failed',
      error_code: 'wa_131026',
      retryable: false,
      next_retry_at: null,
    });
  });

  it('fail_send and complete_send do nothing once a webhook has moved the entry on', async () => {
    const id = await entry({ status: 'delivered', msg: 'wamid.LATE' });
    const r = await svc(
      async () =>
        await one(
          `select public.fail_send($1, 'wa_500', true, now()) as f, public.complete_send($1, 'wamid.X', null) as c`,
          [id],
        ),
    );
    expect(r).toEqual({ f: false, c: false });
    expect((await row(id)).status).toBe('delivered');
  });

  describe('webhook statuses', () => {
    const apply = async (
      m: string,
      st: string,
      ts = '2026-10-30T10:00:00Z',
      err: string | null = null,
      cat: string | null = null,
    ) =>
      (await one('select public.apply_wa_status($1, $2, $3, $4, $5) as r', [m, st, ts, err, cat]))
        .r as string;

    it('move forward: sent, delivered, read, and set the timestamps', async () => {
      const id = await entry({ status: 'sent', msg: 'wamid.F1' });
      const { e } = await flow(async () => {
        await apply('wamid.F1', 'delivered', '2026-10-30T10:01:00Z', null, 'utility');
        await apply('wamid.F1', 'read', '2026-10-30T10:02:00Z');
      }, [id]);
      expect(e[id]!.status).toBe('read');
      expect(new Date(e[id]!.delivered_at as string).toISOString()).toBe(
        '2026-10-30T10:01:00.000Z',
      );
      expect(new Date(e[id]!.read_at as string).toISOString()).toBe('2026-10-30T10:02:00.000Z');
      expect(e[id]!.wa_category).toBe('utility');
    });

    it('never move backwards: a late "sent" or "delivered" after "read" changes nothing', async () => {
      const id = await entry({ status: 'read', msg: 'wamid.F2' });
      const r = await flow(
        async () => [await apply('wamid.F2', 'sent'), await apply('wamid.F2', 'delivered')],
        [id],
      );
      expect(r.out as string[]).toEqual(['ignored', 'ignored']);
      expect(r.e[id]!.status).toBe('read');
    });

    it('a repeated report is ignored', async () => {
      const id = await entry({ status: 'sent', msg: 'wamid.F3' });
      const r = await flow(
        async () => [await apply('wamid.F3', 'delivered'), await apply('wamid.F3', 'delivered')],
        [id],
      );
      expect(r.out as string[]).toEqual(['applied', 'ignored']);
    });

    it('"read" arriving before "delivered" fills in the delivered time too', async () => {
      const id = await entry({ status: 'sent', msg: 'wamid.F4' });
      const { e } = await flow(async () => apply('wamid.F4', 'read', '2026-10-30T10:05:00Z'), [id]);
      expect([e[id]!.status, e[id]!.delivered_at !== null, e[id]!.read_at !== null]).toEqual([
        'read',
        true,
        true,
      ]);
    });

    it('"failed" after "sent" records the error, is final, and cannot undo a delivery', async () => {
      const a = await entry({ status: 'sent', msg: 'wamid.F5' });
      const b = await entry({ status: 'delivered', msg: 'wamid.F6' });
      const r = await flow(
        async () => [
          await apply('wamid.F5', 'failed', '2026-10-30T10:00:00Z', 'wa_131026'),
          await apply('wamid.F6', 'failed', '2026-10-30T10:00:00Z', 'wa_131026'),
        ],
        [a, b],
      );
      expect(r.out as string[]).toEqual(['applied', 'ignored']);
      expect(r.e[a]).toMatchObject({ status: 'failed', error_code: 'wa_131026', retryable: false });
      expect(r.e[b]!.status).toBe('delivered');
    });

    it('a status for a message we do not have yet waits, and is applied when the send completes', async () => {
      const id = await entry();
      let pendingBefore = -1;
      let pendingAfter = -1;
      const r = await flow(async () => {
        const early = await apply('wamid.EARLY', 'delivered', '2026-10-30T10:01:00Z'); // the webhook beats our own write
        pendingBefore = (
          await one(
            `select count(*)::int as n from public.wa_pending_statuses where message_id = 'wamid.EARLY'`,
          )
        ).n;
        await q('select * from public.claim_send($1)', [id]);
        await q(`select public.complete_send($1, 'wamid.EARLY', 'utility')`, [id]);
        pendingAfter = (
          await one(
            `select count(*)::int as n from public.wa_pending_statuses where message_id = 'wamid.EARLY'`,
          )
        ).n;
        return early;
      }, [id]);
      expect(r.out).toBe('pending');
      expect([pendingBefore, pendingAfter]).toEqual([1, 0]);
      expect(r.e[id]).toMatchObject({
        status: 'delivered',
        wa_message_id: 'wamid.EARLY',
        wa_category: 'utility',
      });
    });

    it('ignores unknown status words, and records events without personal data', async () => {
      const id = await entry({ status: 'sent', msg: 'wamid.F7' });
      const r = await flow(async () => {
        const unknown = await apply('wamid.F7', 'deleted');
        await apply('wamid.F7', 'delivered');
        const events = (await q('select * from public.delivery_events where entry_id = $1', [id]))
          .rows;
        return { unknown, events };
      }, [id]);
      const out = r.out as { unknown: string; events: { kind: string }[] };
      expect(out.unknown).toBe('ignored');
      expect(out.events.map((e) => e.kind)).toEqual(['delivered']);
      expect(JSON.stringify(out.events)).not.toMatch(/Ravi|9876543210/);
    });
  });

  it('register_webhook is true once per body and false for a replay', async () => {
    const h = 'c'.repeat(64);
    const r = await svc(async () => [
      (await one('select public.register_webhook($1) as r', [h])).r,
      (await one('select public.register_webhook($1) as r', [h])).r,
    ]);
    expect(r).toEqual([true, false]);
    await svc(() => denied(q(`select public.register_webhook('not-a-hash')`), /body_hash/));
  });

  it('mark_stale_sends fails (without retry) a send stuck for too long, and leaves fresh ones alone', async () => {
    const stale = await entry();
    const fresh = await entry();
    const r = await svc(async () => {
      await q('select * from public.claim_send($1)', [stale]);
      await q('select * from public.claim_send($1)', [fresh]);
      await q('reset role');
      await q(
        `update public.entries set status_changed_at = now() - interval '20 minutes' where id = $1`,
        [stale],
      );
      await q('set role service_role');
      const n = (await one(`select public.mark_stale_sends(interval '15 minutes') as n`)).n;
      await q('reset role');
      const rows = (
        await q(
          'select id, status, error_code, retryable from public.entries where id = any($1::uuid[])',
          [[stale, fresh]],
        )
      ).rows;
      return { n, rows: Object.fromEntries(rows.map((x) => [x.id, x])) };
    });
    expect(r.n).toBeGreaterThanOrEqual(1);
    expect(r.rows[stale]).toMatchObject({
      status: 'failed',
      error_code: 'ambiguous_stale',
      retryable: false,
    });
    expect(r.rows[fresh]!.status).toBe('sending');
  });

  it('due_retries returns retryable failures that are due and under the attempt limit, oldest first', async () => {
    const due = await entry({
      status: 'failed',
      retryable: true,
      nextRetry: '-1 minute',
      attempts: 2,
    });
    const later = await entry({
      status: 'failed',
      retryable: true,
      nextRetry: '10 minutes',
      attempts: 1,
    });
    const spent = await entry({
      status: 'failed',
      retryable: true,
      nextRetry: '-1 minute',
      attempts: 5,
    });
    const permanent = await entry({ status: 'failed', retryable: false, attempts: 1 });
    const ids = await svc(async () =>
      (await q('select public.due_retries(50, 5) as id')).rows.map((r) => r.id),
    );
    expect(ids).toContain(due);
    for (const x of [later, spent, permanent]) expect(ids).not.toContain(x);
  });

  it('browser roles cannot call any of these functions or read the tables', async () => {
    const id = await entry();
    for (const [role, uid] of [
      ['authenticated', ADMIN],
      ['authenticated', OFFICER1],
      ['anon', null],
    ] as [Role, string | null][]) {
      for (const sql of [
        `select * from public.claim_send('${id}')`,
        `select public.complete_send('${id}', 'x', null)`,
        `select public.fail_send('${id}', 'x', false, now())`,
        `select public.apply_wa_status('x', 'read', now(), null, null)`,
        `select public.register_webhook('${'a'.repeat(64)}')`,
        `select public.mark_stale_sends(interval '1 minute')`,
        `select public.due_retries(1, 5)`,
        'select * from public.delivery_events',
        'select * from public.wa_pending_statuses',
        'select * from public.webhook_events',
      ]) {
        await as(role, uid, () => denied(q(sql)));
      }
    }
  });

  it('browser roles cannot read the new entry columns (retry state, category)', async () => {
    for (const col of [
      'send_attempts',
      'retryable',
      'next_retry_at',
      'wa_category',
      'wa_message_id',
    ]) {
      await as('authenticated', SUPERVISOR, () => denied(q(`select ${col} from public.entries`)));
    }
  });

  it('accepts the new audit actions and only known categories', async () => {
    await q(
      `insert into public.audit_log (action, meta) values ('delivery_sent', '{}'), ('delivery_failed', '{"code":"wa_131026"}'), ('opt_out_recorded', '{}'), ('template_category_changed', '{"from":"utility","to":"marketing"}')`,
    );
    const id = await entry();
    await denied(
      q(`update public.entries set wa_category = 'spam' where id = $1`, [id]),
      /wa_category/,
    );
  });
});
