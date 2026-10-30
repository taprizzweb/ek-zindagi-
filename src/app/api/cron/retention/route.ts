import { timingSafeEqual } from 'node:crypto';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { runRetention } from '@/lib/retention/retention';
import { supabaseRetentionPorts } from '@/lib/retention/retention-store-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 60;

function authorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Deletes expired personal data (see runRetention). Called every hour by the scheduler with
 * `Authorization: Bearer $CRON_SECRET`; refuses everything when CRON_SECRET is not set. Counts only in the answer.
 */
async function run(request: Request) {
  return handle(async () => {
    const env = serverEnv();
    if (!authorised(request.headers.get('authorization'), env.CRON_SECRET))
      throw new AppError('unauthenticated', 401);
    const admin = createAdminClient();
    return json(await runRetention(supabaseRetentionPorts(admin), supabaseAuditSink(admin)));
  });
}

export const GET = run;
export const POST = run;
