import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import type { EntryPorts, ExistingEntry } from './create-entry';

function fail(): never {
  throw new AppError('internal', 500);
}

export function supabaseEntryPorts(admin: SupabaseClient): EntryPorts {
  return {
    async findByRequestId(officerId, requestId) {
      const { data, error } = await admin
        .from('entries')
        .select('id, cert_code, status, created_at')
        .eq('officer_id', officerId)
        .eq('client_request_id', requestId)
        .maybeSingle();
      if (error) fail();
      if (!data) return null;
      const r = data as { id: string; cert_code: string; status: string; created_at: string };
      return {
        id: r.id,
        certCode: r.cert_code,
        status: r.status,
        createdAt: r.created_at,
      } satisfies ExistingEntry;
    },
    async isOptedOut(phoneHash) {
      const { data, error } = await admin
        .from('opt_outs')
        .select('phone_hash')
        .eq('phone_hash', phoneHash)
        .maybeSingle();
      if (error) fail();
      return data !== null;
    },
    async hasRecentEntry(phoneHash, sinceIso) {
      const { count, error } = await admin
        .from('entries')
        .select('id', { count: 'exact', head: true })
        .eq('phone_hash', phoneHash)
        .gte('created_at', sinceIso);
      if (error) fail();
      return (count ?? 0) > 0;
    },
    async uploadPhoto(entryId, jpeg) {
      const path = `${entryId}.jpg`;
      const { error } = await admin.storage.from('photos').upload(path, jpeg, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (error) fail();
      return path;
    },
    async deletePhoto(path) {
      await admin.storage.from('photos').remove([path]);
    },
    async insertEntry(row) {
      const { data, error } = await admin
        .from('entries')
        .insert({
          id: row.id,
          cert_code: row.certCode,
          officer_id: row.officerId,
          client_request_id: row.clientRequestId,
          violation: row.violation,
          other_text: row.otherText,
          area_name: row.areaName,
          lat: row.lat,
          lng: row.lng,
          location_source: row.locationSource,
          photo_source: row.photoSource,
          gallery_reason: row.galleryReason,
          consent_checked: row.consentChecked,
          phone_hash: row.phoneHash,
          person_name: row.personName,
          phone_e164: row.phoneE164,
          photo_path: row.photoPath,
          expires_at: row.expiresAt,
          status: 'saved',
        })
        .select('created_at')
        .single();
      if (error) {
        if (error.code === '23505') {
          // Postgres names the violated constraint in the message.
          return {
            ok: false,
            conflict: error.message.includes('entries_officer_request_key')
              ? 'request'
              : 'cert_code',
          };
        }
        fail();
      }
      return { ok: true, createdAt: (data as { created_at: string }).created_at };
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
