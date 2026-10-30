import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import { removeFiles, type Bucket, type RetentionPorts } from './retention';

const fail = (): never => {
  throw new AppError('internal', 500, 'retention store failed');
};

export function supabaseRetentionPorts(admin: SupabaseClient): RetentionPorts {
  return {
    async dueForPurge(limit) {
      const { data, error } = await admin.rpc('due_for_purge', { p_limit: limit });
      if (error) fail();
      return (
        (data as { id: string; photo_path: string | null; pdf_path: string | null }[]) ?? []
      ).map((r) => ({ id: r.id, photoPath: r.photo_path, pdfPath: r.pdf_path }));
    },
    async deleteFile(bucket: Bucket, path) {
      const { error } = await admin.storage.from(bucket).remove([path]);
      if (error) throw new AppError('internal', 500, 'storage delete failed');
    },
    async fileExists(bucket: Bucket, path) {
      // storage-js answers a missing file with data = false AND an error object: read the answer first.
      const { data, error } = await admin.storage.from(bucket).exists(path);
      if (data === true) return true;
      if (data === false) return false;
      throw new AppError('internal', 500, error ? 'storage check failed' : 'storage check unclear');
    },
    async finishPurge(ids) {
      const { data, error } = await admin.rpc('finish_purge', { p_ids: ids });
      if (error) fail();
      return Number(data ?? 0);
    },
    async housekeeping() {
      const { data, error } = await admin.rpc('housekeeping');
      if (error) fail();
      return (data as Record<string, number>) ?? {};
    },
    async leftovers() {
      const { data, error } = await admin.rpc('retention_leftovers');
      if (error) fail();
      const r = (data as { overdue: number; dirty: number }[] | null)?.[0];
      return { overdue: r?.overdue ?? 0, dirty: r?.dirty ?? 0 };
    },
  };
}

/**
 * The moment WhatsApp has accepted a certificate, our copy is not needed any more (it is in the person's chat):
 * delete the files (and check), then clear the personal fields. Best effort and silent: the sweep that runs every
 * few minutes picks up anything this misses. What stays is a row of counts.
 */
export async function purgeSentEntry(admin: SupabaseClient, entryId: string): Promise<void> {
  try {
    const { data } = await admin
      .from('entries')
      .select('photo_path, pdf_path, status, purged_at')
      .eq('id', entryId)
      .maybeSingle();
    const e = data as {
      photo_path: string | null;
      pdf_path: string | null;
      status: string;
      purged_at: string | null;
    } | null;
    if (!e || e.purged_at || !['sent', 'delivered', 'read'].includes(e.status)) return;
    const ports = supabaseRetentionPorts(admin);
    if (await removeFiles(ports, { id: entryId, photoPath: e.photo_path, pdfPath: e.pdf_path })) {
      await ports.finishPurge([entryId]);
    }
  } catch (err) {
    console.warn('purge_after_send_failed', err instanceof Error ? err.name : typeof err);
  }
}
