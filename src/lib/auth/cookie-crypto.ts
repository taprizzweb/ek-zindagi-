import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/** The key is derived from one server secret (COOKIE_SECRET), one per purpose. */
function key(master: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, 'ek-zindagi', purpose, 32));
}

export const TEAM_COOKIE = 'ekz_team';
/** A team's phone stays signed in for this long; an admin can end it at any time by changing the link. */
export const TEAM_COOKIE_MAX_AGE_S = 400 * 24 * 3600;

/**
 * The cookie a team's phone gets when it opens its link: which team, and the version of the link it came from.
 * Changing the link (or switching the team off) makes every phone that holds an older cookie stop working.
 */
export function signTeamCookie(profileId: string, linkVersionMs: number, master: string): string {
  const payload = Buffer.from(`${profileId}.${linkVersionMs}`).toString('base64url');
  const mac = createHmac('sha256', key(master, 'team-cookie')).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyTeamCookie(
  value: string | undefined,
  master: string,
): { profileId: string; linkVersionMs: number } | null {
  if (!value) return null;
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return null;
  const expected = createHmac('sha256', key(master, 'team-cookie')).update(payload).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [profileId, version] = Buffer.from(payload, 'base64url').toString().split('.');
  const v = Number(version);
  return profileId && Number.isFinite(v) ? { profileId, linkVersionMs: v } : null;
}

export function teamCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: TEAM_COOKIE_MAX_AGE_S,
  };
}
