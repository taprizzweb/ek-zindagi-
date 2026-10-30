import type { AuditSink } from '@/lib/audit/audit';
import { AppError } from '@/lib/errors';
import { decryptTotpSecret, encryptTotpSecret } from './mfa-crypto';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

export interface MfaFactor {
  secretEnc: string;
  confirmed: boolean;
  lastCounter: number;
}

export interface MfaPorts {
  getFactor(profileId: string): Promise<MfaFactor | null>;
  /** Stores the secret only if the account has none (two requests at once keep one secret). */
  createFactorIfAbsent(profileId: string, secretEnc: string): Promise<void>;
  confirmFactor(profileId: string): Promise<void>;
  /** Atomic: true only if `counter` is higher than any counter accepted before. */
  acceptCounter(profileId: string, counter: number): Promise<boolean>;
  deleteFactor(profileId: string): Promise<void>;
  rateLimit(key: string, windowSeconds: number, maxHits: number): Promise<boolean>;
}

export interface MfaDeps {
  ports: MfaPorts;
  audit: AuditSink;
  masterKey: string;
  now(): number;
}

type Who = { id: string; email?: string; officerCode: string | null };

/** The secret to show (as text and as a QR code) while the account has not finished setting up. */
export async function beginEnrollment(
  deps: MfaDeps,
  user: Who & { email: string },
): Promise<{ secret: string; uri: string } | null> {
  let factor = await deps.ports.getFactor(user.id);
  if (factor?.confirmed) return null;
  if (!factor) {
    await deps.ports.createFactorIfAbsent(
      user.id,
      encryptTotpSecret(generateTotpSecret(), user.id, deps.masterKey),
    );
    factor = await deps.ports.getFactor(user.id);
    if (!factor) throw new AppError('internal', 500, 'factor missing');
    if (factor.confirmed) return null;
  }
  const secret = decryptTotpSecret(factor.secretEnc, user.id, deps.masterKey);
  return { secret, uri: otpauthUri(secret, user.email) };
}

export const MFA_MAX_TRIES = 6;
export const MFA_WINDOW_SECONDS = 600;

/**
 * Checks a code. Wrong codes are counted (six in ten minutes, then locked for the rest of the window) and
 * audited; a code that was already used is refused. The first good code finishes the set-up.
 */
export async function verifyMfaCode(
  deps: MfaDeps,
  user: Who,
  code: string,
): Promise<{ enrolled: boolean }> {
  if (!(await deps.ports.rateLimit(`mfa:${user.id}`, MFA_WINDOW_SECONDS, MFA_MAX_TRIES)))
    throw new AppError('rate_limited', 429);
  const factor = await deps.ports.getFactor(user.id);
  if (!factor) throw new AppError('invalid_code', 401);

  let counter: number | null = null;
  try {
    const secret = decryptTotpSecret(factor.secretEnc, user.id, deps.masterKey);
    counter = verifyTotp(secret, code, deps.now(), factor.lastCounter);
  } catch {
    counter = null; // a stored secret that will not decrypt is never a pass
  }
  if (counter === null || !(await deps.ports.acceptCounter(user.id, counter))) {
    await deps.audit.record({
      action: 'mfa_failed',
      actorId: user.id,
      actorCode: user.officerCode,
    });
    throw new AppError('invalid_code', 401);
  }
  if (!factor.confirmed) {
    await deps.ports.confirmFactor(user.id);
    await deps.audit.record({
      action: 'mfa_enrolled',
      actorId: user.id,
      actorCode: user.officerCode,
    });
    return { enrolled: true };
  }
  await deps.audit.record({
    action: 'mfa_verified',
    actorId: user.id,
    actorCode: user.officerCode,
  });
  return { enrolled: false };
}

/** An admin clears a supervisor's second step (a lost phone). They set it up again at the next sign-in. */
export async function resetMfa(
  deps: Pick<MfaDeps, 'ports' | 'audit'>,
  actor: Who & { role: string },
  target: { id: string; role: string },
): Promise<void> {
  if (actor.role !== 'admin') throw new AppError('forbidden', 403);
  if (target.id === actor.id || target.role !== 'supervisor') throw new AppError('forbidden', 403);
  await deps.ports.deleteFactor(target.id);
  await deps.audit.record({ action: 'mfa_reset', actorId: actor.id, actorCode: actor.officerCode });
}
