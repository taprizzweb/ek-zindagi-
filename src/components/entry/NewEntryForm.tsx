'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  OTHER_CHOICES,
  VIOLATIONS,
  violationByKey,
  type OtherChoiceKey,
  type ViolationKey,
} from '@/config/violations';
import { Button, ErrorBox, Label, TextField } from '@/components/ui';
import { formatTenDigits, normalizeIndianMobile } from '@/lib/domain/phone';
import { messageFor, type Bilingual } from '@/lib/i18n/messages';
import { nameSchema } from '@/lib/validation/entry';
import LocationField, { type LocationValue } from './LocationField';
import PhotoField, { type PhotoValue } from './PhotoField';

type Step = 'form' | 'confirm' | 'sending' | 'done';
type FieldKey = 'name' | 'phone' | 'violation' | 'otherChoice' | 'otherTyped' | 'place' | 'consent';

const FIELD_ERRORS: Record<FieldKey, Bilingual> = {
  name: {
    hi: 'नाम 2 से 40 अक्षरों का लिखें (सिर्फ़ अक्षर, स्पेस, . ’ -)।',
    en: "Enter a name of 2 to 40 characters (letters, spaces, . ' - only).",
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
    hi: 'फ़ोटो के साथ भेजने के लिए सहमति की पुष्टि ज़रूरी है।',
    en: 'Confirm consent to send with a photo.',
  },
};
const FIELD_ORDER: FieldKey[] = [
  'name',
  'phone',
  'violation',
  'otherChoice',
  'otherTyped',
  'place',
  'consent',
];
const FIELD_DOM_ID: Record<FieldKey, string> = {
  name: 'name',
  phone: 'phone',
  violation: 'violation',
  otherChoice: 'otherChoice',
  otherTyped: 'otherTyped',
  place: 'place',
  consent: 'consent',
};

interface Saved {
  id: string;
  certCode: string;
}

