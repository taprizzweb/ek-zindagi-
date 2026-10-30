'use client';

import { useState, type FormEvent } from 'react';
import { Button, ErrorBox, TextField } from '@/components/ui';
import { messageFor, type Bilingual } from '@/lib/i18n/messages';

export default function LoginForm() {
  const [error, setError] = useState<Bilingual | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const body = (await res.json()) as { redirect?: string; error?: { code: string } };
      if (res.ok && body.redirect) {
        window.location.assign(body.redirect);
        return;
      }
      setError(messageFor(body.error?.code));
    } catch {
      setError({
        hi: 'नेटवर्क नहीं मिला। कनेक्शन जाँचकर फिर से कोशिश करें।',
        en: 'No network. Check your connection and try again.',
      });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextField
        id="email"
        hi="ईमेल"
        en="Email"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
      />
      <TextField
        id="password"
        hi="पासवर्ड"
        en="Password"
        type="password"
        autoComplete="current-password"
        required
      />
      <ErrorBox message={error} />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'लॉगिन हो रहा है… / Logging in…' : 'लॉगिन / Log in'}
      </Button>
    </form>
  );
}
