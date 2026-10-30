# Manual test on real devices

The automated tests use a fake camera, a fake GPS, a fake Supabase and a fake WhatsApp. What they cannot show is
how this behaves on real phones, on real networks, with real WhatsApp. Do this before the first camp, and again after
any big change. **Two Android phones minimum** (different brands, one older or low-end), plus one more phone as the "citizen".
Use your own numbers. Delete test data afterwards (Requests from citizens).

Record the result of each line: Pass / Fail / Not tried, and the phone and browser. Photograph anything odd.

| Tester | Date | Phone A (model, Android, browser) | Phone B | Citizen phone | Network (4G / 3G / Wi-Fi) |
| ------ | ---- | --------------------------------- | ------- | ------------- | ------------------------- |
|        |      |                                   |         |               |                           |

## A. Sign-in and the phone itself

| #   | Check                                                                                                                                        | A   | B   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| A1  | Open the site address in Chrome. The login page fits the screen without sideways scrolling; text is readable in sunlight at full brightness. |     |     |
| A2  | Log in as an officer. Wrong password is refused with a clear message.                                                                        |     |     |
| A3  | Leave the phone locked for 31 minutes, open it: you are asked to log in again.                                                               |     |     |
| A4  | Add the page to the home screen (optional). It still works.                                                                                  |     |     |
| A5  | Rotate the phone: nothing is lost or unusable.                                                                                               |     |     |
| A6  | Turn on TalkBack: fields, buttons and errors are read out sensibly (basic check).                                                            |     |     |
| A7  | Largest system font size: nothing overlaps or is cut off.                                                                                    |     |     |

## B. Location (real GPS)

Stand outdoors, then indoors.

| #   | Check                                                                                                                  | A   | B   |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --- | --- |
| B1  | First time: the browser asks for location. Allow. A place name or coordinates appear within about 10 seconds outdoors. |     |     |
| B2  | The place is right (compare with a map). Note the error in metres.                                                     |     |     |
| B3  | Indoors / poor signal: a clear message, and the place can be typed by hand.                                            |     |     |
| B4  | Deny the location permission: the form still works with a typed place; the entry is flagged for review.                |     |     |
| B5  | Turn the phone's location switch off: clear message, no crash.                                                         |     |     |
| B6  | Fix a location, tap "Edit" back and forth: the location is not lost.                                                   |     |     |

## C. Camera and photo

| #   | Check                                                                                                          | A   | B   |
| --- | -------------------------------------------------------------------------------------------------------------- | --- | --- |
| C1  | "Open camera" asks permission, shows the live picture, "Capture" takes it. The rear camera is used by default. |     |     |
| C2  | The photo looks sharp enough, is the right way up, and appears in the frame of the live preview.               |     |     |
| C3  | Retake and Remove work. Without a photo the silhouette shows.                                                  |     |     |
| C4  | Deny camera permission: a clear message; "Camera not working? Use gallery" is offered and asks for a reason.   |     |     |
| C5  | A gallery photo works and the entry shows up in the supervisor's review list.                                  |     |     |
| C6  | A very large photo (12 MP or more) does not freeze the phone and still uploads on 4G.                          |     |     |
| C7  | A photo of a person who has NOT agreed cannot be submitted without ticking the consent box.                    |     |     |

## D. Form and certificate

| #   | Check                                                                                                                                                                                                                                           | A   | B   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| D1  | Type an English name, then a Hindi (Devanagari) name, then a very long name. The live preview updates and nothing overflows.                                                                                                                    |     |     |
| D2  | Phone number: "98765 43210" and "+91 98765 43210" are accepted; "12345" and a landline are refused with a clear message.                                                                                                                        |     |     |
| D3  | "Generate certificate" works on 4G within about 10 seconds.                                                                                                                                                                                     |     |     |
| D4  | Download PDF opens in the phone's viewer; Download image saves. The certificate matches the preview, the date and time are right (India time), the stamp, watermark and disclaimer are visible, and **no mention of challan, fine or penalty**. |     |     |
| D5  | With the police branding on: logo at the top left is sharp and the right way up. With it off: no police wording at all.                                                                                                                         |     |     |
| D6  | Switch to a slow or lost network just before "Generate": a clear message, the typed data is still there, retry works and does not create a second entry.                                                                                        |     |     |
| D7  | Submit the same number again within 24 hours: refused with a clear message.                                                                                                                                                                     |     |     |

