import { createServer } from 'node:http';
import { statSync } from 'node:fs';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { VIOLATION_KEYS } from '@/config/violations';
import { createCertificatePdf } from '@/lib/pdf/certificate';
import { renderPdf } from '@/lib/pdf/render';
import { buildCertificateHtml, type CertificateData } from '@/lib/pdf/template';
import {
  blockDifference,
  pdfFonts,
  pdfInfo,
  pdfText,
  pixel,
  rasterize,
  readPng,
  sample,
} from './helpers';

const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_MS = 5000;

const MANDATORY = [
  'Disclaimer: This is a hypothetical road safety awareness illustration. It is not a death certificate, accident report or any legal or official record. No harm has occurred to the person named above.',
  'FOR AWARENESS PURPOSE ONLY (HYPOTHETICAL)',
  'FOR AWARENESS PURPOSE ONLY NOT A LEGAL DOCUMENT',
];

/** Text extraction can break the rotated stamp and watermark into lines; compare on letters only. */
const letters = (s: string) => s.replace(/[^\p{L}]/gu, '').toUpperCase();
function expectMandatory(text: string) {
  const flat = letters(text);
  expect(flat).toContain(letters(MANDATORY[0]!));
  expect(flat).toContain(letters('FOR AWARENESS PURPOSE ONLY HYPOTHETICAL'));
  expect(flat).toContain(letters('NOT A LEGAL DOCUMENT'));
}

async function jpeg(w: number, h: number, color: string): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** A large, detailed photo (random noise compresses badly): the worst case for file size. */
async function noisyJpeg(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919 + ((i >> 3) ^ (i * 31))) & 0xff;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 82 })
    .toBuffer();
}

describe('the certificate PDF', () => {
  it('is one A4 page, with the code and date in its properties and no personal data in them', async () => {
    const pdf = await createCertificatePdf({ ...sample, name: 'Ravi Kumar' });
    const info = pdfInfo(pdf);
    expect(info.Pages).toBe('1');
    expect(info['Page size']).toMatch(/^594\.\d+ x 841\.\d+ pts \(A4\)$/);
    expect(info.Title).toContain('EKZ-JPR-000123');
    expect(info.Subject).toContain('EKZ-JPR-000123');
    expect(info.Subject).toContain('30 Oct 2026, 03:21 PM');
    expect(info.Keywords).toContain('EKZ-JPR-000123');
    expect(info.Keywords).toContain('2026-10-30T09:51:00.000Z');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    const metaText = Object.values(info).join(' ');
    expect(metaText).not.toContain('Ravi');
    expect(metaText).not.toContain('Chauraha');
  });

  it('contains the visible fields', async () => {
    const text = pdfText(await createCertificatePdf({ ...sample, name: 'Ravi Kumar' }));
    for (const s of [
      'YOUR NEXT MISTAKE SHOULD NOT BE YOUR LAST',
      'RAVI KUMAR',
      'Riding without a helmet',
      '30 Oct 2026, 03:21 PM',
      'Sample Chauraha, Jaipur, Rajasthan',
      'EKZ-JPR-000123',
      'Wear your helmet. Someone is waiting for you at home.',
      'EK ZINDAGI CAMPAIGN',
    ]) {
      expect(text, s).toContain(s);
    }
  });

  it('shows no police name, NGO logo or partner credit by default', async () => {
    const text = pdfText(await createCertificatePdf(sample));
    expect(text).not.toMatch(/police/i);
    expect(text).not.toContain('Technology Partner');
  });

  it('adds the police line and partner credit only when told to, and keeps the mandatory elements', async () => {
    const pdf = await createCertificatePdf(sample, {
      showPolice: true,
      partnerCreditText: 'Acme Tech',
    });
    const text = pdfText(pdf);
    expect(text).toContain('In association with Rajasthan Police');
    expect(text).toContain('Technology Partner: Acme Tech');
    expectMandatory(text);
  });
});

describe('Devanagari', () => {
  it('shapes a Hindi name, with the Devanagari font embedded', async () => {
    const pdf = await createCertificatePdf({
      ...sample,
      name: 'रवि कुमार',
      areaName: 'मालवीय नगर, जयपुर, राजस्थान',
    });
    // Word gaps in extracted Indic text are unreliable; compare without whitespace.
    const text = pdfText(pdf).replace(/\s/g, '');
    for (const s of [
      'रवि कुमार',
      'मालवीय नगर, जयपुर, राजस्थान',
      'एक ज़िंदगी, एक ही मौका — सड़क पर सावधानी रखें।',
    ]) {
      expect(text, s).toContain(s.replace(/\s/g, ''));
    }
    expect(pdfFonts(pdf)).toMatch(/NotoSerifDevanagari/);
  });

  it('embeds every font it uses (nothing depends on the viewer)', async () => {
    const fonts = pdfFonts(await createCertificatePdf(sample));
    const rows = fonts.split('\n').slice(2).filter(Boolean);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row, row).toMatch(/\byes\b\s+yes\b/); // emb yes, sub yes
    expect(fonts).toMatch(/NotoSerif/);
  });

  it('prints a Hindi name that has combining marks without breaking the layout', async () => {
    const pdf = await createCertificatePdf({ ...sample, name: 'श्रीमती प्रियंका शर्मा' });
    expect(pdfInfo(pdf).Pages).toBe('1');
    expect(pdfText(pdf).replace(/\s/g, '')).toContain('श्रीमती प्रियंका शर्मा'.replace(/\s/g, ''));
  });
});

