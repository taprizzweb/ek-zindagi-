import type { AuditSink } from '@/lib/audit/audit';

export interface DueEntry {
  id: string;
  photoPath: string | null;
  pdfPath: string | null;
}

export type Bucket = 'photos' | 'pdfs';

export interface RetentionPorts {
  dueForPurge(limit: number): Promise<DueEntry[]>;
  /** Deletes the file. A file that is already gone is not an error. Throws on a real failure. */
  deleteFile(bucket: Bucket, path: string): Promise<void>;
  /** True if the file is still there. */
  fileExists(bucket: Bucket, path: string): Promise<boolean>;
  /** Clears the personal fields of these entries. Returns how many were cleared. */
  finishPurge(ids: string[]): Promise<number>;
  housekeeping(): Promise<Record<string, number>>;
  leftovers(): Promise<{ overdue: number; dirty: number }>;
}

export interface RetentionReport {
  purged: number;
  /** Entries whose files could not be deleted or verified; they are tried again on the next run. */
  failed: number;
  overdue: number;
  dirty: number;
}

export const PURGE_BATCH = 200;
const MAX_BATCHES = 10;

/**
 * Deletes expired personal data. Order matters: the files are deleted and CHECKED first; only then
 * are the database fields cleared. If a file cannot be deleted, the entry keeps its paths, so the next
 * run finds it again. Nothing here logs a name, number or path (a path contains an id only).
 */
export async function runRetention(
  ports: RetentionPorts,
  audit: AuditSink,
): Promise<RetentionReport> {
  let purged = 0;
  let failed = 0;
  const skipped = new Set<string>();

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const due = (await ports.dueForPurge(PURGE_BATCH + skipped.size)).filter(
      (e) => !skipped.has(e.id),
    );
    if (due.length === 0) break;
    const clean: string[] = [];
    for (const e of due.slice(0, PURGE_BATCH)) {
      if (await removeFiles(ports, e)) clean.push(e.id);
      else {
        skipped.add(e.id);
        failed++;
      }
    }
    if (clean.length) purged += await ports.finishPurge(clean);
    if (due.length < PURGE_BATCH) break;
  }

  const counts = await ports.housekeeping();
  const left = await ports.leftovers();

  await audit.record({
    action: 'retention_run',
    meta: {
      purged,
      failed,
      overdue: left.overdue,
      dirty: left.dirty,
      links_removed: counts.links ?? 0,
    },
  });
  if (left.overdue > 0 || left.dirty > 0 || failed > 0) {
    await audit.record({
      action: 'retention_leftover',
      meta: { overdue: left.overdue, dirty: left.dirty, failed },
    });
    // Visible in the platform logs so someone notices. Counts only.
    console.error('retention_leftover', { overdue: left.overdue, dirty: left.dirty, failed });
  }
  return { purged, failed, overdue: left.overdue, dirty: left.dirty };
}

async function removeFiles(ports: RetentionPorts, e: DueEntry): Promise<boolean> {
  const files: [Bucket, string][] = [];
  if (e.photoPath) files.push(['photos', e.photoPath]);
  if (e.pdfPath) files.push(['pdfs', e.pdfPath]);
  try {
    for (const [bucket, path] of files) {
      await ports.deleteFile(bucket, path);
      if (await ports.fileExists(bucket, path)) return false; // verify, do not assume
    }
    return true;
  } catch {
    return false;
  }
}
