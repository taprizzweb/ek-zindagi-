import { AppError } from '@/lib/errors';

export type AuditAction =
  | 'admin_seeded'
  | 'login'
  | 'login_failed'
  | 'login_denied'
  | 'password_changed'
  | 'officer_created'
  | 'officer_disabled'
  | 'officer_enabled'
  | 'officer_password_reset'
  | 'entry_created';

/** Keep in step with the audit_meta_no_personal_keys constraint in the first migration. */
export const FORBIDDEN_AUDIT_KEYS = [
  'name',
  'person_name',
  'phone',
  'phone_e164',
  'photo',
  'password',
  'token',
  'email',
] as const;

export type AuditMeta = Record<string, string | number | boolean | null>;

export interface AuditEvent {
  action: AuditAction;
  actorId?: string | null;
  actorCode?: string | null;
  entryId?: string | null;
  meta?: AuditMeta;
}

/** Where audit rows go. The Supabase implementation is in `audit-supabase.ts`. */
export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

/** Audit metadata is flat and holds no personal keys. Fails loudly so a bug cannot leak data. */
export function sanitizeAuditMeta(meta: AuditMeta | undefined): AuditMeta {
  const out: AuditMeta = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if ((FORBIDDEN_AUDIT_KEYS as readonly string[]).includes(key.toLowerCase())) {
      throw new AppError('internal', 500, `Audit meta key not allowed: ${key}`);
    }
    if (typeof value === 'string' && value.length > 200) {
      throw new AppError('internal', 500, `Audit meta value too long for ${key}`);
    }
    out[key] = value;
  }
  return out;
}
