import { AppError } from '@/lib/errors';

type HeaderGetter = { get(name: string): string | null };

/** State-changing requests must come from our own pages. */
export function isSameOrigin(headers: HeaderGetter): boolean {
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = headers.get('origin');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function assertSameOrigin(headers: HeaderGetter): void {
  if (!isSameOrigin(headers))
    throw new AppError('cross_origin', 403, 'Cross-origin request refused');
}
