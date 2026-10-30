# Deploying: Supabase and Vercel

Written for a pilot (3 to 5 officers, 1 or 2 locations, a few hundred certificates a week). Allow half a day, and
do the checks at the end before any officer uses it. Nothing here has been run against a real Supabase or Vercel
project by the developer: the first deploy is also the first real test. Follow the steps in order and stop at the first surprise.

## 0. Before you start

- Decide who owns the accounts (NGO) and who has a second login.
- Decide the delivery mode. The intended mode is `cloud_api` through the NGO's WhatsApp Business account (Taprizz): the certificate arrives as a PDF file in the person's chat and stays on their phone, and our copy is deleted minutes after delivery. Use `bridge` only for the first tests (no business account needed) or as a fallback; do the steps in `docs/whatsapp-setup.md` and get the template approved before switching.
- The police logo shows the State Emblem. `SHOW_POLICE_BRANDING=true` only with written permission on file. Never put a police-branded demo on a public address.
- Government hosting rules may require a specific approved cloud or region. Confirm before putting real data on a commercial host (see `docs/known-limitations.md`).

## 1. Supabase

1. Create a project in the **Mumbai (ap-south-1)** region. Save the database password in a password manager.
2. Apply the migrations in `supabase/migrations`, **in file order** (eight files, `…0001_init.sql` to `…0008_mfa.sql`; run them one at a time and stop at the first error). Either with the CLI (`supabase link --project-ref <ref>` then `supabase db push`) or by pasting each file into the SQL editor and running it.
3. **Check it** (the migrations only help if they all went in): paste `supabase/verify.sql` into the SQL editor and run it. A healthy setup shows one row, `ok | nothing wrong found`. Any other row names a problem (a table without row level security, a public bucket, a browser role that can read personal data, a missing migration): fix it before going on. The same check can be run again at any time.
4. Check Storage: two **private** buckets, `photos` and `pdfs`, exist (the first migration creates them). Neither may be public.
5. Authentication: turn **off** "Allow new users to sign up" and email confirmation does not matter (accounts are created by an admin). Set the JWT expiry to 1 hour or less.
6. Copy from Settings, API: the project URL, the anon (publishable) key and the service-role (secret) key.

## 2. Vercel

1. Import the repository. Framework: Next.js. Node 22.
2. Set environment variables for **Production** (see `.env.example` for all of them, and the README for what each means). The ones that must be set:

   | Variable                        | Value                                                                                       |
   | ------------------------------- | ------------------------------------------------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | project URL                                                                                 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key                                                                                    |
   | `SUPABASE_SERVICE_ROLE_KEY`     | service-role key. **Server only; never a `NEXT_PUBLIC_` variable**                          |
   | `PHONE_HASH_SECRET`             | random, 32+ characters. `openssl rand -hex 32`. **Never change it later** (see the runbook) |
   | `APP_BASE_URL`                  | the public https address, no trailing slash                                                 |
   | `CRON_SECRET`                   | random, 32+ characters. Required: the server will not start without it                      |

| `MFA_SECRET` | random, 32+ characters (`openssl rand -hex 32`). Required: encrypts supervisors' and admins' authenticator secrets. Keep a copy in the password manager: losing it means everyone sets the app up again |
| `DELIVERY_MODE` | `bridge` to start |
| `SHOW_POLICE_BRANDING` | `true` only with written permission, otherwise `false` |

Also review `RETENTION_HOURS`, `DEDUPE_HOURS`, `ALLOW_GALLERY_FALLBACK`, `MESSAGE_LANGUAGE` and `GEOCODER` (`none` means officers type the place).

3. Custom domain with https (Vercel does the certificate). The app sets HSTS, so use a domain you will keep.
4. **Scheduled jobs.** `vercel.json` registers `/api/cron/retention` (every 10 minutes) and `/api/cron/delivery-retry` (every 5 minutes). Vercel sends `Authorization: Bearer $CRON_SECRET` itself. **Check your plan allows those schedules**: the free (Hobby) plan allows daily jobs only, and the deploy will be refused. Without a suitable plan, call both routes from Supabase `pg_cron` / `pg_net` or another scheduler with the same bearer header.
5. Certificate PDFs use a headless Chromium inside the function. If PDF generation times out or runs out of memory, raise the function memory for `/api/entries/[id]/certificate` in the Vercel project settings (the route allows 60 seconds).
6. Deploy.

## 3. First admin and officers

1. On your own computer, with the **production** Supabase URL and service-role key in `.env.local`:

   ```bash
   ADMIN_EMAIL=you@example.org ADMIN_PASSWORD='at-least-12-characters' ADMIN_DISPLAY_NAME='NGO Admin' npm run seed:admin
   ```

   It refuses to run if an admin already exists. Remove the key from `.env.local` afterwards.

2. Log in at `/login`. As an admin you are asked to set up an authenticator app first: scan the QR code with Google Authenticator, Microsoft Authenticator or similar, and type the 6-digit code. Do this on the admin's own phone and keep the phone safe. Then open **Officer accounts**, create the officers and one supervisor. Each gets a one-time temporary password and must change it at the first login. Hand it over in person or by a channel you trust.

## 4. Smoke test (before any officer uses it)

Do all of this on production with test data, then use **Requests from citizens** to delete what you made.

- [ ] `/login` works; a wrong password is refused; the session ends after `INACTIVITY_MINUTES`.
- [ ] An officer cannot open `/supervisor` or `/admin`.
- [ ] A supervisor is asked for the authenticator code at every sign-in; the same code a second time is refused; **Reset security code** (admin) works.
- [ ] Create an entry with your own number and a photo; the preview, the PDF and the image download look right.
- [ ] Send: bridge mode opens WhatsApp with a link; the link shows the PDF and stops working after 24 hours (or check the expiry).
- [ ] Supervisor: counts update, review list shows a gallery entry, **Pause campaign** stops a send, **Resume** restores it.
- [ ] Retention: call `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/retention`; the supervisor screen shows the run. Later check a test entry's data is gone.
- [ ] Admin: Settings, Audit log shows your actions. `curl https://<app>/api/cron/retention` without the header answers 401.
- [ ] Run the whole of `docs/manual-device-test.md` on real phones.

## 5. Switching delivery mode

Bridge to cloud API: finish `docs/whatsapp-setup.md`, set the `WHATSAPP_*` variables and `DELIVERY_MODE=cloud_api`, redeploy, set the webhook in Meta, then repeat the send and STOP checks of the manual test. Back to bridge: set `DELIVERY_MODE=bridge`, redeploy. Entries already sent are unaffected. Pause first so nothing is half-sent during the change.

## 6. Going back

Vercel keeps earlier deployments: promote the previous one to roll back code. Migrations are not rolled back automatically; take a Supabase backup before applying a new one and keep the files in order.

## 7. Keeping it healthy

- Watch `docs/runbook.md` section 10 daily during the pilot.
- Dependency audit runs in CI (`npm run audit:high`); update when it flags something.
- Delete test data and test accounts before launch.
