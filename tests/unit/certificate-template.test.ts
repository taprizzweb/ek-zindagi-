import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDateParts } from '@/components/certificate/certificate-data';
import { fitAll } from '@/components/certificate/fit';
import { CERTIFICATE_CHECKLIST, CERTIFICATE_TEXT } from '@/config/certificate';
import { VIOLATION_KEYS } from '@/config/violations';
import { FONT_FACES, fontFaceCssForBrowser } from '@/lib/pdf/fonts';
import {
  buildCertificateHtml,
  fitScript,
  type Branding,
  type CertificateData,
} from '@/lib/pdf/template';

const base: CertificateData = {
  certCode: 'EKZ-JPR-4ZK7MQ9',
  name: 'Ravi Kumar',
  violation: 'helmet',
  areaName: 'C-Scheme, Jaipur',
  createdAt: new Date('2026-10-30T10:42:00Z'), // 04:12 PM IST
};

const POLICE: Branding = {
  showPolice: true,
  policeLogoDataUri: 'data:image/png;base64,POLICELOGO',
};
const brandings: Branding[] = [
  { showPolice: false },
  POLICE,
  {
    showPolice: true,
    ngoLogoDataUri: 'data:image/png;base64,NGOLOGO',
    policeLogoDataUri: 'data:image/png;base64,POLICELOGO',
    partnerCreditText: 'Some Partner',
  },
  { showPolice: false, ngoLogoDataUri: null, partnerCreditText: null },
];

/** Visible text of the page, without styles, script or data URIs. */
function visibleText(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<script>[\s\S]*?<\/script>/g, ' ')
    .replace(/<title>[\s\S]*?<\/title>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

/** The certificate markup only: no CSS (which names classes such as c-logo-police) and no script. */
function markup(html: string): string {
  return html.slice(html.indexOf('<body>')).replace(/<script>[\s\S]*?<\/script>/g, '');
}

const MUST_HAVE = [
  'class="stamp"',
  'FOR AWARENESS<br/>PURPOSE ONLY',
  'class="wm">AWARENESS ONLY</div>',
  `class="disc">${CERTIFICATE_TEXT.disclaimer}</div>`,
];

describe('hard rules: stamp, watermark and disclaimer are always in the certificate', () => {
  it('for every violation, with and without a photo, with every branding combination', () => {
    for (const violation of VIOLATION_KEYS) {
      for (const photoJpeg of [null, Buffer.from('jpeg')]) {
        for (const branding of brandings) {
          const html = buildCertificateHtml({ ...base, violation, photoJpeg }, branding);
          for (const needle of MUST_HAVE) expect(html, `${violation}: ${needle}`).toContain(needle);
        }
      }
    }
  });

  it('for hostile and awkward input', () => {
    const awkward = [
      '<script>alert(1)</script>',
      '</div><div class="disc">fake</div>',
      '"><img src=x onerror=alert(1)>',
      '&amp; &lt;',
      'रवि कुमार',
      'x'.repeat(500),
      '‮RTL',
      '',
    ];
    for (const s of awkward) {
      const html = buildCertificateHtml({ ...base, name: s, areaName: s, certCode: s });
      for (const needle of MUST_HAVE) expect(html).toContain(needle);
      expect(html.match(/class="disc"/g)).toHaveLength(1); // no injected look-alike element
      expect(html.match(/<script/g)).toHaveLength(1); // only our own fit script
      expect(html).not.toContain('<img src=x');
    }
  });

  it('the stamp reads "FOR AWARENESS PURPOSE ONLY" and the word HYPOTHETICAL appears nowhere', () => {
    const html = buildCertificateHtml(base);
    const stamp = /<div class="stamp">([\s\S]*?)<\/div>/.exec(html)![1]!;
    expect(stamp).toBe('FOR AWARENESS<br/>PURPOSE ONLY');
    expect(stamp).not.toMatch(/hypothetical/i);
    expect(visibleText(html)).not.toMatch(/hypothetical/i);
  });
});

describe('the checklist', () => {
  it('has the seven violations once each, in the approved two columns', () => {
    expect(CERTIFICATE_CHECKLIST.map((c) => c.key).sort()).toEqual([...VIOLATION_KEYS].sort());
    expect(CERTIFICATE_CHECKLIST.filter((c) => c.column === 1).map((c) => c.label)).toEqual([
      'Rider without helmet',
      'Child without helmet on scooter',
      'Overspeeding',
      'Other traffic violation',
    ]);
    expect(CERTIFICATE_CHECKLIST.filter((c) => c.column === 2).map((c) => c.label)).toEqual([
      'Driver without seatbelt',
      'Driving on the wrong side',
      'Mobile phone while driving',
    ]);
  });

  it.each(VIOLATION_KEYS)('fills only the box of the chosen violation (%s)', (violation) => {
    const html = buildCertificateHtml({ ...base, violation });
    const boxes = [
      ...html.matchAll(
        /<div class="opt( sel)?" data-checked="(true|false)"><i><\/i><span>([^<]+)<\/span>/g,
      ),
    ];
    expect(boxes).toHaveLength(7);
    const checked = boxes.filter((m) => m[2] === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]![3]).toBe(CERTIFICATE_CHECKLIST.find((c) => c.key === violation)!.label);
    expect(boxes.filter((m) => m[1] === ' sel')).toHaveLength(1);
  });
});

