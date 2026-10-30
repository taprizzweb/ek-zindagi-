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
          <Link
            className="inline-flex min-h-11 items-center text-accent underline"
            href="/admin/teams"
          >
            टीम लिंक: थानों के लिए लिंक बनाएँ / Team links: make a link for each station
          </Link>
        </li>
        <li>
          <Link
            className="inline-flex min-h-11 items-center text-accent underline"
            href="/supervisor"
          >
            डैशबोर्ड: गिनती, विफलताएँ, अभियान रोकें / Dashboard: counts, failures, pause
          </Link>
        </li>
        <li>
          <Link
            className="inline-flex min-h-11 items-center text-accent underline"
            href="/admin/officers"
          >
            अधिकारी खाते / Officer accounts
          </Link>
        </li>
        <li>
          <Link
            className="inline-flex min-h-11 items-center text-accent underline"
            href="/admin/settings"
          >
            सेटिंग्स / Settings
          </Link>
        </li>
        <li>
          <Link
            className="inline-flex min-h-11 items-center text-accent underline"
            href="/admin/audit"
          >
            ऑडिट लॉग / Audit log
          </Link>
        </li>
      </ul>
    </AppShell>
  );
}
