import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CERTIFICATE_CHECKLIST, CERTIFICATE_TEXT } from '@/config/certificate';
import { VIOLATION_KEYS, type ViolationKey } from '@/config/violations';
import { brandingFromEnv } from '@/lib/pdf/branding';
import { createCertificatePdf, createCertificatePng } from '@/lib/pdf/certificate';
import { renderPdf } from '@/lib/pdf/render';
import { buildCertificateHtml, type Branding, type CertificateData } from '@/lib/pdf/template';
import { blockDifference, pdfFonts, pdfInfo, pdfText, pixel, rasterize, sample } from './helpers';

const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_MS = 5000;
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const POLICE: Branding = brandingFromEnv({ SHOW_POLICE_BRANDING: 'true' });

/** The letters of a string, upper-cased: robust against how the PDF text extractor spaces rotated text. */
const letters = (s: string) => s.replace(/[^\p{L}]/gu, '').toUpperCase();

function expectMandatory(text: string) {
  const flat = letters(text);
  expect(flat).toContain(letters(CERTIFICATE_TEXT.disclaimer));
  expect(flat).toContain(letters('FOR AWARENESS PURPOSE ONLY')); // stamp
  expect(flat).toContain(letters('AWARENESS ONLY')); // watermark
}

async function jpeg(w: number, h: number, color: string): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg({ quality: 85 })
    .toBuffer();
}
async function noisyJpeg(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919 + ((i >> 3) ^ (i * 31))) & 0xff;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 82 })
    .toBuffer();
}
/** A deterministic stand-in portrait (no real person). */
async function portrait(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fb8d0"/><stop offset="1" stop-color="#6d8aa6"/></linearGradient></defs><rect width="900" height="1100" fill="url(#g)"/><circle cx="450" cy="400" r="170" fill="#c8a07a"/><path d="M150 1100 Q170 700 450 680 Q730 700 750 1100Z" fill="#3d4f66"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

/** Centre of each checkbox on the 1123 x 794 page: column 1 at x 488, column 2 at x 783; rows 26 px apart. */
function boxCentre(key: ViolationKey): [number, number] {
  const entry = CERTIFICATE_CHECKLIST.find((c) => c.key === key)!;
  const row = CERTIFICATE_CHECKLIST.filter((c) => c.column === entry.column).indexOf(entry);
  return [entry.column === 1 ? 488 : 783, 561 + 26 * row];
}
const isDark = (img: PNG, [x, y]: [number, number]) => pixel(img, x, y).every((v) => v < 80);

const redInk = (img: PNG, x0: number, y0: number, x1: number, y1: number) => {
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = pixel(img, x, y);
      if (r > 90 && g < 50 && b < 50) n++;
    }
  return n;
};

describe('the certificate PDF', () => {
  it('is one A4 landscape page, with code and date in its properties and no personal data in them', async () => {
    const pdf = await createCertificatePdf({ ...sample, name: 'Ravi Kumar' });
    const info = pdfInfo(pdf);
    expect(info.Pages).toBe('1');
    expect(info['Page size']).toMatch(/^84\d\.\d+ x 59\d\.\d+ pts \(A4\)$/); // wider than tall
    expect(info.Title).toContain('EKZ-JPR-000123');
    expect(info.Subject).toContain('EKZ-JPR-000123');
    expect(info.Subject).toContain('30 October 2026, 04:12 PM');
    expect(info.Keywords).toContain('EKZ-JPR-000123');
    expect(info.Keywords).toContain('2026-10-30T10:42:00.000Z');
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    const metaText = Object.values(info).join(' ');
    expect(metaText).not.toContain('Ravi');
    expect(metaText).not.toContain('Chauraha');
  });

  it('contains the visible fields and the design wording', async () => {
    const text = pdfText(
      await createCertificatePdf({ ...sample, name: 'Ravi Kumar' }),
    ).toUpperCase();
    // Letter-spaced lines are extracted with gaps between the letters: compare those on letters only.
    for (const s of [
      'CERTIFICATE OF RECKLESSNESS ON ROAD',
      'PROJECT EK ZINDAGI',
      'THIS CERTIFIES THAT',
    ]) {
      expect(letters(text), s).toContain(letters(s));
    }
    for (const s of [
      'ONE MISTAKE AWAY',
      'RAVI KUMAR',
      'WAS CAUGHT ON CAMERA ON',
      '30 OCTOBER 2026',
      '04:12 PM',
      'SAMPLE CHAURAHA, JAIPUR',
      'WHILE COMMITTING THIS TRAFFIC OFFENCE',
      'RIDER WITHOUT HELMET',
      'CERTIFICATE NO. EKZ-JPR-000123',
      'ISSUED AT JAIPUR',
      'THIS COULD HAVE BEEN YOUR LAST RIDE.',
      'ROAD SAFETY AWARENESS CAMPAIGN',
    ]) {
      expect(text, s).toContain(s);
    }
  });

  it('never says challan, fine, penalty, deceased, RIP or late, and shows no old wording', async () => {
    const text = pdfText(await createCertificatePdf(sample, POLICE));
    expect(text).not.toMatch(/\b(challan|fine|fines|penalty|deceased|rip|late)\b/i);
    expect(text).not.toMatch(/YOUR NEXT MISTAKE|Someone is waiting/i);
  });
});