describe('wording', () => {
  it('never says challan, fine, penalty, deceased, RIP or late, for any violation or branding', () => {
    for (const violation of VIOLATION_KEYS) {
      for (const branding of brandings) {
        const text = visibleText(buildCertificateHtml({ ...base, violation }, branding));
        expect(text, violation).not.toMatch(
          /\b(challan|e-challan|fine|fines|penalty|penalties|deceased|rip|late)\b/i,
        );
        expect(text).not.toMatch(/government of|satyameva|भारत सरकार|मृत|श्रद्धांजलि/i);
      }
    }
  });

  it('says what the design says', () => {
    const text = visibleText(buildCertificateHtml(base));
    for (const s of [
      'ONE MISTAKE AWAY',
      'Certificate of recklessness on road',
      'This certifies that',
      'Ravi Kumar',
      'was caught on camera on',
      'while committing this traffic offence:',
      'This could have been your last ride.',
      'Road Safety Awareness Campaign',
      'Project EK ZINDAGI by Taprizz × Chitrakatha (homestay)',
      'Issued at Jaipur',
      'Certificate No. EKZ-JPR-4ZK7MQ9',
      CERTIFICATE_TEXT.disclaimer,
    ]) {
      expect(text, s).toContain(s);
    }
  });

  it('prints date and time together, in Indian Standard Time', () => {
    const html = buildCertificateHtml(base);
    expect(html).toContain('30 October 2026<br/>04:12 PM');
  });

  it('does not print the old per-violation lines or the Hindi slogan', () => {
    const text = visibleText(buildCertificateHtml(base));
    expect(text).not.toContain('Someone is waiting for you at home');
    expect(text).not.toContain('एक ज़िंदगी');
    expect(text).not.toContain('YOUR NEXT MISTAKE');
    for (const gone of [
      'MIGHT DIE SOON',
      'was last seen alive',
      'The next frame will not be a joke',
      'Issued by Jaipur Traffic Police',
      'Traffic Inspector',
    ])
      expect(text).not.toContain(gone);
  });
});

describe('police branding', () => {
  it('is never printed: no police name, no police logo, whatever the branding says', () => {
    for (const branding of [...brandings, POLICE, { showPolice: true }]) {
      const html = buildCertificateHtml(base, branding);
      expect(html).not.toContain('POLICELOGO');
      expect(markup(html)).not.toContain('c-logo-police');
      expect(html).not.toContain('Traffic Inspector');
      expect(html).not.toContain('Jaipur Traffic Police');
      expect(html).toContain('<div class="c-sub">Certificate of recklessness on road</div>');
      expect(html).toContain('<div class="br">Road Safety Awareness Campaign</div>');
    }
  });

  it('NGO logo and partner credit show only when configured, partner text is escaped', () => {
    expect(markup(buildCertificateHtml(base))).not.toMatch(/c-logo-ngo|Technology Partner/);
    const html = buildCertificateHtml(base, {
      showPolice: false,
      ngoLogoDataUri: 'data:image/png;base64,NGOLOGO',
      partnerCreditText: 'Acme <Tech>',
    });
    expect(html).toContain('NGOLOGO');
    expect(html).toContain('Technology Partner: Acme &lt;Tech&gt;');
  });
});

