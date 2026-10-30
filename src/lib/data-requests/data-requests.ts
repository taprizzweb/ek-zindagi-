import type { AuditSink } from '@/lib/audit/audit';
import { isValidCertCode } from '@/lib/domain/cert-code';
import { normalizeIndianMobile } from '@/lib/domain/phone';
import { AppError } from '@/lib/errors';
import { removeFiles, type Bucket, type DueEntry } from '@/lib/retention/retention';

export interface DataRequestPorts {
  /** The entry with this certificate code, or null. */
  findByCode(code: string): Promise<(DueEntry & { purged: boolean }) | null>;
  deleteFile(bucket: Bucket, path: string): Promise<void>;
  fileExists(bucket: Bucket, path: string): Promise<boolean>;
  finishPurge(ids: string[]): Promise<number>;
  addOptOut(phoneHash: string): Promise<void>;
}

export interface DataRequestDeps {
  ports: DataRequestPorts;
  audit: AuditSink;
  hashPhone(e164: string): string;
}

type Actor = { id: string; officerCode: string | null };

/** The certificate code as people type it: spaces and lower case forgiven. */
export function cleanCertCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Deletes one entry's personal data now (a person asked). Same order as the retention job: files first and
 * checked, then the database fields. Messages already delivered on WhatsApp cannot be recalled.
 */
export async function purgeEntryNow(
  deps: DataRequestDeps,
  actor: Actor,
  rawCode: string,
): Promise<{ purged: boolean; alreadyPurged: boolean }> {
  const code = cleanCertCode(rawCode);
  if (!isValidCertCode(code)) throw new AppError('bad_request', 400);
  const entry = await deps.ports.findByCode(code);
  if (!entry) throw new AppError('not_found', 404);
  if (entry.purged) return { purged: false, alreadyPurged: true };
  if (!(await removeFiles(deps.ports, entry)))
    throw new AppError('internal', 500, 'file deletion failed');
  await deps.ports.finishPurge([entry.id]);
  await deps.audit.record({
    action: 'entry_purged_early',
    actorId: actor.id,
    actorCode: actor.officerCode,
    entryId: entry.id,
  });
  return { purged: true, alreadyPurged: false };
}

/** Adds a number to the opt-out list (only its hash is kept). It is never messaged again. */
export async function addOptOutByNumber(
  deps: DataRequestDeps,
  actor: Actor,
  rawPhone: string,
): Promise<void> {
  const e164 = normalizeIndianMobile(rawPhone);
  if (!e164) throw new AppError('bad_request', 400);
  await deps.ports.addOptOut(deps.hashPhone(e164));
  await deps.audit.record({
    action: 'opt_out_added',
    actorId: actor.id,
    actorCode: actor.officerCode,
  });
}
