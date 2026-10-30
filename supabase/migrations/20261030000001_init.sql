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
