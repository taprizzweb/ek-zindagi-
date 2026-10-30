import type { AuditSink } from '@/lib/audit/audit';
import type { ViolationKey } from '@/config/violations';
import { AppError } from '@/lib/errors';
import type { BridgePorts } from './bridge';
import { templateBodyParams } from './message';
import { WhatsAppError, type SendTemplateInput } from './whatsapp/client';

export interface CloudClaim {
  claimed: boolean;
  status: string;
  purged: boolean;
  officerId: string;
  phoneE164: string | null;
  phoneHash: string | null;
  personName: string | null;
  violation: ViolationKey;
  certCode: string;
  pdfPath: string | null;
  attempts: number;
}

export interface CloudPorts extends Pick<BridgePorts, 'loadForSend' | 'isOptedOut' | 'rateLimit'> {
  /** Atomic: of several callers only one gets claimed = true (see claim_send in the database). */
  claim(entryId: string): Promise<CloudClaim | null>;
  downloadPdf(path: string): Promise<Buffer>;
  complete(entryId: string, messageId: string, category: string | null): Promise<boolean>;
  fail(
    entryId: string,
    code: string,
    retryable: boolean,
    nextRetryAt: Date | null,
  ): Promise<boolean>;
  dueRetries(limit: number, maxAttempts: number): Promise<string[]>;
  markStale(ageMinutes: number): Promise<number>;
}

export interface CloudDeps {
  ports: CloudPorts;
  audit: AuditSink;
  wa: {
    uploadPdf(pdf: Buffer, filename: string): Promise<string>;
    sendTemplate(input: SendTemplateInput): Promise<{ messageId: string }>;
  };
  /** The kill switch: true stops every send and every retry at once. */
  paused(): boolean | Promise<boolean>;
  maxPerOfficerHour: number;
  /** Tries inside one request or retry run before giving up for now (transient failures only). */
  inlineAttempts: number;
  /** Claims in total (first send plus later retries) before a transient failure becomes final. */
  maxTotalAttempts: number;
  sleep(ms: number): Promise<void>;
  now(): Date;
}

export const DOCUMENT_FILENAME = 'EK-ZINDAGI-certificate.pdf';
const INLINE_DELAYS_MS = [1000, 3000, 6000];
const BACKGROUND_DELAYS_MIN = [5, 15, 60, 180];
/** A send claimed this long ago and never completed has an unknown outcome. It is NOT retried. */
export const STALE_SEND_MINUTES = 15;

export interface CloudResult {
  status: string;
  alreadySent: boolean;
}

type Actor = { id: string | null; officerCode: string | null };

async function deliverWithInlineRetries(deps: CloudDeps, claim: CloudClaim): Promise<string> {
  const attempts = Math.max(1, deps.inlineAttempts);
  let params: string[];
  try {
    params = templateBodyParams({
      name: claim.personName!,
      certCode: claim.certCode,
      violation: claim.violation,
    });
  } catch (err) {
    console.warn('cloud_send_internal_error', errorName(err)); // an entry we cannot describe; retrying cannot help
    throw new WhatsAppError('config', 'bad_entry');
  }
  for (let i = 0; i < attempts; i++) {
    try {
      const pdf = await deps.ports.downloadPdf(claim.pdfPath!);
      const mediaId = await deps.wa.uploadPdf(pdf, DOCUMENT_FILENAME);
      const sent = await deps.wa.sendTemplate({
        toE164: claim.phoneE164!,
        mediaId,
        filename: DOCUMENT_FILENAME,
        bodyParams: params,
      });
      return sent.messageId;
    } catch (err) {
      if (!(err instanceof WhatsAppError))
        console.warn('cloud_send_internal_error', errorName(err)); // name only: messages can carry personal data
      const wa = err instanceof WhatsAppError ? err : new WhatsAppError('transient', 'storage'); // our own storage hiccup
      if (wa.kind === 'transient' && i < attempts - 1) {
        await deps.sleep(
          Math.min(
            wa.retryAfterMs ?? INLINE_DELAYS_MS[Math.min(i, INLINE_DELAYS_MS.length - 1)]!,
            10_000,
          ),
        );
        continue;
      }
      throw wa;
    }
  }
  throw new WhatsAppError('transient', 'exhausted');
}

