import { z } from 'zod';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { purgeEntryNow } from '@/lib/data-requests/data-requests';
import { supabaseDataRequestPorts } from '@/lib/data-requests/data-requests-store-supabase';
import { hashPhone } from '@/lib/domain/phone-hash';
import { serverEnv } from '@/lib/env';
import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';

const body = z.strictObject({ certCode: z.string().min(1).max(40) });

/** "Delete my data now": by the code printed on the certificate. Supervisor or admin. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['supervisor', 'admin'] });
    const { certCode } = body.parse(await readJson(request));
    const admin = createAdminClient();
    const env = serverEnv();
    const result = await purgeEntryNow(
      {
        ports: supabaseDataRequestPorts(admin),
        audit: supabaseAuditSink(admin),
        hashPhone: (e164) => hashPhone(e164, env.PHONE_HASH_SECRET),
      },
      actor,
      certCode,
    );
    return json(result);
  });
}
