import { z } from 'zod';
import { supabaseTeamStore } from '@/lib/admin/officer-store-supabase';
import { createTeam } from '@/lib/admin/teams';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';

const body = z.strictObject({
  label: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[\p{L}\p{M}\p{N} .,'’()/-]+$/u),
});

/** A new team and its link. The link is shown once: only its hash is stored. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['admin'] });
    const { label } = body.parse(await readJson(request));
    const admin = createAdminClient();
    const t = await createTeam(
      { store: supabaseTeamStore(admin), audit: supabaseAuditSink(admin) },
      actor,
      label,
    );
    return json(
      {
        id: t.id,
        officerCode: t.officerCode,
        link: `${serverEnv().APP_BASE_URL.replace(/\/+$/, '')}/go/${t.token}`,
      },
      201,
    );
  });
}
