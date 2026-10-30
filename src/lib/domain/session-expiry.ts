/**
 * Inactivity rule. `lastActiveMs` comes from the httpOnly activity cookie.
 * A missing or unreadable value counts as expired, so a stolen auth cookie
 * alone (without the activity cookie) does not keep a session alive.
 */
export function isSessionExpired(
  lastActiveMs: number | null,
  nowMs: number,
  inactivityMinutes: number,
): boolean {
  if (lastActiveMs === null || !Number.isFinite(lastActiveMs)) return true;
  if (lastActiveMs > nowMs + 60_000) return true; // far in the future: tampered
  return nowMs - lastActiveMs > inactivityMinutes * 60_000;
}

export function parseActivityCookie(value: string | undefined): number | null {
  if (!value || !/^\d{10,16}$/.test(value)) return null;
  return Number(value);
}
