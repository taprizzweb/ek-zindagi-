import { cookies } from 'next/headers';
import { z } from 'zod';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { verifyMfaCode } from '@/lib/auth/mfa';
import { MFA_COOKIE, mfaCookieOptions, signMfaCookie } from '@/lib/auth/mfa-crypto';
import { supabaseMfaPorts } from '@/lib/auth/mfa-store-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { homePathFor } from '@/lib/domain/roles';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';

const body = z.strictObject({ code: z.string().regex(/^\d{6}$/) });

/** The second sign-in step for supervisors and admins: the 6-digit code from their authenticator app. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const user = await requireApiUser({ allowMfaPending: true });
    const master = serverEnv().MFA_SECRET;
    if (!user.mfaRequired || !master) throw new AppError('forbidden', 403);
    const { code } = body.parse(await readJson(request));
    const admin = createAdminClient();
    const result = await verifyMfaCode(
      {
        ports: supabaseMfaPorts(admin),
        audit: supabaseAuditSink(admin),
        masterKey: master,
        now: Date.now,
      },
      user,
      code,
    );
    (await cookies()).set(
      MFA_COOKIE,
      signMfaCookie(user.id, Date.now(), master),
      mfaCookieOptions(),
    );
    return json({ redirect: homePathFor(user.role), enrolled: result.enrolled });
  });
}
