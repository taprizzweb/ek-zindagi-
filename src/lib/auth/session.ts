import 'server-only';
import { redirect } from 'next/navigation';
import { homePathFor, type Role } from '@/lib/domain/roles';
import { AppError } from '@/lib/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { serverEnv } from '@/lib/env';
import { MFA_COOKIE, verifyMfaCookie } from './mfa-crypto';

export interface SessionUser {
  id: string;
  role: Role;
  displayName: string;
  officerCode: string | null;
  mustChangePassword: boolean;
  /** Supervisors and admins sign in with a second step. */
  mfaRequired: boolean;
  /** This browser has passed it (a signed cookie, tied to this account). */
  mfaVerified: boolean;
}

const MFA_ROLES: readonly Role[] = ['supervisor', 'admin'];

/**
 * The signed-in, active user, or null. The profile is read with the service role on every
 * request so that disabling an account takes effect at once, whatever the JWT still says.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: row } = await createAdminClient()
    .from('profiles')
    .select('id, role, display_name, officer_code, active, must_change_password')
    .eq('id', data.user.id)
    .maybeSingle();
  const p = row as {
    id: string;
    role: Role;
    display_name: string;
    officer_code: string | null;
    active: boolean;
    must_change_password: boolean;
  } | null;
  if (!p || !p.active) return null;
  // Without MFA_SECRET (development only: production refuses to start) the second step is off.
  const master = serverEnv().MFA_SECRET;
  const mfaRequired = Boolean(master) && MFA_ROLES.includes(p.role);
  const mfaVerified =
    !mfaRequired ||
    verifyMfaCookie((await cookies()).get(MFA_COOKIE)?.value, p.id, Date.now(), master!);
  return {
    id: p.id,
    role: p.role,
    displayName: p.display_name,
    officerCode: p.officer_code,
    mustChangePassword: p.must_change_password,
    mfaRequired,
    mfaVerified,
  };
}

export async function requirePageUser(
  opts: { roles?: readonly Role[]; allowMustChange?: boolean; allowMfaPending?: boolean } = {},
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword && !opts.allowMustChange) redirect('/change-password');
  if (!user.mfaVerified && !opts.allowMfaPending && !opts.allowMustChange) redirect('/mfa');
  if (opts.roles && !opts.roles.includes(user.role)) redirect(homePathFor(user.role));
  return user;
}

export async function requireApiUser(
  opts: { roles?: readonly Role[]; allowMustChange?: boolean; allowMfaPending?: boolean } = {},
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError('unauthenticated', 401);
  if (user.mustChangePassword && !opts.allowMustChange) throw new AppError('forbidden', 403);
  if (!user.mfaVerified && !opts.allowMfaPending && !opts.allowMustChange)
    throw new AppError('mfa_required', 403);
  if (opts.roles && !opts.roles.includes(user.role)) throw new AppError('forbidden', 403);
  return user;
}
