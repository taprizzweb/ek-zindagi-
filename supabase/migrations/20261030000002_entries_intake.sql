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
