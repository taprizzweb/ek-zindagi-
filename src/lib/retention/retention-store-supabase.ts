import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import type { Bucket, RetentionPorts } from './retention';

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
