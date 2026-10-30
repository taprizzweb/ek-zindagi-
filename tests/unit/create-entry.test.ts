import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEvent, AuditSink } from '@/lib/audit/audit';
import {
  createEntry,
  type EntryPorts,
  type ExistingEntry,
  type InsertResult,
  type IntakeActor,
  type IntakeConfig,
  type IntakeDeps,
  type NewEntryRow,
} from '@/lib/entries/create-entry';
import { AppError } from '@/lib/errors';
import { entryInputSchema, type EntryInput } from '@/lib/validation/entry';

const NOW = new Date('2026-10-30T10:00:00Z');

class Memory implements EntryPorts {
  rows: NewEntryRow[] = [];
  files = new Map<string, Buffer>();
  optedOut = new Set<string>();
  limits = new Map<string, number>();
  denyRateLimit = false;
  insertResults: InsertResult[] = [];
  failUpload = false;
  calls: string[] = [];

  async findByRequestId(officerId: string, requestId: string): Promise<ExistingEntry | null> {
    const r = this.rows.find((x) => x.officerId === officerId && x.clientRequestId === requestId);
    return r
      ? { id: r.id, certCode: r.certCode, status: 'saved', createdAt: NOW.toISOString() }
      : null;
  }
  async isOptedOut(h: string) {
    return this.optedOut.has(h);
  }
  async hasRecentEntry(h: string, since: string) {
    this.calls.push(`recent:${since}`);
    return this.rows.some((r) => r.phoneHash === h);
  }
  async uploadPhoto(id: string, jpeg: Buffer) {
    if (this.failUpload) throw new AppError('internal', 500);
    this.files.set(`${id}.jpg`, jpeg);
    return `${id}.jpg`;
  }
  async deletePhoto(path: string) {
    this.files.delete(path);
  }
  async insertEntry(row: NewEntryRow): Promise<InsertResult> {
    const forced = this.insertResults.shift();
    if (forced) return forced;
    if (this.rows.some((r) => r.certCode === row.certCode))
      return { ok: false, conflict: 'cert_code' };
    this.rows.push(row);
    return { ok: true, createdAt: NOW.toISOString() };
  }
  async rateLimit(key: string, _w: number, max: number) {
    const n = (this.limits.get(key) ?? 0) + 1;
    this.limits.set(key, n);
    return !this.denyRateLimit && n <= max;
  }
}

class MemoryAudit implements AuditSink {
  events: AuditEvent[] = [];
  async record(e: AuditEvent) {
    this.events.push(e);
  }
}

const officer: IntakeActor = { id: 'officer-1', role: 'officer', officerCode: 'JP-0001' };
const config: IntakeConfig = {
  allowGallery: true,
  dedupeHours: 24,
  retentionHours: 24,
  maxPerOfficerHour: 3,
  maxPerOfficerDay: 10,
  maxPerIpHour: 10,
};

let mem: Memory;
let audit: MemoryAudit;
let codes: string[];
let ids: number;
let processed: Buffer[];

const deps = (over: Partial<IntakeDeps> = {}): IntakeDeps => ({
  ports: mem,
  audit,
  config,
  hashPhone: (e164) => `hash(${e164})`,
  processPhoto: async (raw) => {
    processed.push(raw);
    return Buffer.from('JPEG:' + raw.toString());
  },
  generateCode: () => codes.shift() ?? `CODE-${Math.random()}`,
  newId: () => `entry-${++ids}`,
  now: () => NOW,
  ...over,
});

const input = (over: Record<string, unknown> = {}): EntryInput =>
  entryInputSchema.parse({
    clientRequestId: '40000000-0000-4000-8000-000000000001',
    name: 'Ravi Kumar',
    phone: '9876543210',
    violation: 'helmet',
    location: { source: 'gps', lat: 26.912, lng: 75.787, areaName: 'C-Scheme, Jaipur' },
    photoSource: 'none',
    consentChecked: false,
    ...over,
  });

beforeEach(() => {
  mem = new Memory();
  audit = new MemoryAudit();
  codes = ['EKZ-JPR-AAAAAAA', 'EKZ-JPR-BBBBBBB', 'EKZ-JPR-CCCCCCC'];
  ids = 0;
  processed = [];
});

const run = (i: EntryInput = input(), photo: Buffer | null = null, actor = officer, d = deps()) =>
  createEntry(d, actor, i, photo, '1.2.3.4');

