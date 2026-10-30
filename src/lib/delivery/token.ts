import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_BYTES = 16; // 128 bits
/** base64url of 16 bytes is always 22 characters. */
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

/** A fresh unguessable link token and the hash that is stored instead of it. */
export function newLinkToken(random: (n: number) => Buffer = randomBytes): {
  token: string;
  hash: string;
} {
  const token = random(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** True only for something that could be a token. Anything else is refused before any lookup. */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}
