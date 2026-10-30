# PLAN.md: Project EK ZINDAGI

Status: **draft for approval. No application code has been written.**
Source of requirements: `reference/EK_ZINDAGI_master_prompt.md`. Visual target: `reference/certificate-reference.png` and `.html`.

---

## 1. Summary

An officer fills a short mobile form (location, name, WhatsApp number, violation, optional photo). The server generates an A4 awareness certificate PDF and delivers it by WhatsApp. Personal data (name, phone, photo, PDF) is deleted within 24 hours; only non-identifying counts and a phone hash are kept.

Flow: **Form -> Certificate -> WhatsApp.** Nothing else.

## 2. Stack and justification

| Concern               | Choice                                                                                    | Why                                                       |
| --------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| App                   | Next.js (App Router), TypeScript strict                                                   | One deployable for UI and API routes; matches the brief   |
| Hosting               | Vercel                                                                                    | Matches the brief. Region pinned close to Mumbai (`bom1`) |
| Data / Auth / Storage | Supabase (ap-south-1 Mumbai)                                                              | Auth, Postgres with RLS, private buckets in one place     |
| Styling               | Tailwind CSS, plain components                                                            | Light-theme plain form, no UI kit                         |
| Validation            | zod, shared between client and server                                                     | One schema, no drift                                      |
| PDF                   | Headless Chromium (`puppeteer-core` + `@sparticuz/chromium`) rendering the HTML template  | See 4                                                     |
| Jobs                  | Vercel Cron calling a protected route; SQL functions where possible                       | Retention, self-check, retries                            |
| Tests                 | Vitest (unit/integration), Playwright (e2e, PDF visual), pgTAP or SQL-level tests for RLS |                                                           |
| Lint/format           | ESLint, Prettier, `tsc --noEmit` in CI                                                    |                                                           |

Delivery sits behind `DeliveryProvider` with `bridge` and `cloud_api` implementations, selected by `DELIVERY_MODE`. No code or data change to switch.

## 3. Folder layout

```
/
  PLAN.md  README.md  .env.example
  config/
    violations.ts          # keys, Hindi/English labels and certificate lines (NGO-editable)
    settings.defaults.ts   # retention, dedupe, rate limits
  docs/  data-flow.md  runbook.md  privacy-notice.md  known-limitations.md  manual-test-script.md
  reference/               # given
  supabase/
    migrations/  seed/  tests/   # RLS tests
  src/
    app/
      (officer)/new  (officer)/done/[id]  (officer)/mine
      (supervisor)/dashboard  failures  review
      (admin)/officers  settings  audit
      api/ entries  entries/[id]/send  entries/[id]/retry  cert/[token]
           webhooks/whatsapp  cron/retention  cron/selfcheck  cron/retry  health
    lib/
      validation/   # phone, name, violation, entry schemas
      domain/       # code generation, retention dates, opt-out, dedupe: pure functions
      delivery/     # DeliveryProvider, bridge.ts, cloudApi.ts, factory.ts
      pdf/          # template.html builder, fonts, render.ts
      image/        # client compress + EXIF strip, server re-encode (sharp)
      geo/          # reverse geocoding adapter
      security/     # csrf, rate limit, hmac, signature verify, redaction logger
      supabase/     # server/client helpers
      audit/
    components/
  tests/ unit/ integration/ pdf/ security/ retention/ e2e/
```

## 4. PDF rendering decision

**Choice: HTML template rendered by headless Chromium.** The reference is already HTML/CSS (gradient gold frame, masked patterned border, SVG garland, rotated watermark). Chromium reproduces this exactly and shapes Devanagari correctly with bundled Noto fonts. Rebuilding in `pdf-lib` or `react-pdf` would mean re-implementing the gradients and shaping, and would not match the reference.

Constraints and mitigations:

- Fonts (Noto Serif, Noto Sans Devanagari) are bundled and loaded from local files; no network at render time.
- Photo is embedded as a base64 data URI after server-side re-encode, so no external fetch.
- The garland uses an inline script in the reference. In production the flower positions are **precomputed into static SVG** (no script at render time).
- `@sparticuz/chromium` cold start is the main risk. **Benchmark in milestone 3**: target under 5 s end to end (warm and cold) and under 1.5 MB. If cold start misses the target on Vercel, fall back to a small separate render service (Docker on Fly/Railway/Cloud Run in Mumbai) behind the same `renderCertificate()` function. I will report numbers before choosing.
- Hard rules (disclaimer, stamp, watermark) are in the template with no config input that can remove them. Tests assert their presence on every render. Name and place fields are HTML-escaped and length-clamped, with CSS that shrinks long names instead of overflowing.

