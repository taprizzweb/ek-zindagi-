import { round3 } from '@/lib/domain/geo';
import { isPrintablePlace } from '@/lib/domain/text';
import type { FetchLike } from './google';

interface NominatimResponse {
  address?: Record<string, string | undefined>;
}

const AREA_KEYS = ['suburb', 'neighbourhood', 'quarter', 'city_district', 'residential', 'road'];
const CITY_KEYS = ['city', 'town', 'village', 'municipality', 'county', 'state_district'];

/** "Area, City, State" from an OpenStreetMap (Nominatim) answer, or null when nothing usable came back. */
export function parseNominatim(body: unknown): string | null {
  const a = (body as NominatimResponse)?.address;
  if (!a || typeof a !== 'object') return null;
  const pick = (keys: string[]) =>
    keys.map((k) => a[k]).find((v) => typeof v === 'string' && v.trim());
  const parts = [pick(AREA_KEYS), pick(CITY_KEYS), a.state]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => p.trim());
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  const name = unique.join(', ').slice(0, 120);
  // A name the certificate cannot print is dropped; the officer types the place instead.
  return name.length >= 2 && isPrintablePlace(name) ? name : null;
}

/**
 * Reverse geocoding with OpenStreetMap's free Nominatim service. Needs no key. Its usage policy asks for light use
 * (one request a second at most) and an identifying User-Agent: fine for a pilot of a few hundred a week; for
 * more, switch GEOCODER to google. Coordinates are rounded to 3 decimals (about 110 m) before they leave the server.
 */
export async function reverseGeocodeOsm(
  lat: number,
  lng: number,
  userAgent: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const url =
    'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&accept-language=en' +
    `&lat=${round3(lat)}&lon=${round3(lng)}`;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return parseNominatim(await res.json());
  } catch {
    return null;
  }
}
