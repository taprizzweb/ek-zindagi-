/**
 * Violation list and the awareness line printed on the certificate.
 * The NGO can edit wording here without touching any other code.
 * Keys must match the `violation_key` enum in the database.
 */
export const VIOLATION_KEYS = [
  'helmet',
  'seatbelt',
  'child_helmet',
  'wrong_side',
  'overspeed',
  'mobile',
  'other',
] as const;
export type ViolationKey = (typeof VIOLATION_KEYS)[number];

export interface Violation {
  key: ViolationKey;
  en: string;
  hi: string;
  lineEn: string;
  lineHi: string;
  /** Roman-script Hindi, used in the WhatsApp message. */
  lineHinglish: string;
}

export const VIOLATIONS: readonly Violation[] = [
  {
    key: 'helmet',
    en: 'Riding without a helmet',
    hi: 'बिना हेलमेट दोपहिया चलाना',
    lineEn: 'Wear your helmet. Someone is waiting for you at home.',
    lineHi: 'हेलमेट पहनें। घर पर कोई आपका इंतज़ार कर रहा है।',
    lineHinglish: 'Helmet pehniye. Ghar par koi aapka intezaar kar raha hai.',
  },
  {
    key: 'seatbelt',
    en: 'Driving without a seatbelt',
    hi: 'बिना सीट बेल्ट गाड़ी चलाना',
    lineEn: 'Buckle up. Someone is waiting for you at home.',
    lineHi: 'सीट बेल्ट लगाएँ। घर पर कोई आपका इंतज़ार कर रहा है।',
    lineHinglish: 'Seat belt lagaiye. Ghar par koi aapka intezaar kar raha hai.',
  },
  {
    key: 'child_helmet',
    en: 'Child without a helmet on a two-wheeler',
    hi: 'दोपहिया पर बच्चे को हेलमेट न पहनाना',
    lineEn: "Your child's life fits in one helmet. Put it on every ride.",
    lineHi: 'आपके बच्चे की ज़िंदगी एक हेलमेट में है। हर सफ़र में पहनाएँ।',
    lineHinglish: 'Aapke bachche ki zindagi ek helmet mein hai. Har safar mein pehnaiye.',
  },
  {
    key: 'wrong_side',
    en: 'Driving on the wrong side',
    hi: 'गलत दिशा में गाड़ी चलाना',
    lineEn: 'The wrong side of the road leaves no second chance.',
    lineHi: 'सड़क की गलत तरफ़ दूसरा मौका नहीं मिलता।',
    lineHinglish: 'Sadak ki galat taraf doosra mauka nahi milta.',
  },
  {
    key: 'overspeed',
    en: 'Overspeeding',
    hi: 'ओवरस्पीडिंग (तेज़ रफ़्तार)',
    lineEn: 'Speed saves minutes, not lives. Slow down.',
    lineHi: 'रफ़्तार मिनट बचाती है, ज़िंदगी नहीं। गति कम रखें।',
    lineHinglish: 'Raftaar minute bachati hai, zindagi nahi. Gati kam rakhiye.',
  },
  {
    key: 'mobile',
    en: 'Using a mobile phone while driving',
    hi: 'गाड़ी चलाते समय मोबाइल फ़ोन का उपयोग',
    lineEn: 'No call is worth a life. Put the phone down.',
    lineHi: 'कोई भी कॉल ज़िंदगी से बढ़कर नहीं। फ़ोन नीचे रखें।',
    lineHinglish: 'Koi bhi call zindagi se badhkar nahi. Phone neeche rakhiye.',
  },
  {
    key: 'other',
    en: 'Other traffic violation',
    hi: 'अन्य यातायात उल्लंघन',
    lineEn: 'Follow the rules. Someone is waiting for you at home.',
    lineHi: 'नियमों का पालन करें। घर पर कोई आपका इंतज़ार कर रहा है।',
    lineHinglish: 'Niyamon ka paalan kijiye. Ghar par koi aapka intezaar kar raha hai.',
  },
];

/** Short second list shown under "Other"; `typed` lets the officer write up to 40 characters. */
export const OTHER_CHOICES = [
  { key: 'red_light', en: 'Jumping a red light', hi: 'लाल बत्ती पार करना' },
  { key: 'triple_riding', en: 'Triple riding', hi: 'तीन सवारी' },
  { key: 'no_licence', en: 'Driving without a licence', hi: 'बिना लाइसेंस गाड़ी चलाना' },
  { key: 'wrong_parking', en: 'Wrong parking', hi: 'गलत पार्किंग' },
  { key: 'typed', en: 'Something else (type it)', hi: 'कुछ और (लिखें)' },
] as const;
export type OtherChoiceKey = (typeof OTHER_CHOICES)[number]['key'];
export const OTHER_CHOICE_KEYS = OTHER_CHOICES.map((c) => c.key) as [
  OtherChoiceKey,
  ...OtherChoiceKey[],
];

export function violationByKey(key: ViolationKey): Violation {
  const v = VIOLATIONS.find((x) => x.key === key);
  if (!v) throw new Error(`Unknown violation ${key}`);
  return v;
}

/** Text stored in `entries.other_text` for an "other" violation (cleared with the other personal data). */
export function otherText(choice: OtherChoiceKey, typed: string | undefined): string {
  if (choice === 'typed') return (typed ?? '').trim();
  const found = OTHER_CHOICES.find((c) => c.key === choice);
  return found ? found.en : '';
}
