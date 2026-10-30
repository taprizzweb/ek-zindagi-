'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ErrorBox, Label } from '@/components/ui';
import { messageFor, type Bilingual } from '@/lib/i18n/messages';

async function save(key: string, value: boolean | number): Promise<Bilingual | null> {
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    if (res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { error?: { code: string } };
    return messageFor(json.error?.code);
  } catch {
    return { hi: 'नेटवर्क नहीं मिला। फिर से कोशिश करें।', en: 'No network. Try again.' };
  }
}

export default function SettingsForm({
  initial,
  envPaused,
}: {
  initial: { campaignPaused: boolean; allowGallery: boolean; retentionHours: number };
  envPaused: boolean;
}) {
  const router = useRouter();
  const [hours, setHours] = useState(String(initial.retentionHours));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Bilingual | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function apply(key: string, value: boolean | number) {
    setBusy(key);
    setError(null);
    setSaved(null);
    const err = await save(key, value);
    setBusy(null);
    if (err) {
      setError(err);
      return;
    }
    setSaved(key);
    router.refresh();
  }

  const hoursNumber = Number(hours);
  const hoursValid = Number.isInteger(hoursNumber) && hoursNumber >= 1 && hoursNumber <= 168;

  return (
    <div className="space-y-8">
      <section aria-labelledby="s-pause" className="space-y-2">
        <h2 id="s-pause" className="text-lg font-semibold">
          अभियान रोकें / Pause campaign
        </h2>
        <p className="text-sm text-muted">
          चालू होने पर कोई संदेश नहीं जाता। / While on, no message is sent.
        </p>
        {envPaused ? (
          <p className="text-sm font-semibold">
            सर्वर पर CAMPAIGN_PAUSED=true है, इसे यहाँ से बदला नहीं जा सकता। / The server has
            CAMPAIGN_PAUSED=true; it cannot be changed here.
          </p>
        ) : null}
        <Button
          type="button"
          variant={initial.campaignPaused ? 'primary' : 'secondary'}
          disabled={busy !== null || envPaused}
          aria-pressed={initial.campaignPaused}
          onClick={() => void apply('campaign_paused', !initial.campaignPaused)}
        >
          {initial.campaignPaused
            ? 'रुका है, चालू करें / Paused: resume'
            : 'चालू है, रोकें / Running: pause'}
        </Button>
      </section>

      <section aria-labelledby="s-gal" className="space-y-2">
        <h2 id="s-gal" className="text-lg font-semibold">
          गैलरी से फ़ोटो / Gallery photo fallback
        </h2>
        <p className="text-sm text-muted">
          “कैमरा नहीं चल रहा? गैलरी” का विकल्प। ऐसी प्रविष्टियाँ जाँच सूची में आती हैं। / The
          “Camera not working? Use gallery” link. Those entries appear in the supervisor review
          list.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={busy !== null}
          aria-pressed={initial.allowGallery}
          onClick={() => void apply('allow_gallery_fallback', !initial.allowGallery)}
        >
          {initial.allowGallery
            ? 'चालू है, बंद करें / On: turn off'
            : 'बंद है, चालू करें / Off: turn on'}
        </Button>
      </section>

      <section aria-labelledby="s-ret" className="space-y-2">
        <h2 id="s-ret" className="text-lg font-semibold">
          डेटा कितने घंटे रखें / Keep personal data for (hours)
        </h2>
        <p className="text-sm text-muted">
          1 से 168। नई प्रविष्टियों पर लागू; पुरानी अपनी तय समय-सीमा पर हटती हैं। / 1 to 168.
          Applies to new entries; older ones are deleted at the time they were given.
        </p>
        <Label htmlFor="retention" hi="घंटे" en="Hours" />
        <div className="flex flex-wrap gap-3">
          <input
            id="retention"
            inputMode="numeric"
            className="h-12 w-28 rounded border-2 border-line bg-white px-3 text-base text-ink"
            value={hours}
            onChange={(e) => setHours(e.target.value.replace(/\D/g, '').slice(0, 3))}
            aria-invalid={!hoursValid}
          />
          <Button
            type="button"
            disabled={busy !== null || !hoursValid || hoursNumber === initial.retentionHours}
            onClick={() => void apply('retention_hours', hoursNumber)}
          >
            सहेजें / Save
          </Button>
        </div>
        {!hoursValid ? (
          <p className="text-sm text-danger">1 से 168 के बीच / Between 1 and 168</p>
        ) : null}
      </section>

      {saved ? (
        <p role="status" className="font-semibold text-accent-dark">
          सहेजा गया। / Saved.
        </p>
      ) : null}
      <ErrorBox message={error} />
    </div>
  );
}
