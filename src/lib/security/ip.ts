/** First hop of x-forwarded-for (set by the platform proxy). */
export function clientIp(headers: { get(name: string): string | null }): string {
  const xff = headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first && first.length <= 45 ? first : 'unknown';
}
