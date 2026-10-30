const MAX_EDGE = 1200;

function drawToJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('no canvas'));
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  // Re-drawing onto a canvas drops all EXIF/GPS metadata; the server re-encodes again anyway.
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.8),
  );
}

/** Current frame of a live camera preview as a compressed JPEG (long edge at most 1200 px). */
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  return drawToJpeg(video, video.videoWidth, video.videoHeight);
}

/** A gallery file as a compressed JPEG with the camera orientation applied and metadata removed. */
export async function compressFile(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return await drawToJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
