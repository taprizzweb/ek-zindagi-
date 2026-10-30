import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { requirePageUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import TeamsClient, { type TeamRow } from './TeamsClient';

export default async function TeamsPage() {
  const user = await requirePageUser({ roles: ['admin'] });
  const admin = createAdminClient();
  const { data: links } = await admin
    .from('access_links')
    .select('profile_id, rotated_at, last_used_at');
  const byId = new Map(
    (
      (links ?? []) as { profile_id: string; rotated_at: string; last_used_at: string | null }[]
    ).map((l) => [l.profile_id, l]),
  );
  const { data: profiles } = byId.size
    ? await admin
        .from('profiles')
        .select('id, display_name, officer_code, active, created_at')
        .in('id', [...byId.keys()])
        .order('created_at', { ascending: false })
    : { data: [] };
  const teams: TeamRow[] = (
    (profiles ?? []) as {
      id: string;
      display_name: string;
      officer_code: string;
      active: boolean;
    }[]
  ).map((p) => ({
    id: p.id,
    label: p.display_name,
    code: p.officer_code,
    active: p.active,
    lastUsedAt: byId.get(p.id)?.last_used_at ?? null,
    linkChangedAt: byId.get(p.id)?.rotated_at ?? null,
  }));
  return (
    <AppShell user={user} wide>
      <p className="mb-4">
        <Link href="/admin" className="inline-flex min-h-11 items-center text-accent underline">
          ← वापस / Back
        </Link>
      </p>
      <h1 className="mb-2 text-2xl font-semibold">टीम लिंक / Team links</h1>
      <p className="mb-6 text-muted">
        हर थाने या टीम के लिए एक लिंक। पुलिसकर्मी लिंक खोलकर फ़ोन में जोड़ लेते हैं: न पासवर्ड, न
        लॉगिन। लिंक लीक हो तो नया लिंक बनाएँ, पुराना तुरंत बंद। / One link per station or team.
        Officers open it and add it to the phone: no password, no sign-in. If a link leaks, make a
        new one and the old one stops at once.
      </p>
      <TeamsClient teams={teams} />
    </AppShell>
  );
}
