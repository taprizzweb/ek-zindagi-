import type { Bilingual } from './messages';

/**
 * What a stored error code means, for a supervisor. The codes carry no personal data: they are
 * `wa_<Meta code>`, `wa_http_<status>`, `ambiguous_*`, or our own short names.
 */
export function errorCodeLabel(code: string | null): Bilingual {
  if (!code) return { hi: 'कारण अज्ञात', en: 'Reason unknown' };
  if (code.startsWith('ambiguous'))
    return {
      hi: 'पता नहीं संदेश गया या नहीं',
      en: 'Unknown whether the message was sent',
    };
  const table: Record<string, Bilingual> = {
    wa_131026: { hi: 'नंबर व्हाट्सऐप पर नहीं है', en: 'Number is not on WhatsApp' },
    wa_131049: { hi: 'व्हाट्सऐप ने संदेश रोका', en: 'WhatsApp declined to deliver' },
    wa_131056: { hi: 'बहुत जल्दी-जल्दी संदेश', en: 'Too many messages to this number' },
    wa_130429: { hi: 'गति सीमा', en: 'Rate limit reached' },
    wa_190: { hi: 'व्हाट्सऐप की कुंजी समाप्त', en: 'WhatsApp access token expired' },
    wa_132001: { hi: 'टेम्पलेट नहीं मिला', en: 'Template not found' },
    wa_132000: { hi: 'टेम्पलेट के मान ग़लत', en: 'Template values wrong' },
    wa_132015: { hi: 'टेम्पलेट रुका हुआ', en: 'Template paused' },
    storage: { hi: 'फ़ाइल नहीं मिली', en: 'File could not be read' },
    bad_entry: { hi: 'प्रविष्टि का डेटा ग़लत', en: 'Entry data is invalid' },
    pdf_failed: { hi: 'प्रमाणपत्र नहीं बन सका', en: 'Certificate could not be made' },
  };
  if (table[code]) return table[code]!;
  if (code.startsWith('wa_http_'))
    return {
      hi: `व्हाट्सऐप सर्वर त्रुटि (${code.slice(8)})`,
      en: `WhatsApp server error (${code.slice(8)})`,
    };
  return { hi: `त्रुटि: ${code}`, en: `Error: ${code}` };
}