/** Sends one claimed entry and records what happened. Throws an AppError for the caller on any failure. */
async function runClaim(
  deps: CloudDeps,
  claim: CloudClaim,
  entryId: string,
  actor: Actor,
): Promise<void> {
  const record = (
    action: 'delivery_sent' | 'delivery_failed',
    meta: Record<string, string | number | boolean>,
  ) =>
    deps.audit.record({
      action,
      actorId: actor.id,
      actorCode: actor.officerCode ?? 'system',
      entryId,
      meta,
    });
  const giveUp = async (code: string, retryable: boolean, kind: string): Promise<never> => {
    const next = retryable
      ? new Date(
          deps.now().getTime() +
            (BACKGROUND_DELAYS_MIN[
              Math.min(claim.attempts - 1, BACKGROUND_DELAYS_MIN.length - 1)
            ] ?? 180) *
              60_000,
        )
      : null;
    await deps.ports.fail(entryId, code, retryable, next);
    await record('delivery_failed', { code, kind, retry: retryable, attempts: claim.attempts });
    throw new AppError(retryable ? 'send_retrying' : 'send_failed', 502);
  };

  if (!claim.phoneE164 || !claim.personName || !claim.pdfPath)
    return giveUp('data_missing', false, 'permanent');
  // The person may have replied STOP since the entry was made.
  if (claim.phoneHash && (await deps.ports.isOptedOut(claim.phoneHash))) {
    await deps.ports.fail(entryId, 'opted_out', false, null);
    await record('delivery_failed', {
      code: 'opted_out',
      kind: 'permanent',
      retry: false,
      attempts: claim.attempts,
    });
    throw new AppError('opted_out', 409);
  }
  try {
    const messageId = await deliverWithInlineRetries(deps, claim);
    await deps.ports.complete(entryId, messageId, null);
    await record('delivery_sent', { attempts: claim.attempts });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (!(err instanceof WhatsAppError)) throw new AppError('internal', 500);
    if (err.kind === 'ambiguous') {
      return giveUp(
        err.code === 'network' ? 'ambiguous_network' : `ambiguous_${err.code}`,
        false,
        'ambiguous',
      );
    }
    if (err.kind === 'transient') {
      return giveUp(err.code, claim.attempts < deps.maxTotalAttempts, 'transient');
    }
    if (err.kind === 'config') console.warn('whatsapp_config_error', err.code); // someone has to fix the setup
    return giveUp(err.code, false, err.kind);
  }
}

/**
 * "Send on WhatsApp" in cloud API mode. At most one message per entry, whatever happens:
 * the send is claimed atomically; an entry that is already sent, delivered or read is left alone;
 * an ambiguous failure (the request may have reached WhatsApp) is never retried automatically.
 */
export async function sendViaCloudApi(
  deps: CloudDeps,
  entryId: string,
  actor: { id: string; officerCode: string | null },
  onlyOfficerId?: string,
): Promise<CloudResult> {
  if (await deps.paused()) throw new AppError('campaign_paused', 503);
  const entry = await deps.ports.loadForSend(entryId);
  if (!entry || (onlyOfficerId && entry.officerId !== onlyOfficerId))
    throw new AppError('not_found', 404);
  // Already sent, and our copy of the person's data is gone by design: this is a repeat tap, not an error.
  if (entry.purged && ['sent', 'delivered', 'read'].includes(entry.status))
    return { status: entry.status, alreadySent: true };
  if (entry.purged) throw new AppError('gone', 410);
  if (entry.phoneHash && (await deps.ports.isOptedOut(entry.phoneHash)))
    throw new AppError('opted_out', 409);
  if (!(await deps.ports.rateLimit(`send:officer:${actor.id}:h`, 3600, deps.maxPerOfficerHour))) {
    throw new AppError('rate_limited', 429);
  }

  const claim = await deps.ports.claim(entryId);
  if (!claim) throw new AppError('not_found', 404);
  if (claim.purged) throw new AppError('gone', 410);
  if (!claim.claimed) {
    if (['sent', 'delivered', 'read'].includes(claim.status))
      return { status: claim.status, alreadySent: true };
    if (claim.status === 'sending') throw new AppError('busy', 409);
    if (claim.status === 'failed') throw new AppError('send_failed', 409);
    throw new AppError('not_ready', 409);
  }
  await runClaim(deps, claim, entryId, actor);
  return { status: 'sent', alreadySent: false };
}

export interface RetryReport {
  staleMarked: number;
  attempted: number;
  sent: number;
  failed: number;
}

/**
 * Background pass (cron): gives up on sends with an unknown outcome, then retries the transient failures
 * that are due, up to the attempt limit. Does nothing while the campaign is paused.
 */
export async function retryDueDeliveries(deps: CloudDeps, limit = 20): Promise<RetryReport> {
  if (await deps.paused()) throw new AppError('campaign_paused', 503);
  const staleMarked = await deps.ports.markStale(STALE_SEND_MINUTES);
  const ids = await deps.ports.dueRetries(limit, deps.maxTotalAttempts);
  const report: RetryReport = { staleMarked, attempted: 0, sent: 0, failed: 0 };
  for (const id of ids) {
    if (await deps.paused()) break;
    const claim = await deps.ports.claim(id);
    if (!claim?.claimed) continue; // someone else took it, or it is no longer retryable
    report.attempted++;
    try {
      await runClaim(deps, claim, id, { id: null, officerCode: null });
      report.sent++;
    } catch {
      report.failed++;
    }
  }
  return report;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}
