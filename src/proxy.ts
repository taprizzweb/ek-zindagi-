import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { ACTIVITY_COOKIE, activityCookieOptions } from '@/lib/auth/activity';
import { isSessionExpired, parseActivityCookie } from '@/lib/domain/session-expiry';
import { authCookieOptions } from '@/lib/supabase/cookie-options';

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout']);

function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === 'development';
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `media-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/**
 * Runs before every page and API request: sets the CSP, refreshes the Supabase session,
 * enforces the inactivity limit and keeps signed-out visitors on /login.
 * Role checks happen next to the data, in each page and route (see lib/auth/session.ts).
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookieOptions: authCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const isPublic = PUBLIC_PATHS.has(pathname);
  const { data } = await supabase.auth.getUser();

  const deny = (reason?: string) => {
    const res = isApi
      ? NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 })
      : NextResponse.redirect(new URL(reason ? `/login?reason=${reason}` : '/login', request.url));
    for (const c of response.cookies.getAll()) res.cookies.set(c);
    res.cookies.delete(ACTIVITY_COOKIE);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };

  if (data.user && !isPublic) {
    const minutes = Number(process.env.INACTIVITY_MINUTES ?? '30') || 30;
    const last = parseActivityCookie(request.cookies.get(ACTIVITY_COOKIE)?.value);
    if (isSessionExpired(last, Date.now(), minutes)) {
      await supabase.auth.signOut();
      return deny('timeout');
    }
    response.cookies.set(ACTIVITY_COOKIE, String(Date.now()), activityCookieOptions());
  } else if (!data.user && !isPublic) {
    return deny();
  }

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
