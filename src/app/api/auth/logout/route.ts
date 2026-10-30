import { cookies } from 'next/headers';
import { ACTIVITY_COOKIE } from '@/lib/auth/activity';
import { MFA_COOKIE } from '@/lib/auth/mfa-crypto';
import { handle, json } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    await (await createClient()).auth.signOut();
    (await cookies()).delete(ACTIVITY_COOKIE);
    (await cookies()).delete(MFA_COOKIE);
    return json({ ok: true });
  });
}