export default function NewEntryForm({ allowGallery }: { allowGallery: boolean }) {
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [violation, setViolation] = useState<ViolationKey | ''>('');
  const [otherChoice, setOtherChoice] = useState<OtherChoiceKey | ''>('');
  const [otherTyped, setOtherTyped] = useState('');
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [photo, setPhoto] = useState<PhotoValue | null>(null);
  const [consent, setConsent] = useState(false);
  const [locationKey, setLocationKey] = useState(0); // new entry = fresh GPS fix
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<Bilingual | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [cert, setCert] = useState<'working' | 'ready' | 'failed'>('working');
  const [certError, setCertError] = useState<Bilingual | null>(null);
  // One id per entry: a retry after a dropped connection can never create a second entry.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

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

  function goToConfirm() {
    setAttempted(true);
    const first = FIELD_ORDER.find((k) => errors[k]);
    if (first) {
      document.getElementById(FIELD_DOM_ID[first])?.focus();
      return;
    }
    setServerError(null);
    setStep('confirm');
  }

  async function send() {
    if (!location || !violation) return;
    setStep('sending');
    setServerError(null);
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
        error?: { code: string };
      };
      if (res.ok && json.certCode && json.id) {
        setSaved({ id: json.id, certCode: json.certCode });
        setStep('done');
        void makeCertificate(json.id);
        return;
      }
      setServerError(messageFor(json.error?.code));
    } catch {
      setServerError({
        hi: 'नेटवर्क नहीं मिला। आपकी जानकारी सुरक्षित है। कनेक्शन जाँचकर दोबारा भेजें।',
        en: 'No network. Your entry is still on this screen. Check the connection and send again.',
      });
    }
    setStep('confirm'); // keep everything entered; sending again reuses the same request id
  }

  /** Asks the server to create the PDF. Safe to repeat: a finished certificate is left alone. */
  async function makeCertificate(id: string) {
    setCert('working');
    setCertError(null);
    try {
      const res = await fetch(`/api/entries/${id}/certificate`, {
        method: 'POST',
        signal: AbortSignal.timeout(40_000),
      });
      const json = (await res.json()) as { error?: { code: string } };
      if (res.ok) {
        setCert('ready');
        return;
      }
      setCertError(messageFor(json.error?.code));
    } catch {
      setCertError({
        hi: 'नेटवर्क नहीं मिला। प्रविष्टि सुरक्षित है, कनेक्शन जाँचकर फिर से कोशिश करें।',
        en: 'No network. The entry is saved; check the connection and try again.',
      });
    }
    setCert('failed');
  }

  function reset() {
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
    setSaved(null);
    setLocationKey((k) => k + 1);
    setRequestId(crypto.randomUUID());
    setStep('form');
  }

  const doneView = saved ? (
    <section aria-live="polite" className="space-y-4">
      <h1 className="text-2xl font-semibold">प्रविष्टि सहेजी गई / Entry saved</h1>
      <p className="text-muted">कोड / Code</p>
      <p className="text-3xl font-semibold tracking-wider">{saved.certCode}</p>
      {cert === 'working' ? (
        <p role="status" className="font-semibold">
          प्रमाणपत्र बन रहा है… / Creating certificate…
        </p>
      ) : null}
      {cert === 'ready' ? (
        <p role="status" className="font-semibold text-accent-dark">
          ✓ प्रमाणपत्र तैयार / Certificate ready
        </p>
      ) : null}
      {cert === 'failed' ? (
        <div className="space-y-3">
          <ErrorBox message={certError} />
          <Button type="button" variant="secondary" onClick={() => void makeCertificate(saved.id)}>
            फिर से कोशिश करें / Try again
          </Button>
        </div>
      ) : null}
      <Button type="button" className="w-full" onClick={reset} disabled={cert === 'working'}>
        नई प्रविष्टि / New entry
      </Button>
    </section>
  ) : null;

  const confirmView = (() => {
    const v = violation ? violationByKey(violation) : null;
    const otherLabel = OTHER_CHOICES.find((c) => c.key === otherChoice);
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold">जाँचें / Check</h1>
        <div>
          <p className="text-base font-semibold">क्या यह नंबर सही है? / Is this number correct?</p>
          <p
            className="my-2 text-4xl font-semibold tracking-wider"
            aria-label={`नंबर ${phone.split('').join(' ')}`}
          >
            +91 {formatTenDigits(phone)}
          </p>
          <p className="text-muted">
            गलत नंबर पर किसी अनजान व्यक्ति को फ़ोटो चली जाएगी। / A wrong number sends the photo to a
            stranger.
          </p>
        </div>
        <dl className="grid grid-cols-[9.5rem_1fr] gap-y-2">
          <dt className="text-muted">नाम / Name</dt>
          <dd className="font-semibold">{name.trim()}</dd>
          <dt className="text-muted">उल्लंघन / Violation</dt>
          <dd className="font-semibold">
            {v ? `${v.hi} / ${v.en}` : ''}
            {violation === 'other' && otherLabel
              ? ` — ${otherChoice === 'typed' ? otherTyped.trim() : otherLabel.en}`
              : ''}
          </dd>
          <dt className="text-muted">जगह / Place</dt>
          <dd className="font-semibold">{location?.areaName.trim()}</dd>
          <dt className="text-muted">फ़ोटो / Photo</dt>
          <dd className="font-semibold">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob preview
              <img
                src={photo.url}
                alt="फ़ोटो / Photo"
                className="max-h-40 rounded border-2 border-line"
              />
            ) : (
              'नहीं / None'
            )}
          </dd>
        </dl>
        <ErrorBox message={serverError} />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            className="flex-1"
            onClick={() => void send()}
            disabled={step === 'sending'}
          >
            {step === 'sending'
              ? 'भेज रहे हैं… / Sending…'
              : serverError
                ? 'दोबारा भेजें / Send again'
                : 'प्रमाणपत्र भेजें / Send certificate'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={step === 'sending'}
            onClick={() => setStep('form')}
          >
            बदलें / Edit
          </Button>
        </div>
      </section>
    );
  })();

  const formView = (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        goToConfirm();
      }}
    >
      <h1 className="text-2xl font-semibold">नई प्रविष्टि / New entry</h1>

      <LocationField key={locationKey} onChange={setLocation} error={errText('place')} />
      <p className="text-sm text-muted">
        तारीख़ और समय अपने आप दर्ज होंगे। / Date and time are recorded automatically.
      </p>

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
              व्यक्ति को बता दिया गया है कि इस फ़ोटो का उपयोग कैसे होगा और वह सहमत है। / The person
              has been told how this photo will be used and agrees.
            </span>
          </label>
          {shown('consent') ? (
            <p role="alert" className="mt-1 text-danger">
              {errText('consent')}
            </p>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" className="w-full">
        आगे / Next
      </Button>
    </form>
  );

  // The form stays mounted (just hidden) while the officer checks the number, so going back
  // with "Edit" keeps the typed text, the photo and the GPS fix.
  return (
    <>
      {step === 'done' ? doneView : null}
      {step === 'confirm' || step === 'sending' ? confirmView : null}
      <div hidden={step !== 'form'}>{formView}</div>
    </>
  );
}
