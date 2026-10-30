import { cookies } from 'next/headers';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { ACTIVITY_COOKIE, activityCookieOptions } from '@/lib/auth/activity';
import { homePathFor, type Role } from '@/lib/domain/roles';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handle, json, readJson } from '@/lib/http';
import { clientIp } from '@/lib/security/ip';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { loginSchema } from '@/lib/validation/auth';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const admin = createAdminClient();
    const audit = supabaseAuditSink(admin);

    const { data: allowed, error: limitError } = await admin.rpc('rate_limit_hit', {
      p_key: `login:ip:${clientIp(request.headers)}`,
      p_window_seconds: 900,
      p_max_hits: serverEnv().LOGIN_MAX_ATTEMPTS_PER_IP,
    });
    if (limitError) throw new AppError('internal', 500);
    if (!allowed) throw new AppError('rate_limited', 429);

    const body = loginSchema.parse(await readJson(request));
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword(body);
    if (error || !data.user) {
      await audit.record({ action: 'login_failed', meta: { reason: 'bad_credentials' } });
      throw new AppError('invalid_credentials', 401);
    }

    const { data: row } = await admin
      .from('profiles')
      .select('role, officer_code, active, must_change_password')
      .eq('id', data.user.id)
      .maybeSingle();
    const profile = row as {
      role: Role;
      officer_code: string | null;
      active: boolean;
      must_change_password: boolean;
    } | null;
    if (!profile || !profile.active) {
      await supabase.auth.signOut();
      await audit.record({
        action: 'login_denied',
        actorId: data.user.id,
        meta: { reason: 'inactive' },
      });
      throw new AppError('invalid_credentials', 401); // same answer as a wrong password
    }

    await audit.record({ action: 'login', actorId: data.user.id, actorCode: profile.officer_code });
    (await cookies()).set(ACTIVITY_COOKIE, String(Date.now()), activityCookieOptions());
    return json({
      redirect: profile.must_change_password ? '/change-password' : homePathFor(profile.role),
    });
  });
}
