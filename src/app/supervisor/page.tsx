import Link from 'next/link';
import AppShell from '@/components/AppShell';
import RecentEntries from '@/components/RecentEntries';
import { violationByKey, type ViolationKey } from '@/config/violations';
import { requirePageUser } from '@/lib/auth/session';
import { formatIst } from '@/lib/domain/time';
import { serverEnv } from '@/lib/env';
import { errorCodeLabel } from '@/lib/i18n/failure';
import {
  REVIEW_REASON_LABEL,
  groupBy,
  rangeFor,
  totalOf,
  type ReviewReason,
  type Totals,
} from '@/lib/reports/reports';
import {
  loadFailures,
  loadLastRetention,
  loadOfficerCodes,
  loadReviewList,
  loadStats,
} from '@/lib/reports/reports-store-supabase';
import { loadSettings } from '@/lib/settings/settings-store-supabase';
import { createAdminClient } from '@/lib/supabase/admin';
import { PauseControl, RetryButton, ReviewButton } from './SupervisorActions';

const COLS: { key: keyof Totals; hi: string; en: string }[] = [
  { key: 'created', hi: 'बनी', en: 'Created' },
  { key: 'sent', hi: 'भेजी', en: 'Sent' },
  { key: 'delivered', hi: 'पहुँची', en: 'Delivered' },
  { key: 'read', hi: 'पढ़ी', en: 'Read' },
  { key: 'failed', hi: 'विफल', en: 'Failed' },
  { key: 'linkOpened', hi: 'लिंक खुला', en: 'Link opened' },
];

