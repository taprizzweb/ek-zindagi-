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
