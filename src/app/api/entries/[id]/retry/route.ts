import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { createDeliveryProvider } from '@/lib/delivery/factory';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { loadSettings } from '@/lib/settings/settings-store-supabase';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/officer';

export const maxDuration = 60;

/**
 * A supervisor sends a failed message again, from the failures list. Only while the PDF still exists
 * (after retention there is nothing left to send), and only in cloud API mode: in bridge mode the
 * officer's phone does the sending. The same one-message rules apply as for a first send.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['supervisor', 'admin'] });
    const id = uuidSchema.safeParse((await ctx.params).id);
    if (!id.success) throw new AppError('not_found', 404);
    const env = serverEnv();
    if (env.DELIVERY_MODE !== 'cloud_api') throw new AppError('not_ready', 409);

    const admin = createAdminClient();
    // Check first: a paused campaign must not quietly move the entry out of the failures list.
    if ((await loadSettings(admin)).campaignPaused) throw new AppError('campaign_paused', 503);
    const { data, error } = await admin.rpc('requeue_failed', { p_entry_id: id.data });
    if (error) throw new AppError('internal', 500, 'requeue failed');
    if (data !== true) throw new AppError('not_ready', 409); // not failed, or the data is already deleted
    await supabaseAuditSink(admin).record({
      action: 'delivery_retried',
      actorId: actor.id,
      actorCode: actor.officerCode,
      entryId: id.data,
    });
    const result = await createDeliveryProvider(admin, env).send({
      entryId: id.data,
      actor,
    });
    return json(result);
  });
}
