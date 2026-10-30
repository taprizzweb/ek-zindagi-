import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@/lib/audit/audit';
import { changeTeamLink, createTeam, setTeamActive, type TeamStore } from '@/lib/admin/teams';
import {
  TEAM_COOKIE_MAX_AGE_S,
  signTeamCookie,
  teamCookieOptions,
  verifyTeamCookie,
} from '@/lib/auth/cookie-crypto';
import { hashToken, isWellFormedToken } from '@/lib/delivery/token';
import { AppError } from '@/lib/errors';

const SECRET = 'unit-test-cookie-secret-0123456789abcdef';

describe('team cookie', () => {
  it('names the team and the link version, and cannot be forged or moved', () => {
    const c = signTeamCookie('team-1', 1_700_000_000_123, SECRET);
    expect(verifyTeamCookie(c, SECRET)).toEqual({
      profileId: 'team-1',
      linkVersionMs: 1_700_000_000_123,
    });
    expect(verifyTeamCookie(c, `${SECRET}x`)).toBeNull();
    expect(verifyTeamCookie(undefined, SECRET)).toBeNull();
    expect(verifyTeamCookie('garbage', SECRET)).toBeNull();
    const [payload, mac] = c.split('.');
    const other = Buffer.from('team-2.1700000000123').toString('base64url');
    expect(verifyTeamCookie(`${other}.${mac}`, SECRET)).toBeNull(); // another team, same signature
    expect(verifyTeamCookie(`${payload}.${mac!.slice(0, -2)}AA`, SECRET)).toBeNull();
  });
  it('is HttpOnly, SameSite and lasts over a year', () => {
    expect(teamCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      maxAge: TEAM_COOKIE_MAX_AGE_S,
    });
    expect(TEAM_COOKIE_MAX_AGE_S).toBeGreaterThan(365 * 86400);
  });
});

function setup() {
  const audit: AuditEvent[] = [];
  const profiles = new Map<
    string,
    {
      id: string;
      role: 'officer' | 'admin' | 'supervisor';
      officerCode: string | null;
      active: boolean;
    }
  >();
  const links = new Map<string, string>();
  const calls: string[] = [];
  let n = 0;
  const store: TeamStore = {
    async getProfile(id) {
      return profiles.get(id) ?? null;
    },
    async createAuthUser(email, password) {
      calls.push(`auth:${email}:${password.length}`);
      return { id: `u${++n}` };
    },
    async deleteAuthUser(id) {
      calls.push(`del:${id}`);
    },
    async insertProfile(p) {
      if (p.displayName === 'FAIL') throw new AppError('internal', 500);
      profiles.set(p.id, { id: p.id, role: p.role, officerCode: `JP-000${n}`, active: true });
      return { officerCode: `JP-000${n}` };
    },
    async setActive(id, a) {
      profiles.get(id)!.active = a;
    },
    async setBanned() {},
    async setPassword() {},
    async setMustChangePassword(id, v) {
      calls.push(`must:${id}:${v}`);
    },
    async revokeSessions() {},
    async saveLink(id, hash) {
      links.set(id, hash);
    },
  };
  const deps = {
    store,
    audit: {
      async record(e: AuditEvent) {
        audit.push(e);
      },
    },
    randomHex: (b: number) => 'ab'.repeat(b),
  };
  const admin = { id: 'admin-1', role: 'admin' as const, officerCode: null };
  return { deps, audit, profiles, links, calls, admin };
}

describe('teams', () => {
  it('creates an officer-role account with a throw-away password and ONE link, whose hash is all that is stored', async () => {
    const s = setup();
    const t = await createTeam(s.deps, s.admin, 'Mansarovar Thana');
    expect(isWellFormedToken(t.token)).toBe(true);
    expect(s.links.get(t.id)).toBe(hashToken(t.token));
    expect([...s.links.values()].join()).not.toContain(t.token);
    expect(s.profiles.get(t.id)).toMatchObject({ role: 'officer', active: true });
    expect(s.calls).toContain(`must:${t.id}:false`); // no forced password change: nobody has the password
    expect(s.calls[0]).toMatch(/^auth:team-[0-9a-f]+@teams\.invalid:48$/);
    expect(s.audit).toEqual([
      {
        action: 'team_created',
        actorId: 'admin-1',
        actorCode: null,
        meta: { target_code: 'JP-0001' },
      },
    ]);
    expect(JSON.stringify(s.audit)).not.toContain(t.token);
  });

  it('only an admin may make a team', async () => {
    const s = setup();
    await expect(
      createTeam(s.deps, { ...s.admin, role: 'supervisor' as never }, 'X Y'),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(s.calls).toEqual([]);
  });

  it('removes the login it made if the rest fails', async () => {
    const s = setup();
    await expect(createTeam(s.deps, s.admin, 'FAIL')).rejects.toBeInstanceOf(AppError);
    expect(s.calls.some((c) => c.startsWith('del:'))).toBe(true);
    expect(s.links.size).toBe(0);
  });

  it('a new link replaces the old one (the old hash is gone) and is audited without the link', async () => {
    const s = setup();
    const t = await createTeam(s.deps, s.admin, 'Ajmeri Gate');
    const fresh = await changeTeamLink(s.deps, s.admin, t.id);
    expect(fresh.token).not.toBe(t.token);
    expect(s.links.get(t.id)).toBe(hashToken(fresh.token));
    expect(s.audit.at(-1)).toMatchObject({ action: 'team_link_changed' });
    expect(JSON.stringify(s.audit)).not.toContain(fresh.token);
  });

  it('refuses a new link for something that is not a team, or for an unknown id', async () => {
    const s = setup();
    s.profiles.set('a2', { id: 'a2', role: 'admin', officerCode: null, active: true });
    await expect(changeTeamLink(s.deps, s.admin, 'a2')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(changeTeamLink(s.deps, s.admin, 'nobody')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('switches a team off and on', async () => {
    const s = setup();
    const t = await createTeam(s.deps, s.admin, 'Gopalpura');
    await setTeamActive(s.deps, s.admin, t.id, false);
    expect(s.profiles.get(t.id)!.active).toBe(false);
    await setTeamActive(s.deps, s.admin, t.id, true);
    expect(s.profiles.get(t.id)!.active).toBe(true);
  });
});
