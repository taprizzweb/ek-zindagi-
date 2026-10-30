import { randomInt } from 'node:crypto';

// 31 characters, no 0/O/1/I/L: the code is read aloud and typed.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CERT_PREFIX = 'EKZ-JPR-';
const RANDOM_LENGTH = 6;

function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += (ALPHABET.indexOf(body[i]!) + 1) * (i + 3);
  return ALPHABET[sum % ALPHABET.length]!;
}

/** `EKZ-JPR-` + 6 random characters + 1 check character. Not derived from a counter. */
export function generateCertCode(pick: (max: number) => number = randomInt): string {
  let body = '';
  for (let i = 0; i < RANDOM_LENGTH; i++) body += ALPHABET[pick(ALPHABET.length)];
  return `${CERT_PREFIX}${body}${checkChar(body)}`;
}

export function isValidCertCode(code: string): boolean {
  if (!code.startsWith(CERT_PREFIX)) return false;
  const rest = code.slice(CERT_PREFIX.length);
  if (rest.length !== RANDOM_LENGTH + 1) return false;
  if ([...rest].some((c) => !ALPHABET.includes(c))) return false;
  return checkChar(rest.slice(0, RANDOM_LENGTH)) === rest[RANDOM_LENGTH];
}
