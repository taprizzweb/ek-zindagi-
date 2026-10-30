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
