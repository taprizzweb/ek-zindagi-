import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { AppError } from '@/lib/errors';
import { loadSettings } from '@/lib/settings/settings-store-supabase';
import { serverEnv } from '@/lib/env';
import { prepareBridgeDelivery } from './bridge';
import { sendViaCloudApi, type CloudDeps } from './cloud';
import { supabaseBridgePorts, supabaseCloudPorts } from './delivery-store-supabase';
import type { DeliveryProvider } from './provider';
import { newLinkToken } from './token';
import { WhatsAppClient, type WhatsAppConfig } from './whatsapp/client';

type Env = ReturnType<typeof serverEnv>;

export function whatsappConfig(env: Env): WhatsAppConfig {
  if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_TOKEN || !env.WHATSAPP_TEMPLATE_NAME) {
    throw new AppError('internal', 500, 'WhatsApp is not configured');
  }
  return {
    baseUrl: env.WHATSAPP_API_BASE,
    apiVersion: env.WHATSAPP_API_VERSION,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    token: env.WHATSAPP_TOKEN,
    templateName: env.WHATSAPP_TEMPLATE_NAME,
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE,
  };
}

export function cloudDeps(admin: SupabaseClient, env: Env): CloudDeps {
  return {
    ports: supabaseCloudPorts(admin),
    audit: supabaseAuditSink(admin),
    wa: new WhatsAppClient(whatsappConfig(env)),
    language: env.MESSAGE_LANGUAGE,
    paused: async () => (await loadSettings(admin)).campaignPaused,
    maxPerOfficerHour: env.ENTRY_MAX_PER_OFFICER_HOUR,
    inlineAttempts: 3,
    maxTotalAttempts: env.DELIVERY_RETRY_MAX_ATTEMPTS,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
  };
}

/** The provider for the configured DELIVERY_MODE. The kill switch (the CAMPAIGN_PAUSED variable or the saved setting) stops both. */
export function createDeliveryProvider(admin: SupabaseClient, env: Env): DeliveryProvider {
  if (env.DELIVERY_MODE === 'cloud_api') {
    const deps = cloudDeps(admin, env);
    return {
      mode: 'cloud_api',
      async send(i) {
        const r = await sendViaCloudApi(deps, i.entryId, i.actor, i.onlyOfficerId);
        return { mode: 'cloud_api', status: r.status, alreadySent: r.alreadySent };
      },
    };
  }
  return {
    mode: 'bridge',
    async send(i) {
      if ((await loadSettings(admin)).campaignPaused) throw new AppError('campaign_paused', 503);
      const r = await prepareBridgeDelivery(
        {
          ports: supabaseBridgePorts(admin),
          audit: supabaseAuditSink(admin),
          baseUrl: env.APP_BASE_URL,
          language: env.MESSAGE_LANGUAGE,
          maxPerOfficerHour: env.ENTRY_MAX_PER_OFFICER_HOUR,
          newToken: () => newLinkToken(),
          now: () => new Date(),
        },
        i.entryId,
        i.actor,
        i.onlyOfficerId,
      );
      return { mode: 'bridge', waUrl: r.waUrl, expiresAt: r.expiresAt };
    },
  };
}
