import { beforeEach, describe, expect, it } from 'vitest';
import {
  setOfficerActive,
  type Actor,
  type OfficerStore,
  type ProfileRecord,
} from '@/lib/admin/officers';
import type { AuditEvent, AuditSink } from '@/lib/audit/audit';
import { AppError } from '@/lib/errors';

/** In-memory stand-in for Supabase Auth + the profiles table. Records every call in order. */
class MemoryStore implements OfficerStore {
  calls: string[] = [];
  profiles = new Map<string, ProfileRecord>();
  authUsers = new Map<string, { email: string; password: string; banned: boolean }>();
  mustChange = new Map<string, boolean>();
  failInsertProfile = false;
  failOn: string | null = null;
  private n = 0;

  private step(name: string) {
    this.calls.push(name);
    if (this.failOn === name) throw new AppError('internal', 500);
  }
  async getProfile(id: string) {
    return this.profiles.get(id) ?? null;
  }
  async createAuthUser(email: string, password: string) {
    this.step('createAuthUser');
    if ([...this.authUsers.values()].some((u) => u.email === email))
      throw new AppError('email_taken', 409);
    const id = `u${++this.n}`;
    this.authUsers.set(id, { email, password, banned: false });
    return { id };
  }
  async deleteAuthUser(id: string) {
    this.step('deleteAuthUser');
    this.authUsers.delete(id);
  }
  async insertProfile(p: {
    id: string;
    email: string;
    displayName: string;
    role: 'officer' | 'supervisor';
    createdBy: string;
  }) {
    this.step('insertProfile');
    if (this.failInsertProfile) throw new AppError('internal', 500);
    const officerCode = `JP-${String(this.profiles.size + 1).padStart(4, '0')}`;
    this.profiles.set(p.id, { id: p.id, role: p.role, officerCode, active: true });
    this.mustChange.set(p.id, true);
    return { officerCode };
  }
  async setActive(id: string, active: boolean) {
    this.step('setActive');
    const p = this.profiles.get(id)!;
    this.profiles.set(id, { ...p, active });
  }
  async setBanned(id: string, banned: boolean) {
    this.step('setBanned');
    this.authUsers.get(id)!.banned = banned;
  }
  async setPassword(id: string, password: string) {
    this.step('setPassword');
    this.authUsers.get(id)!.password = password;
  }
  async setMustChangePassword(id: string, value: boolean) {
    this.step('setMustChangePassword');
    this.mustChange.set(id, value);
  }
  async revokeSessions() {
    this.step('revokeSessions');
  }
}

class MemoryAudit implements AuditSink {
  events: AuditEvent[] = [];
  async record(e: AuditEvent) {
    this.events.push(e);
  }
}

const admin: Actor = { id: 'admin-1', role: 'admin', officerCode: null };
let store: MemoryStore;
let audit: MemoryAudit;
const deps = () => ({ store, audit, generatePassword: () => 'Temp-Pass-123' });

beforeEach(() => {
  store = new MemoryStore();
  audit = new MemoryAudit();
  store.profiles.set('admin-1', { id: 'admin-1', role: 'admin', officerCode: null, active: true });
});

describe('setOfficerActive', () => {
  let officerId: string;
  beforeEach(async () => {
    officerId = 'u1';
    store.profiles.set(officerId, {
      id: officerId,
      role: 'officer',
      officerCode: 'JP-0002',
      active: true,
    });
    store.authUsers.set(officerId, { email: 'team@teams.invalid', password: 'x', banned: false });
    store.calls = [];
    audit.events = [];
  });

  it('disables: profile first, then ban, then sessions, then audit', async () => {
    await setOfficerActive(deps(), admin, officerId, false);
    expect(store.calls).toEqual(['setActive', 'setBanned', 'revokeSessions']);
    expect(store.profiles.get(officerId)?.active).toBe(false);
    expect(store.authUsers.get(officerId)?.banned).toBe(true);
    expect(audit.events[0]).toMatchObject({
      action: 'officer_disabled',
      meta: { target_code: 'JP-0002' },
    });
  });

  it('still ends access if a later step fails (profile is already inactive)', async () => {
    store.failOn = 'setBanned';
    await expect(setOfficerActive(deps(), admin, officerId, false)).rejects.toThrow();
    expect(store.profiles.get(officerId)?.active).toBe(false);
  });

  it('enables: lifts the ban before reactivating', async () => {
    await setOfficerActive(deps(), admin, officerId, false);
    store.calls = [];
    await setOfficerActive(deps(), admin, officerId, true);
    expect(store.calls).toEqual(['setBanned', 'setActive']);
    expect(store.profiles.get(officerId)?.active).toBe(true);
    expect(audit.events.at(-1)?.action).toBe('officer_enabled');
  });

  it('cannot act on yourself', async () => {
    await expect(setOfficerActive(deps(), admin, 'admin-1', false)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('cannot act on another admin', async () => {
    store.profiles.set('admin-2', {
      id: 'admin-2',
      role: 'admin',
      officerCode: null,
      active: true,
    });
    await expect(setOfficerActive(deps(), admin, 'admin-2', false)).rejects.toMatchObject({
      status: 403,
    });
    expect(store.profiles.get('admin-2')?.active).toBe(true);
  });

  it('answers 404 for an unknown id', async () => {
    await expect(setOfficerActive(deps(), admin, 'nope', false)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('refuses non-admin callers', async () => {
    await expect(
      setOfficerActive(
        deps(),
        { id: officerId, role: 'officer', officerCode: 'JP-0002' },
        officerId,
        false,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