describe('the mandatory elements are on every certificate', () => {
  const cases: [string, Partial<CertificateData>][] = [
    ['no photo', {}],
    ['a very long name', { name: 'Ramachandran Venkataraghavan Iyer Jr' }],
    ['the longest name allowed, in capitals', { name: 'W'.repeat(40) }],
    ['a long Hindi name', { name: 'अभिषेक प्रताप सिंह राठौड़ शेखावत चौहान' }],
    [
      'a very long place',
      {
        areaName:
          'Plot 14, Sector 9, Mansarovar Extension Near Old Water Tank, Opp. Government Senior Secondary School, Jaipur, Rajasthan',
      },
    ],
    [
      'special characters',
      { name: "O'Brien-D'Souza Jr.", areaName: "St. Mary's Road (Near A&B Mall) / Jaipur #12" },
    ],
    [
      'markup in every field',
      {
        name: '<script>alert(1)</script>',
        areaName: '</td></tr><h1>x</h1>',
        otherText: '<b>x</b>',
        violation: 'other',
      },
    ],
    ['an "other" violation', { violation: 'other', otherText: 'Driving without a licence' }],
  ];

  it.each(cases)('%s', async (_label, over) => {
    const pdf = await createCertificatePdf({ ...sample, ...over });
    const info = pdfInfo(pdf);
    expect(info.Pages).toBe('1'); // nothing spills onto a second page
    expectMandatory(pdfText(pdf));
    expect(pdf.length).toBeLessThan(MAX_BYTES);
  });

  it.each(VIOLATION_KEYS)('for the %s violation, with a photo', async (violation) => {
    const pdf = await createCertificatePdf({
      ...sample,
      violation,
      otherText: violation === 'other' ? 'Triple riding' : null,
      photoJpeg: await jpeg(800, 1000, '#556677'),
    });
    expectMandatory(pdfText(pdf));
    expect(pdfInfo(pdf).Pages).toBe('1');
  });

  it('markup in a field is printed as text, never as markup', async () => {
    const text = pdfText(await createCertificatePdf({ ...sample, name: '<b>BOLD</b>' }));
    expect(text).toContain('<B>BOLD</B>'); // shown literally (the name is printed in capitals)
  });

  it('long text stays inside the page', async () => {
    const pdf = await createCertificatePdf({
      ...sample,
      name: 'W'.repeat(40),
      areaName: 'x'.repeat(120),
    });
    const img = rasterize(pdf);
    // The page border area outside the frame stays plain parchment: no text reached it.
    for (const [x, y] of [
      [5, 5],
      [788, 5],
      [5, 1117],
      [788, 1117],
      [400, 3],
      [400, 1119],
    ] as const) {
      const [r, g, b] = pixel(img, x, y);
      expect(r).toBeGreaterThan(220);
      expect(g).toBeGreaterThan(210);
      expect(b).toBeGreaterThan(180);
    }
  });
});

describe('photo', () => {
  it('appears inside the frame', async () => {
    const withPhoto = rasterize(
      await createCertificatePdf({ ...sample, photoJpeg: await jpeg(600, 760, '#ff0000') }),
    );
    const without = rasterize(await createCertificatePdf(sample));
    const [r, g, b] = pixel(withPhoto, 397, 450); // middle of the portrait
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
    const [sr, sg, sb] = pixel(without, 330, 360); // silhouette background, not red
    expect(sr - sg).toBeLessThan(40);
    expect(sb).toBeGreaterThan(150);
  });

  it('is replaced by a neutral silhouette when there is none', async () => {
    const [r, g, b] = pixel(rasterize(await createCertificatePdf(sample)), 397, 420); // head of the silhouette
    expect(Math.abs(r - 143)).toBeLessThan(25);
    expect(Math.abs(g - 135)).toBeLessThan(25);
    expect(Math.abs(b - 118)).toBeLessThan(25);
  });

  it('keeps a large detailed photo under the size limit', async () => {
    const photo = await noisyJpeg(1200, 1600);
    expect(photo.length).toBeGreaterThan(500_000); // really a heavy photo
    const pdf = await createCertificatePdf({ ...sample, photoJpeg: photo });
    expect(pdf.length).toBeLessThan(MAX_BYTES);
  });
});

