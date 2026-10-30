/** Counts for the supervisor screens and the CSV. Nothing here holds a name, number or photo. */

export interface StatRow {
  day: string; // YYYY-MM-DD, India time
  officerId: string;
  violation: string;
  created: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  linkOpened: number;
}

export type Range = 'today' | 'week';
export const RANGES: readonly Range[] = ['today', 'week'];

const IST_OFFSET_MS = 330 * 60_000;

/** Start of the India-time day containing `now`, as a UTC instant. */
export function istDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

/** "today" is the India-time day so far; "week" is the last seven India-time days including today. */
export function rangeFor(range: Range, now: Date): { since: Date; until: Date } {
  const start = istDayStart(now);
  const since = range === 'today' ? start : new Date(start.getTime() - 6 * 86_400_000);
  return { since, until: new Date(now.getTime() + 1000) };
}

export interface Totals {
  created: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  linkOpened: number;
}

const zero = (): Totals => ({
  created: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  linkOpened: 0,
});

export function addTo(t: Totals, r: StatRow): void {
  t.created += r.created;
  t.sent += r.sent;
  t.delivered += r.delivered;
  t.read += r.read;
  t.failed += r.failed;
  t.linkOpened += r.linkOpened;
}

export function groupBy(
  rows: readonly StatRow[],
  key: (r: StatRow) => string,
): Map<string, Totals> {
  const m = new Map<string, Totals>();
  for (const r of rows) {
    const k = key(r);
    const t = m.get(k) ?? zero();
    addTo(t, r);
    m.set(k, t);
  }
  return m;
}

export function totalOf(rows: readonly StatRow[]): Totals {
  const t = zero();
  for (const r of rows) addTo(t, r);
  return t;
}

/** A spreadsheet treats a cell starting with = + - @ as a formula: neutralise it. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = [
  'date',
  'officer_code',
  'violation',
  'created',
  'sent',
  'delivered',
  'read',
  'failed',
  'link_opened',
] as const;

/** Counts only: the columns are fixed, so personal data cannot get in. */
export function statsToCsv(rows: readonly StatRow[], officerCode: (id: string) => string): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.day,
        officerCode(r.officerId),
        r.violation,
        r.created,
        r.sent,
        r.delivered,
        r.read,
        r.failed,
        r.linkOpened,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export const REVIEW_REASONS = [
  'gallery',
  'manual_location',
  'no_consent',
  'repeated_number',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const REVIEW_REASON_LABEL: Record<ReviewReason, { hi: string; en: string }> = {
  gallery: { hi: 'गैलरी से फ़ोटो', en: 'Photo from gallery' },
  manual_location: { hi: 'स्थान हाथ से लिखा', en: 'Location typed by hand' },
  no_consent: { hi: 'सहमति नहीं चुनी', en: 'Consent box not ticked' },
  repeated_number: { hi: 'वही नंबर दोबारा', en: 'Same number again' },
};
