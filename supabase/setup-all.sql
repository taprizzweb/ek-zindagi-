-- EK ZINDAGI: all database migrations in one file, for a new empty Supabase project.
-- Paste the whole file into Supabase > SQL Editor and press Run ONCE. Then run supabase/verify.sql.
-- (Generated from supabase/migrations/*.sql in order. Do not run it on a project that already has some of them.)

-- ======== 20261030000001_init.sql ========
-- EK ZINDAGI, milestone 1: roles, profiles, entries, audit log, rate limits, private storage.
--
-- Access model
--   * The browser can reach Postgres only through the Data API with an officer's JWT
--     (role `authenticated`). It gets NON-PERSONAL columns only, and only the rows its
--     role allows. Personal columns (person_name, phone_e164, photo_path, pdf_path,
--     phone_hash, other_text) are never granted to `authenticated` or `anon`.
--   * All writes and all reads of personal data happen on the server with the
--     service role, after the server has checked who is calling.
--   * Storage buckets are private and have no policy for `anon` / `authenticated`.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------- types

create type public.app_role as enum ('officer', 'supervisor', 'admin');
create type public.violation_key as enum
  ('helmet', 'seatbelt', 'child_helmet', 'wrong_side', 'overspeed', 'mobile', 'other');
create type public.location_source as enum ('gps', 'manual');
create type public.photo_source as enum ('none', 'camera', 'gallery');
create type public.entry_status as enum
  ('saved', 'generating', 'ready', 'sending', 'sent', 'delivered', 'read', 'failed');
create type public.audit_action as enum (
  'admin_seeded',
  'login',
  'login_failed',
  'login_denied',
  'password_changed',
  'officer_created',
  'officer_disabled',
  'officer_enabled',
  'officer_password_reset'
);

-- ---------------------------------------------------------------- profiles

create sequence private.officer_code_seq start 1;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(display_name) between 2 and 60),
  role public.app_role not null,
  officer_code text unique,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  disabled_at timestamptz,
  constraint profiles_email_lower check (email = lower(email)),
  constraint profiles_code_required check (role = 'admin' or officer_code is not null)
);
create unique index profiles_email_key on public.profiles (email);

create function private.profiles_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'admin' then
    new.officer_code := null;
  elsif new.officer_code is null then
    new.officer_code := 'JP-' || lpad(nextval('private.officer_code_seq')::text, 4, '0');
  end if;
  return new;
end $$;
create trigger profiles_before_insert before insert on public.profiles
  for each row execute function private.profiles_before_insert();

-- The officer code is stable for life; the role is never changed in place.
create function private.profiles_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.officer_code is distinct from old.officer_code
     or new.role is distinct from old.role then
    raise exception 'profiles: id, role and officer_code are immutable';
  end if;
  return new;
end $$;
create trigger profiles_before_update before update on public.profiles
  for each row execute function private.profiles_before_update();

-- Role of the caller, or null when the caller is unknown or disabled.
create function private.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.active
$$;
revoke all on function private.current_app_role() from public;
grant execute on function private.current_app_role() to authenticated, service_role;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select (id, display_name, role, officer_code, active, created_at)
  on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_select_oversight on public.profiles
  for select to authenticated using (
    private.current_app_role() = 'admin'
    or (private.current_app_role() = 'supervisor' and role in ('officer', 'supervisor'))
  );

-- ---------------------------------------------------------------- entries

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  cert_code text not null unique,
  officer_id uuid not null references public.profiles (id) on delete restrict,
  violation public.violation_key not null,
  area_name text check (char_length(area_name) <= 120),
  lat numeric(6, 3) check (lat between -90 and 90),
  lng numeric(6, 3) check (lng between -180 and 180),
  location_source public.location_source not null,
  photo_source public.photo_source not null default 'none',
  gallery_reason text check (char_length(gallery_reason) <= 80),
  consent_checked boolean not null default false,
  reviewed boolean not null default false,
  status public.entry_status not null default 'saved',
  delivery_mode text check (delivery_mode in ('bridge', 'cloud_api')),
  wa_message_id text,
  error_code text,
  phone_hash text check (phone_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  link_opened_at timestamptz,
  expires_at timestamptz,
  purged_at timestamptz,
  -- personal, short-lived: removed by the retention job
  person_name text check (char_length(person_name) between 2 and 40),
  phone_e164 text check (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  other_text text check (char_length(other_text) <= 40),
  photo_path text,
  pdf_path text,
  constraint entries_purged_is_clean check (
    purged_at is null
    or (person_name is null and phone_e164 is null and other_text is null
        and photo_path is null and pdf_path is null)
  ),
  constraint entries_photo_needs_consent check (photo_source = 'none' or consent_checked)
);
create index entries_officer_created_idx on public.entries (officer_id, created_at desc);
create index entries_created_idx on public.entries (created_at desc);
create index entries_phone_hash_idx on public.entries (phone_hash, created_at desc);
create index entries_status_idx on public.entries (status);

alter table public.entries enable row level security;
revoke all on public.entries from anon, authenticated;
grant select (
  id, cert_code, officer_id, violation, area_name, lat, lng, location_source, photo_source,
  gallery_reason, consent_checked, reviewed, status, delivery_mode, error_code,
  created_at, sent_at, delivered_at, read_at, link_opened_at, purged_at
) on public.entries to authenticated;
grant all on public.entries to service_role;

-- An officer sees only their own recent entries (status, no personal data).
create policy entries_select_own on public.entries
  for select to authenticated using (
    officer_id = (select auth.uid())
    and created_at > now() - interval '7 days'
    and private.current_app_role() is not null
  );
-- Supervisors and admins see counts-level data for everyone; still no personal columns.
create policy entries_select_oversight on public.entries
  for select to authenticated using (private.current_app_role() in ('supervisor', 'admin'));

-- ---------------------------------------------------------------- audit log

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_code text,
  action public.audit_action not null,
  entry_id uuid,
  meta jsonb not null default '{}'::jsonb,
  constraint audit_meta_is_object check (jsonb_typeof(meta) = 'object'),
  -- keep in step with FORBIDDEN_AUDIT_KEYS in src/lib/audit/audit.ts
  constraint audit_meta_no_personal_keys check (
    not (meta ?| array['name', 'person_name', 'phone', 'phone_e164', 'photo', 'password',
                       'token', 'email'])
  )
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_action_idx on public.audit_log (action, at desc);

create function private.audit_log_is_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function private.audit_log_is_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_is_append_only();

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;
grant insert on public.audit_log to service_role;
create policy audit_select_admin on public.audit_log
  for select to authenticated using (private.current_app_role() = 'admin');

-- ---------------------------------------------------------------- rate limits

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- Fixed-window counter. Returns true while the caller is within the limit.
create function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max_hits integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz;
  h integer;
begin
  if p_window_seconds < 1 or p_max_hits < 1 then
    raise exception 'invalid rate limit';
  end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, window_start, hits)
    values (p_key, w, 1)
    on conflict (key, window_start) do update set hits = r.hits + 1
    returning r.hits into h;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return h <= p_max_hits;
end $$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------- sessions

-- Used when an officer account is disabled or its password is reset.
create function public.revoke_user_sessions(p_user_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from auth.sessions where user_id = p_user_id
$$;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- ---------------------------------------------------------------- private storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('photos', 'photos', false, 3145728, array['image/jpeg']),
  ('pdfs', 'pdfs', false, 2097152, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No permissive policy exists for these buckets. This restrictive policy keeps it that way
-- even if someone later adds a broad permissive policy to storage.objects.
create policy ekz_private_buckets_deny on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id not in ('photos', 'pdfs'))
  with check (bucket_id not in ('photos', 'pdfs'));

-- ======== 20261030000002_entries_intake.sql ========
-- EK ZINDAGI, milestone 2: what the officer form needs from the database.

alter type public.audit_action add value if not exists 'entry_created';

-- A retry of the same submission must never create a second entry.
alter table public.entries
  add column client_request_id uuid not null default gen_random_uuid();
alter table public.entries
  add constraint entries_officer_request_key unique (officer_id, client_request_id);

-- GPS entries carry coordinates; manual entries carry none.
alter table public.entries
  add constraint entries_location_consistent check (
    (location_source = 'gps' and lat is not null and lng is not null)
    or (location_source = 'manual' and lat is null and lng is null)
  );

-- A gallery photo always records why the live camera was not used.
alter table public.entries
  add constraint entries_gallery_needs_reason check (
    photo_source <> 'gallery' or gallery_reason is not null
  );

-- Numbers that replied STOP. Hashes only, kept permanently. Server-side access only.
create table public.opt_outs (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.opt_outs enable row level security;
revoke all on public.opt_outs from anon, authenticated;
grant all on public.opt_outs to service_role;

-- ======== 20261030000003_certificates.sql ========
-- EK ZINDAGI, milestone 3: certificate generation lifecycle.

alter type public.audit_action add value if not exists 'certificate_generated';
alter type public.audit_action add value if not exists 'certificate_failed';

-- When the status last changed: lets a crashed render be picked up again after a while.
alter table public.entries add column status_changed_at timestamptz not null default now();

create function private.entries_track_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;
create trigger entries_track_status before update on public.entries
  for each row execute function private.entries_track_status();

-- A certificate that is ready (or further along) has a PDF, unless the data was already deleted.
alter table public.entries add constraint entries_ready_has_pdf check (
  purged_at is not null
  or status in ('saved', 'generating', 'failed')
  or pdf_path is not null
);

-- Takes the entry for rendering. Atomic: of several simultaneous callers only one gets claimed = true.
-- A render that has been "generating" for over two minutes is considered dead and can be taken again.
create function public.claim_certificate(p_entry_id uuid)
returns table (
  claimed boolean,
  status public.entry_status,
  purged boolean,
  officer_id uuid,
  cert_code text,
  person_name text,
  area_name text,
  violation public.violation_key,
  other_text text,
  photo_path text,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  r public.entries;
  did boolean := false;
begin
  update public.entries e
     set status = 'generating', status_changed_at = now()
   where e.id = p_entry_id
     and e.purged_at is null
     and (e.status in ('saved', 'failed')
          or (e.status = 'generating' and e.status_changed_at < now() - interval '2 minutes'))
  returning e.* into r;
  if found then
    did := true;
  else
    select * into r from public.entries e where e.id = p_entry_id;
    if not found then
      return;
    end if;
  end if;
  return query select did, r.status, r.purged_at is not null, r.officer_id, r.cert_code,
    r.person_name, r.area_name, r.violation, r.other_text, r.photo_path, r.created_at;
end $$;
revoke all on function public.claim_certificate(uuid) from public, anon, authenticated;
grant execute on function public.claim_certificate(uuid) to service_role;

-- ======== 20261030000004_bridge_links.sql ========
-- EK ZINDAGI, update round: bridge delivery (certificate links) and downloads.

alter type public.audit_action add value if not exists 'delivery_prepared';
alter type public.audit_action add value if not exists 'certificate_downloaded';

-- A link the person receives in WhatsApp. Only a hash of the token is stored. A link can never
-- live longer than 24 hours: the database refuses anything else.
create table public.cert_links (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  opened_at timestamptz,
  open_count integer not null default 0,
  constraint cert_links_max_24h check (
    expires_at > created_at and expires_at <= created_at + interval '24 hours'
  )
);
create index cert_links_entry_idx on public.cert_links (entry_id);
alter table public.cert_links enable row level security;
revoke all on public.cert_links from anon, authenticated;
grant all on public.cert_links to service_role;

-- Opens a link. Returns no row for an unknown token, otherwise status 'ok' (with the PDF path),
-- 'expired' or 'gone' (data already deleted). Expiry is judged by the database clock, and only a
-- successful open is counted.
create function public.open_certificate_link(p_token_hash text)
returns table (status text, pdf_path text)
language plpgsql security definer set search_path = '' as $$
declare
  l public.cert_links;
  e public.entries;
begin
  select * into l from public.cert_links c where c.token_hash = p_token_hash;
  if not found then
    return;
  end if;
  if l.expires_at <= now() then
    return query select 'expired'::text, null::text;
    return;
  end if;
  select * into e from public.entries x where x.id = l.entry_id;
  if e.purged_at is not null or e.pdf_path is null then
    return query select 'gone'::text, null::text;
    return;
  end if;
  update public.cert_links c
     set opened_at = coalesce(c.opened_at, now()), open_count = c.open_count + 1
   where c.id = l.id;
  update public.entries x set link_opened_at = coalesce(x.link_opened_at, now()) where x.id = e.id;
  return query select 'ok'::text, e.pdf_path;
end $$;
revoke all on function public.open_certificate_link(text) from public, anon, authenticated;
grant execute on function public.open_certificate_link(text) to service_role;

-- ======== 20261030000005_cloud_api.sql ========
-- EK ZINDAGI, milestone 5: WhatsApp Cloud API delivery.
--
-- Design rules
--   * A message is sent at most once per entry. The send is CLAIMED atomically; of several callers
--     only one wins, and a claim that was never completed (crash, timeout after the request left) is
--     never retried automatically: it is marked failed and left for a person to check.
--   * Webhook statuses only move forward (sent -> delivered -> read); out-of-order or repeated
--     deliveries change nothing. Statuses for a message we have not stored yet wait in a side table.
--   * A signed webhook body is processed once (replay protection).

alter type public.audit_action add value if not exists 'delivery_sent';
alter type public.audit_action add value if not exists 'delivery_failed';
alter type public.audit_action add value if not exists 'opt_out_recorded';
alter type public.audit_action add value if not exists 'template_category_changed';

alter table public.entries
  add column send_attempts integer not null default 0,
  add column retryable boolean not null default false,
  add column next_retry_at timestamptz,
  add column wa_category text check (wa_category in ('utility', 'marketing', 'authentication', 'service'));

create unique index entries_wa_message_id_key on public.entries (wa_message_id) where wa_message_id is not null;
create index entries_retry_idx on public.entries (next_retry_at) where status = 'failed' and retryable;

-- What WhatsApp told us about a message. No personal data.
create table public.delivery_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  kind text not null check (kind in ('sent', 'delivered', 'read', 'failed')),
  wa_message_id text,
  error_code text,
  category text
);
create index delivery_events_entry_idx on public.delivery_events (entry_id, at);
alter table public.delivery_events enable row level security;
revoke all on public.delivery_events from anon, authenticated;
grant all on public.delivery_events to service_role;

-- Statuses that arrived before we stored the message id (the webhook can beat our own database write).
create table public.wa_pending_statuses (
  message_id text not null,
  status text not null check (status in ('sent', 'delivered', 'read', 'failed')),
  ts timestamptz not null,
  error_code text,
  category text,
  received_at timestamptz not null default now(),
  primary key (message_id, status)
);
alter table public.wa_pending_statuses enable row level security;
revoke all on public.wa_pending_statuses from anon, authenticated;
grant all on public.wa_pending_statuses to service_role;

-- Hashes of webhook bodies already processed.
create table public.webhook_events (
  body_hash text primary key check (body_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now()
);
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
grant all on public.webhook_events to service_role;

-- ------------------------------------------------------------------ functions (server only)

-- Takes the entry for sending. Only a ready entry, or a failed one marked retryable, can be taken, and
-- only by one caller. A sent, delivered, read or sending entry is returned unclaimed.
create function public.claim_send(p_entry_id uuid)
returns table (
  claimed boolean, status public.entry_status, purged boolean, officer_id uuid,
  phone_e164 text, phone_hash text, person_name text, violation public.violation_key,
  cert_code text, pdf_path text, attempts integer
)
language plpgsql security definer set search_path = '' as $$
declare
  r public.entries;
  did boolean := false;
begin
  update public.entries e
     set status = 'sending', delivery_mode = 'cloud_api', send_attempts = e.send_attempts + 1,
         error_code = null, next_retry_at = null, retryable = false
   where e.id = p_entry_id and e.purged_at is null and e.pdf_path is not null
     and (e.status = 'ready' or (e.status = 'failed' and e.retryable))
  returning e.* into r;
  if found then
    did := true;
  else
    select * into r from public.entries e where e.id = p_entry_id;
    if not found then
      return;
    end if;
  end if;
  return query select did, r.status, r.purged_at is not null, r.officer_id, r.phone_e164, r.phone_hash,
    r.person_name, r.violation, r.cert_code, r.pdf_path, r.send_attempts;
end $$;

-- Records that the WhatsApp API accepted the message, then applies any status that arrived early.
create function public.complete_send(p_entry_id uuid, p_message_id text, p_category text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  pending record;
begin
  update public.entries e
     set status = 'sent', wa_message_id = p_message_id, sent_at = coalesce(e.sent_at, now()),
         error_code = null, retryable = false, next_retry_at = null,
         wa_category = coalesce(p_category, e.wa_category)
   where e.id = p_entry_id and e.status = 'sending';
  get diagnostics n = row_count;
  if n = 0 then
    return false;
  end if;
  insert into public.delivery_events (entry_id, kind, wa_message_id, category)
    values (p_entry_id, 'sent', p_message_id, p_category);
  for pending in
    select * from public.wa_pending_statuses where message_id = p_message_id order by ts, status
  loop
    perform public.apply_wa_status(pending.message_id, pending.status, pending.ts, pending.error_code, pending.category);
  end loop;
  delete from public.wa_pending_statuses where message_id = p_message_id;
  return true;
end $$;

-- Records a failed send. Only an entry that is being sent can fail this way.
create function public.fail_send(p_entry_id uuid, p_error text, p_retryable boolean, p_next_retry timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.entries e
     set status = 'failed', error_code = p_error, retryable = p_retryable,
         next_retry_at = case when p_retryable then p_next_retry else null end
   where e.id = p_entry_id and e.status = 'sending';
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.delivery_events (entry_id, kind, error_code) values (p_entry_id, 'failed', p_error);
  end if;
  return n > 0;
end $$;

-- A status report from the webhook. Moves forward only; repeats and out-of-order reports change nothing.
-- Returns 'applied', 'ignored' or 'pending' (message not stored yet).
create function public.apply_wa_status(
  p_message_id text, p_status text, p_ts timestamptz, p_error text, p_category text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  e public.entries;
  new_status public.entry_status;
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    return 'ignored';
  end if;
  select * into e from public.entries x where x.wa_message_id = p_message_id for update;
  if not found then
    insert into public.wa_pending_statuses (message_id, status, ts, error_code, category)
      values (p_message_id, p_status, p_ts, p_error, p_category)
      on conflict (message_id, status) do nothing;
    return 'pending';
  end if;

  if p_status = 'sent' and e.status in ('sending', 'failed') then
    new_status := 'sent';
  elsif p_status = 'delivered' and e.status in ('sending', 'sent', 'failed') then
    new_status := 'delivered';
  elsif p_status = 'read' and e.status in ('sending', 'sent', 'delivered', 'failed') then
    new_status := 'read';
  elsif p_status = 'failed' and e.status in ('sending', 'sent') then
    new_status := 'failed';
  else
    return 'ignored';
  end if;

  update public.entries x set
    status = new_status,
    sent_at = case when new_status in ('sent', 'delivered', 'read') then coalesce(x.sent_at, p_ts) else x.sent_at end,
    delivered_at = case when new_status in ('delivered', 'read') then coalesce(x.delivered_at, p_ts) else x.delivered_at end,
    read_at = case when new_status = 'read' then coalesce(x.read_at, p_ts) else x.read_at end,
    error_code = case when new_status = 'failed' then coalesce(p_error, 'wa_failed') else x.error_code end,
    retryable = case when new_status = 'failed' then false else x.retryable end,
    next_retry_at = case when new_status = 'failed' then null else x.next_retry_at end,
    wa_category = coalesce(p_category, x.wa_category)
  where x.id = e.id;
  insert into public.delivery_events (entry_id, kind, wa_message_id, error_code, category)
    values (e.id, p_status, p_message_id, case when p_status = 'failed' then coalesce(p_error, 'wa_failed') end, p_category);
  return 'applied';
end $$;

-- True the first time a webhook body is seen, false for a replay.
create function public.register_webhook(p_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.webhook_events (body_hash) values (p_hash) on conflict do nothing;
  get diagnostics n = row_count;
  if random() < 0.02 then
    delete from public.webhook_events where received_at < now() - interval '14 days';
    delete from public.wa_pending_statuses where received_at < now() - interval '14 days';
  end if;
  return n = 1;
end $$;

-- A send that has been "sending" for too long has an unknown outcome (the request may or may not have
-- reached WhatsApp). It is NOT retried: it is marked failed, not retryable, for a person to check.
create function public.mark_stale_sends(p_age interval) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.entries e
     set status = 'failed', error_code = 'ambiguous_stale', retryable = false, next_retry_at = null
   where e.status = 'sending' and e.delivery_mode = 'cloud_api' and e.status_changed_at < now() - p_age;
  get diagnostics n = row_count;
  return n;
end $$;

-- Entries whose transient failure is due for another attempt.
create function public.due_retries(p_limit integer, p_max_attempts integer) returns setof uuid
language sql security definer set search_path = '' as $$
  select e.id from public.entries e
   where e.status = 'failed' and e.retryable and e.next_retry_at <= now()
     and e.send_attempts < p_max_attempts and e.purged_at is null
   order by e.next_retry_at limit p_limit
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.claim_send(uuid)',
    'public.complete_send(uuid, text, text)',
    'public.fail_send(uuid, text, boolean, timestamptz)',
    'public.apply_wa_status(text, text, timestamptz, text, text)',
    'public.register_webhook(text)',
    'public.mark_stale_sends(interval)',
    'public.due_retries(integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ======== 20261030000006_retention_admin.sql ========
-- EK ZINDAGI, milestone 6: retention, settings, review and reporting.
--
-- Design rules
--   * Personal data (name, number, photo, PDF) is deleted by a two-step job: files first, then the
--     database fields. A row is cleared only after the app has deleted AND verified the files, so a
--     failed deletion is retried on the next run instead of being forgotten.
--   * Settings are a small allow-listed table the admin changes from the app. The environment variable
--     CAMPAIGN_PAUSED stays a hard switch that no setting can undo.
--   * Reporting functions return counts and codes only. Never names, numbers or photos.

alter type public.audit_action add value if not exists 'retention_run';
alter type public.audit_action add value if not exists 'retention_leftover';
alter type public.audit_action add value if not exists 'settings_changed';
alter type public.audit_action add value if not exists 'entry_reviewed';
alter type public.audit_action add value if not exists 'delivery_retried';
alter type public.audit_action add value if not exists 'campaign_paused';
alter type public.audit_action add value if not exists 'campaign_resumed';

alter table public.entries
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz;
create index entries_review_idx on public.entries (created_at desc) where not reviewed;
create index entries_expiry_idx on public.entries (expires_at) where purged_at is null;

-- ------------------------------------------------------------------ settings

create table public.settings (
  key text primary key check (key in ('campaign_paused', 'allow_gallery_fallback', 'retention_hours')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint settings_value_type check (
    (key in ('campaign_paused', 'allow_gallery_fallback') and jsonb_typeof(value) = 'boolean')
    or (key = 'retention_hours' and jsonb_typeof(value) = 'number'
        and (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
        and (value #>> '{}')::numeric between 1 and 168)
  )
);
alter table public.settings enable row level security;
revoke all on public.settings from anon, authenticated;
grant all on public.settings to service_role;

-- ------------------------------------------------------------------ retention

-- Entries whose personal data is due for deletion: past their expiry, or confirmed delivered (or read)
-- more than an hour ago. Entries in the middle of generating or sending wait until an hour past expiry.
create function public.due_for_purge(p_limit integer default 200)
returns table (id uuid, photo_path text, pdf_path text)
language sql security definer set search_path = '' stable as $$
  select e.id, e.photo_path, e.pdf_path
    from public.entries e
   where e.purged_at is null
     and (
       (coalesce(e.expires_at, e.created_at + interval '24 hours') <= now()
        and (e.status not in ('generating', 'sending')
             or coalesce(e.expires_at, e.created_at + interval '24 hours') <= now() - interval '1 hour'))
       or (e.status in ('delivered', 'read')
           and coalesce(e.read_at, e.delivered_at, e.sent_at, e.created_at) <= now() - interval '1 hour')
     )
   order by coalesce(e.expires_at, e.created_at)
   limit greatest(p_limit, 1)
$$;

-- Clears the personal fields of entries whose files the app has deleted and checked. The phone hash,
-- code, violation, area and timestamps stay. Returns how many rows were cleared.
create function public.finish_purge(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.entries e
     set person_name = null, phone_e164 = null, other_text = null, photo_path = null, pdf_path = null,
         purged_at = now(), retryable = false, next_retry_at = null
   where e.id = any (p_ids) and e.purged_at is null;
  get diagnostics n = row_count;
  delete from public.cert_links c where c.entry_id = any (p_ids);
  return n;
end $$;

-- Old bookkeeping rows nobody needs any more. Returns what was removed.
create function public.housekeeping()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a integer; b integer; c integer; d integer;
begin
  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics a = row_count;
  delete from public.wa_pending_statuses where received_at < now() - interval '3 days';
  get diagnostics b = row_count;
  delete from public.webhook_events where received_at < now() - interval '7 days';
  get diagnostics c = row_count;
  delete from public.cert_links where expires_at < now() - interval '2 days';
  get diagnostics d = row_count;
  return jsonb_build_object('rate_limits', a, 'pending_statuses', b, 'webhook_events', c, 'links', d);
end $$;

-- The daily self-check: anything that should be gone but is not.
--   overdue = still holding personal data more than two hours after it was due
--   dirty   = marked purged but a personal field (or a link) is still there
create function public.retention_leftovers()
returns table (overdue integer, dirty integer)
language sql security definer set search_path = '' stable as $$
  select
    (select count(*)::integer from public.entries e
      where e.purged_at is null
        and coalesce(e.expires_at, e.created_at + interval '24 hours') <= now() - interval '2 hours'),
    (select count(*)::integer from public.entries e
      where e.purged_at is not null
        and (e.person_name is not null or e.phone_e164 is not null or e.other_text is not null
             or e.photo_path is not null or e.pdf_path is not null))
    + (select count(*)::integer from public.cert_links c
        join public.entries e on e.id = c.entry_id where e.purged_at is not null)
$$;

-- ------------------------------------------------------------------ review and failures

-- Puts a failed send back to "ready" so it can be sent again. Only while the data still exists.
create function public.requeue_failed(p_entry_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.entries e
     set status = 'ready', retryable = false, next_retry_at = null, error_code = null
   where e.id = p_entry_id and e.status = 'failed' and e.purged_at is null and e.pdf_path is not null;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create function public.mark_reviewed(p_entry_id uuid, p_by uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.entries e
     set reviewed = true, reviewed_by = p_by, reviewed_at = now()
   where e.id = p_entry_id and not e.reviewed;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Entries a supervisor should look at: gallery photo, typed location, no consent ticked, or the same
-- number used again within a week. Reasons are codes. No personal data.
create function public.review_list(p_limit integer default 100)
returns table (
  id uuid, cert_code text, officer_id uuid, violation public.violation_key, status public.entry_status,
  created_at timestamptz, reasons text[]
)
language sql security definer set search_path = '' stable as $$
  with scored as (
    select e.id, e.cert_code, e.officer_id, e.violation, e.status, e.created_at,
           array_remove(array[
             case when e.photo_source = 'gallery' then 'gallery' end,
             case when e.location_source = 'manual' then 'manual_location' end,
             case when not e.consent_checked then 'no_consent' end,
             case when e.phone_hash is not null and (
                    select count(*) from public.entries o
                     where o.phone_hash = e.phone_hash and o.created_at > now() - interval '7 days') > 1
                  then 'repeated_number' end
           ], null) as reasons
      from public.entries e
     where not e.reviewed and e.created_at > now() - interval '14 days'
  )
  select s.id, s.cert_code, s.officer_id, s.violation, s.status, s.created_at, s.reasons
    from scored s
   where cardinality(s.reasons) > 0
   order by s.created_at desc
   limit greatest(p_limit, 1)
$$;

-- ------------------------------------------------------------------ counts

-- Counts per day (India time), officer and violation. No personal data.
create function public.entry_stats(p_since timestamptz, p_until timestamptz default now())
returns table (
  day date, officer_id uuid, violation public.violation_key,
  created bigint, sent bigint, delivered bigint, read bigint, failed bigint, link_opened bigint
)
language sql security definer set search_path = '' stable as $$
  select (e.created_at at time zone 'Asia/Kolkata')::date, e.officer_id, e.violation,
         count(*),
         count(*) filter (where e.sent_at is not null),
         count(*) filter (where e.delivered_at is not null),
         count(*) filter (where e.read_at is not null),
         count(*) filter (where e.status = 'failed'),
         count(*) filter (where e.link_opened_at is not null)
    from public.entries e
   where e.created_at >= p_since and e.created_at < p_until
   group by 1, 2, 3
   order by 1 desc, 2, 3
$$;

-- ------------------------------------------------------------------ access

revoke all on function public.due_for_purge(integer), public.finish_purge(uuid[]),
  public.housekeeping(), public.retention_leftovers(), public.requeue_failed(uuid),
  public.mark_reviewed(uuid, uuid), public.review_list(integer),
  public.entry_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.due_for_purge(integer), public.finish_purge(uuid[]),
  public.housekeeping(), public.retention_leftovers(), public.requeue_failed(uuid),
  public.mark_reviewed(uuid, uuid), public.review_list(integer),
  public.entry_stats(timestamptz, timestamptz) to service_role;

-- ======== 20261030000007_data_requests.sql ========
-- EK ZINDAGI, milestone 7: a person asks for their data to be deleted, or for no more messages.
-- A supervisor or admin looks the entry up by its certificate code (printed on the certificate) and
-- deletes its personal data at once, or adds a number to the opt-out list.

alter type public.audit_action add value if not exists 'entry_purged_early';
alter type public.audit_action add value if not exists 'opt_out_added';

-- The files of one entry, for early deletion. Server only.
create function public.entry_for_purge(p_cert_code text)
returns table (id uuid, photo_path text, pdf_path text, purged boolean)
language sql security definer set search_path = '' stable as $$
  select e.id, e.photo_path, e.pdf_path, e.purged_at is not null
    from public.entries e
   where e.cert_code = p_cert_code
$$;

revoke all on function public.entry_for_purge(text) from public, anon, authenticated;
grant execute on function public.entry_for_purge(text) to service_role;

-- ======== 20261030000008_mfa.sql ========
-- EK ZINDAGI, milestone 7 follow-up: a second sign-in step (authenticator app code) for supervisors and admins.
--
--   * The TOTP secret is stored ENCRYPTED by the app (AES-256-GCM, key from MFA_SECRET, bound to the account);
--     the database never sees it in the clear.
--   * A code is accepted only if its time step is higher than the last accepted one, atomically (no replay,
--     no two requests both winning with the same code).
--   * Server-side access only.

alter type public.audit_action add value if not exists 'mfa_enrolled';
alter type public.audit_action add value if not exists 'mfa_verified';
alter type public.audit_action add value if not exists 'mfa_failed';
alter type public.audit_action add value if not exists 'mfa_reset';

create table public.totp_factors (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  secret_enc text not null check (secret_enc like 'v1.%'),
  confirmed boolean not null default false,
  last_counter bigint not null default 0,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
alter table public.totp_factors enable row level security;
revoke all on public.totp_factors from anon, authenticated;
grant all on public.totp_factors to service_role;

create function public.totp_accept(p_profile uuid, p_counter bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.totp_factors f set last_counter = p_counter
   where f.profile_id = p_profile and f.last_counter < p_counter;
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.totp_accept(uuid, bigint) from public, anon, authenticated;
grant execute on function public.totp_accept(uuid, bigint) to service_role;

-- ======== 20261030000009_purge_after_delivery.sql ========
-- EK ZINDAGI: once WhatsApp confirms the certificate reached the person's phone, our copy is not needed
-- (the PDF now lives in their chat, permanently). Delete it five minutes after delivery is confirmed, not an hour,
-- so the server keeps almost nothing. Everything else about retention is unchanged: an entry that is never
-- confirmed is deleted when its expiry passes (24 hours by default), and a failed send keeps its data until then
-- so it can be retried.

create or replace function public.due_for_purge(p_limit integer default 200)
returns table (id uuid, photo_path text, pdf_path text)
language sql security definer set search_path = '' stable as $$
  select e.id, e.photo_path, e.pdf_path
    from public.entries e
   where e.purged_at is null
     and (
       (coalesce(e.expires_at, e.created_at + interval '24 hours') <= now()
        and (e.status not in ('generating', 'sending')
             or coalesce(e.expires_at, e.created_at + interval '24 hours') <= now() - interval '1 hour'))
       or (e.status in ('delivered', 'read')
           and coalesce(e.read_at, e.delivered_at, e.sent_at, e.created_at) <= now() - interval '5 minutes')
     )
   order by coalesce(e.expires_at, e.created_at)
   limit greatest(p_limit, 1)
$$;

-- ======== 20261030000010_team_links.sql ========
-- EK ZINDAGI: access by a team link instead of a login per person, and nothing about a person kept after sending.
--
--   * A "team" is an officer-role profile (one per station or group) with ONE secret link. The link opens the
--     app on a phone and keeps it signed in. The admin can change the link or switch the team off at any time.
--   * Only the hash of the link is stored. Changing the link changes `rotated_at`, which ends every phone that
--     still holds the old one.
--   * Once WhatsApp has accepted the message, the person's name, number, photo, PDF and number hash are removed.
--     What stays is a row of counts: team, violation, area, time and status.
--   * The second sign-in step (authenticator app) is removed: its table goes.

alter type public.audit_action add value if not exists 'team_created';
alter type public.audit_action add value if not exists 'team_link_changed';

drop function if exists public.totp_accept(uuid, bigint);
drop table if exists public.totp_factors;

create table public.access_links (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  rotated_at timestamptz not null default now(),
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.access_links enable row level security;
revoke all on public.access_links from anon, authenticated;
grant all on public.access_links to service_role;

-- Opens a link. No row for an unknown link; otherwise the team and the version of the link. Records the use.
create function public.open_team_link(p_token_hash text)
returns table (profile_id uuid, active boolean, rotated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  l public.access_links;
  a boolean;
begin
  select * into l from public.access_links x where x.token_hash = p_token_hash;
  if not found then
    return;
  end if;
  select p.active into a from public.profiles p where p.id = l.profile_id;
  if coalesce(a, false) then
    update public.access_links x set last_used_at = now() where x.profile_id = l.profile_id;
  end if;
  return query select l.profile_id, coalesce(a, false), l.rotated_at;
end $$;
revoke all on function public.open_team_link(text) from public, anon, authenticated;
grant execute on function public.open_team_link(text) to service_role;

-- Cloud API entries are due as soon as the message was accepted (two minutes of grace for the app's own
-- immediate clean-up to run first). Bridge entries still wait for their expiry: the PDF is what the link serves.
create or replace function public.due_for_purge(p_limit integer default 200)
returns table (id uuid, photo_path text, pdf_path text)
language sql security definer set search_path = '' stable as $$
  select e.id, e.photo_path, e.pdf_path
    from public.entries e
   where e.purged_at is null
     and (
       (coalesce(e.expires_at, e.created_at + interval '24 hours') <= now()
        and (e.status not in ('generating', 'sending')
             or coalesce(e.expires_at, e.created_at + interval '24 hours') <= now() - interval '1 hour'))
       or (e.delivery_mode = 'cloud_api' and e.status in ('sent', 'delivered', 'read')
           and coalesce(e.sent_at, e.created_at) <= now() - interval '2 minutes')
     )
   order by coalesce(e.expires_at, e.created_at)
   limit greatest(p_limit, 1)
$$;

-- Also forgets the number's hash. (An opt-out is kept separately, in opt_outs, so STOP is always honoured.)
create or replace function public.finish_purge(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.entries e
     set person_name = null, phone_e164 = null, other_text = null, photo_path = null, pdf_path = null,
         phone_hash = null, purged_at = now(), retryable = false, next_retry_at = null
   where e.id = any (p_ids) and e.purged_at is null;
  get diagnostics n = row_count;
  delete from public.cert_links c where c.entry_id = any (p_ids);
  return n;
end $$;
