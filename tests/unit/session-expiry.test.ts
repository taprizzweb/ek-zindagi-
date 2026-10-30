import { describe, expect, it } from 'vitest';
import { isSessionExpired, parseActivityCookie } from '@/lib/domain/session-expiry';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

describe('isSessionExpired', () => {
  it('keeps a session that was active recently', () => {
    expect(isSessionExpired(NOW - 10 * MIN, NOW, 30)).toBe(false);
  });
  it('expires exactly after the limit, not before', () => {
    expect(isSessionExpired(NOW - 30 * MIN, NOW, 30)).toBe(false);
    expect(isSessionExpired(NOW - 30 * MIN - 1, NOW, 30)).toBe(true);
  });
  it('treats a missing activity cookie as expired', () => {
    expect(isSessionExpired(null, NOW, 30)).toBe(true);
  });
  it('treats a timestamp from the future as tampered', () => {
    expect(isSessionExpired(NOW + 10 * MIN, NOW, 30)).toBe(true);
  });
  it('allows small clock skew', () => {
    expect(isSessionExpired(NOW + 5_000, NOW, 30)).toBe(false);
  });
});

describe('parseActivityCookie', () => {
  it('reads a millisecond timestamp', () => {
    expect(parseActivityCookie(String(NOW))).toBe(NOW);
  });
  it.each([undefined, '', 'abc', '12', '1e12', '-1800000000000', '1800000000000 '])(
    'rejects %j',
    (v) => {
      expect(parseActivityCookie(v)).toBeNull();
    },
  );
});
