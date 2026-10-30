import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import { sanitizeAuditMeta, type AuditEvent, type AuditSink } from './audit';

export function supabaseAuditSink(admin: SupabaseClient): AuditSink {
  return {
    async record(event: AuditEvent) {
      const { error } = await admin.from('audit_log').insert({
        action: event.action,
        actor_id: event.actorId ?? null,
        actor_code: event.actorCode ?? null,
        entry_id: event.entryId ?? null,
        meta: sanitizeAuditMeta(event.meta),
      });
      if (error) throw new AppError('internal', 500, 'Audit write failed');
    },
  };
}
