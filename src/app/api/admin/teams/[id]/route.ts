import { z } from 'zod';
import { supabaseTeamStore } from '@/lib/admin/officer-store-supabase';
import { changeTeamLink, setTeamActive } from '@/lib/admin/teams';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/officer';

const body = z.strictObject({ action: z.enum(['new_link', 'disable', 'enable']) });

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['admin'] });
    const id = uuidSchema.safeParse((await ctx.params).id);
    if (!id.success) throw new AppError('not_found', 404);
    const { action } = body.parse(await readJson(request));
    const admin = createAdminClient();
    const deps = { store: supabaseTeamStore(admin), audit: supabaseAuditSink(admin) };
    if (action === 'new_link') {
      const { token } = await changeTeamLink(deps, actor, id.data);
      return json({ link: `${serverEnv().APP_BASE_URL.replace(/\/+$/, '')}/go/${token}` });
    }
    await setTeamActive(deps, actor, id.data, action === 'enable');
    return json({ ok: true });
  });
}
