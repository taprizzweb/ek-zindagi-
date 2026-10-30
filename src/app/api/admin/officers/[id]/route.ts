import { resetOfficerPassword, setOfficerActive } from '@/lib/admin/officers';
import { supabaseOfficerStore } from '@/lib/admin/officer-store-supabase';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';
import { updateOfficerSchema, uuidSchema } from '@/lib/validation/officer';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['admin'] });
    const parsedId = uuidSchema.safeParse((await ctx.params).id);
    if (!parsedId.success) throw new AppError('not_found', 404);
    const { action } = updateOfficerSchema.parse(await readJson(request));
    const admin = createAdminClient();
    const deps = { store: supabaseOfficerStore(admin), audit: supabaseAuditSink(admin) };

    if (action === 'reset_password') {
      const { tempPassword } = await resetOfficerPassword(deps, actor, parsedId.data);
      return json({ tempPassword });
    }
    await setOfficerActive(deps, actor, parsedId.data, action === 'enable');
    return json({ ok: true });
  });
}
