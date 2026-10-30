import { z } from 'zod';
import { OTHER_CHOICE_KEYS, VIOLATION_KEYS } from '@/config/violations';
import { isInIndia, round3 } from '@/lib/domain/geo';
import { normalizeIndianMobile } from '@/lib/domain/phone';

/** Letters (any script), combining marks, spaces, dot, apostrophe, hyphen. No digits, emoji or markup. */
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
const OTHER_TEXT_RE = /^[\p{L}\p{M}\p{N} .,'’/()-]+$/u;

export const nameSchema = z
  .string()
  .transform((s) => s.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2).max(40).regex(NAME_RE));

export const phoneSchema = z
  .string()
  .max(20)
  .transform((s, ctx) => {
    const e164 = normalizeIndianMobile(s);
    if (!e164) ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
    return e164 ?? '';
  });

export const GALLERY_REASONS = [
  'camera_not_working',
  'permission_denied',
  'no_camera',
  'other',
] as const;
export type GalleryReason = (typeof GALLERY_REASONS)[number];

const locationSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('gps'),
    lat: z.number().finite().transform(round3),
    lng: z.number().finite().transform(round3),
    areaName: z.string().trim().min(2).max(120),
  }),
  z.strictObject({
    source: z.literal('manual'),
    areaName: z.string().trim().min(2).max(120),
  }),
]);

/** Text fields sent by the officer form (the photo travels separately as a file). */
export const entryInputSchema = z
  .strictObject({
    clientRequestId: z.uuid(),
    name: nameSchema,
    phone: phoneSchema,
    violation: z.enum(VIOLATION_KEYS),
    otherChoice: z.enum(OTHER_CHOICE_KEYS).optional(),
    otherTyped: z.string().trim().max(40).optional(),
    location: locationSchema,
    photoSource: z.enum(['none', 'camera', 'gallery']),
    galleryReason: z.enum(GALLERY_REASONS).optional(),
    consentChecked: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.violation === 'other') {
      if (!v.otherChoice)
        ctx.addIssue({ code: 'custom', path: ['otherChoice'], message: 'required' });
      if (v.otherChoice === 'typed') {
        const t = v.otherTyped ?? '';
        if (t.length < 2 || !OTHER_TEXT_RE.test(t))
          ctx.addIssue({ code: 'custom', path: ['otherTyped'], message: 'invalid' });
      }
    } else if (v.otherChoice || v.otherTyped) {
      ctx.addIssue({ code: 'custom', path: ['otherChoice'], message: 'only_for_other' });
    }
    if (v.photoSource === 'gallery' && !v.galleryReason)
      ctx.addIssue({ code: 'custom', path: ['galleryReason'], message: 'required' });
    if (v.photoSource !== 'gallery' && v.galleryReason)
      ctx.addIssue({ code: 'custom', path: ['galleryReason'], message: 'only_for_gallery' });
    if (v.photoSource !== 'none' && !v.consentChecked)
      ctx.addIssue({ code: 'custom', path: ['consentChecked'], message: 'required_with_photo' });
    if (v.location.source === 'gps' && !isInIndia(v.location.lat, v.location.lng))
      ctx.addIssue({ code: 'custom', path: ['location'], message: 'outside_india' });
  });
export type EntryInput = z.output<typeof entryInputSchema>;

export const geocodeQuerySchema = z.strictObject({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
