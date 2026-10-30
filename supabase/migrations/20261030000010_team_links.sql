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
