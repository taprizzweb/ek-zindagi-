# EK ZINDAGI: master build prompt for Claude Code

Paste this whole file as your first message in an empty project folder. Put the files from the `reference/` folder (certificate reference HTML and PNG, form screenshots I will add) into that folder first.

---

## 0. How I want you to work

You are the lead engineer on a production system that will be used by traffic police officers in Jaipur under a state government road safety campaign. This is not a prototype and not a tutorial. Write real, tested, maintainable code.

1. **Plan first.** Before writing code, read everything below, then write `PLAN.md` with the architecture, folder layout, milestones, risks and the answers you assumed for the open questions in section 14. Show me the plan and wait for my approval. Ask me only questions that block the work.
2. **Build in milestones** (section 13). Commit after each milestone with a clear message. Do not move on while tests for the current milestone fail.
3. **No placeholder code in production paths.** No mocked services behind real routes, no `TODO` stubs, no hard-coded secrets, no `console.log` of personal data. Mocks belong only in tests and a clearly named local dev mode.
4. **Test everything that matters** (section 12) and show me the results. If something cannot be tested here (real WhatsApp delivery, real phone GPS), say so plainly and give me a manual test script.
5. **Be honest.** If a requirement is risky, ambiguous or impossible, tell me and propose an alternative. Do not silently drop or soften a requirement. At the end, give me a list of known limitations.
6. Keep the product simple. Do not add features I did not ask for (no citizen app, no large database, no analytics beyond section 9).

---

## 1. What we are building

**Project EK ZINDAGI** is a road safety awareness campaign. An NGO is working with Rajasthan Police. When an officer issues a traffic challan, the officer also fills a short digital form. The system generates a personalized **awareness certificate** (PDF) with the person's photo in a framed portrait with a garland, the violation, place, date and time, and a unique code, and sends it to the person's WhatsApp number.

The message of the campaign: *"A small mistake on the road can have life-changing consequences. Your next mistake should not be your last."*

The core flow is only: **Form -> Certificate -> WhatsApp.** There is no citizen app, no long-term citizen database, and no police management system.

The certificate is a **hypothetical awareness illustration**. It must never look like, or be usable as, a real death certificate, accident report, or any official record. This is a hard rule (section 7).

---

## 2. Users and roles

| Role | Who | Can do |
|---|---|---|
| `officer` | Traffic police personnel | Log in, create entries, see only their own recent entries (status only, no personal data after retention) |
| `supervisor` | Senior police nominee | Everything an officer can, plus see unit-wide counts and failures, pause the campaign, review flagged entries |
| `admin` | NGO / tech partner | Create and disable officer accounts, change settings, see audit logs, no access to photos or phone numbers |

- Accounts are **created by an admin only**. No public sign-up.
- Use Supabase Auth. Officers sign in with email and password (or phone OTP if you can justify it for ease of use in the field). Sessions must expire; require re-login after inactivity. Support optional TOTP for supervisors and admins.
- Every officer has a stable `officer_code` (for example `JP-0421`) shown in the app and stored in the audit log.

---

## 3. Officer experience (this decides whether the project succeeds)

The officer is standing on a road with a phone, often in sunlight, often in a hurry. The whole entry must take **under 20 seconds** on a mid-range Android phone on 4G.

