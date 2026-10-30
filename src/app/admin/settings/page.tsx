import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { requirePageUser } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { brandingFromEnv } from '@/lib/pdf/branding';
import { loadSettings } from '@/lib/settings/settings-store-supabase';
import { createAdminClient } from '@/lib/supabase/admin';
import SettingsForm from './SettingsForm';

export default async function SettingsPage() {
  const user = await requirePageUser({ roles: ['admin'] });
  const env = serverEnv();
  const settings = await loadSettings(createAdminClient());
  const branding = brandingFromEnv();
  const fixed: [string, string][] = [
    ['DELIVERY_MODE', env.DELIVERY_MODE],
    ['SHOW_POLICE_BRANDING', branding.showPolice ? 'true' : 'false'],
    ['DEDUPE_HOURS', String(env.DEDUPE_HOURS)],
  ];
  return (
    <AppShell user={user}>
      <p className="mb-4">
        <Link href="/admin" className="inline-flex min-h-11 items-center text-accent underline">
          ← वापस / Back
        </Link>
      </p>
      <h1 className="mb-6 text-2xl font-semibold">सेटिंग्स / Settings</h1>
      <SettingsForm initial={settings} envPaused={env.CAMPAIGN_PAUSED} />

      <section aria-labelledby="fixed-h" className="mt-10">
        <h2 id="fixed-h" className="text-lg font-semibold">
          सर्वर सेटिंग्स (केवल देखने के लिए) / Server settings (read only)
        </h2>
        <p className="mb-2 text-sm text-muted">
          इन्हें होस्टिंग के environment में बदलकर दोबारा डिप्लॉय करना पड़ता है। / These are changed
          in the hosting environment and need a redeploy. This is deliberate: the delivery mode and
          the police branding should not change by a tap.
        </p>
        <dl className="divide-y-2 divide-line border-y-2 border-line">
          {fixed.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2">
              <dt className="font-mono text-sm">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </AppShell>
  );
}
