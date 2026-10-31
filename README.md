# EK ZINDAGI

Road safety awareness campaign for Rajasthan Police and an NGO. An officer fills a short form
while issuing a challan; the system makes a personalised, clearly hypothetical awareness
certificate (PDF) and sends it to the person's WhatsApp number. Personal data is deleted within
24 hours.

- Requirements: `reference/EK_ZINDAGI_master_prompt.md`
- Plan and decisions: `PLAN.md`
- Visual reference for the certificate: `reference/certificate-reference.png`

## Status

| Milestone                                                     | State |
| ------------------------------------------------------------- | ----- |
| 1. Setup, auth, roles, RLS, audit log, admin creates officers | done  |
| 2. Officer form                                               | done  |
| 3. Certificate PDF (redesigned: landscape v2)                 | done  |
| 4. Bridge delivery (24-hour links, wa.me hand-off)            | done  |
| 5. Cloud API delivery (webhook, STOP, retries, kill switch)   | done  |
| 6. Retention, supervisor/admin screens, kill switch           | done  |
| 7. Hardening, docs, deploy                                    | done  |

All seven milestones are built. **It has not been run against a real Supabase, a real WhatsApp account or a real
phone.** Read `docs/known-limitations.md` first: it lists what is verified, what is not, what is not built, and what to confirm with a lawyer and the police.

| Document                     | For                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `docs/deploy.md`             | Setting up Supabase and Vercel, first admin, smoke test, switching delivery mode |
| `docs/whatsapp-setup.md`     | Meta account, template, webhook, kill switch, retries                            |
| `docs/data-flow.md`          | Exactly what is collected, why, where it lives and when it is deleted            |
| `docs/privacy-notice.md`     | Hindi and English notice drafts for officers (placeholders to fill)              |
| `docs/runbook.md`            | Wrong number, deletion requests, lost phone, leaked secret, stopping now         |
| `docs/manual-device-test.md` | The checklist for real phones and real WhatsApp                                  |
| `docs/known-limitations.md`  | Limits, open decisions, what to confirm with a lawyer and the police             |

## How it works now (after the design and flow update)

Read `CHANGES_PLAN.md` for what changed and where I disagreed with the update prompt.

### The certificate

Landscape A4 (297 x 210 mm; a 1123 x 794 px canvas), ported from `reference/certificate_v2.html`:
headline **MIGHT DIE SOON**, the citizen's photo in a framed picture with a marigold garland, incense
sticks and a brass base (a neutral silhouette when there is no photo), name, date and time, place, and
a checklist of seven violations with only the chosen one filled. Anton and Libre Baskerville are
bundled in `public/fonts`; Devanagari names and places fall back to Noto Serif Devanagari.

- **One component, two uses.** `src/components/certificate/Certificate.tsx` is the live preview on the
  officer screen and, rendered to static HTML, the page Chromium prints to PDF. Text that has to shrink
  (name, date, place, headline) uses one shared function, `fit.ts`.
- **Always present, no setting can remove them:** the corner stamp "FOR AWARENESS PURPOSE ONLY" (no
  "HYPOTHETICAL"), the diagonal watermark "FOR AWARENESS PURPOSE ONLY / NOT A LEGAL DOCUMENT", and the
  disclaimer line. They are written into the component itself.
- **Not printed any more:** the old per-violation awareness lines and the Hindi slogan. They stay in
  `src/config/violations.ts`; the WhatsApp message uses the per-violation line.
