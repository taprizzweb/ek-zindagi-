import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ViolationKey } from '@/config/violations';
import { AppError } from '@/lib/errors';
import type { StatRow } from './reports';

const fail = (): never => {
  throw new AppError('internal', 500, 'reports query failed');
};

export async function loadStats(
  admin: SupabaseClient,
  since: Date,
  until: Date,
): Promise<StatRow[]> {
  const { data, error } = await admin.rpc('entry_stats', {
    p_since: since.toISOString(),
    p_until: until.toISOString(),
  });
  if (error) fail();
  return (
    (data as
      | {
          day: string;
          officer_id: string;
          violation: string;
          created: number | string;
          sent: number | string;
          delivered: number | string;
          read: number | string;
          failed: number | string;
          link_opened: number | string;
        }[]
      | null) ?? []
  ).map((r) => ({
    day: String(r.day).slice(0, 10),
    officerId: r.officer_id,
    violation: r.violation,
    created: Number(r.created),
    sent: Number(r.sent),
    delivered: Number(r.delivered),
    read: Number(r.read),
    failed: Number(r.failed),
    linkOpened: Number(r.link_opened),
  }));
}

/** Officer id -> code (for display). Codes are not personal data; names are not loaded. */
export async function loadOfficerCodes(admin: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await admin.from('profiles').select('id, officer_code');
  if (error) fail();
  return new Map(
    ((data as { id: string; officer_code: string | null }[]) ?? []).map((p) => [
      p.id,
      p.officer_code ?? '—',
    ]),
  );
}

export interface FailureRow {
  id: string;
  certCode: string;
  officerId: string;
  violation: ViolationKey;
  errorCode: string | null;
  createdAt: string;
  attempts: number;
  retryable: boolean;
  canRetry: boolean; // the PDF still exists
}

export async function loadFailures(admin: SupabaseClient, limit = 50): Promise<FailureRow[]> {
  const { data, error } = await admin
    .from('entries')
    .select(
      'id, cert_code, officer_id, violation, error_code, created_at, send_attempts, retryable, pdf_path',
    )
    .eq('status', 'failed')
    .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail();
  return (
    (data as
      | {
          id: string;
          cert_code: string;
          officer_id: string;
          violation: ViolationKey;
          error_code: string | null;
          created_at: string;
          send_attempts: number;
          retryable: boolean;
          pdf_path: string | null;
        }[]
      | null) ?? []
  ).map((r) => ({
    id: r.id,
    certCode: r.cert_code,
    officerId: r.officer_id,
    violation: r.violation,
    errorCode: r.error_code,
    createdAt: r.created_at,
    attempts: r.send_attempts ?? 0,
    retryable: r.retryable === true,
    canRetry: r.pdf_path !== null && r.pdf_path !== undefined,
  }));
}

export interface ReviewRow {
  id: string;
  certCode: string;
  officerId: string;
  violation: ViolationKey;
  status: string;
  createdAt: string;
  reasons: string[];
}

export async function loadReviewList(admin: SupabaseClient, limit = 100): Promise<ReviewRow[]> {
  const { data, error } = await admin.rpc('review_list', { p_limit: limit });
  if (error) fail();
  return (
    (data as
      | {
          id: string;
          cert_code: string;
          officer_id: string;
          violation: ViolationKey;
          status: string;
          created_at: string;
          reasons: string[];
        }[]
      | null) ?? []
  ).map((r) => ({
    id: r.id,
    certCode: r.cert_code,
    officerId: r.officer_id,
    violation: r.violation,
    status: r.status,
    createdAt: r.created_at,
    reasons: r.reasons,
  }));
}

/** When the retention job last ran, and what it found. From the audit log. */
export async function loadLastRetention(
  admin: SupabaseClient,
): Promise<{ at: string; purged: number; overdue: number; dirty: number; failed: number } | null> {
  const { data, error } = await admin
    .from('audit_log')
    .select('at, meta')
    .eq('action', 'retention_run')
    .order('at', { ascending: false })
    .limit(1);
  if (error) fail();
  const r = (data as { at: string; meta: Record<string, number> }[] | null)?.[0];
  if (!r) return null;
  return {
    at: r.at,
    purged: Number(r.meta.purged ?? 0),
    overdue: Number(r.meta.overdue ?? 0),
    dirty: Number(r.meta.dirty ?? 0),
    failed: Number(r.meta.failed ?? 0),
  };
}

export interface AuditRow {
  id: number;
  at: string;
  actorCode: string | null;
  action: string;
  entryId: string | null;
  meta: Record<string, unknown>;
}

export interface AuditFilter {
  action?: string;
  actorCode?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  page: number;
}
export const AUDIT_PAGE_SIZE = 50;

export async function loadAudit(
  admin: SupabaseClient,
  f: AuditFilter,
): Promise<{ rows: AuditRow[]; hasMore: boolean }> {
  let q = admin
    .from('audit_log')
    .select('id, at, actor_code, action, entry_id, meta')
    .order('at', { ascending: false })
    .order('id', { ascending: false });
  if (f.action) q = q.eq('action', f.action);
  if (f.actorCode) q = q.eq('actor_code', f.actorCode);
  if (f.from) q = q.gte('at', `${f.from}T00:00:00+05:30`);
  if (f.to)
    q = q.lt(
      'at',
      new Date(new Date(`${f.to}T00:00:00+05:30`).getTime() + 86_400_000).toISOString(),
    );
  const from = f.page * AUDIT_PAGE_SIZE;
  const { data, error } = await q.range(from, from + AUDIT_PAGE_SIZE);
  if (error) fail();
  const rows = (
    (data as
      | {
          id: number;
          at: string;
          actor_code: string | null;
          action: string;
          entry_id: string | null;
          meta: Record<string, unknown>;
        }[]
      | null) ?? []
  ).map((r) => ({
    id: r.id,
    at: r.at,
    actorCode: r.actor_code,
    action: r.action,
    entryId: r.entry_id,
    meta: r.meta,
  }));
  return { rows: rows.slice(0, AUDIT_PAGE_SIZE), hasMore: rows.length > AUDIT_PAGE_SIZE };
}
