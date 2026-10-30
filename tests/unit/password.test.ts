import { describe, expect, it } from 'vitest';
import { generateTempPassword } from '@/lib/domain/password';

describe('generateTempPassword', () => {
  it('has the requested length and only unambiguous characters', () => {
    const p = generateTempPassword(14);
    expect(p).toHaveLength(14);
    expect(p).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]+$/);
  });
  it('never contains look-alike characters', () => {
    const many = Array.from({ length: 200 }, () => generateTempPassword(20)).join('');
    expect(many).not.toMatch(/[0O1lIo]/);
  });
  it('differs between calls', () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
  it('uses the injected random source over the whole alphabet', () => {
    const picks: number[] = [];
    generateTempPassword(3, (max) => {
      picks.push(max);
      return max - 1;
    });
    expect(picks).toEqual([56, 56, 56]);
  });
});
