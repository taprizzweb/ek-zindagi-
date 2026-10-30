/**
 * Prints fresh random values for the three secrets the app needs, for pasting into the hosting settings.
 * Run on your own computer: npm run gen:secrets. Nothing is saved or sent anywhere.
 * Keep them in a password manager. Do not paste them into chat, email or the repository.
 */
import { randomBytes } from 'node:crypto';

for (const name of ['PHONE_HASH_SECRET', 'CRON_SECRET', 'COOKIE_SECRET']) {
  console.log(`${name}=${randomBytes(32).toString('hex')}`);
}
console.log(
  '\nPHONE_HASH_SECRET must never change later (see docs/runbook.md). Changing COOKIE_SECRET signs every team phone out until it opens its link again.',
);