## E. Delivery, bridge mode (`DELIVERY_MODE=bridge`)

Send to the citizen phone.

| #   | Check                                                                                                                                                   | A   | B   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| E1  | The number is shown again before sending ("is this number correct?"); "Wrong number?" goes back to fix it.                                              |     |     |
| E2  | "Send on WhatsApp" opens WhatsApp (not a web page) with the message ready: short, Hinglish, no challan/fine wording, the STOP line, a link.             |     |     |
| E3  | Sending from the officer's phone works; the citizen receives it.                                                                                        |     |     |
| E4  | On the **citizen** phone, tapping the link shows the PDF (inside WhatsApp's browser and in Chrome). It reads properly in Hindi and English.             |     |     |
| E5  | The status in the officer's list says "WhatsApp opened (not confirmed)" and then "Link opened by the person". It never says "delivered" in bridge mode. |     |     |
| E6  | After 24 hours the link says it has expired.                                                                                                            |     |     |
| E7  | Forward the link to a third phone within 24 hours: it opens (expected: the link is the credential). Note this for the lawyer.                           |     |     |

## F. Delivery, cloud API mode (`DELIVERY_MODE=cloud_api`)

Only after `docs/whatsapp-setup.md`.

| #   | Check                                                                                                                          | Result |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| F1  | "Send" shows "message sent"; the citizen receives the template message **with the PDF attached**.                              |        |
| F2  | The PDF opens on the citizen phone and looks right. The attached file's name has no name or number in it.                      |        |
| F3  | Supervisor screen: status moves to Delivered, then Read, after the citizen opens it.                                           |        |
| F4  | Tap Send five times quickly: exactly one message arrives.                                                                      |        |
| F5  | The citizen replies **STOP**. Within a minute the audit log shows `opt_out_recorded`. A new entry with that number is refused. |        |
| F6  | Send to a number that is not on WhatsApp: the failure is shown with a clear reason in the failures list.                       |        |
| F7  | Turn the phone to airplane mode during sending: no duplicate message, a clear state afterwards.                                |        |
| F8  | Supervisor **Pause campaign**: a send is refused for every officer; **Resume** restores it.                                    |        |
| F9  | Wrong access token (test environment only): failures say the token expired and sending can resume after fixing it.             |        |

## G. Data and accounts

| #   | Check                                                                                                                                                 | Result |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| G1  | After `RETENTION_HOURS` (or after calling the retention route), the test entry has no name, number, photo or PDF; the link says it is gone.           |        |
| G2  | "Requests from citizens": delete by code works at once and is in the audit log.                                                                       |        |
| G3  | Admin disables an officer who is logged in on a phone: that phone is logged out on its next tap and cannot log in.                                    |        |
| G4  | The officer sees only their own entries; the supervisor sees counts and the review list but no names or numbers; the admin sees no numbers or photos. |        |
| G5  | The audit log holds no names, numbers or photos (read it).                                                                                            |        |

## H. Field conditions

| #   | Check                                                                                                                        | Result |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| H1  | A full run at the real location, outdoors in daylight, with two officers at once: time per citizen, and what slowed it down. |        |
| H2  | 3G or weak 4G: where does it get too slow to use?                                                                            |        |
| H3  | Battery: percentage used in one hour of use.                                                                                 |        |
| H4  | What did officers misunderstand? (Ask them; write their words.)                                                              |        |

## Sign-off

Do not start the pilot until A to E (or F) and G pass on both phones, or each failure has been accepted in writing by the project lead and the police supervisor.

Signed: ______________________ Date: ____________