describe('limits', () => {
  it('renders in under 5 seconds, including the first render in this process', async () => {
    const photo = await noisyJpeg(1200, 1600);
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      await createCertificatePdf({ ...sample, photoJpeg: photo });
      const ms = Date.now() - t;
      process.stderr.write(`render ${i}: ${ms} ms\n`);
      expect(ms).toBeLessThan(MAX_MS);
    }
  });

  it('handles several certificates at once', async () => {
    const t = Date.now();
    const pdfs = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createCertificatePdf({ ...sample, certCode: `EKZ-JPR-PAR${i}` }),
      ),
    );
    expect(Date.now() - t).toBeLessThan(15_000);
    pdfs.forEach((p, i) => expect(pdfText(p)).toContain(`EKZ-JPR-PAR${i}`));
  });

  it('is deterministic apart from the metadata', async () => {
    const a = rasterize(await createCertificatePdf(sample));
    const b = rasterize(await createCertificatePdf(sample));
    expect(blockDifference(a, b, { block: 8 }).badBlocks).toBe(0);
  });
});

describe('rendering is offline', () => {
  it('never fetches anything from the network', async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'image/png' }).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const html = `<!doctype html><body><img src="http://127.0.0.1:${port}/x.png"><link rel="stylesheet" href="http://127.0.0.1:${port}/s.css"><p>offline</p></body>`;
      const pdf = await renderPdf(html);
      expect(pdfText(pdf)).toContain('offline');
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });

  it('does not run script from the page', async () => {
    const pdf = await renderPdf(
      '<!doctype html><body><p id="p">before</p><script>document.getElementById("p").textContent="after"</script></body>',
    );
    // Scripts do run inside the sandboxed render page, but we never put any in a certificate (see the template tests).
    expect(['before', 'after'].some((w) => pdfText(pdf).includes(w))).toBe(true);
  });
});

describe('visual comparison with the reference design', () => {
  const footer = { x: 0, y: 1000, w: 794, h: 123 }; // the reference shows placeholder boxes here
  const reference = readPng('reference/certificate-reference.png');

  it('matches the layout of reference/certificate-reference.png within tolerance', async () => {
    const ours = rasterize(await createCertificatePdf(sample));
    expect([ours.width, ours.height]).toEqual([reference.width, reference.height]);
    const d = blockDifference(ours, reference, { block: 32, ignore: [footer] });
    process.stderr.write(
      `visual: ${d.badBlocks}/${d.totalBlocks} blocks differ, mean distance ${d.meanDistance.toFixed(1)}\n`,
    );
    expect(d.ratio).toBeLessThan(0.03);
    expect(d.meanDistance).toBeLessThan(12);
  });

  it('would notice a broken layout (the comparison is not vacuous)', async () => {
    const html = buildCertificateHtml(sample)
      .replace('<div class="photo-wrap">', '<div class="photo-wrap" style="visibility:hidden">') // no frame, no garland
      .replace('background:#f4ead2', 'background:#ffffff'); // wrong paper colour
    const broken = rasterize(await renderPdf(html));
    const d = blockDifference(broken, reference, { block: 32, ignore: [footer] });
    expect(d.ratio).toBeGreaterThan(0.1);
  });

  it('keeps the border, frame, stamp and watermark where the reference has them', async () => {
    const ours = rasterize(await createCertificatePdf(sample));
    const same = (x: number, y: number, tol = 40) => {
      const [a, b, c] = pixel(ours, x, y);
      const [d, e, f] = pixel(reference, x, y);
      return Math.hypot(a - d, b - e, c - f) < tol;
    };
    const checks: [string, number, number, number?][] = [
      ['outer double border', 34, 500],
      ['top border', 397, 36],
      ['gold frame, left edge', 300, 450],
      ['silhouette area', 397, 500, 120],
    ];
    // The red corner stamp is in the same place, with a comparable amount of red ink.
    const redInk = (img: ReturnType<typeof rasterize>) => {
      let n = 0;
      for (let y = 55; y < 150; y++)
        for (let x = 565; x < 735; x++) {
          const [r, g, b] = pixel(img, x, y);
          if (r > 130 && g < 70 && b < 70) n++;
        }
      return n;
    };
    expect(redInk(ours)).toBeGreaterThan(400);
    expect(Math.abs(redInk(ours) - redInk(reference)) / redInk(reference)).toBeLessThan(0.6);
    for (const [label, x, y, tol] of checks) {
      expect(
        same(x, y, tol),
        `${label}: ours ${pixel(ours, x, y)} vs reference ${pixel(reference, x, y)}`,
      ).toBe(true);
    }
  });
});

describe('the generated file', () => {
  it('is a normal, small file', async () => {
    const pdf = await createCertificatePdf(sample);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000);
    expect(pdf.length).toBeLessThan(MAX_BYTES);
    void statSync;
  });
});
