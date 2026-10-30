import type { AuditSink } from '@/lib/audit/audit';
import type { ViolationKey } from '@/config/violations';
import { AppError } from '@/lib/errors';
import type { Branding, CertificateData } from '@/lib/pdf/template';

export type DownloadFormat = 'pdf' | 'image';

export interface DownloadEntry {
  officerId: string;
  status: string;
  purged: boolean;
  certCode: string;
  personName: string | null;
  areaName: string | null;
  violation: ViolationKey;
  otherText: string | null;
  photoPath: string | null;
  pdfPath: string | null;
  createdAt: string;
}

export interface DownloadPorts {
  load(entryId: string): Promise<DownloadEntry | null>;
  downloadPdf(path: string): Promise<Buffer>;
  downloadPhoto(path: string): Promise<Buffer>;
}

export interface DownloadDeps {
  ports: DownloadPorts;
  audit: AuditSink;
  renderPng(data: CertificateData, branding: Branding): Promise<Buffer>;
  branding: Branding;
}

export interface DownloadResult {
  bytes: Buffer;
  contentType: string;
  filename: string;
}

/** The officer's own certificate, as the stored PDF or as a PNG image. Other officers get "not found". */
export async function downloadCertificate(
  deps: DownloadDeps,
  entryId: string,
  format: DownloadFormat,
  actor: { id: string; officerCode: string | null },
): Promise<DownloadResult> {
  const e = await deps.ports.load(entryId);
  if (!e || e.officerId !== actor.id) throw new AppError('not_found', 404);
  if (e.purged) throw new AppError('gone', 410);
  if (!['ready', 'sent', 'delivered', 'read'].includes(e.status) || !e.pdfPath)
    throw new AppError('not_ready', 409);

  let result: DownloadResult;
  if (format === 'pdf') {
    result = {
      bytes: await deps.ports.downloadPdf(e.pdfPath),
      contentType: 'application/pdf',
      filename: `EK-ZINDAGI-${e.certCode}.pdf`,
    };
  } else {
    if (!e.personName || !e.areaName) throw new AppError('gone', 410);
    const photoJpeg = e.photoPath ? await deps.ports.downloadPhoto(e.photoPath) : null;
    result = {
      bytes: await deps.renderPng(
        {
          certCode: e.certCode,
          name: e.personName,
          violation: e.violation,
          otherText: e.otherText,
          areaName: e.areaName,
          createdAt: new Date(e.createdAt),
          photoJpeg,
        },
        deps.branding,
      ),
      contentType: 'image/png',
      filename: `EK-ZINDAGI-${e.certCode}.png`,
    };
  }
  await deps.audit.record({
    action: 'certificate_downloaded',
    actorId: actor.id,
    actorCode: actor.officerCode,
    entryId,
    meta: { format },
  });
  return result;
}
