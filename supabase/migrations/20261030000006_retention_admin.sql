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
