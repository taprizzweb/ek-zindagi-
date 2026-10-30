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

describe('brandingFromEnv', () => {
  it('shows nothing by default', () => {
    expect(brandingFromEnv({})).toEqual({
      showPolice: false,
      ngoLogoDataUri: null,
      policeLogoDataUri: null,
      partnerCreditText: null,
    });
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
    expect(files.size).not.toHaveBeenCalled();
    expect(files.read).not.toHaveBeenCalled();
  });

  it('with the flag on, uses reference/police_logo.png unless another path is set', () => {
    const opened: string[] = [];
    const files: FileAccess = { size: () => 10, read: (p) => (opened.push(p), PNG) };
    brandingFromEnv({ SHOW_POLICE_BRANDING: 'true' }, files);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.endsWith(`${'reference'}/police_logo.png`)).toBe(true);
    opened.length = 0;
    brandingFromEnv({ SHOW_POLICE_BRANDING: 'true', POLICE_LOGO_PATH: rel('police.jpg') }, files);
    expect(opened[0]!.endsWith('police.jpg')).toBe(true);
  });

  it('the real default logo exists and loads when the flag is on', () => {
    const b = brandingFromEnv({ SHOW_POLICE_BRANDING: 'true' });
    expect(b.policeLogoDataUri).toMatch(/^data:image\/png;base64,/);
  });

  it('opens no NGO logo unless NGO_LOGO_PATH is set', () => {
    const files: FileAccess = { size: vi.fn(() => 10), read: vi.fn(() => PNG) };
    brandingFromEnv({ SHOW_POLICE_BRANDING: 'false' }, files);
    expect(files.read).not.toHaveBeenCalled();
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
