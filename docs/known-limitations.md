# Known limitations, and what to confirm with a lawyer and the police

Written to be honest, not reassuring. Read this before the first real camp.

## 1. What has and has not been tested

**Tested automatically (all passing at the time of writing):** unit tests for the rules; 115 database tests that run the
real migrations against Postgres and try to break the access rules; integration tests with a fake WhatsApp API; the
certificate PDF on two Chromium builds with visual comparison; browser tests at phone size with a fake camera and GPS;
security checks on the production build (headers, cookies, every API route refusing strangers, no secrets in the browser
bundle, no personal data in server logs).

**Never run, and therefore unverified:**

- **A real Supabase project.** The tests use plain Postgres with stand-ins for Supabase's sign-in and storage, and an in-memory fake for the browser tests. Sign-in, forced password change, officer disabling, signed storage access and the storage "delete then check" behave according to Supabase's documentation and library, not according to a run. The first deploy is the first real test.
- **Real WhatsApp (Meta).** Sending, template approval, delivery statuses, STOP replies and error codes are tested against a fake that follows Meta's documented behaviour. Meta's real behaviour (template review, number quality rating, rate limits) may differ.
- **Real phones.** GPS accuracy, real cameras, real mobile networks and WhatsApp's own PDF viewer: only `docs/manual-device-test.md` can show these.
- **Vercel.** The serverless Chromium build is tested locally, but PDF generation time, memory and the cron schedules have not been seen on a real deployment.
- **CI.** The workflow file exists and has not run on GitHub yet.
- **Load.** Sized for a pilot (a few hundred certificates a week). No load test was run.
- **Accessibility.** An automated audit (labels, touch size, contrast, focus) plus the checks in the manual test. No test with real screen-reader users.

## 1b. Security: what is protected, and what is not

No system can be promised unhackable, and this one has not had an independent security test. What it does:
strict headers and a nonce-based content policy; sign-in with a per-address **and per-account** attempt limit;
a second step (authenticator app) for supervisors and admins on every sign-in, where a code works only once;
accounts that can be disabled at once; every write checked for a signed-in role and the same origin; every input validated
and unknown fields refused; personal data kept in server-only columns and deleted within a day; an append-only audit log
with no personal data; no secrets in the browser; a test that fails if any API route stops refusing strangers; weekly
dependency updates and a build that fails on a high-severity dependency issue.

What it cannot stop, and you must handle by other means:

- **Someone who gets the hosting or database accounts** (Vercel, Supabase, Meta). Protect those with their own two-step sign-in, at least two named owners, and no shared passwords.
- **A stolen, unlocked officer phone.** The officer account works until an admin disables it (runbook section 4). Phones need a screen lock.
- **Phishing and shoulder-surfing** of an officer's password. The second step covers supervisors and admins only: officers sign in with password alone (a deliberate choice, for speed in the field).
- **Anyone with the certificate link** in bridge mode for 24 hours.
- **Mistakes by people:** a wrong number typed, a message to a person who should not receive it.
- **Overload** (a flood of requests) beyond what the host's own protection and the rate limits absorb.
- **Flaws not yet found** in this code or in the libraries and services it uses. Get an independent penetration test before a wide rollout, and fix what it finds.

## 2. Not built

- **Recovery codes for the second step.** Supervisors and admins sign in with an authenticator-app code. If a supervisor loses the phone, an admin clears their set-up. If the **only admin** loses the phone, someone with the service-role key runs `npm run reset:mfa` (see the runbook). There are no printed backup codes.
- **Phone OTP sign-in** for officers (deferred on purpose: SMS cost and registration).
- **A rule for how long the non-personal records are kept.** Codes, violation, rounded location, officer and timestamps are kept with no automatic deletion. The audit log and opt-out hashes are meant to be permanent. Decide a period.
- **An age check.** The form does not ask the person's age.
- **Per-officer rate limits in the interface.** Limits exist on the server (per officer per hour and day, per IP, and the duplicate window); there is no screen to see who hit them.
- **A health or status page**, and automatic alerting. A red banner on the supervisor screen is the only warning; nobody is emailed or messaged.
- **Backup and restore rehearsal.** Rely on Supabase's own backups and test a restore before depending on them (the personal data is deleted within a day, but the audit log and counts are not).

