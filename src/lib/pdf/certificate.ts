import { renderPdf } from './render';
import { stampMetadata } from './metadata';
import { buildCertificateHtml, type Branding, type CertificateData, NO_BRANDING } from './template';

/** One certificate as PDF bytes: render, then write code and date into the file properties. */
export async function createCertificatePdf(
  data: CertificateData,
  branding: Branding = NO_BRANDING,
): Promise<Buffer> {
  const raw = await renderPdf(buildCertificateHtml(data, branding));
  return stampMetadata(raw, data.certCode, data.createdAt);
}