describe('the page that is printed', () => {
  it('has exactly one script, identical for every certificate, with no data in it', () => {
    const a = buildCertificateHtml(base);
    const b = buildCertificateHtml({
      ...base,
      name: 'Someone Else',
      areaName: 'Elsewhere',
      certCode: 'EKZ-JPR-AAAAAAA',
      violation: 'mobile',
    });
    const script = (h: string) => /<script>([\s\S]*?)<\/script>/.exec(h)![1];
    expect(a.match(/<script/g)).toHaveLength(1);
    expect(script(a)).toBe(script(b));
    expect(script(a)).toBe(fitScript());
    for (const s of ['Ravi', 'C-Scheme', 'EKZ-JPR']) expect(script(a)).not.toContain(s);
  });

  it('loads nothing from outside: no http(s) resource, no import, no external font', () => {
    const html = buildCertificateHtml(base, {
      showPolice: true,
      ngoLogoDataUri: 'data:image/png;base64,AAAA',
      policeLogoDataUri: 'data:image/png;base64,BBBB',
      partnerCreditText: 'P',
    });
    expect(html).not.toMatch(/(src|href)\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).toContain('data:font/woff2;base64,');
  });

  it('uses no inline style attributes (the web app forbids them in its CSP)', () => {
    const html = buildCertificateHtml(base, POLICE);
    const body = html.slice(html.indexOf('<body>'));
    expect(body.replace(/<script>[\s\S]*?<\/script>/, '')).not.toMatch(/\sstyle=/);
  });

  it('is landscape, 1123 x 794 px', () => {
    const html = buildCertificateHtml(base);
    expect(html).toContain('@page{size:1123px 794px;margin:0}');
  });
});

describe('the shared fit function', () => {
  it('is self-contained, so it can be inlined into the printed page', () => {
    const source = fitAll.toString();
    expect(source).toMatch(/^function fitAll\(/);
    expect(source).not.toMatch(/\b(import|require|__name)\b/);
    expect(() => new Function(`return (${source})`)).not.toThrow();
  });
});

describe('date format', () => {
  it.each([
    ['2026-10-30T10:42:00Z', '30 October 2026', '04:12 PM'],
    ['2026-10-30T18:30:00Z', '31 October 2026', '12:00 AM'], // IST midnight is already the next day
    ['2026-10-30T06:30:00Z', '30 October 2026', '12:00 PM'],
    ['2026-09-05T00:05:00Z', '05 September 2026', '05:35 AM'],
    ['2026-12-31T20:00:00Z', '01 January 2027', '01:30 AM'],
  ])('%s -> %s, %s', (iso, dateText, timeText) => {
    expect(formatDateParts(new Date(iso))).toEqual({ dateText, timeText });
  });
});

describe('fonts', () => {
  it('the browser stylesheet is generated from the same list as the PDF fonts', () => {
    const css = readFileSync('src/components/certificate/certificate-fonts.css', 'utf8');
    expect(css).toContain(fontFaceCssForBrowser());
  });
  it('every font file exists', () => {
    for (const f of FONT_FACES) expect(() => readFileSync(`public/fonts/${f.file}`)).not.toThrow();
  });
  it('covers the families the design uses', () => {
    expect(new Set(FONT_FACES.map((f) => f.family))).toEqual(
      new Set(['Anton', 'Libre Baskerville', 'EKZ Deva', 'EKZ Deva Bold']),
    );
  });
});
