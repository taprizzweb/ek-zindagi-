import { describe, expect, it, vi } from 'vitest';
import { parseNominatim, reverseGeocodeOsm } from '@/lib/geo/osm';

const jaipur = {
  address: {
    suburb: 'C-Scheme',
    city: 'Jaipur',
    state_district: 'Jaipur',
    state: 'Rajasthan',
    country: 'India',
  },
};

describe('parseNominatim', () => {
  it('builds "Area, City, State"', () => {
    expect(parseNominatim(jaipur)).toBe('C-Scheme, Jaipur, Rajasthan');
  });
  it('uses the road when there is no neighbourhood, and a town or village when there is no city', () => {
    expect(
      parseNominatim({ address: { road: 'Tonk Road', town: 'Sanganer', state: 'Rajasthan' } }),
    ).toBe('Tonk Road, Sanganer, Rajasthan');
    expect(parseNominatim({ address: { village: 'Bagru', state: 'Rajasthan' } })).toBe(
      'Bagru, Rajasthan',
    );
  });
  it('does not repeat a name that appears twice', () => {
    expect(parseNominatim({ address: { suburb: 'Jaipur', city: 'Jaipur' } })).toBe('Jaipur');
  });
  it.each([null, {}, { address: {} }, { address: { country: 'India' } }, { address: 'x' }, 'x', 5])(
    'gives nothing for an answer without a place: %j',
    (body) => {
      expect(parseNominatim(body)).toBeNull();
    },
  );
  it('drops a name the certificate cannot print', () => {
    expect(parseNominatim({ address: { suburb: '日本橋', city: '東京' } })).toBeNull();
    expect(parseNominatim({ address: { suburb: 'A<script>', city: 'Jaipur' } })).toBeNull();
  });
  it('keeps the name within 120 characters', () => {
    const long = 'A'.repeat(150);
    expect(
      parseNominatim({ address: { suburb: long, city: 'Jaipur' } })!.length,
    ).toBeLessThanOrEqual(120);
  });
});

describe('reverseGeocodeOsm', () => {
  const ok = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body }));

  it('asks with rounded coordinates, English names and an identifying User-Agent, and returns the place', async () => {
    const f = ok(jaipur);
    expect(await reverseGeocodeOsm(26.912345, 75.787654, 'EK-ZINDAGI/1.0 (test)', f)).toBe(
      'C-Scheme, Jaipur, Rajasthan',
    );
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toContain('lat=26.912&lon=75.788');
    expect(url).not.toContain('26.912345');
    expect(url).toContain('accept-language=en');
    expect(init.headers['User-Agent']).toBe('EK-ZINDAGI/1.0 (test)');
  });
  it('gives null (the officer types the place) on a failure, a bad answer or a network error', async () => {
    expect(
      await reverseGeocodeOsm(
        26.9,
        75.8,
        'ua',
        vi.fn(async () => ({ ok: false, json: async () => ({}) })),
      ),
    ).toBeNull();
    expect(await reverseGeocodeOsm(26.9, 75.8, 'ua', ok({ nothing: true }))).toBeNull();
    expect(
      await reverseGeocodeOsm(
        26.9,
        75.8,
        'ua',
        vi.fn(async () => {
          throw new Error('down');
        }),
      ),
    ).toBeNull();
  });
});
