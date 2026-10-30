/**
 * Indian mobile number to E.164 (+91XXXXXXXXXX), or null.
 * Accepts 10 digits, with an optional 0, 91 or +91 in front and spaces or dashes inside.
 */
export function normalizeIndianMobile(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;
  let digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (compact.startsWith('+') && !digits.startsWith('91')) return null;
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/** "98765 43210" for the confirm-the-number screen. */
export function formatTenDigits(ten: string): string {
  return ten.length === 10 ? `${ten.slice(0, 5)} ${ten.slice(5)}` : ten;
}
