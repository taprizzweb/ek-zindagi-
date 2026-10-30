import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import Certificate from '@/components/certificate/Certificate';
import { formatDateParts, type CertificateView } from '@/components/certificate/certificate-data';
import { fitAll } from '@/components/certificate/fit';
import type { ViolationKey } from '@/config/violations';
import { fontFaceCss } from './fonts';

export interface CertificateData {
  certCode: string;
  name: string;
  violation: ViolationKey;
  /** Free text of an "other" violation. Kept in the record; the landscape design only ticks the box. */
  otherText?: string | null;
  areaName: string;
  createdAt: Date;
  /** Re-encoded JPEG. Without it the frame shows a neutral silhouette. */
  photoJpeg?: Buffer | null;
}

/** Optional extras. Police branding is ignored unless `showPolice` is true. */
export interface Branding {
  showPolice: boolean;
  ngoLogoDataUri?: string | null;
  policeLogoDataUri?: string | null;
  partnerCreditText?: string | null;
}

export const NO_BRANDING: Branding = { showPolice: false };

export function toCertificateView(
  d: CertificateData,
  branding: Branding = NO_BRANDING,
): CertificateView {
  const { dateText, timeText } = formatDateParts(d.createdAt);
  return {
    name: d.name,
    dateText,
    timeText,
    place: d.areaName,
    certNo: d.certCode,
    violation: d.violation,
    photoSrc: d.photoJpeg ? `data:image/jpeg;base64,${d.photoJpeg.toString('base64')}` : null,
    showPolice: branding.showPolice,
    policeLogoSrc: branding.showPolice ? (branding.policeLogoDataUri ?? null) : null,
    ngoLogoSrc: branding.ngoLogoDataUri ?? null,
    partnerCredit: branding.partnerCreditText ?? null,
  };
}

let css: string | null = null;
function certificateCss(): string {
  css ??= readFileSync(
    join(process.cwd(), 'src', 'components', 'certificate', 'certificate.css'),
    'utf8',
  );
  return css;
}

/**
 * The one script on the page, identical for every certificate and carrying no data: it waits for
 * the fonts, then runs the shared fit function. The renderer waits for body[data-fit-done].
 */
export function fitScript(): string {
  return (
    '(function(){var fit=' +
    fitAll.toString() +
    ';var done=function(){fit(document);document.body.setAttribute("data-fit-done","1")};' +
    'Promise.all([document.fonts.load("400 40px Anton"),document.fonts.load("italic 400 40px \\"Libre Baskerville\\""),' +
    'document.fonts.load("700 20px \\"Libre Baskerville\\""),document.fonts.load("400 20px \\"Libre Baskerville\\""),' +
    'document.fonts.load("400 40px \\"EKZ Deva\\"","क"),document.fonts.load("400 40px \\"EKZ Deva Bold\\"","क")]).then(done,done)})()'
  );
}

/** The complete, self-contained HTML page of one certificate (landscape, 1123 x 794 px). */
export function buildCertificateHtml(d: CertificateData, branding: Branding = NO_BRANDING): string {
  const markup = renderToStaticMarkup(<Certificate view={toCertificateView(d, branding)} />);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${d.certCode.replace(/[<>&"']/g, '')}</title>
<style>${fontFaceCss()}
@page{size:1123px 794px;margin:0}
*{margin:0;padding:0}
html,body{width:1123px;height:794px;background:#faf3e0}
${certificateCss()}</style></head><body>${markup}<script>${fitScript()}</script></body></html>`;
}
