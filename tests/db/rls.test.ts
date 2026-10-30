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
