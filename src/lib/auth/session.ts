import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { homePathFor, type Role } from '@/lib/domain/roles';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { TEAM_COOKIE, verifyTeamCookie } from './cookie-crypto';

export interface SessionUser {
  id: string;
  role: Role;
  displayName: string;
  officerCode: string | null;
  mustChangePassword: boolean;
  /** A team phone that opened its link (no password, no sign-out). Admins and password accounts are false. */
  viaLink: boolean;
}

type ProfileRow = {
  id: string;
  role: Role;
  display_name: string;
  officer_code: string | null;
  active: boolean;
  must_change_password: boolean;
};

const PROFILE_COLUMNS = 'id, role, display_name, officer_code, active, must_change_password';

/** A team phone: the signed cookie names the team and the version of the link it came from. */
async function teamUser(): Promise<SessionUser | null> {
  const secret = serverEnv().COOKIE_SECRET;
  if (!secret) return null;
  const proof = verifyTeamCookie((await cookies()).get(TEAM_COOKIE)?.value, secret);
  if (!proof) return null;
  const admin = createAdminClient();
  const [{ data: row }, { data: link }] = await Promise.all([
    admin.from('profiles').select(PROFILE_COLUMNS).eq('id', proof.profileId).maybeSingle(),
    admin.from('access_links').select('rotated_at').eq('profile_id', proof.profileId).maybeSingle(),
  ]);
  const p = row as ProfileRow | null;
  const rotated = link ? new Date((link as { rotated_at: string }).rotated_at).getTime() : NaN;
  // Switched off, or the link was changed since this phone opened it: no access, at once.
  if (!p || !p.active || p.role !== 'officer' || rotated !== proof.linkVersionMs) return null;
  return {
    id: p.id,
    role: p.role,
    displayName: p.display_name,
    officerCode: p.officer_code,
    mustChangePassword: false,
    viaLink: true,
  };
}

/**
 * The signed-in, active user, or null: a team phone (link cookie) or a password account (admin). The profile is
 * read with the service role on every request so that switching an account off takes effect at once.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const viaLink = await teamUser();
  if (viaLink) return viaLink;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: row } = await createAdminClient()
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', data.user.id)
    .maybeSingle();
  const p = row as ProfileRow | null;
  if (!p || !p.active) return null;
  return {
    id: p.id,
    role: p.role,
    displayName: p.display_name,
    officerCode: p.officer_code,
    mustChangePassword: p.must_change_password,
    viaLink: false,
  };
}

export async function requirePageUser(
  opts: { roles?: readonly Role[]; allowMustChange?: boolean } = {},
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword && !opts.allowMustChange) redirect('/change-password');
  if (opts.roles && !opts.roles.includes(user.role)) redirect(homePathFor(user.role));
  return user;
}

export async function requireApiUser(
  opts: { roles?: readonly Role[]; allowMustChange?: boolean } = {},
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError('unauthenticated', 401);
  if (user.mustChangePassword && !opts.allowMustChange) throw new AppError('forbidden', 403);
  if (opts.roles && !opts.roles.includes(user.role)) throw new AppError('forbidden', 403);
  return user;
}
