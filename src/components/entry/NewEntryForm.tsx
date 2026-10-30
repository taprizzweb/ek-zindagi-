'use client';

import { useEffect, useMemo, useState } from 'react';
import CertificatePreview from '@/components/certificate/CertificatePreview';
import { formatDateParts, type CertificateView } from '@/components/certificate/certificate-data';
import { Button, ErrorBox, Label, TextField } from '@/components/ui';
import {
  OTHER_CHOICES,
  VIOLATIONS,
  type OtherChoiceKey,
  type ViolationKey,
} from '@/config/violations';
import { buildMessage } from '@/lib/delivery/message';
import { formatTenDigits, normalizeIndianMobile } from '@/lib/domain/phone';
import { messageFor, type Bilingual } from '@/lib/i18n/messages';
import { nameSchema } from '@/lib/validation/entry';
import LocationField, { type LocationValue } from './LocationField';
import PhotoField, { type PhotoValue } from './PhotoField';

type Stage = 'edit' | 'working' | 'ready';
type FieldKey = 'name' | 'phone' | 'violation' | 'otherChoice' | 'otherTyped' | 'place' | 'consent';

export interface ClientBranding {
  showPolice: boolean;
  policeLogoSrc: string | null;
  ngoLogoSrc: string | null;
  partnerCredit: string | null;
}

const FIELD_ERRORS: Record<FieldKey, Bilingual> = {
  name: {
    hi: 'नाम 2 से 40 अक्षरों का लिखें (हिंदी या अंग्रेज़ी अक्षर, स्पेस, . ’ -)।',
    en: "Enter a name of 2 to 40 letters (Hindi or English letters, spaces, . ' - only).",
  },
  phone: {
    hi: '10 अंकों का मोबाइल नंबर लिखें, जो 6, 7, 8 या 9 से शुरू हो।',
    en: 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.',
  },
  violation: { hi: 'उल्लंघन चुनें।', en: 'Choose the violation.' },
  otherChoice: { hi: 'उल्लंघन का प्रकार चुनें।', en: 'Choose the type of violation.' },
  otherTyped: {
    hi: 'उल्लंघन 2 से 40 अक्षरों में लिखें।',
    en: 'Write the violation in 2 to 40 characters.',
  },
  place: { hi: 'जगह का नाम लिखें।', en: 'Enter the place name.' },
  consent: {
    hi: 'फ़ोटो के साथ आगे बढ़ने के लिए सहमति की पुष्टि ज़रूरी है।',
    en: 'Confirm consent to continue with a photo.',
  },
};
const FIELD_ORDER: FieldKey[] = [
  'name',
  'phone',
  'violation',
  'otherChoice',
  'otherTyped',
  'consent',
  'place',
];

interface Created {
  id: string;
  certCode: string;
  createdAt: string | null;
}

/** "30 October 2026, 04:12 PM" for the read-only date and time field. */
function clockText(d: Date): string {
  const { dateText, timeText } = formatDateParts(d);
  return `${dateText}, ${timeText}`;
}

