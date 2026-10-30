import { NextResponse } from 'next/server';
import { TEAM_COOKIE, signTeamCookie, teamCookieOptions } from '@/lib/auth/cookie-crypto';
import { hashToken, isWellFormedToken } from '@/lib/delivery/token';
import { serverEnv } from '@/lib/env';
import { clientIp } from '@/lib/security/ip';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * A team's link. Opening it on a phone signs that phone in for good (until the admin changes the link or
 * switches the team off) and goes straight to the form. The long random token in the address is the only
 * credential, so a wrong one gets nothing but a plain "this link is not active" page, and tries are limited.
 */
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  // Relative redirects: the phone stays on whatever address it used to open the link.
  const redirectTo = (path: string) =>
    new NextResponse(null, {
      status: 302,
      headers: { Location: path, 'Cache-Control': 'no-store' },
    });
  const notActive = () => redirectTo('/login?reason=link');
  try {
    const secret = serverEnv().COOKIE_SECRET;
    if (!secret) return new NextResponse('not configured', { status: 503 });
    const admin = createAdminClient();
    const { data: allowed, error: limitError } = await admin.rpc('rate_limit_hit', {
      p_key: `go:ip:${clientIp(request.headers)}`,
      p_window_seconds: 600,
      p_max_hits: 40,
    });
    if (limitError) return new NextResponse('error', { status: 500 });
    if (!allowed) return new NextResponse('too many tries', { status: 429 });

    const { token } = await ctx.params;
    if (!isWellFormedToken(token)) return notActive();
    const { data, error } = await admin.rpc('open_team_link', { p_token_hash: hashToken(token) });
    if (error) return new NextResponse('error', { status: 500 });
    const row = (data as { profile_id: string; active: boolean; rotated_at: string }[] | null)?.[0];
    if (!row || !row.active) return notActive();

    const res = redirectTo('/new');
    res.cookies.set(
      TEAM_COOKIE,
      signTeamCookie(row.profile_id, new Date(row.rotated_at).getTime(), secret),
      teamCookieOptions(),
    );
    return res;
  } catch (err) {
    console.error('team_link_error', err instanceof Error ? err.name : typeof err);
    return new NextResponse('error', { status: 500 });
  }
}
