import Link from 'next/link';
import AppShell from '@/components/AppShell';
import NewEntryForm from '@/components/entry/NewEntryForm';
import { requirePageUser } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';

export default async function NewEntryPage() {
  const user = await requirePageUser({ roles: ['officer', 'supervisor'] });
  return (
    <AppShell user={user}>
      <p className="mb-4">
        <Link
          href={user.role === 'supervisor' ? '/supervisor' : '/officer'}
          className="text-accent underline"
        >
          ← वापस / Back
        </Link>
      </p>
      <NewEntryForm allowGallery={serverEnv().ALLOW_GALLERY_FALLBACK} />
    </AppShell>
  );
}