- **PDF:** A4 landscape, one page, about 100 to 200 KB, the certificate number and date in the file
  properties (the person's name is not), fonts embedded, no network access during rendering.
  Rendering takes about 1 s (see benchmarks below).
- **Download image:** the same page as a 2x PNG.

### Configuration (branding and legal flags, all default OFF)

| Variable               | Default                                                                 | Effect                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `SHOW_POLICE_BRANDING` | `false`                                                                 | Only the exact value `true` prints the police logo (top left of the certificate). The certificate never prints the police name. |
| `POLICE_LOGO_PATH`     | `assets/branding/jaipur-police.png` (used only when the flag is `true`) | PNG or JPEG inside the project, 300 KB at most. **With the flag off the file is never opened**; a test proves it.               |
| `NGO_LOGO_PATH`        | none                                                                    | NGO logo, top left (beside the police logo when both are on).                                                                   |
| `PARTNER_CREDIT_TEXT`  | none                                                                    | Printed as "Technology Partner: ..." in the footer.                                                                             |
| `DELIVERY_MODE`        | `bridge`                                                                | `bridge` or `cloud_api` (see below). One variable, no code change.                                                              |
| `APP_BASE_URL`         | none                                                                    | Public https address of the app; the certificate link in the message starts with it.                                            |

> **Branding stays off until written permission is confirmed.** The police logo shows the State Emblem
> of India (Ashoka Stambh), whose use is restricted by the State Emblem of India (Prohibition of
> Improper Use) Act, 2005. Do not set `SHOW_POLICE_BRANDING=true`, and do not add the logo or the emblem
> anywhere else, until the police have confirmed in writing that the logo and the emblem may be used on
> this certificate. **Never publish a police-branded build or demo on a public URL**; keep it local or
> internal. Without the flag, the subtitle reads "Project EK ZINDAGI · Jaipur", the signature line reads
> "Project EK ZINDAGI · Awareness camp", and the certificate number stays `EKZ-JPR-xxxxxxx`.

### Other settings

All settings are listed in `.env.example`; `tests/unit/env-docs.test.ts` keeps it complete. Besides those above and in
`docs/deploy.md` and `docs/whatsapp-setup.md`:

| Setting                                                    | Default  | Meaning                                                                                                                                                            |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LOGIN_MAX_ATTEMPTS_PER_IP`                                | 20       | Login attempts per address per 15 minutes                                                                                                                          |
| `ENTRY_MAX_PER_OFFICER_HOUR` / `ENTRY_MAX_PER_OFFICER_DAY` | 60 / 300 | Entries (and sends) one officer may make                                                                                                                           |
| `ENTRY_MAX_PER_IP_HOUR`                                    | 200      | Entries from one address                                                                                                                                           |
| `GEOCODER` / `GOOGLE_MAPS_API_KEY`                         | osm      | `osm`: free OpenStreetMap place names, no key (light use). `google`: needs the key. `none`: the officer types the place. Only rounded coordinates leave the server |
| `CHROMIUM_EXECUTABLE_PATH`                                 | empty    | Local development and tests only: a Chrome binary. On Vercel the bundled build is used                                                                             |

### The officer screen

Plain white, big tap targets (at least 44 px), Hindi and English labels, one column on a phone and form
plus preview side by side on a wide screen.

1. **Fill in:** name, WhatsApp number, violation, photo, then the read-only date and time and the place
   (GPS, with an editable name if GPS fails). The **certificate preview updates as you type**.
2. **Photo:** the live camera is the main action. "Camera not working? Use gallery" is a small secondary
   link below it, asks for a reason and flags the entry for review (switch off with
   `ALLOW_GALLERY_FALLBACK=false`). Both paths are compressed on the phone to 1200 px and re-encoded on
   the server with all metadata removed. The consent box appears with any photo.
3. **Generate certificate:** saves the entry and makes the PDF. Safe to repeat; a dropped connection can
   never create a second entry.
4. **Then:** Download PDF, Download image, and **Send on WhatsApp**. Just before sending, the number is
   shown in large digits ("Is this number correct?") next to the message the person will receive, and
   "Wrong number?" brings the form back with everything kept.

The date and time on the certificate is the **server's** time of record, not the phone's clock (see
`CHANGES_PLAN.md`, point 3). The preview shows the phone's clock until the entry is saved.

### Delivery: bridge mode and cloud API mode

- **Bridge (works today):** "Send on WhatsApp" creates a link that serves the PDF from private storage and
  **stops working after 24 hours**, then opens `wa.me/<number>?text=<message with the link>` on the
  officer's phone, who taps Send. `wa.me` cannot attach a file, which is why the message carries a link
  (the screen says so). The app cannot see whether the officer tapped Send or whether the message
  arrived, so it never says "delivered": the status reads "WhatsApp opened (not confirmed)", and "Link
  opened by the person" once the link is used. Risks: the message comes from the officer's own WhatsApp
  number (use a dedicated station phone with WhatsApp Business, not a personal number), and WhatsApp may
  restrict a number that messages many strangers.
- **The link:** a random 128-bit token (only its hash is stored), 24-hour limit enforced by the database,
  `410` after expiry, `404` for anything unknown or malformed, rate limited per IP, serves only the one PDF
  its token belongs to, never lists files, not indexed, not cached.
- **Cloud API (milestone 5):** official WhatsApp Business Cloud API with a template message and the PDF as
  the document header, signed webhook, STOP handling, at most one message per entry, retries for temporary
  failures only (an unknown outcome is never retried), and a `CAMPAIGN_PAUSED` kill switch. Setup:
  `docs/whatsapp-setup.md`. Tested against a fake WhatsApp API, **not yet against Meta**.
- **The message:** short; who it is from (Jaipur road safety awareness camp, Project EK ZINDAGI), that the
  certificate is a hypothetical illustration, one safety line for the chosen violation, the code and the
  STOP opt-out line. It never mentions a challan, fine, penalty or offence (tested for every language and
  violation).

### Retention, supervisor and admin screens (milestone 6)

- **Nothing about a person is kept.** In cloud API mode, the moment WhatsApp accepts the message the server
  deletes the PDF and the photo (and checks they are gone) and clears the name, the number and the number hash. What
  stays is a row of **counts**: team, violation, area, time and status. A sweep (`/api/cron/retention`, daily on the free plan, see `vercel.json`) catches anything that missed, and entries that were never sent (a failure
  waiting for a retry) are deleted when their expiry passes (24 hours by default). A file that cannot be deleted keeps
  its entry, which is tried again on the next sweep. Every sweep writes an audit entry with counts, and a self-check
  reports anything overdue or left over. Bridge mode keeps the PDF for its 24-hour link and is only a fallback.
  Because the number hash goes too, a second certificate to the same number is **not** blocked; the only list kept is
  the STOP list.
- **`COOKIE_SECRET` is required in production** (the server refuses to start without it): it signs the cookie a team
  phone gets from its link.
- **`CRON_SECRET` is required in production** (the server refuses to start without it), because the job
  cannot run without it. `vercel.json` runs both jobs once a day (the free Hobby plan allows nothing more frequent); for tighter schedules use a paid plan or an external scheduler that calls the two `/api/cron/*` routes with the bearer secret.
- **Dashboard** (for the admin; supervisor accounts also get it): pause or resume the campaign (one tap and a confirmation), counts for today and the
  week by officer and by violation, CSV of the counts, failures with a readable reason and a **Retry**
  button (cloud API mode, and only while the PDF still exists; an unknown-outcome failure asks for
  confirmation first), the review list (gallery photo, typed location, consent not ticked, same number
  again) with "Mark reviewed", and the last deletion run.
- **Admin screens:** **team links** (below), password accounts (optional), **settings** (pause, gallery fallback, retention hours; each
  change is audited), and the **audit log** with filters. Delivery mode, message language, branding and the
  duplicate window stay environment settings, shown read-only: changing them needs a redeploy on purpose.
- **Pause** is either the `CAMPAIGN_PAUSED` environment variable (a hard switch the screen cannot undo)
  or the saved setting. It stops sends in both delivery modes and the background retry job.

### Hardening and requests from citizens (milestone 7)

- **No logins for officers: team links.** The admin makes one link per station or team (Admin, Team links) and sends
  it on WhatsApp. An officer opens it once in Chrome, taps the three dots, "Add to Home screen", and from then on the
  phone has an "एक ज़िंदगी" icon that opens straight to the form (camera, GPS, certificate, send). There is no password and no
  authenticator. The link is the credential: its hash is stored, the phone keeps a signed cookie for a year, and the admin
  can **make a new link** (the old link and every phone that used it stop at once) or **switch the team off**. Wrong links get
  nothing and guessing is rate-limited. Only the admin signs in with a password (10 tries per account per quarter hour).
  The trade-off is in `docs/known-limitations.md`: a team link is shared, so the dashboard counts per team, not per person.
- Messages (the WhatsApp text and the template's safety line) carry **Hindi and English together**; there is no language
  setting. The certificate itself is unchanged.

- **Security checks on the production build** (`tests/e2e/hardening.e2e.test.ts`): security headers and a
  fresh CSP nonce on every page, no-store caching and no-indexing, `robots.txt`, session cookies that are
  HttpOnly, Secure and SameSite, **every API route found on disk refuses a stranger** (a new route that forgets
  its check fails the test), no secret or secret setting name anywhere in the browser bundle, and **no name,
  number, place, password, token or secret in the server logs** after a round of normal and failing requests.
- `tests/unit/env-docs.test.ts` fails if a setting exists in code but is missing from `.env.example` or the docs.
- **Requests from citizens** (`/requests`, supervisor or admin): delete one entry's data at once by the code on
  the certificate (files deleted and checked first, audited), or add a number to the opt-out list (hash only).

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
npm run test:e2e    # browser tests: builds the app, runs Chromium at phone size (see below)
npm run test:pdf    # certificate PDF tests (needs Chromium and Poppler, see below)
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

### Certificate PDF tests

`npm run test:pdf` renders real certificates with headless Chromium and inspects the PDF with Poppler
(`pdftotext`, `pdftoppm`, `pdfinfo`, `pdffonts`; on Debian/Ubuntu `sudo apt-get install poppler-utils`). It checks:
one A4 landscape page; stamp, watermark and disclaimer in the PDF for every render (no photo, a photo, 40-letter
name, long Hindi name, 120-character place, special characters, markup in every field, police branding); the
stamp no longer says HYPOTHETICAL; **only the chosen checkbox is filled** (pixel test for each of the 7
violations); long text shrinks and stays inside its box; Devanagari shaping with embedded fonts; size under
1.5 MB with a heavy photo; render time under 5 s; no network access while rendering; the PNG export; and
**visual regression** against `reference/certificate_v2.png` (without police branding, police wording
excluded) and `reference/certificate_v2_logo.png` (with branding and logo, whole page), plus golden
snapshots of seven fixtures in `tests/pdf/snapshots` (create or refresh with `UPDATE_SNAPSHOTS=1`).
A test proves the comparison fails when the layout is broken. `PDF_TEST_SERVERLESS=1 npm run test:pdf` runs
the same suite on the serverless Chromium build used on Vercel.

### Browser tests (end to end)

`npm run test:e2e` builds the app and drives it in Chromium at 360 px with a fake camera and fake GPS:
login, live preview updating while typing, camera-first with the gallery as a secondary link (both
compress), validation, Generate, Download PDF and image, the number check and message preview, the
`wa.me` address, the public 24-hour link (200, then 410 after expiry, 404 for bad tokens), "Wrong number?",
a lost response followed by a retry, duplicate and opted-out numbers, cross-origin refusal, and an
accessibility audit (labels, 44 px targets, contrast of all text, focus ring). It needs Playwright's
Chromium (`npx playwright install chromium`) and Poppler. Supabase is replaced by
`tests/e2e/fake-supabase.ts`, a test-only in-memory stand-in. Set `E2E_SKIP_BUILD=1` to reuse a build.

### Other test suites

- `npm run test:integration`: the WhatsApp client, sending, retries, webhook and STOP against a fake WhatsApp API.
- `tests/e2e/operations.e2e.test.ts`: supervisor and admin screens, pause, settings, audit log, retention job, citizen requests.
- `tests/e2e/cloud-api.e2e.test.ts`: the real app in cloud API mode, signed webhooks, cron, supervisor retry.
- `tests/e2e/hardening.e2e.test.ts`: security checks on the production build (see milestone 7 above).

## Known limits of the tests

- The tests do not run a real Supabase stack (GoTrue, PostgREST, Storage). RLS is tested against
  plain Postgres with stand-ins for `auth.uid()` and the storage tables; officer-management rules
  are tested against an in-memory store. The calls into Supabase Auth (create user, ban, password
  change) and the login/logout/change-password routes are therefore only type-checked and
  smoke-tested against a stub, not exercised end to end. First real run: follow the Supabase steps
  above and walk through login, forced password change, create officer, disable officer.
- The browser tests use the fake Supabase above, so they prove the form, the server rules and what gets
  stored, not the real Supabase Auth, PostgREST or Storage. Real GPS accuracy, real phone cameras and
  real mobile networks need the manual device test in `docs/manual-device-test.md`.
- CI is configured (`.github/workflows/ci.yml`) but has not run yet.
