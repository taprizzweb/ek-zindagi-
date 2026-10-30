import { counterAt, totpAt, base32Encode } from '../../src/lib/auth/totp';
import { encryptTotpSecret } from '../../src/lib/auth/mfa-crypto';
import { appEnv } from './env';
import type { startFakeSupabase } from './fake-supabase';

type Fake = Awaited<ReturnType<typeof startFakeSupabase>>;

/** A known authenticator secret per account, so a test can compute the code the person's phone would show. */
export const secretFor = (userId: string) =>
  base32Encode(Buffer.from(`e2e-totp-${userId}`.padEnd(20, '.').slice(-20)));

/** The account has finished set-up (as if it signed in before). */
export function seedMfa(fake: Fake, userId: string): void {
  if (fake.state.totp.some((f) => f.profile_id === userId)) return;
  fake.state.totp.push({
    profile_id: userId,
    secret_enc: encryptTotpSecret(secretFor(userId), userId, appEnv.MFA_SECRET),
    confirmed: true,
    last_counter: 0,
  });
}

/**
 * The code on the person's phone right now. It clears the "already used" memory first, so a test can sign
 * in as the same person many times; tests of replay protection do not use this.
 */
export function currentCode(fake: Fake, userId: string): string {
  const f = fake.state.totp.find((x) => x.profile_id === userId);
  if (f) f.last_counter = 0;
  return totpAt(secretFor(userId), counterAt(Date.now()));
}
