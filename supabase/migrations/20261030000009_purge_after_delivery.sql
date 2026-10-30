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
