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
