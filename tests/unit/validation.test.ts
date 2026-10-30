import { describe, expect, it } from 'vitest';
import { changePasswordSchema, loginSchema } from '@/lib/validation/auth';
import { createOfficerSchema, updateOfficerSchema, uuidSchema } from '@/lib/validation/officer';

describe('loginSchema', () => {
  it('normalises the email', () => {
    expect(loginSchema.parse({ email: '  Officer@Example.ORG ', password: 'x' }).email).toBe(
      'officer@example.org',
    );
  });
  it('rejects unknown fields', () => {
    expect(() => loginSchema.parse({ email: 'a@b.co', password: 'x', role: 'admin' })).toThrow();
  });
  it.each([
    { email: 'nope', password: 'x' },
    { email: 'a@b.co', password: '' },
    { email: 'a@b.co' },
  ])('rejects %j', (v) => expect(() => loginSchema.parse(v)).toThrow());
});

describe('changePasswordSchema', () => {
  it('requires at least 10 characters', () => {
    expect(() => changePasswordSchema.parse({ newPassword: '123456789' })).toThrow();
    expect(changePasswordSchema.parse({ newPassword: '1234567890' })).toBeTruthy();
  });
  it('caps at 72 characters (bcrypt limit)', () => {
    expect(() => changePasswordSchema.parse({ newPassword: 'x'.repeat(73) })).toThrow();
  });
});

describe('createOfficerSchema', () => {
  const ok = { email: 'a@b.co', displayName: 'Ravi Kumar', role: 'officer' };
  it('accepts officers and supervisors', () => {
    expect(createOfficerSchema.parse(ok).role).toBe('officer');
    expect(createOfficerSchema.parse({ ...ok, role: 'supervisor' }).role).toBe('supervisor');
  });
  it('never lets the app create an admin', () => {
    expect(() => createOfficerSchema.parse({ ...ok, role: 'admin' })).toThrow();
  });
  it('rejects short names, long names and extra fields', () => {
    expect(() => createOfficerSchema.parse({ ...ok, displayName: 'R' })).toThrow();
    expect(() => createOfficerSchema.parse({ ...ok, displayName: 'x'.repeat(61) })).toThrow();
    expect(() => createOfficerSchema.parse({ ...ok, active: true })).toThrow();
  });
  it('accepts Devanagari names', () => {
    expect(createOfficerSchema.parse({ ...ok, displayName: 'रवि कुमार' }).displayName).toBe(
      'रवि कुमार',
    );
  });
});

describe('updateOfficerSchema / uuidSchema', () => {
  it('allows only the three known actions', () => {
    for (const action of ['disable', 'enable', 'reset_password'])
      expect(updateOfficerSchema.parse({ action }).action).toBe(action);
    expect(() => updateOfficerSchema.parse({ action: 'delete' })).toThrow();
    expect(() => updateOfficerSchema.parse({ action: 'enable', role: 'admin' })).toThrow();
  });
  it('validates ids', () => {
    expect(uuidSchema.safeParse('not-an-id').success).toBe(false);
    expect(uuidSchema.safeParse('00000000-0000-4000-8000-0000000000a1').success).toBe(true);
  });
});
