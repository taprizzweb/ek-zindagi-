import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { requirePageUser } from '@/lib/auth/session';

export default async function AdminHome() {
  const user = await requirePageUser({ roles: ['admin'] });
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">व्यवस्थापन / Administration</h1>
      <ul className="mt-4 space-y-2">
        <li>
          <Link className="text-accent underline" href="/admin/officers">
            अधिकारी खाते / Officer accounts
          </Link>
        </li>
      </ul>
    </AppShell>
  );
}
