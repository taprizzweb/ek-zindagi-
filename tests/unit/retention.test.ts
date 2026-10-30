import { describe, expect, it } from 'vitest';
import type { AuditEvent, AuditSink } from '@/lib/audit/audit';
import {
  runRetention,
  type Bucket,
  type DueEntry,
  type RetentionPorts,
} from '@/lib/retention/retention';

/** An in-memory store that behaves like the database functions and the storage buckets. */
function world(entries: DueEntry[], opts: { failDelete?: string; ghostFile?: string } = {}) {
  const files = new Set<string>();
  for (const e of entries) {
    if (e.photoPath) files.add(`photos/${e.photoPath}`);
    if (e.pdfPath) files.add(`pdfs/${e.pdfPath}`);
  }
  const rows = new Map(entries.map((e) => [e.id, { ...e, purged: false }]));
  const audit: AuditEvent[] = [];
  const sink: AuditSink = {
    async record(e) {
      audit.push(e);
    },
  };
  const ports: RetentionPorts = {
    async dueForPurge(limit) {
      return [...rows.values()]
        .filter((r) => !r.purged)
        .slice(0, limit)
        .map(({ id, photoPath, pdfPath }) => ({ id, photoPath, pdfPath }));
    },
    async deleteFile(bucket: Bucket, path) {
      if (path === opts.failDelete) throw new Error('storage down');
      if (path !== opts.ghostFile) files.delete(`${bucket}/${path}`); // a "ghost" file silently stays
    },
    async fileExists(bucket: Bucket, path) {
      return files.has(`${bucket}/${path}`);
    },
    async finishPurge(ids) {
      let n = 0;
      for (const id of ids) {
        const r = rows.get(id);
        if (r && !r.purged) {
          r.purged = true;
          r.photoPath = null;
          r.pdfPath = null;
          n++;
        }
      }
      return n;
    },
    async housekeeping() {
      return { links: 2 };
    },
    async leftovers() {
      const overdue = [...rows.values()].filter((r) => !r.purged).length;
      return { overdue, dirty: 0 };
    },
  };
  return { ports, sink, files, rows, audit };
}
const E = (n: number, photo = true): DueEntry => ({
  id: `id-${n}`,
  photoPath: photo ? `o/${n}.jpg` : null,
  pdfPath: `o/${n}.pdf`,
});

describe('retention job', () => {
  it('deletes the files, then clears the rows, and reports counts', async () => {
    const w = world([E(1), E(2, false)]);
    const r = await runRetention(w.ports, w.sink);
    expect(r).toEqual({ purged: 2, failed: 0, overdue: 0, dirty: 0 });
    expect(w.files.size).toBe(0);
    expect([...w.rows.values()].every((x) => x.purged && !x.pdfPath)).toBe(true);
  });

  it('writes an audit entry for every run, with counts only', async () => {
    const w = world([E(1)]);
    await runRetention(w.ports, w.sink);
    expect(w.audit).toEqual([
      {
        action: 'retention_run',
        meta: { purged: 1, failed: 0, overdue: 0, dirty: 0, links_removed: 2 },
      },
    ]);
    expect(JSON.stringify(w.audit)).not.toMatch(/\.jpg|\.pdf|id-1/);
  });

  it('does nothing and still audits when nothing is due', async () => {
    const w = world([]);
    expect(await runRetention(w.ports, w.sink)).toEqual({
      purged: 0,
      failed: 0,
      overdue: 0,
      dirty: 0,
    });
    expect(w.audit.map((a) => a.action)).toEqual(['retention_run']);
  });

  it('keeps the row (and its paths) when a file cannot be deleted, so the next run finds it', async () => {
    const w = world([E(1), E(2)], { failDelete: 'o/1.pdf' });
    const r = await runRetention(w.ports, w.sink);
    expect(r.purged).toBe(1);
    expect(r.failed).toBe(1);
    expect(w.rows.get('id-1')).toMatchObject({ purged: false, pdfPath: 'o/1.pdf' });
    expect(w.rows.get('id-2')!.purged).toBe(true);
    expect(w.audit.map((a) => a.action)).toEqual(['retention_run', 'retention_leftover']);
  });

  it('verifies deletion: a file that is still there after "delete" blocks the purge', async () => {
    const w = world([E(1)], { ghostFile: 'o/1.jpg' });
    const r = await runRetention(w.ports, w.sink);
    expect(r).toMatchObject({ purged: 0, failed: 1 });
    expect(w.rows.get('id-1')!.purged).toBe(false);
  });

  it('a failing entry does not stop the rest, and is not retried in the same run', async () => {
    const w = world([E(1), E(2), E(3)], { failDelete: 'o/1.jpg' });
    let calls = 0;
    const orig = w.ports.deleteFile;
    w.ports.deleteFile = async (b, p) => {
      calls++;
      return orig(b, p);
    };
    const r = await runRetention(w.ports, w.sink);
    expect(r).toMatchObject({ purged: 2, failed: 1 });
    expect(calls).toBeLessThanOrEqual(6);
  });

  it('works through more than one batch', async () => {
    const w = world(Array.from({ length: 450 }, (_, i) => E(i)));
    const r = await runRetention(w.ports, w.sink);
    expect(r.purged).toBe(450);
    expect(w.files.size).toBe(0);
  });

  it('flags leftovers in the audit log', async () => {
    const w = world([]);
    w.ports.leftovers = async () => ({ overdue: 2, dirty: 1 });
    const r = await runRetention(w.ports, w.sink);
    expect(r).toMatchObject({ overdue: 2, dirty: 1 });
    expect(w.audit.at(-1)).toEqual({
      action: 'retention_leftover',
      meta: { overdue: 2, dirty: 1, failed: 0 },
    });
  });
});
