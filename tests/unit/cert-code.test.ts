import { describe, expect, it } from 'vitest';
import { CERT_PREFIX, generateCertCode, isValidCertCode } from '@/lib/domain/cert-code';

describe('generateCertCode', () => {
  it('has the prefix, 6 random characters and a check character', () => {
    expect(generateCertCode()).toMatch(/^EKZ-JPR-[2-9A-HJKMNP-Z]{7}$/);
  });
  it('never uses look-alike characters', () => {
    const many = Array.from({ length: 500 }, () =>
      generateCertCode().slice(CERT_PREFIX.length),
    ).join('');
    expect(many).not.toMatch(/[01OIL]/);
  });
  it('produces valid codes', () => {
    for (let i = 0; i < 500; i++) expect(isValidCertCode(generateCertCode())).toBe(true);
  });
  it('rarely repeats: a collision is possible (the database unique key and a retry handle it) but very unlikely', () => {
    // 31^6 = 887M possible bodies; 10,000 draws expect about 0.06 collisions.
    const set = new Set(Array.from({ length: 10_000 }, () => generateCertCode()));
    expect(10_000 - set.size).toBeLessThanOrEqual(2);
  });
  it('is not sequential: neighbours are not close together', () => {
    let close = 0;
    let prev = generateCertCode();
    for (let i = 0; i < 1000; i++) {
      const next = generateCertCode();
      if (next.slice(8, 11) === prev.slice(8, 11)) close++;
      prev = next;
    }
    expect(close).toBeLessThan(10);
  });
  it('uses the injected random source', () => {
    const code = generateCertCode(() => 0);
    expect(code.slice(CERT_PREFIX.length, -1)).toBe('222222');
  });
});

describe('isValidCertCode', () => {
  it('catches a single mistyped character', () => {
    const code = generateCertCode(() => 5);
    expect(isValidCertCode(code)).toBe(true);
    const i = CERT_PREFIX.length + 2;
    const swapped = code.slice(0, i) + (code[i] === '3' ? '4' : '3') + code.slice(i + 1);
    expect(isValidCertCode(swapped)).toBe(false);
  });
  it.each([
    '',
    'EKZ-JPR-',
    'EKZ-JPR-000123',
    'ABC-JPR-222222X',
    'EKZ-JPR-22222',
    'EKZ-JPR-2222222222',
  ])('rejects %j', (code) => expect(isValidCertCode(code)).toBe(false));
});
