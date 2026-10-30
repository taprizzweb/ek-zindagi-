/** Coordinates are stored and sent to the geocoder at 3 decimals (about 110 m). */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Rough bounding box of India. Rejects (0, 0) and other broken GPS fixes. */
export function isInIndia(lat: number, lng: number): boolean {
  return lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;
}
