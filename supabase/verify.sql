-- EK ZINDAGI: run this in the Supabase SQL editor AFTER applying all migrations.
-- It lists PROBLEMS. A healthy setup returns the single row "ok | nothing wrong found" (and nothing else).
-- Read-only: it changes nothing.

with problems as (

  -- 1. every table in the public schema must have row level security on
  select 'table without row level security' as check, c.relname::text as detail
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity

  union all
  -- 2. the two storage buckets exist and are private
  select 'storage bucket missing', b.n
    from (values ('photos'), ('pdfs')) as b(n)
   where not exists (select 1 from storage.buckets s where s.id = b.n)
  union all
  select 'storage bucket is PUBLIC', s.id
    from storage.buckets s where s.public

  union all
  -- 3. the browser roles (anon, authenticated) must not read personal columns or secret tables
  select 'browser role can read a personal column', r.role || ' -> entries.' || col
    from (values ('anon'), ('authenticated')) as r(role),
         (values ('person_name'), ('phone_e164'), ('phone_hash'), ('photo_path'), ('pdf_path'), ('other_text')) as k(col)
   where has_column_privilege(r.role, 'public.entries', k.col, 'select')
  union all
  select 'browser role can read a server-only table', r.role || ' -> ' || t
    from (values ('anon'), ('authenticated')) as r(role),
         (values ('opt_outs'), ('cert_links'), ('delivery_events'), ('wa_pending_statuses'), ('webhook_events'),
                 ('settings'), ('totp_factors'), ('rate_limits')) as k(t)
   where has_table_privilege(r.role, 'public.' || k.t, 'select')
  union all
  select 'browser role can change the audit log', r.role
    from (values ('anon'), ('authenticated')) as r(role)
   where has_table_privilege(r.role, 'public.audit_log', 'insert')
      or has_table_privilege(r.role, 'public.audit_log', 'update')
      or has_table_privilege(r.role, 'public.audit_log', 'delete')
  union all
  select 'anon can read a table', t.relname::text
    from pg_class t
   where t.relnamespace = 'public'::regnamespace and t.relkind = 'r'
     and has_table_privilege('anon', t.oid, 'select')

  union all
  -- 4. no function in the public schema may be callable from the browser
  select 'function callable by a browser role', p.proname::text
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))

  union all
  -- 5. all eight migrations were applied (the last ones add these audit actions and tables)
  select 'migration missing', m.what
    from (values ('mfa_reset (migration 8)'), ('entry_purged_early (migration 7)'), ('retention_run (migration 6)'),
                 ('delivery_sent (migration 5)'), ('delivery_prepared (migration 4)')) as m(what)
   where not exists (
     select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'audit_action' and e.enumlabel = split_part(m.what, ' ', 1))
  union all
  select 'table missing', m.t
    from (values ('profiles'), ('entries'), ('audit_log'), ('rate_limits'), ('opt_outs'), ('cert_links'),
                 ('delivery_events'), ('wa_pending_statuses'), ('webhook_events'), ('settings'), ('totp_factors')) as m(t)
   where to_regclass('public.' || m.t) is null
)
select * from problems
union all
select 'ok', 'nothing wrong found' where not exists (select 1 from problems);
