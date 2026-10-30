import { execFileSync } from 'node:child_process';
import { appEnv } from './env';

/** Builds the app once (NEXT_PUBLIC_* values are inlined at build time). Set E2E_SKIP_BUILD=1 to reuse .next. */
export default function setup() {
  if (process.env.E2E_SKIP_BUILD === '1') return;
  execFileSync('npx', ['next', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, ...appEnv },
  });
}
