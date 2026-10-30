import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ViolationKey } from '@/config/violations';
import { AppError } from '@/lib/errors';
import type { BridgePorts } from './bridge';
import type { CloudPorts } from './cloud';
import type { LinkPorts } from './link';
import type { WebhookPorts } from './whatsapp/webhook';

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

export function supabaseCloudPorts(admin: SupabaseClient): CloudPorts {
  const bridge = supabaseBridgePorts(admin);
  return {
    loadForSend: bridge.loadForSend,
    isOptedOut: bridge.isOptedOut,
    rateLimit: bridge.rateLimit,
    async claim(entryId) {
      const { data, error } = await admin.rpc('claim_send', { p_entry_id: entryId });
      if (error) fail();
      const r = (
        data as
          | {
              claimed: boolean;
              status: string;
              purged: boolean;
              officer_id: string;
              phone_e164: string | null;
              phone_hash: string | null;
              person_name: string | null;
              violation: ViolationKey;
              cert_code: string;
              pdf_path: string | null;
              attempts: number;
            }[]
          | null
      )?.[0];
      if (!r) return null;
      return {
        claimed: r.claimed,
        status: r.status,
        purged: r.purged,
        officerId: r.officer_id,
        phoneE164: r.phone_e164,
        phoneHash: r.phone_hash,
        personName: r.person_name,
        violation: r.violation,
        certCode: r.cert_code,
        pdfPath: r.pdf_path,
        attempts: r.attempts,
      };
    },
    async downloadPdf(path) {
      const { data, error } = await admin.storage.from('pdfs').download(path);
      if (error || !data) fail();
      return Buffer.from(await data.arrayBuffer());
    },
    async complete(entryId, messageId, category) {
      const { data, error } = await admin.rpc('complete_send', {
        p_entry_id: entryId,
        p_message_id: messageId,
        p_category: category,
      });
      if (error) fail();
      return data === true;
    },
    async fail(entryId, code, retryable, nextRetryAt) {
      const { data, error } = await admin.rpc('fail_send', {
        p_entry_id: entryId,
        p_error: code,
        p_retryable: retryable,
        p_next_retry: nextRetryAt ? nextRetryAt.toISOString() : null,
      });
      if (error) fail();
      return data === true;
    },
    async dueRetries(limit, maxAttempts) {
      const { data, error } = await admin.rpc('due_retries', {
        p_limit: limit,
        p_max_attempts: maxAttempts,
      });
      if (error) fail();
      return (data as string[] | null) ?? [];
    },
    async markStale(ageMinutes) {
      const { data, error } = await admin.rpc('mark_stale_sends', {
        p_age: `${ageMinutes} minutes`,
      });
      if (error) fail();
      return Number(data ?? 0);
    },
  };
}

export function supabaseWebhookPorts(admin: SupabaseClient): WebhookPorts {
  return {
    async registerBody(hash) {
      const { data, error } = await admin.rpc('register_webhook', { p_hash: hash });
      if (error) fail();
      return data === true;
    },
    async applyStatus(s) {
      const { data, error } = await admin.rpc('apply_wa_status', {
        p_message_id: s.messageId,
        p_status: s.status,
        p_ts: s.at.toISOString(),
        p_error: s.errorCode,
        p_category: s.category,
      });
      if (error) fail();
      return data as 'applied' | 'ignored' | 'pending';
    },
    async addOptOut(phoneHash) {
      const { error } = await admin
        .from('opt_outs')
        .upsert({ phone_hash: phoneHash }, { onConflict: 'phone_hash', ignoreDuplicates: true });
      if (error) fail();
    },
  };
}
