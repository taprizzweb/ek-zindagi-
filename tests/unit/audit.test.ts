import { describe, expect, it } from 'vitest';
import { FORBIDDEN_AUDIT_KEYS, sanitizeAuditMeta } from '@/lib/audit/audit';
import { readFileSync } from 'node:fs';

describe('sanitizeAuditMeta', () => {
  it('passes flat, non-personal metadata through', () => {
    expect(sanitizeAuditMeta({ target_code: 'JP-0001', count: 3, ok: true, none: null })).toEqual({
      target_code: 'JP-0001',
      count: 3,
      ok: true,
      none: null,
    });
  });
  it('returns an empty object for undefined', () => {
    expect(sanitizeAuditMeta(undefined)).toEqual({});
  });
  it.each([...FORBIDDEN_AUDIT_KEYS])('refuses the personal key %s (any case)', (key) => {
    expect(() => sanitizeAuditMeta({ [key]: 'x' })).toThrow();
    expect(() => sanitizeAuditMeta({ [key.toUpperCase()]: 'x' })).toThrow();
  });
  it('refuses very long values (likely a pasted blob)', () => {
    expect(() => sanitizeAuditMeta({ note: 'x'.repeat(201) })).toThrow();
  });
  it('stays in step with the database constraint', () => {
    const sql = readFileSync('supabase/migrations/20261030000001_init.sql', 'utf8');
    const match = /meta \?\| array\[([^\]]+)\]/s.exec(sql);
    const dbKeys = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(dbKeys).toEqual([...FORBIDDEN_AUDIT_KEYS].sort());
  });
});