**Order of the screen, one column, top to bottom:**
1. **Location** is filled automatically from the phone GPS (`navigator.geolocation`). Show the place name and a small "location confirmed" mark. If permission is denied or GPS fails, show a manual place field and flag the entry `location_source = manual`.
2. **Date and time** are set automatically on the server (Asia/Kolkata). The officer cannot edit them.
3. **Name** of the person (required, 2 to 40 characters).
4. **WhatsApp number** (required, 10 digits, India, must start with 6 to 9). Show it back on a confirmation step in large digits ("Is this number correct?") before sending, because a wrong number sends someone's photo to a stranger.
5. **Violation** from a fixed dropdown (section 6). No free typing except under "Other".
6. **Photo** (optional):
   - Default is a **live in-app camera** (`getUserMedia`) with a clear capture and retake flow. Use the rear camera by default.
   - There is a small secondary link "Camera not working? Use gallery". Gallery use must ask for a reason from a short list, set `photo_source = gallery`, and show the entry in the supervisor's review list. This can be switched off in settings (`ALLOW_GALLERY_FALLBACK`).
   - When a photo is included, a required checkbox: "The person has been told how this photo will be used and agrees." Store the checkbox state with the entry.
   - Compress on the device (long edge at most 1200 px, JPEG), and strip all EXIF data before upload.
7. **Send certificate** button. Then a confirmation screen with the entry status and code.

**Rules for the interface (important):**
- It must look like a normal, plain government or utility form. **Light theme only, white background.** No dark mode, no gradients, no glass effects, no shadows-on-everything cards, no emoji, no decorative illustrations, no marketing hero. Neutral colors, one calm accent, clear borders, standard inputs.
- Labels are always visible above the field. Placeholders are only for format hints.
- Touch targets at least 48 px. Text at least 16 px. Works in bright sunlight (high contrast).
- **Bilingual labels: Hindi and English** (for example "नाम / Name"). Use Noto Sans Devanagari for Hindi.
- Mobile first (360 px wide up). Works on slow networks: show clear progress and never lose the entered data on a failed send; allow retry.
- Errors say what is wrong and how to fix it, never blame the officer.
- I will send you screenshots of forms I want it to look like. Follow them over your own taste. Until then, use the plain style above.

---

## 4. Architecture and stack

Keep it simple. Recommended (change it only with a written reason in `PLAN.md`):

- **Next.js (App Router) + TypeScript**, deployed on **Vercel**.
- **Supabase**: Auth, Postgres with Row Level Security, private Storage buckets. Prefer the **Mumbai (ap-south-1)** region.
- **Tailwind CSS** for styling, plain components, no heavy UI kit.
- **zod** for validation on both client and server.
- **Scheduled jobs** (Vercel Cron or Supabase `pg_cron`) for retention and cleanup.
- **PDF generation on the server** (section 7). It must render Hindi (Devanagari) correctly, produce A4 output, and finish within about 5 seconds.
- Secrets only in environment variables and server code. A complete `.env.example`.
- PWA basics (installable, offline shell showing "no connection, your entry is saved on this phone") are welcome but optional.

**Delivery is behind one interface** so we can switch providers without touching the rest:

```ts
interface DeliveryProvider {
  send(input: DeliveryInput): Promise<DeliveryResult>;
}
```

Two implementations (section 8), chosen by `DELIVERY_MODE=bridge | cloud_api`.

---

## 5. Data model and retention (minimum data, deleted fast)

Collect the least data possible and delete it fast. Design the tables yourself, but meet these rules.

**Short-lived (delete after delivery is confirmed, or after 24 hours at most; configurable `RETENTION_HOURS`, default 24):**
- Person's name
- Person's phone number (plain)
- Photo (storage object)
- Generated PDF (storage object)

**Kept longer (no way to identify the person from these):**
- Entry id and certificate code (for example `EKZ-JPR-000123`, unique, not guessable from the previous one)
- Violation type
- Area name and coordinates rounded to 3 decimals
- Officer code, created time, delivery status and timestamps
- Flags: `location_source`, `photo_source`, `consent_checked`, `reviewed`
- Phone **hash** (HMAC-SHA256 with a server secret, never plain) for two purposes only: stopping duplicate sends within `DEDUPE_HOURS` (default 24) and the **opt-out list** (numbers that replied STOP). Opt-out hashes are kept permanently.

**Audit log** (who did what and when, no personal data in it): login, entry created, delivery attempted and result, settings changed, entry reviewed, deletion job run.

