import { describe, expect, it } from 'vitest';
import { formatTenDigits, normalizeIndianMobile } from '@/lib/domain/phone';
import { hashPhone } from '@/lib/domain/phone-hash';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['6000000000', '+916000000000'],
    ['7999999999', '+917999999999'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it.each([
    '',
    '123456789', // 9 digits
    '98765432101', // 11 digits, no leading 0
    '5876543210', // starts with 5
    '0123456789',
    '+449876543210', // not India
    '+1 9876543210',
    '98765abcde',
    '९८७६५४३२१०', // Devanagari digits
    '9876543210; drop table',
    '+9198765432101',
    '+',
  ])('rejects %j', (input) => {
    expect(normalizeIndianMobile(input)).toBeNull();
  });
});

describe('hashPhone', () => {
  const secret = 's'.repeat(32);
  it('is a stable 64-character hex digest', () => {
    const h = hashPhone('+919876543210', secret);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPhone('+919876543210', secret)).toBe(h);
  });
  it('depends on both the number and the secret', () => {
    expect(hashPhone('+919876543211', secret)).not.toBe(hashPhone('+919876543210', secret));
    expect(hashPhone('+919876543210', 'x'.repeat(32))).not.toBe(hashPhone('+919876543210', secret));
  });
  it('does not contain the number', () => {
    expect(hashPhone('+919876543210', secret)).not.toContain('9876543210');
  });
});

describe('formatTenDigits', () => {
  it('groups 5 + 5', () => expect(formatTenDigits('9876543210')).toBe('98765 43210'));
  it('leaves other lengths alone', () => expect(formatTenDigits('98765')).toBe('98765'));
});
