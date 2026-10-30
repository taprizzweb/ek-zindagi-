# WhatsApp Cloud API setup (DELIVERY_MODE=cloud_api)

Bridge mode (`DELIVERY_MODE=bridge`) needs none of this. Switch to the Cloud API only after the steps
below are done and the template is approved. One variable changes the mode; no code change.

## What you need from Meta

1. A Meta Business account, verified for the organisation that sends (the NGO or the department).
2. A WhatsApp Business Account with a **dedicated phone number** (not a personal number).
3. An app (type "Business") with the WhatsApp product added.
4. A **system user** access token that does not expire, with `whatsapp_business_messaging` permission. Do not
   use the 24-hour test token in production.
5. The numeric **Phone number ID** (not the phone number).
6. The **App secret** (App settings, Basic). It signs every webhook call.

## The message template

Create and get approved one template, for example `ek_zindagi_certificate`:

- Category: **UTILITY** if Meta accepts it, otherwise MARKETING. Set `WHATSAPP_TEMPLATE_CATEGORY` to the
  category Meta actually approved. If Meta later reclassifies it, the app logs a warning, writes an
  audit entry (`template_category_changed`) and keeps sending; it never crashes.
- Header: **Document** (the certificate PDF is attached here at send time).
- Body, three variables, in this order:
  1. the person's name,
  2. the one safety line for the chosen violation, in Hindi and English on one line (`<Hindi> / <English>`),
  3. the certificate code (for example `EKZ-JPR-4ZK7MQ9`).
- Write the fixed body text in **Hindi and English together**, one after the other (the app sends no language choice). It must say who it is from (Jaipur road safety awareness camp, Project EK ZINDAGI), that the
  certificate is a hypothetical illustration, and how to opt out ("Reply STOP to stop messages").
- **No** mention of challan, fine, penalty or offence. Have the final text reviewed by the police and a lawyer before
  the first real send.
- Language: set `WHATSAPP_TEMPLATE_LANGUAGE` to the template's language code (default `en`).

## Environment variables

| Variable                      | Value                                                             |
| ----------------------------- | ----------------------------------------------------------------- |
| `DELIVERY_MODE`               | `cloud_api`                                                       |
| `WHATSAPP_PHONE_NUMBER_ID`    | Phone number ID                                                   |
| `WHATSAPP_TOKEN`              | System user token                                                 |
| `WHATSAPP_APP_SECRET`         | App secret (signs webhooks)                                       |
| `WHATSAPP_VERIFY_TOKEN`       | A random string you choose (10+ characters), also typed into Meta |
| `WHATSAPP_TEMPLATE_NAME`      | Approved template name                                            |
| `WHATSAPP_TEMPLATE_LANGUAGE`  | Template language code (default `en`)                             |
| `WHATSAPP_TEMPLATE_CATEGORY`  | `UTILITY` (default) or `MARKETING`                                |
| `WHATSAPP_API_VERSION`        | Graph API version, default `v21.0`                                |
| `CRON_SECRET`                 | Random string, 32+ characters. Vercel Cron sends it as a bearer.  |
| `DELIVERY_RETRY_MAX_ATTEMPTS` | Total attempts per entry, default 5                               |
| `CAMPAIGN_PAUSED`             | `true` stops all sending at once (kill switch), see below         |

The app refuses to start in `cloud_api` mode if a required value is missing.

## Webhook

In the Meta app, WhatsApp, Configuration:

- Callback URL: `https://<your-app>/api/webhooks/whatsapp`
- Verify token: the value of `WHATSAPP_VERIFY_TOKEN`
- Subscribe to the **messages** field (status updates and incoming replies) and **message_template_status_update**
  / **template_category_update** if offered.

Every POST is checked with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret) before anything
is read or stored. A wrong signature gets `401` and nothing is written. The same body is processed once (replays are
recognised by its hash). Statuses only move forward (`sent`, `delivered`, `read`); a status that arrives before we
have recorded the send waits and is applied afterwards.

**STOP:** an incoming reply of STOP, UNSUBSCRIBE, "band karo" and similar puts the number on the opt-out list
(stored as a keyed hash, not the number). The next entry for that number is refused.

## How sending behaves

- One tap sends **at most one message** per entry. Five quick taps still send once.
- A **timeout, a dropped connection or an answer without a message id** means we do not know whether it was sent.
  Such an entry is marked failed and is **never retried automatically**; a supervisor decides. This is deliberate:
  a duplicate message to a citizen is worse than a missing one.
- Temporary failures (5xx, rate limits, some Meta codes) are retried a few times at once (1 s, 3 s, 6 s; `Retry-After`
  is honoured up to 10 s) and then by the background job after 5, 15, 60 and 180 minutes, up to
  `DELIVERY_RETRY_MAX_ATTEMPTS`.
- Permanent failures (number not on WhatsApp, and so on) and configuration failures (expired token, template missing or paused)
  are final and shown to the officer.
- The background job is `/api/cron/delivery-retry` (every 5 minutes, see `vercel.json`). It needs
  `Authorization: Bearer $CRON_SECRET`.

## Kill switch

Two ways, both stop every send (bridge and cloud API) and the background job at once; officers see "Sending is paused":

- On screen: a supervisor or admin taps **Pause campaign** on the supervisor screen (or the admin settings). Resume the same way.
- Environment: `CAMPAIGN_PAUSED=true` and redeploy. This is a hard switch: the screen cannot resume it.

## Retrying a failure

The supervisor screen lists failures with a reason. **Retry** sends the message again, once, through the same checks as a first send.
It works only while the PDF still exists. If the failure says "unknown whether the message was sent", check with the
person first (the screen asks for confirmation): a second certificate is worse than a late one.

## Not verified yet

This has been tested against a fake of the WhatsApp API and the real Postgres functions, not against Meta.
Before the first real send: send to your own number, check the delivered/read statuses arrive, reply STOP and
confirm the next attempt is refused.
