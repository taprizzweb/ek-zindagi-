import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Time-based one-time codes (RFC 6238, as used by every authenticator app): SHA-1, 6 digits, 30 seconds. */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** One step either side is accepted, for clocks that are a little off. */
export const TOTP_SKEW_STEPS = 1;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits), as base32 text for the authenticator app. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secretBase32: string, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function counterAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * The counter the code belongs to, or null. A counter at or below `lastCounter` is refused: a code that
 * was already used (or an older one) never works twice, even inside its 30 seconds.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  lastCounter: number,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  const now = counterAt(nowMs);
  let found: number | null = null;
  // Check every step (no early exit) so the time taken does not tell which one matched.
  for (let c = now - TOTP_SKEW_STEPS; c <= now + TOTP_SKEW_STEPS; c++) {
    const ok = timingSafeEqual(given, Buffer.from(totpAt(secretBase32, c)));
    if (ok && c > lastCounter && (found === null || c > found)) found = c;
  }
  return found;
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'EK ZINDAGI'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
