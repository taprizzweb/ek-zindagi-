/**
 * Renders a sample certificate to a PDF file, so the layout can be checked by eye:
 *   CHROMIUM_EXECUTABLE_PATH=/path/to/chrome npm run cert:sample -- out.pdf [--photo photo.jpg] [--name "Name"] [--violation helmet]
 * Without CHROMIUM_EXECUTABLE_PATH it uses the bundled serverless Chromium.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createCertificatePdf } from '../src/lib/pdf/certificate';
import { brandingFromEnv } from '../src/lib/pdf/branding';
import type { ViolationKey } from '../src/config/violations';

const args = process.argv.slice(2);
const out =
  args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') === false) ??
  args[0] ??
  'sample-certificate.pdf';
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const photo = opt('photo');

const started = Date.now();
const pdf = await createCertificatePdf(
  {
    certCode: 'EKZ-JPR-000123',
    name: opt('name') ?? 'SAMPLE NAME',
    violation: (opt('violation') ?? 'helmet') as ViolationKey,
    areaName: opt('place') ?? 'Sample Chauraha, Jaipur, Rajasthan',
    createdAt: new Date('2026-10-30T09:51:00Z'), // 03:21 PM IST
    photoJpeg: photo ? readFileSync(photo) : null,
  },
  brandingFromEnv(),
);
writeFileSync(out, pdf);
console.log(`${out}: ${(pdf.length / 1024).toFixed(0)} KB in ${Date.now() - started} ms`);
