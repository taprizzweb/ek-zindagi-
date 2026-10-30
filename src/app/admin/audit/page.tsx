import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { requirePageUser } from '@/lib/auth/session';
import { formatIst } from '@/lib/domain/time';
import { AUDIT_PAGE_SIZE, loadAudit } from '@/lib/reports/reports-store-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

const ACTIONS = [
  'login',
  'login_failed',
  'login_denied',
  'password_changed',
  'officer_created',
  'officer_disabled',
  'officer_enabled',
  'officer_password_reset',
  'entry_created',
  'certificate_generated',
  'certificate_failed',
  'certificate_downloaded',
  'delivery_prepared',
  'delivery_sent',
  'delivery_failed',
  'delivery_retried',
  'opt_out_recorded',
  'template_category_changed',
  'entry_reviewed',
  'settings_changed',
  'campaign_paused',
  'campaign_resumed',
  'retention_run',
  'retention_leftover',
] as const;

type Params = { action?: string; officer?: string; from?: string; to?: string; page?: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePageUser({ roles: ['admin'] });
  const p = await searchParams;
  const action = (ACTIONS as readonly string[]).includes(p.action ?? '') ? p.action : undefined;
  const officer = /^[A-Za-z0-9-]{1,20}$/.test(p.officer ?? '') ? p.officer : undefined;
  const from = DATE.test(p.from ?? '') ? p.from : undefined;
  const to = DATE.test(p.to ?? '') ? p.to : undefined;
  const page = Math.min(Math.max(Number.parseInt(p.page ?? '0', 10) || 0, 0), 10_000);
  const { rows, hasMore } = await loadAudit(createAdminClient(), {
    action,
    actorCode: officer,
    from,
    to,
    page,
  });
  const link = (n: number) => {
    const q = new URLSearchParams();
    if (action) q.set('action', action);
    if (officer) q.set('officer', officer);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    q.set('page', String(n));
    return `/admin/audit?${q.toString()}`;
  };
  return (
    <AppShell user={user} wide>
      <p className="mb-4">
        <Link href="/admin" className="inline-flex min-h-11 items-center text-accent underline">
          ← वापस / Back
        </Link>
      </p>
      <h1 className="mb-4 text-2xl font-semibold">ऑडिट लॉग / Audit log</h1>
      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-5">
        <label className="block">
          <span className="mb-1 block font-semibold">कार्य / Action</span>
          <select
            name="action"
            defaultValue={action ?? ''}
            className="h-12 w-full rounded border-2 border-line bg-white px-2"
          >
            <option value="">सभी / All</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold">अधिकारी कोड / Officer code</span>
          <input
            name="officer"
            defaultValue={officer ?? ''}
            className="h-12 w-full rounded border-2 border-line bg-white px-3"
            maxLength={20}
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold">से / From</span>
          <input
            type="date"
            name="from"
            defaultValue={from ?? ''}
            className="h-12 w-full rounded border-2 border-line bg-white px-3"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold">तक / To</span>
          <input
            type="date"
            name="to"
            defaultValue={to ?? ''}
            className="h-12 w-full rounded border-2 border-line bg-white px-3"
          />
        </label>
        <button
          type="submit"
          className="mt-auto min-h-12 rounded border-2 border-accent bg-accent px-4 font-semibold text-white"
        >
          फ़िल्टर / Filter
        </button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-2 border-line">
              <th scope="col" className="py-2 pr-3">
                समय / Time (IST)
              </th>
              <th scope="col" className="pr-3">
                कार्य / Action
              </th>
              <th scope="col" className="pr-3">
                कोड / Code
              </th>
              <th scope="col">विवरण / Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-muted">
                  कोई रिकॉर्ड नहीं / No records
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-line align-top">
                  <td className="whitespace-nowrap py-2 pr-3">{formatIst(r.at)}</td>
                  <td className="pr-3 font-mono">{r.action}</td>
                  <td className="pr-3">{r.actorCode ?? '—'}</td>
                  <td className="break-words">
                    {r.entryId ? (
                      <span className="font-mono text-muted">{r.entryId.slice(0, 8)} </span>
                    ) : null}
                    {Object.keys(r.meta).length ? JSON.stringify(r.meta) : ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 flex gap-6">
        {page > 0 ? (
          <Link className="min-h-11 py-2 text-accent underline" href={link(page - 1)}>
            ← पिछला / Newer
          </Link>
        ) : null}
        {hasMore ? (
          <Link className="min-h-11 py-2 text-accent underline" href={link(page + 1)}>
            अगला / Older →
          </Link>
        ) : null}
      </p>
      <p className="mt-2 text-sm text-muted">
        {AUDIT_PAGE_SIZE} प्रति पृष्ठ। इसमें कोई नाम, नंबर या फ़ोटो नहीं होता। / {AUDIT_PAGE_SIZE}{' '}
        per page. It holds no names, numbers or photos.
      </p>
    </AppShell>
  );
}
