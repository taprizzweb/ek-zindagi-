# Runbook: when something goes wrong

For the people running the project (NGO admin, technical contact, police supervisor). Each section says what to do,
in order. Where a person is distressed or a legal question comes up, stop and involve the named contacts first
(fill in below).

| Role                              | Name | Phone / email |
| --------------------------------- | ---- | ------------- |
| Project lead (NGO)                |      |               |
| Police supervisor                 |      |               |
| Technical contact                 |      |               |
| Grievance contact (public-facing) |      |               |

Keep the Vercel, Supabase and Meta logins with at least two people.

## 0. Stop everything now

Use this first when in doubt: a wrong message pattern, a complaint spreading, a security scare.

1. Supervisor screen, **Pause campaign**, confirm. (Or Admin, Settings.) Sending stops for every officer and the background retry job stops.
2. If the screen is not reachable: in Vercel, set `CAMPAIGN_PAUSED=true` and redeploy. This cannot be undone from the screen.
3. Write down the time and why. Tell the project lead and the police supervisor.
4. Resume only after the cause is understood and someone senior agrees: **Resume sending**.

## 1. A message went to the wrong number

Officers see the number again before sending ("is this number correct?"), but typos happen.

1. Ask the officer which entry (the certificate code is on the supervisor screen and in the officer's recent entries).
2. If the wrong person has contacted us: apologise, say it was a mistake and that their number will not be messaged again.
3. Supervisor, **Requests from citizens**: add the number to **Stop messaging me**, and **Delete my data** using the code (the certificate holds the other person's name).
4. We cannot recall a delivered WhatsApp message. Do not promise that. In bridge mode the message is on the officer's phone: ask the officer to delete the chat message for everyone if WhatsApp still allows it.
5. If the same officer makes repeated mistakes, check the review list and talk to them.

## 2. A person asks us to delete their data

1. Ask for the **certificate code** printed on their certificate (`EKZ-JPR-…`). If they have lost it, ask for the officer, place and approximate time, and find the entry from the supervisor lists.
2. Supervisor or admin: **Requests from citizens**, enter the code, **Delete data now**, confirm. The name, number, photo and PDF are deleted and checked; an audit entry (`entry_purged_early`) is written.
3. Tell the person: the data on our system is deleted; the message already on their WhatsApp is theirs to delete; our records keep only the non-personal fields in `docs/data-flow.md`.
4. If they also want no more messages, add the number under **Stop messaging me**.
5. Anything beyond this (access to data, complaints) goes to the grievance contact.

## 3. A person replies STOP, or complains they did not want it

- In cloud API mode a STOP reply is handled automatically (the number is added to the opt-out list). Check it worked: Admin, Audit log, action `opt_out_recorded`.
- In bridge mode the reply arrives on the officer's phone: the officer (or a supervisor) adds the number under **Stop messaging me**.
- A person who is upset or frightened: do not argue. Apologise, explain it is an awareness illustration and that no harm is meant, delete their data (section 2) and tell the police supervisor.

## 4. An officer's phone is lost or stolen

1. Admin, **Team links**: **New link** for that officer's team (the old link, and every phone that used it, stops at once), or **Switch off** the team while you find out. Then send the new link to the team's other officers.
2. Ask the officer to remote-lock or wipe the phone.
3. Check the dashboard for that team's counts since the loss: a burst you did not expect means the phone or link was used.

### Lost admin password or phone

- The admin panel has a password only. If an admin's password may be known to someone else, change it at once (another admin, or `npm run seed:admin` is for the first admin only: use the Supabase dashboard, Authentication, to set a new password) and read the Audit log for what was done.

## 5. A secret may have leaked

Rotate first, investigate second. Never paste a secret into chat or email.

| Secret                       | Where it lives        | What to do                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase service-role key    | Vercel env            | Supabase, Settings, API: roll the key, update `SUPABASE_SERVICE_ROLE_KEY`, redeploy. If it leaked, treat all data as exposed: see section 9                                                                                                                                                                          |
| WhatsApp access token        | Vercel env            | Meta Business settings: create a new system-user token, update `WHATSAPP_TOKEN`, redeploy, revoke the old one                                                                                                                                                                                                        |
| WhatsApp app secret          | Vercel env            | Meta app settings: reset it, update `WHATSAPP_APP_SECRET`, redeploy (until then webhooks are rejected)                                                                                                                                                                                                               |
| `COOKIE_SECRET`              | Vercel env            | Signs the team phones' cookie. Replace it and every team phone is signed out until it opens its link again (the links themselves still work): fine and cheap to do                                                                                                                                                   |
| `CRON_SECRET`                | Vercel env, scheduler | Choose a new random value, update in Vercel and in any external scheduler, redeploy                                                                                                                                                                                                                                  |
| `PHONE_HASH_SECRET`          | Vercel env            | **Do not rotate casually.** Every stored hash stops matching: the opt-out list would no longer protect anyone and duplicate checks restart. Rotate only if it leaked, and then tell the project lead: opt-out numbers cannot be rebuilt (we never keep the numbers), so people who said STOP could be messaged again |
| An admin or officer password | Person                | Admin, Officer accounts, **Reset password**; the person logs in with the temporary password and must change it                                                                                                                                                                                                       |
| Google Maps key              | Vercel env            | Google Cloud console: rotate, update `GOOGLE_MAPS_API_KEY`                                                                                                                                                                                                                                                           |

## 6. The deletion job is red

The supervisor screen says the deletion job has not run, or left things over.

1. Admin, Audit log, filter `retention_run` and `retention_leftover`: when did it last run, what was left?
2. Not run at all: check that `CRON_SECRET` is set in production, that the schedule exists in Vercel (Settings, Cron Jobs) and that your plan allows an hourly schedule. Call it by hand:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/retention` (the answer holds counts only).
3. `failed` above 0: a file could not be deleted (storage outage, permissions). The next run tries again. If it persists, check the Supabase Storage status and the service-role key.
4. Entries older than their time that are still there for more than two hours are reported as overdue. Do not leave this: if the job cannot be fixed within the day, delete the entries from "Requests from citizens" and tell the project lead.

## 7. Messages are failing

Supervisor screen, Failures. The reason is shown in words.

| Reason                                     | Meaning / action                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| WhatsApp access token expired              | Section 5: new token. Failures can be retried afterwards                                          |
| Template not found / paused / values wrong | Meta Business Manager, message templates. Fix or re-approve, then retry                           |
| Number is not on WhatsApp                  | Final. Ask the officer to confirm the number with the person                                      |
| Too many messages / rate limit             | Wait; retried automatically. If it continues, pause (section 0) and look at Meta's quality rating |
| Unknown whether the message was sent       | Never retried automatically. Ask the person if they received it before pressing **Retry**         |
| WhatsApp server error                      | Retried automatically up to the limit; check Meta's status page                                   |

A falling Meta **quality rating** or a restricted number is serious: pause, find out why (complaints, STOP replies), and
involve the project lead before resuming.

## 8. The site is down or very slow

1. Check the Vercel deployment and Supabase project status pages.
2. Officers: entries already saved are safe; the form shows a clear message and keeps what was typed. Tell them to wait or use paper notes, never a personal tool.
3. After an outage check the retention job ran (section 6) and the failures list.
4. Certificate generation needs a headless browser inside the function. If only certificates fail, check the function logs for out-of-memory or timeouts (Vercel function memory and `maxDuration`).

## 9. Suspected breach of personal data

1. Pause (section 0). Rotate the secrets involved (section 5).
2. Keep evidence: do not delete logs. Note what was exposed, when, and for how many people (the audit log and `entries` counts help).
3. Involve the project lead and a lawyer **the same day**. The law may require notifying the authority and the people affected, on a deadline. This project does not decide that.
4. Do not resume until the cause is fixed and checked.

## 10. A routine check

Daily while the pilot runs (two minutes, supervisor screen):

- Deletion job: last run under 3 hours ago, nothing left over.
- Failures: none that nobody has looked at.
- Review list: look at what is flagged, **Mark reviewed**.
- Campaign status shows Running (or Paused on purpose).

Weekly: download the CSV of counts, look at the Audit log for unexpected actions, confirm the officer list is current (disable people who left).
