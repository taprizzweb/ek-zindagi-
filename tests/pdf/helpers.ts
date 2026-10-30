import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { CertificateData } from '@/lib/pdf/template';

export const sample: CertificateData = {
  certCode: 'EKZ-JPR-000123',
  name: 'SAMPLE NAME',
  violation: 'helmet',
  areaName: 'Sample Chauraha, Jaipur, Rajasthan',
  createdAt: new Date('2026-10-30T09:51:00Z'), // 03:21 PM IST
};

function inTempFile<T>(pdf: Buffer, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'ekz-pdf-'));
  const path = join(dir, 'c.pdf');
  writeFileSync(path, pdf);
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Text of the PDF as a reader would see it (whitespace collapsed). */
export function pdfText(pdf: Buffer): string {
  return inTempFile(pdf, (p) =>
    execFileSync('pdftotext', ['-raw', p, '-']).toString('utf8'),
  ).replace(/\s+/g, ' ');
}

export function pdfInfo(pdf: Buffer): Record<string, string> {
  const out = inTempFile(pdf, (p) => execFileSync('pdfinfo', [p]).toString('utf8'));
  return Object.fromEntries(
    out
      .split('\n')
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]),
  );
}

export function pdfFonts(pdf: Buffer): string {
  return inTempFile(pdf, (p) => execFileSync('pdffonts', [p]).toString('utf8'));
}

/** First page as an RGBA bitmap at 96 dpi (A4 = 794 x 1123). */
export function rasterize(pdf: Buffer): PNG {
  const png = inTempFile(pdf, (p) =>
    execFileSync('pdftoppm', ['-r', '96', '-png', '-singlefile', p], { maxBuffer: 50_000_000 }),
  );
  return PNG.sync.read(png);
}

export function readPng(path: string): PNG {
  return PNG.sync.read(readFileSync(path));
}

export function pixel(img: PNG, x: number, y: number): [number, number, number] {
  const i = (img.width * y + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

/**
 * Compares two same-size images block by block (default 8 x 8 px, averaged), ignoring the given
 * rectangles. Averaging means different fonts and anti-aliasing do not count as a mismatch, but a
 * moved frame, a missing garland, a wrong background or a broken layout does.
 */
export function blockDifference(
  a: PNG,
  b: PNG,
  opts: {
    block?: number;
    ignore?: { x: number; y: number; w: number; h: number }[];
    blockThreshold?: number;
  } = {},
): { badBlocks: number; totalBlocks: number; ratio: number; meanDistance: number } {
  const block = opts.block ?? 8;
  const threshold = opts.blockThreshold ?? 40;
  const ignore = opts.ignore ?? [];
  let bad = 0;
  let total = 0;
  let sum = 0;
  for (let by = 0; by + block <= a.height; by += block) {
    for (let bx = 0; bx + block <= a.width; bx += block) {
      if (
        ignore.some((r) => bx < r.x + r.w && bx + block > r.x && by < r.y + r.h && by + block > r.y)
      )
        continue;
      const avg = (img: PNG) => {
        const s = [0, 0, 0];
        for (let y = by; y < by + block; y++)
          for (let x = bx; x < bx + block; x++) {
            const i = (img.width * y + x) * 4;
            s[0]! += img.data[i]!;
            s[1]! += img.data[i + 1]!;
            s[2]! += img.data[i + 2]!;
          }
        return s.map((v) => v / (block * block));
      };
      const [ar, ag, ab] = avg(a) as [number, number, number];
      const [br, bg, bb] = avg(b) as [number, number, number];
      const d = Math.hypot(ar - br, ag - bg, ab - bb);
      total++;
      sum += d;
      if (d > threshold) bad++;
    }
  }
  return { badBlocks: bad, totalBlocks: total, ratio: bad / total, meanDistance: sum / total };
}
