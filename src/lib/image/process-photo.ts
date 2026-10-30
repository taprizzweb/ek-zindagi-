import sharp from 'sharp';
import { AppError } from '@/lib/errors';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_LONG_EDGE = 1200;
const MAX_INPUT_PIXELS = 25_000_000;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

/**
 * Re-encodes an uploaded photo: applies the camera orientation, shrinks it to 1200 px on the
 * long edge and writes a fresh JPEG. No metadata is carried over (EXIF, GPS, thumbnails, ICC),
 * and anything that is not a real JPEG, PNG or WebP image is refused.
 */
export async function processPhoto(input: Buffer): Promise<Buffer> {
  if (input.length === 0 || input.length > MAX_UPLOAD_BYTES) throw new AppError('bad_photo', 400);
  try {
    const image = sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS });
    const meta = await image.metadata();
    if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) throw new AppError('bad_photo', 400);
    return await image
      .rotate()
      .resize({
        width: MAX_LONG_EDGE,
        height: MAX_LONG_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('bad_photo', 400);
  }
}
