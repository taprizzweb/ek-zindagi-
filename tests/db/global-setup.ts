import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    dbUrl: string;
  }
}

/** Creates a throwaway database, applies bootstrap + every migration, drops it afterwards. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a Postgres superuser, e.g. ' +
        'postgres://ekz_test:ekz@localhost:5432/postgres (see README, "Database tests").',
    );
  }
  const dbName = `ekz_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(base);
  url.pathname = `/${dbName}`;
  project.provide('dbUrl', url.toString());

  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  await c.query(
    readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'bootstrap.sql'), 'utf8'),
  );
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    await c.query(readFileSync(join(dir, f), 'utf8'));
  }
  await c.end();

  return async () => {
    const a = new pg.Client({ connectionString: base });
    await a.connect();
    await a.query(`drop database if exists ${dbName} with (force)`);
    await a.end();
  };
}
