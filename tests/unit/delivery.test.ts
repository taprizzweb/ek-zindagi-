import { describe, expect, it, vi } from 'vitest';
import { VIOLATION_KEYS, VIOLATIONS } from '@/config/violations';
import type { AuditEvent, AuditSink } from '@/lib/audit/audit';
import {
  downloadCertificate,
  type DownloadEntry,
  type DownloadPorts,
} from '@/lib/certificates/download';
import {
  LINK_TTL_HOURS,
  prepareBridgeDelivery,
  type BridgeDeps,
  type BridgePorts,
  type SendCandidate,
} from '@/lib/delivery/bridge';
import { resolveCertificateLink, type LinkPorts } from '@/lib/delivery/link';
import { buildMessage, whatsappUrl, type MessageLanguage } from '@/lib/delivery/message';
import { hashToken, isWellFormedToken, newLinkToken } from '@/lib/delivery/token';
import { AppError } from '@/lib/errors';

const NOW = new Date('2026-10-30T10:00:00Z');
const actor = { id: 'officer-1', officerCode: 'JP-0001' };

describe('link tokens', () => {
  it('are 128 bits, base64url, 22 characters, never repeated', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const { token } = newLinkToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(16);
      seen.add(token);
    }
    expect(seen.size).toBe(5000);
  });
  it('store a hash, which is not the token and is stable', () => {
    const { token, hash } = newLinkToken(() => Buffer.alloc(16, 7));
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });
  it('are checked for shape before anything else', () => {
    expect(isWellFormedToken(newLinkToken().token)).toBe(true);
    for (const bad of [
      '',
      'short',
      'x'.repeat(21),
      'x'.repeat(23),
      '../../etc/passwd',
      'a/b' + 'c'.repeat(19),
      'x'.repeat(21) + '.',
      'x'.repeat(21) + ' ',
      'x'.repeat(21) + '%',
      '%2e%2e%2f' + 'x'.repeat(13),
    ]) {
      expect(isWellFormedToken(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('the WhatsApp message', () => {
  const languages: MessageLanguage[] = ['hinglish', 'hindi', 'english'];
  const link = 'https://app.example.org/c/AbCdEfGhIjKlMnOpQrStUv';

  it.each(languages)(
    '%s: says who it is from, that it is an illustration, a safety line, the code and how to stop',
    (language) => {
      const text = buildMessage({
        name: 'Ravi Kumar',
        certCode: 'EKZ-JPR-4ZK7MQ9',
        violation: 'helmet',
        link,
        language,
      });
      expect(text).toContain('Ravi Kumar');
      expect(text).toContain(link);
      expect(text).toContain('EKZ-JPR-4ZK7MQ9');
      expect(text).toContain(language === 'hindi' ? 'प्रोजेक्ट EK ZINDAGI' : 'Project EK ZINDAGI');
      expect(text).toContain('*STOP*');
      expect(text).toMatch(
        language === 'hindi'
          ? /जयपुर सड़क सुरक्षा जागरूकता शिविर/
          : /Jaipur road safety awareness camp/,
      );
      expect(text).toMatch(
        language === 'english'
          ? /hypothetical illustration, not an official document/
          : language === 'hindi'
            ? /काल्पनिक चित्रण/
            : /kaalpanik chitran/,
      );
      expect(text).toMatch(
        language === 'hindi' ? /24 घंटे/ : language === 'english' ? /24 hours/ : /24 ghante/,
      );
    },
  );

  it('never mentions a challan, fine, penalty, police action or the violation as an offence, in any language or for any violation', () => {
    for (const language of languages) {
      for (const violation of VIOLATION_KEYS) {
        for (const l of [link, undefined]) {
          const text = buildMessage({
            name: 'Ravi Kumar',
            certCode: 'EKZ-JPR-4ZK7MQ9',
            violation,
            link: l,
            language,
          });
          expect(text, `${language} ${violation}`).not.toMatch(
            /\b(challan|e-challan|fine|fines|penalty|penalties|prosecut\w*|offen[cs]e|violation|ticket|court)\b/i,
          );
          expect(text).not.toMatch(/चालान|जुर्माना|दंड|ज़ुर्माना|उल्लंघन|अपराध/);
          expect(text).not.toMatch(/\b(deceased|rip|late)\b/i);
          expect(text).not.toMatch(/chalaan|jurmana|jurmaana|dand\b/i);
        }
      }
    }
  });

  it('has exactly one safety line, the one for the chosen violation', () => {
    for (const v of VIOLATIONS) {
      const t = buildMessage({
        name: 'A B',
        certCode: 'C',
        violation: v.key,
        link,
        language: 'hinglish',
      });
      expect(t).toContain(v.lineHinglish);
      const others = VIOLATIONS.filter((o) => o.lineHinglish !== v.lineHinglish);
      for (const o of others) expect(t).not.toContain(o.lineHinglish);
    }
  });

  it('is short enough to read on one screen', () => {
    for (const language of languages) {
      expect(
        buildMessage({
          name: 'Ramachandran Venkataraghavan Iyer Jr',
          certCode: 'EKZ-JPR-4ZK7MQ9',
          violation: 'child_helmet',
          link,
          language,
        }).length,
      ).toBeLessThan(600);
    }
  });

  it('without a link (cloud API mode) says the certificate is attached and has no link line', () => {
    const text = buildMessage({
      name: 'A B',
      certCode: 'C',
      violation: 'helmet',
      language: 'hinglish',
    });
    expect(text).toContain('attached hai');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('24 ghante');
  });

  it('builds the wa.me address with the number and the encoded text', () => {
    const url = whatsappUrl('+919876543210', 'Namaste Ravi ji 🙏\nCode: X & Y');
    expect(url.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    expect(decodeURIComponent(url.split('?text=')[1]!)).toBe('Namaste Ravi ji 🙏\nCode: X & Y');
    expect(url).not.toContain('+');
    expect(url).not.toContain(' ');
  });
});

class Bridge implements BridgePorts {
  entry: SendCandidate | null = {
    officerId: 'officer-1',
    status: 'ready',
    purged: false,
    phoneE164: '+919876543210',
    phoneHash: 'h'.repeat(64),
    personName: 'Ravi Kumar',
    violation: 'helmet',
    certCode: 'EKZ-JPR-4ZK7MQ9',
    pdfPath: 'e1.pdf',
  };
  optedOut = false;
  limited = false;
  links: { entryId: string; hash: string; expiresAt: Date }[] = [];
  handedOver: string[] = [];
  async loadForSend() {
    return this.entry;
  }
  async isOptedOut() {
    return this.optedOut;
  }
  async rateLimit() {
    return !this.limited;
  }
  async createLink(entryId: string, hash: string, expiresAt: Date) {
    this.links.push({ entryId, hash, expiresAt });
  }
  async markHandedOver(id: string) {
    this.handedOver.push(id);
  }
}
class Audit implements AuditSink {
  events: AuditEvent[] = [];
  async record(e: AuditEvent) {
    this.events.push(e);
  }
}
const bridgeDeps = (ports: Bridge, audit = new Audit()): BridgeDeps => ({
  ports,
  audit,
  baseUrl: 'https://app.example.org/',
  language: 'hinglish',
  maxPerOfficerHour: 60,
  newToken: () => ({ token: 'T'.repeat(22), hash: 'a'.repeat(64) }),
  now: () => NOW,
});

describe('prepareBridgeDelivery', () => {
  it('makes a link that expires in exactly 24 hours and the wa.me address with the message', async () => {
    const ports = new Bridge();
    const audit = new Audit();
    const r = await prepareBridgeDelivery(bridgeDeps(ports, audit), 'e1', actor, 'officer-1');
    expect(LINK_TTL_HOURS).toBe(24);
    expect(r.expiresAt).toBe('2026-10-31T10:00:00.000Z');
    expect(ports.links).toEqual([
      { entryId: 'e1', hash: 'a'.repeat(64), expiresAt: new Date('2026-10-31T10:00:00Z') },
    ]);
    expect(r.linkUrl).toBe(`https://app.example.org/c/${'T'.repeat(22)}`); // no double slash
    expect(r.waUrl.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    expect(decodeURIComponent(r.waUrl.split('?text=')[1]!)).toBe(r.message);
    expect(r.message).toContain(r.linkUrl);
    expect(r.message).toContain('Ravi Kumar');
  });

  it('stores only the hash, never the token, and the token appears only in the link', async () => {
    const ports = new Bridge();
    await prepareBridgeDelivery(bridgeDeps(ports), 'e1', actor, 'officer-1');
    expect(JSON.stringify(ports.links)).not.toContain('T'.repeat(22));
  });

  it('marks the entry as handed over (not delivered) and audits without personal data', async () => {
    const ports = new Bridge();
    const audit = new Audit();
    await prepareBridgeDelivery(bridgeDeps(ports, audit), 'e1', actor, 'officer-1');
    expect(ports.handedOver).toEqual(['e1']);
    expect(audit.events).toEqual([
      {
        action: 'delivery_prepared',
        actorId: 'officer-1',
        actorCode: 'JP-0001',
        entryId: 'e1',
        meta: { mode: 'bridge' },
      },
    ]);
    const text = JSON.stringify(audit.events);
    for (const s of ['Ravi', '9876543210', 'TTTT']) expect(text).not.toContain(s);
  });

  it('can be repeated (a resend makes a new link)', async () => {
    const ports = new Bridge();
    ports.entry!.status = 'sent';
    await expect(
      prepareBridgeDelivery(bridgeDeps(ports), 'e1', actor, 'officer-1'),
    ).resolves.toBeTruthy();
  });

  it("answers not found for someone else's entry and does nothing", async () => {
    const ports = new Bridge();
    await expect(
      prepareBridgeDelivery(
        bridgeDeps(ports),
        'e1',
        { id: 'officer-2', officerCode: null },
        'officer-2',
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(ports.links).toHaveLength(0);
    ports.entry = null;
    await expect(
      prepareBridgeDelivery(bridgeDeps(ports), 'e1', actor, 'officer-1'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each(['saved', 'generating', 'failed'])(
    'refuses an entry whose certificate is %s',
    async (status) => {
      const ports = new Bridge();
      ports.entry!.status = status;
      await expect(
        prepareBridgeDelivery(bridgeDeps(ports), 'e1', actor, 'officer-1'),
      ).rejects.toMatchObject({ code: 'not_ready', status: 409 });
      expect(ports.links).toHaveLength(0);
    },
  );

  it('refuses an entry whose data was deleted', async () => {
    const ports = new Bridge();
    ports.entry = {
      ...ports.entry!,
      purged: true,
      phoneE164: null,
      personName: null,
      pdfPath: null,
    };
    await expect(
      prepareBridgeDelivery(bridgeDeps(ports), 'e1', actor, 'officer-1'),
    ).rejects.toMatchObject({ code: 'gone', status: 410 });
  });

  it('refuses a number that has opted out since the entry was made', async () => {
    const ports = new Bridge();
    ports.optedOut = true;
    await expect(
      prepareBridgeDelivery(bridgeDeps(ports), 'e1', actor, 'officer-1'),
    ).rejects.toMatchObject({ code: 'opted_out' });
    expect(ports.links).toHaveLength(0);
    expect(ports.handedOver).toHaveLength(0);
  });

  it('is rate limited per officer', async () => {
    const ports = new Bridge();
    ports.limited = true;
    await expect(
      prepareBridgeDelivery(bridgeDeps(ports), 'e1', actor, 'officer-1'),
    ).rejects.toMatchObject({ status: 429 });
    expect(ports.links).toHaveLength(0);
  });
});

class Links implements LinkPorts {
  result: { status: 'ok' | 'expired' | 'gone'; pdfPath: string | null } | null = {
    status: 'ok',
    pdfPath: 'e1.pdf',
  };
  limited = false;
  opened: string[] = [];
  downloaded: string[] = [];
  async rateLimit() {
    return !this.limited;
  }
  async open(hash: string) {
    this.opened.push(hash);
    return this.result;
  }
  async downloadPdf(path: string) {
    this.downloaded.push(path);
    return Buffer.from(`PDF:${path}`);
  }
}
const resolve = (p: Links, token = 'T'.repeat(22)) =>
  resolveCertificateLink({ ports: p, maxPerIp10Min: 30 }, token, '1.2.3.4');

describe('resolveCertificateLink', () => {
  it('serves the PDF that belongs to the token, and only that one', async () => {
    const p = new Links();
    expect((await resolve(p)).toString()).toBe('PDF:e1.pdf');
    expect(p.downloaded).toEqual(['e1.pdf']);
    expect(p.opened).toEqual([hashToken('T'.repeat(22))]);
  });

  it('never looks anything up for a malformed token (no path can be smuggled in)', async () => {
    const p = new Links();
    for (const bad of ['../../etc/passwd', '..%2f..%2fetc', 'e1.pdf', '*', 'a'.repeat(300), '']) {
      await expect(resolve(p, bad), bad).rejects.toMatchObject({ status: 404 });
    }
    expect(p.opened).toHaveLength(0);
    expect(p.downloaded).toHaveLength(0);
  });

  it('answers 404 for an unknown token', async () => {
    const p = new Links();
    p.result = null;
    await expect(resolve(p)).rejects.toMatchObject({ status: 404 });
    expect(p.downloaded).toHaveLength(0);
  });

  it.each(['expired', 'gone'] as const)(
    'answers 410 for a link that is %s, and serves no file',
    async (status) => {
      const p = new Links();
      p.result = { status, pdfPath: null };
      await expect(resolve(p)).rejects.toMatchObject({ status: 410 });
      expect(p.downloaded).toHaveLength(0);
    },
  );

  it('is rate limited per IP, before any lookup', async () => {
    const p = new Links();
    p.limited = true;
    await expect(resolve(p)).rejects.toMatchObject({ status: 429 });
    expect(p.opened).toHaveLength(0);
  });

  it('takes the file path from the database, not from the request', async () => {
    const p = new Links();
    p.result = { status: 'ok', pdfPath: 'only-this-entry.pdf' };
    await resolve(p, 'Z'.repeat(22));
    expect(p.downloaded).toEqual(['only-this-entry.pdf']);
  });
});

describe('downloadCertificate', () => {
  const entry: DownloadEntry = {
    officerId: 'officer-1',
    status: 'ready',
    purged: false,
    certCode: 'EKZ-JPR-4ZK7MQ9',
    personName: 'Ravi Kumar',
    areaName: 'C-Scheme, Jaipur',
    violation: 'helmet',
    otherText: null,
    photoPath: 'e1.jpg',
    pdfPath: 'e1.pdf',
    createdAt: '2026-10-30T10:00:00.000Z',
  };
  const setup = (over: Partial<DownloadEntry> | null = {}) => {
    const audit = new Audit();
    const renderPng = vi.fn(async () => Buffer.from('PNG'));
    const ports: DownloadPorts = {
      load: async () => (over === null ? null : { ...entry, ...over }),
      downloadPdf: async (p) => Buffer.from(`PDF:${p}`),
      downloadPhoto: async (p) => Buffer.from(`PHOTO:${p}`),
    };
    return { audit, renderPng, deps: { ports, audit, renderPng, branding: { showPolice: false } } };
  };

  it('gives the stored PDF as a named download and audits it without personal data', async () => {
    const { deps, audit } = setup();
    const r = await downloadCertificate(deps, 'e1', 'pdf', actor);
    expect(r).toMatchObject({
      contentType: 'application/pdf',
      filename: 'EK-ZINDAGI-EKZ-JPR-4ZK7MQ9.pdf',
    });
    expect(r.bytes.toString()).toBe('PDF:e1.pdf');
    expect(audit.events).toEqual([
      {
        action: 'certificate_downloaded',
        actorId: 'officer-1',
        actorCode: 'JP-0001',
        entryId: 'e1',
        meta: { format: 'pdf' },
      },
    ]);
  });

  it('renders the image from the entry data, with the photo', async () => {
    const { deps, renderPng } = setup();
    const r = await downloadCertificate(deps, 'e1', 'image', actor);
    expect(r).toMatchObject({
      contentType: 'image/png',
      filename: 'EK-ZINDAGI-EKZ-JPR-4ZK7MQ9.png',
    });
    expect(renderPng).toHaveBeenCalledTimes(1);
    const data = (renderPng.mock.calls[0] as unknown as [{ name: string; photoJpeg: Buffer }])[0];
    expect(data.name).toBe('Ravi Kumar');
    expect(data.photoJpeg.toString()).toBe('PHOTO:e1.jpg');
  });

  it("answers not found for another officer's entry and audits nothing", async () => {
    const { deps, audit } = setup({ officerId: 'officer-2' });
    await expect(downloadCertificate(deps, 'e1', 'pdf', actor)).rejects.toMatchObject({
      status: 404,
    });
    expect(audit.events).toHaveLength(0);
    await expect(downloadCertificate(setup(null).deps, 'e1', 'pdf', actor)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses before the certificate is ready, and after the data is deleted', async () => {
    await expect(
      downloadCertificate(setup({ status: 'generating', pdfPath: null }).deps, 'e1', 'pdf', actor),
    ).rejects.toMatchObject({ code: 'not_ready' });
    await expect(
      downloadCertificate(
        setup({ purged: true, pdfPath: null, personName: null }).deps,
        'e1',
        'image',
        actor,
      ),
    ).rejects.toMatchObject({ code: 'gone', status: 410 });
  });

  it('a failure to produce the file is not audited as a download', async () => {
    const { deps, audit } = setup();
    deps.renderPng.mockRejectedValueOnce(new AppError('pdf_failed', 502));
    await expect(downloadCertificate(deps, 'e1', 'image', actor)).rejects.toMatchObject({
      code: 'pdf_failed',
    });
    expect(audit.events).toHaveLength(0);
  });
});
