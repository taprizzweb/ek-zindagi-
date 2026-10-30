import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Keys are derived from one server secret (MFA_SECRET), one per purpose, so they cannot be swapped. */
function key(master: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, 'ek-zindagi', purpose, 32));
}

/**
 * Encrypts a TOTP secret for the database (AES-256-GCM). The profile id is bound in as authenticated data,
 * so a stored secret copied onto another account does not decrypt.
 */
export function encryptTotpSecret(secret: string, profileId: string, master: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(master, 'totp-secret'), iv);
  c.setAAD(Buffer.from(profileId));
  const ct = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    ct.toString('base64url'),
    c.getAuthTag().toString('base64url'),
  ].join('.');
}

export function decryptTotpSecret(stored: string, profileId: string, master: string): string {
  const [v, iv, ct, tag] = stored.split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('bad format');
  const d = createDecipheriv(
    'aes-256-gcm',
    key(master, 'totp-secret'),
    Buffer.from(iv, 'base64url'),
  );
  d.setAAD(Buffer.from(profileId));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export const MFA_COOKIE = 'ekz_mfa';
/** A verified second step lasts at most this long (the inactivity limit ends it sooner). */
export const MFA_MAX_AGE_MS = 12 * 3_600_000;

/** The cookie that says "this browser passed the second step": user, expiry and a signature. */
export function signMfaCookie(userId: string, nowMs: number, master: string): string {
  const payload = Buffer.from(`${userId}.${nowMs + MFA_MAX_AGE_MS}`).toString('base64url');
  const mac = createHmac('sha256', key(master, 'mfa-cookie')).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyMfaCookie(
  value: string | undefined,
  userId: string,
  nowMs: number,
  master: string,
): boolean {
  if (!value) return false;
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return false;
  const expected = createHmac('sha256', key(master, 'mfa-cookie')).update(payload).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const [uid, exp] = Buffer.from(payload, 'base64url').toString().split('.');
  return uid === userId && Number(exp) > nowMs;
}

export function mfaCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}
