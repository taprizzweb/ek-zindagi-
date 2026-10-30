import AppShell from '@/components/AppShell';
import { requirePageUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import OfficersClient, { type OfficerRow } from './OfficersClient';

export default async function OfficersPage() {
  const user = await requirePageUser({ roles: ['admin'] });
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id, email, display_name, role, officer_code, active, created_at')
    .neq('role', 'admin')
    .order('created_at', { ascending: false });
  const rows: OfficerRow[] = (
    (data ?? []) as {
      id: string;
      email: string;
      display_name: string;
      role: OfficerRow['role']; // admins are filtered out above
      officer_code: string | null;
      active: boolean;
      created_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    officerCode: r.officer_code ?? '',
    active: r.active,
    createdAt: r.created_at,
  }));
  return (
    <AppShell user={user} wide>
      <h1 className="mb-4 text-2xl font-semibold">अधिकारी खाते / Officer accounts</h1>
      <OfficersClient officers={rows} />
    </AppShell>
  );
}