describe('createEntry: happy path', () => {
  it('stores the entry with the right fields and returns the code', async () => {
    const r = await run();
    expect(r).toMatchObject({
      id: 'entry-1',
      certCode: 'EKZ-JPR-AAAAAAA',
      status: 'saved',
      replayed: false,
    });
    expect(mem.rows[0]).toMatchObject({
      officerId: 'officer-1',
      violation: 'helmet',
      areaName: 'C-Scheme, Jaipur',
      lat: 26.912,
      lng: 75.787,
      locationSource: 'gps',
      photoSource: 'none',
      personName: 'Ravi Kumar',
      phoneE164: '+919876543210',
      phoneHash: 'hash(+919876543210)',
      photoPath: null,
      otherText: null,
      expiresAt: '2026-10-31T10:00:00.000Z',
    });
  });

  it('allows supervisors too', async () => {
    await expect(
      run(input(), null, { id: 's1', role: 'supervisor', officerCode: 'JP-0002' }),
    ).resolves.toBeTruthy();
  });

  it('refuses admins', async () => {
    await expect(
      run(input(), null, { id: 'a1', role: 'admin', officerCode: null }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mem.rows).toHaveLength(0);
  });

  it('stores manual-location entries without coordinates', async () => {
    await run(input({ location: { source: 'manual', areaName: 'Station Road' } }));
    expect(mem.rows[0]).toMatchObject({ locationSource: 'manual', lat: null, lng: null });
  });

  it('keeps the "other" violation text', async () => {
    await run(input({ violation: 'other', otherChoice: 'typed', otherTyped: 'No indicator' }));
    expect(mem.rows[0]!.otherText).toBe('No indicator');
    mem.rows = [];
    await run(
      input({
        violation: 'other',
        otherChoice: 'red_light',
        phone: '9876543211',
        clientRequestId: '40000000-0000-4000-8000-000000000002',
      }),
    );
    expect(mem.rows[0]!.otherText).toBe('Jumping a red light');
  });
});

describe('createEntry: audit', () => {
  it('records the creation without any personal data', async () => {
    await run();
    expect(audit.events).toEqual([
      {
        action: 'entry_created',
        actorId: 'officer-1',
        actorCode: 'JP-0001',
        entryId: 'entry-1',
        meta: { violation: 'helmet', photo_source: 'none', location_source: 'gps' },
      },
    ]);
    const text = JSON.stringify(audit.events);
    for (const secret of ['Ravi', '9876543210', 'C-Scheme']) expect(text).not.toContain(secret);
  });
});

describe('createEntry: retries are safe', () => {
  it('returns the same entry for the same request id and does not insert twice', async () => {
    const first = await run();
    const again = await run();
    expect(again).toMatchObject({ id: first.id, certCode: first.certCode, replayed: true });
    expect(mem.rows).toHaveLength(1);
    expect(audit.events).toHaveLength(1);
  });

  it('a retry is not blocked by the duplicate-number rule', async () => {
    await run();
    await expect(run()).resolves.toMatchObject({ replayed: true });
  });

  it('a retry does not use up the rate limit', async () => {
    await run();
    const before = [...mem.limits.values()].reduce((a, b) => a + b, 0);
    await run();
    expect([...mem.limits.values()].reduce((a, b) => a + b, 0)).toBe(before);
  });

  it('another officer with the same request id gets their own entry', async () => {
    await run();
    const other = await run(input({ phone: '9876543299' }), null, {
      id: 'officer-2',
      role: 'officer',
      officerCode: 'JP-0009',
    });
    expect(other.replayed).toBe(false);
    expect(mem.rows).toHaveLength(2);
  });

  it('handles a race where the other submission won (and removes our photo)', async () => {
    const winner = await run(
      input({ photoSource: 'camera', consentChecked: true }),
      Buffer.from('a'),
    );
    mem.insertResults = [{ ok: false, conflict: 'request' }];
    // Both submissions passed every check before either was stored: our early lookups saw nothing.
    mem.hasRecentEntry = async () => false;
    const realFind = mem.findByRequestId.bind(mem);
    let first = true;
    mem.findByRequestId = async (o, r) => {
      if (first) {
        first = false;
        return null;
      }
      return realFind(o, r);
    };
    const r = await run(input({ photoSource: 'camera', consentChecked: true }), Buffer.from('b'));
    expect(r).toMatchObject({ id: winner.id, replayed: true });
    expect(mem.files.size).toBe(1); // only the winner's photo remains
  });
});

describe('createEntry: refusals', () => {
  it('refuses a number that received a certificate recently, and says nothing is stored', async () => {
    await run();
    await expect(
      run(input({ clientRequestId: '40000000-0000-4000-8000-000000000009' })),
    ).rejects.toMatchObject({
      code: 'duplicate_recent',
      status: 409,
    });
    expect(mem.rows).toHaveLength(1);
  });

  it('checks the duplicate window against the configured hours', async () => {
    await run();
    expect(mem.calls.at(-1)).toBe('recent:2026-10-29T10:00:00.000Z');
  });

  it('refuses an opted-out number and stores nothing', async () => {
    mem.optedOut.add('hash(+919876543210)');
    await expect(run()).rejects.toMatchObject({ code: 'opted_out' });
    expect(mem.rows).toHaveLength(0);
    expect(audit.events).toHaveLength(0);
  });

  it('refuses when a rate limit is hit', async () => {
    mem.denyRateLimit = true;
    await expect(run()).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(mem.rows).toHaveLength(0);
  });

  it('counts per officer and per IP', async () => {
    await run();
    expect([...mem.limits.keys()].sort()).toEqual([
      'entry:ip:1.2.3.4:h',
      'entry:officer:officer-1:d',
      'entry:officer:officer-1:h',
    ]);
  });

  it('stops an officer after the hourly limit', async () => {
    const phones = ['9000000001', '9000000002', '9000000003', '9000000004'];
    const results: string[] = [];
    for (const [i, phone] of phones.entries()) {
      try {
        await run(input({ phone, clientRequestId: `40000000-0000-4000-8000-00000000010${i}` }));
        results.push('ok');
      } catch (e) {
        results.push((e as AppError).code);
      }
    }
    expect(results).toEqual(['ok', 'ok', 'ok', 'rate_limited']);
  });

  it('refuses a photo file that does not match photoSource, either way round', async () => {
    await expect(
      run(input({ photoSource: 'camera', consentChecked: true }), null),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(run(input(), Buffer.from('x'))).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('refuses gallery photos when the fallback is switched off', async () => {
    const d = deps({ config: { ...config, allowGallery: false } });
    await expect(
      run(
        input({ photoSource: 'gallery', galleryReason: 'no_camera', consentChecked: true }),
        Buffer.from('x'),
        officer,
        d,
      ),
    ).rejects.toMatchObject({ code: 'gallery_disabled' });
    expect(processed).toHaveLength(0);
  });
});

describe('createEntry: photos', () => {
  const withPhoto = (over: Record<string, unknown> = {}) =>
    input({ photoSource: 'camera', consentChecked: true, ...over });

  it('re-encodes the photo and stores the processed copy, never the original', async () => {
    const r = await run(withPhoto(), Buffer.from('ORIGINAL'));
    expect(processed.map(String)).toEqual(['ORIGINAL']);
    expect(mem.files.get(`${r.id}.jpg`)?.toString()).toBe('JPEG:ORIGINAL');
    expect(mem.rows[0]).toMatchObject({
      photoPath: `${r.id}.jpg`,
      photoSource: 'camera',
      consentChecked: true,
    });
  });

  it('stores the gallery reason', async () => {
    await run(
      withPhoto({ photoSource: 'gallery', galleryReason: 'permission_denied' }),
      Buffer.from('x'),
    );
    expect(mem.rows[0]).toMatchObject({
      photoSource: 'gallery',
      galleryReason: 'permission_denied',
    });
  });

  it('stores nothing if the photo is rejected', async () => {
    const d = deps({
      processPhoto: async () => {
        throw new AppError('bad_photo', 400);
      },
    });
    await expect(run(withPhoto(), Buffer.from('x'), officer, d)).rejects.toMatchObject({
      code: 'bad_photo',
    });
    expect(mem.rows).toHaveLength(0);
    expect(mem.files.size).toBe(0);
  });

  it('does not store the entry if the upload fails', async () => {
    mem.failUpload = true;
    await expect(run(withPhoto(), Buffer.from('x'))).rejects.toThrow();
    expect(mem.rows).toHaveLength(0);
  });

  it('removes the uploaded photo if the entry cannot be saved', async () => {
    mem.insertResults = Array.from({ length: 5 }, () => ({
      ok: false as const,
      conflict: 'cert_code' as const,
    }));
    await expect(run(withPhoto(), Buffer.from('x'))).rejects.toThrow();
    expect(mem.files.size).toBe(0);
    expect(mem.rows).toHaveLength(0);
  });

  it('keeps the photo if only the audit write fails (the entry exists and a retry replays it)', async () => {
    const failing: AuditSink = {
      record: async () => {
        throw new AppError('internal', 500);
      },
    };
    await expect(
      run(withPhoto(), Buffer.from('x'), officer, deps({ audit: failing })),
    ).rejects.toThrow();
    expect(mem.rows).toHaveLength(1);
    expect(mem.files.size).toBe(1);
  });
});

describe('createEntry: certificate codes', () => {
  it('tries a new code after a collision', async () => {
    mem.rows.push({
      ...({} as NewEntryRow),
      certCode: 'EKZ-JPR-AAAAAAA',
      officerId: 'x',
      clientRequestId: 'y',
      phoneHash: 'z',
    });
    const r = await run();
    expect(r.certCode).toBe('EKZ-JPR-BBBBBBB');
  });

  it('gives up with a server error after five collisions', async () => {
    mem.insertResults = Array.from({ length: 5 }, () => ({
      ok: false as const,
      conflict: 'cert_code' as const,
    }));
    await expect(run()).rejects.toMatchObject({ code: 'internal', status: 500 });
  });
});
