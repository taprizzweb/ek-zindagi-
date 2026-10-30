import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  OTHER_CHOICES,
  VIOLATIONS,
  VIOLATION_KEYS,
  otherText,
  violationByKey,
} from '@/config/violations';

const DEVANAGARI = /[ऀ-ॿ]/;

describe('violation config', () => {
  it('has one entry per key, in the same order', () => {
    expect(VIOLATIONS.map((v) => v.key)).toEqual([...VIOLATION_KEYS]);
  });
  it('matches the database enum', () => {
    const sql = readFileSync('supabase/migrations/20261030000001_init.sql', 'utf8');
    const block = /create type public\.violation_key as enum\s*\(([^)]+)\)/.exec(sql)?.[1] ?? '';
    const dbKeys = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(dbKeys).toEqual([...VIOLATION_KEYS]);
  });
  it('has English and Hindi text for every label and line', () => {
    for (const v of VIOLATIONS) {
      expect(v.en.length, v.key).toBeGreaterThan(3);
      expect(v.lineEn.length, v.key).toBeGreaterThan(10);
      expect(v.hi, v.key).toMatch(DEVANAGARI);
      expect(v.lineHi, v.key).toMatch(DEVANAGARI);
    }
  });
  it('uses the wording from the brief for the English lines', () => {
    expect(violationByKey('helmet').lineEn).toBe(
      'Wear your helmet. Someone is waiting for you at home.',
    );
    expect(violationByKey('overspeed').lineEn).toBe('Speed saves minutes, not lives. Slow down.');
    expect(violationByKey('mobile').lineEn).toBe('No call is worth a life. Put the phone down.');
  });
  it('never uses wording that makes the certificate look real', () => {
    const banned =
      /\b(late|rip|deceased|death|died|dead|demise|obituary|shraddhanjali)\b|श्रद्धांजलि|स्वर्गीय|मृत/i;
    for (const v of VIOLATIONS) {
      expect(`${v.en} ${v.lineEn} ${v.hi} ${v.lineHi}`).not.toMatch(banned);
    }
  });
  it('keeps lines short enough for the certificate layout', () => {
    for (const v of VIOLATIONS) expect(v.lineEn.length).toBeLessThanOrEqual(90);
  });
  it('has Hindi for every "other" choice', () => {
    for (const c of OTHER_CHOICES) expect(c.hi).toMatch(DEVANAGARI);
  });
});

describe('otherText', () => {
  it('uses the list label for a listed choice', () => {
    expect(otherText('triple_riding', 'ignored')).toBe('Triple riding');
  });
  it('uses the trimmed typed text for "typed"', () => {
    expect(otherText('typed', '  No indicator  ')).toBe('No indicator');
    expect(otherText('typed', undefined)).toBe('');
  });
});
