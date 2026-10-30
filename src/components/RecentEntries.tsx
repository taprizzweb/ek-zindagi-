import { violationByKey, type ViolationKey } from '@/config/violations';
import { formatIst } from '@/lib/domain/time';
import { statusLabel } from '@/lib/i18n/status';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The signed-in user's own recent entries (status only, no personal data).
 * Only this account's own entries from the last 7 days, read on the server.
 */
const weekAgoIso = () => new Date(Date.now() - 7 * 86_400_000).toISOString();

export default async function RecentEntries({ userId }: { userId: string }) {
  // Read on the server for this one account (a team phone has no database session of its own).
  const { data } = await createAdminClient()
    .from('entries')
    .select('id, cert_code, violation, status, delivery_mode, link_opened_at, created_at')
    .eq('officer_id', userId)
    .gte('created_at', weekAgoIso())
    .order('created_at', { ascending: false })
    .limit(20);
  const rows = (data ?? []) as {
    id: string;
    cert_code: string;
    violation: ViolationKey;
    status: string;
    delivery_mode: string | null;
    link_opened_at: string | null;
    created_at: string;
  }[];

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-lg font-semibold">हाल की प्रविष्टियाँ / Recent entries</h2>
      {rows.length === 0 ? (
        <p className="text-muted">अभी कोई प्रविष्टि नहीं। / No entries yet.</p>
      ) : (
        <ul className="divide-y-2 divide-line border-y-2 border-line">
          {rows.map((r) => {
            const s = statusLabel(r.status, {
              mode: r.delivery_mode,
              linkOpened: r.link_opened_at !== null,
            });
            const v = violationByKey(r.violation);
            return (
              <li key={r.id} className="py-3">
                <p className="font-semibold">{r.cert_code}</p>
                <p>
                  {v.hi} / {v.en}
                </p>
                <p className="text-sm text-muted">
                  {formatIst(r.created_at)} · {s.hi} / {s.en}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
