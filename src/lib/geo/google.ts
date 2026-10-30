import { round3 } from '@/lib/domain/geo';
import { isPrintablePlace } from '@/lib/domain/text';

interface Component {
  long_name: string;
  types: string[];
}
interface GoogleGeocodeResponse {
  status?: string;
  results?: { address_components?: Component[] }[];
}

const AREA_TYPES = ['sublocality_level_1', 'sublocality', 'neighborhood', 'route'];

/** "Area, City, State" from a Google Geocoding response, or null when nothing usable came back. */
export function parseGoogleGeocode(body: unknown): string | null {
  const res = body as GoogleGeocodeResponse;
  if (res?.status !== 'OK' || !Array.isArray(res.results)) return null;
  const find = (types: string[]): string | null => {
    for (const r of res.results ?? []) {
      for (const t of types) {
        const hit = r.address_components?.find((c) => c.types.includes(t));
        if (hit) return hit.long_name;
      }
    }
    return null;
  };
  const parts = [
    find(AREA_TYPES),
    find(['locality']) ?? find(['administrative_area_level_2']),
    find(['administrative_area_level_1']),
  ].filter((p): p is string => Boolean(p));
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  const name = unique.join(', ').slice(0, 120);
  // A name the certificate cannot print is dropped; the officer types the place instead.
  return name.length >= 2 && isPrintablePlace(name) ? name : null;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Reverse geocoding with Google. Coordinates are rounded to 3 decimals before they leave the server. */
export async function reverseGeocodeGoogle(
  lat: number,
  lng: number,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?latlng=${round3(lat)},${round3(lng)}&language=en&key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return parseGoogleGeocode(await res.json());
  } catch {
    return null;
  }
}
