import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { MAX_UPLOAD_BYTES, processPhoto } from '@/lib/image/process-photo';

const solid = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#888' } });

async function jpegWithExif(w: number, h: number, orientation = 1) {
  return solid(w, h)
    .withExif({ IFD0: { Copyright: 'SECRET-OWNER', Make: 'SECRET-PHONE' } })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();
}

describe('processPhoto', () => {
  it('outputs a JPEG with no EXIF, GPS or ICC data', async () => {
    const input = await jpegWithExif(800, 600);
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture really has EXIF
    const out = await processPhoto(input);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(out.toString('latin1')).not.toContain('SECRET-OWNER');
    expect(out.toString('latin1')).not.toContain('SECRET-PHONE');
  });

  it('shrinks to 1200 px on the long edge, keeping the aspect ratio', async () => {
    const meta = await sharp(
      await processPhoto(await solid(3000, 2000).jpeg().toBuffer()),
    ).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 800]);
    const tall = await sharp(
      await processPhoto(await solid(1500, 3000).jpeg().toBuffer()),
    ).metadata();
    expect([tall.width, tall.height]).toEqual([600, 1200]);
  });

  it('never enlarges a small photo', async () => {
    const meta = await sharp(
      await processPhoto(await solid(300, 200).jpeg().toBuffer()),
    ).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it('applies the camera orientation before dropping it', async () => {
    const out = await processPhoto(await jpegWithExif(800, 400, 6)); // rotated 90 degrees
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([400, 800]);
    expect(meta.orientation).toBeUndefined();
  });

  it.each(['png', 'webp'] as const)('accepts %s input and returns a JPEG', async (fmt) => {
    const input = await solid(200, 100)[fmt]().toBuffer();
    expect((await sharp(await processPhoto(input)).metadata()).format).toBe('jpeg');
  });

  it('refuses things that are not accepted images', async () => {
    const bad: [string, Buffer][] = [
      [
        'svg',
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
        ),
      ],
      ['gif', await solid(10, 10).gif().toBuffer()],
      ['text', Buffer.from('hello')],
      ['html', Buffer.from('<html><script>alert(1)</script></html>')],
      ['random', Buffer.from(Array.from({ length: 500 }, (_, i) => (i * 37) % 256))],
      ['truncated jpeg', (await solid(500, 500).jpeg().toBuffer()).subarray(0, 100)],
      ['empty', Buffer.alloc(0)],
    ];
    for (const [label, buf] of bad) {
      await expect(processPhoto(buf), label).rejects.toMatchObject({ code: 'bad_photo' });
    }
  });

  it('refuses a file over the size limit before decoding it', async () => {
    await expect(processPhoto(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toBeInstanceOf(AppError);
  });

  it('refuses an image with an absurd pixel count (decompression bomb)', async () => {
    const huge = await sharp({
      create: { width: 6000, height: 6000, channels: 3, background: '#000' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(huge.length).toBeLessThan(MAX_UPLOAD_BYTES); // small on disk, huge in memory
    await expect(processPhoto(huge)).rejects.toMatchObject({ code: 'bad_photo' });
  });
});