Requirements:
- Row Level Security on every table. An officer can only read their own entries. No role reads another role's data except as in section 2.
- Storage buckets are private. Files are reached only through server-side signed URLs with a short expiry.
- A retention job that deletes expired files and clears name and phone fields, writes an audit entry, and **verifies** the deletion (a test and a daily self-check that reports any leftover).
- Never log names, phone numbers, photos, or tokens. Redact in error reporting.
- Provide `docs/data-flow.md` listing exactly what is collected, why, where it is stored, and when it is deleted, in plain language. A short privacy notice text (Hindi and English) for the officer to show or read out, with placeholders for the grievance contact. Keep it aligned with India's Digital Personal Data Protection Act (purpose limitation, minimal data, deletion, grievance route). Do not claim legal compliance; say what the design does and flag points for a lawyer to confirm.

---

## 6. Violation list

Fixed list stored as an enum with Hindi and English labels. Each has a line shown on the certificate.

| Key | English label | Certificate line (English) |
|---|---|---|
| `helmet` | Riding without a helmet | Wear your helmet. Someone is waiting for you at home. |
| `seatbelt` | Driving without a seatbelt | Buckle up. Someone is waiting for you at home. |
| `child_helmet` | Child without a helmet on a two-wheeler | Your child's life fits in one helmet. Put it on every ride. |
| `wrong_side` | Driving on the wrong side | The wrong side of the road leaves no second chance. |
| `overspeed` | Overspeeding | Speed saves minutes, not lives. Slow down. |
| `mobile` | Using a mobile phone while driving | No call is worth a life. Put the phone down. |
| `other` | Other traffic violation (officer picks from a short second list or types up to 40 characters) | Follow the rules. Someone is waiting for you at home. |

Provide Hindi labels and a Hindi version of each line. Store them in one config file so the NGO can edit wording without code changes.

---

## 7. The certificate (PDF)

Reference files are in `reference/` (`certificate-reference.html` and `certificate-reference.png`). Match the layout and look closely. Elements:

- Vintage parchment style, double border, bold headline "YOUR NEXT MISTAKE SHOULD NOT BE YOUR LAST".
- **Photo** inside an ornate **gold portrait frame**, with a **marigold garland** around it. If there is no photo, show a neutral silhouette placeholder inside the same frame.
- Person's name, violation, date and time, **"Last seen"** (the place), and the unique certificate code.
- The violation-specific awareness line (section 6), the Hindi line, and the campaign footer (NGO logo area, "Technology Partner" credit).
- Corner stamp **"FOR AWARENESS PURPOSE ONLY (HYPOTHETICAL)"**, a faint diagonal watermark across the whole page ("FOR AWARENESS PURPOSE ONLY, NOT A LEGAL DOCUMENT"), and the disclaimer box.

**Hard rules (not negotiable, add tests for them):**
1. The disclaimer, the stamp and the watermark are on **every** certificate. They cannot be turned off by any setting.
2. Never copy the format, wording, seals or numbering style of a real death certificate or any government record. No government emblem. No "late", "RIP", "deceased" or similar wording.
3. **Rajasthan Police name and logo** appear only when `SHOW_POLICE_BRANDING=true`, which stays false until I confirm written permission. Same for the NGO logo (`NGO_LOGO_PATH`) and the technology partner credit text (`PARTNER_CREDIT_TEXT`).
4. The PDF has the code and date embedded, is A4, and stays under about 1.5 MB.

Rendering approach is your call, with a written justification in `PLAN.md`. Constraints: correct Devanagari shaping, bundled fonts (no network font fetch at render time), visual fidelity to the reference, under about 5 seconds, works within the host's limits. A headless-Chromium route (for example `puppeteer-core` with `@sparticuz/chromium`) is the likely fit; benchmark it and tell me if it is not.

---

## 8. Delivery (WhatsApp)

WhatsApp is the only channel. The citizen installs nothing.

