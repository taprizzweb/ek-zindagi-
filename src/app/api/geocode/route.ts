import { requireApiUser } from '@/lib/auth/session';
import { round3 } from '@/lib/domain/geo';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { reverseGeocodeGoogle } from '@/lib/geo/google';
import { reverseGeocodeOsm } from '@/lib/geo/osm';
import { handle, json } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { geocodeQuerySchema } from '@/lib/validation/entry';
import { isInIndia } from '@/lib/domain/geo';

/** Place name for the officer's GPS position, so the form can show it before sending. */
export async function GET(request: Request) {
  return handle(async () => {
    const actor = await requireApiUser({ roles: ['officer', 'supervisor'] });
    const url = new URL(request.url);
    const { lat, lng } = geocodeQuerySchema.parse(Object.fromEntries(url.searchParams));
    if (!isInIndia(lat, lng)) throw new AppError('bad_request', 400);

    const env = serverEnv();
    const useGoogle = env.GEOCODER === 'google' && Boolean(env.GOOGLE_MAPS_API_KEY);
    if (!useGoogle && env.GEOCODER !== 'osm') {
      return json({ areaName: null, provider: 'none' });
    }
    const { data: allowed, error } = await createAdminClient().rpc('rate_limit_hit', {
      p_key: `geocode:officer:${actor.id}:h`,
      p_window_seconds: 3600,
      p_max_hits: 300,
    });
    if (error) throw new AppError('internal', 500);
    if (!allowed) throw new AppError('rate_limited', 429);

    if (useGoogle) {
      const areaName = await reverseGeocodeGoogle(
        round3(lat),
        round3(lng),
        env.GOOGLE_MAPS_API_KEY!,
      );
      return json({ areaName, provider: 'google' });
    }
    const areaName = await reverseGeocodeOsm(
      round3(lat),
      round3(lng),
      `EK-ZINDAGI/1.0 (road safety awareness campaign; ${env.APP_BASE_URL})`,
    );
    return json({ areaName, provider: 'osm' });
  });
}
