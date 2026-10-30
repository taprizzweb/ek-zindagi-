'use client';

import { useState, type FormEvent } from 'react';
import { Button, ErrorBox, TextField } from '@/components/ui';
import { messageFor, type Bilingual } from '@/lib/i18n/messages';
import { MIN_PASSWORD_LENGTH } from '@/lib/validation/auth';

export default function ChangePasswordForm() {
  const [error, setError] = useState<Bilingual | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = String(form.get('newPassword') ?? '');
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError({
        hi: `पासवर्ड कम से कम ${MIN_PASSWORD_LENGTH} अक्षरों का रखें।`,
        en: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }
    if (next !== form.get('confirm')) {
      setError({ hi: 'दोनों पासवर्ड एक जैसे नहीं हैं।', en: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: next }),
      });
      const body = (await res.json()) as { redirect?: string; error?: { code: string } };
      if (res.ok && body.redirect) {
        window.location.assign(body.redirect);
        return;
      }
      setError(messageFor(body.error?.code));
    } catch {
      setError({
        hi: 'नेटवर्क नहीं मिला।',
        en: 'No network. Check your connection and try again.',
      });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextField
        id="newPassword"
        hi="नया पासवर्ड"
        en="New password"
        type="password"
        autoComplete="new-password"
        hint={`कम से कम ${MIN_PASSWORD_LENGTH} अक्षर / At least ${MIN_PASSWORD_LENGTH} characters`}
        required
      />
      <TextField
        id="confirm"
        hi="पासवर्ड दोबारा"
        en="Repeat password"
        type="password"
        autoComplete="new-password"
        required
      />
      <ErrorBox message={error} />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'सहेज रहे हैं… / Saving…' : 'पासवर्ड सहेजें / Save password'}
      </Button>
    </form>
  );
}
