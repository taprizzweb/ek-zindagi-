import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { prepareBridgeDelivery } from '@/lib/delivery/bridge';
import { supabaseBridgePorts } from '@/lib/delivery/delivery-store-supabase';
import { newLinkToken } from '@/lib/delivery/token';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/officer';

/**
 * "Send on WhatsApp". In bridge mode this makes the 24-hour link and returns the wa.me address for the
 * officer's phone to open. Cloud API delivery is milestone 5.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['officer', 'supervisor'] });
    const id = uuidSchema.safeParse((await ctx.params).id);
    if (!id.success) throw new AppError('not_found', 404);

    const env = serverEnv();
    if (env.DELIVERY_MODE !== 'bridge') throw new AppError('not_implemented', 501);

    const admin = createAdminClient();
    const result = await prepareBridgeDelivery(
      {
        ports: supabaseBridgePorts(admin),
        audit: supabaseAuditSink(admin),
        baseUrl: env.APP_BASE_URL,
        language: env.MESSAGE_LANGUAGE,
        maxPerOfficerHour: env.ENTRY_MAX_PER_OFFICER_HOUR,
        newToken: () => newLinkToken(),
        now: () => new Date(),
      },
      id.data,
      actor,
      actor.id,
    );
    return json({ mode: 'bridge', waUrl: result.waUrl, expiresAt: result.expiresAt });
  });
}
