export type GeoResult =
  | { ok: true; lat: number; lng: number; accuracy: number }
  | { ok: false; reason: 'denied' | 'unavailable' | 'timeout' | 'unsupported' };

/**
 * A GPS fix. First the accurate way (GPS chip); if that times out or is unavailable (indoors, weak sky), once more
 * with the network position (phone towers and Wi-Fi), which is rougher but usually arrives at once.
 */
export async function getPosition(timeoutMs = 10_000): Promise<GeoResult> {
  const first = await getPositionOnce(timeoutMs, true);
  if (first.ok || first.reason === 'denied' || first.reason === 'unsupported') return first;
  const second = await getPositionOnce(8_000, false);
  return second.ok ? second : first;
}

function getPositionOnce(timeoutMs: number, accurate: boolean): Promise<GeoResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          ok: true,
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (e) =>
        resolve({
          ok: false,
          reason:
            e.code === e.PERMISSION_DENIED
              ? 'denied'
              : e.code === e.TIMEOUT
                ? 'timeout'
                : 'unavailable',
        }),
      { enableHighAccuracy: accurate, timeout: timeoutMs, maximumAge: accurate ? 30_000 : 300_000 },
    );
  });
}
