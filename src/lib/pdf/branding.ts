import { readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { isPrintablePlace } from '@/lib/domain/text';
import type { Branding } from './template';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};
const MAX_LOGO_BYTES = 300_000;
/** Used for the police logo when branding is on and POLICE_LOGO_PATH is not set. */
export const DEFAULT_POLICE_LOGO_PATH = 'assets/branding/jaipur-police.png';

/** File access, injectable so tests can prove which files are (not) opened. */
export interface FileAccess {
  size(path: string): number;
  read(path: string): Buffer;
}
const realFiles: FileAccess = { size: (p) => statSync(p).size, read: (p) => readFileSync(p) };

function loadLogo(path: string | undefined, files: FileAccess): string | null {
  if (!path) return null;
  const abs = resolve(process.cwd(), path);
  const root = resolve(process.cwd()) + sep;
  const mime = MIME[extname(abs).toLowerCase()];
  // Logos live inside the project; a path elsewhere on the server is never read.
  if (!abs.startsWith(root) || !mime) return null;
  try {
    if (files.size(abs) > MAX_LOGO_BYTES) return null;
    return `data:${mime};base64,${files.read(abs).toString('base64')}`;
  } catch {
    return null;
  }
}

export interface BrandingEnv {
  SHOW_POLICE_BRANDING?: string;
  NGO_LOGO_PATH?: string;
  POLICE_LOGO_PATH?: string;
  PARTNER_CREDIT_TEXT?: string;
}

/**
 * Police name and logo appear only when SHOW_POLICE_BRANDING is exactly "true" (it stays off until
 * written permission covers the logo, which shows the State Emblem). With the flag off, the police
 * logo file is never opened. The NGO logo and the technology-partner credit appear only when configured.
 */
export function brandingFromEnv(
  env: BrandingEnv = process.env as BrandingEnv,
  files: FileAccess = realFiles,
): Branding {
  const showPolice = env.SHOW_POLICE_BRANDING === 'true';
  const credit = env.PARTNER_CREDIT_TEXT?.trim();
  return {
    showPolice,
    ngoLogoDataUri: loadLogo(env.NGO_LOGO_PATH, files),
    policeLogoDataUri: showPolice
      ? loadLogo(env.POLICE_LOGO_PATH || DEFAULT_POLICE_LOGO_PATH, files)
      : null,
    partnerCreditText: credit && credit.length <= 80 && isPrintablePlace(credit) ? credit : null,
  };
}
