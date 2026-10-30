'use client';

import { useState } from 'react';
import { Button, ErrorBox, TextField } from '@/components/ui';
import { messageFor, type Bilingual } from '@/lib/i18n/messages';

export default function MfaForm() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json()) as { redirect?: string; error?: { code: string } };
      if (res.ok && body.redirect) {
        window.location.assign(body.redirect);
        return;
      }
      setError(messageFor(body.error?.code));
      setCode('');
    } catch {
      setError({ hi: 'नेटवर्क नहीं मिला। फिर से कोशिश करें।', en: 'No network. Try again.' });
    }
    setBusy(false);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextField
        id="code"
        hi="6 अंकों का कोड"
        en="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      <ErrorBox message={error} />
      <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
        {busy ? 'जाँच रहे हैं… / Checking…' : 'पुष्टि करें / Verify'}
      </Button>
      <p className="text-sm text-muted">
        कोड हर 30 सेकंड में बदलता है, और एक कोड एक ही बार चलता है। / The code changes every 30
        seconds and works only once.
      </p>
    </form>
  );
}
