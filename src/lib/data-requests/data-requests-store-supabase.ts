import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import { supabaseRetentionPorts } from '@/lib/retention/retention-store-supabase';
import type { DataRequestPorts } from './data-requests';

export function supabaseDataRequestPorts(admin: SupabaseClient): DataRequestPorts {
  const retention = supabaseRetentionPorts(admin);
  return {
    deleteFile: retention.deleteFile,
    fileExists: retention.fileExists,
    finishPurge: retention.finishPurge,
    async findByCode(code) {
      const { data, error } = await admin.rpc('entry_for_purge', { p_cert_code: code });
      if (error) throw new AppError('internal', 500, 'lookup failed');
      const r = (
        data as
          | { id: string; photo_path: string | null; pdf_path: string | null; purged: boolean }[]
          | null
      )?.[0];
      return r
        ? { id: r.id, photoPath: r.photo_path, pdfPath: r.pdf_path, purged: r.purged }
        : null;
    },
    async addOptOut(phoneHash) {
      const { error } = await admin
        .from('opt_outs')
        .upsert({ phone_hash: phoneHash }, { onConflict: 'phone_hash', ignoreDuplicates: true });
      if (error) throw new AppError('internal', 500, 'opt-out failed');
    },
  };
}
