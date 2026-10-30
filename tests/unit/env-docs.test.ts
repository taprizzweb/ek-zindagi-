import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** A setting that exists in code but not in .env.example (or the README) is one nobody will find. */
const read = (f: string) => readFileSync(f, 'utf8');
const keysInEnvTs = [...read('src/lib/env.ts').matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map(
  (m) => m[1]!,
);
const example = read('.env.example');
const readme = read('README.md');
const OTHER_KEYS = [
  'SHOW_POLICE_BRANDING',
  'POLICE_LOGO_PATH',
  'NGO_LOGO_PATH',
  'PARTNER_CREDIT_TEXT',
  'CHROMIUM_EXECUTABLE_PATH',
];
// Only tests change these; documented in the code, not for operators.
const TEST_ONLY = new Set(['WHATSAPP_API_BASE', 'WHATSAPP_API_VERSION']);

describe('settings are documented', () => {
  it('finds the settings it is meant to check', () => {
    expect(keysInEnvTs.length).toBeGreaterThan(25);
    expect(keysInEnvTs).toContain('CRON_SECRET');
  });
  it('.env.example lists every setting, with an empty or safe value', () => {
    const missing = [...keysInEnvTs, ...OTHER_KEYS].filter(
      (k) => !TEST_ONLY.has(k) && !new RegExp(`^${k}=`, 'm').test(example),
    );
    expect(missing).toEqual([]);
  });
  it('.env.example holds no real-looking secret and keeps branding off by default for new setups', () => {
    for (const line of example.split('\n')) {
      const m = /^([A-Z_]+(?:TOKEN|SECRET|KEY|PASSWORD))=(.+)$/.exec(line);
      if (m) expect(m[2]!.trim(), m[1]).toMatch(/^$/); // secrets stay empty
    }
  });
  it('the README explains every setting an operator has to choose', () => {
    const must = [...keysInEnvTs, ...OTHER_KEYS].filter((k) => !TEST_ONLY.has(k));
    const missing = must.filter(
      (k) =>
        !readme.includes(k) &&
        !read('docs/whatsapp-setup.md').includes(k) &&
        !read('docs/deploy.md').includes(k),
    );
    expect(missing).toEqual([]);
  });
});
