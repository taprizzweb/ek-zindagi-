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
