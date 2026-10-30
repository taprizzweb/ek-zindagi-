import type { AuditSink } from '@/lib/audit/audit';
import type { ViolationKey } from '@/config/violations';
import { AppError } from '@/lib/errors';
import { buildMessage, whatsappUrl } from './message';

export const LINK_TTL_HOURS = 24;

export interface SendCandidate {
  officerId: string;
  status: string;
  purged: boolean;
  phoneE164: string | null;
  phoneHash: string | null;
  personName: string | null;
  violation: ViolationKey;
  certCode: string;
  pdfPath: string | null;
}

export interface BridgePorts {
  loadForSend(entryId: string): Promise<SendCandidate | null>;
  isOptedOut(phoneHash: string): Promise<boolean>;
  rateLimit(key: string, windowSeconds: number, maxHits: number): Promise<boolean>;
  createLink(entryId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** status 'sent' and delivery_mode 'bridge'. This means "handed to WhatsApp", never "delivered". */
  markHandedOver(entryId: string): Promise<void>;
}

export interface BridgeDeps {
  ports: BridgePorts;
  audit: AuditSink;
  baseUrl: string;
  maxPerOfficerHour: number;
  newToken(): { token: string; hash: string };
  now(): Date;
}

export interface BridgeResult {
  waUrl: string;
  linkUrl: string;
  expiresAt: string;
  message: string;
}

/**
 * Bridge mode: makes a 24-hour link to the certificate and the wa.me URL that opens WhatsApp with
 * the message ready. The officer still has to tap Send, and wa.me cannot attach a file, which is why
 * a link is used. Nothing here claims the message was delivered.
 */
export async function prepareBridgeDelivery(
  deps: BridgeDeps,
  entryId: string,
  actor: { id: string; officerCode: string | null },
  onlyOfficerId?: string,
): Promise<BridgeResult> {
  const { ports } = deps;
  const entry = await ports.loadForSend(entryId);
  if (!entry || (onlyOfficerId && entry.officerId !== onlyOfficerId))
    throw new AppError('not_found', 404);
  if (entry.purged) throw new AppError('gone', 410);
  if (!['ready', 'sent'].includes(entry.status) || !entry.pdfPath)
    throw new AppError('not_ready', 409);
  if (!entry.phoneE164 || !entry.personName) throw new AppError('gone', 410);

  if (!(await ports.rateLimit(`send:officer:${actor.id}:h`, 3600, deps.maxPerOfficerHour))) {
    throw new AppError('rate_limited', 429);
  }
  // The person may have replied STOP since the entry was made.
  if (entry.phoneHash && (await ports.isOptedOut(entry.phoneHash)))
    throw new AppError('opted_out', 409);

  const { token, hash } = deps.newToken();
  const expiresAt = new Date(deps.now().getTime() + LINK_TTL_HOURS * 3_600_000);
  await ports.createLink(entryId, hash, expiresAt);

  const linkUrl = `${deps.baseUrl.replace(/\/+$/, '')}/c/${token}`;
  const message = buildMessage({
    name: entry.personName,
    certCode: entry.certCode,
    violation: entry.violation,
    link: linkUrl,
  });
  await ports.markHandedOver(entryId);
  await deps.audit.record({
    action: 'delivery_prepared',
    actorId: actor.id,
    actorCode: actor.officerCode,
    entryId,
    meta: { mode: 'bridge' },
  });
  return {
    waUrl: whatsappUrl(entry.phoneE164, message),
    linkUrl,
    expiresAt: expiresAt.toISOString(),
    message,
  };
}
