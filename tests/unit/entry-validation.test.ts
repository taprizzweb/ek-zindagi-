import { describe, expect, it } from 'vitest';
import { entryInputSchema, geocodeQuerySchema, nameSchema } from '@/lib/validation/entry';

const base = {
  clientRequestId: '30000000-0000-4000-8000-000000000001',
  name: 'Ravi Kumar',
  phone: '9876543210',
  violation: 'helmet',
  location: {
    source: 'gps',
    lat: 26.91234,
    lng: 75.78765,
    areaName: 'C-Scheme, Jaipur, Rajasthan',
  },
  photoSource: 'none',
  consentChecked: false,
};
const parse = (over: Record<string, unknown>) => entryInputSchema.safeParse({ ...base, ...over });

describe('nameSchema', () => {
  it.each([
    'Ravi Kumar',
    'रवि कुमार',
    "D'Souza",
    'Anne-Marie',
    'Dr. R. K. Sharma',
    'Ño',
    'José Álvarez',
    'Nguyễn',
  ])('accepts %s', (n) => {
    expect(nameSchema.safeParse(n).success).toBe(true);
  });
  it.each(['அருண்', 'محمد', '李明', 'Ravi Кумар'])(
    'rejects %s: a script the certificate fonts cannot print',
    (n) => {
      expect(nameSchema.safeParse(n).success).toBe(false);
    },
  );
  it.each([
    '',
    'R',
    'x'.repeat(41),
    'Ravi123',
    '<script>',
    'Ravi 😀',
    '-Ravi',
    '1',
    'Ravi\nKumar2',
    '"; drop',
  ])('rejects %j', (n) => expect(nameSchema.safeParse(n).success).toBe(false));
  it('tidies spaces and normalises Unicode', () => {
    expect(nameSchema.parse('  Ravi    Kumar ')).toBe('Ravi Kumar');
    expect(nameSchema.parse('René')).toBe('René'); // NFC
  });
  it('treats newlines as spaces', () => {
    expect(nameSchema.parse('Ravi\nKumar')).toBe('Ravi Kumar');
  });
});

describe('entryInputSchema', () => {
  it('accepts a complete GPS entry and normalises it', () => {
    const r = parse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.phone).toBe('+919876543210');
      expect(r.data.location).toMatchObject({ source: 'gps', lat: 26.912, lng: 75.788 });
    }
  });
  it('accepts a manual-location entry without coordinates', () => {
    expect(
      parse({ location: { source: 'manual', areaName: 'Station Road, Jaipur' } }).success,
    ).toBe(true);
  });
  it('refuses coordinates on a manual entry and a missing place name', () => {
    expect(
      parse({ location: { source: 'manual', areaName: 'Station Road', lat: 1, lng: 2 } }).success,
    ).toBe(false);
    expect(parse({ location: { source: 'gps', lat: 26.9, lng: 75.8, areaName: '' } }).success).toBe(
      false,
    );
  });
  it.each([
    [0, 0],
    [51.5, -0.12],
    [26.9, 120],
  ])('refuses a GPS fix outside India (%s, %s)', (lat, lng) => {
    expect(parse({ location: { source: 'gps', lat, lng, areaName: 'Somewhere' } }).success).toBe(
      false,
    );
  });
  it('refuses a bad phone number', () => {
    expect(parse({ phone: '12345' }).success).toBe(false);
  });
  it('refuses unknown fields (mass assignment)', () => {
    expect(parse({ officerId: 'x' }).success).toBe(false);
    expect(parse({ status: 'sent' }).success).toBe(false);
  });
  it('refuses an unknown violation', () => {
    expect(parse({ violation: 'parking' }).success).toBe(false);
  });

  describe('"other" violation', () => {
    it('needs a choice', () => {
      expect(parse({ violation: 'other' }).success).toBe(false);
    });
    it('accepts a listed choice', () => {
      expect(parse({ violation: 'other', otherChoice: 'red_light' }).success).toBe(true);
    });
    it('needs 2 to 40 safe characters when typed', () => {
      expect(
        parse({ violation: 'other', otherChoice: 'typed', otherTyped: 'No indicator' }).success,
      ).toBe(true);
      expect(parse({ violation: 'other', otherChoice: 'typed', otherTyped: 'x' }).success).toBe(
        false,
      );
      expect(
        parse({ violation: 'other', otherChoice: 'typed', otherTyped: 'a'.repeat(41) }).success,
      ).toBe(false);
      expect(
        parse({ violation: 'other', otherChoice: 'typed', otherTyped: '<b>bold</b>' }).success,
      ).toBe(false);
      expect(parse({ violation: 'other', otherChoice: 'typed' }).success).toBe(false);
    });
    it('is refused on any other violation', () => {
      expect(parse({ otherChoice: 'red_light' }).success).toBe(false);
      expect(parse({ otherTyped: 'x y' }).success).toBe(false);
    });
  });

  describe('photo rules', () => {
    it('needs consent whenever there is a photo', () => {
      expect(parse({ photoSource: 'camera', consentChecked: false }).success).toBe(false);
      expect(parse({ photoSource: 'camera', consentChecked: true }).success).toBe(true);
    });
    it('needs a reason for a gallery photo, and only then', () => {
      expect(parse({ photoSource: 'gallery', consentChecked: true }).success).toBe(false);
      expect(
        parse({ photoSource: 'gallery', consentChecked: true, galleryReason: 'no_camera' }).success,
      ).toBe(true);
      expect(
        parse({ photoSource: 'camera', consentChecked: true, galleryReason: 'no_camera' }).success,
      ).toBe(false);
      expect(
        parse({ photoSource: 'gallery', consentChecked: true, galleryReason: 'because' }).success,
      ).toBe(false);
    });
  });
});

describe('geocodeQuerySchema', () => {
  it('coerces query-string numbers', () => {
    expect(geocodeQuerySchema.parse({ lat: '26.912', lng: '75.787' })).toEqual({
      lat: 26.912,
      lng: 75.787,
    });
  });
  it('refuses junk', () => {
    expect(geocodeQuerySchema.safeParse({ lat: 'x', lng: '1' }).success).toBe(false);
    expect(geocodeQuerySchema.safeParse({ lat: '91', lng: '1' }).success).toBe(false);
    expect(geocodeQuerySchema.safeParse({ lat: '1', lng: '1', extra: '1' }).success).toBe(false);
  });
});
