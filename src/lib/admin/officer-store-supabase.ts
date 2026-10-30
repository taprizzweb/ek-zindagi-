import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import type { OfficerStore, ProfileRecord } from './officers';

const BAN_FOREVER = '876000h';

function fail(): never {
  throw new AppError('internal', 500);
}

export function supabaseOfficerStore(admin: SupabaseClient): OfficerStore {
  return {
    async getProfile(id) {
      const { data, error } = await admin
        .from('profiles')
        .select('id, role, officer_code, active')
        .eq('id', id)
        .maybeSingle();
      if (error) fail();
      if (!data) return null;
      const row = data as {
        id: string;
        role: ProfileRecord['role'];
        officer_code: string | null;
        active: boolean;
      };
      return { id: row.id, role: row.role, officerCode: row.officer_code, active: row.active };
    },
    async createAuthUser(email, password) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) {
        if (error.code === 'email_exists') throw new AppError('email_taken', 409);
        fail();
      }
      return { id: data.user.id };
    },
    async deleteAuthUser(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) fail();
    },
    async insertProfile(p) {
      const { data, error } = await admin
        .from('profiles')
        .insert({
          id: p.id,
          email: p.email,
          display_name: p.displayName,
          role: p.role,
          created_by: p.createdBy,
        })
        .select('officer_code')
        .single();
      if (error || !data) fail();
      return { officerCode: (data as { officer_code: string }).officer_code };
    },
    async setActive(id, active) {
      const { error } = await admin
        .from('profiles')
        .update({ active, disabled_at: active ? null : new Date().toISOString() })
        .eq('id', id);
      if (error) fail();
    },
    async setBanned(id, banned) {
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: banned ? BAN_FOREVER : 'none',
      });
      if (error) fail();
    },
    async setPassword(id, password) {
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) fail();
    },
    async setMustChangePassword(id, value) {
      const { error } = await admin
        .from('profiles')
        .update({ must_change_password: value })
        .eq('id', id);
      if (error) fail();
    },
    async revokeSessions(id) {
      const { error } = await admin.rpc('revoke_user_sessions', { p_user_id: id });
      if (error) fail();
    },
  };
}

import type { TeamStore } from './teams';

/** The officer store plus where a team's link lives. */
export function supabaseTeamStore(admin: SupabaseClient): TeamStore {
  return {
    ...supabaseOfficerStore(admin),
    async saveLink(profileId, tokenHash) {
      const { error } = await admin
        .from('access_links')
        .upsert(
          { profile_id: profileId, token_hash: tokenHash, rotated_at: new Date().toISOString() },
          { onConflict: 'profile_id' },
        );
      if (error) fail();
    },
  };
}
