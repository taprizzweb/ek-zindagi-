import { timingSafeEqual } from 'node:crypto';
import { cloudDeps } from '@/lib/delivery/factory';
import { retryDueDeliveries } from '@/lib/delivery/cloud';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 60;

function authorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Background pass, called by the scheduler (Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`).
 * Gives up on sends with an unknown outcome and retries transient failures that are due. Counts only in the answer.
 */
async function run(request: Request) {
  return handle(async () => {
    const env = serverEnv();
    if (env.DELIVERY_MODE !== 'cloud_api') throw new AppError('not_found', 404);
    if (!authorised(request.headers.get('authorization'), env.CRON_SECRET))
      throw new AppError('unauthenticated', 401);
    const report = await retryDueDeliveries(cloudDeps(createAdminClient(), env));
    return json(report);
  });
}

export const GET = run;
export const POST = run;
