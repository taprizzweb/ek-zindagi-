import { requireApiUser } from '@/lib/auth/session';
import { handle, json } from '@/lib/http';
import { warmUp } from '@/lib/pdf/render';
import { assertSameOrigin } from '@/lib/security/origin';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** The entry form calls this when it opens, so Chromium is already running when the officer taps "Generate". */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    await requireApiUser({ roles: ['officer', 'supervisor'] });
    await warmUp().catch(() => undefined); // a failure here shows up on the real render
    return json({ ok: true });
  });
}
