import { randomInt } from 'node:crypto';

// No 0/O, 1/l/I: the password is read off a screen and typed on a phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generateTempPassword(
  length = 14,
  pick: (max: number) => number = randomInt,
): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[pick(ALPHABET.length)];
  return out;
}
