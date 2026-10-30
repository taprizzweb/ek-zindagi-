import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ViolationKey } from '@/config/violations';
import { AppError } from '@/lib/errors';
import type { BridgePorts } from './bridge';
import type { LinkPorts } from './link';

function fail(): never {
  throw new AppError('internal', 500);
}

async function rateLimit(
  admin: SupabaseClient,
  key: string,
  windowSeconds: number,
  maxHits: number,
) {
  const { data, error } = await admin.rpc('rate_limit_hit', {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max_hits: maxHits,
  });
  if (error) fail();
  return data === true;
}

export function supabaseBridgePorts(admin: SupabaseClient): BridgePorts {
  return {
    async loadForSend(entryId) {
      const { data, error } = await admin
        .from('entries')
        .select(
          'officer_id, status, purged_at, phone_e164, phone_hash, person_name, violation, cert_code, pdf_path',
        )
        .eq('id', entryId)
        .maybeSingle();
      if (error) fail();
      if (!data) return null;
      const r = data as {
        officer_id: string;
        status: string;
        purged_at: string | null;
        phone_e164: string | null;
        phone_hash: string | null;
        person_name: string | null;
        violation: ViolationKey;
        cert_code: string;
        pdf_path: string | null;
      };
      return {
        officerId: r.officer_id,
        status: r.status,
        purged: r.purged_at !== null,
        phoneE164: r.phone_e164,
        phoneHash: r.phone_hash,
        personName: r.person_name,
        violation: r.violation,
        certCode: r.cert_code,
        pdfPath: r.pdf_path,
      };
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
    rateLimit: (k, w, m) => rateLimit(admin, k, w, m),
    async createLink(entryId, tokenHash, expiresAt) {
      const { error } = await admin
        .from('cert_links')
        .insert({ entry_id: entryId, token_hash: tokenHash, expires_at: expiresAt.toISOString() });
      if (error) fail();
    },
    async markHandedOver(entryId) {
      const { error } = await admin
        .from('entries')
        .update({ status: 'sent', delivery_mode: 'bridge', sent_at: new Date().toISOString() })
        .eq('id', entryId)
        .in('status', ['ready', 'sent']);
      if (error) fail();
    },
  };
}

export function supabaseLinkPorts(admin: SupabaseClient): LinkPorts {
  return {
    rateLimit: (k, w, m) => rateLimit(admin, k, w, m),
    async open(tokenHash) {
      const { data, error } = await admin.rpc('open_certificate_link', { p_token_hash: tokenHash });
      if (error) fail();
      const row = (
        data as { status: 'ok' | 'expired' | 'gone'; pdf_path: string | null }[] | null
      )?.[0];
      return row ? { status: row.status, pdfPath: row.pdf_path } : null;
    },
    async downloadPdf(path) {
      const { data, error } = await admin.storage.from('pdfs').download(path);
      if (error || !data) fail();
      return Buffer.from(await data.arrayBuffer());
    },
  };
}
