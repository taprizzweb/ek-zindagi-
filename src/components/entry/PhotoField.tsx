'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, ErrorBox } from '@/components/ui';
import { compressFile } from '@/lib/client/image';
import type { GalleryReason } from '@/lib/validation/entry';
import CameraCapture, { type CameraFailure } from './CameraCapture';

export interface PhotoValue {
  blob: Blob;
  url: string;
  source: 'camera' | 'gallery';
  galleryReason?: GalleryReason;
}

const REASONS: { key: GalleryReason; hi: string; en: string }[] = [
  { key: 'camera_not_working', hi: 'कैमरा काम नहीं कर रहा', en: 'Camera is not working' },
  { key: 'permission_denied', hi: 'कैमरे की अनुमति नहीं मिली', en: 'Camera permission was denied' },
  { key: 'no_camera', hi: 'फ़ोन में कैमरा नहीं मिला', en: 'No camera found' },
  { key: 'other', hi: 'अन्य कारण', en: 'Other reason' },
];

const FAILURE_TEXT: Record<CameraFailure, { hi: string; en: string }> = {
  permission_denied: {
    hi: 'कैमरे की अनुमति नहीं मिली। ब्राउज़र की सेटिंग में अनुमति दें, या फ़ोटो के बिना आगे बढ़ें।',
    en: 'Camera permission was denied. Allow it in the browser settings, or continue without a photo.',
  },
  no_camera: { hi: 'कैमरा नहीं मिला।', en: 'No camera was found.' },
  camera_not_working: { hi: 'कैमरा शुरू नहीं हुआ।', en: 'The camera could not start.' },
};

export default function PhotoField({
  value,
  onChange,
  allowGallery,
}: {
  value: PhotoValue | null;
  onChange: (v: PhotoValue | null) => void;
  allowGallery: boolean;
}) {
  const [mode, setMode] = useState<'idle' | 'camera' | 'gallery'>('idle');
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [reason, setReason] = useState<GalleryReason | ''>('');
  const [fileError, setFileError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    urlRef.current = value?.url ?? null;
  }, [value]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  function set(next: Omit<PhotoValue, 'url'> | null) {
    if (value) URL.revokeObjectURL(value.url);
    onChange(next ? { ...next, url: URL.createObjectURL(next.blob) } : null);
  }

  async function pickFile(file: File | undefined) {
    if (!file || !reason) return;
    setFileError(false);
    try {
      set({ blob: await compressFile(file), source: 'gallery', galleryReason: reason });
      setMode('idle');
    } catch {
      setFileError(true);
    }
  }

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-base font-semibold">
        फोटो (ज़रूरी नहीं) / Photo (optional)
      </legend>

      {value ? (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img
            src={value.url}
            alt="खींची गई फ़ोटो / Captured photo"
            className="max-h-64 rounded border-2 border-line"
          />
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                set(null);
                setFailure(null);
                setMode(value.source === 'camera' ? 'camera' : 'gallery');
              }}
            >
              दोबारा लें / Retake
            </Button>
            <Button type="button" variant="secondary" onClick={() => set(null)}>
              फ़ोटो हटाएँ / Remove photo
            </Button>
          </div>
        </div>
      ) : mode === 'camera' ? (
        <CameraCapture
          onCapture={(blob) => {
            set({ blob, source: 'camera' });
            setMode('idle');
          }}
          onCancel={() => setMode('idle')}
          onFailure={(f) => {
            setFailure(f);
            setReason(f);
            setMode('idle');
          }}
        />
      ) : (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setFailure(null);
            setMode('camera');
          }}
        >
          कैमरा खोलें / Open camera
        </Button>
      )}

      {failure ? <ErrorBox message={FAILURE_TEXT[failure]} /> : null}

      {!value && allowGallery && mode !== 'camera' ? (
        mode === 'gallery' ? (
          <div className="space-y-3 rounded border-2 border-line p-3">
            <p className="text-sm text-muted">
              गैलरी की फ़ोटो पर्यवेक्षक की जाँच के लिए चिह्नित होती है। / Gallery photos are flagged
              for supervisor review.
            </p>
            <label htmlFor="galleryReason" className="block text-base font-semibold">
              कारण / Reason
            </label>
            <select
              id="galleryReason"
              value={reason}
              onChange={(e) => setReason(e.target.value as GalleryReason | '')}
              className="h-12 w-full rounded border-2 border-line bg-white px-3 text-base"
            >
              <option value="">चुनें / Choose</option>
              {REASONS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.hi} / {r.en}
                </option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="गैलरी से फ़ोटो / Photo from gallery"
              onChange={(e) => {
                void pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div className="flex gap-3">
              <Button type="button" disabled={!reason} onClick={() => fileRef.current?.click()}>
                फ़ोटो चुनें / Choose photo
              </Button>
              <Button type="button" variant="secondary" onClick={() => setMode('idle')}>
                रद्द / Cancel
              </Button>
            </div>
            {fileError ? (
              <ErrorBox
                message={{
                  hi: 'यह फ़ोटो खुल नहीं सकी। दूसरी फ़ोटो चुनें।',
                  en: 'That photo could not be opened. Choose another.',
                }}
              />
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="min-h-12 text-left text-base text-accent underline"
            onClick={() => setMode('gallery')}
          >
            कैमरा नहीं चल रहा? गैलरी से चुनें / Camera not working? Use gallery
          </button>
        )
      ) : null}
    </fieldset>
  );
}
