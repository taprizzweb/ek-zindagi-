import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICE_LOGO_PATH, brandingFromEnv, type FileAccess } from '@/lib/pdf/branding';

// Logos must live inside the project directory, so the fixtures do too.
const dir = mkdtempSync(join(process.cwd(), 'tests', 'fixtures', 'brand-'));
const rel = (name: string) => relative(process.cwd(), join(dir, name));
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
writeFileSync(join(dir, 'ngo.png'), PNG);
writeFileSync(join(dir, 'police.jpg'), PNG);
writeFileSync(
  join(dir, 'logo.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
writeFileSync(join(dir, 'huge.png'), Buffer.alloc(400_000));
mkdirSync(join(dir, 'sub'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The two partner logos are always read (when present); the tests below are about the other files. */
const PARTNER = /(taprizz|arthjam)\.png$/;
const opened = (fn: unknown): string[] =>
  (fn as { mock: { calls: unknown[][] } }).mock.calls
    .map((c) => String(c[0]))
    .filter((p) => !PARTNER.test(p));

describe('brandingFromEnv', () => {
  it('shows nothing by default', () => {
    expect(brandingFromEnv({})).toEqual({
      showPolice: false,
      ngoLogoDataUri: null,
      policeLogoDataUri: null,
      partnerCreditText: null,
      design: 'a',
      taprizzLogoDataUri: expect.stringMatching(/^data:image\/png;base64,/), // shipped in assets/branding
      arthjamLogoDataUri: expect.stringMatching(/^data:image\/png;base64,/),
    });
  });

  it('design B only with the exact letter "b"; the partner logos load for either design, only if the files exist', () => {
    for (const v of [undefined, '', 'a', 'A', 'bb', 'c', 'true'])
      expect(brandingFromEnv({ CERTIFICATE_DESIGN: v }).design, String(v)).toBe('a');
    expect(brandingFromEnv({ CERTIFICATE_DESIGN: 'b' }).design).toBe('b');
    expect(brandingFromEnv({ CERTIFICATE_DESIGN: ' B ' }).design).toBe('b');
    const read: string[] = [];
    const files = {
      size: () => 10,
      read: (p: string) => {
        read.push(p);
        return Buffer.from('x');
      },
    };
    for (const design of [undefined, 'b']) {
      const b = brandingFromEnv({ CERTIFICATE_DESIGN: design }, files);
      expect(b.taprizzLogoDataUri).toMatch(/^data:image\/png;base64,/);
      expect(b.arthjamLogoDataUri).toMatch(/^data:image\/png;base64,/);
    }
    expect(read.some((p) => p.endsWith('taprizz.png'))).toBe(true);
    const missing = {
      size: () => {
        throw new Error('ENOENT');
      },
      read: () => Buffer.alloc(0),
    };
    const none = brandingFromEnv({ CERTIFICATE_DESIGN: 'b' }, missing);
    expect(none.taprizzLogoDataUri).toBeNull(); // no file yet: just left out
    expect(none.arthjamLogoDataUri).toBeNull();
  });

  it('only the exact value "true" switches police branding on', () => {
    for (const v of ['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', '']) {
      expect(brandingFromEnv({ SHOW_POLICE_BRANDING: v }).showPolice, JSON.stringify(v)).toBe(
        false,
      );
    }
    expect(brandingFromEnv({ SHOW_POLICE_BRANDING: 'true' }).showPolice).toBe(true);
  });

  it('with the flag off, the police logo file is never opened, whatever the path says', () => {
    const files: FileAccess = { size: vi.fn(() => 10), read: vi.fn(() => PNG) };
    for (const env of [
      {},
      { SHOW_POLICE_BRANDING: 'false', POLICE_LOGO_PATH: rel('police.jpg') },
      { SHOW_POLICE_BRANDING: 'TRUE', POLICE_LOGO_PATH: DEFAULT_POLICE_LOGO_PATH },
      { POLICE_LOGO_PATH: DEFAULT_POLICE_LOGO_PATH },
    ]) {
      const b = brandingFromEnv(env, files);
      expect(b.policeLogoDataUri).toBeNull();
    }
    expect(opened(files.size)).toEqual([]);
    expect(opened(files.read)).toEqual([]);
  });

  it('with the flag on, uses assets/branding/jaipur-police.png unless another path is set', () => {
    const seen: string[] = [];
    const files: FileAccess = { size: () => 10, read: (p) => (seen.push(p), PNG) };
    brandingFromEnv({ SHOW_POLICE_BRANDING: 'true' }, files);
    const others = () => seen.filter((p) => !PARTNER.test(p));
    expect(others()).toHaveLength(1);
    expect(others()[0]!.endsWith('assets/branding/jaipur-police.png')).toBe(true);
    seen.length = 0;
    brandingFromEnv({ SHOW_POLICE_BRANDING: 'true', POLICE_LOGO_PATH: rel('police.jpg') }, files);
    expect(others()[0]!.endsWith('police.jpg')).toBe(true);
  });

  it('the real default logo exists and loads when the flag is on', () => {
    const b = brandingFromEnv({ SHOW_POLICE_BRANDING: 'true' });
    expect(b.policeLogoDataUri).toMatch(/^data:image\/png;base64,/);
  });

  it('opens no NGO logo unless NGO_LOGO_PATH is set', () => {
    const files: FileAccess = { size: vi.fn(() => 10), read: vi.fn(() => PNG) };
    brandingFromEnv({ SHOW_POLICE_BRANDING: 'false' }, files);
    expect(opened(files.read)).toEqual([]);
    expect(brandingFromEnv({ NGO_LOGO_PATH: rel('ngo.png') }).ngoLogoDataUri).toBe(
      `data:image/png;base64,${PNG.toString('base64')}`,
    );
  });

  it.each([
    '../../etc/passwd',
    '/etc/passwd',
    '../ek-zindagi-/package.json',
    'tests/fixtures/../../../etc/hosts',
  ])('never reads a path outside the project: %s', (path) => {
    expect(brandingFromEnv({ NGO_LOGO_PATH: path }).ngoLogoDataUri).toBeNull();
    expect(
      brandingFromEnv({ SHOW_POLICE_BRANDING: 'true', POLICE_LOGO_PATH: path }).policeLogoDataUri,
    ).toBeNull();
  });

  it('refuses SVG (it can carry script), unknown types, folders, missing and oversized files', () => {
    for (const name of ['logo.svg', 'huge.png', 'sub', 'missing.png', 'ngo.png.exe']) {
      expect(brandingFromEnv({ NGO_LOGO_PATH: rel(name) }).ngoLogoDataUri, name).toBeNull();
    }
  });

  it('accepts a short, printable partner credit and drops anything else', () => {
    expect(
      brandingFromEnv({ PARTNER_CREDIT_TEXT: '  Acme Tech Pvt. Ltd.  ' }).partnerCreditText,
    ).toBe('Acme Tech Pvt. Ltd.');
    for (const bad of ['', '   ', 'x'.repeat(81), '<b>bold</b>', 'Acme 😀']) {
      expect(brandingFromEnv({ PARTNER_CREDIT_TEXT: bad }).partnerCreditText, bad).toBeNull();
    }
  });
});
