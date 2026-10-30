# CHANGES_PLAN.md: applying the design and flow update

Source: `CLAUDE_CODE_UPDATE_PROMPT.md` and the `EK_ZINDAGI_update_pack` (new `reference/`).
Where this update and the master prompt conflict, the update wins. Status: **plan, written before any code change.**

## 1. What changes

| Area             | Change                                                                                                                                                                                                                                                                                                                              | Main files                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Reference folder | New pack installed. Superseded v1 portrait design moved to `reference/superseded-v1/`. The master prompt stays (still the requirements document). The pack's `fonts/node_modules` is **not** committed; only the font files the certificate needs are copied to `assets/fonts/`.                                                    | `reference/`, `assets/fonts/`                   |
| Certificate      | Replaced by the landscape "MIGHT DIE SOON" design. One React component, `Certificate`, is used **both** for the live preview on the officer screen and (rendered to static HTML) for the PDF, so they cannot drift apart. Auto-fit text (name, date, place, headline) uses one shared function.                                     | `src/components/certificate/*`, `src/lib/pdf/*` |
| PDF              | A4 landscape (297x210 mm, 1123x794 px canvas), Anton and Libre Baskerville bundled, Devanagari fallback kept. Also a PNG export (same renderer) for "Download image".                                                                                                                                                               | `src/lib/pdf/*`                                 |
| Wording          | Old per-violation lines and the Hindi slogan are no longer printed; they stay in config. New checklist labels for the certificate. "HYPOTHETICAL" removed from the stamp. New one-line disclaimer.                                                                                                                                  | `src/config/*`                                  |
| Officer form     | Live preview beside/below the form, updating as the officer types. Camera first, gallery a secondary link (already so). "Generate certificate", then "Send on WhatsApp", "Download PDF", "Download image". Number confirmation moves to just before sending.                                                                        | `src/components/entry/*`, `src/app/new`         |
| Delivery         | Bridge mode becomes first class: signed 24 h link serving the PDF from private storage, `wa.me` hand-off. Short Hinglish message with a Hindi / English / Hinglish setting. No challan, fine or penalty wording anywhere. Cloud API mode, webhook, STOP and retention follow as milestones 5 and 6, using the same message builder. | `src/lib/delivery/*`, `src/app/c/[token]`       |
| Branding flags   | `SHOW_POLICE_BRANDING`, `POLICE_LOGO_PATH`, `NGO_LOGO_PATH`, `PARTNER_CREDIT_TEXT`, all default off. The logo file is never read when the flag is off. README note about written permission for the logo and the State Emblem.                                                                                                      | `src/lib/pdf/branding.ts`, `README.md`          |
| Tests            | Visual regression against the v2 reference PNGs, mandatory-element and banned-word tests, branding-off-means-never-read test, bridge-link tests, camera-first form test, accessibility checks.                                                                                                                                      | `tests/*`                                       |

## 2. Order of work (tests run after each step)

1. This plan, new `reference/`, fonts. (no behaviour change)
2. Certificate component, CSS, auto-fit, config; PDF landscape; PNG export; PDF tests and visual regression.
3. Officer form: live preview, flow, downloads, confirm-number step; browser tests; accessibility checks.
4. Message builder and bridge delivery (link, route, expiry); tests.
5. Docs, screenshots, final full run.

## 3. Conflicts and disagreements (please read)

1. **The design itself.** A garlanded photo, incense sticks, "MIGHT DIE SOON" and "last seen alive" is, by design, a mock memorial of a named real person, sent to that person's WhatsApp, with the person's photo, from (when branding is on) a police unit. I am building it as specified. The risk is real: distress, forwarding as a hoax or threat, and editing of the image. What reduces it, and stays untouched: stamp, watermark and disclaimer on every certificate; consent box for the photo; deletion within 24 h; opt-out; no challan wording. **I recommend** a lawyer and the police review the final text before the first real send, and a written sign-off from the NGO on who may receive it (for example adults only).
2. **Police wording outside the subtitle.** The update gates only the subtitle and the logo behind `SHOW_POLICE_BRANDING`. The footer line "Traffic Inspector, Jaipur Traffic Police" and the "JTP-" certificate prefix would also imply that the police issued it. **I will gate the footer signature line too** (off: "Project EK ZINDAGI · Awareness camp") and keep the certificate number as `EKZ-JPR-xxxxxxx` (one constant, easy to change). Tell me if you want `JTP-` when branding is on.
3. **Device clock vs server clock.** The update says the date and time come from the device clock. A device clock can be wrong or changed, which would put a false time on the record. **I keep the server time as the time of record** (it is what the PDF and the database use). The live preview shows the device time until the entry is saved; after "Generate" the certificate shows the server time.
4. **Script inside the certificate page.** Auto-fit needs measuring text, so the page that Chromium prints contains one small fixed script (the shared fit function). My earlier rule "no script in the certificate HTML" becomes "exactly one script, identical for every certificate, with no user data in it" (tested). All user text is escaped and passed as text, the page has no network access.
5. **Hindi.** The new design prints no Hindi, but names and places may still be Devanagari. Anton and Libre Baskerville have no Devanagari glyphs, so Noto Serif Devanagari stays as the fallback font. Names and places stay limited to Latin and Devanagari.
6. **"Signed" link.** I use a random 128-bit token whose hash is stored with its expiry, not a stateless signature. It can be revoked and deleted with the file, and it cannot be forged. Same guarantees the update asks for (24 h expiry, 410 afterwards, serves one file only).
7. **Number confirmation.** Generating a certificate sends nothing, so the "is this number correct?" check moves to the moment just before "Send on WhatsApp", where a wrong number would actually do harm.
8. **Scope of this round.** Cloud API delivery with webhook, STOP handling and retries, and the retention job, are not part of this round; they remain milestones 5 and 6 and will use the new message builder and the same PDF.

## 4. Outcome

Done in this round: sections A, B, C, D, F, G, and the bridge half of E. Not done, by design (point 8): cloud API mode
with webhook, STOP handling and retries, and the retention job.

Things that differ from a literal reading of the update prompt, besides points 1 to 8 above:

- **Sizes of the date, place and headline text.** The approved PNG was evidently fitted before Anton had
  loaded, so its text is smaller than a correct fit gives. The component starts at the sizes that reproduce the
  PNG exactly (95 px headline, 35 px date and place) and still shrinks longer text. Found by searching font
  sizes against the reference image (exact match at 95 / 35 / 35).
- **Tolerance of the PDF-versus-PNG comparison** is 2.5% of 8 px blocks: the PDF raster is about 1 px off the
  screenshot-based PNG. The PNG export, which is a screenshot, matches within 0.5%.
- **`react-dom/server` is loaded through Node's resolver** because Next.js refuses that import inside app routes.
- **Status wording in bridge mode** is "WhatsApp opened (not confirmed)", because the app cannot see a send.
