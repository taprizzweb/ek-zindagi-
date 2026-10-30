import { describe, expect, it } from 'vitest';
import { VIOLATION_KEYS } from '@/config/violations';
import { garlandPoints, garlandSvg } from '@/lib/pdf/garland';
import {
  buildCertificateHtml,
  escapeHtml,
  formatCertificateDateTime,
  nameFontPt,
  type Branding,
  type CertificateData,
} from '@/lib/pdf/template';

const base: CertificateData = {
  certCode: 'EKZ-JPR-4ZK7MQ9',
  name: 'Ravi Kumar',
  violation: 'helmet',
  areaName: 'C-Scheme, Jaipur, Rajasthan',
  createdAt: new Date('2026-10-30T09:51:00Z'),
};

const MUST_HAVE = [
  'Disclaimer:',
  'It is not a death certificate, accident report or any legal or official record.',
  'No harm has occurred to the person named above.',
  'class="stamp"',
  'FOR AWARENESS<br>PURPOSE ONLY<br>(HYPOTHETICAL)',
  'class="wm"',
  'FOR AWARENESS PURPOSE ONLY<br>NOT A LEGAL DOCUMENT',
];

function brandings(): Branding[] {
  return [
    { showPolice: false },
    { showPolice: true },
    {
      showPolice: true,
      ngoLogoDataUri: 'data:image/png;base64,AAAA',
      policeLogoDataUri: 'data:image/png;base64,BBBB',
      partnerCreditText: 'Some Partner',
    },
    { showPolice: false, ngoLogoDataUri: null, partnerCreditText: null },
  ];
}

describe('hard rules: disclaimer, stamp and watermark are always in the template', () => {
  it('for every violation, with and without a photo, with every branding combination', () => {
    for (const violation of VIOLATION_KEYS) {
      for (const photoJpeg of [null, Buffer.from('jpeg')]) {
        for (const branding of brandings()) {
          const html = buildCertificateHtml(
            {
              ...base,
              violation,
              otherText: violation === 'other' ? 'Triple riding' : null,
              photoJpeg,
            },
            branding,
          );
          for (const needle of MUST_HAVE) expect(html, `${violation} ${needle}`).toContain(needle);
        }
      }
    }
  });

  it('for hostile and awkward input', () => {
    const awkward = [
      '<script>alert(1)</script>',
      '</div><div class="disc" style="display:none">',
      '"><img src=x onerror=alert(1)>',
      '&amp; &lt; &#39;',
      'रवि कुमार',
      'x'.repeat(500),
      '‮RTL override',
      '',
    ];
    for (const s of awkward) {
      const html = buildCertificateHtml({
        ...base,
        name: s,
        areaName: s,
        otherText: s,
        violation: 'other',
        certCode: s,
      });
      for (const needle of MUST_HAVE) expect(html).toContain(needle);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<img src=x');
      expect(html.match(/class="disc"/g)).toHaveLength(1); // no injected look-alike element
      expect(html).not.toContain('<div class="disc" style');
    }
  });

  it('contains no script at all and no external resources', () => {
    const html = buildCertificateHtml(base, {
      showPolice: true,
      ngoLogoDataUri: 'data:image/png;base64,AAAA',
      partnerCreditText: 'P',
    });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
    expect(html).not.toMatch(/@import/i);
  });
});