export default function NewEntryForm({
  allowGallery,
  branding,
  baseUrl,
  deliveryMode,
}: {
  allowGallery: boolean;
  branding: ClientBranding;
  baseUrl: string;
  deliveryMode: 'bridge' | 'cloud_api';
}) {
  const [stage, setStage] = useState<Stage>('edit');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [violation, setViolation] = useState<ViolationKey | ''>('');
  const [otherChoice, setOtherChoice] = useState<OtherChoiceKey | ''>('');
  const [otherTyped, setOtherTyped] = useState('');
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [photo, setPhoto] = useState<PhotoValue | null>(null);
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<Bilingual | null>(null);
  const [progress, setProgress] = useState<'saving' | 'creating'>('saving');
  const [created, setCreated] = useState<Created | null>(null);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'opened' | 'sent'>('idle');
  const [sendError, setSendError] = useState<Bilingual | null>(null);
  const [waUrl, setWaUrl] = useState<string | null>(null);
  const [locationKey, setLocationKey] = useState(0); // new entry = fresh GPS fix
  // One id per entry: sending again after a dropped connection can never create a second entry.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  // The phone's clock, shown (and used in the preview) until the server records the real time.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage]);

  const errors = useMemo(() => {
    const e: Partial<Record<FieldKey, boolean>> = {};
    if (!nameSchema.safeParse(name).success) e.name = true;
    if (!normalizeIndianMobile(phone)) e.phone = true;
    if (!violation) e.violation = true;
    if (violation === 'other') {
      if (!otherChoice) e.otherChoice = true;
      else if (
        otherChoice === 'typed' &&
        !/^[\p{L}\p{M}\p{N} .,'’/()-]{2,40}$/u.test(otherTyped.trim())
      )
        e.otherTyped = true;
    }
    if ((location?.areaName.trim().length ?? 0) < 2) e.place = true;
    if (photo && !consent) e.consent = true;
    return e;
  }, [name, phone, violation, otherChoice, otherTyped, location, photo, consent]);

  const shown = (k: FieldKey) => (attempted || touched[k]) && errors[k];
  const touch = (k: FieldKey) => () => setTouched((t) => ({ ...t, [k]: true }));
  const errText = (k: FieldKey) =>
    shown(k) ? `${FIELD_ERRORS[k].hi} / ${FIELD_ERRORS[k].en}` : undefined;

  /** What the certificate shows: what has been typed so far, sample text where nothing is typed yet. */
  const view: CertificateView = useMemo(() => {
    const when = created?.createdAt ? new Date(created.createdAt) : now;
    const { dateText, timeText } = formatDateParts(when);
    return {
      name: name.trim() || 'Sample Name',
      dateText,
      timeText,
      place: location?.areaName.trim() || 'Sample Chauraha, Jaipur',
      certNo: created?.certCode ?? 'EKZ-JPR-XXXXXXX',
      violation: violation || null,
      photoSrc: photo?.url ?? null,
      showPolice: branding.showPolice,
      policeLogoSrc: branding.showPolice ? branding.policeLogoSrc : null,
      ngoLogoSrc: branding.ngoLogoSrc,
      partnerCredit: branding.partnerCredit,
    };
  }, [name, location, violation, photo, created, now, branding]);

  const previewLabel = `Certificate preview: ${view.name}, ${view.dateText} ${view.timeText}, ${view.place}`;

  /** Saves the entry, then asks the server for the PDF. Safe to repeat: nothing is saved twice. */
  async function generate() {
    setAttempted(true);
    const first = FIELD_ORDER.find((k) => errors[k]);
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    if (!location || !violation) return;
    setServerError(null);
    setStage('working');

    let entry = created;
    if (!entry) {
      setProgress('saving');
      const data = {
        clientRequestId: requestId,
        name,
        phone,
        violation,
        ...(violation === 'other'
          ? { otherChoice, ...(otherChoice === 'typed' ? { otherTyped: otherTyped.trim() } : {}) }
          : {}),
        location:
          location.source === 'gps'
            ? {
                source: 'gps',
                lat: location.lat,
                lng: location.lng,
                areaName: location.areaName.trim(),
              }
            : { source: 'manual', areaName: location.areaName.trim() },
        photoSource: photo ? photo.source : 'none',
        ...(photo?.galleryReason ? { galleryReason: photo.galleryReason } : {}),
        consentChecked: photo ? consent : false,
      };
      const body = new FormData();
      body.set('data', JSON.stringify(data));
      if (photo) body.set('photo', photo.blob, 'photo.jpg');
      try {
        const res = await fetch('/api/entries', {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(45_000),
        });
        const json = (await res.json()) as {
          id?: string;
          certCode?: string;
          createdAt?: string;
          error?: { code: string };
        };
        if (!res.ok || !json.id || !json.certCode) {
          setServerError(messageFor(json.error?.code));
          setStage('edit');
          return;
        }
        entry = { id: json.id, certCode: json.certCode, createdAt: json.createdAt ?? null };
        setCreated(entry);
      } catch {
        setServerError({
          hi: 'नेटवर्क नहीं मिला। आपकी जानकारी इसी स्क्रीन पर है। कनेक्शन जाँचकर फिर से दबाएँ।',
          en: 'No network. Your entry is still on this screen. Check the connection and tap again.',
        });
        setStage('edit');
        return;
      }
    }

    setProgress('creating');
    try {
      const res = await fetch(`/api/entries/${entry.id}/certificate`, {
        method: 'POST',
        signal: AbortSignal.timeout(40_000),
      });
      const json = (await res.json()) as { error?: { code: string } };
      if (res.ok) {
        setStage('ready');
        return;
      }
      setServerError(messageFor(json.error?.code));
    } catch {
      setServerError({
        hi: 'नेटवर्क नहीं मिला। प्रविष्टि सुरक्षित है, कनेक्शन जाँचकर फिर से कोशिश करें।',
        en: 'No network. The entry is saved; check the connection and try again.',
      });
    }
    setStage('edit'); // fields stay locked (the entry exists); the button now says "Try again"
  }

  async function sendOnWhatsApp() {
    if (!created) return;
    setSendState('sending');
    setSendError(null);
    try {
      const res = await fetch(`/api/entries/${created.id}/send`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
      const json = (await res.json()) as {
        mode?: string;
        waUrl?: string;
        error?: { code: string };
      };
      if (res.ok && json.mode === 'cloud_api') {
        setSendState('sent'); // the server sent it; there is no WhatsApp hand-off on this phone
        return;
      }
      if (res.ok && json.waUrl) {
        setWaUrl(json.waUrl);
        setSendState('opened');
        window.location.assign(json.waUrl); // opens WhatsApp with the message ready
        return;
      }
      setSendError(messageFor(json.error?.code));
    } catch {
      setSendError({
        hi: 'नेटवर्क नहीं मिला। कनेक्शन जाँचकर फिर से कोशिश करें।',
        en: 'No network. Check the connection and try again.',
      });
    }
    setSendState('idle');
  }

  function reset() {
    setStage('edit');
    setName('');
    setPhone('');
    setViolation('');
    setOtherChoice('');
    setOtherTyped('');
    setPhoto(null);
    setConsent(false);
    setTouched({});
    setAttempted(false);
    setServerError(null);
    setCreated(null);
    setSendState('idle');
    setSendError(null);
    setWaUrl(null);
    setLocationKey((k) => k + 1);
    setRequestId(crypto.randomUUID());
  }

  /** "Wrong number?": back to the form with everything kept; a fresh entry is made for the new number. */
  function changeNumber() {
    setStage('edit');
    setCreated(null);
    setSendState('idle');
    setSendError(null);
    setServerError(null);
    setAttempted(false);
    setRequestId(crypto.randomUUID());
    setTimeout(() => document.getElementById('phone')?.focus(), 0);
  }

  const locked = created !== null && stage === 'edit'; // saved, certificate not made yet: keep the fields as they are

  /* ------------------------------------------------------------------ certificate ready */
  const readyView = (
    <section className="space-y-6" aria-labelledby="ready-title">
      <div>
        <h1 id="ready-title" className="text-2xl font-semibold">
          प्रमाणपत्र तैयार / Certificate ready
        </h1>
        <p className="mt-1 text-muted">
          कोड / Code: <strong className="text-ink">{created?.certCode}</strong>
        </p>
      </div>

      <CertificatePreview view={view} label={previewLabel} />

      <div className="flex flex-wrap gap-3">
        <a
          href={`/api/entries/${created?.id}/certificate/pdf`}
          download
          className="inline-flex min-h-12 items-center rounded border-2 border-line bg-white px-4 text-base font-semibold text-ink hover:bg-gray-100"
        >
          PDF डाउनलोड / Download PDF
        </a>
        <a
          href={`/api/entries/${created?.id}/certificate/image`}
          download
          className="inline-flex min-h-12 items-center rounded border-2 border-line bg-white px-4 text-base font-semibold text-ink hover:bg-gray-100"
        >
          इमेज डाउनलोड / Download image
        </a>
      </div>

      <section
        className="max-w-xl space-y-4 rounded border-2 border-line p-4"
        aria-labelledby="send-title"
      >
        <h2 id="send-title" className="text-xl font-semibold">
          व्हाट्सऐप पर भेजें / Send on WhatsApp
        </h2>
        <div>
          <p className="text-base font-semibold">क्या यह नंबर सही है? / Is this number correct?</p>
          <p
            className="my-2 text-[32px] leading-tight font-semibold tracking-wide whitespace-nowrap"
            aria-label={`नंबर ${phone.split('').join(' ')}`}
          >
            +91 {formatTenDigits(phone)}
          </p>
          <p className="text-muted">
            गलत नंबर पर किसी अनजान व्यक्ति को प्रमाणपत्र का लिंक चला जाएगा। / A wrong number sends
            the certificate link to a stranger.
          </p>
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold text-muted">
            सामने वाले को यह संदेश मिलेगा / The person will get this message
          </p>
          <div
            className="rounded-lg bg-[#d9fdd3] p-3 text-[15px] leading-snug whitespace-pre-wrap text-[#111b21]"
            data-testid="message-preview"
          >
            {buildMessage({
              name: name.trim(),
              certCode: created?.certCode ?? '',
              violation: violation || 'other',
              // Cloud API: the PDF itself is attached (it stays in the person's chat). Bridge: a 24-hour link.
              link:
                deliveryMode === 'bridge'
                  ? `${baseUrl.replace(/\/+$/, '')}/c/••••••••••••••••••••••`
                  : undefined,
            })}
          </div>
        </div>

        <ErrorBox message={sendError} />
        {sendState === 'opened' ? (
          <div role="status" className="space-y-2 rounded border-2 border-accent p-3">
            <p className="font-semibold text-accent-dark">
              व्हाट्सऐप खुल गया। वहाँ “भेजें” दबाएँ। / WhatsApp opened. Tap Send there.
            </p>
            <p className="text-sm text-muted">
              हम यह नहीं देख सकते कि संदेश गया या नहीं। / We cannot see whether it was sent.
            </p>
            {waUrl ? (
              <a
                href={waUrl}
                className="inline-flex min-h-12 items-center text-base font-semibold text-accent underline"
              >
                व्हाट्सऐप फिर से खोलें / Open WhatsApp again
              </a>
            ) : null}
          </div>
        ) : null}
        {sendState === 'sent' ? (
          <div role="status" className="space-y-2 rounded border-2 border-accent p-3">
            <p className="font-semibold text-accent-dark">
              संदेश भेज दिया गया। / The message has been sent.
            </p>
            <p className="text-sm text-muted">
              पहुँचने की पुष्टि सुपरवाइज़र स्क्रीन पर दिखेगी। / Delivery is confirmed later on the
              supervisor screen.
            </p>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            className="flex-1"
            onClick={() => void sendOnWhatsApp()}
            disabled={sendState === 'sending' || sendState === 'sent'}
          >
            {sendState === 'sending'
              ? 'तैयार कर रहे हैं… / Preparing…'
              : sendState === 'sent'
                ? 'भेज दिया / Sent'
                : sendState === 'opened'
                  ? 'फिर से भेजें / Send again'
                  : 'व्हाट्सऐप पर भेजें / Send on WhatsApp'}
          </Button>
          <Button type="button" variant="secondary" onClick={changeNumber}>
            नंबर गलत है? / Wrong number?
          </Button>
        </div>
        <p className="text-sm text-muted">
          {deliveryMode === 'bridge'
            ? 'wa.me से फ़ाइल नहीं जोड़ी जा सकती, इसलिए संदेश में 24 घंटे चलने वाला लिंक जाता है। / wa.me cannot attach a file, so the message carries a link that works for 24 hours.'
            : 'आधिकारिक व्हाट्सऐप API से भेजा जाएगा। / It will be sent through the official WhatsApp API.'}
        </p>
      </section>

      <Button type="button" variant="secondary" onClick={reset} className="w-full sm:w-auto">
        नई प्रविष्टि / New entry
      </Button>
    </section>
  );

  /* ------------------------------------------------------------------ the form */
  const formView = (
    <form
      noValidate
      className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
      onSubmit={(e) => {
        e.preventDefault();
        void generate();
      }}
    >
      <fieldset
        disabled={stage === 'working' || locked}
        className="min-w-0 space-y-6 border-0 p-0 lg:col-start-1"
      >
        <h1 className="text-2xl font-semibold">नई प्रविष्टि / New entry</h1>

        <div>
          <TextField
            id="name"
            hi="नाम"
            en="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={touch('name')}
            maxLength={40}
            autoComplete="off"
            aria-invalid={shown('name') ? true : undefined}
          />
          {shown('name') ? (
            <p role="alert" className="mt-1 text-danger">
              {errText('name')}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="phone" hi="व्हाट्सऐप नंबर" en="WhatsApp number" />
          <div className="flex items-stretch">
            <span className="flex h-12 items-center rounded-l border-2 border-r-0 border-line bg-gray-100 px-3 text-base">
              +91
            </span>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              onBlur={touch('phone')}
              aria-invalid={shown('phone') ? true : undefined}
              className="h-12 w-full rounded-r border-2 border-line bg-white px-3 text-xl tracking-widest"
            />
          </div>
          {shown('phone') ? (
            <p role="alert" className="mt-1 text-danger">
              {errText('phone')}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="violation" hi="उल्लंघन" en="Violation" />
          <select
            id="violation"
            value={violation}
            onChange={(e) => setViolation(e.target.value as ViolationKey | '')}
            onBlur={touch('violation')}
            aria-invalid={shown('violation') ? true : undefined}
            className="h-12 w-full rounded border-2 border-line bg-white px-3 text-base"
          >
            <option value="">चुनें / Choose</option>
            {VIOLATIONS.map((v) => (
              <option key={v.key} value={v.key}>
                {v.hi} / {v.en}
              </option>
            ))}
          </select>
          {shown('violation') ? (
            <p role="alert" className="mt-1 text-danger">
              {errText('violation')}
            </p>
          ) : null}
        </div>

        {violation === 'other' ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="otherChoice" hi="प्रकार" en="Type" />
              <select
                id="otherChoice"
                value={otherChoice}
                onChange={(e) => setOtherChoice(e.target.value as OtherChoiceKey | '')}
                onBlur={touch('otherChoice')}
                aria-invalid={shown('otherChoice') ? true : undefined}
                className="h-12 w-full rounded border-2 border-line bg-white px-3 text-base"
              >
                <option value="">चुनें / Choose</option>
                {OTHER_CHOICES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.hi} / {c.en}
                  </option>
                ))}
              </select>
              {shown('otherChoice') ? (
                <p role="alert" className="mt-1 text-danger">
                  {errText('otherChoice')}
                </p>
              ) : null}
            </div>
            {otherChoice === 'typed' ? (
              <div>
                <TextField
                  id="otherTyped"
                  hi="उल्लंघन लिखें"
                  en="Write the violation"
                  value={otherTyped}
                  onChange={(e) => setOtherTyped(e.target.value)}
                  onBlur={touch('otherTyped')}
                  maxLength={40}
                  autoComplete="off"
                  aria-invalid={shown('otherTyped') ? true : undefined}
                />
                {shown('otherTyped') ? (
                  <p role="alert" className="mt-1 text-danger">
                    {errText('otherTyped')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <PhotoField
          value={photo}
          onChange={(p) => {
            setPhoto(p);
            if (!p) setConsent(false);
          }}
          allowGallery={allowGallery}
        />

        {photo ? (
          <div>
            <label htmlFor="consent" className="flex min-h-12 items-start gap-3 text-base">
              <input
                id="consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                onBlur={touch('consent')}
                aria-invalid={shown('consent') ? true : undefined}
                className="mt-1 h-6 w-6 shrink-0"
              />
              <span>
                व्यक्ति को बता दिया गया है कि इस फ़ोटो का उपयोग कैसे होगा और वह सहमत है। / The
                person has been told how this photo will be used and agrees.
              </span>
            </label>
            {shown('consent') ? (
              <p role="alert" className="mt-1 text-danger">
                {errText('consent')}
              </p>
            ) : null}
          </div>
        ) : null}

        <TextField
          id="datetime"
          hi="तारीख़ और समय"
          en="Date and time"
          value={clockText(now)}
          readOnly
          aria-readonly="true"
          hint="अपने आप भरा जाता है। प्रमाणपत्र पर सर्वर का दर्ज समय छपेगा। / Filled in automatically. The certificate prints the time the server records."
        />

        <LocationField key={locationKey} onChange={setLocation} error={errText('place')} />
      </fieldset>

      <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <h2 className="text-lg font-semibold">प्रमाणपत्र का पूर्वावलोकन / Certificate preview</h2>
        <div className="lg:sticky lg:top-4">
          <CertificatePreview view={view} label={previewLabel} />
          <p className="mt-2 text-sm text-muted">
            आप जैसे भरते हैं, यह अपने आप बदलता है। / It updates as you fill the form.
          </p>
        </div>
      </div>

      <div className="min-w-0 space-y-3 lg:col-start-1">
        {stage === 'working' ? (
          <p role="status" className="font-semibold">
            {progress === 'saving'
              ? 'प्रविष्टि सहेज रहे हैं… / Saving the entry…'
              : 'प्रमाणपत्र बन रहा है… / Creating the certificate…'}
          </p>
        ) : null}
        <ErrorBox message={serverError} />
        <Button type="submit" className="w-full" disabled={stage === 'working'}>
          {created ? 'फिर से कोशिश करें / Try again' : 'प्रमाणपत्र बनाएँ / Generate certificate'}
        </Button>
        {created ? (
          <Button type="button" variant="secondary" className="w-full" onClick={reset}>
            नई शुरुआत / Start over
          </Button>
        ) : null}
      </div>
    </form>
  );

  // The form stays mounted (just hidden) after the certificate is made, so "Wrong number?" brings
  // everything back exactly as it was, including the photo and the GPS fix.
  return (
    <>
      {stage === 'ready' ? readyView : null}
      <div hidden={stage === 'ready'}>{formView}</div>
    </>
  );
}
