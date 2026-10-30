'use client';

import { useState } from 'react';
import { Button, ErrorBox, TextField } from '@/components/ui';
import { messageFor, type Bilingual } from '@/lib/i18n/messages';

type Result = { ok: Bilingual } | { error: Bilingual } | null;

async function post(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, json: { error: { code: 'network' } } };
  }
}

const NETWORK: Bilingual = {
  hi: 'नेटवर्क नहीं मिला। फिर से कोशिश करें।',
  en: 'No network. Try again.',
};

function Outcome({ result }: { result: Result }) {
  if (!result) return null;
  if ('error' in result) return <ErrorBox message={result.error} />;
  return (
    <p role="status" className="font-semibold text-accent-dark">
      {result.ok.hi} / {result.ok.en}
    </p>
  );
}

export function PurgeForm() {
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    const r = await post('/api/requests/purge', { certCode: code });
    setBusy(false);
    setConfirming(false);
    if (r.ok) {
      setResult({
        ok: r.json.alreadyPurged
          ? { hi: 'यह डेटा पहले ही हट चुका है।', en: 'This data was already deleted.' }
          : { hi: 'डेटा हटा दिया गया।', en: 'The data has been deleted.' },
      });
      setCode('');
    } else {
      const c = (r.json.error as { code?: string } | undefined)?.code;
      setResult({
        error:
          c === 'not_found'
            ? { hi: 'इस कोड की कोई प्रविष्टि नहीं मिली।', en: 'No entry with this code.' }
            : c === 'bad_request'
              ? {
                  hi: 'कोड सही नहीं है। प्रमाणपत्र पर छपा कोड देखें।',
                  en: 'The code is not valid. Check the code printed on the certificate.',
                }
              : c === 'network'
                ? NETWORK
                : messageFor(c),
      });
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setConfirming(true);
      }}
    >
      <TextField
        id="cert-code"
        hi="प्रमाणपत्र कोड"
        en="Certificate code"
        hint="EKZ-JPR-XXXXXXX"
        value={code}
        onChange={(e) => setCode(e.target.value.slice(0, 40))}
        autoCapitalize="characters"
        autoComplete="off"
      />
      {confirming ? (
        <div role="alert" className="space-y-2 rounded border-2 border-danger p-3">
          <p>
            नाम, नंबर, फ़ोटो और PDF हमेशा के लिए हट जाएँगे। वापस नहीं आएँगे। / Name, number, photo
            and PDF will be deleted for good. This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="danger" disabled={busy} onClick={() => void run()}>
              हाँ, हटाएँ / Yes, delete
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              रद्द करें / Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" variant="secondary" disabled={code.trim().length < 5}>
          डेटा अभी हटाएँ / Delete data now
        </Button>
      )}
      <Outcome result={result} />
    </form>
  );
}

export function OptOutForm() {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    const r = await post('/api/requests/opt-out', { phone });
    setBusy(false);
    if (r.ok) {
      setResult({
        ok: {
          hi: 'यह नंबर अब कभी संदेश नहीं पाएगा।',
          en: 'This number will not be messaged again.',
        },
      });
      setPhone('');
    } else {
      const c = (r.json.error as { code?: string } | undefined)?.code;
      setResult({
        error:
          c === 'bad_request'
            ? { hi: 'नंबर सही नहीं है (10 अंक)।', en: 'The number is not valid (10 digits).' }
            : c === 'network'
              ? NETWORK
              : messageFor(c),
      });
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <TextField
        id="optout-phone"
        hi="मोबाइल नंबर"
        en="Mobile number"
        inputMode="numeric"
        autoComplete="off"
        value={phone}
        onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 16))}
      />
      <Button
        type="submit"
        variant="secondary"
        disabled={busy || phone.replace(/\D/g, '').length < 10}
      >
        संदेश बंद करें / Stop messaging this number
      </Button>
      <Outcome result={result} />
    </form>
  );
}
