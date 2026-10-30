import { AppError } from '@/lib/errors';
import { hashToken, isWellFormedToken } from './token';

export interface LinkPorts {
  rateLimit(key: string, windowSeconds: number, maxHits: number): Promise<boolean>;
  /** Unknown token: null. Expiry is decided by the database clock. */
  open(
    tokenHash: string,
  ): Promise<{ status: 'ok' | 'expired' | 'gone'; pdfPath: string | null } | null>;
  downloadPdf(path: string): Promise<Buffer>;
}

export interface LinkDeps {
  ports: LinkPorts;
  maxPerIp10Min: number;
}

/**
 * Serves one certificate PDF for a link token. It can only ever return the PDF of the entry the
 * token belongs to: the token is the only input, it is checked for shape first, and the file path
 * comes from the database, never from the request.
 */
export async function resolveCertificateLink(
  deps: LinkDeps,
  token: string,
  ip: string,
): Promise<Buffer> {
  if (!isWellFormedToken(token)) throw new AppError('not_found', 404);
  if (!(await deps.ports.rateLimit(`link:ip:${ip}`, 600, deps.maxPerIp10Min)))
    throw new AppError('rate_limited', 429);
  const opened = await deps.ports.open(hashToken(token));
  if (!opened) throw new AppError('not_found', 404);
  if (opened.status !== 'ok' || !opened.pdfPath) throw new AppError('gone', 410);
  return deps.ports.downloadPdf(opened.pdfPath);
}
