import { violationByKey, type ViolationKey } from '@/config/violations';
import { formatIst } from '@/lib/domain/time';
import { statusLabel } from '@/lib/i18n/status';
import { createClient } from '@/lib/supabase/server';

/**
 * The signed-in user's own recent entries (status only, no personal data).
 * Read with the user's own session, so Row Level Security does the filtering.
 */
export default async function RecentEntries() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('entries')
    .select('id, cert_code, violation, status, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  const rows = (data ?? []) as {
    id: string;
    cert_code: string;
    violation: ViolationKey;
    status: string;
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
            const s = statusLabel(r.status);
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
