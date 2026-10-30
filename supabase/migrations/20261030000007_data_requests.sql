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
