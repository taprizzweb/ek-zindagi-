import AppShell from '@/components/AppShell';
import { requirePageUser } from '@/lib/auth/session';

export default async function SupervisorHome() {
  const user = await requirePageUser({ roles: ['supervisor'] });
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">पर्यवेक्षक खाता / Supervisor account</h1>
      <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2">
        <dt className="text-muted">नाम / Name</dt>
        <dd className="font-semibold">{user.displayName}</dd>
        <dt className="text-muted">कोड / Code</dt>
        <dd className="font-semibold">{user.officerCode}</dd>
      </dl>
    </AppShell>
  );
}