## 5. Data model (summary)

Tables (all RLS on):

- `profiles` (user id, `officer_code`, role, active, display name)
- `entries`
  - Long-lived: id, `cert_code`, violation key, `other_text` (<=40 chars, kept only if non-identifying; cleared with PII to be safe), area_name, lat/lng rounded to 3 dp, officer_id, created_at, status, `delivery_mode`, `wa_message_id`, error code, `location_source`, `photo_source`, `gallery_reason`, `consent_checked`, `reviewed`, `phone_hash`, `challan_no` is **not stored** (see 12), `purged_at`.
  - Short-lived: `person_name`, `phone_e164`, `photo_path`, `pdf_path`, `expires_at`. Cleared by retention.
- `cert_links` (token hash, entry_id, expires_at, opened_at, open_count). Token stored hashed; 128-bit random token.
- `opt_outs` (phone_hash PK, created_at). Permanent.
- `delivery_events` (entry_id, kind, wa_status, error_code, at). No PII.
- `settings` (single row: delivery_mode, retention_hours, gallery_fallback, paused, branding flags).
- `audit_log` (actor, action, entry_id, meta without PII, at). Append-only (no update or delete for any role).
- `rate_limit` counters (or use a small table keyed by officer/ip/phone_hash with windows).

Cert code: `EKZ-JPR-` plus a non-sequential, non-guessable suffix (random 6 chars from a no-lookalike alphabet, uniqueness enforced, with a check character). Not derived from a counter.

Phone hash: HMAC-SHA256 over E.164 with `PHONE_HASH_SECRET`. Plain phone is never logged.

Storage: private buckets `photos` and `pdfs`; signed URLs generated server-side with short expiry only.

## 6. Security and privacy approach

- RLS: officer reads own entries only; supervisor aggregates through views with no PII columns; admin has no read on `person_name`, `phone_e164`, or storage. Column-level privileges plus views, backed by tests that attempt cross-reads.
- All writes go through server routes using the service role; the client never writes PII tables directly.
- zod `.strict()` on every route; phone normalised to E.164 (+91, starts 6-9); photo re-encoded with `sharp` (strip metadata, cap size, verify magic bytes).
- CSRF: same-site cookies plus origin check plus per-session token on mutating routes. Security headers and CSP in `next.config`. HSTS.
- Rate limits: per officer (hour/day), per IP, per phone hash. Webhook: HMAC `X-Hub-Signature-256`, timestamp/ID replay window.
- Idempotency: unique key per entry on send; `UPDATE ... WHERE status = 'ready'` claim pattern so concurrent sends cannot double-send.
- Logging: a redacting logger wrapper; test greps captured logs for name/phone/token patterns.
- `npm audit --audit-level=high` fails CI.
- Retention: cron deletes storage objects and nulls PII columns, writes audit entry, then **verifies** (queries for leftovers and listing storage). Daily self-check reports leftovers.

## 7. Delivery

**cloud_api (target):** template message with PDF document header, variables {{1}} name, {{2}} code. Template name, language and category in config; Meta's returned category logged. Webhook updates sent/delivered/read/failed, handles STOP and "बंद" (case/whitespace insensitive) -> opt-out hash. Retries with backoff for transient errors, then `failed`. `CAMPAIGN_PAUSED` checked before every send.

**bridge (interim):** PDF stored privately; expiring (24 h) unguessable link, rate limited, deleted with file. Officer sees "Open WhatsApp" (`wa.me`) with prefilled text. `link_opened` tracked; "delivered" is never claimed. README documents sender-number and ban risks.

## 8. Officer UI

Single column, light only, white background, Noto Sans + Noto Sans Devanagari, >=16 px text, >=48 px targets, bilingual labels, visible labels above inputs. Steps: auto location -> name -> number -> violation -> optional photo (live camera, retake; gallery fallback with reason and flag) -> consent checkbox if photo -> confirm-number screen with large digits -> send -> status screen with retry. Form state is persisted locally so a failed send never loses input. Client-side compress to <=1200 px JPEG and EXIF strip before upload. Hindi/English strings in one dictionary. I will follow your form screenshots over my own styling once you send them.

## 9. Milestones

Each ends with: all tests passing, a commit, a short summary and any decision I need from you.

1. Setup, auth, roles, RLS, audit log, admin creates officers, RLS tests.
2. Officer form (GPS, camera, validation, confirm step), entry save.
3. Certificate template, PDF render, benchmarks, visual comparison against the PNG.
4. Bridge-mode delivery with expiring links.
5. Cloud API delivery, webhook, STOP, idempotency, retries.
6. Retention job and self-check, supervisor/admin screens, kill switch, CSV counts.
7. Hardening, full test run, docs (data-flow, runbook, privacy notice, limitations, manual test script), deploy.

