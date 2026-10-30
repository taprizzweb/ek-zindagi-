import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { supabaseWebhookPorts } from '@/lib/delivery/delivery-store-supabase';
import { MAX_WEBHOOK_BYTES, handleWebhook, verifyChallenge } from '@/lib/delivery/whatsapp/webhook';
import { hashPhone } from '@/lib/domain/phone-hash';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';

/** Meta's one-time setup request: echo the challenge if the verify token matches. */
export async function GET(request: Request) {
  const env = serverEnv();
  if (env.DELIVERY_MODE !== 'cloud_api' || !env.WHATSAPP_VERIFY_TOKEN)
    return new Response('not found', { status: 404 });
  const challenge = verifyChallenge(new URL(request.url).searchParams, env.WHATSAPP_VERIFY_TOKEN);
  return challenge
    ? new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
      })
    : new Response('forbidden', { status: 403 });
}

/**
 * Status reports and replies from WhatsApp. Server to server: the signature on the raw body is the only
 * credential (no session, no origin check). Always answers 200 once the signature is good, so Meta does not
 * keep retrying a body we have already handled.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const env = serverEnv();
    if (env.DELIVERY_MODE !== 'cloud_api' || !env.WHATSAPP_APP_SECRET)
      throw new AppError('not_found', 404);
    if (Number(request.headers.get('content-length') ?? '0') > MAX_WEBHOOK_BYTES)
      throw new AppError('bad_request', 413);
    const raw = Buffer.from(await request.arrayBuffer());
    const admin = createAdminClient();
    await handleWebhook(
      {
        ports: supabaseWebhookPorts(admin),
        audit: supabaseAuditSink(admin),
        appSecret: env.WHATSAPP_APP_SECRET,
        hashPhone: (e164) => hashPhone(e164, env.PHONE_HASH_SECRET),
        expectedCategory: env.WHATSAPP_TEMPLATE_CATEGORY,
      },
      raw,
      request.headers.get('x-hub-signature-256'),
    );
    return json({ ok: true });
  });
}
