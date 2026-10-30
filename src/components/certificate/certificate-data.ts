import type { ViolationKey } from '@/config/violations';

/** Everything the Certificate component shows. The same object feeds the live preview and the PDF. */
export interface CertificateView {
  name: string;
  dateText: string; // "30 October 2026"
  timeText: string; // "04:12 PM"
  place: string;
  certNo: string;
  violation: ViolationKey;
  /** data: URI of the (already compressed) photo, or null for the silhouette. */
  photoSrc: string | null;
  showPolice: boolean;
  policeLogoSrc: string | null;
  ngoLogoSrc: string | null;
  partnerCredit: string | null;
}

/** Date and time in Indian Standard Time, e.g. { dateText: "30 October 2026", timeText: "04:12 PM" }. */
export function formatDateParts(d: Date): { dateText: string; timeText: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    dateText: `${get('day')} ${get('month')} ${get('year')}`,
    timeText: `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`,
  };
}