describe('wording rules', () => {
  it('never uses wording that makes the certificate look like a real record', () => {
    const html = buildCertificateHtml(base)
      .replace(/<style>[\s\S]*?<\/style>/, '')
      .replace(/data:[^"')]+/g, '');
    const text = html.replace(/<[^>]+>/g, ' ');
    // The disclaimer itself says "not a death certificate"; everything else must avoid these words.
    const withoutDisclaimer = text.replace(/Disclaimer:[\s\S]*?named above\./, '');
    expect(withoutDisclaimer).not.toMatch(/\b(late|rip|deceased|death|died|demise|obituary)\b/i);
    expect(html).not.toMatch(/government of|satyameva|emblem|हिंदी|भारत सरकार/i);
  });
});

describe('content', () => {
  it('shows name, violation, place, code, date and the violation line', () => {
    const html = buildCertificateHtml(base);
    expect(html).toContain('Ravi Kumar');
    expect(html).toContain('Riding without a helmet');
    expect(html).toContain('C-Scheme, Jaipur, Rajasthan');
    expect(html).toContain('30 Oct 2026, 03:21 PM');
    expect(html).toContain('Wear your helmet. Someone is waiting for you at home.');
    expect(html).toContain('एक ज़िंदगी, एक ही मौका — सड़क पर सावधानी रखें।');
    expect(html.match(/EKZ-JPR-4ZK7MQ9/g)!.length).toBeGreaterThanOrEqual(3); // title, reference, certificate no.
  });
  it('shows the specific text for an "other" violation', () => {
    const html = buildCertificateHtml({ ...base, violation: 'other', otherText: 'Triple riding' });
    expect(html).toContain('Other traffic violation: Triple riding');
    expect(html).toContain('Follow the rules. Someone is waiting for you at home.');
  });
  it('uses a silhouette without a photo and the photo when there is one', () => {
    expect(buildCertificateHtml(base)).toContain('<circle cx="50" cy="48"');
    const withPhoto = buildCertificateHtml({ ...base, photoJpeg: Buffer.from('abc') });
    expect(withPhoto).toContain(`data:image/jpeg;base64,${Buffer.from('abc').toString('base64')}`);
    expect(withPhoto).not.toContain('<circle cx="50" cy="48"');
  });
  it('escapes everything it prints', () => {
    const html = buildCertificateHtml({ ...base, name: 'A <b>&"\'' });
    expect(html).toContain('A &lt;b&gt;&amp;&quot;&#39;');
    expect(html).not.toContain('<b>&');
  });
});

describe('branding gating', () => {
  it('shows no police name or logo, no NGO logo and no partner credit by default', () => {
    const html = buildCertificateHtml(base);
    expect(html).not.toMatch(/police/i);
    expect(html).not.toContain('Technology Partner');
    expect(html).toContain('EK ZINDAGI CAMPAIGN');
  });
  it('ignores a police logo when police branding is off', () => {
    const html = buildCertificateHtml(base, {
      showPolice: false,
      policeLogoDataUri: 'data:image/png;base64,POLICELOGO',
    });
    expect(html).not.toContain('POLICELOGO');
    expect(html).not.toMatch(/police/i);
  });
  it('shows the police line and logo only when switched on', () => {
    const html = buildCertificateHtml(base, {
      showPolice: true,
      policeLogoDataUri: 'data:image/png;base64,POLICELOGO',
    });
    expect(html).toContain('In association with Rajasthan Police');
    expect(html).toContain('POLICELOGO');
  });
  it('shows the NGO logo and partner credit when configured', () => {
    const html = buildCertificateHtml(base, {
      showPolice: false,
      ngoLogoDataUri: 'data:image/png;base64,NGOLOGO',
      partnerCreditText: 'Acme <Tech>',
    });
    expect(html).toContain('NGOLOGO');
    expect(html).toContain('Technology Partner: Acme &lt;Tech&gt;');
  });
});

describe('formatCertificateDateTime', () => {
  it.each([
    ['2026-10-30T09:51:00Z', '30 Oct 2026, 03:21 PM'],
    ['2026-10-30T18:30:00Z', '31 Oct 2026, 12:00 AM'], // IST midnight is the next day
    ['2026-10-30T06:30:00Z', '30 Oct 2026, 12:00 PM'],
    ['2026-09-05T00:05:00Z', '05 Sep 2026, 05:35 AM'],
    ['2026-12-31T20:00:00Z', '01 Jan 2027, 01:30 AM'],
  ])('%s -> %s', (iso, expected) => {
    expect(formatCertificateDateTime(new Date(iso))).toBe(expected);
  });
});

describe('layout helpers', () => {
  it('shrinks long names, never grows past the reference size', () => {
    expect(nameFontPt('Ravi Kumar')).toBe(22);
    expect(nameFontPt('x'.repeat(24))).toBe(18);
    expect(nameFontPt('x'.repeat(30))).toBe(15);
    expect(nameFontPt('x'.repeat(40))).toBe(13);
  });
  it('counts characters, not UTF-16 units, for Devanagari names', () => {
    expect(nameFontPt('अ'.repeat(18))).toBe(22);
  });
  it('escapeHtml handles all five characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('garland', () => {
  it('has 45 flowers, all inside the frame area, evenly spaced along the curve', () => {
    const pts = garlandPoints();
    expect(pts).toHaveLength(45);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(82);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(92);
    }
    const gaps = pts.slice(1).map(([x, y], i) => Math.hypot(x - pts[i]![0], y - pts[i]![1]));
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.15);
  });
  it('is plain SVG without script', () => {
    const svg = garlandSvg();
    expect(svg.match(/<circle/g)).toHaveLength(90);
    expect(svg).not.toMatch(/<script/i);
  });
});