### 8a. `cloud_api` mode: WhatsApp Cloud API (the real system)

- Official **WhatsApp Business Cloud API** from Meta, on the **NGO's** verified business account (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` in env).
- Send an **approved template message** with a **document header** (the PDF) and body variables. Template name and language are config. Handle the template categories (Meta may classify it as Marketing instead of Utility); keep the category in config and log what Meta returns.
- Draft body text for approval (Hinglish, short, no mention of challans):

  > Namaste {{1}} ji
  > Jaipur mein *Project EK ZINDAGI* road safety awareness campaign chal raha hai. Iska maksad hai ki sadak par ki ek chhoti galti ko hum halke mein na lein, kyunki zindagi sirf ek hi hoti hai.
  > Aapka awareness certificate attached hai. Yeh ek kaalpanik chitran hai, koi official document nahi.
  > Code: {{2}}
  > Band karne ke liye *STOP* likhein.

- Upload the PDF as media (or send a short-lived signed link if the API requires it), send, store `wa_message_id`.
- **Webhook** endpoint: verify the signature (`X-Hub-Signature-256`) on every request, update status (`sent`, `delivered`, `read`, `failed` with the error code), and handle inbound **STOP** (any case and Hindi equivalent such as "बंद") by adding the number hash to the opt-out list. Never send to an opted-out number.
- Idempotency: the same entry must never be sent twice (idempotency key per entry). Retry transient failures with backoff, up to a limit; then mark `failed` and show it to the supervisor.
- Respect Meta's rate limits and quality rating. A kill switch (`CAMPAIGN_PAUSED`) stops all sends immediately.

### 8b. `bridge` mode: until the API is approved (days, not weeks)

- After the officer submits, the server stores the PDF privately and creates a **certificate link**: unguessable (at least 128 bits of randomness), **expires in 24 hours**, rate limited, and deleted with the file.
- The officer's screen shows a button **"Open WhatsApp"** that opens `https://wa.me/91XXXXXXXXXX?text=...` with the number and the message (with the certificate link) already filled in. The officer only has to tap Send.
- `wa.me` cannot attach a file, which is why the link is used. Say this clearly in the UI help text.
- Track `link_opened` through the link itself. Do not claim "delivered" in bridge mode.
- Document in the README the risks: the message goes from the sender's own WhatsApp number (use a dedicated station phone with WhatsApp Business, not a personal number), and WhatsApp may restrict numbers that message many strangers.

Switching `DELIVERY_MODE` must need no code change and no data migration.

---

## 9. Supervisor and admin screens (small)

Plain tables, no charts needed:
- **Today and this week**: entries created, sent, delivered, failed, link opened, by officer and by violation. No personal data.
- **Failures** with the reason and a retry button (retry only while the data still exists).
- **Review list**: entries flagged `gallery`, `manual location`, no consent checkbox, or repeated numbers.
- **Settings** (admin): officers (create, disable, reset), delivery mode, retention hours, gallery fallback on or off, campaign pause, branding switches.
- **Audit log** viewer with filters.
- CSV export of the counts (never of personal data).

---

## 10. Security checklist (build it in, do not bolt it on)

- HTTPS only, HSTS, strict security headers and a Content Security Policy.
- Server-side validation of **every** input with zod; reject unexpected fields. Phone numbers normalized to E.164.
- Image upload: check type and size on the server, re-encode the image on the server, drop metadata.
- Rate limits: per officer per hour and per day, per IP, and per phone hash (duplicate window). Sensible defaults in config.
- CSRF protection on state-changing routes, secure cookies (`HttpOnly`, `Secure`, `SameSite`).
- RLS tests that prove an officer cannot read another officer's entries or any storage object.
- No secrets in the client bundle. Run a dependency audit and fail the build on high severity issues.
- Webhook signature verification and replay protection.
- An incident runbook in `docs/runbook.md`: wrong number sent, person asks for deletion, lost officer phone (disable account and sessions), token leak (rotate), campaign needs to stop now.

