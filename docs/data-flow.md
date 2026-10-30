# Data flow: what is collected, why, where it lives, when it is deleted

Plain language. Keep this in step with the code: the retention rules below are tested (`tests/unit/retention.test.ts`,
`tests/db/rls.test.ts`, `tests/e2e/operations.e2e.test.ts`). This document describes what the design does. It is **not** a
statement that the project complies with any law; the points a lawyer must confirm are in `docs/known-limitations.md`.

## What the system does, in one paragraph

A traffic officer meets a person at a camp, fills a short form on a phone and (with the person's agreement) takes a
photo. The server makes a personalised **hypothetical awareness certificate** (a PDF that says clearly that it is not
a death certificate or a legal document) and the person receives it on WhatsApp. Nothing is sent to any police or
court system, no challan, fine or penalty is mentioned, and the person has no account.

## What is collected

### Deleted quickly (personal)

| Data                                        | Why                                                                                                 | Where it is stored                                                        | Deleted                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Name (2 to 40 characters)                   | Printed on the certificate and in the message                                                       | Database, `entries.person_name`                                           | Within `RETENTION_HOURS` of creation (default 24, at most 168), or 5 minutes after WhatsApp confirms delivery (cloud API mode) |
| Mobile number (+91…)                        | To send the certificate                                                                             | Database, `entries.phone_e164`                                            | Same                                                                                                                           |
| Photo (optional)                            | Printed on the certificate. Re-encoded on the server; camera metadata (location, device) is removed | Private storage bucket `photos`                                           | Same, files deleted first and checked                                                                                          |
| Certificate PDF                             | What the person receives                                                                            | Private storage bucket `pdfs`                                             | Same                                                                                                                           |
| Optional note when the violation is "Other" | Lists what the person did                                                                           | Database, `entries.other_text`                                            | Same                                                                                                                           |
| Certificate link (bridge mode)              | Lets the person open their PDF without logging in                                                   | Database, `cert_links` (a hash of a random token, never the token itself) | Expires after 24 hours; removed when the entry is purged                                                                       |

### Kept longer (cannot identify the person on their own)

| Data                                                                 | Why                                                                                                                | Kept                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Certificate code (`EKZ-JPR-…`)                                       | Lets a person ask about, or delete, their entry                                                                    | Until a retention period for records is decided (see limitations)                                                     |
| Violation type                                                       | Counts for the supervisor                                                                                          | Same                                                                                                                  |
| Area name and coordinates **rounded to 3 decimals** (about 110 m)    | Counts by place                                                                                                    | Same                                                                                                                  |
| Officer, time created, delivery status and times                     | Counts, failures, accountability                                                                                   | Same                                                                                                                  |
| Flags: location typed or GPS, photo source, consent ticked, reviewed | Supervisor review                                                                                                  | Same                                                                                                                  |
| **Phone hash** (HMAC-SHA256 with a secret kept on the server)        | Only two uses: stop a second message to the same number within `DEDUPE_HOURS` (default 24), and the opt-out list   | Hashes of opt-out numbers: permanently. Other hashes: with the entry                                                  |
| Opt-out list (hashes only)                                           | So nobody who said STOP is messaged again                                                                          | Permanently                                                                                                           |
| Authenticator-app secret (supervisors and admins only)               | Second sign-in step                                                                                                | Stored **encrypted** (the key is a server secret); deleted when an admin resets the account or the account is deleted |
| Login-attempt counters (a hash of the email, no address)             | Slow down password guessing                                                                                        | Removed within 2 days by the housekeeping job                                                                         |
| Audit log                                                            | Who did what and when. **Never** a name, number, photo, password or token (enforced by a database rule and tested) | Permanently, append-only                                                                                              |

The hash is not the number, but a 10-digit number has few possibilities. If the server secret ever leaked, hashes could
be matched against guessed numbers. The secret is therefore server-only and never in the browser bundle (tested).

## Who and what can see the data

| Who                     | Sees                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Officer                 | Their own entries for 7 days: code, violation, status. No names, numbers or photos after the form is submitted. |
| Supervisor              | Counts, failures, review list: codes, officer and status only                                                   |
| Admin (NGO / technical) | Accounts, settings, audit log. **No** photos or phone numbers                                                   |
| The server              | Name, number, photo and PDF only while an entry is inside its retention time                                    |
| The person              | Their own certificate, through WhatsApp (and, in bridge mode, a link valid for 24 hours)                        |

The browser can read the database only with an officer's own sign-in and only the non-personal columns
(`tests/db/rls.test.ts` tries to break this). Personal columns are reachable only from server code.

## Where data goes outside our system

| Service                                           | What it receives                                                             | Why                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **WhatsApp** (cloud API mode: Meta)               | The person's number, name, the safety line, the certificate code and the PDF | To deliver the message. Meta's own retention applies; we cannot recall a delivered message |
| **WhatsApp on the officer's phone** (bridge mode) | The same, through the officer's own WhatsApp                                 | To deliver. The message stays on that phone and the person's phone                         |
| **Google Maps** (only if `GEOCODER=google`)       | Coordinates (rounded)                                                        | To turn GPS into a place name. Off by default                                              |
| **Hosting** (Vercel, Supabase)                    | Everything above, as a normal host. Web server logs hold addresses and paths | To run the system. The application itself writes no personal data to logs (tested)         |

## Life of one entry

1. Officer submits the form. Name, number and photo are saved; the number is also hashed. If the hash matches an entry from the last `DEDUPE_HOURS` or an opt-out, the entry is refused.
2. "Generate certificate": the server renders the PDF from the saved data. The photo is placed in the frame.
3. "Send on WhatsApp": bridge mode opens WhatsApp on the officer's phone with a message and a 24-hour link; cloud API mode sends the template message with the PDF itself.
4. If the person replies STOP, their number's hash goes on the opt-out list.
5. **Deletion.** A job that runs every 10 minutes deletes the files, checks they are gone, then clears name, number, note and file paths. A supervisor or admin can do this at once for one entry from "Requests from citizens" (by the code on the certificate).
6. What remains is the table of non-personal fields above.

## Checking that deletion works

- The retention job writes an audit entry (`retention_run`) with counts every time, and `retention_leftover` when anything
  overdue or incompletely deleted is found. The supervisor screen shows the last run and turns red if it has not run for three hours.
- The database refuses a row marked as purged that still holds a name, number, note or file path.