function CountTable({
  title,
  rows,
  labelHeader,
}: {
  title: string;
  labelHeader: string;
  rows: [string, Totals][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="mb-1 text-left font-semibold">{title}</caption>
        <thead>
          <tr className="border-b-2 border-line">
            <th scope="col" className="py-2 pr-3">
              {labelHeader}
            </th>
            {COLS.map((c) => (
              <th key={c.key} scope="col" className="px-2 py-2 text-right">
                {c.hi}
                <br />
                <span className="text-sm font-normal text-muted">{c.en}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="py-3 text-muted" colSpan={COLS.length + 1}>
                कोई प्रविष्टि नहीं / No entries
              </td>
            </tr>
          ) : (
            rows.map(([label, t]) => (
              <tr key={label} className="border-b border-line">
                <th scope="row" className="py-2 pr-3 font-normal">
                  {label}
                </th>
                {COLS.map((c) => (
                  <td key={c.key} className="px-2 py-2 text-right tabular-nums">
                    {t[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function SupervisorHome() {
  const user = await requirePageUser({ roles: ['supervisor'] });
  const admin = createAdminClient();
  const now = new Date();
  const today = rangeFor('today', now);
  const week = rangeFor('week', now);
  const [weekRows, codes, failures, review, settings, retention] = await Promise.all([
    loadStats(admin, week.since, week.until),
    loadOfficerCodes(admin),
    loadFailures(admin),
    loadReviewList(admin),
    loadSettings(admin),
    loadLastRetention(admin),
  ]);
  const todayRows = weekRows.filter((r) => r.day >= todayIstDate(today.since));
  const code = (id: string) => codes.get(id) ?? '—';
  const violationName = (k: string) => {
    const v = violationByKey(k as ViolationKey);
    return `${v.hi} / ${v.en}`;
  };
  const sorted = (m: Map<string, Totals>) =>
    [...m.entries()].sort((a, b) => b[1].created - a[1].created);
  const cloud = serverEnv().DELIVERY_MODE === 'cloud_api';

  return (
    <AppShell user={user} wide>
      <h1 className="text-2xl font-semibold">पर्यवेक्षक खाता / Supervisor account</h1>
      <p className="mt-1 text-muted">
        {user.displayName} · {user.officerCode}
      </p>
      <Link
        href="/new"
        className="mt-4 flex min-h-14 items-center justify-center rounded border-2 border-accent bg-accent px-4 text-lg font-semibold text-white hover:bg-accent-dark sm:max-w-sm"
      >
        नई प्रविष्टि / New entry
      </Link>

      <div className="mt-8 space-y-8">
        <PauseControl
          paused={settings.campaignPaused}
          envLocked={settings.campaignPaused && serverEnv().CAMPAIGN_PAUSED}
        />

        <section aria-labelledby="counts-h" className="space-y-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="counts-h" className="text-lg font-semibold">
              आज और इस हफ़्ते / Today and this week
            </h2>
            <span className="flex gap-4">
              <a
                className="min-h-11 py-2 text-accent underline"
                href="/api/supervisor/stats?range=today"
              >
                CSV: आज / today
              </a>
              <a
                className="min-h-11 py-2 text-accent underline"
                href="/api/supervisor/stats?range=week"
              >
                CSV: हफ़्ता / week
              </a>
            </span>
          </div>
          <CountTable
            title="आज / Today (India time)"
            labelHeader="कुल / Total"
            rows={[['सभी / All', totalOf(todayRows)]]}
          />
          <CountTable
            title="इस हफ़्ते, अधिकारी के अनुसार / This week, by officer"
            labelHeader="अधिकारी / Officer"
            rows={sorted(groupBy(weekRows, (r) => code(r.officerId)))}
          />
          <CountTable
            title="इस हफ़्ते, उल्लंघन के अनुसार / This week, by violation"
            labelHeader="उल्लंघन / Violation"
            rows={sorted(groupBy(weekRows, (r) => violationName(r.violation)))}
          />
          <p className="text-sm text-muted">
            केवल गिनती, कोई नाम या नंबर नहीं। / Counts only: no names or numbers.
          </p>
        </section>

        <section aria-labelledby="fail-h">
          <h2 id="fail-h" className="mb-2 text-lg font-semibold">
            विफल संदेश / Failures ({failures.length})
          </h2>
          {failures.length === 0 ? (
            <p className="text-muted">कोई विफलता नहीं। / No failures.</p>
          ) : (
            <ul className="divide-y-2 divide-line border-y-2 border-line">
              {failures.map((f) => {
                const reason = errorCodeLabel(f.errorCode);
                const ambiguous = (f.errorCode ?? '').startsWith('ambiguous');
                return (
                  <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold">
                        {f.certCode} · {code(f.officerId)}
                      </p>
                      <p>{violationName(f.violation)}</p>
                      <p className="text-sm text-muted">
                        {formatIst(f.createdAt)} · {reason.hi} / {reason.en}
                      </p>
                    </div>
                    {cloud && f.canRetry ? (
                      <RetryButton id={f.id} ambiguous={ambiguous} />
                    ) : (
                      <p className="max-w-xs text-sm text-muted">
                        {f.canRetry
                          ? 'अधिकारी अपने फ़ोन से भेजेगा। / The officer sends from their phone.'
                          : 'डेटा हटाया जा चुका है या प्रमाणपत्र नहीं बना; दोबारा नहीं भेज सकते। / The data is deleted or no certificate was made; it cannot be sent again.'}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="rev-h">
          <h2 id="rev-h" className="mb-2 text-lg font-semibold">
            जाँच सूची / Review list ({review.length})
          </h2>
          {review.length === 0 ? (
            <p className="text-muted">जाँचने के लिए कुछ नहीं। / Nothing to review.</p>
          ) : (
            <ul className="divide-y-2 divide-line border-y-2 border-line">
              {review.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">
                      {r.certCode} · {code(r.officerId)}
                    </p>
                    <p>{violationName(r.violation)}</p>
                    <p className="text-sm text-muted">
                      {formatIst(r.createdAt)} ·{' '}
                      {r.reasons
                        .map((x) => {
                          const l = REVIEW_REASON_LABEL[x as ReviewReason];
                          return l ? `${l.hi} / ${l.en}` : x;
                        })
                        .join('; ')}
                    </p>
                  </div>
                  <ReviewButton id={r.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <p>
          <Link
            className="inline-flex min-h-11 items-center text-accent underline"
            href="/requests"
          >
            नागरिक के अनुरोध (डेटा हटाना, संदेश बंद) / Requests from citizens (delete data, stop
            messages)
          </Link>
        </p>

        <section aria-labelledby="ret-h">
          <h2 id="ret-h" className="mb-1 text-lg font-semibold">
            डेटा हटाना / Data deletion
          </h2>
          {retention && now.getTime() - new Date(retention.at).getTime() < 3 * 3_600_000 ? (
            <p
              className={
                retention.overdue + retention.dirty + retention.failed > 0
                  ? 'font-semibold text-danger'
                  : ''
              }
            >
              अंतिम जाँच / Last run: {formatIst(retention.at)} · हटाया / deleted {retention.purged}{' '}
              · बाकी / left over {retention.overdue + retention.dirty + retention.failed}
            </p>
          ) : (
            <p role="alert" className="font-semibold text-danger">
              {retention
                ? `डेटा हटाने का काम ${formatIst(retention.at)} के बाद नहीं चला। / The deletion job has not run since ${formatIst(retention.at)}.`
                : 'डेटा हटाने का काम अभी तक नहीं चला। / The deletion job has not run yet.'}{' '}
              प्रशासक को बताएँ। / Tell the admin.
            </p>
          )}
          <p className="text-sm text-muted">
            नाम, नंबर, फ़ोटो और PDF {settings.retentionHours} घंटे में हट जाते हैं। / Names,
            numbers, photos and PDFs are deleted within {settings.retentionHours} hours.
          </p>
        </section>

        <RecentEntries />
      </div>
    </AppShell>
  );
}

/** YYYY-MM-DD of an instant, in India time (matches the `day` column). */
function todayIstDate(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