## 10. Test plan

Per section 12 of the master prompt: unit (validators, code generation, line mapping, hashing, retention logic, opt-out), integration with only the WhatsApp API mocked, PDF tests (Devanagari, mandatory elements with no photo / long name / special characters, size, time, visual diff vs PNG with tolerance), security tests (RLS, auth, rate limits, upload limits, log redaction), retention test with advanced clock, Playwright e2e at phone viewport with fake camera and geolocation (happy path, denied GPS, gallery fallback), and a manual script for real devices and real WhatsApp.

What I cannot test here: real WhatsApp delivery, real phone GPS and cameras, and Meta template approval. Those go in `docs/manual-test-script.md`.

## 11. Risks

| Risk                                                   | Impact                                            | Mitigation                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium cold start or size on Vercel                  | PDF slower than 5 s                               | Benchmark early (milestone 3); fallback render service                                                                                             |
| Meta template approval, or classification as Marketing | Real delivery delayed, higher cost                | Bridge mode ships first; category in config; submit template early                                                                                 |
| Bridge mode: personal-number bans, wrong number        | Number restricted, photo to a stranger            | Dedicated station phone with WhatsApp Business; confirm-number step; documented                                                                    |
| Government hosting rules may require an approved cloud | Hosting may need to move                          | Mumbai region now; keep Supabase/Vercel specifics behind thin adapters; confirm with police                                                        |
| Using a real person's photo and a "last seen" framing  | Distress, misuse, reputational and legal exposure | Consent checkbox stored, hard-coded disclaimer/stamp/watermark, no "late/RIP/deceased" wording, deletion in 24 h, opt-out; lawyer review (flagged) |
| Poor GPS or network in the field                       | Missing location or lost entry                    | Manual place fallback (flagged), local draft persistence, retry                                                                                    |
| Reverse geocoding terms                                | Production use of free endpoints breaches terms   | See 12                                                                                                                                             |
| Wrong-number or duplicate sends                        | Privacy incident                                  | Confirm step, dedupe by phone hash, runbook                                                                                                        |
| Hindi rendering differences between Chromium builds    | Layout drift                                      | Bundled fonts, visual regression test                                                                                                              |

## 12. Assumed defaults (from master prompt section 14; tell me if you disagree)

1. Photo is optional; live camera by default; flagged gallery fallback; consent checkbox required when a photo is present.
2. WhatsApp number and Meta business account belong to the NGO.
3. E-challan number: optional field per the brief, **not shown on the certificate**. My choice: **do not store it at all** in the first release, since it adds a linkable identifier and nothing in the flow needs it. Say so if the police need it for matching.
4. Hosting in Mumbai; government cloud requirement listed as a risk to confirm.
5. Police and NGO logos and the technology partner credit stay off until you confirm written permission (`SHOW_POLICE_BRANDING=false`). The PNG's "In association with Rajasthan Police*" line is therefore hidden by default.
6. Reverse geocoding: recommend **Google Maps Geocoding API** (clear commercial terms, reliable Indian place names; roughly US$5 per 1,000 requests, so a few hundred certificates a week is a few dollars a month) with **MapmyIndia (Mappls)** as the India-native alternative. **Not** public Nominatim. Costs and terms are from memory, so verify them before purchase. Coordinates are rounded to 3 dp before storage; the provider sees full coordinates, which is itself a data-flow item for the privacy notice. A manual place field covers a geocoder outage.
7. Pilot size 3 to 5 officers, 1 or 2 locations, a few hundred certificates a week. Defaults sized accordingly (per-officer limits around 60/hour, 300/day, configurable).
8. Officer login: email and password with inactivity timeout. Phone OTP deferred (SMS cost, India DLT registration overhead). TOTP optional for supervisor and admin.

## 13. Decisions I need from you

1. Approve this plan, or tell me what to change.
2. Confirm assumption 3 (not storing the e-challan number).
3. Confirm Google Maps Geocoding as the provider, or choose Mappls.
4. Your form screenshots (I will use the plain style until then).
5. Supabase project: should I use the connected Supabase account to create a Mumbai project, or will you create it? I won't create or change anything remote without your go-ahead.

## 14. Not building

Citizen app or login, payments, challan issuing or verification, e-challan integration, face recognition, long-term citizen data, SMS or email delivery, languages beyond Hindi and English.
