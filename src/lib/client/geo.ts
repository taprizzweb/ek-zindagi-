export type GeoResult =
  | { ok: true; lat: number; lng: number; accuracy: number }
  | { ok: false; reason: 'denied' | 'unavailable' | 'timeout' | 'unsupported' };

/** Good enough to name a street: stop waiting for a better fix. */
const GOOD_ENOUGH_M = 30;

/**
 * A GPS fix. The first reading a phone gives is often a rough one (towers or a cached spot, sometimes
 * kilometres off), so this listens for up to `timeoutMs` and keeps the most accurate reading, stopping
 * early once it is within 30 m. If the GPS chip gives nothing at all (indoors, weak sky) it asks once more
 * for the network position, which is rougher; `accuracy` (metres) tells the caller how rough.
 */
export async function getPosition(timeoutMs = 15_000): Promise<GeoResult> {
  const first = await watchBest(timeoutMs);
  if (first.ok || first.reason === 'denied' || first.reason === 'unsupported') return first;
  const second = await getPositionOnce(8_000);
  return second.ok ? second : first;
}

function watchBest(timeoutMs: number): Promise<GeoResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }
  return new Promise((resolve) => {
    let best: GeoResult | null = null;
    let lastError: GeoResult = { ok: false, reason: 'timeout' };
    let done = false;
    let id = -1;
    // eslint-disable-next-line prefer-const -- finish() reads it before the line below assigns it
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: GeoResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      navigator.geolocation.clearWatch(id);
      resolve(r);
    };
    id = navigator.geolocation.watchPosition(
      (p) => {
        const here: GeoResult = {
          ok: true,
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        };
        if (!best || !best.ok || p.coords.accuracy < best.accuracy) best = here;
        if (p.coords.accuracy <= GOOD_ENOUGH_M) finish(here);
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) finish({ ok: false, reason: 'denied' });
        else lastError = { ok: false, reason: e.code === e.TIMEOUT ? 'timeout' : 'unavailable' };
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
    timer = setTimeout(() => finish(best ?? lastError), timeoutMs);
  });
}

function getPositionOnce(timeoutMs: number): Promise<GeoResult> {
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
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