---

## 11. Quality bar

- TypeScript strict mode, ESLint and Prettier clean, no `any` without a comment.
- Small, readable modules; business rules (validation, code generation, retention, violation lines) in plain functions that can be unit tested.
- Accessibility: keyboard and screen reader friendly, labels tied to inputs, visible focus, contrast checked.
- Error handling that never loses the officer's data. A clear state for every step: saving, generating, sending, sent, failed.
- `README.md` with setup, environment variables, deploy steps (Vercel and Supabase), how to create the first admin, how to switch delivery mode, and how to test with a real phone.

---

## 12. Testing (I expect to see results)

1. **Unit tests**: validators (phone, name, violation), certificate code generation (unique, not sequential-guessable), violation-line mapping (Hindi and English), phone normalization and hashing, retention date logic, opt-out matching.
2. **Integration tests** (mock only the WhatsApp API server): entry creation, PDF generation, both delivery modes, idempotent send, retry and failure path, webhook signature check, STOP handling, link expiry.
3. **PDF tests**: Devanagari renders, disclaimer, stamp and watermark are always present (even with no photo, a very long name, or special characters), file size and render time under limits, and a **visual comparison** against the reference image with a tolerance.
4. **Security tests**: RLS cannot be bypassed, unauthenticated access is refused, rate limits trigger, oversized or wrong-type uploads are refused, no personal data appears in logs.
5. **Retention test**: create entries, advance time, run the job, confirm that name, phone, photo and PDF are gone and the audit entry exists.
6. **End-to-end (Playwright)** at a phone viewport with a fake camera and fake geolocation: login, auto location, fill the form, take a photo, confirm the number, submit, see the result. Also the denied-GPS path and the gallery-fallback path.
7. A **manual test script** for what needs a real device: real GPS, real camera on two Android phones, real WhatsApp delivery and STOP reply.

---

## 13. Milestones

1. Project setup, auth, roles, RLS, audit log, admin creates officers.
2. Officer form (GPS, camera, validation, confirm-number step), saving entries.
3. Certificate template and PDF generation, matching the reference.
4. Bridge-mode delivery with expiring certificate links.
5. Cloud API delivery with webhook, STOP handling, idempotency.
6. Retention job, supervisor and admin screens, kill switch.
7. Security hardening, full test run, docs, runbook, deploy.

After each milestone: run all tests, commit, and give me a short summary and anything that needs my decision.

---

## 14. Open questions: assume these defaults, list them in `PLAN.md`, and ask me only if you strongly disagree

- Photo is **optional**; if present, it comes from the live camera, with a flagged gallery fallback and the required consent checkbox.
- The WhatsApp number and the Meta business account belong to the **NGO**.
- The e-challan number is an **optional** text field and is **not** shown on the certificate.
- Data is hosted in the **Mumbai** region. Government hosting rules may require a specific approved cloud; list this as a risk for me to confirm.
- Police and NGO logos stay off until I confirm written permission.
- Reverse geocoding (coordinates to place name) needs a provider with proper terms for production use. Recommend one with its cost; do not rely on a free public endpoint for production.
- Pilot size: 3 to 5 officers, 1 or 2 locations, a few hundred certificates a week.

---

## 15. Out of scope

Citizen app or login, payment, challan issuing or verification, any link to the official e-challan system, face recognition, long-term storage of citizen data, SMS or email delivery, multiple languages beyond Hindi and English.

---

## 16. Final deliverables

Working code in the repository, migrations, seed script for the first admin, `.env.example`, `README.md`, `docs/data-flow.md`, `docs/runbook.md`, `docs/privacy-notice.md` (Hindi and English drafts), the full test suite with a passing run, and a short "known limitations and what to confirm with a lawyer and the police" note.

Start now with `PLAN.md`. Do not write application code until I approve the plan.
