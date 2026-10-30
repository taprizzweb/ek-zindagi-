import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@/lib/audit/audit';
import { generateCertCode } from '@/lib/domain/cert-code';
import {
  addOptOutByNumber,
  cleanCertCode,
  purgeEntryNow,
  type DataRequestPorts,
} from '@/lib/data-requests/data-requests';
import { AppError } from '@/lib/errors';

const actor = { id: 'sup-1', officerCode: 'JP-S001' };

function setup(opts: { failDelete?: boolean; purged?: boolean } = {}) {
  const code = generateCertCode();
  const files = new Set(['photos/a.jpg', 'pdfs/a.pdf']);
  const audit: AuditEvent[] = [];
  const optOuts: string[] = [];
  let cleared: string[] = [];
  const ports: DataRequestPorts = {
    async findByCode(c) {
      return c === code
        ? { id: 'e1', photoPath: 'a.jpg', pdfPath: 'a.pdf', purged: opts.purged ?? false }
        : null;
    },
    async deleteFile(b, p) {
      if (opts.failDelete) throw new Error('down');
      files.delete(`${b}/${p}`);
    },
    async fileExists(b, p) {
      return files.has(`${b}/${p}`);
    },
    async finishPurge(ids) {
      cleared = ids;
      return ids.length;
    },
    async addOptOut(h) {
      optOuts.push(h);
    },
  };
  const deps = {
    ports,
    audit: {
      async record(e: AuditEvent) {
        audit.push(e);
      },
    },
    hashPhone: (e: string) => `h(${e})`,
  };
  return { code, deps, files, audit, optOuts, cleared: () => cleared };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as AppError).status;
  }
  return 0;
};

describe('purgeEntryNow', () => {
  it('deletes the files, clears the entry and audits who did it (no personal data in the audit)', async () => {
    const s = setup();
    expect(await purgeEntryNow(s.deps, actor, s.code)).toEqual({
      purged: true,
      alreadyPurged: false,
    });
    expect(s.files.size).toBe(0);
    expect(s.cleared()).toEqual(['e1']);
    expect(s.audit).toEqual([
      { action: 'entry_purged_early', actorId: 'sup-1', actorCode: 'JP-S001', entryId: 'e1' },
    ]);
  });
  it('forgives spaces and lower case when the code is typed', async () => {
    const s = setup();
    expect(cleanCertCode(`  ${s.code.toLowerCase().slice(0, 8)} ${s.code.slice(8)} `)).toBe(s.code);
    expect((await purgeEntryNow(s.deps, actor, ` ${s.code.toLowerCase()} `)).purged).toBe(true);
  });
  it('refuses a malformed code (wrong check character) without looking anything up', async () => {
    const s = setup();
    const bad = s.code.slice(0, -1) + (s.code.endsWith('2') ? '3' : '2');
    expect(await code(purgeEntryNow(s.deps, actor, bad))).toBe(400);
    expect(await code(purgeEntryNow(s.deps, actor, 'hello'))).toBe(400);
  });
  it('404 for a valid code nobody has', async () => {
    const s = setup();
    expect(await code(purgeEntryNow(s.deps, actor, generateCertCode()))).toBe(404);
    expect(s.audit).toEqual([]);
  });
  it('an entry already purged is reported, not purged twice', async () => {
    const s = setup({ purged: true });
    expect(await purgeEntryNow(s.deps, actor, s.code)).toEqual({
      purged: false,
      alreadyPurged: true,
    });
    expect(s.audit).toEqual([]);
  });
  it('if a file cannot be deleted nothing is cleared and nothing is claimed in the audit log', async () => {
    const s = setup({ failDelete: true });
    expect(await code(purgeEntryNow(s.deps, actor, s.code))).toBe(500);
    expect(s.cleared()).toEqual([]);
    expect(s.audit).toEqual([]);
  });
});

describe('addOptOutByNumber', () => {
  it('stores only the hash of the normalised number', async () => {
    const s = setup();
    await addOptOutByNumber(s.deps, actor, '98765 43210');
    expect(s.optOuts).toEqual(['h(+919876543210)']);
    expect(JSON.stringify(s.audit)).not.toMatch(/9876543210/);
    expect(s.audit[0]!.action).toBe('opt_out_added');
  });
  it('refuses a number that is not an Indian mobile', async () => {
    const s = setup();
    expect(await code(addOptOutByNumber(s.deps, actor, '12345'))).toBe(400);
    expect(s.optOuts).toEqual([]);
  });
});
