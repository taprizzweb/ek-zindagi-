import { createOfficer } from '@/lib/admin/officers';
import { supabaseOfficerStore } from '@/lib/admin/officer-store-supabase';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';
import { createOfficerSchema } from '@/lib/validation/officer';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['admin'] });
    const input = createOfficerSchema.parse(await readJson(request));
    const admin = createAdminClient();
    const created = await createOfficer(
      { store: supabaseOfficerStore(admin), audit: supabaseAuditSink(admin) },
      actor,
      input,
    );
    return json(
      {
        id: created.id,
        officerCode: created.officerCode,
        email: input.email,
        tempPassword: created.tempPassword,
      },
      201,
    );
  });
}
