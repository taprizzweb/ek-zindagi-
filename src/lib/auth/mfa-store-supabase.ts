import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import type { MfaPorts } from './mfa';

const fail = (): never => {
  throw new AppError('internal', 500, 'mfa store failed');
};

export function supabaseMfaPorts(admin: SupabaseClient): MfaPorts {
  return {
    async getFactor(profileId) {
      const { data, error } = await admin
        .from('totp_factors')
        .select('secret_enc, confirmed, last_counter')
        .eq('profile_id', profileId)
        .maybeSingle();
      if (error) fail();
      const r = data as {
        secret_enc: string;
        confirmed: boolean;
        last_counter: number | string;
      } | null;
      return r
        ? { secretEnc: r.secret_enc, confirmed: r.confirmed, lastCounter: Number(r.last_counter) }
        : null;
    },
    async createFactorIfAbsent(profileId, secretEnc) {
      const { error } = await admin
        .from('totp_factors')
        .upsert(
          { profile_id: profileId, secret_enc: secretEnc },
          { onConflict: 'profile_id', ignoreDuplicates: true },
        );
      if (error) fail();
    },
    async confirmFactor(profileId) {
      const { error } = await admin
        .from('totp_factors')
        .update({ confirmed: true, confirmed_at: new Date().toISOString() })
        .eq('profile_id', profileId);
      if (error) fail();
    },
    async acceptCounter(profileId, counter) {
      const { data, error } = await admin.rpc('totp_accept', {
        p_profile: profileId,
        p_counter: counter,
      });
      if (error) fail();
      return data === true;
    },
    async deleteFactor(profileId) {
      const { error } = await admin.from('totp_factors').delete().eq('profile_id', profileId);
      if (error) fail();
    },
    async rateLimit(key, windowSeconds, maxHits) {
      const { data, error } = await admin.rpc('rate_limit_hit', {
        p_key: key,
        p_window_seconds: windowSeconds,
        p_max_hits: maxHits,
      });
      if (error) fail();
      return data === true;
    },
  };
}
