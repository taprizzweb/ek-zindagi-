# EK ZINDAGI

Road safety awareness campaign for Rajasthan Police and an NGO. An officer fills a short form
while issuing a challan; the system makes a personalised, clearly hypothetical awareness
certificate (PDF) and sends it to the person's WhatsApp number. Personal data is deleted within
24 hours.

- Requirements: `reference/EK_ZINDAGI_master_prompt.md`
- Plan and decisions: `PLAN.md`
- Visual reference for the certificate: `reference/certificate-reference.png`

## Status

| Milestone                                                     | State       |
| ------------------------------------------------------------- | ----------- |
| 1. Setup, auth, roles, RLS, audit log, admin creates officers | done        |
| 2. Officer form                                               | not started |
| 3. Certificate PDF                                            | not started |
| 4. Bridge delivery                                            | not started |
| 5. Cloud API delivery                                         | not started |
| 6. Retention, supervisor/admin screens                        | not started |
| 7. Hardening, docs, deploy                                    | not started |

This README grows with each milestone. Deploy steps, the real-phone test script and the
privacy documents arrive in milestone 7.

## What exists after milestone 1

- Next.js 16 (App Router) + TypeScript strict + Tailwind, plain light bilingual (Hindi/English) UI.
- Supabase Auth with three roles: `officer`, `supervisor`, `admin`. No public sign-up.
- An admin creates officer and supervisor accounts at `/admin/officers`, disables or re-enables
  them, and resets passwords. Temporary passwords are shown once and must be changed at first login.
- Disabling an account takes effect on the next request, ends its sessions and bans the login.
- Sessions end after `INACTIVITY_MINUTES` without activity (default 30).
- Postgres schema with Row Level Security (`supabase/migrations`): profiles, entries, append-only
  audit log (no personal data), rate limits, private storage buckets `photos` and `pdfs`.
- Strict CSP with a per-request nonce, HSTS and other security headers (`src/proxy.ts`, `next.config.ts`).

### How access is split

The browser can read the database only with an officer's own JWT, and only **non-personal
columns** of rows its role may see. `person_name`, `phone_e164`, `phone_hash`, `photo_path`,
`pdf_path` and `other_text` are not granted to `anon` or `authenticated` at all. Everything else
goes through server routes that use the service role after checking the caller. Pages that query
`entries` from the browser role must list columns; `select *` is refused by design.

## Local setup

Requires Node 22+.

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase values
npm run dev
```

### Supabase

1. Create a project (region: Mumbai, `ap-south-1`).
2. Apply the migrations in `supabase/migrations` in order, either with the Supabase CLI
   (`supabase link --project-ref <ref>` then `supabase db push`) or by pasting each file into the SQL editor.
3. Put the project URL, the anon/publishable key and the service-role/secret key in `.env.local`.
   The service-role key is server-only. Never put it in a `NEXT_PUBLIC_` variable.
4. Create the first admin (refuses to run if an admin already exists):

   ```bash
   ADMIN_EMAIL=you@example.org ADMIN_PASSWORD='at-least-12-characters' ADMIN_DISPLAY_NAME='NGO Admin' npm run seed:admin
   ```

5. Log in at `/login`, open `/admin/officers`, create officer accounts.

## Tests

```bash
npm test            # unit tests (no services needed)
npm run lint && npm run typecheck && npm run format:check
```

### Database tests (RLS)

These run the real migrations against a throwaway Postgres database and try to break the
policies as `anon`, `authenticated` (officer, supervisor, admin, disabled officer) and
`service_role`. They need a Postgres superuser to create the temporary database. Supabase's own
`auth` and `storage` schemas are replaced by a small stand-in (`tests/db/bootstrap.sql`).

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

## Known limits of the milestone-1 tests

- The tests do not run a real Supabase stack (GoTrue, PostgREST, Storage). RLS is tested against
  plain Postgres with stand-ins for `auth.uid()` and the storage tables; officer-management rules
  are tested against an in-memory store. The calls into Supabase Auth (create user, ban, password
  change) and the login/logout/change-password routes are therefore only type-checked and
  smoke-tested against a stub, not exercised end to end. First real run: follow the Supabase steps
  above and walk through login, forced password change, create officer, disable officer.
- CI is configured (`.github/workflows/ci.yml`) but has not run yet.
