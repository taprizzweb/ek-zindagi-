/**
 * Text that ends up on the certificate must be printable with the bundled fonts
 * (Latin and Devanagari), otherwise the PDF would show empty boxes.
 */
const LETTER_OR_MARK = String.raw`\p{Script=Latin}\p{Script=Devanagari}\p{M}`;

/** Person's name: letters in Latin or Devanagari, spaces, dot, apostrophe, hyphen. */
export const NAME_RE = new RegExp(String.raw`^[${LETTER_OR_MARK}][${LETTER_OR_MARK} .'’-]*$`, 'u');

/** Place names and short free text: also digits and a few separators. */
export const PLACE_RE = new RegExp(String.raw`^[${LETTER_OR_MARK}\p{N} .,'’/()&#-]+$`, 'u');

export function isPrintablePlace(s: string): boolean {
  return PLACE_RE.test(s);
}
