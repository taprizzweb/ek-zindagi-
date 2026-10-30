import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { assertSameOrigin, isSameOrigin } from '@/lib/security/origin';

const h = (o: Record<string, string>) => new Headers(o);

describe('isSameOrigin', () => {
  it('accepts a request from our own host', () => {
    expect(isSameOrigin(h({ origin: 'https://app.example.org', host: 'app.example.org' }))).toBe(
      true,
    );
  });
  it('prefers x-forwarded-host', () => {
    expect(
      isSameOrigin(
        h({
          origin: 'https://app.example.org',
          host: 'internal:3000',
          'x-forwarded-host': 'app.example.org',
        }),
      ),
    ).toBe(true);
  });
  it('rejects another origin', () => {
    expect(isSameOrigin(h({ origin: 'https://evil.example', host: 'app.example.org' }))).toBe(
      false,
    );
  });
  it('rejects a missing Origin header', () => {
    expect(isSameOrigin(h({ host: 'app.example.org' }))).toBe(false);
  });
  it('rejects a malformed Origin header', () => {
    expect(isSameOrigin(h({ origin: 'not a url', host: 'app.example.org' }))).toBe(false);
  });
  it('rejects a lookalike host', () => {
    expect(
      isSameOrigin(h({ origin: 'https://app.example.org.evil.io', host: 'app.example.org' })),
    ).toBe(false);
  });
  it('rejects when Sec-Fetch-Site says cross-site, even if Origin matches', () => {
    expect(
      isSameOrigin(
        h({
          origin: 'https://app.example.org',
          host: 'app.example.org',
          'sec-fetch-site': 'cross-site',
        }),
      ),
    ).toBe(false);
  });
  it('assertSameOrigin throws a 403 AppError', () => {
    try {
      assertSameOrigin(h({ origin: 'https://evil.example', host: 'app.example.org' }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(403);
    }
  });
});
