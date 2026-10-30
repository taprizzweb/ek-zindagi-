import { describe, expect, it, vi } from 'vitest';
import { isInIndia, round3 } from '@/lib/domain/geo';
import { parseGoogleGeocode, reverseGeocodeGoogle } from '@/lib/geo/google';

const jaipur = {
  status: 'OK',
  results: [
    {
      address_components: [
        { long_name: 'C-Scheme', types: ['sublocality_level_1', 'sublocality', 'political'] },
        { long_name: 'Jaipur', types: ['locality', 'political'] },
        { long_name: 'Rajasthan', types: ['administrative_area_level_1', 'political'] },
        { long_name: 'India', types: ['country', 'political'] },
      ],
    },
  ],
};

describe('parseGoogleGeocode', () => {
  it('builds "Area, City, State"', () => {
    expect(parseGoogleGeocode(jaipur)).toBe('C-Scheme, Jaipur, Rajasthan');
  });
  it('falls back to the city when there is no sub-area', () => {
    const body = {
      status: 'OK',
      results: [{ address_components: jaipur.results[0]!.address_components.slice(1) }],
    };
    expect(parseGoogleGeocode(body)).toBe('Jaipur, Rajasthan');
  });
  it('does not repeat a name that appears twice', () => {
    const body = {
      status: 'OK',
      results: [
        {
          address_components: [
            { long_name: 'Jaipur', types: ['sublocality'] },
            { long_name: 'Jaipur', types: ['locality'] },
          ],
        },
      ],
    };
    expect(parseGoogleGeocode(body)).toBe('Jaipur');
  });
  it.each([
    null,
    {},
    { status: 'ZERO_RESULTS', results: [] },
    { status: 'REQUEST_DENIED' },
    { status: 'OK', results: [] },
    'x',
  ])('returns null for %j', (body) => expect(parseGoogleGeocode(body)).toBeNull());
  it('caps the length at 120 characters', () => {
    const body = {
      status: 'OK',
      results: [{ address_components: [{ long_name: 'x'.repeat(300), types: ['locality'] }] }],
    };
    expect(parseGoogleGeocode(body)?.length).toBe(120);
  });
});

describe('reverseGeocodeGoogle', () => {
  it('sends coordinates rounded to 3 decimals and the key, and returns the place', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => jaipur }));
    const name = await reverseGeocodeGoogle(26.912345, 75.787654, 'KEY&x', fetchImpl);
    expect(name).toBe('C-Scheme, Jaipur, Rajasthan');
    const url = (fetchImpl.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain('latlng=26.912,75.788');
    expect(url).not.toContain('26.912345');
    expect(url).toContain('key=KEY%26x');
  });
  it('returns null instead of throwing when the provider fails', async () => {
    expect(
      await reverseGeocodeGoogle(26.9, 75.8, 'k', async () => {
        throw new Error('down');
      }),
    ).toBeNull();
    expect(
      await reverseGeocodeGoogle(26.9, 75.8, 'k', async () => ({
        ok: false,
        json: async () => ({}),
      })),
    ).toBeNull();
  });
});

describe('geo helpers', () => {
  it('rounds to 3 decimals', () => {
    expect(round3(26.91249)).toBe(26.912);
    expect(round3(75.7875)).toBe(75.788);
  });
  it('knows roughly where India is', () => {
    expect(isInIndia(26.9124, 75.7873)).toBe(true); // Jaipur
    expect(isInIndia(0, 0)).toBe(false);
    expect(isInIndia(51.5, -0.12)).toBe(false);
  });
});
