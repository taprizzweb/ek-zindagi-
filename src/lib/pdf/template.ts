import { CERTIFICATE_TEXT as T } from '@/config/certificate';
import { violationByKey, type ViolationKey } from '@/config/violations';
import { fontFaceCss } from './fonts';
import { garlandSvg } from './garland';

export interface CertificateData {
  certCode: string;
  name: string;
  violation: ViolationKey;
  /** Text for an "other" violation (a listed choice or what the officer typed). */
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

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "30 Oct 2026, 03:21 PM" in Indian Standard Time. */
export function formatCertificateDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

/** Long names shrink instead of overflowing the page. */
export function nameFontPt(name: string): number {
  const n = [...name].length;
  if (n <= 18) return 22;
  if (n <= 26) return 18;
  if (n <= 34) return 15;
  return 13;
}

function placeFontPt(place: string): number {
  const n = [...place].length;
  return n <= 40 ? 11 : n <= 70 ? 10 : 9;
}

const SILHOUETTE =
  '<svg viewBox="0 0 100 128"><rect width="100" height="128" fill="#d8d0bd"/><circle cx="50" cy="48" r="20" fill="#8f8776"/><path d="M12 128 Q14 82 50 80 Q86 82 88 128Z" fill="#8f8776"/></svg>';

function violationText(d: CertificateData): string {
  const v = violationByKey(d.violation);
  if (d.violation === 'other' && d.otherText) return `${v.en}: ${d.otherText}`;
  return v.en;
}

function css(): string {
  return `
@page { size: A4; margin: 0; }
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:210mm;height:297mm}
body{background:#f4ead2;font-family:"Noto Serif",serif;color:#2a1d12;position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.border1{position:absolute;inset:8mm;border:2.5mm double #5a3a1a}
.border2{position:absolute;inset:14mm;border:0.4mm solid #5a3a1a}
.content{position:absolute;inset:18mm 20mm;text-align:center}
.camp{font-size:9pt;letter-spacing:3px;color:#7a4a1a;margin-top:23mm}
.camp b{color:#9b1c1c}
h1{font-size:24pt;line-height:1.15;margin-top:4mm;color:#7d0f0f;letter-spacing:1px}
.sub{font-size:10pt;font-style:italic;margin-top:2mm;color:#5a3a1a}
.photo-wrap{position:relative;width:82mm;height:92mm;margin:0 auto 0}
.frame{position:absolute;left:10mm;top:8mm;width:62mm;height:76mm;padding:5mm;
 background:linear-gradient(135deg,#f3d98a 0%,#c9993f 22%,#8a5a1c 45%,#d9ae55 68%,#9a6a25 100%);
 box-shadow:0 1.2mm 2.5mm rgba(60,35,10,.45), inset 0 0 0 .5mm #5e3a10, inset 0 0 0 1mm #e8c872, inset 0 0 2mm rgba(0,0,0,.35)}
.frame::before{content:"";position:absolute;inset:1.6mm;border:2mm solid transparent;
 background:repeating-linear-gradient(45deg,rgba(94,58,16,.55) 0 .5mm,rgba(255,235,170,.5) .5mm 1mm) border-box;
 -webkit-mask:linear-gradient(#000 0 0) padding-box exclude,linear-gradient(#000 0 0) border-box;
 mask:linear-gradient(#000 0 0) padding-box exclude,linear-gradient(#000 0 0) border-box;opacity:.8}
.frame .inner{position:relative;width:100%;height:100%;background:#cfc6b3;overflow:hidden;
 box-shadow:0 0 0 .5mm #4a2c0a, inset 0 0 3mm rgba(0,0,0,.45), inset 0 0 0 .4mm #e8c872}
.frame .inner svg,.frame .inner img{width:100%;height:100%;display:block}
.frame .inner img{object-fit:cover;object-position:center 30%}
.corner{position:absolute;width:6mm;height:6mm;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff1b8,#c9993f 55%,#6b4310);box-shadow:0 .4mm .8mm rgba(0,0,0,.5)}
.corner.tl{left:-1.4mm;top:-1.4mm}.corner.tr{right:-1.4mm;top:-1.4mm}.corner.bl{left:-1.4mm;bottom:-1.4mm}.corner.br{right:-1.4mm;bottom:-1.4mm}
.garland{position:absolute;inset:0}
.name{font-weight:bold;margin-top:1mm;letter-spacing:2px;text-transform:uppercase;overflow-wrap:anywhere;line-height:1.2;max-height:20mm}
.rule{width:60mm;height:0.4mm;background:#5a3a1a;margin:3mm auto}
table{margin:2mm auto 0;width:140mm;border-collapse:collapse;font-size:11pt;text-align:left}
td{padding:1.7mm 2mm;border-bottom:0.3mm solid #b8a37c;vertical-align:top}
td:first-child{width:42mm;color:#7a4a1a;font-size:9pt;letter-spacing:1.5px;text-transform:uppercase}
td:last-child{font-weight:bold;overflow-wrap:anywhere}
.msg{margin-top:5mm;font-size:12.5pt;font-style:italic;line-height:1.5;color:#3b1a1a}
.hi{margin-top:2mm;font-size:12pt;color:#7d0f0f;font-weight:bold}
.disc{margin:4mm auto 0;width:150mm;font-size:8pt;line-height:1.4;color:#5a3a1a;border:0.3mm dashed #7a4a1a;padding:2mm 3mm}
.footer{position:absolute;left:0;right:0;bottom:0;height:13mm;display:flex;justify-content:space-between;align-items:center;font-size:8pt;color:#5a3a1a}
.logo{width:34mm;height:13mm;display:flex;align-items:center;justify-content:center}
.logo img{max-width:100%;max-height:100%;object-fit:contain}
.mid{font-size:8.5pt;letter-spacing:1px;line-height:1.5}
.wm{position:absolute;left:0;top:138mm;width:210mm;text-align:center;transform:rotate(-30deg);font-size:14pt;font-weight:bold;letter-spacing:4px;color:rgba(125,15,15,0.09);white-space:nowrap;line-height:1.8}
.stamp{position:absolute;right:19mm;top:19mm;transform:rotate(12deg);border:0.8mm solid #9b1c1c;color:#9b1c1c;padding:1.5mm 3mm;font-size:8pt;font-weight:bold;letter-spacing:1px;text-align:center;line-height:1.3;background:rgba(244,234,210,.8)}
.ref{position:absolute;left:21mm;top:21mm;font-size:8pt;text-align:left;color:#5a3a1a;line-height:1.5}
`;
}

/** Builds the complete, self-contained HTML of one certificate. */
export function buildCertificateHtml(d: CertificateData, branding: Branding = NO_BRANDING): string {
  const v = violationByKey(d.violation);
  const code = escapeHtml(d.certCode);
  const photo = d.photoJpeg
    ? `<img alt="" src="data:image/jpeg;base64,${d.photoJpeg.toString('base64')}">`
    : SILHOUETTE;

  const footerLines = [
    escapeHtml(T.footerCampaign),
    ...(branding.showPolice ? [escapeHtml(T.policeLine)] : []),
    ...(branding.partnerCreditText
      ? [`Technology Partner: ${escapeHtml(branding.partnerCreditText)}`]
      : []),
  ];
  const ngoLogo = branding.ngoLogoDataUri
    ? `<img alt="" src="${escapeHtml(branding.ngoLogoDataUri)}">`
    : '';
  const policeLogo =
    branding.showPolice && branding.policeLogoDataUri
      ? `<img alt="" src="${escapeHtml(branding.policeLogoDataUri)}">`
      : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${code}</title>
<style>${fontFaceCss()}${css()}</style></head><body>
<div class="border1"></div><div class="border2"></div>
<div class="wm">FOR AWARENESS PURPOSE ONLY<br>NOT A LEGAL DOCUMENT</div>
<div class="stamp">FOR AWARENESS<br>PURPOSE ONLY<br>(HYPOTHETICAL)</div>
<div class="ref">REF NO.<br><b>${code}</b></div>
<div class="content">
 <div class="camp">PROJECT <b>EK ZINDAGI</b> &nbsp;•&nbsp; ${escapeHtml(T.campaignSuffix)}</div>
 <h1>${escapeHtml(T.headline[0])}<br>${escapeHtml(T.headline[1])}</h1>
 <div class="sub">${escapeHtml(T.subtitle)}</div>
 <div class="photo-wrap">
  <div class="frame"><div class="inner">${photo}</div><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i></div>
  ${garlandSvg()}
 </div>
 <div class="name" style="font-size:${nameFontPt(d.name)}pt${/\p{Script=Devanagari}/u.test(d.name) ? ';letter-spacing:0' : ''}">${escapeHtml(d.name)}</div>
 <div class="rule"></div>
 <table>
  <tr><td>Violation</td><td>${escapeHtml(violationText(d))}</td></tr>
  <tr><td>Date &amp; Time</td><td>${escapeHtml(formatCertificateDateTime(d.createdAt))}</td></tr>
  <tr><td>Last Seen</td><td style="font-size:${placeFontPt(d.areaName)}pt">${escapeHtml(d.areaName)}</td></tr>
  <tr><td>Certificate No.</td><td>${code}</td></tr>
 </table>
 <div class="msg">"${escapeHtml(T.quoteOpening)}<br>${escapeHtml(v.lineEn)}"</div>
 <div class="hi">${escapeHtml(T.hindiSlogan)}</div>
 <div class="disc"><b>Disclaimer:</b> This is a hypothetical road safety awareness illustration. It is not a death certificate, accident report or any legal or official record. No harm has occurred to the person named above.</div>
 <div class="footer">
  <div class="logo">${ngoLogo}</div>
  <div class="mid">${footerLines.join('<br>')}</div>
  <div class="logo">${policeLogo}</div>
 </div>
</div>
</body></html>`;
}
