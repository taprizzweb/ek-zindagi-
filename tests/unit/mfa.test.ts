import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@/lib/audit/audit';
import {
  beginEnrollment,
  resetMfa,
  verifyMfaCode,
  type MfaFactor,
  type MfaPorts,
} from '@/lib/auth/mfa';
import {
  MFA_MAX_AGE_MS,
  decryptTotpSecret,
  encryptTotpSecret,
  signMfaCookie,
  verifyMfaCookie,
} from '@/lib/auth/mfa-crypto';
import {
  base32Decode,
  base32Encode,
  counterAt,
  otpauthUri,
  totpAt,
  verifyTotp,
} from '@/lib/auth/totp';
import { AppError } from '@/lib/errors';

const MASTER = 'unit-test-master-secret-0123456789abcdef';

describe('TOTP (RFC 6238)', () => {
  // The RFC's test secret is the ASCII string 12345678901234567890; its 8-digit codes end in the 6-digit ones.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the published test vectors', () => {
    expect(totpAt(secret, 1, 8)).toBe('94287082'); // t = 59
    expect(totpAt(secret, 37037036, 8)).toBe('07081804'); // t = 1111111109
    expect(totpAt(secret, 1, 6)).toBe('287082');
    expect(totpAt(secret, 37037037, 8)).toBe('14050471'); // t = 1111111111
    expect(totpAt(secret, 41152263, 8)).toBe('89005924'); // t = 1234567890
    expect(totpAt(secret, 66666666, 8)).toBe('69279037'); // t = 2000000000
  });
  it('base32 round-trips and ignores spaces and case', () => {
    expect(base32Decode(base32Encode(Buffer.from('hello world')))).toEqual(
      Buffer.from('hello world'),
    );
    expect(base32Decode(secret.toLowerCase().replace(/(.{4})/g, '$1 '))).toEqual(
      Buffer.from('12345678901234567890'),
    );
    expect(() => base32Decode('abc1')).toThrow();
  });
  it('accepts the current step and one either side, no more', () => {
    const now = 1_700_000_000_000;
    const c = counterAt(now);
    for (const d of [-1, 0, 1])
      expect(verifyTotp(secret, totpAt(secret, c + d), now, 0), `${d}`).toBe(c + d);
    for (const d of [-2, 2, 10])
      expect(verifyTotp(secret, totpAt(secret, c + d), now, 0), `${d}`).toBeNull();
  });
  it('never accepts a step that was already used, or an older one', () => {
    const now = 1_700_000_000_000;
    const c = counterAt(now);
    expect(verifyTotp(secret, totpAt(secret, c), now, c)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, c - 1), now, c)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, c + 1), now, c)).toBe(c + 1);
  });
  it('refuses anything that is not exactly six digits', () => {
    const now = 1_700_000_000_000;
    const good = totpAt(secret, counterAt(now));
    for (const bad of [
      '',
      '12345',
      `${good}0`,
      ` ${good}`,
      good.replace(/\d$/, 'a'),
      '１２３４５６',
    ]) {
      expect(verifyTotp(secret, bad, now, 0), JSON.stringify(bad)).toBeNull();
    }
  });
  it('makes a standard otpauth address', () => {
    const uri = otpauthUri('ABCDEFGH', 'sup@example.org');
    expect(uri).toBe(
      'otpauth://totp/EK%20ZINDAGI%3Asup%40example.org?secret=ABCDEFGH&issuer=EK%20ZINDAGI&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('stored secrets and the cookie', () => {
  it('encrypts a secret so it is not readable, and only the right account and key can open it', () => {
    const enc = encryptTotpSecret('JBSWY3DPEHPK3PXP', 'user-1', MASTER);
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain('JBSWY3DP');
    expect(decryptTotpSecret(enc, 'user-1', MASTER)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptTotpSecret(enc, 'user-2', MASTER)).toThrow(); // copied onto another account
    expect(() => decryptTotpSecret(enc, 'user-1', `${MASTER}x`)).toThrow(); // wrong key
    const [v, iv, ct, tag] = enc.split('.');
    expect(() =>
      decryptTotpSecret([v, iv, ct!.slice(0, -2) + 'AA', tag].join('.'), 'user-1', MASTER),
    ).toThrow();
    expect(encryptTotpSecret('JBSWY3DPEHPK3PXP', 'user-1', MASTER)).not.toBe(enc); // fresh nonce each time
  });
  it('the cookie proves one account, for a limited time, and cannot be forged or moved', () => {
    const now = 1_700_000_000_000;
    const c = signMfaCookie('user-1', now, MASTER);
    expect(verifyMfaCookie(c, 'user-1', now + 1000, MASTER)).toBe(true);
    expect(verifyMfaCookie(c, 'user-2', now + 1000, MASTER)).toBe(false);
    expect(verifyMfaCookie(c, 'user-1', now + MFA_MAX_AGE_MS + 1, MASTER)).toBe(false);
    expect(verifyMfaCookie(c, 'user-1', now, `${MASTER}x`)).toBe(false);
    expect(verifyMfaCookie(undefined, 'user-1', now, MASTER)).toBe(false);
    expect(verifyMfaCookie('garbage', 'user-1', now, MASTER)).toBe(false);
    const [payload, mac] = c.split('.');
    const forged = Buffer.from(`user-1.${now + 10 * MFA_MAX_AGE_MS}`).toString('base64url');
    expect(verifyMfaCookie(`${forged}.${mac}`, 'user-1', now, MASTER)).toBe(false);
    expect(verifyMfaCookie(`${payload}.${mac!.slice(0, -2)}AA`, 'user-1', now, MASTER)).toBe(false);
  });
});

function setup(opts: { allow?: boolean } = {}) {
  const rows = new Map<string, MfaFactor>();
  const audit: AuditEvent[] = [];
  let hits = 0;
  const ports: MfaPorts = {
    async getFactor(id) {
      return rows.get(id) ?? null;
    },
    async createFactorIfAbsent(id, enc) {
      if (!rows.has(id)) rows.set(id, { secretEnc: enc, confirmed: false, lastCounter: 0 });
    },
    async confirmFactor(id) {
      rows.get(id)!.confirmed = true;
    },
    async acceptCounter(id, c) {
      const f = rows.get(id)!;
      if (f.lastCounter >= c) return false;
      f.lastCounter = c;
      return true;
    },
    async deleteFactor(id) {
      rows.delete(id);
    },
    async rateLimit(_k, _w, max) {
      return opts.allow === false ? false : ++hits <= max;
    },
  };
  let now = 1_700_000_000_000;
  const deps = {
    ports,
    audit: {
      async record(e: AuditEvent) {
        audit.push(e);
      },
    },
    masterKey: MASTER,
    now: () => now,
  };
  const user = { id: 'sup-1', email: 'sup@example.org', officerCode: 'JP-S001' };
  return { deps, rows, audit, user, advance: (ms: number) => (now += ms), now: () => now };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as AppError).code;
  }
  return 'ok';
};

