import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { settingChangeSchema } from '@/lib/settings/settings';
import { loadSettings, supabaseSettingsStore } from '@/lib/settings/settings-store-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

/** One setting at a time. Only an admin; every change is audited (key and new value, nothing personal). */
export async function PUT(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['admin'] });
    const change = settingChangeSchema.parse(await readJson(request));
    const admin = createAdminClient();
    await supabaseSettingsStore(admin).save(change, actor.id);
    await supabaseAuditSink(admin).record({
      action: 'settings_changed',
      actorId: actor.id,
      actorCode: actor.officerCode,
      meta: { key: change.key, value: change.value },
    });
    return json(await loadSettings(admin));
  });
}