## 3. Things that behave in ways people may not expect

- A certificate link in bridge mode is the only credential: anyone who has the link can open the PDF for 24 hours. It cannot be listed or guessed, but it can be forwarded.
- In bridge mode the app cannot see whether the officer tapped Send or whether the message arrived, so it never says "delivered".
- A WhatsApp message already delivered cannot be recalled by this system.
- In bridge mode the message comes from the officer's own WhatsApp number. Use a dedicated station phone (WhatsApp Business), not a personal number. WhatsApp may restrict a number that messages many strangers.
- After a timeout, a cloud API send of unknown outcome is **not** retried automatically (a duplicate certificate to a citizen is worse than a late one). A supervisor decides.
- Changing `PHONE_HASH_SECRET` breaks the opt-out list permanently: the numbers are not stored, so it cannot be rebuilt.
- The retention job runs hourly. Data can therefore live up to an hour past its stated time. The self-check flags anything more than two hours late.
- Scheduled jobs at this frequency need a Vercel plan that allows them, or another scheduler.
- Names and places are limited to Latin and Devanagari letters because those are the scripts the certificate fonts cover.
- The certificate says "Issued by Jaipur Traffic Police" and carries the police logo only when `SHOW_POLICE_BRANDING=true`.

## 4. To confirm with a lawyer

I am not a lawyer and this is not legal advice. These are the points the design raises.

1. **Who is responsible for the data** (the police unit, the NGO, or both) and what each must publish, appoint or sign. The privacy notice, the grievance contact and the agreements with the host and with WhatsApp depend on it.
2. **Consent and notice.** Is a tick box on the officer's phone, with the notice read out, enough for the photo and for processing the name and number? What must the notice contain?
3. **Children.** The certificate is addressed to a named person and may be sent to someone under 18. India's data protection law has special rules for children's data. Decide whether to exclude minors, and how.
4. **The certificate itself.** A mock memorial ("MIGHT DIE SOON", garland, incense, "last seen alive") with a real person's name and photo, sent to their phone, can distress people, be forwarded as a hoax or a threat, or be edited. The stamp, watermark, disclaimer and the "hypothetical" wording reduce but do not remove this. Have the police and a lawyer approve the final wording and decide who may receive it (for example adults only) before the first real send. It never mentions a challan, fine or penalty.
5. **Emblem and logo.** The Jaipur Police logo contains the State Emblem of India, whose use is restricted by law. Keep the written permission with the records.
6. **Data location and hosting.** Whether government rules require a specific approved cloud or region, and whether data processed by Meta (WhatsApp), Google (if geocoding is on), Vercel and Supabase leaves India and is permitted.
7. **Retention.** Whether 24 hours is right; how long audit logs, counts and opt-out hashes may or must be kept; whether a hash of a phone number is still personal data.
8. **Breach rules.** What must be reported, to whom and how fast (the runbook says to involve a lawyer the same day).
9. **WhatsApp business rules.** Which template category (utility or marketing) the message honestly is; opt-in expectations; what happens to the number if people report it.

## 5. To confirm with the police

- Who signs off the certificate wording and the message text, and who may be sent one.
- Whether officers may use their phones for this (bridge mode) or a station phone is provided.
- Who is the supervisor who watches the daily checks, and who receives a complaint.
- Which locations and how many officers take part in the pilot, and the end date.
- What the officers say to a person who refuses, and how a refusal is recorded (nothing is saved).

## 6. Decisions still open

- Supabase project region and the owner of the accounts.
- Reverse geocoding provider (the pilot works with `GEOCODER=none`: officers type the place) and its cost.
- Whether a supervisor may override the 24-hour duplicate rule (today: no).
- Printing the Hindi slogan on the certificate (not printed today).
- Whether to check that a number is on WhatsApp before generating the certificate.
