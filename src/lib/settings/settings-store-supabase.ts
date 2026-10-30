import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import { serverEnv } from '@/lib/env';
import { resolveSettings, type Settings, type SettingsStore } from './settings';

export function supabaseSettingsStore(admin: SupabaseClient): SettingsStore {
  return {
    async load() {
      const { data, error } = await admin.from('settings').select('key, value');
      if (error) throw new AppError('internal', 500, 'settings load failed');
      return (data as { key: string; value: unknown }[]) ?? [];
    },
    async save(change, actorId) {
      const { error } = await admin.from('settings').upsert(
        {
          key: change.key,
          value: change.value,
          updated_at: new Date().toISOString(),
          updated_by: actorId,
        },
        { onConflict: 'key' },
      );
      if (error) throw new AppError('internal', 500, 'settings save failed');
    },
  };
}

/** The effective settings right now (environment defaults, overridden by what the admin saved). */
export async function loadSettings(admin: SupabaseClient): Promise<Settings> {
  const env = serverEnv();
  return resolveSettings(env, await supabaseSettingsStore(admin).load());
}
