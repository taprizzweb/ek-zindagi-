import { violationByKey, type ViolationKey } from '@/config/violations';

export type MessageLanguage = 'hinglish' | 'hindi' | 'english';

export interface MessageInput {
  name: string;
  certCode: string;
  violation: ViolationKey;
  /** The 24-hour certificate link (bridge mode). Cloud API mode attaches the PDF instead. */
  link?: string;
  language: MessageLanguage;
}

/**
 * The WhatsApp text. Short: who it is from, that the certificate is an awareness illustration,
 * one safety line, the opt-out line. It never mentions a challan, fine or penalty.
 */
export function buildMessage(m: MessageInput): string {
  const v = violationByKey(m.violation);
  const link = m.link ? `${m.link}\n` : '';
  switch (m.language) {
    case 'english':
      return [
        `Hello ${m.name} 🙏`,
        '',
        'This is from the Jaipur road safety awareness camp (Project EK ZINDAGI).',
        '',
        m.link ? `Your awareness certificate:\n${link}` : 'Your awareness certificate is attached.',
        'It is a hypothetical illustration, not an official document.',
        '',
        v.lineEn,
        '',
        m.link ? 'The link works for 24 hours.' : null,
        `Code: ${m.certCode}`,
        'To stop messages, reply *STOP*.',
      ]
        .filter((l) => l !== null)
        .join('\n');
    case 'hindi':
      return [
        `नमस्ते ${m.name} जी 🙏`,
        '',
        'यह संदेश जयपुर सड़क सुरक्षा जागरूकता शिविर (प्रोजेक्ट EK ZINDAGI) की ओर से है।',
        '',
        m.link ? `आपका जागरूकता प्रमाणपत्र:\n${link}` : 'आपका जागरूकता प्रमाणपत्र साथ में है।',
        'यह एक काल्पनिक चित्रण है, कोई आधिकारिक दस्तावेज़ नहीं।',
        '',
        v.lineHi,
        '',
        m.link ? 'यह लिंक 24 घंटे तक चलेगा।' : null,
        `कोड: ${m.certCode}`,
        'संदेश बंद करने के लिए *STOP* लिखें।',
      ]
        .filter((l) => l !== null)
        .join('\n');
    default:
      return [
        `Namaste ${m.name} ji 🙏`,
        '',
        'Yeh sandesh Jaipur road safety awareness camp (Project EK ZINDAGI) ki taraf se hai.',
        '',
        m.link
          ? `Aapka awareness certificate:\n${link}`
          : 'Aapka awareness certificate attached hai.',
        'Yeh ek kaalpanik chitran hai, koi official document nahi.',
        '',
        v.lineHinglish,
        '',
        m.link ? 'Yeh link 24 ghante tak chalega.' : null,
        `Code: ${m.certCode}`,
        'Band karne ke liye *STOP* likhein.',
      ]
        .filter((l) => l !== null)
        .join('\n');
  }
}

/** wa.me hand-off URL: opens WhatsApp on the officer's phone with the chat and text ready. */
export function whatsappUrl(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * The three values of the approved WhatsApp template body (cloud API mode): {{1}} the person's name,
 * {{2}} the one safety line, {{3}} the certificate code. The fixed text lives in the template that
 * Meta approves (docs/whatsapp-setup.md), not here. Never includes the person's number.
 */
export function templateBodyParams(m: Omit<MessageInput, 'link'>): [string, string, string] {
  const v = violationByKey(m.violation);
  const line =
    m.language === 'english' ? v.lineEn : m.language === 'hindi' ? v.lineHi : v.lineHinglish;
  return [m.name, line, m.certCode];
}
