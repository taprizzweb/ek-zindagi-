'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { captureFrame } from '@/lib/client/image';

export type CameraFailure = 'permission_denied' | 'no_camera' | 'camera_not_working';

export default function CameraCapture({
  onCapture,
  onCancel,
  onFailure,
}: {
  onCapture: (jpeg: Blob) => void;
  onCancel: () => void;
  onFailure: (reason: CameraFailure) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('', 'NotFoundError');
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          setReady(true);
        }
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        onFailure(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'permission_denied'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'no_camera'
              : 'camera_not_working',
        );
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start the camera once per mount
  }, []);

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    try {
      onCapture(await captureFrame(video));
    } catch {
      onFailure('camera_not_working');
    }
  }

  return (
    <div className="space-y-3">
      <video
        ref={videoRef}
        playsInline
        muted
        aria-label="कैमरा / Camera preview"
        className="aspect-[4/3] w-full rounded border-2 border-line bg-black object-cover"
      />
      <div className="flex gap-3">
        <Button type="button" className="flex-1" onClick={capture} disabled={!ready}>
          फोटो लें / Capture
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          रद्द / Cancel
        </Button>
      </div>
    </div>
  );
}
