import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEvent, AuditSink } from '@/lib/audit/audit';
import {
  generateCertificate,
  type CertificateDeps,
  type CertificatePorts,
  type Claim,
} from '@/lib/certificates/generate';
import { AppError } from '@/lib/errors';
import type { CertificateData } from '@/lib/pdf/template';

const actor = { id: 'officer-1', officerCode: 'JP-0001' };

const claimed: Claim = {
  claimed: true,
  status: 'generating',
  purged: false,
  officerId: 'officer-1',
  certCode: 'EKZ-JPR-4ZK7MQ9',
  personName: 'Ravi Kumar',
  areaName: 'C-Scheme, Jaipur',
  violation: 'helmet',
  otherText: null,
  photoPath: null,
  createdAt: '2026-10-30T09:51:00.000Z',
};

class Memory implements CertificatePorts {
  owner: string | null = 'officer-1';
  claimResult: Claim | null = claimed;
  photos = new Map<string, Buffer>();
  pdfs = new Map<string, Buffer>();
  status = 'saved';
  pdfPath: string | null = null;
  errorCode: string | null = null;
  calls: string[] = [];
  failStep: string | null = null;

  private step(n: string) {
    this.calls.push(n);
    if (this.failStep === n) throw new AppError('internal', 500);
  }
  async ownerOf() {
    this.step('ownerOf');
    return this.owner;
  }
  async claim() {
    this.step('claim');
    return this.claimResult;
  }
  async downloadPhoto(path: string) {
    this.step('downloadPhoto');
    const p = this.photos.get(path);
    if (!p) throw new AppError('internal', 500);
    return p;
  }
  async uploadPdf(id: string, pdf: Buffer) {
    this.step('uploadPdf');
    this.pdfs.set(`${id}.pdf`, pdf);
    return `${id}.pdf`;
  }
  async markReady(_id: string, path: string) {
    this.step('markReady');
    this.status = 'ready';
    this.pdfPath = path;
  }
  async markFailed(_id: string, code: string) {
    this.step('markFailed');
    this.status = 'failed';
    this.errorCode = code;
  }
}

class MemoryAudit implements AuditSink {
  events: AuditEvent[] = [];
  async record(e: AuditEvent) {
    this.events.push(e);
  }
}

let mem: Memory;
let audit: MemoryAudit;
let rendered: CertificateData[];
let renderFails = false;
let clock: number;

const deps = (): CertificateDeps => ({
  ports: mem,
  audit,
  branding: { showPolice: false },
  now: () => (clock += 250),
  render: async (data) => {
    rendered.push(data);
    if (renderFails) throw new AppError('pdf_failed', 502);
    return Buffer.alloc(120 * 1024);
  },
});

beforeEach(() => {
  mem = new Memory();
  audit = new MemoryAudit();
  rendered = [];
  renderFails = false;
  clock = 0;
});

describe('generateCertificate', () => {
  it('renders, stores the PDF, marks the entry ready and audits it', async () => {
    const r = await generateCertificate(deps(), 'e1', actor, 'officer-1');
    expect(r).toEqual({ status: 'ready', generated: true });
    expect(mem.pdfs.get('e1.pdf')?.length).toBe(120 * 1024);
    expect(mem.status).toBe('ready');
    expect(mem.pdfPath).toBe('e1.pdf');
    expect(audit.events).toEqual([
      {
        action: 'certificate_generated',
        actorId: 'officer-1',
        actorCode: 'JP-0001',
        entryId: 'e1',
        meta: { ms: 250, kb: 120 },
      },
    ]);
  });

  it('passes the entry data to the renderer, with the photo when there is one', async () => {
    mem.claimResult = {
      ...claimed,
      photoPath: 'e1.jpg',
      violation: 'other',
      otherText: 'Triple riding',
    };
    mem.photos.set('e1.jpg', Buffer.from('JPEG'));
    await generateCertificate(deps(), 'e1', actor);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({
      certCode: 'EKZ-JPR-4ZK7MQ9',
      name: 'Ravi Kumar',
      areaName: 'C-Scheme, Jaipur',
      violation: 'other',
      otherText: 'Triple riding',
    });
    expect(rendered[0]!.createdAt.toISOString()).toBe('2026-10-30T09:51:00.000Z');
    expect(rendered[0]!.photoJpeg?.toString()).toBe('JPEG');
  });

  it('renders without a photo when the entry has none (and does not try to download one)', async () => {
    await generateCertificate(deps(), 'e1', actor);
    expect(rendered[0]!.photoJpeg).toBeNull();
    expect(mem.calls).not.toContain('downloadPhoto');
  });

  it('keeps personal data out of the audit trail', async () => {
    await generateCertificate(deps(), 'e1', actor);
    const text = JSON.stringify(audit.events);
    for (const secret of ['Ravi', 'Kumar', 'C-Scheme', 'EKZ-JPR'])
      expect(text).not.toContain(secret);
  });
});

