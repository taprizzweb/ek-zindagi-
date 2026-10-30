import Link from 'next/link';
import AppShell from '@/components/AppShell';
import NewEntryForm from '@/components/entry/NewEntryForm';
import { requirePageUser } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { brandingFromEnv } from '@/lib/pdf/branding';
import { loadSettings } from '@/lib/settings/settings-store-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

export default async function NewEntryPage() {
  const user = await requirePageUser({ roles: ['officer', 'supervisor'] });
  const env = serverEnv();
  const branding = brandingFromEnv();
  const settings = await loadSettings(createAdminClient());
  return (
    <AppShell user={user} wide>
      <p className="mb-4">
        <Link
          href={user.role === 'supervisor' ? '/supervisor' : '/officer'}
          className="inline-flex min-h-11 items-center text-accent underline"
        >
          ← वापस / Back
        </Link>
      </p>
      <NewEntryForm
        allowGallery={settings.allowGallery}
        branding={{
          showPolice: branding.showPolice,
          policeLogoSrc: branding.policeLogoDataUri ?? null,
          ngoLogoSrc: branding.ngoLogoDataUri ?? null,
          partnerCredit: branding.partnerCreditText ?? null,
        }}
        messageLanguage={env.MESSAGE_LANGUAGE}
        baseUrl={env.APP_BASE_URL}
        deliveryMode={env.DELIVERY_MODE}
      />
    </AppShell>
  );
}
