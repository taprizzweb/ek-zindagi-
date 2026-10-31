'use client';

import { useEffect, useState } from 'react';
import { Button, TextField } from '@/components/ui';
import { getPosition } from '@/lib/client/geo';
import { round3 } from '@/lib/domain/geo';

export type LocationValue =
  | { source: 'gps'; lat: number; lng: number; areaName: string }
  | { source: 'manual'; areaName: string };

type GpsState =
  | { status: 'locating' }
  | { status: 'ok'; lat: number; lng: number; geocoded: boolean; accuracy: number }
  | { status: 'failed' };

export default function LocationField({
  onChange,
  error,
}: {
  onChange: (v: LocationValue) => void;
  error?: string;
}) {
  const [gps, setGps] = useState<GpsState>({ status: 'locating' });
  const [place, setPlace] = useState('');

  const [attempt, setAttempt] = useState(0);

  // GPS fix, then the place name. State starts as 'locating'; the retry button resets it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pos = await getPosition();
      if (cancelled) return;
      if (!pos.ok) {
        setGps({ status: 'failed' });
        return;
      }
      const lat = round3(pos.lat);
      const lng = round3(pos.lng);
      let name: string | null = null;
      try {
        const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) name = ((await res.json()) as { areaName: string | null }).areaName;
      } catch {
        /* the officer types the place instead */
      }
      if (cancelled) return;
      setGps({
        status: 'ok',
        lat,
        lng,
        geocoded: name !== null,
        accuracy: Math.round(pos.accuracy),
      });
      if (name) setPlace(name);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retry() {
    setGps({ status: 'locating' });
    setAttempt((n) => n + 1);
  }

  useEffect(() => {
    if (gps.status === 'ok')
      onChange({ source: 'gps', lat: gps.lat, lng: gps.lng, areaName: place });
    else if (gps.status === 'failed') onChange({ source: 'manual', areaName: place });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is a stable setter
  }, [gps, place]);

  const geocoded = gps.status === 'ok' && gps.geocoded;

  return (
    <div className="space-y-2">
      <p className="text-base font-semibold">जगह / Location</p>
      {gps.status === 'locating' ? (
        <p role="status" className="text-muted">
          लोकेशन ली जा रही है (कुछ सेकंड)… / Getting an accurate location (a few seconds)…
        </p>
      ) : null}
      {gps.status === 'ok' ? (
        <p role="status" className="font-semibold text-accent-dark">
          ✓ लोकेशन मिल गई / Location confirmed
        </p>
      ) : null}
      {gps.status === 'ok' && gps.accuracy > 500 ? (
        <p role="alert" className="font-semibold text-danger">
          फ़ोन सिर्फ़ मोटा (approximate) लोकेशन दे रहा है, करीब {gps.accuracy} मीटर तक गलत। एड्रेस
          बार के ताले 🔒 पर दबाएँ → अनुमतियाँ → लोकेशन → “सटीक / Precise” चालू करें, फिर “फिर से
          लोकेशन लें” दबाएँ। / The phone is giving only an approximate location, off by about{' '}
          {gps.accuracy} m. Tap the lock 🔒 in the address bar → Permissions → Location → turn on
          “Precise”, then tap “Try GPS again”.
        </p>
      ) : null}
      {gps.status === 'ok' && gps.accuracy > 100 && gps.accuracy <= 500 ? (
        <p role="alert" className="font-semibold text-danger">
          लोकेशन लगभग {gps.accuracy} मीटर तक गलत हो सकती है। जगह का नाम जाँचें या बाहर खुले में जाकर
          “फिर से लोकेशन लें” दबाएँ। / The location may be off by about {gps.accuracy} m. Check the
          place name, or step outside and tap “Try GPS again”.
        </p>
      ) : null}
      {gps.status === 'failed' ? (
        <p role="status" className="text-danger">
          लोकेशन नहीं मिली। नीचे जगह का नाम लिखें। / Location is not available. Type the place
          below.
        </p>
      ) : null}

      {gps.status !== 'locating' ? (
        <TextField
          id="place"
          hi="जगह का नाम"
          en="Place name"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          maxLength={120}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          hint={
            geocoded
              ? 'अपने आप भरा गया। ठीक न लगे तो बदलें। / Filled in automatically. Change it if it is not right.'
              : 'जैसे: सी-स्कीम चौराहा, जयपुर / e.g. C-Scheme Chauraha, Jaipur'
          }
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      {gps.status !== 'locating' ? (
        <Button type="button" variant="secondary" onClick={retry}>
          फिर से लोकेशन लें / Try GPS again
        </Button>
      ) : null}
    </div>
  );
}