describe('who can ask, and when', () => {
  it("answers 'not found' (not 'forbidden') for someone else's entry, and does not touch it", async () => {
    await expect(
      generateCertificate(deps(), 'e1', { id: 'officer-2', officerCode: 'JP-0002' }, 'officer-2'),
    ).rejects.toMatchObject({ status: 404 });
    expect(mem.calls).toEqual(['ownerOf']);
  });

  it('answers not found for an unknown entry', async () => {
    mem.owner = null;
    await expect(generateCertificate(deps(), 'nope', actor, 'officer-1')).rejects.toMatchObject({
      code: 'not_found',
    });
    mem.owner = 'officer-1';
    mem.claimResult = null;
    await expect(generateCertificate(deps(), 'nope', actor, 'officer-1')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('server-side callers can omit the owner check', async () => {
    await expect(
      generateCertificate(deps(), 'e1', { id: 'system', officerCode: null }),
    ).resolves.toMatchObject({ generated: true });
  });

  it('says busy while another render of the same entry is running, and renders nothing', async () => {
    mem.claimResult = { ...claimed, claimed: false, status: 'generating' };
    await expect(generateCertificate(deps(), 'e1', actor, 'officer-1')).rejects.toMatchObject({
      code: 'busy',
      status: 409,
    });
    expect(rendered).toHaveLength(0);
  });

  it.each(['ready', 'sending', 'sent', 'delivered', 'read'])(
    'leaves a %s entry alone and reports its status',
    async (status) => {
      mem.claimResult = { ...claimed, claimed: false, status };
      const r = await generateCertificate(deps(), 'e1', actor, 'officer-1');
      expect(r).toEqual({ status, generated: false });
      expect(rendered).toHaveLength(0);
      expect(mem.calls).not.toContain('markReady');
    },
  );

  it('refuses an entry whose data was already deleted', async () => {
    mem.claimResult = {
      ...claimed,
      claimed: false,
      purged: true,
      personName: null,
      areaName: null,
    };
    await expect(generateCertificate(deps(), 'e1', actor, 'officer-1')).rejects.toMatchObject({
      code: 'gone',
      status: 410,
    });
    expect(rendered).toHaveLength(0);
  });
});

describe('failures', () => {
  it('marks the entry failed, audits the stage, and tells the officer to retry', async () => {
    renderFails = true;
    await expect(generateCertificate(deps(), 'e1', actor, 'officer-1')).rejects.toMatchObject({
      code: 'pdf_failed',
      status: 502,
    });
    expect(mem.status).toBe('failed');
    expect(mem.errorCode).toBe('pdf_render');
    expect(mem.pdfs.size).toBe(0);
    expect(audit.events).toEqual([
      {
        action: 'certificate_failed',
        actorId: 'officer-1',
        actorCode: 'JP-0001',
        entryId: 'e1',
        meta: { stage: 'render' },
      },
    ]);
  });

  it('a photo that cannot be read fails at the prepare stage', async () => {
    mem.claimResult = { ...claimed, photoPath: 'missing.jpg' };
    await expect(generateCertificate(deps(), 'e1', actor, 'officer-1')).rejects.toMatchObject({
      code: 'pdf_failed',
    });
    expect(mem.errorCode).toBe('pdf_prepare');
    expect(rendered).toHaveLength(0);
  });

  it('a storage failure fails at the store stage and never marks the entry ready', async () => {
    mem.failStep = 'uploadPdf';
    await expect(generateCertificate(deps(), 'e1', actor, 'officer-1')).rejects.toThrow();
    expect(mem.errorCode).toBe('pdf_store');
    expect(mem.status).toBe('failed');
  });

  it('an entry without data fails instead of printing an empty certificate', async () => {
    mem.claimResult = { ...claimed, personName: null };
    await expect(generateCertificate(deps(), 'e1', actor, 'officer-1')).rejects.toMatchObject({
      code: 'pdf_failed',
    });
    expect(rendered).toHaveLength(0);
    expect(mem.status).toBe('failed');
  });

  it('still reports pdf_failed if recording the failure also fails', async () => {
    renderFails = true;
    mem.failStep = 'markFailed';
    await expect(generateCertificate(deps(), 'e1', actor, 'officer-1')).rejects.toMatchObject({
      code: 'pdf_failed',
    });
  });

  it('a retry after a failure goes through the same path and can succeed', async () => {
    renderFails = true;
    await expect(generateCertificate(deps(), 'e1', actor, 'officer-1')).rejects.toThrow();
    renderFails = false;
    await expect(generateCertificate(deps(), 'e1', actor, 'officer-1')).resolves.toMatchObject({
      status: 'ready',
    });
    expect(mem.status).toBe('ready');
  });
});
