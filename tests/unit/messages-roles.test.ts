import { describe, expect, it } from 'vitest';
import { homePathFor, ROLES } from '@/lib/domain/roles';
import { ERROR_MESSAGES, messageFor } from '@/lib/i18n/messages';

describe('error messages', () => {
  it('every message has Hindi and English text', () => {
    for (const [code, m] of Object.entries(ERROR_MESSAGES)) {
      expect(m.en.length, code).toBeGreaterThan(5);
      expect(m.hi, code).toMatch(/[ऀ-ॿ]/);
    }
  });
  it('falls back to the generic message for unknown codes', () => {
    expect(messageFor('???')).toBe(ERROR_MESSAGES.internal);
    expect(messageFor(undefined)).toBe(ERROR_MESSAGES.internal);
  });
  it('does not blame the officer', () => {
    for (const m of Object.values(ERROR_MESSAGES))
      expect(m.en).not.toMatch(/your fault|you (failed|entered wrong)/i);
  });
});

describe('homePathFor', () => {
  it('gives every role its own home', () => {
    const paths = ROLES.map(homePathFor);
    expect(new Set(paths).size).toBe(ROLES.length);
  });
});