describe('stamp, watermark and disclaimer: in the PDF, on every render', () => {
  const cases: [string, Partial<CertificateData>, Branding?][] = [
    ['no photo', {}],
    ['a photo', {}],
    ['a very long name', { name: 'Ramachandran Venkataraghavan Iyer Jr' }],
    ['the longest name allowed', { name: 'W'.repeat(40) }],
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
        certCode: '<b>EKZ</b>',
      },
    ],
    ['police branding on', {}, POLICE],
  ];

  it.each(cases)('%s', async (label, over, branding) => {
    const photoJpeg = label === 'a photo' ? await portrait() : null;
    const pdf = await createCertificatePdf({ ...sample, ...over, photoJpeg }, branding);
    expect(pdfInfo(pdf).Pages).toBe('1');
    const text = pdfText(pdf);
    expectMandatory(text);
    expect(text).not.toMatch(/HYPOTHETICAL\s*$/m); // the stamp no longer says it...
    expect(pdf.length).toBeLessThan(MAX_BYTES);
  });

  it('the disclaimer says what the design says, and nothing calls the certificate hypothetical', async () => {
    const text = pdfText(await createCertificatePdf(sample));
    expect(text).not.toMatch(/hypothetical/i);
    expect(letters(text)).toContain(
      letters(
        'Awareness campaign illustration. Not a legal document, accident report or police notice.',
      ),
    );
    expect(letters(text)).toContain(letters('No harm has occurred to the person named.'));
  });

  it('are painted on the page: red stamp top right, watermark across the middle, disclaimer in a dark bar', async () => {
    const img = rasterize(await createCertificatePdf(sample));
    expect(redInk(img, 940, 40, 1075, 100)).toBeGreaterThan(150); // stamp
    let faint = 0; // watermark: faint red-tinted pixels over the parchment, upper right of the diagonal
    for (let y = 200; y < 340; y++)
      for (let x = 650; x < 1050; x++) {
        const [r, g, b] = pixel(img, x, y);
        if (r - b > 28 && r > 230 && g < 240) faint++;
      }
    expect(faint).toBeGreaterThan(500);
    // The disclaimer sits in its own dark bar along the bottom, with light text in it.
    expect(pixel(img, 70, 740).every((v) => v < 60)).toBe(true);
    let light = 0;
    for (let x = 150; x < 980; x++)
      for (let y = 722; y < 760; y++) if (pixel(img, x, y).every((v) => v > 200)) light++;
    expect(light).toBeGreaterThan(300);
  });
});

describe('only the chosen checkbox is filled', () => {
  it.each(VIOLATION_KEYS)('%s', async (violation) => {
    const img = rasterize(await createCertificatePdf({ ...sample, violation }));
    for (const key of VIOLATION_KEYS) {
      expect(isDark(img, boxCentre(key)), `${violation}: box ${key}`).toBe(key === violation);
    }
  });
});

describe('Devanagari names and places', () => {
  it('shapes them, with the Devanagari font embedded', async () => {
    const pdf = await createCertificatePdf({
      ...sample,
      name: 'रवि कुमार',
      areaName: 'मालवीय नगर, जयपुर, राजस्थान',
    });
    const text = pdfText(pdf).replace(/\s/g, '');
    for (const s of ['रवि कुमार', 'मालवीय नगर, जयपुर, राजस्थान'])
      expect(text, s).toContain(s.replace(/\s/g, ''));
    expect(pdfFonts(pdf)).toMatch(/NotoSerifDevanagari/);
  });

  it('embeds every font it uses', async () => {
    const fonts = pdfFonts(await createCertificatePdf({ ...sample, name: 'रवि' }));
    const rows = fonts.split('\n').slice(2).filter(Boolean);
    for (const row of rows) expect(row, row).toMatch(/\byes\b\s+yes\b/);
    expect(fonts).toMatch(/Anton/);
    expect(fonts).toMatch(/LibreBaskerville/);
  });
});

describe('long text fits (auto-shrink)', () => {
  it('a 40-letter name stays inside its line, a 120-character place stays out of the checklist', async () => {
    const img = rasterize(
      await createCertificatePdf({
        ...sample,
        name: 'W'.repeat(40),
        areaName:
          'Plot 14 Sector 9 Mansarovar Extension Near Old Water Tank Opposite Government Senior Secondary School Jaipur',
      }),
    );
    // Nothing dark to the right of the name line, between its end and the border.
    for (let y = 272; y < 322; y++)
      for (let x = 1064; x < 1090; x++)
        expect(
          pixel(img, x, y).every((v) => v < 120),
          `name ink at ${x},${y}`,
        ).toBe(false);
    // No red place text in the gap above "while committing this traffic offence".
    expect(redInk(img, 780, 502, 1062, 512)).toBe(0);
    // ... but the place is there, shrunk.
    expect(redInk(img, 790, 386, 1062, 496)).toBeGreaterThan(400);
  });
});

