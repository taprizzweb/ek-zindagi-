/**
 * Fixed wording on the certificate (landscape design, see reference/certificate_v2.*).
 * The stamp, the watermark and the disclaimer are NOT settings: they are part of the
 * Certificate component itself, so no configuration can switch them off.
 */
import type { ViolationKey } from './violations';

export const CERTIFICATE_TEXT = {
  headline: 'ONE MISTAKE AWAY',
  subtitleBase: 'Certificate of recklessness on road',
  certifies: 'This certifies that',
  caughtOnCamera: 'was caught on camera on',
  dateLabel: 'Date & time',
  placeLabel: 'At',
  committing: 'while committing this traffic offence:',
  issuedAt: 'Issued at Jaipur',
  centreLine: 'This could have been your last ride.',
  signature: 'Road Safety Awareness Campaign',
  stamp: ['FOR AWARENESS', 'PURPOSE ONLY'],
  watermark: 'AWARENESS ONLY',
  disclaimer:
    'Awareness campaign illustration. Not a legal document, accident report or police notice. No harm has occurred to the person named.',
  technologyPartner: 'Technology Partner',
  /** Printed in the footer of every certificate unless PARTNER_CREDIT_TEXT replaces it. */
  partnerLine: 'Project EK ZINDAGI by Taprizz × Chitrakatha (homestay)',
} as const;

/** Labels and column layout of the checklist printed on the certificate. */
export const CERTIFICATE_CHECKLIST: { column: 1 | 2; key: ViolationKey; label: string }[] = [
  { column: 1, key: 'helmet', label: 'Rider without helmet' },
  { column: 1, key: 'child_helmet', label: 'Child without helmet on scooter' },
  { column: 1, key: 'overspeed', label: 'Overspeeding' },
  { column: 1, key: 'other', label: 'Other traffic violation' },
  { column: 2, key: 'seatbelt', label: 'Driver without seatbelt' },
  { column: 2, key: 'wrong_side', label: 'Driving on the wrong side' },
  { column: 2, key: 'mobile', label: 'Mobile phone while driving' },
];
