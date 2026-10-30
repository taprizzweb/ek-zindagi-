import type { Bilingual } from './messages';

export const STATUS_LABELS: Record<string, Bilingual> = {
  saved: { hi: 'सहेजा गया', en: 'Saved' },
  generating: { hi: 'प्रमाणपत्र बन रहा है', en: 'Creating certificate' },
  ready: { hi: 'भेजने के लिए तैयार', en: 'Ready to send' },
  sending: { hi: 'भेजा जा रहा है', en: 'Sending' },
  sent: { hi: 'भेजा गया', en: 'Sent' },
  delivered: { hi: 'पहुँच गया', en: 'Delivered' },
  read: { hi: 'पढ़ा गया', en: 'Read' },
  failed: { hi: 'विफल', en: 'Failed' },
};

export function statusLabel(
  status: string,
  opts: { mode?: string | null; linkOpened?: boolean } = {},
): Bilingual {
  // Bridge mode cannot see whether the officer tapped Send, or whether the message arrived.
  if (opts.mode === 'bridge' && ['sent', 'delivered', 'read'].includes(status)) {
    return opts.linkOpened
      ? { hi: 'व्यक्ति ने लिंक खोला', en: 'Link opened by the person' }
      : { hi: 'व्हाट्सऐप खोला गया (पुष्टि नहीं)', en: 'WhatsApp opened (not confirmed)' };
  }
  return STATUS_LABELS[status] ?? { hi: status, en: status };
}
