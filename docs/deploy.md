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
2. **Easiest:** open `supabase/setup-all.sql` (all ten migrations in one file), paste it whole into the SQL editor and press Run once. It is tested to run as one go on an empty project. **Or** apply the migrations in `supabase/migrations`, **in file order** (ten files, `…0001_init.sql` to `…0010_team_links.sql`; run them one at a time and stop at the first error). Either with the CLI (`supabase link --project-ref <ref>` then `supabase db push`) or by pasting each file into the SQL editor and running it.
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

| `COOKIE_SECRET` | random, 32+ characters (`openssl rand -hex 32`). Required: signs the cookie a team phone gets from its link. Changing it signs every team phone out until it opens its link again |
| `DELIVERY_MODE` | `bridge` to start |
| `SHOW_POLICE_BRANDING` | `true` only with written permission, otherwise `false` |

Also review `RETENTION_HOURS`, `DEDUPE_HOURS`, `ALLOW_GALLERY_FALLBACK`, `MESSAGE_LANGUAGE` and `GEOCODER` (`none` means officers type the place).

3. Custom domain with https (Vercel does the certificate). The app sets HSTS, so use a domain you will keep.
4. **Scheduled jobs.** `vercel.json` registers `/api/cron/retention` and `/api/cron/delivery-retry` **once a day**, so it deploys on the free (Hobby) plan (Hobby refuses anything more frequent and the deploy fails). The main deletion already happens immediately when a message is sent; the daily job only sweeps leftovers and retries failed sends. For every-5-minute runs, either use a Vercel plan that allows it, or point a free external scheduler (for example cron-job.org) at both URLs with the header `Authorization: Bearer <CRON_SECRET>`. Vercel sends that header itself for its own cron jobs.
5. Certificate PDFs use a headless Chromium inside the function. If PDF generation times out or runs out of memory, raise the function memory for `/api/entries/[id]/certificate` in the Vercel project settings (the route allows 60 seconds).
6. Deploy.

## 3. First admin and officers

1. On your own computer, with the **production** Supabase URL and service-role key in `.env.local`:

   ```bash
   ADMIN_EMAIL=you@example.org ADMIN_PASSWORD='at-least-12-characters' ADMIN_DISPLAY_NAME='NGO Admin' npm run seed:admin
   ```

   It refuses to run if an admin already exists. Remove the key from `.env.local` afterwards.

2. Log in at `/login` as the admin (password only). Open **Team links**, make a link for each station or team, and send each link to that team on WhatsApp (the screen has a share button with the install steps). An officer opens the link in Chrome, taps the three dots, **Add to Home screen**, and the form opens from an "एक ज़िंदगी" icon from then on: no password, no sign-in. If a link leaks or a phone is lost, make a new link for that team (the old one stops at once).

## 4. Smoke test (before any officer uses it)

Do all of this on production with test data, then use **Requests from citizens** to delete what you made.

- [ ] `/login` works; a wrong password is refused; the session ends after `INACTIVITY_MINUTES`.
- [ ] An officer (team phone) cannot open `/admin`.
- [ ] A team link opens the form on a real phone, "Add to Home screen" works, and the icon opens the form directly; **New link** stops the old link and the phone that used it.
- [ ] After a test send the entry shows only counts (no name, number or PDF) on the dashboard.
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
