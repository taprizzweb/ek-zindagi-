import { z } from 'zod';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { supabaseSettingsStore } from '@/lib/settings/settings-store-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

const body = z.strictObject({ paused: z.boolean() });

/** The kill switch from the screen: a supervisor or admin stops (or resumes) all sending. */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['supervisor', 'admin'] });
    const { paused } = body.parse(await readJson(request));
    const admin = createAdminClient();
    await supabaseSettingsStore(admin).save({ key: 'campaign_paused', value: paused }, actor.id);
    await supabaseAuditSink(admin).record({
      action: paused ? 'campaign_paused' : 'campaign_resumed',
      actorId: actor.id,
      actorCode: actor.officerCode,
    });
    return json({ paused });
  });
}