describe('enrolment and verification', () => {
  it('shows the same secret until it is confirmed, never stores it in the clear, then shows nothing', async () => {
    const s = setup();
    const a = await beginEnrollment(s.deps, s.user);
    const b = await beginEnrollment(s.deps, s.user);
    expect(a!.secret).toBe(b!.secret);
    expect(a!.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(s.rows.get('sup-1')!.secretEnc).not.toContain(a!.secret);
    expect(a!.uri).toContain(`secret=${a!.secret}`);
    const r = await verifyMfaCode(s.deps, s.user, totpAt(a!.secret, counterAt(s.now())));
    expect(r).toEqual({ enrolled: true });
    expect(await beginEnrollment(s.deps, s.user)).toBeNull();
  });

  it('the first good code finishes set-up; later sign-ins need a NEW code each time', async () => {
    const s = setup();
    const e = (await beginEnrollment(s.deps, s.user))!;
    await verifyMfaCode(s.deps, s.user, totpAt(e.secret, counterAt(s.now())));
    s.advance(31_000);
    const code = totpAt(e.secret, counterAt(s.now()));
    expect(await verifyMfaCode(s.deps, s.user, code)).toEqual({ enrolled: false });
    expect(await status(verifyMfaCode(s.deps, s.user, code))).toBe('invalid_code'); // replay
    expect(s.audit.map((a) => a.action)).toEqual(['mfa_enrolled', 'mfa_verified', 'mfa_failed']);
  });

  it('a wrong code is refused and audited, with no personal data in the audit', async () => {
    const s = setup();
    await beginEnrollment(s.deps, s.user);
    expect(await status(verifyMfaCode(s.deps, s.user, '000000'))).toBe('invalid_code');
    expect(s.audit).toEqual([{ action: 'mfa_failed', actorId: 'sup-1', actorCode: 'JP-S001' }]);
  });

  it('after six tries in the window even the right code is refused (429)', async () => {
    const s = setup();
    const e = (await beginEnrollment(s.deps, s.user))!;
    for (let i = 0; i < 6; i++)
      expect(await status(verifyMfaCode(s.deps, s.user, '000000'))).toBe('invalid_code');
    expect(await status(verifyMfaCode(s.deps, s.user, totpAt(e.secret, counterAt(s.now()))))).toBe(
      'rate_limited',
    );
  });

  it('an account with no secret, or one that will not decrypt, never passes', async () => {
    const s = setup();
    expect(await status(verifyMfaCode(s.deps, s.user, '123456'))).toBe('invalid_code');
    s.rows.set('sup-1', { secretEnc: 'v1.bad.bad.bad', confirmed: true, lastCounter: 0 });
    expect(await status(verifyMfaCode(s.deps, s.user, '123456'))).toBe('invalid_code');
  });

  it("one account's secret copied to another does not work there", async () => {
    const s = setup();
    const e = (await beginEnrollment(s.deps, s.user))!;
    s.rows.set('sup-2', { ...s.rows.get('sup-1')! });
    const code = totpAt(e.secret, counterAt(s.now()));
    expect(await status(verifyMfaCode(s.deps, { id: 'sup-2', officerCode: null }, code))).toBe(
      'invalid_code',
    );
  });
});

describe('reset', () => {
  it('only an admin may clear a supervisor, never themselves or an officer, and it is audited', async () => {
    const s = setup();
    await beginEnrollment(s.deps, s.user);
    const admin = { id: 'a1', role: 'admin', officerCode: null };
    expect(
      await status(
        resetMfa(s.deps, { ...admin, role: 'supervisor' }, { id: 'sup-1', role: 'supervisor' }),
      ),
    ).toBe('forbidden');
    expect(await status(resetMfa(s.deps, admin, { id: 'a1', role: 'admin' }))).toBe('forbidden');
    expect(await status(resetMfa(s.deps, admin, { id: 'o1', role: 'officer' }))).toBe('forbidden');
    expect(s.rows.has('sup-1')).toBe(true);
    await resetMfa(s.deps, admin, { id: 'sup-1', role: 'supervisor' });
    expect(s.rows.has('sup-1')).toBe(false);
    expect(s.audit.at(-1)).toEqual({ action: 'mfa_reset', actorId: 'a1', actorCode: null });
    expect((await beginEnrollment(s.deps, s.user))!.secret).toBeTruthy(); // sets up again
  });
});
