import { z } from 'zod';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { addOptOutByNumber } from '@/lib/data-requests/data-requests';
import { supabaseDataRequestPorts } from '@/lib/data-requests/data-requests-store-supabase';
import { hashPhone } from '@/lib/domain/phone-hash';
import { serverEnv } from '@/lib/env';
import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';

const body = z.strictObject({ phone: z.string().min(1).max(30) });

/** "Do not message this number again". Only the hash of the number is stored. Supervisor or admin. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['supervisor', 'admin'] });
    const { phone } = body.parse(await readJson(request));
    const admin = createAdminClient();
    const env = serverEnv();
    await addOptOutByNumber(
      {
        ports: supabaseDataRequestPorts(admin),
        audit: supabaseAuditSink(admin),
        hashPhone: (e164) => hashPhone(e164, env.PHONE_HASH_SECRET),
      },
      actor,
      phone,
    );
    return json({ optedOut: true });
  });
}
