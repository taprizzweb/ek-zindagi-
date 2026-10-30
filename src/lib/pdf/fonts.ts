import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const DEVANAGARI =
  'U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF,U+11B00-11B09';

export interface FontFace {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  file: string;
  range: string;
}

/**
 * Anton (headline, date, place) and Libre Baskerville (everything else) cover Latin. Devanagari
 * names and places fall back to Noto Serif Devanagari: "EKZ Deva" for running text and
 * "EKZ Deva Bold" (the bold file, declared at weight 400) for the Anton-style big text.
 * The browser preview loads the same files from /fonts (certificate-fonts.css); a test keeps the two in step.
 */
export const FONT_FACES: FontFace[] = [
  {
    family: 'Anton',
    weight: 400,
    style: 'normal',
    file: 'anton-latin-400-normal.woff2',
    range: LATIN,
  },
  {
    family: 'Anton',
    weight: 400,
    style: 'normal',
    file: 'anton-latin-ext-400-normal.woff2',
    range: LATIN_EXT,
  },
  ...(
    [
      [400, 'normal'],
      [700, 'normal'],
      [400, 'italic'],
    ] as const
  ).flatMap(([weight, style]) => [
    {
      family: 'Libre Baskerville',
      weight,
      style,
      file: `libre-baskerville-latin-${weight}-${style}.woff2`,
      range: LATIN,
    },
    {
      family: 'Libre Baskerville',
      weight,
      style,
      file: `libre-baskerville-latin-ext-${weight}-${style}.woff2`,
      range: LATIN_EXT,
    },
  ]),
  {
    family: 'EKZ Deva',
    weight: 400,
    style: 'normal',
    file: 'noto-serif-devanagari-devanagari-400-normal.woff2',
    range: DEVANAGARI,
  },
  {
    family: 'EKZ Deva',
    weight: 400,
    style: 'italic',
    file: 'noto-serif-devanagari-devanagari-400-normal.woff2',
    range: DEVANAGARI,
  },
  {
    family: 'EKZ Deva',
    weight: 700,
    style: 'normal',
    file: 'noto-serif-devanagari-devanagari-700-normal.woff2',
    range: DEVANAGARI,
  },
  {
    family: 'EKZ Deva Bold',
    weight: 400,
    style: 'normal',
    file: 'noto-serif-devanagari-devanagari-700-normal.woff2',
    range: DEVANAGARI,
  },
];

let cached: string | null = null;

/** @font-face rules with the fonts inlined as data URIs: nothing is fetched while rendering. */
export function fontFaceCss(): string {
  if (cached) return cached;
  const dir = join(process.cwd(), 'public', 'fonts');
  const data = new Map<string, string>();
  cached = FONT_FACES.map((f) => {
    let b64 = data.get(f.file);
    if (!b64) {
      b64 = readFileSync(join(dir, f.file)).toString('base64');
      data.set(f.file, b64);
    }
    return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${f.range}}`;
  }).join('\n');
  return cached;
}

/** The same rules for the browser, pointing at the files served from /fonts. */
export function fontFaceCssForBrowser(): string {
  return FONT_FACES.map(
    (f) =>
      `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(/fonts/${f.file}) format('woff2');unicode-range:${f.range}}`,
  ).join('\n');
}
