'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ErrorBox } from '@/components/ui';
import { messageFor } from '@/lib/i18n/messages';
import type { Bilingual } from '@/lib/i18n/messages';

async function post(url: string, body?: unknown): Promise<Bilingual | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { error?: { code: string } };
    return messageFor(json.error?.code);
  } catch {
    return {
      hi: 'नेटवर्क नहीं मिला। फिर से कोशिश करें।',
      en: 'No network. Try again.',
    };
  }
}

/** The kill switch. Stopping asks for a tap to confirm: it halts every officer at once. */
export function PauseControl({ paused, envLocked }: { paused: boolean; envLocked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function set(next: boolean) {
    setBusy(true);
    setError(null);
    const err = await post('/api/campaign/pause', { paused: next });
    setBusy(false);
    setConfirming(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <section
      className={`rounded border-2 p-4 ${paused ? 'border-danger' : 'border-line'}`}
      aria-labelledby="pause-h"
    >
      <h2 id="pause-h" className="text-lg font-semibold">
        अभियान / Campaign: {paused ? 'रुका हुआ / PAUSED' : 'चालू / Running'}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {paused
          ? 'कोई संदेश नहीं भेजा जा रहा। / No messages are being sent.'
          : 'रोकने पर सभी अधिकारियों का भेजना तुरंत बंद हो जाता है। / Pausing stops sending for every officer at once.'}
      </p>
      {envLocked ? (
        <p className="mt-2 text-sm font-semibold">
          सर्वर सेटिंग (CAMPAIGN_PAUSED) से रोका गया है; यहाँ से चालू नहीं हो सकता। / Paused by the
          server setting CAMPAIGN_PAUSED; it cannot be resumed here.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3">
        {paused ? (
          <Button type="button" disabled={busy || envLocked} onClick={() => void set(false)}>
            फिर से चालू करें / Resume sending
          </Button>
        ) : confirming ? (
          <>
            <Button type="button" variant="danger" disabled={busy} onClick={() => void set(true)}>
              हाँ, सब रोकें / Yes, pause everything
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              रद्द करें / Cancel
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            अभियान रोकें / Pause campaign
          </Button>
        )}
      </div>
      <div className="mt-2">
        <ErrorBox message={error} />
      </div>
    </section>
  );
}

export function RetryButton({ id, ambiguous }: { id: string; ambiguous: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);

  async function retry() {
    if (
      ambiguous &&
      !window.confirm(
        'हो सकता है संदेश पहले ही जा चुका हो। फिर भी भेजें? / The message may already have been delivered. Send anyway?',
      )
    )
      return;
    setBusy(true);
    setError(null);
    const err = await post(`/api/entries/${id}/retry`);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <div>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void retry()}>
        {busy ? 'भेज रहे हैं… / Sending…' : 'फिर से भेजें / Retry'}
      </Button>
      <ErrorBox message={error} />
    </div>
  );
}

export function ReviewButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);

  async function mark() {
    setBusy(true);
    setError(null);
    const err = await post(`/api/entries/${id}/review`);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <div>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void mark()}>
        देख लिया / Mark reviewed
      </Button>
      <ErrorBox message={error} />
    </div>
  );
}
