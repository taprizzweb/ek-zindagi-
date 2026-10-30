import { createHmac } from 'node:crypto';

/** HMAC-SHA256 of the E.164 number. Used for duplicate checks and the opt-out list only. */
export function hashPhone(e164: string, secret: string): string {
  return createHmac('sha256', secret).update(e164).digest('hex');
}
