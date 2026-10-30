/**
 * Clears an account's second-step (authenticator app) set-up, for example the admin who lost their phone.
 * They set it up again at the next sign-in. Run on a trusted computer with the service-role key:
 *   RESET_EMAIL=you@example.org npm run reset:mfa
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.RESET_EMAIL?.trim().toLowerCase();
if (!url || !key || !email) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and RESET_EMAIL.');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
const { data: profile } = await admin
  .from('profiles')
  .select('id, role, officer_code')
  .eq('email', email)
  .maybeSingle();
if (!profile) {
  console.error('No account with that email.');
  process.exit(1);
}
const { error } = await admin.from('totp_factors').delete().eq('profile_id', profile.id);
if (error) {
  console.error('Could not clear the set-up.');
  process.exit(1);
}
await admin.from('audit_log').insert({
  action: 'mfa_reset',
  actor_id: null,
  actor_code: 'script',
  meta: { target_role: profile.role },
});
console.log('Cleared. They will set up the authenticator app at their next sign-in.');
