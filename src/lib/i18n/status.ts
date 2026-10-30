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

export function statusLabel(status: string): Bilingual {
  return STATUS_LABELS[status] ?? { hi: status, en: status };
}
