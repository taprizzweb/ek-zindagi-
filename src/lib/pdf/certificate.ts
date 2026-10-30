import { stampMetadata } from './metadata';
import { renderPdf, renderPng } from './render';
import { buildCertificateHtml, NO_BRANDING, type Branding, type CertificateData } from './template';

/** One certificate as PDF bytes: render, then write code and date into the file properties. */
export async function createCertificatePdf(
  data: CertificateData,
  branding: Branding = NO_BRANDING,
): Promise<Buffer> {
  const raw = await renderPdf(buildCertificateHtml(data, branding));
  return stampMetadata(raw, data.certCode, data.createdAt);
}

/** The same certificate as a PNG image (2x). */
export function createCertificatePng(
  data: CertificateData,
  branding: Branding = NO_BRANDING,
): Promise<Buffer> {
  return renderPng(buildCertificateHtml(data, branding));
}
