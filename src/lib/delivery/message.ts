import { violationByKey, type ViolationKey } from '@/config/violations';

export interface MessageInput {
  name: string;
  certCode: string;
  violation: ViolationKey;
  /** The 24-hour certificate link (bridge mode). Cloud API mode attaches the PDF instead. */
  link?: string;
}

/**
 * The WhatsApp text: Hindi and English together in one message (there is no language switch: the people
 * who receive it, and the officers who send it, read one or both). Short: who it is from, that the
 * certificate is an awareness illustration, one safety line, the opt-out line. It never mentions a
 * challan, fine or penalty.
 */
export function buildMessage(m: MessageInput): string {
  const v = violationByKey(m.violation);
  return [
    `नमस्ते ${m.name} जी / Hello ${m.name} 🙏`,
    '',
    'यह संदेश जयपुर सड़क सुरक्षा जागरूकता शिविर (प्रोजेक्ट EK ZINDAGI) की ओर से है।',
    'This is from the Jaipur road safety awareness camp (Project EK ZINDAGI).',
    '',
    m.link
      ? `आपका जागरूकता प्रमाणपत्र / Your awareness certificate:\n${m.link}`
      : 'आपका जागरूकता प्रमाणपत्र साथ में है। / Your awareness certificate is attached.',
    'यह एक काल्पनिक चित्रण है, कोई आधिकारिक दस्तावेज़ नहीं।',
    'It is a hypothetical illustration, not an official document.',
    '',
    v.lineHi,
    v.lineEn,
    '',
    m.link
      ? 'लिंक खोलकर PDF फ़ोन में सेव करें (24 घंटे)। / Open the link and save the PDF (24 hours).'
      : null,
    `कोड / Code: ${m.certCode}`,
    'संदेश बंद करने के लिए *STOP* लिखें। / To stop messages, reply *STOP*.',
  ]
    .filter((l) => l !== null)
    .join('\n');
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
  // One line (a template value cannot hold a line break): Hindi, then English.
  return [m.name, `${v.lineHi} / ${v.lineEn}`, m.certCode];
}
