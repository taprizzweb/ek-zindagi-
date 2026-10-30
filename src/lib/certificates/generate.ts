import type { AuditSink } from '@/lib/audit/audit';
import type { ViolationKey } from '@/config/violations';
import { AppError } from '@/lib/errors';
import type { Branding, CertificateData } from '@/lib/pdf/template';

export interface Claim {
  claimed: boolean;
  status: string;
  purged: boolean;
  officerId: string;
  certCode: string;
  personName: string | null;
  areaName: string | null;
  violation: ViolationKey;
  otherText: string | null;
  photoPath: string | null;
  createdAt: string;
}

/** Everything certificate generation needs from the outside world. */
export interface CertificatePorts {
  ownerOf(entryId: string): Promise<string | null>;
  /** Atomically takes the entry for rendering (see claim_certificate in the database). */
  claim(entryId: string): Promise<Claim | null>;
  downloadPhoto(path: string): Promise<Buffer>;
  uploadPdf(entryId: string, pdf: Buffer): Promise<string>;
  markReady(entryId: string, pdfPath: string): Promise<void>;
  markFailed(entryId: string, errorCode: string): Promise<void>;
}

export interface CertificateDeps {
  ports: CertificatePorts;
  audit: AuditSink;
  render(data: CertificateData, branding: Branding): Promise<Buffer>;
  branding: Branding;
  now(): number;
}

export interface GenerateResult {
  status: string;
  generated: boolean;
}

/**
 * Creates the PDF for one entry and stores it. Safe to call again and again: an entry that is
 * already ready is left alone, one being rendered right now answers "busy", a failed one is retried.
 * `onlyOfficerId` limits the call to the officer who created the entry (others get "not found").
 */
export async function generateCertificate(
  deps: CertificateDeps,
  entryId: string,
  actor: { id: string; officerCode: string | null },
  onlyOfficerId?: string,
): Promise<GenerateResult> {
  const { ports } = deps;
  const owner = await ports.ownerOf(entryId);
  if (!owner || (onlyOfficerId && owner !== onlyOfficerId)) throw new AppError('not_found', 404);

  const claim = await ports.claim(entryId);
  if (!claim) throw new AppError('not_found', 404);
  if (claim.purged) throw new AppError('gone', 410);
  if (!claim.claimed) {
    if (claim.status === 'generating') throw new AppError('busy', 409);
    return { status: claim.status, generated: false };
  }

  const started = deps.now();
  let stage = 'prepare';
  try {
    if (!claim.personName || !claim.areaName) throw new Error('entry has no data');
    const photoJpeg = claim.photoPath ? await ports.downloadPhoto(claim.photoPath) : null;
    stage = 'render';
    const pdf = await deps.render(
      {
        certCode: claim.certCode,
        name: claim.personName,
        violation: claim.violation,
        otherText: claim.otherText,
        areaName: claim.areaName,
        createdAt: new Date(claim.createdAt),
        photoJpeg,
      },
      deps.branding,
    );
    stage = 'store';
    const path = await ports.uploadPdf(entryId, pdf);
    await ports.markReady(entryId, path);
    await deps.audit.record({
      action: 'certificate_generated',
      actorId: actor.id,
      actorCode: actor.officerCode,
      entryId,
      meta: { ms: deps.now() - started, kb: Math.round(pdf.length / 1024) },
    });
    return { status: 'ready', generated: true };
  } catch (err) {
    await ports.markFailed(entryId, `pdf_${stage}`).catch(() => undefined);
    await deps.audit
      .record({
        action: 'certificate_failed',
        actorId: actor.id,
        actorCode: actor.officerCode,
        entryId,
        // The technical reason only (a browser start-up or timeout message), never the entry data.
        meta: { stage, reason: err instanceof Error ? err.message.slice(0, 190) : null },
      })
      .catch(() => undefined);
    // the cause is not shown to the officer
    throw new AppError('pdf_failed', 502);
  }
}
