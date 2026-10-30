/**
 * Creates the first admin account. Run once after the migrations:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_DISPLAY_NAME=... npm run seed:admin
 * Reads .env.local if present. Refuses to run if an admin already exists.
 */
import { createClient } from '@supabase/supabase-js';

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return v;
}

const url = need('NEXT_PUBLIC_SUPABASE_URL');
const key = need('SUPABASE_SERVICE_ROLE_KEY');
const email = need('ADMIN_EMAIL').trim().toLowerCase();
const password = need('ADMIN_PASSWORD');
const displayName = (process.env.ADMIN_DISPLAY_NAME ?? 'NGO Admin').trim();

if (password.length < 12) {
  console.error('ADMIN_PASSWORD must be at least 12 characters.');
  process.exit(1);
}
if (displayName.length < 2 || displayName.length > 60) {
  console.error('ADMIN_DISPLAY_NAME must be 2 to 60 characters.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const existing = await db.from('profiles').select('id').eq('role', 'admin').limit(1);
if (existing.error) {
  console.error('Could not read profiles. Have the migrations been applied?');
  process.exit(1);
}
if (existing.data.length > 0) {
  console.error('An admin already exists. Nothing was changed.');
  process.exit(1);
}

const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) {
  console.error('Could not create the auth user:', created.error?.code ?? 'unknown');
  process.exit(1);
}
const id = created.data.user.id;

const profile = await db
  .from('profiles')
  .insert({ id, email, display_name: displayName, role: 'admin', must_change_password: false });
if (profile.error) {
  await db.auth.admin.deleteUser(id);
  console.error('Could not create the profile; the auth user was removed.');
  process.exit(1);
}

const audit = await db.from('audit_log').insert({ action: 'admin_seeded', actor_id: id, meta: {} });
if (audit.error) console.error('Warning: the audit entry could not be written.');

console.log('Admin created. Log in at /login, then create officer accounts under /admin/officers.');
