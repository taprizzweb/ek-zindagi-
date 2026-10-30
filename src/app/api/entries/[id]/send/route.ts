import { requireApiUser } from '@/lib/auth/session';
import { createDeliveryProvider } from '@/lib/delivery/factory';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/officer';

// A send can include a few retries with waits, so allow more than the default.
export const maxDuration = 60;

/**
 * "Send on WhatsApp". Bridge mode returns the wa.me address for the officer's phone to open; cloud API
 * mode sends the template message itself and returns the status. DELIVERY_MODE picks one, no code change.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['officer', 'supervisor'] });
    const id = uuidSchema.safeParse((await ctx.params).id);
    if (!id.success) throw new AppError('not_found', 404);

    const provider = createDeliveryProvider(createAdminClient(), serverEnv());
    const result = await provider.send({ entryId: id.data, actor, onlyOfficerId: actor.id });
    return json(result);
  });
}
