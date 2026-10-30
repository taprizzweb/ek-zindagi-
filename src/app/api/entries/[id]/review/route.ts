import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/officer';

/** A supervisor marks an entry as looked at. It leaves the review list; who and when are recorded. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['supervisor', 'admin'] });
    const id = uuidSchema.safeParse((await ctx.params).id);
    if (!id.success) throw new AppError('not_found', 404);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('mark_reviewed', {
      p_entry_id: id.data,
      p_by: actor.id,
    });
    if (error) throw new AppError('internal', 500, 'review failed');
    if (data !== true) throw new AppError('not_found', 404);
    await supabaseAuditSink(admin).record({
      action: 'entry_reviewed',
      actorId: actor.id,
      actorCode: actor.officerCode,
      entryId: id.data,
    });
    return json({ reviewed: true });
  });
}