describe('photo', () => {
  it('appears inside the picture frame', async () => {
    const withPhoto = rasterize(
      await createCertificatePdf({ ...sample, photoJpeg: await jpeg(600, 760, '#ff0000') }),
    );
    const [r, g, b] = pixel(withPhoto, 260, 340); // inside the frame window, clear of the garland and the sticks
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it('is replaced by a neutral silhouette inside the same frame when there is none', async () => {
    const head = pixel(rasterize(await createCertificatePdf(sample)), 268, 431); // head of the silhouette
    [143, 135, 118].forEach((v, i) => expect(Math.abs(head[i]! - v)).toBeLessThan(12));
  });

  it('keeps a large detailed photo under the size limit', async () => {
    const photo = await noisyJpeg(1200, 1600);
    expect(photo.length).toBeGreaterThan(500_000);
    expect((await createCertificatePdf({ ...sample, photoJpeg: photo })).length).toBeLessThan(
      MAX_BYTES,
    );
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
      // A certificate page, plus an attacker-style image and stylesheet pointing at a local server.
      const html = buildCertificateHtml(sample).replace(
        '</body>',
        `<img src="http://127.0.0.1:${port}/x.png"><link rel="stylesheet" href="http://127.0.0.1:${port}/s.css"></body>`,
      );
      const pdf = await renderPdf(html);
      expect(pdfText(pdf)).toContain('ONE MISTAKE AWAY');
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });
});

describe('PNG export (Download image)', () => {
  it('is a 2x image of the same certificate', async () => {
    const png = await createCertificatePng({ ...sample, certCode: 'JTP-000123' });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const img = PNG.sync.read(png);
    expect([img.width, img.height]).toEqual([2246, 1588]);
    const half = await sharp(png).resize(1123, 794).png().toBuffer();
    const pdf = rasterize(await createCertificatePdf({ ...sample, certCode: 'JTP-000123' }));
    // A screenshot of the same page: it matches the PDF raster (which is about 1 px taller) closely.
    expect(blockDifference(PNG.sync.read(half), pdf, { block: 8 }).ratio).toBeLessThan(0.03);
  });
});

describe('visual regression against golden images', () => {
  it('would notice a broken layout (the comparison is not vacuous)', async () => {
    const golden = PNG.sync.read(readFileSync('tests/pdf/snapshots/short-name-no-photo.png'));
    const html = buildCertificateHtml(sample)
      .replace('class="c-art"', 'class="c-art" visibility="hidden" display="none"')
      .replace('background:#faf3e0', 'background:#ffffff');
    const broken = rasterize(await renderPdf(html));
    expect(blockDifference(broken, golden, { block: 32 }).ratio).toBeGreaterThan(0.1);
  });

  // Golden images of the fixtures. Created with UPDATE_SNAPSHOTS=1 and committed; compared on every run.
  const fixtures: [string, () => Promise<{ data: CertificateData; branding?: Branding }>][] = [
    ['short-name-no-photo', async () => ({ data: { ...sample } })],
    [
      'with-photo',
      async () => ({
        data: { ...sample, name: 'Ravi Kumar', violation: 'seatbelt', photoJpeg: await portrait() },
      }),
    ],
    [
      'very-long-name',
      async () => ({
        data: { ...sample, name: 'Ramachandran Venkataraghavan Iyer Jr', violation: 'overspeed' },
      }),
    ],
    [
      'very-long-place',
      async () => ({
        data: {
          ...sample,
          areaName:
            'Plot 14, Sector 9, Mansarovar Extension Near Old Water Tank, Opp. Government Senior Secondary School, Jaipur',
          violation: 'wrong_side',
        },
      }),
    ],
    [
      'hindi-name-and-place',
      async () => ({
        data: {
          ...sample,
          name: 'प्रियंका शर्मा',
          areaName: 'मालवीय नगर, जयपुर',
          violation: 'mobile',
        },
      }),
    ],
    [
      'police-branding-other-violation',
      async () => ({
        data: { ...sample, violation: 'other', photoJpeg: await portrait() },
        branding: POLICE,
      }),
    ],
    ['child-helmet', async () => ({ data: { ...sample, violation: 'child_helmet' } })],
  ];

  it.each(fixtures)('snapshot: %s', async (name, make) => {
    const { data, branding } = await make();
    const ours = rasterize(await createCertificatePdf(data, branding));
    const file = `tests/pdf/snapshots/${name}.png`;
    if (UPDATE || !existsSync(file)) {
      mkdirSync('tests/pdf/snapshots', { recursive: true });
      writeFileSync(file, PNG.sync.write(ours));
      if (!UPDATE) process.stderr.write(`created missing snapshot ${file}\n`);
    }
    const golden = PNG.sync.read(readFileSync(file));
    expect(blockDifference(ours, golden, { block: 8 }).ratio).toBeLessThan(0.005);
  });
});
