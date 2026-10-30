import Link from 'next/link';
import AppShell from '@/components/AppShell';
import RecentEntries from '@/components/RecentEntries';
import { requirePageUser } from '@/lib/auth/session';

export default async function OfficerHome() {
  const user = await requirePageUser({ roles: ['officer'] });
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">अधिकारी खाता / Officer account</h1>
      <p className="mt-1 text-muted">
        {user.displayName} · {user.officerCode}
      </p>
      <Link
        href="/new"
        className="mt-6 flex min-h-14 items-center justify-center rounded border-2 border-accent bg-accent px-4 text-lg font-semibold text-white hover:bg-accent-dark"
      >
        नई प्रविष्टि / New entry
      </Link>
      <RecentEntries />
    </AppShell>
  );
}
