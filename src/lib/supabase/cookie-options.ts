/**
 * Auth cookies are httpOnly: this app never uses the Supabase browser client, every call
 * goes through our own routes, so scripts in the page have no reason to read the session.
 */
export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
