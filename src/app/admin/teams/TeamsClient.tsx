'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, ErrorBox, TextField } from '@/components/ui';
import { formatIst } from '@/lib/domain/time';
import { messageFor, type Bilingual } from '@/lib/i18n/messages';

export interface TeamRow {
  id: string;
  label: string;
  code: string;
  active: boolean;
  lastUsedAt: string | null;
  linkChangedAt: string | null;
}

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { code: string };
  };
  return { ok: res.ok, data };
}

/** The text an admin sends to the team on WhatsApp: the link and how to put it on the phone. */
function shareText(label: string, link: string): string {
  return [
    `एक ज़िंदगी · EK ZINDAGI (${label})`,
    '',
    `1. यह लिंक अपने फ़ोन के Chrome में खोलें / Open this link in Chrome:`,
    link,
    '2. ऊपर कोने में तीन डॉट (⋮) दबाएँ / Tap the three dots (⋮) at the top right',
    '3. “होम स्क्रीन पर जोड़ें / Add to Home screen” दबाएँ / Tap it',
    '4. अब फ़ोन में “एक ज़िंदगी” ऐप जैसा आइकन आ जाएगा / An app-like icon appears on the phone',
    '',
    'यह लिंक किसी और को न दें। / Do not share this link.',
  ].join('\n');
}

export default function TeamsClient({ teams }: { teams: TeamRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const [shown, setShown] = useState<{ label: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<{
    id: string;
    action: 'new_link' | 'disable';
  } | null>(null);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const label = String(new FormData(form).get('label') ?? '');
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await call('/api/admin/teams', 'POST', { label });
      if (!ok) setError(messageFor(data.error?.code));
      else {
        setShown({ label, link: String(data.link) });
        setCopied(false);
        form.reset();
        router.refresh();
      }
    } catch {
      setError(messageFor('internal'));
    }
    setBusy(false);
  }

  async function act(t: TeamRow, action: 'new_link' | 'disable' | 'enable') {
    setBusy(true);
    setError(null);
    setConfirming(null);
    try {
      const { ok, data } = await call(`/api/admin/teams/${t.id}`, 'PATCH', { action });
      if (!ok) setError(messageFor(data.error?.code));
      else {
        if (action === 'new_link') {
          setShown({ label: t.label, link: String(data.link) });
          setCopied(false);
        }
        router.refresh();
      }
    } catch {
      setError(messageFor('internal'));
    }
    setBusy(false);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-8">
      {shown ? (
        <section aria-live="polite" className="space-y-3 rounded border-2 border-accent p-4">
          <h2 className="text-lg font-semibold">{shown.label}: लिंक तैयार / link ready</h2>
          <p className="text-sm text-muted">
            यह लिंक सिर्फ़ अभी दिखेगा। इसे टीम को भेजें। / Shown only now. Send it to the team.
          </p>
          <p className="break-all rounded bg-white p-3 font-mono text-sm" data-testid="team-link">
            {shown.link}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => void copy(shown.link)}>
              {copied ? 'कॉपी हो गया / Copied' : 'लिंक कॉपी करें / Copy link'}
            </Button>
            <a
              className="inline-flex min-h-12 items-center rounded border-2 border-line bg-white px-4 text-base font-semibold hover:bg-gray-100"
              href={`https://wa.me/?text=${encodeURIComponent(shareText(shown.label, shown.link))}`}
            >
              WhatsApp पर भेजें / Share on WhatsApp
            </a>
            <Button type="button" variant="secondary" onClick={() => setShown(null)}>
              बंद करें / Close
            </Button>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="new-team">
        <h2 id="new-team" className="mb-2 text-lg font-semibold">
          नई टीम / New team
        </h2>
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <TextField
              id="label"
              hi="थाने या टीम का नाम"
              en="Station or team name"
              required
              minLength={2}
              maxLength={60}
            />
          </div>
          <Button type="submit" disabled={busy}>
            लिंक बनाएँ / Make link
          </Button>
        </form>
        <div className="mt-3">
          <ErrorBox message={error} />
        </div>
      </section>

      <section aria-labelledby="all-teams">
        <h2 id="all-teams" className="mb-2 text-lg font-semibold">
          टीमें / Teams ({teams.length})
        </h2>
        {teams.length === 0 ? (
          <p className="text-muted">अभी कोई टीम नहीं। / No teams yet.</p>
        ) : (
          <ul className="divide-y-2 divide-line border-y-2 border-line">
            {teams.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">
                    {t.label} · {t.code} · {t.active ? 'चालू / On' : 'बंद / Off'}
                  </p>
                  <p className="text-sm text-muted">
                    अंतिम उपयोग / Last used: {t.lastUsedAt ? formatIst(t.lastUsedAt) : '—'} · लिंक
                    बदला / Link changed: {t.linkChangedAt ? formatIst(t.linkChangedAt) : '—'}
                  </p>
                </div>
                {confirming?.id === t.id ? (
                  <div className="space-y-2">
                    <p>
                      {confirming.action === 'new_link'
                        ? 'नया लिंक बनेगा, पुराना तुरंत बंद। / A new link; the old one stops at once.'
                        : 'टीम बंद होगी, सभी फ़ोन रुक जाएँगे। / The team is switched off; every phone stops.'}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant={confirming.action === 'disable' ? 'danger' : 'primary'}
                        disabled={busy}
                        onClick={() => act(t, confirming.action)}
                      >
                        हाँ / Yes
                      </Button>
                      <Button variant="secondary" onClick={() => setConfirming(null)}>
                        रद्द / Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={busy || !t.active}
                      onClick={() => setConfirming({ id: t.id, action: 'new_link' })}
                    >
                      नया लिंक / New link
                    </Button>
                    {t.active ? (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setConfirming({ id: t.id, action: 'disable' })}
                      >
                        बंद करें / Switch off
                      </Button>
                    ) : (
                      <Button variant="secondary" disabled={busy} onClick={() => act(t, 'enable')}>
                        चालू करें / Switch on
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
