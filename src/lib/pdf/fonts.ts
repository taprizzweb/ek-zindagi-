import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES: {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  file: string;
  range: string;
}[] = [
  ...(['normal', 'italic'] as const).flatMap((style) =>
    [400, 700].flatMap((weight) => [
      {
        family: 'Noto Serif',
        weight,
        style,
        file: `noto-serif-latin-${weight}-${style}.woff2`,
        range:
          'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
      },
      {
        family: 'Noto Serif',
        weight,
        style,
        file: `noto-serif-latin-ext-${weight}-${style}.woff2`,
        range:
          'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
      },
    ]),
  ),
  // Same family name: the browser picks Devanagari glyphs from here (also for italic text).
  ...(['normal', 'italic'] as const).flatMap((style) =>
    [400, 700].map((weight) => ({
      family: 'Noto Serif',
      weight,
      style,
      file: `noto-serif-devanagari-devanagari-${weight}-normal.woff2`,
      range:
        'U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF,U+11B00-11B09',
    })),
  ),
];

let cached: string | null = null;

/** @font-face rules with the fonts inlined as data URIs: nothing is fetched while rendering. */
export function fontFaceCss(): string {
  if (cached) return cached;
  const dir = join(process.cwd(), 'assets', 'fonts');
  const data = new Map<string, string>();
  cached = FILES.map((f) => {
    let b64 = data.get(f.file);
    if (!b64) {
      b64 = readFileSync(join(dir, f.file)).toString('base64');
      data.set(f.file, b64);
    }
    return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${f.range}}`;
  }).join('\n');
  return cached;
}
